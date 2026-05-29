#!/usr/bin/env python3
"""
Construit public.scout_matching_v5_combos pour une commune (DELETE + INSERT par code_insee).

Chaînage :
  run_matching_v5.py --write-postgres --code-insee=…
  → scripts/refresh-matching-v5-buildings-mv.mjs
  → python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=…
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from typing import Any

from discovery_combos_v5 import build_combo_records_for_commune
from run_matching_v5 import qualified_scout_matching_v5_table, resolve_database_url

BUILDINGS_MV = "public.scout_matching_v5_buildings_mv"
COMBOS_TABLE = "public.scout_matching_v5_combos"


def _geom_geojson_from_row(geom_val: Any) -> str | None:
    if geom_val is None:
        return None
    if isinstance(geom_val, dict):
        return json.dumps(geom_val, ensure_ascii=False)
    if isinstance(geom_val, str) and geom_val.strip():
        return geom_val.strip()
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Build scout_matching_v5_combos pour une commune")
    ap.add_argument("--code-insee", required=True, help="Code INSEE commune (ex. 33318)")
    ap.add_argument("--database-url", default="", help="URL Postgres (sinon env)")
    args = ap.parse_args()

    code_insee = args.code_insee.strip()
    if not code_insee:
        raise SystemExit("--code-insee requis")

    url = (args.database_url or "").strip() or resolve_database_url()
    if not url:
        raise SystemExit("Aucune URL Postgres (LOCAL_DATABASE_URL / .env.local)")

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as exc:
        raise SystemExit("psycopg2-binary requis") from exc

    scout_q = qualified_scout_matching_v5_table()
    imported_at = datetime.now(timezone.utc)

    print(f"[build_discovery_combos] Début commune {code_insee}", flush=True)
    conn = psycopg2.connect(url)
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            print(f"[build_discovery_combos] Lecture parcelles grain=parcelle…", flush=True)
            cur.execute(
                f"""
                SELECT
                  scout_v5_id,
                  code_insee,
                  section,
                  numero_norm,
                  footprint_sum_m2,
                  properties_json,
                  building_geometries_json,
                  ST_AsGeoJSON(geom)::json AS geom_geojson
                FROM {scout_q}
                WHERE code_insee = %s AND grain = 'parcelle'
                """,
                (code_insee,),
            )
            raw_rows = cur.fetchall()
        print(f"[build_discovery_combos] {len(raw_rows)} parcelle(s) lue(s)", flush=True)

        parcelle_rows: list[dict[str, Any]] = []
        for r in raw_rows:
            props = r.get("properties_json")
            buildings_json = ""
            if isinstance(props, dict):
                bj = props.get("buildings_json")
                if isinstance(bj, str):
                    buildings_json = bj
                elif bj is not None:
                    buildings_json = json.dumps(bj, ensure_ascii=False)
            elif isinstance(props, str) and props.strip():
                try:
                    parsed = json.loads(props)
                    if isinstance(parsed, dict) and "buildings_json" in parsed:
                        bj = parsed["buildings_json"]
                        buildings_json = bj if isinstance(bj, str) else json.dumps(bj, ensure_ascii=False)
                except json.JSONDecodeError:
                    pass
            passerelle_addresses_json = ""
            sirets_json = ""
            if isinstance(props, dict):
                pa = props.get("passerelle_addresses_json")
                if isinstance(pa, str):
                    passerelle_addresses_json = pa
                elif pa is not None:
                    passerelle_addresses_json = json.dumps(pa, ensure_ascii=False)
                sj = props.get("sirets_json")
                if isinstance(sj, str):
                    sirets_json = sj
                elif sj is not None:
                    sirets_json = json.dumps(sj, ensure_ascii=False)

            parcelle_rows.append(
                {
                    "scout_v5_id": r["scout_v5_id"],
                    "code_insee": r["code_insee"],
                    "section": r["section"],
                    "numero_norm": r["numero_norm"],
                    "footprint_sum_m2": float(r.get("footprint_sum_m2") or 0),
                    "buildings_json": buildings_json,
                    "passerelle_addresses_json": passerelle_addresses_json,
                    "sirets_json": sirets_json,
                    "building_geometries_json": r.get("building_geometries_json"),
                    "properties_json": props,
                    "geom_geojson": _geom_geojson_from_row(r.get("geom_geojson")),
                }
            )

        print(
            f"[build_discovery_combos] Agrégation combos ({len(parcelle_rows)} parcelles)…",
            flush=True,
        )
        records = build_combo_records_for_commune(parcelle_rows)
        print(f"[build_discovery_combos] {code_insee}: {len(records)} combo(s) à insérer", flush=True)

        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {COMBOS_TABLE} WHERE code_insee = %s", (code_insee,))

            insert_sql = f"""
            INSERT INTO {COMBOS_TABLE} (
              combo_id, code_insee, anchor_parcelle_id, parcelle_scout_v5_ids,
              osm_building_ids, footprint_sum_m2, parcel_contour_sum_m2, parking_sum_m2,
              has_landuse_waiver, zone_tags, construction_years,
              owner_sirens, domiciliation_sirens, naf_divisions,
              geom, imported_at
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              ST_SetSRID(ST_Centroid(ST_GeomFromGeoJSON(%s)), 4326),
              %s
            )
            """

            for rec in records:
                osm_ids = rec["osm_building_ids"]
                geom_gj: str | None = None

                if osm_ids:
                    with conn.cursor() as cur_geom:
                        cur_geom.execute(
                            f"""
                            SELECT ST_AsGeoJSON(
                              ST_Centroid(ST_Collect(ST_PointOnSurface(geom)))
                            )::text
                            FROM {BUILDINGS_MV}
                            WHERE osm_building_id = ANY(%s)
                            """,
                            (osm_ids,),
                        )
                        row_geom = cur_geom.fetchone()
                        if row_geom and row_geom[0]:
                            geom_gj = row_geom[0]

                if not geom_gj:
                    anchor_gj = rec.get("anchor_geom_geojson")
                    if isinstance(anchor_gj, dict):
                        geom_gj = json.dumps(anchor_gj, ensure_ascii=False)
                    elif isinstance(anchor_gj, str) and anchor_gj.strip():
                        geom_gj = anchor_gj.strip()

                if not geom_gj:
                    print(f"[build_discovery_combos] skip {rec['combo_id']}: pas de géométrie")
                    continue

                cur.execute(
                    insert_sql,
                    (
                        rec["combo_id"],
                        rec["code_insee"],
                        rec["anchor_parcelle_id"],
                        rec["parcelle_scout_v5_ids"],
                        rec["osm_building_ids"],
                        rec["footprint_sum_m2"],
                        rec["parcel_contour_sum_m2"],
                        rec["parking_sum_m2"],
                        rec["has_landuse_waiver"],
                        rec.get("zone_tags") or [],
                        rec.get("construction_years") or [],
                        rec.get("owner_sirens") or [],
                        rec.get("domiciliation_sirens") or [],
                        rec.get("naf_divisions") or [],
                        geom_gj,
                        imported_at,
                    ),
                )

        conn.commit()
        print(f"[build_discovery_combos] OK — {len(records)} ligne(s) insérée(s)")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
