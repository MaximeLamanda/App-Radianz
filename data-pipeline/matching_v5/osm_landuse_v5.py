"""
Polygones OSM landuse=* pour matching V5 (jointure spatiale batch).

Table par défaut : public.osm_landuse_areas (sql/006_osm_landuse_areas.sql).
Surcharge : variable d'environnement OSM_LANDUSE_TABLE.
"""

from __future__ import annotations

import os
import re

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


def osm_landuse_regclass() -> str:
    raw = os.environ.get("OSM_LANDUSE_TABLE", "public.osm_landuse_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_landuse_areas",
        label="OSM_LANDUSE_TABLE",
    )
    return f"{schema}.{table}"
