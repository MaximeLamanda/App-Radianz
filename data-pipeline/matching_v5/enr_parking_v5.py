"""
Polygones parking Portail ENR (PARK-SUP-500) pour matching V5.

Table par défaut : public.enr_parking_areas (sql/009_enr_parking_areas.sql).
Surcharge : variable d'environnement ENR_PARKING_TABLE.

GPKG : couche L15_Parkings_sup500m2_EPSG4326 (EPSG:4326).
Identifiant stable : hash(SHA-256 tronqué) de NumCom + Surfm2 + WKT géométrie.
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")

PARKING_TYPE_ENR = "e"
DEFAULT_PARKING_TAG = "enr"
DEFAULT_PARKING_VALUE = "park_sup_500"

DEFAULT_GPKG_LAYER = "Parkings_sup500m2"
DEFAULT_GPKG_REL = (
    "datasource/enr/ENR_2-0_PARK-SUP-500_GPKG_WLD_WM_2026-02-01/"
    "1_DONNEES_LIVRAISON/L15_Parkings_sup500m2_EPSG4326.gpkg"
)

PARKING_OVERLAP_DEDUP_RATIO = 0.5

ENR_TAGS_STORED = frozenset(
    {"Surfm2", "TYPE", "Typologie", "DPT", "NumCom", "NomCom", "name", "capacity"}
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


def qualified_enr_parking_table() -> str:
    raw = os.environ.get("ENR_PARKING_TABLE", "public.enr_parking_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="enr_parking_areas",
        label="ENR_PARKING_TABLE",
    )
    validate_ident(schema, "Schéma ENR parking")
    validate_ident(table, "Table ENR parking")
    return f'"{schema}"."{table}"'


def enr_parking_regclass() -> str:
    raw = os.environ.get("ENR_PARKING_TABLE", "public.enr_parking_areas")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="enr_parking_areas",
        label="ENR_PARKING_TABLE",
    )
    return f"{schema}.{table}"


def stable_enr_id(num_com: str, surfm2: int | float, geometry_wkt: str) -> int:
    """ID déterministe entre réimports (même entrée GPKG → même enr_id)."""
    key = f"{str(num_com or '').strip()}|{int(surfm2)}|{geometry_wkt}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest[:15], 16)


def enr_tags_from_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in ENR_TAGS_STORED:
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            out[k] = row[k]
    surfm2 = row.get("Surfm2")
    if surfm2 is not None:
        out["surface_m2"] = int(surfm2)
    nom = str(row.get("NomCom") or "").strip()
    if nom:
        out["name"] = nom
    return out
