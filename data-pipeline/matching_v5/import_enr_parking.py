#!/usr/bin/env python3
"""
Import GPKG ENR PARK-SUP-500 → Postgres (public.enr_parking_areas).

  python3 data-pipeline/matching_v5/import_enr_parking.py --ensure-schema
  python3 data-pipeline/matching_v5/import_enr_parking.py --input datasource/enr/.../L15_....gpkg --truncate
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

from enr_parking_v5 import (  # noqa: E402
    DEFAULT_GPKG_LAYER,
    DEFAULT_GPKG_REL,
    DEFAULT_PARKING_TAG,
    DEFAULT_PARKING_VALUE,
    enr_tags_from_row,
    qualified_enr_parking_table,
    stable_enr_id,
)
from import_osm_parking import (  # noqa: E402
    DATABASE_URL_ENV_KEYS,
    _normalize_polygonal,
    resolve_database_url,
)

ENR_DOWNLOAD_URL = (
    "https://data.geopf.fr/telechargement/download/ENR/"
    "ENR_2-0_PARK-SUP-500_GPKG_WLD_WM_2026-02-01/"
    "ENR_2-0_PARK-SUP-500_GPKG_WLD_WM_2026-02-01.7z"
)
DEFAULT_7Z = REPO_ROOT / "datasource/enr/ENR_2-0_PARK-SUP-500.7z"


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env.local", ".env"):
        p = REPO_ROOT / name
        if p.is_file():
            load_dotenv(p)


def apply_enr_parking_schema_sql(cur: Any) -> None:
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "009_enr_parking_areas.sql"
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            cur.execute(stmt + ";")


def download_archive(dest: Path) -> int:
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[enr_parking] Téléchargement → {dest}", flush=True)
    urllib.request.urlretrieve(ENR_DOWNLOAD_URL, dest)
    print(f"[enr_parking] Téléchargement terminé ({dest.stat().st_size} octets)", flush=True)
    return 0


def extract_7z(archive: Path, out_dir: Path) -> Path | None:
    try:
        import py7zr
    except ImportError:
        print("py7zr requis : pip install py7zr", file=sys.stderr)
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    with py7zr.SevenZipFile(archive, "r") as z:
        z.extractall(path=out_dir)
    for gpkg in out_dir.rglob("*.gpkg"):
        return gpkg
    return None


def resolve_default_gpkg() -> Path | None:
    p = REPO_ROOT / DEFAULT_GPKG_REL
    if p.is_file():
        return p
    enr_dir = REPO_ROOT / "datasource/enr"
    if not enr_dir.is_dir():
        return None
    matches = sorted(enr_dir.rglob("L15_Parkings_sup500m2_EPSG4326.gpkg"))
    return matches[0] if matches else None


def load_gpkg_rows(gpkg_path: Path, layer: str) -> list[tuple[int, str, str, str, dict[str, Any]]]:
    import geopandas as gpd

    gdf = gpd.read_file(gpkg_path, layer=layer)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif str(gdf.crs) != "EPSG:4326":
        gdf = gdf.to_crs("EPSG:4326")

    out: list[tuple[int, str, str, str, dict[str, Any]]] = []
    seen: set[int] = set()
    skipped = 0
    for _, row in gdf.iterrows():
        geom = row.geometry
        norm = _normalize_polygonal(geom)
        if norm is None:
            skipped += 1
            continue
        wkt = norm.wkt
        num_com = str(row.get("NumCom") or "").strip()
        surfm2 = int(row.get("Surfm2") or 0)
        eid = stable_enr_id(num_com, surfm2, wkt)
        if eid in seen:
            skipped += 1
            continue
        seen.add(eid)
        props = {k: row[k] for k in gdf.columns if k != "geometry"}
        tags = enr_tags_from_row(props)
        out.append((eid, wkt, DEFAULT_PARKING_TAG, DEFAULT_PARKING_VALUE, tags))
    print(
        f"[enr_parking] GPKG lu — {len(out)} polygone(s), {skipped} ignoré(s)",
        flush=True,
    )
    return out


def insert_batch(
    cur: Any,
    qualified: str,
    batch: list[tuple[int, str, str, str, dict[str, Any]]],
) -> None:
    import psycopg2.extras

    rows = [
        (eid, wkt, ptag, pval, psycopg2.extras.Json(tags))
        for eid, wkt, ptag, pval, tags in batch
    ]
    psycopg2.extras.execute_batch(
        cur,
        f"""
        INSERT INTO {qualified} (enr_id, geom, parking_tag, parking_value, tags)
        VALUES (%s, ST_SetSRID(ST_GeomFromText(%s), 4326)::geometry(MultiPolygon, 4326), %s, %s, %s)
        ON CONFLICT (enr_id) DO UPDATE SET
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
    _load_dotenv()
    ap = argparse.ArgumentParser(description="Import parking ENR PARK-SUP-500 (GPKG)")
    ap.add_argument("--input", type=Path, default=None, help="Chemin .gpkg (défaut : extrait sous datasource/enr/)")
    ap.add_argument("--layer", type=str, default=DEFAULT_GPKG_LAYER)
    ap.add_argument("--ensure-schema", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument("--batch-size", type=int, default=800)
    ap.add_argument("--download", action="store_true", help="Télécharge le 7z officiel puis extrait")
    args = ap.parse_args()

    if args.download:
        if not DEFAULT_7Z.is_file():
            if download_archive(DEFAULT_7Z) != 0:
                return 1
        gpkg = extract_7z(DEFAULT_7Z, REPO_ROOT / "datasource/enr")
        if gpkg is None:
            return 1
        print(f"[enr_parking] GPKG extrait : {gpkg}", flush=True)

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
            apply_enr_parking_schema_sql(cur)
    finally:
        conn_s.close()
    print(f"[enr_parking] Schéma vérifié ({qualified_enr_parking_table()})", flush=True)

    if args.ensure_schema and not args.truncate and args.input is None:
        return 0

    gpkg_path = args.input
    if gpkg_path is None:
        gpkg_path = resolve_default_gpkg()
    if gpkg_path is None:
        ap.error("indiquez --input, --download, ou placez le GPKG sous datasource/enr/")
    if not gpkg_path.is_file():
        print(f"Fichier introuvable: {gpkg_path}", file=sys.stderr)
        return 1

    rows = load_gpkg_rows(gpkg_path, args.layer)
    qualified = qualified_enr_parking_table()
    conn = psycopg2.connect(url)
    inserted = 0
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            if args.truncate:
                cur.execute(f"TRUNCATE TABLE {qualified}")
            bs = max(1, int(args.batch_size))
            for i in range(0, len(rows), bs):
                chunk = rows[i : i + bs]
                insert_batch(cur, qualified, chunk)
                inserted += len(chunk)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[enr_parking] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(f"[enr_parking] Terminé — upsert {inserted}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
