"""
Index parcelles → combo et agrégats surface (miroir lib/discovery-combo-markers.ts + tiroir).
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

R_EARTH_M = 6_371_000

OSM_BUILDING_ID_RE = re.compile(r"^[wnr]:\d{1,20}$")
SIREN_RE = re.compile(r"^\d{9}$")
LANDUSE_WAIVES_MIN_FOOTPRINT_M2 = frozenset({"commercial", "industrial", "retail"})
SELECTABLE_ZONE_TAGS = frozenset(
    {
        "industrial",
        "commercial",
        "retail",
        "education",
        "hospital",
        "residential",
    }
)
_EDUCATION_ZONE_TAGS = frozenset({"education", "school", "kindergarten", "college", "university"})


def normalize_discovery_zone_tag(raw: Any) -> str | None:
    tag = str(raw or "").strip().lower()
    if not tag:
        return None
    if tag in _EDUCATION_ZONE_TAGS:
        return "education"
    if tag in SELECTABLE_ZONE_TAGS:
        return tag
    return None


def building_has_pro_landuse_waiver(bdetail: dict[str, Any]) -> bool:
    """Aligné osm_landuse_v5.building_has_pro_landuse_waiver."""
    if str(bdetail.get("zone_source") or "").strip() != "landuse":
        return False
    tag = str(bdetail.get("zone_tag") or "").strip().lower()
    return tag in LANDUSE_WAIVES_MIN_FOOTPRINT_M2


def combo_id_from_parcelle_ids(parcelle_ids: list[str]) -> str:
    sorted_ids = sorted({str(s).strip() for s in parcelle_ids if str(s).strip()})
    if not sorted_ids:
        return ""
    return "combo:" + "|".join(sorted_ids)


def _buildings_json_raw(row: dict[str, Any]) -> str:
    raw = row.get("buildings_json")
    if raw is None:
        props = row.get("properties_json")
        if isinstance(props, dict):
            raw = props.get("buildings_json")
        elif isinstance(props, str) and props.strip():
            try:
                parsed = json.loads(props)
                if isinstance(parsed, dict):
                    raw = parsed.get("buildings_json")
            except json.JSONDecodeError:
                pass
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, (list, dict)):
        return json.dumps(raw, ensure_ascii=False)
    return str(raw).strip()


def is_osm_institutional_zone_footprint(bdetail: dict[str, Any]) -> bool:
    """Périmètre ``amenity`` sans ``building`` importable — zone, pas bâtiment."""
    if str(bdetail.get("zone_source") or "").strip().lower() != "amenity":
        return False
    raw_tags = bdetail.get("osm_raw_tags")
    if isinstance(raw_tags, dict):
        bld = str(raw_tags.get("building") or "").strip()
    else:
        bld = ""
    if not bld:
        return True
    return bld.casefold() == "no"


def parse_buildings_json(raw: Any) -> list[dict[str, Any]]:
    s = _buildings_json_raw({"buildings_json": raw}) if not isinstance(raw, dict) else _buildings_json_raw(raw)
    if not s:
        return []
    try:
        arr = json.loads(s)
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    return [x for x in arr if isinstance(x, dict)]


def collect_partage_batiment_construction_ids(row: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for item in parse_buildings_json(row):
        status = str(item.get("matching_status") or "").strip().lower()
        bc = str(item.get("batiment_construction_id") or "").strip()
        if status == "partage" and bc:
            out.add(bc)
    return out


def build_parcelle_combo_index(parcelle_rows: list[dict[str, Any]]) -> dict[str, str]:
    partage_by_parcel: dict[str, set[str]] = {
        str(r["scout_v5_id"]): collect_partage_batiment_construction_ids(r) for r in parcelle_rows
    }
    bid_to_parcels: dict[str, set[str]] = {}
    for pid, bids in partage_by_parcel.items():
        for bid in bids:
            bid_to_parcels.setdefault(bid, set()).add(pid)

    parcelle_to_combo: dict[str, str] = {}
    visited: set[str] = set()

    for row in parcelle_rows:
        pid = str(row["scout_v5_id"])
        if pid in visited:
            continue
        partage = partage_by_parcel.get(pid) or set()
        if not partage:
            visited.add(pid)
            parcelle_to_combo[pid] = combo_id_from_parcelle_ids([pid])
            continue
        component: set[str] = set()
        stack = [pid]
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            component.add(cur)
            for bid in partage_by_parcel.get(cur) or set():
                for nid in bid_to_parcels.get(bid) or set():
                    if nid not in visited:
                        stack.append(nid)
        combo_id = combo_id_from_parcelle_ids(list(component))
        for cid in component:
            parcelle_to_combo[cid] = combo_id

    return parcelle_to_combo


def sort_parcelle_rows_cadastre(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda r: (
            str(r.get("code_insee") or ""),
            str(r.get("section") or ""),
            str(r.get("numero_norm") or ""),
            str(r.get("scout_v5_id") or ""),
        ),
    )


def _to_rad(deg: float) -> float:
    return deg * math.pi / 180.0


def _ring_area_m2_outer_ring_lng_lat(ring: list[list[float]]) -> float:
    if not ring:
        return 0.0
    n = len(ring)
    closed = ring[:-1] if n > 1 and ring[0] == ring[-1] else ring
    m = len(closed)
    if m < 3:
        return 0.0
    sum_lng = sum(p[0] for p in closed)
    sum_lat = sum(p[1] for p in closed)
    lng0 = sum_lng / m
    lat0 = sum_lat / m
    cos_lat = math.cos(_to_rad(lat0))
    xs = [R_EARTH_M * cos_lat * _to_rad(p[0] - lng0) for p in closed]
    ys = [R_EARTH_M * _to_rad(p[1] - lat0) for p in closed]
    area = 0.0
    for i in range(m):
        j = (i + 1) % m
        area += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(area / 2.0)


def _polygon_area_m2_approx_wgs84(geometry: dict[str, Any]) -> float:
    gtype = str(geometry.get("type") or "")
    coords = geometry.get("coordinates")
    if gtype == "Polygon" and isinstance(coords, list) and coords:
        outer = coords[0]
        if isinstance(outer, list):
            ring = [[float(p[0]), float(p[1])] for p in outer if isinstance(p, (list, tuple)) and len(p) >= 2]
            return _ring_area_m2_outer_ring_lng_lat(ring)
        return 0.0
    if gtype == "MultiPolygon" and isinstance(coords, list):
        total = 0.0
        for poly in coords:
            if not isinstance(poly, list) or not poly:
                continue
            outer = poly[0]
            if isinstance(outer, list):
                ring = [
                    [float(p[0]), float(p[1])]
                    for p in outer
                    if isinstance(p, (list, tuple)) and len(p) >= 2
                ]
                total += _ring_area_m2_outer_ring_lng_lat(ring)
        return total
    return 0.0


def _parse_geom_geojson(row: dict[str, Any]) -> dict[str, Any] | None:
    raw = row.get("geom_geojson")
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def parcel_contour_area_m2_from_row(row: dict[str, Any]) -> float:
    """Aligné lib/matching-v5-to-prospect.ts `parcelContourAreaM2FromV5Row` (une parcelle)."""
    fp = 0.0
    try:
        fp = float(row.get("footprint_sum_m2") or 0)
    except (TypeError, ValueError):
        fp = 0.0
    fp = max(0.0, fp)
    geom = _parse_geom_geojson(row)
    if not geom:
        return fp
    gtype = str(geom.get("type") or "")
    if gtype == "Point":
        return fp
    if gtype in ("Polygon", "MultiPolygon"):
        return max(0.0, _polygon_area_m2_approx_wgs84(geom))
    return fp


def combo_parcel_contour_sum_m2(parcelle_rows: list[dict[str, Any]]) -> float:
    """Σ surface contour parcelle(s) du combo."""
    return float(sum(parcel_contour_area_m2_from_row(pr) for pr in parcelle_rows))


def combo_footprint_sum_m2(parcelle_rows: list[dict[str, Any]]) -> float:
    by_bc: dict[str, float] = {}
    for pr in parcelle_rows:
        for b in parse_buildings_json(pr):
            if is_osm_institutional_zone_footprint(b):
                continue
            bc = str(b.get("batiment_construction_id") or "").strip()
            if not bc or bc in by_bc:
                continue
            fp = b.get("footprint_m2")
            val = 0.0
            if fp is not None:
                try:
                    val = float(fp)
                except (TypeError, ValueError):
                    val = 0.0
            by_bc[bc] = val if val > 0 else 0.0
    if not by_bc:
        return float(sum(float(pr.get("footprint_sum_m2") or 0) for pr in parcelle_rows))
    return float(sum(fp for fp in by_bc.values() if fp > 0))


def combo_has_landuse_waiver(parcelle_rows: list[dict[str, Any]]) -> bool:
    for pr in parcelle_rows:
        for b in parse_buildings_json(pr):
            if building_has_pro_landuse_waiver(b):
                return True
    return False


def _geometries_json_raw(row: dict[str, Any]) -> str:
    raw = row.get("building_geometries_json")
    if raw is None:
        return "[]"
    if isinstance(raw, str):
        return raw.strip() or "[]"
    if isinstance(raw, (list, dict)):
        return json.dumps(raw, ensure_ascii=False)
    return str(raw).strip() or "[]"


def list_valid_osm_building_ids_in_buildings_json(row: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for item in parse_buildings_json(row):
        osm_id = str(item.get("osm_building_id") or "").strip()
        if osm_id and OSM_BUILDING_ID_RE.match(osm_id):
            out.append(osm_id)
    return out


def list_valid_osm_building_ids_in_geometries_json(row: dict[str, Any]) -> list[str]:
    s = _geometries_json_raw(row)
    if not s:
        return []
    try:
        arr = json.loads(s)
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    out: list[str] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        osm_id = str(item.get("osm_building_id") or "").strip()
        if osm_id and OSM_BUILDING_ID_RE.match(osm_id):
            out.append(osm_id)
    return out


def _push_selectable_zone_tag(tags: set[str], raw: Any) -> None:
    tag = normalize_discovery_zone_tag(raw)
    if tag:
        tags.add(tag)


def combo_construction_years(parcelle_rows: list[dict[str, Any]]) -> list[int]:
    """Années distinctes connues (union des `annee_construction` dans buildings_json)."""
    years: set[int] = set()
    for pr in parcelle_rows:
        for b in parse_buildings_json(pr):
            raw = b.get("annee_construction")
            if raw is None or raw == "":
                continue
            try:
                y = int(float(raw))
            except (TypeError, ValueError):
                continue
            if 1000 <= y <= 2100:
                years.add(y)
    return sorted(years)


def combo_zone_tags(parcelle_rows: list[dict[str, Any]]) -> list[str]:
    """Union des tags activité OSM du combo (aligné getRowOsmActivityTags côté Discovery)."""
    tags: set[str] = set()
    for pr in parcelle_rows:
        props = pr.get("properties_json")
        if isinstance(props, dict):
            _push_selectable_zone_tag(tags, props.get("zone_tag"))
            _push_selectable_zone_tag(tags, props.get("osm_zone_tag"))
        for b in parse_buildings_json(pr):
            _push_selectable_zone_tag(tags, b.get("zone_tag"))
    return sorted(tags)


def _parking_dedup_key(osm_type: str, osm_id: int) -> str:
    """Aligné parking_index_key / parkingDedupKey (TS)."""
    t = (str(osm_type or "w").strip() or "w")
    oid = int(osm_id)
    if t == "r" and oid < 0:
        return f"w:{abs(oid)}"
    return f"{t}:{oid}"


def combo_parking_sum_m2(parcelle_rows: list[dict[str, Any]]) -> float:
    """Somme parking_area_m2 des parkings distincts (aligné collectParkingsFromMatchingRows TS)."""
    seen: set[str] = set()
    total = 0.0
    for pr in parcelle_rows:
        for b in parse_buildings_json(pr):
            raw = b.get("parkings_json")
            if not isinstance(raw, list):
                continue
            for p in raw:
                if not isinstance(p, dict):
                    continue
                t = str(p.get("osm_parking_type") or "w").strip() or "w"
                try:
                    pid = int(p.get("osm_parking_id"))
                except (TypeError, ValueError):
                    continue
                key = _parking_dedup_key(t, pid)
                if key in seen:
                    continue
                seen.add(key)
                try:
                    area = float(p.get("parking_area_m2") or 0)
                except (TypeError, ValueError):
                    area = 0.0
                if area > 0:
                    total += area
    return total


def is_valid_siren(s: str) -> bool:
    return bool(SIREN_RE.match(str(s).strip()))


def naf_division_from_ape(ape: str) -> str | None:
    """Division NAF 2 chiffres (ex. 47.11F → 47)."""
    t = str(ape or "").strip().upper()
    if len(t) < 2 or not t[0].isdigit() or not t[1].isdigit():
        return None
    return t[0:2]


def _parcelle_json_list(row: dict[str, Any], field: str) -> list[dict[str, Any]]:
    raw = row.get(field)
    if raw is None:
        props = row.get("properties_json")
        if isinstance(props, dict):
            raw = props.get(field)
        elif isinstance(props, str) and props.strip():
            try:
                parsed = json.loads(props)
                if isinstance(parsed, dict):
                    raw = parsed.get(field)
            except json.JSONDecodeError:
                pass
    if raw is None:
        return []
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, str) and raw.strip():
        try:
            arr = json.loads(raw)
            if isinstance(arr, list):
                return [x for x in arr if isinstance(x, dict)]
        except json.JSONDecodeError:
            pass
    return []


def combo_owner_sirens(parcelle_rows: list[dict[str, Any]]) -> list[str]:
    """Union SIREN PPM (`passerelle_addresses_json`)."""
    seen: set[str] = set()
    for pr in parcelle_rows:
        for entry in _parcelle_json_list(pr, "passerelle_addresses_json"):
            s = str(entry.get("siren") or "").strip()
            if is_valid_siren(s):
                seen.add(s)
    return sorted(seen)


def combo_domiciliation_sirens(parcelle_rows: list[dict[str, Any]]) -> list[str]:
    """Union SIREN établissements retenus (`sirets_json`)."""
    seen: set[str] = set()
    for pr in parcelle_rows:
        for entry in _parcelle_json_list(pr, "sirets_json"):
            s = str(entry.get("siren") or "").strip()
            if is_valid_siren(s):
                seen.add(s)
    return sorted(seen)


def combo_naf_divisions(parcelle_rows: list[dict[str, Any]]) -> list[str]:
    """Divisions NAF distinctes depuis `activite_principale` des sirets_json."""
    seen: set[str] = set()
    for pr in parcelle_rows:
        for entry in _parcelle_json_list(pr, "sirets_json"):
            div = naf_division_from_ape(str(entry.get("activite_principale") or ""))
            if div:
                seen.add(div)
    return sorted(seen)


def combo_osm_building_ids(parcelle_rows: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for pr in parcelle_rows:
        for osm_id in list_valid_osm_building_ids_in_buildings_json(pr):
            if osm_id not in seen:
                seen.add(osm_id)
                out.append(osm_id)
        for osm_id in list_valid_osm_building_ids_in_geometries_json(pr):
            if osm_id not in seen:
                seen.add(osm_id)
                out.append(osm_id)
    return sorted(out)


def build_combo_records_for_commune(parcelle_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Une ligne combo par composante connexe (ou singleton)."""
    if not parcelle_rows:
        return []
    parcelle_to_combo = build_parcelle_combo_index(parcelle_rows)
    combo_to_rows: dict[str, list[dict[str, Any]]] = {}
    for row in parcelle_rows:
        pid = str(row["scout_v5_id"])
        cid = parcelle_to_combo.get(pid) or combo_id_from_parcelle_ids([pid])
        combo_to_rows.setdefault(cid, []).append(row)

    records: list[dict[str, Any]] = []
    for combo_id, rows in combo_to_rows.items():
        sorted_rows = sort_parcelle_rows_cadastre(rows)
        anchor = sorted_rows[0]
        code_insee = str(anchor.get("code_insee") or "").strip()
        records.append(
            {
                "combo_id": combo_id,
                "code_insee": code_insee,
                "anchor_parcelle_id": str(anchor["scout_v5_id"]),
                "parcelle_scout_v5_ids": [str(r["scout_v5_id"]) for r in sorted_rows],
                "osm_building_ids": combo_osm_building_ids(sorted_rows),
                "footprint_sum_m2": combo_footprint_sum_m2(sorted_rows),
                "parcel_contour_sum_m2": combo_parcel_contour_sum_m2(sorted_rows),
                "parking_sum_m2": combo_parking_sum_m2(sorted_rows),
                "has_landuse_waiver": combo_has_landuse_waiver(sorted_rows),
                "zone_tags": combo_zone_tags(sorted_rows),
                "construction_years": combo_construction_years(sorted_rows),
                "owner_sirens": combo_owner_sirens(sorted_rows),
                "domiciliation_sirens": combo_domiciliation_sirens(sorted_rows),
                "naf_divisions": combo_naf_divisions(sorted_rows),
                "anchor_geom_geojson": anchor.get("geom_geojson"),
            }
        )
    return records
