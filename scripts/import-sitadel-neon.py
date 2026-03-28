#!/usr/bin/env python3
from __future__ import annotations

"""
Import Sitadel (locaux non résidentiels) into Neon Postgres with C&I filtering.

Input files (downloaded/extracted beforehand):
  data/sitadel/extracted/<year>/*.csv

Observed CSV characteristics:
- delimiter: ';'
- quotechar: '\"'
- encoding: utf-8 (fallback latin-1)

Deduplication:
- UNIQUE(num_permis) + ON CONFLICT (num_permis) DO NOTHING
"""

import argparse
import json
import os
import re
import time
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd
import psycopg2
import psycopg2.extras
import numpy as np


TARGET_TABLE = "public.sitadel_locaux_ci"
APICARTO_LOCALISANT_URL = "https://apicarto.ign.fr/api/cadastre/localisant"
APICARTO_PARCELLE_URL = "https://apicarto.ign.fr/api/cadastre/parcelle"


def _read_env_from_dotenv(dotenv_path: Path) -> dict[str, str]:
    if not dotenv_path.exists():
        return {}
    out: dict[str, str] = {}
    for raw in dotenv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        out[k] = v
    return out


def get_neon_database_url() -> str:
    v = os.getenv("NEON_DATABASE_URL")
    if v:
        return v
    dotenv = _read_env_from_dotenv(Path(".env.local"))
    v2 = dotenv.get("NEON_DATABASE_URL")
    if v2:
        return v2
    raise RuntimeError(
        "NEON_DATABASE_URL introuvable (env ou .env.local). "
        "Attendu: postgresql://user:password@host/dbname?sslmode=require"
    )


def list_extracted_csvs(data_dir: Path, years: Optional[set[int]] = None) -> list[tuple[int, Path]]:
    out: list[tuple[int, Path]] = []
    if not data_dir.exists():
        return out
    for year_dir in sorted([p for p in data_dir.iterdir() if p.is_dir()]):
        if not re.fullmatch(r"\d{4}", year_dir.name):
            continue
        y = int(year_dir.name)
        if years is not None and y not in years:
            continue
        for csv_path in sorted(year_dir.glob("*.csv")):
            out.append((y, csv_path))
    return out


def compute_dep_from_comm(comm: Optional[str]) -> Optional[str]:
    if comm is None or pd.isna(comm):
        return None
    c = str(comm).strip()
    if not c:
        return None
    if c.startswith(("97", "98")) and len(c) >= 3:
        return c[:3]
    return c[:2] if len(c) >= 2 else None


# DiDo extract uses integer codes for destination and etat.
# We map only the C&I destinations to requested Sitadel codes:
# 02=bureaux, 03=commerce, 04=industrie, 05=entrepôt.
DEST_MAP = {3: "02", 4: "03", 6: "04", 8: "05"}
ETAT_MAP = {2: "AT", 5: "CO", 6: "TE", 4: "AN"}


def to_int_or_none(v) -> Optional[int]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        if isinstance(v, str):
            t = v.strip().replace("\u00a0", "").replace(" ", "")
            if t == "":
                return None
            return int(float(t.replace(",", ".")))
        return int(v)
    except Exception:
        return None


def yyyymm_from_date_str(s: Optional[str]) -> Optional[str]:
    if s is None or pd.isna(s):
        return None
    t = str(s).strip()
    if not t:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
        return t[:7]
    if re.fullmatch(r"\d{4}-\d{2}", t):
        return t
    return None


def derive_nature_projet(surf_loc_avant, surf_loc_creee) -> Optional[str]:
    a = to_int_or_none(surf_loc_avant)
    c = to_int_or_none(surf_loc_creee)
    if c is None or c <= 0:
        return None
    if a is None:
        return None
    return "NC" if a == 0 else ("EX" if a > 0 else None)


def read_sitadel_csv(csv_path: Path) -> pd.DataFrame:
    last_err: Optional[Exception] = None
    for enc in ("utf-8", "latin-1"):
        try:
            return pd.read_csv(
                csv_path,
                sep=";",
                quotechar='"',
                encoding=enc,
                dtype_backend="numpy_nullable",
            )
        except Exception as e:
            last_err = e
    raise last_err or RuntimeError(f"Impossible de lire {csv_path}")


