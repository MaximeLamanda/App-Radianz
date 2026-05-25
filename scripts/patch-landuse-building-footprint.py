#!/usr/bin/env python3
"""
Ajoute un polygone landuse local (empreinte bâtiment) pour lever la dérogation 400 m²
sans modifier de vastes polygones CORINE.

Usage:
  python scripts/patch-landuse-building-footprint.py \\
    --osm-building r:327086142 --landuse industrial
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg2

# IDs réservés pour patches locaux (évite collision OSM réel)
PATCH_OSM_ID_BASE = 9_300_000_000


def parse_osm_building_id(raw: str) -> tuple[str, int]:
    s = raw.strip().lower()
    if ":" not in s:
        raise ValueError(f"osm_building_id invalide: {raw!r}")
    ot, oid = s.split(":", 1)
    ot = ot[:1]
    if ot not in ("w", "r"):
        raise ValueError(f"osm_type invalide: {ot}")
    return ot, int(oid)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm-building", required=True, help="ex. r:327086142")
    ap.add_argument("--landuse", default="industrial", choices=("industrial", "commercial", "retail"))
    ap.add_argument("--revert-corine", action="store_true", help="Remet residential sur les gros polygones CORINE patchés par erreur")
    args = ap.parse_args()

    url = os.environ.get("LOCAL_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL manquante", file=sys.stderr)
        return 1

    b_type, b_id = parse_osm_building_id(args.osm_building)
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    if args.revert_corine:
        cur.execute(
            """
            UPDATE public.osm_landuse_areas
            SET landuse = 'residential',
                tags = tags - 'solar_view_landuse_override'
            WHERE tags ? 'solar_view_landuse_override'
              AND landuse IN ('industrial', 'commercial', 'retail')
              AND ST_Area(ST_Transform(geom, 2154)) > 500000
            """
        )
        print(f"CORINE revert: {cur.rowcount} polygone(s)")

    patch_id = PATCH_OSM_ID_BASE + (b_id % 1_000_000)
    cur.execute(
        """
        DELETE FROM public.osm_landuse_areas
        WHERE osm_type = 'w' AND osm_id = %s
          AND tags ? 'solar_view_landuse_patch'
        """,
        (patch_id,),
    )
    cur.execute(
        """
        INSERT INTO public.osm_landuse_areas (osm_type, osm_id, geom, landuse, tags)
        SELECT
          'w',
          %s,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(b.geom), 3))::geometry(MultiPolygon, 4326),
          %s,
          jsonb_build_object(
            'landuse', %s,
            'solar_view_landuse_patch', 'true',
            'solar_view_for_building', %s
          )
        FROM public.osm_building_footprints b
        WHERE b.osm_type = %s AND b.osm_id = %s
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          landuse = EXCLUDED.landuse,
          tags = EXCLUDED.tags,
          imported_at = now()
        """,
        (patch_id, args.landuse, args.landuse, args.osm_building, b_type, b_id),
    )
    if cur.rowcount == 0:
        conn.rollback()
        print(f"Bâtiment introuvable: {args.osm_building}", file=sys.stderr)
        return 1
    conn.commit()
    print(f"Patch landuse {args.landuse!r} inséré: w:{patch_id} pour {args.osm_building}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
