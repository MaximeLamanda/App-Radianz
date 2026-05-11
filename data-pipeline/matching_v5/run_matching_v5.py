#!/usr/bin/env python3
"""
Matching V5 (discovery) — cadastre × IRIS × BDNB × parcelles personnes morales.

Totalement indépendant : aucun import depuis le package scout_pipeline.

Prérequis Postgres : PostGIS, tables
  public.cadastre_france_feuilles_geom,
  public.parcelles_personnes_morales,
  et la table BDNB (BDNB_BUILDINGS_TABLE, défaut public.bdnb_buildings).
  Optionnel (--write-postgres) : table public.scout_matching_v5_features
  (sql/003_scout_matching_v5_features.sql).
  Mode --building-source osm : tables public.osm_building_footprints et
  public.osm_landuse_areas (schémas 005 et 006 ; la landuse peut être vide).

IRIS : fichier GeoJSON Bordeaux Métropole (Pessac inclus) sous public/geo/.

Connexion : même ordre de variables que scripts/lib/resolve-database-url.mjs
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
from collections import defaultdict
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_PIPELINE_DIR = REPO_ROOT / "data-pipeline" / "python"
MATCHING_V5_DIR = Path(__file__).resolve().parent
if str(PYTHON_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_PIPELINE_DIR))
if str(MATCHING_V5_DIR) not in sys.path:
    sys.path.insert(0, str(MATCHING_V5_DIR))

from rapidfuzz import fuzz, process

from scout_pipeline.address_normalization import (
    normalize_address_parts,
    normalize_indice_for_match,
    street_number_match_set,
)

from google_poi_fallback_v5 import (
    build_synthetic_ppm_from_google_anchor,
    empty_google_audit,
    run_google_poi_fallback_for_parcel,
)
from osm_buildings_v5 import (
    derive_zone_tag,
    fetch_osm_geometry_payloads,
    format_osm_building_id,
    osm_bdnb_match_status,
    osm_buildings_regclass,
    qualified_osm_buildings_table,
)
from osm_landuse_v5 import (
    osm_landuse_regclass,
    qualified_osm_landuse_table,
)
from osm_poi_v5 import (
    building_osm_export_columns,
    fetch_osm_pois_for_parcel_keys,
    parcel_osm_export_columns,
)

DATABASE_URL_ENV_KEYS = [
    "LOCAL_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
    "Radianz_DATABASE_URL",
    "RADIANZ_POSTGRES_URL",
    "Radianz_POSTGRES_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
    "RADIANZ_DATABASE_URL_UNPOOLED",
    "Radianz_DATABASE_URL_UNPOOLED",
    "DATABASE_URL_UNPOOLED",
    "RADIANZ_POSTGRES_URL_NON_POOLING",
    "Radianz_POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL_NON_POOLING",
]

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def _fetch_all_dicts_chunked(cur: Any, *, chunk_size: int = 2000) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    out: list[dict[str, Any]] = []
    while True:
        rows = cur.fetchmany(chunk_size)
        if not rows:
            break
        out.extend(dict(zip(cols, row)) for row in rows)
    return out


class PhaseProfiler:
    def __init__(self, enabled: bool) -> None:
        self.enabled = bool(enabled)
        self.steps: dict[str, float] = {}
        self.metrics: dict[str, Any] = {}
        self._stack: list[tuple[str, float]] = []

    @contextmanager
    def phase(self, name: str):
        if not self.enabled:
            yield
            return
        start = time.perf_counter()
        self._stack.append((name, start))
        try:
            yield
        finally:
            _name, _start = self._stack.pop()
            self.steps[name] = self.steps.get(name, 0.0) + (time.perf_counter() - _start)

    def set_metric(self, key: str, value: Any) -> None:
        if self.enabled:
            self.metrics[key] = value

    def to_payload(self) -> dict[str, Any]:
        return {
            "steps_seconds": {k: round(v, 6) for k, v in self.steps.items()},
            "metrics": self.metrics,
        }


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env.local", ".env"):
        p = REPO_ROOT / name
        if p.is_file():
            load_dotenv(p)


def resolve_database_url() -> str | None:
    _load_dotenv()
    for k in DATABASE_URL_ENV_KEYS:
        v = os.environ.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


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


def qualified_bdnb_constructions_table() -> tuple[str, str]:
    raw = os.environ.get(
        "BDNB_CONSTRUCTIONS_TABLE",
        "bdnb_2025_07_a_open_data_dep33.batiment_construction",
    )
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="batiment_construction",
        label="BDNB_CONSTRUCTIONS_TABLE",
    )
    validate_ident(schema, "Schéma BDNB constructions")
    validate_ident(table, "Table BDNB constructions")
    return f'"{schema}"."{table}"', schema


def qualified_bdnb_ffo_table(schema: str) -> str:
    validate_ident(schema, "Schéma BDNB (FFO)")
    # Convention BDNB open data : table dans le même schéma que batiment_construction.
    return f'"{schema}"."batiment_groupe_ffo_bat"'


def qualified_etablissements_table() -> str:
    raw = os.environ.get("SCOUT_ETABLISSEMENTS_TABLE", "public.scout_etablissements")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="scout_etablissements",
        label="SCOUT_ETABLISSEMENTS_TABLE",
    )
    validate_ident(schema, "Schéma établissements")
    validate_ident(table, "Table établissements")
    return f'"{schema}"."{table}"'


def norm_numero_parcelle(raw: str | None) -> str:
    s = (raw or "").strip()
    digits = "".join(ch for ch in s if ch.isdigit())
    if not digits:
        return ""
    return digits[-4:].zfill(4)


def siren_bucket(distinct_count: int) -> str:
    if distinct_count <= 0:
        return "none"
    if distinct_count == 1:
        return "single"
    return "multiple"


def ppm_siren_status(num_sirens: int) -> str:
    return siren_bucket(num_sirens)


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except Exception:
        return None
    if f == float("inf") or f == float("-inf"):
        return None
    return f


def fetch_building_parcel_pairs(
    cur,
    code_insee: str,
    constructions_qualified: str,
    ffo_qualified: str,
) -> list[dict[str, Any]]:
    min_intersection_area_m2 = 50.0
    # Point dans parcelle (ST_PointOnSurface) : rapide et stable vs ST_Intersects sur géométries invalides.
    # Les bâtiments chevauchant plusieurs parcelles sans point intérieur commun sont rares.
    sql = f"""
    WITH parcels AS (
      SELECT code_insee, section, numero_norm, geom, ST_Transform(geom, 2154) AS geom_2154
      FROM public.cadastre_france_feuilles_geom
      WHERE code_insee = %s
        AND numero_norm IS NOT NULL
        AND TRIM(numero_norm) <> ''
    ),
    bat AS (
      SELECT
        batiment_construction_id::text,
        bc.batiment_groupe_id,
        bc.geom_cstr,
        ffo.annee_construction,
        ST_Transform(bc.geom_cstr, 4326) AS g4326,
        ST_Centroid(bc.geom_cstr) AS centroid_2154
      FROM {constructions_qualified} bc
      LEFT JOIN {ffo_qualified} ffo
        ON ffo.batiment_groupe_id = bc.batiment_groupe_id
      WHERE bc.code_commune_insee = %s
        AND bc.geom_cstr IS NOT NULL
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%résidentiel collectif%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%residentiel collectif%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%résidentiel individuel%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%residentiel individuel%%'
    ),
    pairs AS (
      SELECT
        b.batiment_construction_id,
        b.batiment_groupe_id,
        p.code_insee,
        p.section,
        p.numero_norm,
        b.annee_construction,
        ST_Area(b.geom_cstr)::double precision AS footprint_m2,
        ST_Area(
          ST_Transform(
            ST_Intersection(b.g4326, p.geom),
            2154
          )
        )::double precision AS intersection_area_m2
      FROM bat b
      INNER JOIN parcels p
        ON ST_IsValid(b.g4326)
        AND b.g4326 && p.geom
        AND ST_Intersects(b.g4326, p.geom)
    )
    SELECT DISTINCT ON (batiment_construction_id, code_insee, section, numero_norm)
      batiment_construction_id,
      batiment_groupe_id::text AS batiment_groupe_id,
      code_insee,
      section,
      numero_norm,
      annee_construction,
      footprint_m2,
      intersection_area_m2
    FROM pairs
    WHERE intersection_area_m2 >= %s
    ORDER BY batiment_construction_id, code_insee, section, numero_norm
    """
    cur.execute(sql, (code_insee, code_insee, min_intersection_area_m2))
    return _fetch_all_dicts_chunked(cur)


def fetch_osm_building_parcel_pairs(
    cur,
    *,
    code_insee: str,
    constructions_qualified: str,
    ffo_qualified: str,
    osm_buildings_qualified: str,
    osm_landuse_qualified: str,
    min_parcel_intersection_area_m2: float,
    min_osm_bdnb_intersection_area_m2: float,
    osm_test_limit: int = 0,
) -> list[dict[str, Any]]:
    sql = f"""
    WITH parcels AS (
      SELECT code_insee, section, numero_norm, geom, ST_Transform(geom, 2154) AS geom_2154
      FROM public.cadastre_france_feuilles_geom
      WHERE code_insee = %s
        AND numero_norm IS NOT NULL
        AND TRIM(numero_norm) <> ''
    ),
    parcels_extent AS (
      SELECT ST_Extent(geom)::geometry AS bbox
      FROM parcels
    ),
    osm_src_raw AS MATERIALIZED (
      SELECT
        b.osm_type,
        b.osm_id,
        b.address_text,
        b.geom AS g4326,
        b.tags AS osm_tags,
        ST_Transform(b.geom, 2154) AS g2154,
        ST_Centroid(ST_Transform(b.geom, 2154)) AS centroid_2154,
        ST_Area(ST_Transform(b.geom, 2154))::double precision AS osm_footprint_m2
      FROM {osm_buildings_qualified} b
      WHERE b.geom IS NOT NULL
        AND b.geom && (SELECT bbox FROM parcels_extent)
        AND b.code_insee = %s
        AND ST_Area(ST_Transform(b.geom, 2154)) >= 400.0
      ORDER BY b.osm_id
      LIMIT %s
    ),
    osm_src AS MATERIALIZED (
      SELECT DISTINCT ON (md5(ST_AsBinary(ST_Normalize(g4326))))
        osm_type,
        osm_id,
        address_text,
        osm_tags,
        g4326,
        g2154,
        centroid_2154,
        osm_footprint_m2
      FROM osm_src_raw
      ORDER BY
        md5(ST_AsBinary(ST_Normalize(g4326))),
        CASE WHEN osm_type = 'r' THEN 0 ELSE 1 END,
        osm_id
    ),
    bdnb_src AS MATERIALIZED (
      SELECT
        bc.batiment_construction_id::text AS batiment_construction_id,
        bc.batiment_groupe_id::text AS batiment_groupe_id,
        ffo.annee_construction,
        ST_Transform(bc.geom_cstr, 4326) AS g4326,
        bc.geom_cstr AS g2154
      FROM {constructions_qualified} bc
      LEFT JOIN {ffo_qualified} ffo
        ON ffo.batiment_groupe_id = bc.batiment_groupe_id
      WHERE bc.code_commune_insee = %s
        AND bc.geom_cstr IS NOT NULL
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%résidentiel collectif%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%residentiel collectif%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%résidentiel individuel%%'
        AND COALESCE(LOWER(ffo.usage_niveau_1_txt), '') NOT LIKE '%%residentiel individuel%%'
    ),
    osm_bdnb_pairs AS (
      SELECT
        o.osm_type,
        o.osm_id,
        b.batiment_construction_id,
        b.batiment_groupe_id,
        b.annee_construction,
        ST_Area(ST_Intersection(o.g2154, b.g2154))::double precision AS osm_bdnb_intersection_area_m2
      FROM osm_src o
      INNER JOIN bdnb_src b
        ON o.g4326 && b.g4326
       AND ST_Intersects(o.g4326, b.g4326)
    ),
    best_osm_bdnb AS (
      SELECT DISTINCT ON (osm_type, osm_id)
        osm_type,
        osm_id,
        batiment_construction_id,
        batiment_groupe_id,
        annee_construction,
        osm_bdnb_intersection_area_m2
      FROM osm_bdnb_pairs
      ORDER BY osm_type, osm_id, osm_bdnb_intersection_area_m2 DESC, batiment_construction_id
    ),
    landuse_pairs AS (
      SELECT x.osm_type, x.osm_id, x.landuse_key, x.area_m2
      FROM (
        SELECT
          o.osm_type,
          o.osm_id,
          lu.landuse AS landuse_key,
          ST_Area(ST_Transform(ST_Intersection(o.g4326, lu.geom), 2154))::double precision AS area_m2
        FROM osm_src o
        INNER JOIN {osm_landuse_qualified} lu
          ON o.g4326 && lu.geom
         AND ST_Intersects(o.g4326, lu.geom)
      ) x
      WHERE x.area_m2 IS NOT NULL AND x.area_m2 > 0
    ),
    best_osm_landuse AS (
      SELECT DISTINCT ON (osm_type, osm_id)
        osm_type,
        osm_id,
        landuse_key AS landuse_value,
        area_m2 AS landuse_intersection_area_m2
      FROM landuse_pairs
      ORDER BY osm_type, osm_id, area_m2 DESC NULLS LAST, landuse_key
    ),
    pairs AS (
      SELECT
        o.osm_type,
        o.osm_id,
        p.code_insee,
        p.section,
        p.numero_norm,
        m.batiment_construction_id,
        m.batiment_groupe_id,
        m.annee_construction,
        m.osm_bdnb_intersection_area_m2,
        o.osm_footprint_m2 AS footprint_m2,
        o.address_text AS osm_address_text,
        (o.osm_tags->>'building:use') AS osm_tag_building_use,
        (o.osm_tags->>'building') AS osm_tag_building,
        z.landuse_value,
        z.landuse_intersection_area_m2,
        ST_Area(ST_Intersection(o.g2154, p.geom_2154))::double precision AS intersection_area_m2
      FROM osm_src o
      INNER JOIN parcels p
        ON o.g4326 && p.geom
       AND ST_Intersects(o.g4326, p.geom)
      LEFT JOIN best_osm_bdnb m
        ON m.osm_type = o.osm_type
       AND m.osm_id = o.osm_id
      LEFT JOIN best_osm_landuse z
        ON z.osm_type = o.osm_type
       AND z.osm_id = o.osm_id
    )
    SELECT
      osm_type,
      osm_id,
      code_insee,
      section,
      numero_norm,
      batiment_construction_id,
      batiment_groupe_id,
      annee_construction,
      osm_bdnb_intersection_area_m2,
      footprint_m2,
      osm_address_text,
      landuse_value,
      landuse_intersection_area_m2,
      osm_tag_building_use,
      osm_tag_building,
      intersection_area_m2
    FROM pairs
    WHERE intersection_area_m2 >= %s
    ORDER BY osm_type, osm_id, code_insee, section, numero_norm
    """
    cur.execute(
        sql,
        (
            code_insee,
            code_insee,
            int(osm_test_limit) if int(osm_test_limit) > 0 else 2147483647,
            code_insee,
            min_parcel_intersection_area_m2,
        ),
    )
    rows = _fetch_all_dicts_chunked(cur)
    for row in rows:
        ia = safe_float(row.get("osm_bdnb_intersection_area_m2"))
        status = osm_bdnb_match_status(ia, min_osm_bdnb_intersection_area_m2)
        row["osm_match_status"] = status
        if status != "matched":
            row["batiment_construction_id"] = None
            row["batiment_groupe_id"] = None
            row["annee_construction"] = None
        zt, zs = derive_zone_tag(
            row.get("landuse_value"),
            row.get("osm_tag_building_use"),
            row.get("osm_tag_building"),
        )
        row["zone_tag"] = zt
        row["zone_source"] = zs
    return rows


def fetch_parcel_geometries(cur, code_insee: str) -> dict[tuple[str, str, str], str]:
    """(code_insee, section, numero_norm) -> GeoJSON string (4326)."""
    cur.execute(
        """
        SELECT code_insee, section, numero_norm, ST_AsGeoJSON(geom)::text
        FROM public.cadastre_france_feuilles_geom
        WHERE code_insee = %s
          AND numero_norm IS NOT NULL
          AND TRIM(numero_norm) <> ''
        """,
        (code_insee,),
    )
    out: dict[tuple[str, str, str], str] = {}
    for cinsee, section, numero, gj in cur.fetchall():
        out[(str(cinsee), str(section or ""), str(numero or ""))] = str(gj)
    return out


def fetch_construction_geometries(cur, construction_ids: list[str], constructions_qualified: str) -> dict[str, str]:
    if not construction_ids:
        return {}
    cur.execute(
        f"""
        SELECT batiment_construction_id::text AS batiment_construction_id,
               ST_AsGeoJSON(ST_Transform(geom_cstr, 4326))::text AS geometry
        FROM {constructions_qualified}
        WHERE batiment_construction_id = ANY(%s::text[])
        """,
        (construction_ids,),
    )
    out: dict[str, str] = {}
    for row in cur.fetchall():
        if isinstance(row, dict):
            a = row["batiment_construction_id"]
            b = row["geometry"]
        else:
            a, b = row
        out[str(a)] = str(b)
    return out


def fetch_construction_payloads(cur, construction_ids: list[str], constructions_qualified: str) -> dict[str, dict[str, Any]]:
    if not construction_ids:
        return {}
    cur.execute(
        f"""
        SELECT
          bc.batiment_construction_id::text AS batiment_construction_id,
          bc.batiment_groupe_id::text AS batiment_groupe_id,
          ST_Area(bc.geom_cstr)::double precision AS footprint_m2,
          ST_AsGeoJSON(ST_Transform(bc.geom_cstr, 4326))::text AS geometry
        FROM {constructions_qualified} bc
        WHERE bc.geom_cstr IS NOT NULL
          AND bc.batiment_construction_id = ANY(%s::text[])
        """,
        (construction_ids,),
    )
    out: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        if isinstance(row, dict):
            bid = row["batiment_construction_id"]
            gid = row["batiment_groupe_id"]
            footprint_m2 = row["footprint_m2"]
            geometry = row["geometry"]
        else:
            bid, gid, footprint_m2, geometry = row
        out[str(bid)] = {
            "batiment_construction_id": str(bid),
            "batiment_groupe_id": (str(gid).strip() if gid is not None else "") or None,
            "footprint_m2": safe_float(footprint_m2),
            "geometry": str(geometry),
        }
    return out


def _join_address_parts(
    numero_voirie: str | None,
    indice_repetition: str | None,
    nature_voie: str | None,
    nom_voie: str | None,
    nom_commune: str | None,
) -> str:
    parts = [
        str(numero_voirie).strip() if numero_voirie is not None else "",
        str(indice_repetition).strip() if indice_repetition is not None else "",
        str(nature_voie).strip() if nature_voie is not None else "",
        str(nom_voie).strip() if nom_voie is not None else "",
    ]
    line = " ".join(p for p in parts if p)
    commune = str(nom_commune).strip() if nom_commune is not None else ""
    if commune:
        return f"{line}, {commune}" if line else commune
    return line


def load_ppm_by_parcel(cur, code_insee: str) -> dict[tuple[str, str, str], dict[str, Any]]:
    cur.execute(
        """
        SELECT
          code_insee,
          nom_commune,
          section,
          numero_parcelle,
          numero_siren,
          denomination,
          forme_juridique_libelle,
          numero_voirie,
          indice_repetition,
          nature_voie,
          nom_voie
        FROM public.parcelles_personnes_morales
        WHERE code_insee = %s
        """,
        (code_insee,),
    )
    # key -> siren -> agg (siren peut être vide/invalid, on garde l'adresse au niveau parcelle)
    agg: dict[tuple[str, str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    parcel_addr_counts: dict[tuple[str, str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    parcel_addr_parts: dict[tuple[str, str, str], dict[str, dict[str, str]]] = defaultdict(dict)
    for (
        cinsee,
        nom_commune,
        section,
        num_parcelle,
        siren,
        denomination,
        forme_juridique,
        numero_voirie,
        indice_rep,
        nature_voie,
        nom_voie,
    ) in cur.fetchall():
        nn = norm_numero_parcelle(str(num_parcelle) if num_parcelle is not None else "")
        if not nn:
            continue
        key = (str(cinsee), str(section or "").strip(), nn)
        addr = _join_address_parts(numero_voirie, indice_rep, nature_voie, nom_voie, nom_commune)
        if addr:
            parcel_addr_counts[key][addr] += 1
            parcel_addr_parts[key][addr] = {
                "numero_voirie": (str(numero_voirie).strip() if numero_voirie is not None else ""),
                "indice_repetition": (str(indice_rep).strip() if indice_rep is not None else ""),
                "nature_voie": (str(nature_voie).strip() if nature_voie is not None else ""),
                "nom_voie": (str(nom_voie).strip() if nom_voie is not None else ""),
                "nom_commune": (str(nom_commune).strip() if nom_commune is not None else ""),
            }

        s_raw = (str(siren).strip() if siren is not None else "") or ""
        # On ne met dans la liste SIREN que les valeurs valides (9 chiffres)
        if not (len(s_raw) == 9 and s_raw.isdigit()):
            continue
        s = s_raw
        entry = agg[key].get(s)
        if not entry:
            entry = {
                "siren": s,
                "denomination": (str(denomination).strip() if denomination is not None else "") or None,
                "forme_juridique": (str(forme_juridique).strip() if forme_juridique is not None else "") or None,
                "address_counts": defaultdict(int),
                "rows": 0,
            }
            agg[key][s] = entry
        entry["rows"] += 1
        if addr:
            entry["address_counts"][addr] += 1

    out: dict[tuple[str, str, str], dict[str, Any]] = {}
    all_keys = set(parcel_addr_counts.keys()) | set(agg.keys())
    for key in all_keys:
        per_siren = agg.get(key) or {}
        siren_list = sorted(per_siren.keys())
        addresses: list[dict[str, Any]] = []
        for s in siren_list:
            e = per_siren[s]
            best_addr = ""
            if e["address_counts"]:
                best_addr = max(e["address_counts"].items(), key=lambda kv: kv[1])[0]
            addresses.append(
                {
                    "siren": s,
                    "denomination": e.get("denomination"),
                    "forme_juridique": e.get("forme_juridique"),
                    "address": best_addr or None,
                    "rows": e.get("rows") or 0,
                }
            )
        # Adresse passerelle au niveau parcelle : meilleure adresse globale (même sans SIREN)
        passerelle_address = None
        passerelle_address_norm = None
        passerelle_voie_norm = None
        passerelle_commune_norm = None
        passerelle_numero_norm = None
        passerelle_indice_norm = None
        passerelle_numero_match_set: tuple[str, ...] = tuple()
        counts = parcel_addr_counts.get(key) or {}
        if counts:
            passerelle_address = max(counts.items(), key=lambda kv: kv[1])[0]
            parts = (parcel_addr_parts.get(key) or {}).get(passerelle_address) or {}
            addr_norm = normalize_address_parts(
                numero=parts.get("numero_voirie"),
                indice_repetition=parts.get("indice_repetition"),
                type_voie=parts.get("nature_voie"),
                libelle_voie=parts.get("nom_voie"),
                commune=parts.get("nom_commune"),
                code_postal=None,
            )
            passerelle_address_norm = addr_norm.get("address_norm") or None
            passerelle_voie_norm = addr_norm.get("voie_norm") or None
            passerelle_commune_norm = addr_norm.get("commune_norm") or None
            passerelle_numero_norm = addr_norm.get("numero_norm") or None
            passerelle_indice_norm = normalize_indice_for_match(parts.get("indice_repetition")) or None
            nset = street_number_match_set(parts.get("numero_voirie"))
            passerelle_numero_match_set = tuple(sorted(nset)) if nset else tuple()
        out[key] = {
            "sirens": siren_list,
            "passerelle_address": passerelle_address,
            "passerelle_address_norm": passerelle_address_norm,
            "passerelle_voie_norm": passerelle_voie_norm,
            "passerelle_commune_norm": passerelle_commune_norm,
            "passerelle_numero_norm": passerelle_numero_norm,
            "passerelle_indice_norm": passerelle_indice_norm,
            "passerelle_numero_match_set": passerelle_numero_match_set,
            "passerelle_addresses": addresses,
            "siren_rows": {item["siren"]: int(item["rows"] or 0) for item in addresses},
        }
    return out


def load_iris_for_commune(code_insee: str) -> Any:
    import geopandas as gpd

    path = REPO_ROOT / "public" / "geo" / "iris-bordeaux-metropole.geojson"
    if not path.is_file():
        raise FileNotFoundError(f"Fichier IRIS introuvable: {path}")
    gdf = gpd.read_file(path)
    if "code_insee" not in gdf.columns:
        raise ValueError("GeoJSON IRIS sans colonne code_insee")
    sub = gdf[gdf["code_insee"].astype(str) == str(code_insee)].copy()
    if sub.crs is None:
        sub.set_crs(4326, inplace=True)
    else:
        sub = sub.to_crs(4326)
    return sub


def iris_for_point(lon: float, lat: float, iris_gdf: Any) -> tuple[str | None, str | None]:
    import geopandas as gpd
    from shapely.geometry import Point

    pt = gpd.GeoDataFrame([{"geometry": Point(lon, lat)}], geometry="geometry", crs=4326)
    joined = pt.sjoin(iris_gdf, how="left", predicate="within")
    if joined.empty:
        return None, None
    row = joined.iloc[0]
    code = row.get("code_iris")
    nom = row.get("nom_iris")
    if code is None:
        return None, None
    c = str(code).strip()
    if not c or c.lower() == "nan":
        return None, None
    n = ""
    if nom is not None:
        n = str(nom).strip()
        if n.lower() == "nan":
            n = ""
    return (c, n or None)


def parcel_centroid_geojson(geom_geojson_str: str) -> tuple[float, float] | None:
    """Return lon, lat from Polygon/MultiPolygon GeoJSON string."""
    from shapely.geometry import shape

    try:
        g = shape(json.loads(geom_geojson_str))
    except Exception:
        return None
    c = g.centroid
    return (float(c.x), float(c.y))


def is_parc_industriel_iris(nom_iris: str | None) -> bool:
    n = (nom_iris or "").strip()
    if not n or n.lower() == "nan":
        return False
    return n.casefold() == "parc industriel".casefold()


def _select_building_ids_for_parcel(
    pk: tuple[str, str, str],
    bids: set[str] | frozenset[str],
    *,
    multi_parcel_buildings: set[str],
    assigned_multi_by_building: dict[str, tuple[str, str, str]],
    multi_decisions: dict[str, dict[str, Any]],
    by_building: dict[str, list[dict[str, Any]]],
) -> list[str]:
    selected: list[str] = []
    for b in bids:
        if b in multi_parcel_buildings:
            if assigned_multi_by_building.get(b) == pk:
                selected.append(b)
                continue
            if b in multi_decisions:
                appears_on_pk = any(
                    (entry["code_insee"], entry["section"], entry["numero_norm"]) == pk
                    for entry in by_building.get(b, [])
                )
                if appears_on_pk:
                    selected.append(b)
            continue
        selected.append(b)
    return selected


def _parcel_building_details_and_footprint_sum(
    pk: tuple[str, str, str],
    selected: list[str],
    by_building: dict[str, list[dict[str, Any]]],
    multi_parcel_buildings: set[str],
    multi_decisions: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], float]:
    bdetails: list[dict[str, Any]] = []
    for b in sorted(selected):
        for entry in by_building[b]:
            ek = (entry["code_insee"], entry["section"], entry["numero_norm"])
            if ek == pk:
                is_multi = b in multi_parcel_buildings
                decision = multi_decisions.get(b) or {}
                bdetails.append(
                    {
                        "batiment_construction_id": entry.get("batiment_construction_id") or b,
                        "bdnb_batiment_construction_id": entry.get("bdnb_batiment_construction_id"),
                        "batiment_groupe_id": entry.get("batiment_groupe_id"),
                        "annee_construction": entry.get("annee_construction"),
                        "footprint_m2": entry.get("footprint_m2"),
                        "intersection_area_m2": entry.get("intersection_area_m2"),
                        "osm_building_id": entry.get("osm_building_id") or "",
                        "osm_match_status": entry.get("osm_match_status") or "",
                        "osm_bdnb_intersection_area_m2": entry.get("osm_bdnb_intersection_area_m2"),
                        "osm_address_text": entry.get("osm_address_text") or "",
                        "zone_tag": entry.get("zone_tag") or "",
                        "zone_source": entry.get("zone_source") or "",
                        "landuse_intersection_area_m2": entry.get("landuse_intersection_area_m2"),
                        "matching_status": "partage" if is_multi else "mono",
                        "matching_decision": decision.get("matching_decision") if is_multi else "mono",
                        "matching_siren_selected": decision.get("matching_siren_selected") if is_multi else "",
                    }
                )
                break
    footprint_sum = 0.0
    for d in bdetails:
        v = d.get("footprint_m2")
        if v is None:
            continue
        try:
            fv = float(v)
        except Exception:
            continue
        if fv > 0 and fv != float("inf"):
            footprint_sum += fv
    return bdetails, footprint_sum


def compute_parcel_row_context_for_export(
    pk: tuple[str, str, str],
    bids: set[str],
    *,
    by_building: dict[str, list[dict[str, Any]]],
    multi_parcel_buildings: set[str],
    assigned_multi_by_building: dict[str, tuple[str, str, str]],
    multi_decisions: dict[str, dict[str, Any]],
    parcel_geom: dict[tuple[str, str, str], str],
    iris_for_parcel_key: Any,
    min_default: float,
    min_shared_candidate: float,
    shared_candidate_parcels: set[tuple[str, str, str]],
) -> dict[str, Any] | None:
    selected = _select_building_ids_for_parcel(
        pk,
        bids,
        multi_parcel_buildings=multi_parcel_buildings,
        assigned_multi_by_building=assigned_multi_by_building,
        multi_decisions=multi_decisions,
        by_building=by_building,
    )
    if not selected:
        return None
    ci, ni = iris_for_parcel_key(pk)
    bdetails, footprint_sum = _parcel_building_details_and_footprint_sum(
        pk, selected, by_building, multi_parcel_buildings, multi_decisions
    )
    min_required = min_shared_candidate if pk in shared_candidate_parcels else min_default
    if footprint_sum <= min_required:
        return None
    gj = parcel_geom.get(pk, "")
    return {
        "selected": selected,
        "bdetails": bdetails,
        "footprint_sum": footprint_sum,
        "ci": ci,
        "ni": ni,
        "gj": gj,
    }


def parcel_geometries_union_geojson(
    parcel_geom: dict[tuple[str, str, str], str],
    members: list[tuple[str, str, str]],
) -> tuple[str | None, tuple[float, float] | None]:
    """Union WGS84 geometries; returns GeoJSON string and (lon, lat) centroid of union."""
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    geoms = []
    for pk in members:
        s = (parcel_geom.get(pk) or "").strip()
        if not s:
            continue
        try:
            geoms.append(shape(json.loads(s)))
        except Exception:
            continue
    if not geoms:
        return None, None
    try:
        u = unary_union(geoms)
    except Exception:
        return None, None
    if u.is_empty:
        return None, None
    try:
        c = u.centroid
        return json.dumps(mapping(u)), (float(c.x), float(c.y))
    except Exception:
        return None, None


def parcel_pk_to_group_id(
    exported_pks: set[tuple[str, str, str]],
    by_building: dict[str, list[dict[str, Any]]],
) -> dict[tuple[str, str, str], tuple[tuple[str, str, str], ...]]:
    """Connect exported parcels when they share a batiment_construction (transitive closure)."""
    parent: dict[tuple[str, str, str], tuple[str, str, str]] = {}

    def _find(x: tuple[str, str, str]) -> tuple[str, str, str]:
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = _find(parent[x])
        return parent[x]

    def _union(a: tuple[str, str, str], b: tuple[str, str, str]) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[rb] = ra

    for pk in exported_pks:
        parent.setdefault(pk, pk)

    for _bid, plist in by_building.items():
        keys = sorted(
            {(str(p["code_insee"]), str(p["section"] or ""), str(p["numero_norm"] or "")) for p in plist}
        )
        keys_in = [k for k in keys if k in exported_pks]
        if len(keys_in) < 2:
            continue
        for i in range(1, len(keys_in)):
            _union(keys_in[0], keys_in[i])

    roots: dict[tuple[str, str, str], list[tuple[str, str, str]]] = defaultdict(list)
    for pk in exported_pks:
        roots[_find(pk)].append(pk)

    out: dict[tuple[str, str, str], tuple[tuple[str, str, str], ...]] = {}
    for members in roots.values():
        gid = tuple(sorted(members))
        for pk in members:
            out[pk] = gid
    return out


def stable_google_fallback_group_id(gid: tuple[tuple[str, str, str], ...]) -> str:
    raw = json.dumps([list(t) for t in gid], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def count_osm_pois_with_website_in_group(
    members: list[tuple[str, str, str]],
    osm_by_pk: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]],
) -> int:
    seen: set[tuple[str, int]] = set()
    for pk in members:
        pois, _n, _trunc = osm_by_pk.get(pk, ([], 0, 0))
        for poi in pois:
            website = str(poi.get("website") or "").strip()
            if not website:
                continue
            osm_type = str(poi.get("osm_type") or "").strip().lower()[:1]
            try:
                osm_id = int(poi.get("osm_id"))
            except Exception:
                continue
            seen.add((osm_type, osm_id))
    return len(seen)


def precompute_google_group_fallback_cache(
    *,
    google_fb: bool,
    etab_available: bool,
    google_key: str,
    google_radius_m: float,
    exported_pks: set[tuple[str, str, str]],
    parcel_geom: dict[tuple[str, str, str], str],
    nom_iris_by_pk: dict[tuple[str, str, str], str | None],
    ppm_payload: Any,
    voie_index: dict[str, list[tuple[Any, ...]]],
    etab_rows: list[tuple[Any, ...]],
    osm_by_pk: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]],
    google_stats: dict[str, int],
    pk_to_gid: dict[tuple[str, str, str], tuple[tuple[str, str, str], ...]],
    log: Callable[[str], None] | None = None,
) -> dict[tuple[tuple[str, str, str], ...], dict[str, Any]]:
    """
    Un appel Google (Nearby + Details + api.gouv) par composante connexe de parcelles exportées
    reliées par un bâtiment, si au moins une parcelle du groupe est en IRIS Parc Industriel et
    qu'au moins une parcelle du groupe demande le fallback.
    """
    out: dict[tuple[tuple[str, str, str], ...], dict[str, Any]] = {}
    if not google_fb or not etab_available or not (google_key or "").strip():
        return out

    emit = log if log is not None else (lambda _m: None)
    seen_gid: set[tuple[tuple[str, str, str], ...]] = set()
    pending: list[tuple[tuple[tuple[str, str, str], ...], list[tuple[str, str, str]]]] = []
    skipped_by_osm_link = 0

    for pk in sorted(exported_pks):
        gid = pk_to_gid.get(pk)
        if gid is None or gid in seen_gid:
            continue
        seen_gid.add(gid)
        members = list(gid)
        has_pi = any(is_parc_industriel_iris(nom_iris_by_pk.get(m)) for m in members)
        if not has_pi:
            continue
        if count_osm_pois_with_website_in_group(members, osm_by_pk) >= 1:
            skipped_by_osm_link += 1
            continue
        pending.append((gid, members))

    emit(
        f"[v5] Fallback Google (IRIS Parc Industriel) : {len(pending)} groupe(s) éligible(s) "
        f"({skipped_by_osm_link} filtré(s) car POI OSM avec lien)."
    )

    for gi, (gid, members) in enumerate(pending, 1):
        group_id_str = stable_google_fallback_group_id(gid)
        g_union, ll_g = parcel_geometries_union_geojson(parcel_geom, members)
        google_row = empty_google_audit()
        google_row["google_fallback_group_id"] = group_id_str
        google_row["google_fallback_attempted"] = "true"
        google_stats["attempted"] += 1

        if not g_union or not ll_g:
            google_row["google_reject_reason"] = "union_geom_failed"
            out[gid] = {"google_row": google_row, "rematch": None}
            emit(
                f"[v5]   Groupe {gi}/{len(pending)} terminé ({len(members)} parcelle(s), union géom KO) — "
                f"appels cumulés: nearby={google_stats['nearby_calls']} "
                f"details={google_stats['details_calls']} api_gouv={google_stats['api_gouv_calls']}"
            )
            continue

        lon_g, lat_g = ll_g[0], ll_g[1]
        gout = run_google_poi_fallback_for_parcel(
            parcel_geom_geojson=g_union,
            centroid_lat=lat_g,
            centroid_lng=lon_g,
            api_key=google_key,
            radius_m=float(google_radius_m),
        )
        ctr = gout.get("counters") or {}
        google_stats["nearby_calls"] += int(ctr.get("nearby_calls") or 0)
        google_stats["details_calls"] += int(ctr.get("details_calls") or 0)
        google_stats["api_gouv_calls"] += int(ctr.get("api_gouv_calls") or 0)
        tr = gout.get("trace") or {}
        google_row["google_nearby_status"] = str(tr.get("nearby_status") or "")
        google_row["google_nearby_error"] = str(tr.get("nearby_error") or "")
        google_row["google_raw_nearby_count"] = str(tr.get("raw_nearby_count") or 0)
        google_row["google_excluded_outside_parcel"] = str(tr.get("excluded_outside_parcel") or 0)
        google_row["google_nearby_ranked_json"] = str(tr.get("nearby_ranked_json") or "[]")
        google_row["google_winner_place_id"] = str(tr.get("winner_place_id") or "")
        google_row["google_winner_name"] = str(tr.get("winner_name") or "")
        google_row["google_api_gouv_query"] = str(tr.get("api_gouv_query") or "")
        api_list = gout.get("api_etablissements_at_cp") or []
        google_row["google_api_gouv_etablissements_count"] = str(len(api_list))

        formatted_g = gout.get("formatted_address")
        synth_src = (
            (formatted_g.strip() if isinstance(formatted_g, str) else "")
            or str(gout.get("anchor_address") or "").strip()
        )
        rematch: dict[str, Any] | None = None
        if synth_src:
            google_row["google_anchor_address"] = synth_src
            syn = build_synthetic_ppm_from_google_anchor(synth_src)
            rematch = match_etablissements_for_parcel(voie_index, etab_rows, syn)
            if int(rematch.get("siret_count") or 0) > 0:
                google_row["google_fallback_success"] = "true"
                mr = str(rematch.get("matching_reason") or "").strip()
                rematch = {
                    **rematch,
                    "matching_reason": f"google_fallback:{mr}" if mr else "google_fallback:match",
                }
            else:
                rr = str(tr.get("reject_reason") or "").strip()
                google_row["google_reject_reason"] = rr or "local_match_still_empty"
                rematch = None
        else:
            google_row["google_reject_reason"] = str(tr.get("reject_reason") or "") or "no_anchor"

        out[gid] = {"google_row": google_row, "rematch": rematch}
        emit(
            f"[v5]   Groupe {gi}/{len(pending)} terminé ({len(members)} parcelle(s)) — "
            f"appels cumulés: nearby={google_stats['nearby_calls']} "
            f"details={google_stats['details_calls']} api_gouv={google_stats['api_gouv_calls']}"
        )
    return out


def resolve_multi_parcel_buildings(
    by_building: dict[str, list[dict[str, Any]]],
    ppm: dict[tuple[str, str, str], dict[str, Any]],
) -> tuple[dict[str, tuple[str, str, str]], dict[str, dict[str, Any]]]:
    assigned: dict[str, tuple[str, str, str]] = {}
    decisions: dict[str, dict[str, Any]] = {}

    for bid, plist in by_building.items():
        parcel_keys = sorted({(str(p["code_insee"]), str(p["section"]), str(p["numero_norm"])) for p in plist})
        if len(parcel_keys) <= 1:
            continue

        per_parcel_sirens: dict[tuple[str, str, str], set[str]] = {}
        for pk in parcel_keys:
            per_parcel_sirens[pk] = set(ppm.get(pk, {}).get("sirens") or [])
        shared_sirens = set.intersection(*(s for s in per_parcel_sirens.values())) if per_parcel_sirens else set()

        intersection_by_parcel: dict[tuple[str, str, str], float] = defaultdict(float)
        for p in plist:
            pk = (str(p["code_insee"]), str(p["section"]), str(p["numero_norm"]))
            ia = safe_float(p.get("intersection_area_m2")) or 0.0
            if ia > intersection_by_parcel[pk]:
                intersection_by_parcel[pk] = ia

        selected_siren = ""
        decision = "unique_by_intersection"
        reason = "Aucun SIREN commun; affectation unique par plus grande surface d'intersection."
        winner = max(
            intersection_by_parcel.items(),
            key=lambda kv: (
                kv[1],
                kv[0][0],
                kv[0][1],
                kv[0][2],
            ),
        )[0]

        if shared_sirens:
            decision = "shared_siren"
            best_siren = ""
            best_rows = -1
            for s in sorted(shared_sirens):
                rows_sum = 0
                for pk in parcel_keys:
                    rows_sum += int(ppm.get(pk, {}).get("siren_rows", {}).get(s, 0))
                if rows_sum > best_rows:
                    best_rows = rows_sum
                    best_siren = s
            selected_siren = best_siren
            candidates = [pk for pk in parcel_keys if selected_siren in per_parcel_sirens.get(pk, set())]
            winner = max(
                candidates,
                key=lambda pk: (
                    intersection_by_parcel.get(pk, 0.0),
                    pk[0],
                    pk[1],
                    pk[2],
                ),
            )
            reason = "SIREN commun détecté; choix du SIREN avec le plus de lignes PPM, puis parcelle gagnante par intersection."

        assigned[bid] = winner
        decisions[bid] = {
            "matching_status": "partage",
            "matching_decision": decision,
            "matching_siren_selected": selected_siren,
            "winner_parcelle": {
                "code_insee": winner[0],
                "section": winner[1],
                "numero_norm": winner[2],
            },
            "shared_sirens": sorted(shared_sirens),
            "intersection_area_m2_by_parcelle": [
                {
                    "code_insee": pk[0],
                    "section": pk[1],
                    "numero_norm": pk[2],
                    "intersection_area_m2": intersection_by_parcel.get(pk, 0.0),
                }
                for pk in parcel_keys
            ],
            "reason": reason,
        }
    return assigned, decisions


def _passerelle_numero_set(info: dict[str, Any]) -> frozenset[str]:
    t = info.get("passerelle_numero_match_set")
    if isinstance(t, (tuple, list)) and t:
        return frozenset(str(x).strip() for x in t if str(x).strip())
    n = str(info.get("passerelle_numero_norm") or "").strip()
    return frozenset([n]) if n else frozenset()


def _numero_match_tier(nums_query: frozenset[str], numero_db: str) -> str:
    if not nums_query:
        return "numero_absent_source"
    if not numero_db:
        return "numero_absent_etab"
    if numero_db in nums_query:
        return "numero_match"
    nd = numero_db.lstrip("0") or "0"
    for n in nums_query:
        if (str(n).lstrip("0") or "0") == nd:
            return "numero_leading_zeros"
    for n in nums_query:
        if fuzz.ratio(numero_db, str(n)) >= 88:
            return "numero_fuzzy"
    return "numero_mismatch"


def _score_etablissement_candidate(
    *,
    nums_query: frozenset[str],
    indice_query: str,
    voie_query: str,
    commune_query: str,
    cp_query: str,
    numero_db: str,
    indice_db: str,
    voie_db: str,
    commune_db: str,
    cp_db: str,
) -> tuple[float, str]:
    """Score 0–100 avec fuzzy voie (WRatio) et numéro tolérant (zéros, ratio) ; pas de rejet dur."""
    score = 0.0
    reasons: list[str] = []

    if voie_query and voie_db:
        if voie_query == voie_db:
            score += 40.0
            reasons.append("voie_exacte")
        elif voie_query in voie_db or voie_db in voie_query:
            score += 28.0
            reasons.append("voie_partielle")
        else:
            wr = float(fuzz.WRatio(voie_query, voie_db))
            if wr >= 76.0:
                pts = 16.0 + (wr - 76.0) * 0.38
                score += min(30.0, pts)
                reasons.append(f"voie_fuzzy_{int(wr)}")

    if nums_query:
        tier = _numero_match_tier(nums_query, numero_db)
        if tier == "numero_match":
            score += 32.0
            reasons.append("numero_match")
        elif tier == "numero_leading_zeros":
            score += 28.0
            reasons.append("numero_leading_zeros")
        elif tier == "numero_fuzzy":
            score += 26.0
            reasons.append("numero_fuzzy")
        elif tier == "numero_mismatch":
            score -= 12.0
            reasons.append("numero_mismatch")

    if indice_query and indice_db:
        if indice_query == indice_db:
            score += 5.0
            reasons.append("indice_match")
        else:
            score -= 8.0
            reasons.append("indice_mismatch")

    if commune_query and commune_db and commune_query == commune_db:
        score += 14.0
        reasons.append("commune_exacte")

    if cp_query and cp_db and cp_query == cp_db:
        score += 4.0
        reasons.append("cp_exact")

    score = max(0.0, min(100.0, score))
    return score, ", ".join(reasons)


def _etab_match_cache_key(code_insee: str, info: dict[str, Any]) -> tuple[Any, ...]:
    """Clé stable pour dédupliquer les requêtes SQL (même adresse passerelle → même match)."""
    passerelle_address = str(info.get("passerelle_address") or "").strip()
    if not passerelle_address:
        return ("no_address",)
    addr_norm = normalize_address_parts(
        numero=passerelle_address,
        indice_repetition="",
        type_voie="",
        libelle_voie=passerelle_address,
        commune="",
        code_postal=passerelle_address,
    )
    nums_t = info.get("passerelle_numero_match_set")
    if isinstance(nums_t, (tuple, list)) and nums_t:
        nums_key: tuple[str, ...] = tuple(sorted(str(x).strip() for x in nums_t if str(x).strip()))
    else:
        n = str(info.get("passerelle_numero_norm") or addr_norm.get("numero_norm") or "").strip()
        nums_key = (n,) if n else tuple()
    indice_k = str(info.get("passerelle_indice_norm") or "").strip()
    voie_q = str(info.get("passerelle_voie_norm") or addr_norm.get("voie_norm") or "").strip()
    commune_q = str(info.get("passerelle_commune_norm") or addr_norm.get("commune_norm") or "").strip()
    cp_q = str(addr_norm.get("code_postal_norm") or "").strip()
    if not voie_q:
        return ("no_address_tokens", nums_key, indice_k, voie_q, commune_q, cp_q)
    return ("query", code_insee, nums_key, indice_k, voie_q, commune_q, cp_q)


def _format_etablissement_adresse(
    numero_voie: str | None,
    indice_repetition: str | None,
    type_voie: str | None,
    libelle_voie: str | None,
    code_postal: str | None,
    commune: str | None,
) -> str:
    parts = [
        str(numero_voie or "").strip(),
        str(indice_repetition or "").strip(),
        str(type_voie or "").strip(),
        str(libelle_voie or "").strip(),
    ]
    line = " ".join(p for p in parts if p)
    tail = " ".join(p for p in [str(code_postal or "").strip(), str(commune or "").strip()] if p)
    if line and tail:
        return f"{line}, {tail}"
    return line or tail or ""


# Ordre des colonnes dans fetch_etablissements_for_commune (stable pour indexation).
_I_ETAB_SIRET = 0
_I_ETAB_SIREN = 1
_I_ETAB_DENOM = 2
_I_ETAB_NUM_VOIE = 3
_I_ETAB_IND_REP = 4
_I_ETAB_TYPE_VOIE = 5
_I_ETAB_LIB_VOIE = 6
_I_ETAB_CP = 7
_I_ETAB_COMMUNE = 8
_I_ETAB_NUM_NORM = 9
_I_ETAB_VOIE_NORM = 10
_I_ETAB_COMMUNE_NORM = 11
_I_ETAB_TRANCHE = 12
_I_ETAB_ANNEE_EFF = 13
_I_ETAB_APE = 14
_I_ETAB_ETAT = 15


def fetch_etablissements_for_commune(cur, table_qualified: str, code_insee: str) -> list[tuple[Any, ...]]:
    """Charge une seule fois les établissements actifs de la commune (matching adresse en mémoire)."""
    cur.execute(
        f"""
      SELECT
        siret, siren, denomination,
        numero_voie, indice_repetition, type_voie, libelle_voie, code_postal, commune,
        numero_norm, voie_norm, commune_norm,
        tranche_effectifs, annee_effectifs, activite_principale,
        etat_administratif
      FROM {table_qualified}
      WHERE code_commune_insee = %s
        AND voie_norm IS NOT NULL
        AND TRIM(voie_norm) <> ''
        AND (etat_administratif IS NULL OR TRIM(etat_administratif) = '' OR UPPER(etat_administratif) = 'A')
    """,
        (code_insee,),
    )
    return list(cur.fetchall())


def build_voie_norm_index(etab_rows: list[tuple[Any, ...]]) -> dict[str, list[tuple[Any, ...]]]:
    ix: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for r in etab_rows:
        v = str(r[_I_ETAB_VOIE_NORM] or "").strip()
        if v:
            ix[v].append(r)
    return ix


def _collect_etab_candidates(
    voie_index: dict[str, list[tuple[Any, ...]]],
    etab_rows: list[tuple[Any, ...]],
    voie_q: str,
) -> list[tuple[Any, ...]]:
    cand = voie_index.get(voie_q, [])
    if cand:
        return cand[:150]
    out: list[tuple[Any, ...]] = []
    for r in etab_rows:
        vd = str(r[_I_ETAB_VOIE_NORM] or "").strip()
        if not vd:
            continue
        if voie_q in vd or vd in voie_q:
            out.append(r)
            if len(out) >= 150:
                break
    return out


def _merge_etab_candidates_fuzzy(
    voie_index: dict[str, list[tuple[Any, ...]]],
    etab_rows: list[tuple[Any, ...]],
    voie_q: str,
    *,
    max_total: int = 220,
) -> list[tuple[Any, ...]]:
    """Candidats voie exacte / sous-chaîne, puis voies proches (WRatio >= 80 sur les libellés de la commune)."""
    seen: set[str] = set()
    out: list[tuple[Any, ...]] = []

    def _append_rows(rows: list[tuple[Any, ...]]) -> None:
        for r in rows:
            k = str(r[_I_ETAB_SIRET] or "").strip()
            if not k or k in seen:
                continue
            seen.add(k)
            out.append(r)
            if len(out) >= max_total:
                return

    _append_rows(_collect_etab_candidates(voie_index, etab_rows, voie_q))
    if len(out) < 50 and voie_q:
        keys = [k for k in voie_index.keys() if k]
        if keys:
            for m, _sc, _idx in process.extract(
                voie_q,
                keys,
                scorer=fuzz.WRatio,
                limit=40,
                score_cutoff=80.0,
            ):
                _append_rows(voie_index.get(m, []))
                if len(out) >= max_total:
                    break
    return out


def match_etablissements_for_parcel(
    voie_index: dict[str, list[tuple[Any, ...]]],
    etab_rows: list[tuple[Any, ...]],
    info: dict[str, Any],
) -> dict[str, Any]:
    passerelle_address = str(info.get("passerelle_address") or "").strip()
    if not passerelle_address:
        return {
            "status_technique": "no_address",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "Aucune adresse passerelle.",
        }

    addr_norm = normalize_address_parts(
        numero=passerelle_address,
        indice_repetition="",
        type_voie="",
        libelle_voie=passerelle_address,
        commune="",
        code_postal=passerelle_address,
    )
    nums_q = _passerelle_numero_set(info)
    indice_q = str(info.get("passerelle_indice_norm") or "").strip()
    voie_q = str(info.get("passerelle_voie_norm") or addr_norm.get("voie_norm") or "").strip()
    commune_q = str(info.get("passerelle_commune_norm") or addr_norm.get("commune_norm") or "").strip()
    cp_q = str(addr_norm.get("code_postal_norm") or "").strip()
    if not voie_q:
        return {
            "status_technique": "no_address_tokens",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "Adresse passerelle non exploitable.",
        }

    if not nums_q:
        return {
            "status_technique": "no_passerelle_numero",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "Pas de numéro de voirie côté passerelle : matching SIRENE désactivé.",
        }

    rows = _merge_etab_candidates_fuzzy(voie_index, etab_rows, voie_q)
    rows = [r for r in rows if str(r[_I_ETAB_NUM_NORM] or "").strip()]
    if not rows:
        return {
            "status_technique": "no_candidate",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "Aucun établissement actif avec numéro de voirie sur cette voie.",
        }

    min_score = 52.0

    by_siret: dict[str, dict[str, Any]] = {}
    for r in rows:
        siret = r[_I_ETAB_SIRET]
        siren = r[_I_ETAB_SIREN]
        denomination = r[_I_ETAB_DENOM]
        numero_db = str(r[_I_ETAB_NUM_NORM] or "").strip()
        indice_db = normalize_indice_for_match(str(r[_I_ETAB_IND_REP] or ""))
        voie_db = str(r[_I_ETAB_VOIE_NORM] or "").strip()
        commune_db = str(r[_I_ETAB_COMMUNE_NORM] or "").strip()
        cp_db = str(r[_I_ETAB_CP] or "").strip()
        score, reason = _score_etablissement_candidate(
            nums_query=nums_q,
            indice_query=indice_q,
            voie_query=voie_q,
            commune_query=commune_q,
            cp_query=cp_q,
            numero_db=numero_db,
            indice_db=indice_db,
            voie_db=voie_db,
            commune_db=commune_db,
            cp_db=cp_db,
        )
        if score < min_score:
            continue
        addr_ligne = _format_etablissement_adresse(
            str(r[_I_ETAB_NUM_VOIE] or ""),
            str(r[_I_ETAB_IND_REP] or ""),
            str(r[_I_ETAB_TYPE_VOIE] or ""),
            str(r[_I_ETAB_LIB_VOIE] or ""),
            str(r[_I_ETAB_CP] or ""),
            str(r[_I_ETAB_COMMUNE] or ""),
        )
        tranche = str(r[_I_ETAB_TRANCHE] or "").strip()
        annee_eff = str(r[_I_ETAB_ANNEE_EFF] or "").strip()
        ape = str(r[_I_ETAB_APE] or "").strip()
        st_key = str(siret or "").strip()
        if not st_key:
            continue
        entry = {
            "siret": st_key,
            "siren": str(siren or "").strip(),
            "denomination": str(denomination or "").strip() or None,
            "adresse_etablissement": addr_ligne or None,
            "tranche_effectifs": tranche or None,
            "annee_effectifs": annee_eff or None,
            "activite_principale": ape or None,
            "score": score,
            "reason": reason,
        }
        prev = by_siret.get(st_key)
        if prev is None or float(score) > float(prev.get("score") or 0.0):
            by_siret[st_key] = entry
    kept = sorted(by_siret.values(), key=lambda x: (-float(x.get("score") or 0.0), str(x.get("siret") or "")))
    if not kept:
        return {
            "status_technique": "low_confidence",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "Candidats trouvés mais score insuffisant.",
        }

    sirets = sorted({str(x["siret"]) for x in kept if str(x.get("siret") or "").strip()})
    sirens = sorted({str(x["siren"]) for x in kept if str(x.get("siren") or "").strip()})
    status_metier = "none"
    if len(sirets) == 1:
        status_metier = "single"
    elif len(sirets) > 1:
        status_metier = "shared"
    status_technique = "matched" if status_metier != "none" else "no_candidate"
    confidence = max(float(kept[0].get("score") or 0.0), 0.0)
    reason = str(kept[0].get("reason") or "").strip() or "match"
    return {
        "status_technique": status_technique,
        "status_metier": status_metier,
        "siret_count": len(sirets),
        "sirets_json": json.dumps(kept, ensure_ascii=False),
        "sirens_json": json.dumps(sirens, ensure_ascii=False),
        "matching_confidence": confidence,
        "matching_reason": reason,
    }


def qualified_scout_matching_v5_table() -> str:
    raw = os.environ.get("SCOUT_MATCHING_V5_TABLE", "public.scout_matching_v5_features")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="scout_matching_v5_features",
        label="SCOUT_MATCHING_V5_TABLE",
    )
    validate_ident(schema, "Schéma scout_matching_v5")
    validate_ident(table, "Table scout_matching_v5")
    return f'"{schema}"."{table}"'


def ensure_matching_runtime_indexes(
    cur: Any,
    *,
    constructions_qualified: str,
    ffo_qualified: str,
    osm_buildings_qualified: str,
    osm_landuse_qualified: str | None = None,
) -> None:
    # Index durcissement "best effort": IF NOT EXISTS pour éviter les locks inutiles.
    stmts = [
        "CREATE INDEX IF NOT EXISTS cadastre_feuilles_geom_gix ON public.cadastre_france_feuilles_geom USING GIST (geom)",
        "CREATE INDEX IF NOT EXISTS cadastre_feuilles_insee_section_num_idx ON public.cadastre_france_feuilles_geom (code_insee, section, numero_norm)",
        f"CREATE INDEX IF NOT EXISTS osm_buildings_geom_gix ON {osm_buildings_qualified} USING GIST (geom)",
        f"CREATE INDEX IF NOT EXISTS osm_buildings_code_insee_idx ON {osm_buildings_qualified} (code_insee)",
        f"CREATE INDEX IF NOT EXISTS bdnb_geom_cstr_gix ON {constructions_qualified} USING GIST (geom_cstr)",
        f"CREATE INDEX IF NOT EXISTS bdnb_code_commune_idx ON {constructions_qualified} (code_commune_insee)",
        f"CREATE INDEX IF NOT EXISTS bdnb_groupe_id_idx ON {constructions_qualified} (batiment_groupe_id)",
        f"CREATE INDEX IF NOT EXISTS ffo_batiment_groupe_id_idx ON {ffo_qualified} (batiment_groupe_id)",
    ]
    if osm_landuse_qualified:
        stmts.append(
            f"CREATE INDEX IF NOT EXISTS osm_landuse_geom_gix ON {osm_landuse_qualified} USING GIST (geom)"
        )
    for stmt in stmts:
        cur.execute(stmt)


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def write_matching_v5_features_postgres(
    out_rows: list[dict[str, Any]],
    code_insee_filter: str,
    source_run: str,
    v5_log: Callable[[str], None],
) -> None:
    """DELETE par code_insee puis INSERT des lignes export (nécessite table 003_scout_matching_v5_features)."""
    import psycopg2
    import psycopg2.extras

    url = resolve_database_url()
    if not url:
        raise RuntimeError("Aucune URL Postgres pour --write-postgres")
    qualified = qualified_scout_matching_v5_table()
    conn = psycopg2.connect(url)
    n_ok = 0
    n_skip = 0
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                f"""
                ALTER TABLE {qualified}
                ADD COLUMN IF NOT EXISTS building_geometries_json JSONB NOT NULL DEFAULT '[]'::jsonb
                """
            )
            cur.execute(
                f"DELETE FROM {qualified} WHERE code_insee = %s",
                (code_insee_filter,),
            )
            sql = f"""
            INSERT INTO {qualified} (
              scout_v5_id, geom, grain, code_insee, section, numero_norm,
              nb_batiments, footprint_sum_m2, siret_count, status_technique, status_metier,
              matching_confidence, siren_status, building_geometries_json, properties_json, source_run
            ) VALUES (
              %s,
              ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """
            for r in out_rows:
                gj_raw = r.get("geometry_geojson") or ""
                gj = str(gj_raw).strip()
                if not gj:
                    n_skip += 1
                    continue
                try:
                    json.loads(gj)
                except json.JSONDecodeError:
                    n_skip += 1
                    continue
                sid = str(r.get("scout_v5_id") or "").strip()
                if not sid:
                    n_skip += 1
                    continue
                props = {k: v for k, v in r.items() if k != "geometry_geojson"}
                building_geometries_json = props.get("building_geometries_json") or "[]"
                if isinstance(building_geometries_json, str):
                    try:
                        building_geometries_payload = json.loads(building_geometries_json)
                    except json.JSONDecodeError:
                        building_geometries_payload = []
                else:
                    building_geometries_payload = building_geometries_json
                row_insee = str(r.get("code_insee") or code_insee_filter).strip() or code_insee_filter
                grain = str(r.get("grain") or "parcelle")
                sec = str(r.get("section") or "")
                num = str(r.get("numero_norm") or "")
                cur.execute(
                    sql,
                    (
                        sid,
                        gj,
                        grain,
                        row_insee,
                        sec,
                        num,
                        _safe_int(r.get("nb_batiments")),
                        _safe_float(r.get("footprint_sum_m2")),
                        _safe_int(r.get("siret_count")),
                        str(r.get("status_technique") or ""),
                        str(r.get("status_metier") or ""),
                        _safe_float(r.get("matching_confidence")),
                        str(r.get("siren_status") or ""),
                        psycopg2.extras.Json(building_geometries_payload),
                        psycopg2.extras.Json(props),
                        source_run or None,
                    ),
                )
                n_ok += 1
        conn.commit()
        v5_log(
            f"[v5] Postgres {qualified}: DELETE code_insee={code_insee_filter!r}, "
            f"INSERT {n_ok} ligne(s), ignoré {n_skip}"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Matching V5 discovery (Pessac / commune INSEE).")
    ap.add_argument("--code-insee", default="33318", help="Code INSEE commune (défaut: 33318 Pessac)")
    ap.add_argument(
        "--min-parcelle-footprint-sum-m2",
        type=float,
        default=400.0,
        help="Ne garder que les parcelles (passerelle) dont la somme des footprints des bâtiments dépasse ce seuil.",
    )
    ap.add_argument(
        "--include-building-grain",
        action="store_true",
        help="Inclure aussi les lignes grain=building (bâtiments multi-parcelles). Défaut: non (passerelle uniquement).",
    )
    ap.add_argument(
        "--out-csv",
        type=Path,
        default=REPO_ROOT / "data-pipeline/out/matching/v5/matching_v5.csv",
    )
    ap.add_argument(
        "--out-geojson",
        type=Path,
        default=REPO_ROOT / "public/geo/matching-v5-33318.geojson",
        help="Défaut: public/geo/… pour affichage Solar Scout (/geo/…)",
    )
    ap.add_argument("--no-geojson", action="store_true")
    ap.add_argument(
        "--write-postgres",
        action="store_true",
        help="Après export CSV/GeoJSON: DELETE code_insee dans SCOUT_MATCHING_V5_TABLE puis INSERT (voir sql/003_scout_matching_v5_features.sql).",
    )
    ap.add_argument(
        "--postgres-source-run",
        default="",
        help="Valeur colonne source_run (défaut: matching_v5:<code_insee>).",
    )
    ap.add_argument(
        "--google-fallback",
        action="store_true",
        help="Si pas de SIRET après matching passerelle : Nearby + Place Details + api.gouv puis re-match local, "
        "une fois par groupe de parcelles exportées reliées par un bâtiment si au moins une parcelle est en IRIS Parc Industriel.",
    )
    ap.add_argument(
        "--google-api-key",
        default=os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") or "",
        help="Clé Google Places (sinon GOOGLE_MAPS_API_KEY / NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).",
    )
    ap.add_argument(
        "--google-radius-m",
        type=float,
        default=100.0,
        help="Rayon Nearby Search en mètres (max 500).",
    )
    ap.add_argument(
        "--no-osm-poi",
        action="store_true",
        help="Désactive la jointure OSM POI et l'export des colonnes associées.",
    )
    ap.add_argument(
        "--building-source",
        choices=("bdnb", "osm"),
        default="bdnb",
        help="Source géométrique bâtiment : bdnb (défaut) ou osm (footprints OSM + enrichissement BNDB).",
    )
    ap.add_argument(
        "--osm-parcel-intersection-min-m2",
        type=float,
        default=50.0,
        help="Seuil m² d'intersection OSM footprint ↔ parcelle pour retenir la paire.",
    )
    ap.add_argument(
        "--osm-bdnb-match-min-m2",
        type=float,
        default=20.0,
        help="Seuil m² d'intersection OSM footprint ↔ BNDB pour valider l'enrichissement BNDB.",
    )
    ap.add_argument(
        "--osm-test-limit",
        type=int,
        default=0,
        help="Limite le nombre de footprints OSM traités (0 = pas de limite). Utile pour test rapide.",
    )
    ap.add_argument(
        "--quiet",
        action="store_true",
        help="Désactive les messages de progression (stderr).",
    )
    ap.add_argument(
        "--progress-every",
        type=int,
        default=250,
        help="Afficher l'avancement des parcelles / PPM tous les N enregistrements (0 = jalons uniquement).",
    )
    ap.add_argument(
        "--ensure-runtime-indexes",
        action="store_true",
        help="Crée/valide les index critiques du run de matching avant exécution.",
    )
    ap.add_argument(
        "--light-export",
        action="store_true",
        help="Export allégé: désactive le payload building_geometries_json pour accélérer le run.",
    )
    ap.add_argument(
        "--profile-json",
        type=Path,
        default=None,
        help="Chemin optionnel pour écrire un JSON de profiling (durées et métriques).",
    )
    args = ap.parse_args()

    def v5_log(msg: str) -> None:
        if not args.quiet:
            print(msg, file=sys.stderr, flush=True)

    url = resolve_database_url()
    if not url:
        print("Aucune URL Postgres (voir DATABASE_URL, LOCAL_DATABASE_URL, …)", file=sys.stderr)
        return 1

    google_key = str(args.google_api_key or "").strip()
    google_fb = bool(args.google_fallback) and bool(google_key)
    if bool(args.google_fallback) and not google_key:
        print(
            "[v5] Avertissement: --google-fallback sans clé (GOOGLE_MAPS_API_KEY), fallback désactivé.",
            file=sys.stderr,
        )

    code_insee = str(args.code_insee).strip()
    constructions_q, bdnb_schema = qualified_bdnb_constructions_table()
    ffo_q = qualified_bdnb_ffo_table(bdnb_schema)
    etab_q = qualified_etablissements_table()
    profiler = PhaseProfiler(enabled=bool(args.profile_json))
    v5_log(
        f"[v5] Source bâtiment: {args.building_source}"
        + (
            f" (matching OSM→BDNB actif, seuil OSM↔parcelle {float(args.osm_parcel_intersection_min_m2):.1f} m², "
            f"test_limit={int(args.osm_test_limit) if int(args.osm_test_limit) > 0 else 'none'})"
            if args.building_source == "osm"
            else ""
        )
    )

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        print("psycopg2-binary requis: pip install -r data-pipeline/python/requirements.txt", file=sys.stderr)
        return 1

    args.out_csv.parent.mkdir(parents=True, exist_ok=True)
    if not args.no_geojson:
        args.out_geojson.parent.mkdir(parents=True, exist_ok=True)

    with profiler.phase("load_iris"):
        iris_gdf = load_iris_for_commune(code_insee)
    v5_log(f"[v5] Commune INSEE {code_insee} — IRIS chargé ({len(iris_gdf)} polygones filtrés).")
    profiler.set_metric("iris_polygons", len(iris_gdf))

    etab_rows: list[tuple[Any, ...]] = []
    voie_index: dict[str, list[tuple[Any, ...]]] = {}

    conn = psycopg2.connect(url)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            pairs: list[dict[str, Any]] = []
            if args.ensure_runtime_indexes:
                with profiler.phase("ensure_runtime_indexes"):
                    ensure_matching_runtime_indexes(
                        cur,
                        constructions_qualified=constructions_q,
                        ffo_qualified=ffo_q,
                        osm_buildings_qualified=qualified_osm_buildings_table(),
                        osm_landuse_qualified=(
                            qualified_osm_landuse_table() if args.building_source == "osm" else None
                        ),
                    )
            if args.building_source == "osm":
                osm_q = qualified_osm_buildings_table()
                lu_q = qualified_osm_landuse_table()
                cur.execute("SELECT to_regclass(%s) IS NOT NULL", (osm_buildings_regclass(),))
                row = cur.fetchone()
                if not row or not row[0]:
                    raise RuntimeError(
                        "Table OSM footprints absente. Lancez d'abord import_osm_buildings.py --ensure-schema --input ... "
                        "(ou repassez --building-source bdnb)."
                    )
                cur.execute("SELECT to_regclass(%s) IS NOT NULL", (osm_landuse_regclass(),))
                row_lu = cur.fetchone()
                if not row_lu or not row_lu[0]:
                    raise RuntimeError(
                        "Table OSM landuse absente. Lancez import_osm_landuse.py --ensure-schema "
                        "(la table peut être vide ; le schéma doit exister)."
                    )
                with profiler.phase("fetch_osm_pairs"):
                    pairs = fetch_osm_building_parcel_pairs(
                        cur,
                        code_insee=code_insee,
                        constructions_qualified=constructions_q,
                        ffo_qualified=ffo_q,
                        osm_buildings_qualified=osm_q,
                        osm_landuse_qualified=lu_q,
                        min_parcel_intersection_area_m2=float(args.osm_parcel_intersection_min_m2),
                        min_osm_bdnb_intersection_area_m2=float(args.osm_bdnb_match_min_m2),
                        osm_test_limit=int(args.osm_test_limit),
                    )
            else:
                with profiler.phase("fetch_bdnb_pairs"):
                    pairs = fetch_building_parcel_pairs(cur, code_insee, constructions_q, ffo_q)
            with profiler.phase("fetch_parcel_geometries"):
                parcel_geom = fetch_parcel_geometries(cur, code_insee)
            ppm: dict[tuple[str, str, str], dict[str, Any]] = {}
            etab_available = False
            etab_match_by_parcel: dict[tuple[str, str, str], dict[str, Any]] = {}
            with profiler.phase("load_ppm"):
                ppm = load_ppm_by_parcel(cur, code_insee)
            try:
                cur.execute(f"SELECT 1 FROM {etab_q} LIMIT 1")
                etab_available = True
            except Exception:
                etab_available = False

            if etab_available:
                with profiler.phase("fetch_etablissements"):
                    etab_rows = fetch_etablissements_for_commune(cur, etab_q, code_insee)
                    voie_index = build_voie_norm_index(etab_rows)
                etab_match_cache: dict[tuple[Any, ...], dict[str, Any]] = {}
                ppm_list = list(ppm.items())
                n_ppm = len(ppm_list)
                v5_log(f"[v5] Matching établissements (passerelle PPM) : {n_ppm} parcelle(s) avec lignes PPM.")
                with profiler.phase("match_etablissements"):
                    for j, (pk, info) in enumerate(ppm_list, 1):
                        ck = _etab_match_cache_key(code_insee, info)
                        if ck not in etab_match_cache:
                            etab_match_cache[ck] = match_etablissements_for_parcel(voie_index, etab_rows, info)
                        etab_match_by_parcel[pk] = etab_match_cache[ck]
                        if args.progress_every > 0 and j % args.progress_every == 0:
                            v5_log(f"[v5]   PPM → SIRENE : {j}/{n_ppm}")
            else:
                for pk in ppm.keys():
                    etab_match_by_parcel[pk] = {
                        "status_technique": "source_missing",
                        "status_metier": "none",
                        "siret_count": 0,
                        "sirets_json": "[]",
                        "sirens_json": "[]",
                        "matching_confidence": 0.0,
                        "matching_reason": "Table établissements absente.",
                    }
    finally:
        conn.close()

    google_stats = {
        "attempted": 0,
        "success": 0,
        "nearby_calls": 0,
        "details_calls": 0,
        "api_gouv_calls": 0,
    }

    by_building: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_parcel: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for row in pairs:
        if args.building_source == "osm":
            bid = format_osm_building_id(str(row.get("osm_type") or "w"), int(row.get("osm_id") or 0))
        else:
            bid = str(row["batiment_construction_id"])
        gid = str(row.get("batiment_groupe_id") or "")
        key = (str(row["code_insee"]), str(row["section"] or ""), str(row["numero_norm"] or ""))
        by_building[bid].append(
            {
                "code_insee": key[0],
                "section": key[1],
                "numero_norm": key[2],
                "batiment_groupe_id": gid or None,
                "batiment_construction_id": (
                    bid if args.building_source == "osm" else str(row.get("batiment_construction_id") or "").strip() or None
                ),
                "bdnb_batiment_construction_id": str(row.get("batiment_construction_id") or "").strip() or None,
                "annee_construction": row.get("annee_construction"),
                "footprint_m2": safe_float(row.get("footprint_m2")),
                "intersection_area_m2": safe_float(row.get("intersection_area_m2")),
                "osm_building_id": bid if args.building_source == "osm" else "",
                "osm_match_status": str(row.get("osm_match_status") or ""),
                "osm_bdnb_intersection_area_m2": safe_float(row.get("osm_bdnb_intersection_area_m2")),
                "osm_address_text": str(row.get("osm_address_text") or "").strip(),
                "zone_tag": str(row.get("zone_tag") or ""),
                "zone_source": str(row.get("zone_source") or ""),
                "landuse_intersection_area_m2": safe_float(row.get("landuse_intersection_area_m2")),
                "osm_name": "",
                "osm_website": "",
                "osm_phone": "",
                "osm_poi_primary_key": "",
                "osm_poi_primary_value": "",
                "osm_poi_type_label": "",
                "osm_raw_tags": {},
            }
        )
        by_parcel[key].add(bid)
    profiler.set_metric("pairs_count", len(pairs))
    profiler.set_metric("parcels_with_pairs", len(by_parcel))
    profiler.set_metric("buildings_count", len(by_building))

    multi_parcel_buildings = {b for b, lst in by_building.items() if len({(x["section"], x["numero_norm"]) for x in lst}) > 1}
    assigned_multi_by_building, multi_decisions = resolve_multi_parcel_buildings(by_building, ppm)
    shared_candidate_parcels: set[tuple[str, str, str]] = set()
    for bid in multi_decisions.keys():
        for entry in by_building.get(bid, []):
            shared_candidate_parcels.add((entry["code_insee"], entry["section"], entry["numero_norm"]))

    v5_log(
        f"[v5] Jointure spatiale : {len(pairs)} paires bâtiment×parcelle — {len(by_building)} bâtiments — "
        f"{len(by_parcel)} parcelles cadastre (≥1 bâtiment) — {len(multi_parcel_buildings)} bât. multi-parcelles"
    )

    def iris_for_parcel_key(pk: tuple[str, str, str]) -> tuple[str | None, str | None]:
        gj = parcel_geom.get(pk)
        if not gj:
            return None, None
        ll = parcel_centroid_geojson(gj)
        if not ll:
            return None, None
        return iris_for_point(ll[0], ll[1], iris_gdf)

    def ppm_payload(pk: tuple[str, str, str]) -> dict[str, Any]:
        info = ppm.get(pk) or {}
        etab = etab_match_by_parcel.get(pk) or {
            "status_technique": "no_candidate",
            "status_metier": "none",
            "siret_count": 0,
            "sirets_json": "[]",
            "sirens_json": "[]",
            "matching_confidence": 0.0,
            "matching_reason": "",
        }
        sirens = info.get("sirens") or []
        st = ppm_siren_status(len(sirens))
        pnms = info.get("passerelle_numero_match_set")
        passerelle_numero_match = ""
        if isinstance(pnms, (tuple, list)) and pnms:
            passerelle_numero_match = ",".join(sorted({str(x).strip() for x in pnms if str(x).strip()}))
        return {
            "siren_status": st,
            "sirens": sirens,
            "siren_rows": info.get("siren_rows") or {},
            "passerelle_address": info.get("passerelle_address"),
            "passerelle_indice_norm": str(info.get("passerelle_indice_norm") or "").strip(),
            "passerelle_numero_match": passerelle_numero_match,
            "passerelle_addresses_json": json.dumps(info.get("passerelle_addresses") or [], ensure_ascii=False),
            "status_technique": etab.get("status_technique") or "",
            "status_metier": etab.get("status_metier") or "none",
            "siret_count": int(etab.get("siret_count") or 0),
            "sirets_json": etab.get("sirets_json") or "[]",
            "sirens_json": etab.get("sirens_json") or "[]",
            "matching_confidence": float(etab.get("matching_confidence") or 0.0),
            "matching_reason": etab.get("matching_reason") or "",
        }

    out_rows: list[dict[str, Any]] = []

    # Lignes bâtiment (chevauchement multi-parcelles)
    multi_ids = sorted(multi_parcel_buildings)
    geom_by_bat: dict[str, str] = {}
    if args.include_building_grain and multi_ids and args.building_source != "osm":
        conn = psycopg2.connect(url)
        try:
            with conn.cursor() as cur:
                geom_by_bat = fetch_construction_geometries(cur, multi_ids, constructions_q)
        finally:
            conn.close()

    all_selected_ids = sorted({str(bid).strip() for bids in by_parcel.values() for bid in bids if str(bid).strip()})
    payload_by_bat: dict[str, dict[str, Any]] = {}
    if all_selected_ids:
        conn = psycopg2.connect(url)
        try:
            with conn.cursor() as cur:
                if args.building_source == "osm":
                    payload_by_bat = fetch_osm_geometry_payloads(
                        cur,
                        all_selected_ids,
                        qualified_osm_buildings_table(),
                    )
                else:
                    payload_by_bat = fetch_construction_payloads(cur, all_selected_ids, constructions_q)
        finally:
            conn.close()

    if args.include_building_grain:
        for bid in multi_ids:
            plist = by_building[bid]
            payload_first = payload_by_bat.get(bid, {})
            parcelles = []
            for p in plist:
                pk = (p["code_insee"], p["section"], p["numero_norm"])
                ci, ni = iris_for_parcel_key(pk)
                ppm_d = ppm_payload(pk)
                parcelles.append(
                    {
                        "code_insee": pk[0],
                        "section": pk[1],
                        "numero_norm": pk[2],
                        "code_iris": ci,
                        "nom_iris": ni,
                        **ppm_d,
                    }
                )
            # dédupliquer parcelles (même parcelle si doublon jointure)
            seen = set()
            dedup = []
            for item in parcelles:
                k = (item["code_insee"], item["section"], item["numero_norm"])
                if k in seen:
                    continue
                seen.add(k)
                dedup.append(item)
            first = plist[0]
            out_rows.append(
                {
                    "scout_v5_id": f"building:{bid}",
                    "grain": "building",
                    "batiment_construction_id": (first.get("batiment_construction_id") or bid),
                    "bdnb_batiment_construction_id": first.get("bdnb_batiment_construction_id") or "",
                    "batiment_groupe_id": first.get("batiment_groupe_id") or "",
                    "osm_building_id": first.get("osm_building_id") or "",
                    "osm_match_status": first.get("osm_match_status") or "",
                    "osm_bdnb_intersection_area_m2": first.get("osm_bdnb_intersection_area_m2") or "",
                    "osm_address_text": first.get("osm_address_text") or "",
                    "osm_name": payload_first.get("name") or "",
                    "osm_website": payload_first.get("website") or "",
                    "osm_phone": payload_first.get("phone") or "",
                    "osm_poi_primary_key": payload_first.get("poi_primary_key") or "",
                    "osm_poi_primary_value": payload_first.get("poi_primary_value") or "",
                    "osm_poi_type_label": payload_first.get("poi_type_label") or "",
                    "osm_raw_tags": payload_first.get("raw_tags") or {},
                    "code_insee": "",
                    "section": "",
                    "numero_norm": "",
                    "code_iris": "",
                    "nom_iris": "",
                    "nb_batiments": 1,
                    "annee_construction": first.get("annee_construction"),
                    "footprint_m2": first.get("footprint_m2"),
                    "footprint_sum_m2": first.get("footprint_m2"),
                    "siren_status": "",
                    "status_technique": "",
                    "status_metier": "",
                    "siret_count": 0,
                    "passerelle_address": "",
                    "passerelle_indice_norm": "",
                    "passerelle_numero_match": "",
                    "passerelle_addresses_json": "",
                    "sirets_json": "[]",
                    "sirens_json": "[]",
                    "matching_confidence": 0.0,
                    "matching_reason": "",
                    "matching_status": "partage",
                    "matching_decision": (multi_decisions.get(bid, {}).get("matching_decision") or ""),
                    "matching_siren_selected": (multi_decisions.get(bid, {}).get("matching_siren_selected") or ""),
                    "matching_debug_json": json.dumps(multi_decisions.get(bid) or {}, ensure_ascii=False),
                    "parcelles_json": json.dumps(dedup, ensure_ascii=False),
                    "buildings_json": "",
                    "geometry_geojson": (
                        payload_by_bat.get(bid, {}).get("geometry")
                        if args.building_source == "osm"
                        else geom_by_bat.get(bid, "")
                    ),
                    **empty_google_audit(),
                    **building_osm_export_columns(),
                }
            )

    # Lignes parcelle : bâtiments mono + bâtiments multi-parcelles affectés à cette parcelle
    min_default = float(args.min_parcelle_footprint_sum_m2)
    min_shared_candidate = 500.0

    v5_log(
        f"[v5] Filtre footprint : seuil standard {min_default} m² — "
        f"candidats « partage » {min_shared_candidate} m² — {len(by_parcel)} parcelle(s) à analyser"
    )
    row_ctx: dict[tuple[str, str, str], dict[str, Any] | None] = {}
    parcel_items = list(by_parcel.items())
    n_parcel_keys = len(parcel_items)
    exported_acc = 0
    with profiler.phase("parcel_row_context"):
        for idx, (pk, bids) in enumerate(parcel_items, 1):
            row_ctx[pk] = compute_parcel_row_context_for_export(
                pk,
                bids,
                by_building=by_building,
                multi_parcel_buildings=multi_parcel_buildings,
                assigned_multi_by_building=assigned_multi_by_building,
                multi_decisions=multi_decisions,
                parcel_geom=parcel_geom,
                iris_for_parcel_key=iris_for_parcel_key,
                min_default=min_default,
                min_shared_candidate=min_shared_candidate,
                shared_candidate_parcels=shared_candidate_parcels,
            )
            if row_ctx[pk] is not None:
                exported_acc += 1
            if args.progress_every > 0 and idx % args.progress_every == 0:
                v5_log(f"[v5]   Parcelles scannées {idx}/{n_parcel_keys} — retenues pour export : {exported_acc}")

    exported_pks = {pk for pk, ctx in row_ctx.items() if ctx is not None}
    profiler.set_metric("exported_parcels", len(exported_pks))
    v5_log(f"[v5] Parcelles retenues (lignes CSV parcelle) : {len(exported_pks)}")
    osm_global_status = "disabled" if args.no_osm_poi else "ok"
    osm_data_as_of = ""
    osm_by_pk: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]] = {}
    if not args.no_osm_poi and exported_pks:
        conn = psycopg2.connect(url)
        try:
            with conn.cursor() as cur:
                osm_by_pk, osm_global_status, osm_data_as_of = fetch_osm_pois_for_parcel_keys(
                    cur,
                    code_insee,
                    exported_pks,
                )
        except Exception as e:
            osm_global_status = "error"
            v5_log(f"[v5] OSM POI: erreur de jointure ({e}).")
        finally:
            conn.close()
    if exported_pks:
        v5_log(
            f"[v5] OSM POI: status={osm_global_status} sur {len(exported_pks)} parcelle(s) exportées."
        )
    nom_iris_by_pk: dict[tuple[str, str, str], str | None] = {
        pk: (row_ctx[pk] or {}).get("ni") for pk in exported_pks
    }
    pk_to_gid: dict[tuple[str, str, str], tuple[tuple[str, str, str], ...]] = (
        parcel_pk_to_group_id(exported_pks, by_building) if exported_pks else {}
    )
    n_comp = len({pk_to_gid[p] for p in exported_pks}) if exported_pks else 0
    v5_log(f"[v5] Composantes connexes (parcelles exportées reliées par un bâtiment) : {n_comp}")
    google_group_cache = precompute_google_group_fallback_cache(
        google_fb=google_fb,
        etab_available=etab_available,
        google_key=google_key,
        google_radius_m=float(args.google_radius_m),
        exported_pks=exported_pks,
        parcel_geom=parcel_geom,
        nom_iris_by_pk=nom_iris_by_pk,
        ppm_payload=ppm_payload,
        voie_index=voie_index,
        etab_rows=etab_rows,
        osm_by_pk=osm_by_pk,
        google_stats=google_stats,
        pk_to_gid=pk_to_gid,
        log=v5_log,
    )

    written = 0
    for pk, bids in by_parcel.items():
        ctx = row_ctx.get(pk)
        if ctx is None:
            continue
        written += 1
        if args.progress_every > 0 and written % args.progress_every == 0:
            v5_log(f"[v5]   Assemblage lignes export {written}/{len(exported_pks)}")
        selected = ctx["selected"]
        bdetails = ctx["bdetails"]
        bdetails_enriched: list[dict[str, Any]] = []
        for item in bdetails:
            payload_key = (
                item.get("osm_building_id")
                if args.building_source == "osm"
                else item.get("batiment_construction_id")
            )
            payload = payload_by_bat.get(str(payload_key or "").strip(), {}) if payload_key else {}
            enriched = dict(item)
            enriched["osm_name"] = payload.get("name") or ""
            enriched["osm_website"] = payload.get("website") or ""
            enriched["osm_phone"] = payload.get("phone") or ""
            enriched["osm_poi_primary_key"] = payload.get("poi_primary_key") or ""
            enriched["osm_poi_primary_value"] = payload.get("poi_primary_value") or ""
            enriched["osm_poi_type_label"] = payload.get("poi_type_label") or ""
            enriched["osm_raw_tags"] = payload.get("raw_tags") or {}
            bdetails_enriched.append(enriched)
        footprint_sum = ctx["footprint_sum"]
        ci = ctx["ci"]
        ni = ctx["ni"]
        gj = ctx["gj"]
        ppm_d = ppm_payload(pk)
        google_row = empty_google_audit()
        gid = pk_to_gid.get(pk)
        if (
            gid is not None
            and gid in google_group_cache
            and google_fb
            and etab_available
        ):
            gr = google_group_cache[gid]
            google_row = dict(gr["google_row"])
            rematch = gr.get("rematch")
            if rematch and int(rematch.get("siret_count") or 0) > 0:
                google_stats["success"] += 1
                ppm_d = {
                    **ppm_d,
                    "status_technique": rematch.get("status_technique") or ppm_d["status_technique"],
                    "status_metier": rematch.get("status_metier") or ppm_d["status_metier"],
                    "siret_count": rematch.get("siret_count", 0),
                    "sirets_json": rematch.get("sirets_json", "[]"),
                    "sirens_json": rematch.get("sirens_json", "[]"),
                    "matching_confidence": float(rematch.get("matching_confidence") or 0.0),
                    "matching_reason": rematch.get("matching_reason", ""),
                }

        scout_id = f"parcelle:{pk[0]}:{pk[1]}:{pk[2]}"
        out_rows.append(
            {
                "scout_v5_id": scout_id,
                "grain": "parcelle",
                "batiment_construction_id": "",
                "bdnb_batiment_construction_id": "",
                "batiment_groupe_id": "",
                "osm_building_id": "",
                "osm_match_status": "",
                "osm_bdnb_intersection_area_m2": "",
                "osm_address_text": "",
                "code_insee": pk[0],
                "section": pk[1],
                "numero_norm": pk[2],
                "code_iris": ci or "",
                "nom_iris": ni or "",
                "nb_batiments": len(selected),
                "annee_construction": "",
                "footprint_m2": "",
                "footprint_sum_m2": footprint_sum,
                "siren_status": ppm_d["siren_status"],
                "status_technique": ppm_d["status_technique"],
                "status_metier": ppm_d["status_metier"],
                "siret_count": ppm_d["siret_count"],
                "passerelle_address": (ppm_d.get("passerelle_address") or ""),
                "passerelle_indice_norm": (ppm_d.get("passerelle_indice_norm") or ""),
                "passerelle_numero_match": (ppm_d.get("passerelle_numero_match") or ""),
                "passerelle_addresses_json": (ppm_d.get("passerelle_addresses_json") or ""),
                "sirets_json": ppm_d["sirets_json"],
                "sirens_json": ppm_d["sirens_json"],
                "matching_confidence": ppm_d["matching_confidence"],
                "matching_reason": ppm_d["matching_reason"],
                "matching_status": "mono",
                "matching_decision": "",
                "matching_siren_selected": "",
                "matching_debug_json": "",
                "parcelles_json": "",
                "buildings_json": json.dumps(bdetails_enriched, ensure_ascii=False),
                "building_geometries_json": (
                    "[]"
                    if args.light_export
                    else json.dumps(
                        [
                            {
                                "batiment_construction_id": item["batiment_construction_id"],
                                "bdnb_batiment_construction_id": item.get("bdnb_batiment_construction_id"),
                                "batiment_groupe_id": item.get("batiment_groupe_id"),
                                "osm_building_id": item.get("osm_building_id") or "",
                                "osm_match_status": item.get("osm_match_status") or "",
                                "osm_bdnb_intersection_area_m2": item.get("osm_bdnb_intersection_area_m2"),
                                "osm_address_text": item.get("osm_address_text") or "",
                                "osm_name": (payload_by_bat.get(payload_key, {}) or {}).get("name") or "",
                                "osm_website": (payload_by_bat.get(payload_key, {}) or {}).get("website") or "",
                                "osm_phone": (payload_by_bat.get(payload_key, {}) or {}).get("phone") or "",
                                "osm_poi_primary_key": (payload_by_bat.get(payload_key, {}) or {}).get("poi_primary_key")
                                or "",
                                "osm_poi_primary_value": (payload_by_bat.get(payload_key, {}) or {}).get("poi_primary_value")
                                or "",
                                "osm_poi_type_label": (payload_by_bat.get(payload_key, {}) or {}).get("poi_type_label") or "",
                                "osm_raw_tags": (payload_by_bat.get(payload_key, {}) or {}).get("raw_tags") or {},
                                "zone_tag": item.get("zone_tag") or "",
                                "zone_source": item.get("zone_source") or "",
                                "landuse_intersection_area_m2": item.get("landuse_intersection_area_m2"),
                                "annee_construction": item.get("annee_construction"),
                                "footprint_m2": item.get("footprint_m2"),
                                "geometry": json.loads((payload_by_bat.get(payload_key, {}) or {})["geometry"]),
                            }
                            for item in bdetails_enriched
                            for payload_key in [
                                item.get("osm_building_id")
                                if args.building_source == "osm"
                                else item.get("batiment_construction_id")
                            ]
                            if payload_key in payload_by_bat
                        ],
                        ensure_ascii=False,
                    )
                ),
                "geometry_geojson": gj,
                **google_row,
                **parcel_osm_export_columns(
                    pk,
                    osm_by_pk=osm_by_pk,
                    global_status=osm_global_status,
                    osm_data_as_of=osm_data_as_of,
                    disabled=bool(args.no_osm_poi),
                ),
            }
        )

    fieldnames = [
        "scout_v5_id",
        "grain",
        "batiment_construction_id",
        "bdnb_batiment_construction_id",
        "batiment_groupe_id",
        "osm_building_id",
        "osm_match_status",
        "osm_bdnb_intersection_area_m2",
        "osm_address_text",
        "code_insee",
        "section",
        "numero_norm",
        "code_iris",
        "nom_iris",
        "nb_batiments",
        "annee_construction",
        "footprint_m2",
        "footprint_sum_m2",
        "siren_status",
        "status_technique",
        "status_metier",
        "siret_count",
        "passerelle_address",
        "passerelle_indice_norm",
        "passerelle_numero_match",
        "passerelle_addresses_json",
        "sirets_json",
        "sirens_json",
        "matching_confidence",
        "matching_reason",
        "matching_status",
        "matching_decision",
        "matching_siren_selected",
        "matching_debug_json",
        "parcelles_json",
        "buildings_json",
        "building_geometries_json",
        "google_fallback_attempted",
        "google_fallback_success",
        "google_fallback_group_id",
        "google_nearby_status",
        "google_nearby_error",
        "google_raw_nearby_count",
        "google_excluded_outside_parcel",
        "google_nearby_ranked_json",
        "google_winner_place_id",
        "google_winner_name",
        "google_anchor_address",
        "google_api_gouv_query",
        "google_api_gouv_etablissements_count",
        "google_reject_reason",
        "osm_pois_json",
        "osm_poi_count",
        "osm_pois_status",
        "osm_poi_truncated",
        "osm_data_as_of",
        "geometry_geojson",
    ]
    with profiler.phase("write_csv"):
        with args.out_csv.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            for r in out_rows:
                w.writerow(r)
    print(f"[v5] CSV écrit: {args.out_csv} ({len(out_rows)} lignes)")
    if google_fb:
        gsum = (
            "[v5] Bilan Google fallback — "
            f"groupes tentés={google_stats['attempted']} parcelles enrichies (succès)={google_stats['success']} | "
            f"appels API: nearby={google_stats['nearby_calls']} details={google_stats['details_calls']} "
            f"api_gouv={google_stats['api_gouv_calls']}"
        )
        print(gsum)
        if args.quiet:
            # même synthèse sur stderr si --quiet (stdout seul peut être redirigé)
            print(gsum, file=sys.stderr, flush=True)

    if not args.no_geojson:
        with profiler.phase("write_geojson"):
            features = []
            for r in out_rows:
                gj = r.get("geometry_geojson") or ""
                if not gj.strip():
                    continue
                try:
                    geom = json.loads(gj)
                except json.JSONDecodeError:
                    continue
                props = {k: v for k, v in r.items() if k != "geometry_geojson"}
                fid = str(props.get("scout_v5_id") or "").strip()
                feat: dict[str, Any] = {"type": "Feature", "properties": props, "geometry": geom}
                if fid:
                    feat["id"] = fid
                features.append(feat)
            fc = {"type": "FeatureCollection", "features": features}
            args.out_geojson.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
        print(f"[v5] GeoJSON écrit: {args.out_geojson} ({len(features)} entités)")

    if args.write_postgres:
        src = str(args.postgres_source_run or "").strip() or f"matching_v5:{code_insee}"
        try:
            write_matching_v5_features_postgres(out_rows, code_insee, src, v5_log)
        except Exception as e:
            print(f"[v5] Erreur --write-postgres: {e}", file=sys.stderr)
            return 1

    if args.profile_json:
        profiler.set_metric("out_rows", len(out_rows))
        profiler.set_metric("building_source", args.building_source)
        args.profile_json.parent.mkdir(parents=True, exist_ok=True)
        args.profile_json.write_text(json.dumps(profiler.to_payload(), ensure_ascii=False, indent=2), encoding="utf-8")
        v5_log(f"[v5] Profiling JSON écrit: {args.profile_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
