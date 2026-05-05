#!/usr/bin/env python3
"""
Import POI OSM (.osm.pbf) vers Postgres — table public.osm_poi (sql/004_osm_poi.sql).

  pip install -r data-pipeline/python/requirements.txt
  python3 data-pipeline/matching_v5/import_osm_poi.py --input chemin.osm.pbf --truncate
  # (schéma 004_osm_poi.sql appliqué automatiquement ; ou seul : --ensure-schema)

Filtre : nœuds et ways fermés avec au moins une clé shop/amenity/craft/office/healthcare/leisure/tourism/man_made
(voir poi_tags_interesting dans osm_poi_v5). Les ways utilisent le centroïde de la ligne fermée.
En base, seuls les tags utiles au matching / affichage sont conservés (voir tags_stored_for_postgres),
dont les tags adresse `addr:*` et `contact:address`.
"""

from __future__ import annotations

import argparse
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

from osm_poi_v5 import (  # noqa: E402
    qualified_osm_poi_table,
    tags_dict,
    poi_tags_interesting,
    tags_stored_for_postgres,
)

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


def _geom_from_osmium_wkb(wkb: object) -> Any:
    """PyOsmium renvoie du WKB en str hex (pas des bytes)."""
    if isinstance(wkb, str):
        return from_wkb(bytes.fromhex(wkb))
    if isinstance(wkb, (bytes, bytearray)):
        return from_wkb(bytes(wkb))
    return from_wkb(bytes(memoryview(wkb)))


def resolve_database_url() -> str | None:
    _load_dotenv()
    for k in DATABASE_URL_ENV_KEYS:
        v = os.environ.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


class PbfPoiCollector(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self._wkb = osmium.geom.WKBFactory()
        self._rows: list[tuple[str, int, float, float, dict[str, str]]] = []
        self._seen: set[tuple[str, int]] = set()
        self.nodes_kept = 0
        self.ways_kept = 0
        self.nodes_skipped_geom = 0
        self.ways_skipped_geom = 0

    def _emit(self, osm_type: str, osm_id: int, lon: float, lat: float, tags: dict[str, str]) -> None:
        key = (osm_type, osm_id)
        if key in self._seen:
            return
        if not poi_tags_interesting(tags):
            return
        self._seen.add(key)
        self._rows.append((osm_type, osm_id, lon, lat, tags_stored_for_postgres(tags)))
        if osm_type == "n":
            self.nodes_kept += 1
        else:
            self.ways_kept += 1

    def node(self, n: osmium.osm.Node) -> None:
        tags = tags_dict(dict(n.tags))
        if not poi_tags_interesting(tags):
            return
        try:
            wkb = self._wkb.create_point(n)
            g = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.nodes_skipped_geom += 1
            return
        self._emit("n", int(n.id), float(g.x), float(g.y), tags)

    def way(self, w: osmium.osm.Way) -> None:
        if not w.is_closed():
            return
        tags = tags_dict(dict(w.tags))
        if not poi_tags_interesting(tags):
            return
        try:
            wkb = self._wkb.create_linestring(w)
            line = _geom_from_osmium_wkb(wkb)
            c = line.centroid
        except Exception:
            self.ways_skipped_geom += 1
            return
        self._emit("w", int(w.id), float(c.x), float(c.y), tags)


def apply_osm_poi_schema_sql(cur: Any) -> None:
    """Applique data-pipeline/sql/004_osm_poi.sql (sans psql)."""
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "004_osm_poi.sql"
    if not sql_path.is_file():
        raise FileNotFoundError(f"Fichier SQL introuvable: {sql_path}")
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    blob = "\n".join(lines)
    for chunk in blob.split(";"):
        stmt = chunk.strip()
        if not stmt:
            continue
        cur.execute(stmt + ";")


def insert_batch_executemany(
    cur: Any,
    qualified: str,
    batch: list[tuple[str, int, float, float, dict[str, str]]],
) -> None:
    import psycopg2.extras

    rows = [(ot, oid, lon, lat, psycopg2.extras.Json(td)) for ot, oid, lon, lat, td in batch]
    psycopg2.extras.execute_batch(
        cur,
        f"""
        INSERT INTO {qualified} (osm_type, osm_id, geom, tags)
        VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          tags = EXCLUDED.tags,
          imported_at = now()
        """,
        rows,
        page_size=max(1, len(rows)),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Import POI OSM (PBF) vers public.osm_poi")
    ap.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Fichier .osm.pbf (requis sauf si seul --ensure-schema).",
    )
    ap.add_argument(
        "--ensure-schema",
        action="store_true",
        help="Crée la table public.osm_poi (PostGIS) depuis sql/004_osm_poi.sql si besoin.",
    )
    ap.add_argument(
        "--truncate",
        action="store_true",
        help="TRUNCATE la table osm_poi avant import (destructif).",
    )
    ap.add_argument("--batch-size", type=int, default=800, help="Taille des lots INSERT")
    args = ap.parse_args()

    if args.input is None and not args.ensure_schema:
        ap.error("indiquez --input fichier.osm.pbf et/ou --ensure-schema")

    url = resolve_database_url()
    if not url:
        print("Aucune URL Postgres (DATABASE_URL, LOCAL_DATABASE_URL, …)", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("psycopg2-binary requis", file=sys.stderr)
        return 1

    conn_s = None
    try:
        conn_s = psycopg2.connect(url)
        conn_s.autocommit = True
        with conn_s.cursor() as cur:
            apply_osm_poi_schema_sql(cur)
        print(f"[osm_poi] Schéma vérifié ({qualified_osm_poi_table()})", flush=True)
    except Exception as e:
        print(f"[osm_poi] Erreur schéma: {e}", file=sys.stderr)
        return 1
    finally:
        if conn_s is not None:
            conn_s.close()

    if args.input is None:
        return 0

    pbf = args.input
    assert pbf is not None
    if not pbf.is_file():
        print(f"Fichier introuvable: {pbf}", file=sys.stderr)
        return 1

    qualified = qualified_osm_poi_table()
    collector = PbfPoiCollector()
    print(f"[osm_poi] Lecture PBF: {pbf}", flush=True)
    collector.apply_file(str(pbf), locations=True, idx="flex_mem")
    all_rows = collector._rows

    conn = psycopg2.connect(url)
    inserted = 0
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            if args.truncate:
                cur.execute(f"TRUNCATE TABLE {qualified}")
                print(f"[osm_poi] TRUNCATE {qualified}", flush=True)
            bs = max(1, int(args.batch_size))
            for i in range(0, len(all_rows), bs):
                chunk = all_rows[i : i + bs]
                insert_batch_executemany(cur, qualified, chunk)
                inserted += len(chunk)
                if inserted and inserted % (bs * 10) == 0:
                    print(f"[osm_poi] … {inserted} lignes", flush=True)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[osm_poi] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    print(
        f"[osm_poi] Terminé — upsert {inserted} | nœuds {collector.nodes_kept} | ways {collector.ways_kept} | "
        f"geom ignorés nœud/way: {collector.nodes_skipped_geom}/{collector.ways_skipped_geom}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