def normalize_df(df: pd.DataFrame, annee_source: int) -> pd.DataFrame:
    def col(name: str):
        if name in df.columns:
            return df[name]
        return pd.Series([pd.NA] * len(df))

    def col_any(*names: str):
        for n in names:
            if n in df.columns:
                return df[n]
        return pd.Series([pd.NA] * len(df))

    out = pd.DataFrame(
        {
            "num_permis": col("NUM_DAU").astype("string"),
            "comm": col("COMM").astype("string"),
            "sec_cadastre1": col("SEC_CADASTRE1").astype("string"),
            "num_cadastre1": col("NUM_CADASTRE1").astype("string"),
        }
    )
    out["dep"] = out["comm"].map(compute_dep_from_comm)
    out["dest_loc"] = col("DESTINATION_PRINCIPALE").map(lambda v: DEST_MAP.get(to_int_or_none(v)))
    out["surf_loc"] = col("SURF_LOC_CREEE").map(to_int_or_none)
    out["nature_projet"] = pd.Series(
        (derive_nature_projet(a, c) for a, c in zip(col("SURF_LOC_AVANT"), col("SURF_LOC_CREEE"))),
        dtype="string",
    )
    out["etat_dau"] = col("ETAT_DAU").map(lambda v: ETAT_MAP.get(to_int_or_none(v)))
    out["date_reelle_auth"] = col("DATE_REELLE_AUTORISATION").astype("string").map(yyyymm_from_date_str)
    out["date_doc"] = col("DATE_REELLE_DOC").astype("string").map(yyyymm_from_date_str)
    # Ces colonnes n'existent pas dans l'extraction C&I actuelle (11 colonnes),
    # mais seront remplies si tu importes un CSV complet Sitadel.
    out["date_ouverture_chantier"] = col("DATE_REELLE_OUVERTURE_CHANTIER").astype("string").map(yyyymm_from_date_str)
    out["date_achevement_travaux"] = col("DATE_REELLE_ACHÈVEMENT_DES_TRAVAUX").astype("string").map(yyyymm_from_date_str)
    # TYPE_MO is available only in some Sitadel extracts.
    # We support both technical and verbose French headers.
    out["type_mo"] = col_any(
        "TYPE_MO",
        "CAT_DEM",
        "Catégorie du demandeur (maître d’ouvrage) selon Sitadel",
        "Catégorie du demandeur (maître d'ouvrage) selon Sitadel",
    ).astype("string")
    out["ape_dem"] = col_any(
        "APE_DEM",
        "Code d'activité principale de l'établissement d'un demandeur avéré en tant que personne morale",
    ).astype("string")
    out["cj_dem"] = col_any(
        "CJ_DEM",
        "Catégorie juridique d'un demandeur avéré en tant que personne morale",
    ).astype("string")
    out["denom_dem"] = col_any(
        "DENOM_DEM",
        "Dénomination d'un demandeur avéré en tant que personne morale",
    ).astype("string")
    out["siren_dem"] = col_any(
        "SIREN_DEM",
        "Numéro SIREN d'un demandeur avéré en tant que personne morale",
    ).astype("string")
    out["siret_dem"] = col_any(
        "SIRET_DEM",
        "Numéro SIRET d'un demandeur avéré en tant que personne morale",
    ).astype("string")
    out["surf_terrain"] = col("SUPERFICIE_TERRAIN").map(to_int_or_none)
    out["annee_source"] = int(annee_source)

    # pandas NA -> None
    for c in [
        "num_permis",
        "comm",
        "sec_cadastre1",
        "num_cadastre1",
        "nature_projet",
        "type_mo",
        "ape_dem",
        "cj_dem",
        "denom_dem",
        "siren_dem",
        "siret_dem",
    ]:
        out[c] = out[c].where(out[c].notna(), None)
    return out


def filter_ci(df: pd.DataFrame) -> pd.DataFrame:
    df2 = df.copy()
    df2 = df2[df2["dest_loc"].isin(["02", "03", "04", "05"])]
    df2 = df2[df2["surf_loc"].fillna(0).astype(int) > 1000]
    df2 = df2[df2["etat_dau"].isin(["AT", "CO"])]
    return df2


SCHEMA_SQL = f"""
CREATE TABLE IF NOT EXISTS {TARGET_TABLE} (
  id                  SERIAL PRIMARY KEY,
  num_permis          TEXT,
  comm                TEXT,
  dep                 TEXT,
  sec_cadastre1       TEXT,
  num_cadastre1       TEXT,
  dest_loc            TEXT,
  surf_loc            INTEGER,
  nature_projet       TEXT,
  etat_dau            TEXT,
  date_reelle_auth    TEXT,
  date_doc            TEXT,
  date_ouverture_chantier TEXT,
  date_achevement_travaux TEXT,
  type_mo             TEXT,
  ape_dem             TEXT,
  cj_dem              TEXT,
  denom_dem           TEXT,
  siren_dem           TEXT,
  siret_dem           TEXT,
  surf_terrain        INTEGER,
  annee_source        INTEGER,
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  cadastre_polygon_geojson JSONB
);
"""

