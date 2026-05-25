"""
Polygones OSM landuse=* pour matching V5 (jointure spatiale batch).

Table par défaut : public.osm_landuse_areas (sql/006_osm_landuse_areas.sql).
Surcharge : variable d'environnement OSM_LANDUSE_TABLE.
"""

from __future__ import annotations

import os
import re
from typing import Any

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")

# landuse OSM (colonne lu.landuse) : lève le plancher --min-batiment-footprint-m2 / parcelle.
LANDUSE_WAIVES_MIN_FOOTPRINT_M2 = frozenset({"commercial", "industrial", "retail"})


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


def qualified_osm_landuse_table() -> str:
    raw = os.environ.get("OSM_LANDUSE_TABLE", "public.osm_landuse_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_landuse_areas",
        label="OSM_LANDUSE_TABLE",
    )
    validate_ident(schema, "Schéma OSM landuse")
    validate_ident(table, "Table OSM landuse")
    return f'"{schema}"."{table}"'


def building_has_pro_landuse_waiver(
    bdetail: dict[str, Any],
    waiver_set: frozenset[str] | None = None,
) -> bool:
    """Dérogation emprise si zone_tag provient d'un polygone landuse pro (commercial / industrial / retail)."""
    if str(bdetail.get("zone_source") or "").strip() != "landuse":
        return False
    waiver = waiver_set if waiver_set is not None else LANDUSE_WAIVES_MIN_FOOTPRINT_M2
    tag = str(bdetail.get("zone_tag") or "").strip().lower()
    return tag in waiver


def footprint_sum_meets_export_threshold(
    bdetails: list[dict[str, Any]],
    footprint_sum: float,
    min_required: float,
    *,
    min_default: float,
    apply_landuse_waiver: bool,
    waiver_set: frozenset[str] | None = None,
) -> bool:
    if footprint_sum > min_required:
        return True
    if not apply_landuse_waiver or float(min_required) != float(min_default):
        return False
    return any(building_has_pro_landuse_waiver(b, waiver_set) for b in bdetails)


def build_osm_min_footprint_filter_sql(
    min_batiment_footprint_m2: float,
    osm_landuse_qualified: str,
    landuse_waiver: frozenset[str] | None = None,
) -> tuple[str, tuple[Any, ...]]:
    """Fragment SQL + paramètres pour le filtre emprise dans osm_src_raw."""
    if float(min_batiment_footprint_m2) <= 0:
        return "", ()
    min_m2 = float(min_batiment_footprint_m2)
    waiver = landuse_waiver if landuse_waiver is not None else LANDUSE_WAIVES_MIN_FOOTPRINT_M2
    if not waiver:
        return (
            "        AND ST_Area(ST_Transform(b.geom, 2154)) >= %s\n",
            (min_m2,),
        )
    waiver_list = sorted(waiver)
    return (
        f"""        AND (
          ST_Area(ST_Transform(b.geom, 2154)) >= %s
          OR EXISTS (
            SELECT 1
            FROM {osm_landuse_qualified} lu
            WHERE b.geom && lu.geom
              AND ST_Intersects(b.geom, lu.geom)
              AND lu.landuse = ANY(%s::text[])
          )
        )
""",
        (min_m2, waiver_list),
    )


def osm_landuse_regclass() -> str:
    raw = os.environ.get("OSM_LANDUSE_TABLE", "public.osm_landuse_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_landuse_areas",
        label="OSM_LANDUSE_TABLE",
    )
    return f"{schema}.{table}"
