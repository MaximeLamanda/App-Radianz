"""
Footprints bâtiments OSM pour matching V5 (source géométrique batch).

Table par défaut : public.osm_building_footprints (sql/005_osm_building_footprints.sql).
Surcharge : variable d'environnement OSM_BUILDINGS_TABLE.
"""

from __future__ import annotations

import os
import re
from typing import Any

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def parse_qualified_table(raw: str, default_schema: str, default_table: str, label: str) -> tuple[str, str]:
    t = (raw or "").strip()
    if not t:
        return default_schema, default_table
    parts = [p.strip() for p in t.split(".") if p.strip()]
    if len(parts) == 1:
        return "public", parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError(f"{label} invalide: {raw!r}")


def validate_ident(name: str, label: str) -> None:
    if not IDENT.match(name):
        raise ValueError(f'{label} invalide: "{name}"')


def qualified_osm_buildings_table() -> str:
    raw = os.environ.get("OSM_BUILDINGS_TABLE", "public.osm_building_footprints")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_building_footprints",
        label="OSM_BUILDINGS_TABLE",
    )
    validate_ident(schema, "Schéma OSM buildings")
    validate_ident(table, "Table OSM buildings")
    return f'"{schema}"."{table}"'


def osm_building_tag_is_importable(tags: dict[str, Any]) -> bool:
    """True si le tag ``building`` OSM doit entrer dans ``osm_building_footprints``.

    Exclut l'absence de tag et ``building=no`` (contour de site, pas un bâtiment).
    """
    b = str(tags.get("building") or "").strip()
    if not b:
        return False
    return b.casefold() != "no"


# amenity=* → zone_tag (éducation regroupée sous `education`).
_AMENITY_ZONE_TAG: dict[str, str] = {
    "school": "education",
    "kindergarten": "education",
    "college": "education",
    "university": "education",
    "hospital": "hospital",
}

_EDUCATION_BUILDING_TAGS = frozenset({"school", "kindergarten", "college", "university"})


def _zone_tag_from_amenity(amenity: str | None) -> str:
    key = ("" if amenity is None else str(amenity)).strip().lower()
    if not key:
        return ""
    return _AMENITY_ZONE_TAG.get(key, "")


def osm_institutional_amenity_footprint_is_importable(tags: dict[str, Any]) -> bool:
    """Ways fermés école / hôpital / université sans ``building=*`` (périmètre ``amenity``)."""
    return bool(_zone_tag_from_amenity(str(tags.get("amenity") or "")))


def osm_footprint_is_importable(tags: dict[str, Any]) -> bool:
    """Empreinte OSM pour matching V5 : ``building=*`` ou périmètre institutionnel ``amenity``."""
    return osm_building_tag_is_importable(tags) or osm_institutional_amenity_footprint_is_importable(
        tags
    )


def osm_footprint_kind_from_tags(tags: dict[str, Any]) -> str:
    """``building`` = emprise bâti ; ``zone`` = périmètre ``amenity`` sans tag ``building`` importable."""
    if osm_building_tag_is_importable(tags):
        return "building"
    if osm_institutional_amenity_footprint_is_importable(tags):
        return "zone"
    return ""


def osm_footprint_kind_from_osm_tag_fields(
    building: str | None,
    amenity: str | None,
) -> str:
    """Variante alignée sur les colonnes SQL ``osm_tag_building`` / ``osm_tag_amenity``."""
    return osm_footprint_kind_from_tags(
        {
            "building": ("" if building is None else str(building)).strip(),
            "amenity": ("" if amenity is None else str(amenity)).strip(),
        }
    )


def osm_buildings_regclass() -> str:
    raw = os.environ.get("OSM_BUILDINGS_TABLE", "public.osm_building_footprints")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_building_footprints",
        label="OSM_BUILDINGS_TABLE",
    )
    return f"{schema}.{table}"


def format_osm_building_id(osm_type: str, osm_id: int) -> str:
    return f"{str(osm_type).strip().lower()[:1]}:{int(osm_id)}"