UNIQUE_SQL = f"CREATE UNIQUE INDEX IF NOT EXISTS sitadel_locaux_ci_num_permis_uidx ON {TARGET_TABLE} (num_permis);"

INDEXES_SQL = [
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_dest_loc_idx ON {TARGET_TABLE} (dest_loc);",
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_comm_idx ON {TARGET_TABLE} (comm);",
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_date_reelle_auth_idx ON {TARGET_TABLE} (date_reelle_auth);",
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_surf_loc_idx ON {TARGET_TABLE} (surf_loc);",
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_lat_lng_idx ON {TARGET_TABLE} (lat, lng);",
    f"CREATE INDEX IF NOT EXISTS sitadel_locaux_ci_cadastre_polygon_gin_idx ON {TARGET_TABLE} USING GIN (cadastre_polygon_geojson);",
]


def connect_pg(database_url: str):
    return psycopg2.connect(database_url)


def create_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
        cur.execute(UNIQUE_SQL)
    conn.commit()


def ensure_geo_columns(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS cadastre_polygon_geojson JSONB;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS date_ouverture_chantier TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS date_achevement_travaux TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS type_mo TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS ape_dem TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS cj_dem TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS denom_dem TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS siren_dem TEXT;")
        cur.execute(f"ALTER TABLE {TARGET_TABLE} ADD COLUMN IF NOT EXISTS siret_dem TEXT;")
    conn.commit()


def create_indexes(conn) -> None:
    with conn.cursor() as cur:
        for sql in INDEXES_SQL:
            cur.execute(sql)
    conn.commit()


def pad_parcel_num(num: Optional[str]) -> Optional[str]:
    if not num:
        return None
    s = re.sub(r"\D", "", str(num))
    if not s:
        return None
    if len(s) <= 4:
        return s.zfill(4)
    return s[-4:]


def extract_lat_lng_from_geojson(geo: dict) -> tuple[Optional[float], Optional[float]]:
    features = geo.get("features") if isinstance(geo, dict) else None
    if not features or not isinstance(features, list):
        return (None, None)
    first = features[0] if features else None
    if not isinstance(first, dict):
        return (None, None)
    geom = first.get("geometry")
    if not isinstance(geom, dict):
        return (None, None)
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Point" and isinstance(coords, list) and len(coords) >= 2:
        lng, lat = coords[0], coords[1]
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            return (float(lat), float(lng))
    if gtype == "MultiPoint" and isinstance(coords, list) and len(coords) > 0:
        first = coords[0]
        if isinstance(first, list) and len(first) >= 2:
            lng, lat = first[0], first[1]
            if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                return (float(lat), float(lng))
    # Fallback centroid for Polygon / MultiPolygon if ever returned
    points: list[tuple[float, float]] = []
    if gtype == "Polygon" and isinstance(coords, list):
        for ring in coords:
            if isinstance(ring, list):
                for p in ring:
                    if isinstance(p, list) and len(p) >= 2 and isinstance(p[0], (int, float)) and isinstance(p[1], (int, float)):
                        points.append((float(p[1]), float(p[0])))
    elif gtype == "MultiPolygon" and isinstance(coords, list):
        for poly in coords:
            if isinstance(poly, list):
                for ring in poly:
                    if isinstance(ring, list):
                        for p in ring:
                            if isinstance(p, list) and len(p) >= 2 and isinstance(p[0], (int, float)) and isinstance(p[1], (int, float)):
                                points.append((float(p[1]), float(p[0])))
    if not points:
        return (None, None)
    lat = sum(p[0] for p in points) / len(points)
    lng = sum(p[1] for p in points) / len(points)
    return (lat, lng)


def fetch_localisant_lat_lng(code_insee: str, section: str, numero: str, timeout_s: int = 15) -> tuple[Optional[float], Optional[float]]:
    params = urlencode({"code_insee": code_insee, "section": section, "numero": numero})
    url = f"{APICARTO_LOCALISANT_URL}?{params}"
    req = Request(url, headers={"User-Agent": "solar-view-importer/1.0"})
    with urlopen(req, timeout=timeout_s) as resp:
        payload = resp.read()
    geo = json.loads(payload.decode("utf-8", errors="replace"))
    return extract_lat_lng_from_geojson(geo)


def fetch_parcelle_geojson(code_insee: str, section: str, numero: str, timeout_s: int = 15) -> Optional[dict]:
    params = urlencode({"code_insee": code_insee, "section": section, "numero": numero})
    url = f"{APICARTO_PARCELLE_URL}?{params}"
    req = Request(url, headers={"User-Agent": "solar-view-importer/1.0"})
    with urlopen(req, timeout=timeout_s) as resp:
        payload = resp.read()
    geo = json.loads(payload.decode("utf-8", errors="replace"))
    if not isinstance(geo, dict):
        return None
    features = geo.get("features")
    if not isinstance(features, list) or len(features) == 0:
        return None
    return geo


def backfill_parcelle_polygons(conn, limit: int = 0, sleep_ms: int = 0) -> None:
    with conn.cursor() as cur:
        sql = f"""
        SELECT id, comm, sec_cadastre1, num_cadastre1
        FROM {TARGET_TABLE}
        WHERE cadastre_polygon_geojson IS NULL
          AND comm IS NOT NULL
          AND sec_cadastre1 IS NOT NULL
          AND num_cadastre1 IS NOT NULL
        ORDER BY id
        """
        if limit > 0:
            sql += " LIMIT %s"
            cur.execute(sql, (limit,))
        else:
            cur.execute(sql)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    missing = 0
    failed = 0
    for idx, (row_id, comm, sec, num) in enumerate(rows, start=1):
        code_insee = str(comm).strip()
        section = str(sec).strip()
        numero = pad_parcel_num(str(num))
        if not code_insee or not section or not numero:
            missing += 1
            continue
        try:
            geo = fetch_parcelle_geojson(code_insee, section, numero)
            if geo is None:
                missing += 1
            else:
                lat, lng = extract_lat_lng_from_geojson(geo)
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        UPDATE {TARGET_TABLE}
                        SET cadastre_polygon_geojson = %s::jsonb,
                            lat = COALESCE(%s, lat),
                            lng = COALESCE(%s, lng)
                        WHERE id = %s
                        """,
                        (json.dumps(geo), lat, lng, row_id),
                    )
                conn.commit()
                ok += 1
        except Exception:
            failed += 1
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)
        if idx % 100 == 0 or idx == total:
            print(f"[parcelle] {idx}/{total} ok={ok} missing={missing} failed={failed}")
    print(f"[parcelle] termine: total={total} ok={ok} missing={missing} failed={failed}")


def backfill_localisant(conn, limit: int = 0, sleep_ms: int = 0) -> None:
    with conn.cursor() as cur:
        sql = f"""
        SELECT id, comm, sec_cadastre1, num_cadastre1
        FROM {TARGET_TABLE}
        WHERE lat IS NULL
          AND lng IS NULL
          AND comm IS NOT NULL
          AND sec_cadastre1 IS NOT NULL
          AND num_cadastre1 IS NOT NULL
        ORDER BY id
        """
        if limit > 0:
            sql += " LIMIT %s"
            cur.execute(sql, (limit,))
        else:
            cur.execute(sql)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    missing = 0
    failed = 0
    for idx, (row_id, comm, sec, num) in enumerate(rows, start=1):
        code_insee = str(comm).strip()
        section = str(sec).strip()
        numero = pad_parcel_num(str(num))
        if not code_insee or not section or not numero:
            missing += 1
            continue
        try:
            lat, lng = fetch_localisant_lat_lng(code_insee, section, numero)
            if lat is None or lng is None:
                missing += 1
            else:
                with conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE {TARGET_TABLE} SET lat = %s, lng = %s WHERE id = %s",
                        (lat, lng, row_id),
                    )
                conn.commit()
                ok += 1
        except Exception:
            failed += 1
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)
        if idx % 100 == 0 or idx == total:
            print(f"[localisant] {idx}/{total} ok={ok} missing={missing} failed={failed}")
    print(f"[localisant] termine: total={total} ok={ok} missing={missing} failed={failed}")


def insert_rows(conn, df: pd.DataFrame, batch_size: int = 10_000) -> int:
    cols = [
        "num_permis",
        "comm",
        "dep",
        "sec_cadastre1",
        "num_cadastre1",
        "dest_loc",
        "surf_loc",
        "nature_projet",
        "etat_dau",
        "date_reelle_auth",
        "date_doc",
        "date_ouverture_chantier",
        "date_achevement_travaux",
        "type_mo",
        "ape_dem",
        "cj_dem",
        "denom_dem",
        "siren_dem",
        "siret_dem",
        "surf_terrain",
        "annee_source",
    ]
    sql = f"INSERT INTO {TARGET_TABLE} ({', '.join(cols)}) VALUES %s ON CONFLICT (num_permis) DO NOTHING"

    def adapt(v):
        if v is None or pd.isna(v):
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            fv = float(v)
            return None if (fv != fv) else fv
        return v

    attempted = 0
    with conn.cursor() as cur:
        for i in range(0, len(df), batch_size):
            chunk = df.iloc[i : i + batch_size]
            values = [
                tuple(adapt(chunk[c].iloc[j]) for c in cols)
                for j in range(len(chunk))
            ]
            psycopg2.extras.execute_values(cur, sql, values, page_size=2000)
            attempted += len(values)
    conn.commit()
    return attempted


def print_stats(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*)::bigint FROM {TARGET_TABLE};")
        total = cur.fetchone()[0]
        print(f"[stats] total_lignes: {total}")

        cur.execute(f"SELECT dest_loc, COUNT(*)::bigint AS n FROM {TARGET_TABLE} GROUP BY dest_loc ORDER BY dest_loc;")
        print("[stats] repartition_dest_loc:")
        for dest_loc, n in cur.fetchall():
            print(f"  {dest_loc}: {n}")

        cur.execute(
            f"SELECT comm, COUNT(*)::bigint AS n FROM {TARGET_TABLE} GROUP BY comm ORDER BY n DESC LIMIT 10;"
        )
        print("[stats] top_10_communes:")
        for comm, n in cur.fetchall():
            print(f"  {comm}: {n}")

        cur.execute(
            f"""
            SELECT num_permis, comm, dest_loc, surf_loc
            FROM {TARGET_TABLE}
            WHERE surf_loc IS NOT NULL
            ORDER BY surf_loc DESC
            LIMIT 5;
            """
        )
        print("[stats] top_5_surf_loc:")
        for num_permis, comm, dest_loc, surf_loc in cur.fetchall():
            print(f"  {surf_loc} m2 | {dest_loc} | {comm} | {num_permis}")


def parse_years_arg(s: Optional[str]) -> Optional[set[int]]:
    if not s:
        return None
    years: set[int] = set()
    for part in s.split(","):
        t = part.strip()
        if not t:
            continue
        years.add(int(t))
    return years


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/sitadel/extracted")
    ap.add_argument("--years", default=None)
    ap.add_argument("--batch-size", type=int, default=10_000)
    ap.add_argument("--create-schema", action="store_true")
    ap.add_argument("--add-geo-columns", action="store_true")
    ap.add_argument("--create-indexes", action="store_true")
    ap.add_argument("--import", dest="do_import", action="store_true")
    ap.add_argument("--backfill-localisant", action="store_true")
    ap.add_argument("--backfill-parcelle", action="store_true")
    ap.add_argument("--backfill-limit", type=int, default=0)
    ap.add_argument("--backfill-sleep-ms", type=int, default=0)
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    years = parse_years_arg(args.years)
    files = list_extracted_csvs(Path(args.data_dir), years)
    if args.do_import and not files:
        print(f"Aucun CSV trouve dans {args.data_dir}", file=sys.stderr)
        return 2

    conn = connect_pg(get_neon_database_url())
    try:
        if args.create_schema:
            print("[db] create schema...")
            create_schema(conn)
        if args.add_geo_columns:
            print("[db] ensure lat/lng columns...")
            ensure_geo_columns(conn)

        if args.do_import:
            total_read = 0
            total_filtered = 0
            total_attempted = 0
            for y, p in files:
                print(f"[import] {y} -> {p}")
                df_raw = read_sitadel_csv(p)
                total_read += len(df_raw)
                df_norm = normalize_df(df_raw, annee_source=y)
                df_f = filter_ci(df_norm)
                total_filtered += len(df_f)
                attempted = insert_rows(conn, df_f, batch_size=args.batch_size)
                total_attempted += attempted
                print(f"[import] {y}: lu={len(df_raw)} filtre={len(df_f)} tente_insert={attempted}")
            print(f"[import] total: lu={total_read} filtre={total_filtered} tente_insert={total_attempted}")

        if args.create_indexes:
            print("[db] create indexes...")
            create_indexes(conn)

        if args.backfill_localisant:
            print("[db] backfill lat/lng via APICarto localisant...")
            backfill_localisant(
                conn,
                limit=max(0, int(args.backfill_limit)),
                sleep_ms=max(0, int(args.backfill_sleep_ms)),
            )
        if args.backfill_parcelle:
            print("[db] backfill cadastre polygons via APICarto parcelle...")
            backfill_parcelle_polygons(
                conn,
                limit=max(0, int(args.backfill_limit)),
                sleep_ms=max(0, int(args.backfill_sleep_ms)),
            )

        if args.stats:
            print_stats(conn)

        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
