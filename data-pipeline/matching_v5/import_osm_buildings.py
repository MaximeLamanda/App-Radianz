#!/usr/bin/env python3
"""
Import footprints bâtiments OSM (.osm.pbf) vers Postgres (public.osm_building_footprints).

  pip install -r data-pipeline/python/requirements.txt
  python3 data-pipeline/matching_v5/import_osm_buildings.py --input chemin.osm.pbf --truncate
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_PIPELINE_DIR = REPO_ROOT / "data-pipeline" / "python"
if str(PYTHON_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_PIPELINE_DIR))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import osmium  # noqa: E402
import osmium.geom  # noqa: E402
from shapely import from_wkb  # noqa: E402
from shapely.geometry import LineString, Polygon  # noqa: E402
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon  # noqa: E402

from osm_buildings_v5 import qualified_osm_buildings_table  # noqa: E402
from osm_poi_v5 import tags_dict  # noqa: E402

DATABASE_URL_ENV_KEYS = [
    "LOCAL_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
    "Radianz_DATABASE_URL",
    "RADIANZ_POSTGRES_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
]


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


def _geom_from_osmium_wkb(wkb: object) -> Any:
    if isinstance(wkb, str):
        return from_wkb(bytes.fromhex(wkb))
    if isinstance(wkb, (bytes, bytearray)):
        return from_wkb(bytes(wkb))
    return from_wkb(bytes(memoryview(wkb)))


def _format_osm_address(tags: dict[str, str]) -> str:
    full = (tags.get("addr:full") or "").strip()
    if full:
        return full
    hn = (tags.get("addr:housenumber") or "").strip()
    hname = (tags.get("addr:housename") or "").strip()
    street = (tags.get("addr:street") or tags.get("addr:place") or "").strip()
    city = (tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or "").strip()
    pc = (tags.get("addr:postcode") or "").strip()
    line1 = " ".join(x for x in (hn, hname, street) if x).strip()
    line2 = " ".join(x for x in (pc, city) if x).strip()
    out = ", ".join(x for x in (line1, line2) if x).strip()
    return out or (tags.get("contact:address") or "").strip()


def _tags_stored(tags: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    allowed_keys = {
        "building",
        "name",
        "official_name",
        "brand",
        "operator",
        "building:levels",
        "building:use",
        "website",
        "contact:website",
        "url",
        "phone",
        "contact:phone",
        "mobile",
        "contact:mobile",
        "amenity",
        "shop",
        "craft",
        "office",
        "healthcare",
        "leisure",
        "tourism",
        "man_made",
    }
    for k, v in tags.items():
        lk = str(k).strip()
        if not lk:
            continue
        if lk in allowed_keys or lk.startswith("addr:"):
            sv = str(v).strip()
            if sv:
                out[lk] = sv
    return out


def _normalize_polygonal(geom: Any) -> ShapelyMultiPolygon | None:
    if geom is None or geom.is_empty:
        return None
    g = geom
    if isinstance(g, LineString):
        if not g.is_ring or len(g.coords) < 4:
            return None
        g = Polygon(g.coords)
    if isinstance(g, Polygon):
        return ShapelyMultiPolygon([g])
    if isinstance(g, ShapelyMultiPolygon):
        return g
    if hasattr(g, "geoms"):
        polys = [p for p in g.geoms if isinstance(p, Polygon)]
        if not polys:
            return None
        return ShapelyMultiPolygon(polys)
    return None


class PbfBuildingsCollector(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self._wkb = osmium.geom.WKBFactory()
        self.rows: list[tuple[str, int, str, dict[str, str], str]] = []
        self._seen: set[tuple[str, int]] = set()
        self.ways_kept = 0
        self.relations_kept = 0
        self.skipped_geom = 0

    def _emit(self, osm_type: str, osm_id: int, geom: Any, tags: dict[str, str]) -> None:
        if (osm_type, osm_id) in self._seen:
            return
        norm = _normalize_polygonal(geom)
        if norm is None:
            self.skipped_geom += 1
            return
        self._seen.add((osm_type, osm_id))
        self.rows.append(
            (
                osm_type,
                int(osm_id),
                norm.wkt,
                _tags_stored(tags),
                _format_osm_address(tags),
            )
        )
        if osm_type == "w":
            self.ways_kept += 1
        else:
            self.relations_kept += 1

    def way(self, w: osmium.osm.Way) -> None:
        tags = tags_dict(dict(w.tags))
        if not str(tags.get("building") or "").strip():
            return
        if not w.is_closed():
            return
        try:
            wkb = self._wkb.create_linestring(w)
            geom = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.skipped_geom += 1
            return
        self._emit("w", int(w.id), geom, tags)

    def area(self, a: osmium.osm.Area) -> None:
        tags = tags_dict(dict(a.tags))
        if not str(tags.get("building") or "").strip():
            return
        try:
            wkb = self._wkb.create_multipolygon(a)
            geom = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.skipped_geom += 1
            return
        self._emit("r", int(a.id), geom, tags)


def apply_osm_buildings_schema_sql(cur: Any) -> None:
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "005_osm_building_footprints.sql"
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            cur.execute(stmt + ";")


def insert_batch(cur: Any, qualified: str, batch: list[tuple[str, int, str, dict[str, str], str]]) -> None:
    import psycopg2.extras

    rows = [(ot, oid, wkt, psycopg2.extras.Json(tags), addr) for ot, oid, wkt, tags, addr in batch]
    psycopg2.extras.execute_batch(
        cur,
        f"""
        INSERT INTO {qualified} (osm_type, osm_id, geom, tags, address_text)
        VALUES (%s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326)::geometry(MultiPolygon, 4326), %s, %s)
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          tags = EXCLUDED.tags,
          address_text = EXCLUDED.address_text,
          imported_at = now()
        """,
        rows,
        page_size=max(1, len(rows)),
    )


def enrich_code_insee(cur: Any, qualified: str) -> int:
    cur.execute(
        f"""
        WITH matched AS (
          SELECT
            b.osm_type,
            b.osm_id,
            c.code_insee
          FROM {qualified} b
          INNER JOIN public.cadastre_france_feuilles_geom c
            ON c.geom && b.geom
           AND ST_Intersects(c.geom, ST_PointOnSurface(b.geom))
          WHERE c.code_insee IS NOT NULL
            AND btrim(c.code_insee) <> ''
        )
        UPDATE {qualified} dst
        SET code_insee = matched.code_insee
        FROM matched
        WHERE dst.osm_type = matched.osm_type
          AND dst.osm_id = matched.osm_id
          AND COALESCE(dst.code_insee, '') IS DISTINCT FROM matched.code_insee
        """
    )
    return int(cur.rowcount or 0)


def main() -> int:
    ap = argparse.ArgumentParser(description="Import footprints bâtiments OSM (PBF)")
    ap.add_argument("--input", type=Path, default=None)
    ap.add_argument("--ensure-schema", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument("--batch-size", type=int, default=600)
    ap.add_argument(
        "--skip-code-insee-enrichment",
        action="store_true",
        help="N'enrichit pas la colonne code_insee depuis le cadastre.",
    )
    args = ap.parse_args()

    if args.input is None and not args.ensure_schema:
        ap.error("indiquez --input fichier.osm.pbf et/ou --ensure-schema")
    url = resolve_database_url()
    if not url:
        print("Aucune URL Postgres (DATABASE_URL, LOCAL_DATABASE_URL, ...)", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("psycopg2-binary requis", file=sys.stderr)
        return 1

    conn_s = psycopg2.connect(url)
    try:
        conn_s.autocommit = True
        with conn_s.cursor() as cur:
            apply_osm_buildings_schema_sql(cur)
    finally:
        conn_s.close()
    print(f"[osm_buildings] Schéma vérifié ({qualified_osm_buildings_table()})", flush=True)
    if args.input is None:
        return 0

    if not args.input.is_file():
        print(f"Fichier introuvable: {args.input}", file=sys.stderr)
        return 1

    collector = PbfBuildingsCollector()
    print(f"[osm_buildings] Lecture PBF: {args.input}", flush=True)
    collector.apply_file(str(args.input), locations=True, idx="flex_mem")

    qualified = qualified_osm_buildings_table()
    conn = psycopg2.connect(url)
    inserted = 0
    updated_insee = 0
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            if args.truncate:
                cur.execute(f"TRUNCATE TABLE {qualified}")
            bs = max(1, int(args.batch_size))
            for i in range(0, len(collector.rows), bs):
                chunk = collector.rows[i : i + bs]
                insert_batch(cur, qualified, chunk)
                inserted += len(chunk)
            updated_insee = 0
            if not args.skip_code_insee_enrichment:
                updated_insee = enrich_code_insee(cur, qualified)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[osm_buildings] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(
        f"[osm_buildings] Terminé — upsert {inserted} | code_insee enrichis {updated_insee} | "
        f"ways {collector.ways_kept} | relations {collector.relations_kept} | geom ignorées {collector.skipped_geom}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
