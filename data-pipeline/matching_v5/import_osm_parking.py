#!/usr/bin/env python3
"""
Import polygones OSM parking (.osm.pbf) vers Postgres (public.osm_parking_areas).

  python3 data-pipeline/matching_v5/import_osm_parking.py --input chemin.osm.pbf --truncate
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Callable

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

from osm_parking_v5 import DEFAULT_PARKING_TAGS, qualified_osm_parking_table  # noqa: E402
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

_PARKING_TAG_KEYS = frozenset({"name", "operator", "capacity", "fee", "access", "surface", "maxstay", "parking"})


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


def parking_tag_from_tags(tags: dict[str, str]) -> tuple[str, str] | None:
    """Priorité amenity > leisure > landuse, valeur parking uniquement."""
    for key, expected in DEFAULT_PARKING_TAGS:
        raw = str(tags.get(key) or "").strip().lower()
        if raw == expected:
            return key, expected
    return None


def build_parking_matcher(allowed_csv: str) -> Callable[[dict[str, str]], tuple[str, str] | None]:
    if not (allowed_csv or "").strip():
        allowed = list(DEFAULT_PARKING_TAGS)
    else:
        allowed = []
        for chunk in allowed_csv.split(","):
            part = chunk.strip()
            if not part:
                continue
            if "=" in part:
                k, v = part.split("=", 1)
                allowed.append((k.strip().lower(), v.strip().lower()))
            else:
                allowed.append((part.strip().lower(), "parking"))
    allowed_set = frozenset(allowed)

    def match(tags: dict[str, str]) -> tuple[str, str] | None:
        for key, expected in (("amenity", "parking"), ("leisure", "parking"), ("landuse", "parking")):
            if (key, expected) not in allowed_set:
                continue
            raw = str(tags.get(key) or "").strip().lower()
            if raw == expected:
                return key, expected
        return None

    return match


def _tags_stored(tags: dict[str, str], parking_tag: str, parking_value: str) -> dict[str, str]:
    out: dict[str, str] = {parking_tag: parking_value}
    for k, v in tags.items():
        lk = str(k).strip()
        if not lk or lk == parking_tag:
            continue
        if lk in _PARKING_TAG_KEYS or lk.startswith("source"):
            sv = str(v).strip()
            if sv:
                out[lk] = sv
    return out


class PbfParkingCollector(osmium.SimpleHandler):
    def __init__(self, tag_match: Callable[[dict[str, str]], tuple[str, str] | None]) -> None:
        super().__init__()
        self._wkb = osmium.geom.WKBFactory()
        self._tag_match = tag_match
        self.rows: list[tuple[str, int, str, str, str, dict[str, str]]] = []
        self._seen: set[tuple[str, int]] = set()
        self.ways_kept = 0
        self.relations_kept = 0
        self.skipped_geom = 0
        self.skipped_tag = 0

    def _emit(
        self,
        osm_type: str,
        osm_id: int,
        geom: Any,
        tags: dict[str, str],
        parking_tag: str,
        parking_value: str,
    ) -> None:
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
                parking_tag,
                parking_value,
                _tags_stored(tags, parking_tag, parking_value),
            )
        )
        if osm_type == "w":
            self.ways_kept += 1
        else:
            self.relations_kept += 1

    def way(self, w: osmium.osm.Way) -> None:
        # Ways fermées taggées parking sont aussi traitées par area() (évite doublon w:123 + r:-123).
        return

    def area(self, a: osmium.osm.Area) -> None:
        tags = tags_dict(dict(a.tags))
        hit = self._tag_match(tags)
        if hit is None:
            self.skipped_tag += 1
            return
        parking_tag, parking_value = hit
        try:
            wkb = self._wkb.create_multipolygon(a)
            geom = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.skipped_geom += 1
            return
        if a.from_way():
            self._emit("w", abs(int(a.id)), geom, tags, parking_tag, parking_value)
        else:
            self._emit("r", int(a.id), geom, tags, parking_tag, parking_value)


def apply_osm_parking_schema_sql(cur: Any) -> None:
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "008_osm_parking_areas.sql"
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            cur.execute(stmt + ";")


def insert_batch(
    cur: Any,
    qualified: str,
    batch: list[tuple[str, int, str, str, str, dict[str, str]]],
) -> None:
    import psycopg2.extras

    rows = [
        (ot, oid, wkt, ptag, pval, psycopg2.extras.Json(tags))
        for ot, oid, wkt, ptag, pval, tags in batch
    ]
    psycopg2.extras.execute_batch(
        cur,
        f"""
        INSERT INTO {qualified} (osm_type, osm_id, geom, parking_tag, parking_value, tags)
        VALUES (%s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326)::geometry(MultiPolygon, 4326), %s, %s, %s)
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          parking_tag = EXCLUDED.parking_tag,
          parking_value = EXCLUDED.parking_value,
          tags = EXCLUDED.tags,
          imported_at = now()
        """,
        rows,
        page_size=max(1, len(rows)),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Import polygones parking OSM (PBF)")
    ap.add_argument("--input", type=Path, default=None)
    ap.add_argument("--ensure-schema", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument("--batch-size", type=int, default=600)
    ap.add_argument(
        "--allowed-parking",
        type=str,
        default="",
        help="Liste CSV tag=valeur (défaut amenity=parking,leisure=parking,landuse=parking)",
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
            apply_osm_parking_schema_sql(cur)
    finally:
        conn_s.close()
    print(f"[osm_parking] Schéma vérifié ({qualified_osm_parking_table()})", flush=True)
    if args.input is None:
        return 0

    if not args.input.is_file():
        print(f"Fichier introuvable: {args.input}", file=sys.stderr)
        return 1

    matcher = build_parking_matcher(args.allowed_parking or "")
    collector = PbfParkingCollector(matcher)
    print(f"[osm_parking] Lecture PBF: {args.input}", flush=True)
    collector.apply_file(str(args.input), locations=True, idx="flex_mem")

    qualified = qualified_osm_parking_table()
    conn = psycopg2.connect(url)
    inserted = 0
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
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[osm_parking] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(
        f"[osm_parking] Terminé — upsert {inserted} | ways {collector.ways_kept} | "
        f"relations {collector.relations_kept} | geom ignorées {collector.skipped_geom} | "
        f"tags filtrés {collector.skipped_tag}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