def _first_non_empty_tag(tags: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = str(tags.get(key) or "").strip()
        if value:
            return value
    return ""


def _extract_primary_poi_type(tags: dict[str, Any]) -> tuple[str, str, str]:
    ordered_keys = ["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism", "man_made"]
    labels = {
        "amenity": "Équipement",
        "shop": "Commerce",
        "craft": "Artisanat",
        "office": "Bureaux",
        "healthcare": "Santé",
        "leisure": "Loisirs",
        "tourism": "Tourisme",
        "man_made": "Ouvrage",
    }
    for key in ordered_keys:
        value = str(tags.get(key) or "").strip()
        if not value:
            continue
        pretty = value.replace("_", " ").strip()
        if pretty:
            pretty = pretty[0].upper() + pretty[1:]
        return key, value, f"{labels.get(key, key)} — {pretty or value}"
    return "", "", ""


def _extract_contact_tags_subset(tags: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key in ("building", "building:use", "building:levels"):
        value = str(tags.get(key) or "").strip()
        if value:
            out[key] = value
    for key, raw in tags.items():
        sk = str(key or "").strip()
        if not sk.startswith("addr:"):
            continue
        value = str(raw or "").strip()
        if value:
            out[sk] = value
    return out


# landuse=* qui doit primer sur amenity (campus, zones d'activité dédiées).
_LANDUSE_ZONE_PRIORITY = frozenset(
    {
        "commercial",
        "industrial",
        "retail",
        "education",
        "religious",
        "military",
        "port",
        "depot",
    }
)

def derive_zone_tag(
    landuse: str | None,
    building_use: str | None,
    building: str | None,
    amenity: str | None = None,
) -> tuple[str, str]:
    """Retourne (zone_tag, zone_source).

    Sources : landuse | amenity | building_use | building | none.
    `amenity` (school, hospital, university, …) prime sur landuse « générique »
    (ex. residential) mais pas sur landuse education / commercial / industrial.
    """
    lu = ("" if landuse is None else str(landuse)).strip().lower()
    amenity_zone = _zone_tag_from_amenity(amenity)

    if lu and lu in _LANDUSE_ZONE_PRIORITY:
        return lu, "landuse"
    if amenity_zone:
        return amenity_zone, "amenity"
    if lu:
        return lu, "landuse"
    bu = ("" if building_use is None else str(building_use)).strip()
    if bu:
        return bu, "building_use"
    bld = ("" if building is None else str(building)).strip()
    if bld and bld.casefold() != "yes":
        if bld.lower() in _EDUCATION_BUILDING_TAGS:
            return "education", "building"
        return bld, "building"
    return "", "none"


def osm_bdnb_match_status(best_intersection_area_m2: float | None, min_intersection_area_m2: float) -> str:
    area = float(best_intersection_area_m2) if best_intersection_area_m2 is not None else 0.0
    if area <= 0.0:
        return "unmatched"
    if area < float(min_intersection_area_m2):
        return "low_overlap"
    return "matched"


def fetch_osm_geometry_payloads(cur: Any, osm_ids: list[str], osm_qualified: str) -> dict[str, dict[str, Any]]:
    if not osm_ids:
        return {}
    osm_types: list[str] = []
    osm_nums: list[int] = []
    for raw in osm_ids:
        s = str(raw or "").strip().lower()
        if ":" not in s:
            continue
        ot, oid = s.split(":", 1)
        ot = ot[:1]
        if ot not in ("w", "r"):
            continue
        try:
            num = int(oid)
        except ValueError:
            continue
        osm_types.append(ot)
        osm_nums.append(num)
    if not osm_types:
        return {}
    cur.execute(
        f"""
        WITH wanted AS (
          SELECT *
          FROM unnest(%s::text[], %s::bigint[]) AS x(osm_type, osm_id)
        )
        SELECT
          b.osm_type,
          b.osm_id,
          b.address_text,
          b.tags AS osm_tags,
          ST_Area(ST_Transform(b.geom, 2154))::double precision AS footprint_m2,
          ST_AsGeoJSON(b.geom)::text AS geometry
        FROM {osm_qualified} b
        INNER JOIN wanted w
          ON b.osm_type = w.osm_type
         AND b.osm_id = w.osm_id
        """,
        (osm_types, osm_nums),
    )
    out: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        if isinstance(row, dict):
            osm_type = row["osm_type"]
            osm_id = row["osm_id"]
            address_text = row.get("address_text")
            osm_tags = row.get("osm_tags")
            footprint_m2 = row.get("footprint_m2")
            geometry = row["geometry"]
        else:
            osm_type, osm_id, address_text, osm_tags, footprint_m2, geometry = row
        tags = osm_tags if isinstance(osm_tags, dict) else {}
        name = _first_non_empty_tag(tags, ["name", "official_name", "brand", "operator"])
        website = _first_non_empty_tag(tags, ["website", "contact:website", "url"])
        phone = _first_non_empty_tag(tags, ["phone", "contact:phone", "mobile", "contact:mobile"])
        poi_primary_key, poi_primary_value, poi_type_label = _extract_primary_poi_type(tags)
        key = format_osm_building_id(str(osm_type), int(osm_id))
        out[key] = {
            "osm_building_id": key,
            "address_text": str(address_text or "").strip(),
            "name": name,
            "website": website,
            "phone": phone,
            "poi_primary_key": poi_primary_key,
            "poi_primary_value": poi_primary_value,
            "poi_type_label": poi_type_label,
            "raw_tags": _extract_contact_tags_subset(tags),
            "footprint_m2": float(footprint_m2) if footprint_m2 is not None else None,
            "geometry": str(geometry),
        }
    return out
