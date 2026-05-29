#!/usr/bin/env python3
"""Compare building_geometries_json en base vs empreintes OSM (osm_building_footprints)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data-pipeline/matching_v5"))

import psycopg2
import psycopg2.extras
from osm_buildings_v5 import fetch_osm_geometry_payloads, qualified_osm_buildings_table
from run_matching_v5 import qualified_scout_matching_v5_table, resolve_database_url

CODE_INSEE = "33318"
SAMPLE_LIMIT = 5


def first_coord(geom: dict) -> tuple[float, float] | None:
    t = geom.get("type")
    coords = geom.get("coordinates")
    if t == "Polygon" and coords:
        ring = coords[0]
        if ring:
            return float(ring[0][0]), float(ring[0][1])
    if t == "MultiPolygon" and coords and coords[0] and coords[0][0]:
        p = coords[0][0][0]
        return float(p[0]), float(p[1])
    return None


def main() -> int:
    url = resolve_database_url()
    if not url:
        raise RuntimeError("Pas d'URL Postgres")
    scout_q = qualified_scout_matching_v5_table()
    osm_q = qualified_osm_buildings_table()

    conn = psycopg2.connect(url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""
        SELECT count(*) AS n
        FROM {scout_q}
        WHERE grain = 'parcelle' AND code_insee = %s
          AND building_geometries_json::text <> '[]'
        """,
        (CODE_INSEE,),
    )
    print(f"Parcelles {CODE_INSEE} avec building_geometries_json non vide:", cur.fetchone()["n"])

    cur.execute(
        f"""
        SELECT scout_v5_id, building_geometries_json
        FROM {scout_q}
        WHERE grain = 'parcelle' AND code_insee = %s
          AND building_geometries_json::text <> '[]'
        ORDER BY scout_v5_id
        LIMIT %s
        """,
        (CODE_INSEE, SAMPLE_LIMIT),
    )
    rows = cur.fetchall()
    osm_ids: list[str] = []
    for row in rows:
        for entry in row["building_geometries_json"]:
            oid = str(entry.get("osm_building_id") or "").strip()
            if oid:
                osm_ids.append(oid)
    osm_ids = sorted(set(osm_ids))

    osm_payload = fetch_osm_geometry_payloads(cur, osm_ids, osm_q) if osm_ids else {}
    print(f"IDs OSM échantillon: {len(osm_ids)}, payloads OSM table: {len(osm_payload)}")
    print()

    for row in rows:
        sid = row["scout_v5_id"]
        for entry in row["building_geometries_json"]:
            oid = str(entry.get("osm_building_id") or "").strip()
            stored_geom = entry.get("geometry")
            if isinstance(stored_geom, str):
                try:
                    stored_geom = json.loads(stored_geom)
                except json.JSONDecodeError:
                    stored_geom = None
            osm_ref = osm_payload.get(oid)
            osm_geom = None
            if osm_ref and osm_ref.get("geometry"):
                try:
                    osm_geom = json.loads(str(osm_ref["geometry"]))
                except json.JSONDecodeError:
                    osm_geom = None

            stored_pt = first_coord(stored_geom) if isinstance(stored_geom, dict) else None
            osm_pt = first_coord(osm_geom) if isinstance(osm_geom, dict) else None
            same = stored_pt == osm_pt if stored_pt and osm_pt else False

            cur.execute(
                f"""
                SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography) AS area_m2
                """,
                (json.dumps(stored_geom),),
            )
            stored_area = cur.fetchone()["area_m2"]
            osm_area = None
            if osm_geom:
                cur.execute(
                    f"""
                    SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography) AS area_m2
                    """,
                    (json.dumps(osm_geom),),
                )
                osm_area = cur.fetchone()["area_m2"]

            bdnb_id = entry.get("bdnb_batiment_construction_id") or entry.get("batiment_construction_id")
            print(f"--- {sid} / {oid}")
            print(f"  bdnb ref in json: {bdnb_id}")
            print(f"  stored footprint_m2 field: {entry.get('footprint_m2')}")
            print(f"  stored geom 1st coord: {stored_pt}, area~{stored_area:.1f} m²" if stored_area else f"  stored geom: {stored_pt}")
            print(f"  OSM table 1st coord: {osm_pt}, area~{osm_area:.1f} m²" if osm_area else "  OSM table: missing")
            print(f"  coords match OSM table: {same}")
            if stored_area and osm_area:
                delta_pct = abs(stored_area - osm_area) / osm_area * 100 if osm_area else 0
                print(f"  area delta vs OSM: {delta_pct:.2f}%")
            print()

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
