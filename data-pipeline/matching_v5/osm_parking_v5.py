"""
Polygones OSM parking pour matching V5 (jointure spatiale batch).

Table par défaut : public.osm_parking_areas (sql/008_osm_parking_areas.sql).
Surcharge : variable d'environnement OSM_PARKING_TABLE.
"""

from __future__ import annotations

import os
import re

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")

DEFAULT_PARKING_TAGS: tuple[tuple[str, str], ...] = (
    ("amenity", "parking"),
    ("leisure", "parking"),
    ("landuse", "parking"),
)


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


def qualified_osm_parking_table() -> str:
    raw = os.environ.get("OSM_PARKING_TABLE", "public.osm_parking_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_parking_areas",
        label="OSM_PARKING_TABLE",
    )
    validate_ident(schema, "Schéma OSM parking")
    validate_ident(table, "Table OSM parking")
    return f'"{schema}"."{table}"'


def osm_parking_regclass() -> str:
    raw = os.environ.get("OSM_PARKING_TABLE", "public.osm_parking_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_parking_areas",
        label="OSM_PARKING_TABLE",
    )
    return f"{schema}.{table}"
