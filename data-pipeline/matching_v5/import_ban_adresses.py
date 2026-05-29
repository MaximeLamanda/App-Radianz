#!/usr/bin/env python3
"""
Import Base Adresse Nationale (France entière) vers Postgres local.

Télécharge adresses-france.csv.gz (~925 Mo) depuis adresse.data.gouv.fr,
charge via COPY direct dans scout_ban_adresses (index GiST recréés après le bulk load).

Usage :
  python data-pipeline/matching_v5/import_ban_adresses.py --download --apply-schema --truncate
  python data-pipeline/matching_v5/import_ban_adresses.py --csv datasource/ban/adresses-france.csv.gz --truncate

Postgres local uniquement (LOCAL_DATABASE_URL). Refuse les URLs Neon.
"""

from __future__ import annotations

import argparse
import gzip
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_PIPELINE_DIR = REPO_ROOT / "data-pipeline" / "python"
if str(PYTHON_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_PIPELINE_DIR))

from scout_pipeline.pg_io import apply_schema, resolve_database_url  # noqa: E402

BAN_FRANCE_URL = "https://adresse.data.gouv.fr/data/ban/adresses/latest/csv/adresses-france.csv.gz"
DEFAULT_CSV = REPO_ROOT / "datasource" / "ban" / "adresses-france.csv.gz"
SCHEMA_SQL = REPO_ROOT / "data-pipeline" / "sql" / "019_scout_ban_adresses.sql"
NEON_HOST = "neon.tech"

COPY_COLUMNS = (
    "ban_id",
    "numero",
    "rep",
    "nom_voie",
    "code_postal",
    "code_insee",
    "nom_commune",
    "lon",
    "lat",
)
_SOURCE_COLUMN_FOR = {
    "ban_id": "id",
    "numero": "numero",
    "rep": "rep",
    "nom_voie": "nom_voie",
    "code_postal": "code_postal",
    "code_insee": "code_insee",
    "nom_commune": "nom_commune",
    "lon": "lon",
    "lat": "lat",
}

COPY_SQL = """
COPY public.scout_ban_adresses (
  ban_id, numero, rep, nom_voie, code_postal, code_insee, nom_commune, lon, lat
)
FROM STDIN WITH (FORMAT csv, DELIMITER E';', HEADER true, QUOTE E'"', FORCE_NOT_NULL (ban_id, numero, rep, nom_voie, code_insee, nom_commune, lon, lat))
"""

_INDEX_DROP_SQL = (
    "DROP INDEX IF EXISTS public.idx_scout_ban_adresses_geom_gix",
    "DROP INDEX IF EXISTS public.idx_scout_ban_adresses_code_insee",
)

_INDEX_CREATE_SQL = (
    """
    CREATE INDEX IF NOT EXISTS idx_scout_ban_adresses_geom_gix
      ON public.scout_ban_adresses USING GIST (geom)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_scout_ban_adresses_code_insee
      ON public.scout_ban_adresses (code_insee)
    """,
)


def _is_local_url(url: str) -> bool:
    u = (url or "").lower()
    if NEON_HOST in u:
        return False
    return any(
        h in u
        for h in (
            "localhost",
            "127.0.0.1",
            "@postgres:",
            "@db:",
            "host.docker.internal",
        )
    )


def _log(msg: str) -> None:
    print(msg, flush=True)


def _format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} o"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} Ko"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} Mo"
    return f"{n / (1024 * 1024 * 1024):.2f} Go"


def download_ban_csv(dest: Path, *, force: bool = False) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and not force:
        _log(f"[ban] Fichier déjà présent : {dest} ({_format_bytes(dest.stat().st_size)})")
        return

    _log(f"[ban] Téléchargement {BAN_FRANCE_URL} → {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(BAN_FRANCE_URL, method="GET", headers={"Accept": "*/*"})
    started = time.monotonic()
    last_log = started
    downloaded = 0
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            with open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    downloaded += len(chunk)
                    now = time.monotonic()
                    if now - last_log >= 5.0:
                        if total > 0:
                            pct = 100.0 * downloaded / total
                            _log(
                                f"[ban]   … {_format_bytes(downloaded)} / {_format_bytes(total)} ({pct:.0f} %)"
                            )
                        else:
                            _log(f"[ban]   … {_format_bytes(downloaded)}")
                        last_log = now
        tmp.replace(dest)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        if tmp.is_file():
            tmp.unlink(missing_ok=True)
        raise SystemExit(f"Échec téléchargement BAN : {exc}") from exc

    elapsed = time.monotonic() - started
    _log(f"[ban] Téléchargement terminé : {_format_bytes(dest.stat().st_size)} en {elapsed:.0f}s")


def _write_transformed_csv(src_gz: Path, dest_txt: Path) -> int:
    """Stream CSV BAN gz → fichier plat (dédupliqué sur ban_id)."""
    written = 0
    seen_ids: set[str] = set()
    with gzip.open(src_gz, "rt", encoding="utf-8", errors="replace") as gz, open(
        dest_txt, "w", encoding="utf-8", newline="\n"
    ) as out:
        header = gz.readline()
        if not header:
            raise SystemExit("CSV BAN vide")
        cols = [c.strip() for c in header.rstrip("\n\r").split(";")]
        try:
            idx = {name: cols.index(_SOURCE_COLUMN_FOR[name]) for name in COPY_COLUMNS}
        except ValueError as exc:
            raise SystemExit(f"En-tête CSV BAN inattendu : {cols[:12]}… ({exc})") from exc

        out.write(";".join(COPY_COLUMNS) + "\n")
        n_read = 0
        for line in gz:
            n_read += 1
            parts = line.rstrip("\n\r").split(";")
            if len(parts) < len(cols):
                continue
            row = [parts[idx[c]] if idx[c] < len(parts) else "" for c in COPY_COLUMNS]
            ban_id = row[0].strip()
            if not ban_id or ban_id in seen_ids:
                continue
            try:
                lon = float(row[7])
                lat = float(row[8])
            except (TypeError, ValueError):
                continue
            if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
                continue
            seen_ids.add(ban_id)
            out.write(";".join(row) + "\n")
            written += 1
            if n_read % 500_000 == 0:
                _log(f"[ban]   … {n_read:,} lignes lues, {written:,} adresses uniques")
    return written


def _prepare_table_for_bulk_load(cur, *, truncate: bool) -> None:
    _log("[ban] Suppression index (bulk load)…")
    for sql in _INDEX_DROP_SQL:
        cur.execute(sql)
    if truncate:
        _log("[ban] TRUNCATE scout_ban_adresses…")
        cur.execute("TRUNCATE public.scout_ban_adresses")


def _rebuild_indexes(cur) -> None:
    _log("[ban] Recréation index GiST + code_insee (peut prendre plusieurs minutes)…")
    t0 = time.monotonic()
    for sql in _INDEX_CREATE_SQL:
        cur.execute(sql)
    _log(f"[ban] Index recréés en {time.monotonic() - t0:.0f}s")


def import_csv(conn, csv_path: Path, *, truncate: bool) -> int:
    started = time.monotonic()
    with conn.cursor() as cur:
        _prepare_table_for_bulk_load(cur, truncate=truncate)
    conn.commit()

    fd, tmp_name = tempfile.mkstemp(prefix="ban-france-", suffix=".csv")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        _log(f"[ban] Transformation CSV {csv_path} → fichier intermédiaire…")
        n_rows = _write_transformed_csv(csv_path, tmp_path)
        _log(f"[ban] {n_rows:,} adresse(s) uniques — COPY scout_ban_adresses…")
        t_copy = time.monotonic()
        with open(tmp_path, "r", encoding="utf-8") as flat:
            with conn.cursor() as cur:
                cur.copy_expert(COPY_SQL, flat)
        conn.commit()
        _log(f"[ban] COPY terminé en {time.monotonic() - t_copy:.0f}s")
    finally:
        tmp_path.unlink(missing_ok=True)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*)::bigint FROM public.scout_ban_adresses")
        total = int(cur.fetchone()[0])
        _rebuild_indexes(cur)
        _log("[ban] ANALYZE scout_ban_adresses…")
        cur.execute("ANALYZE public.scout_ban_adresses")
    conn.commit()

    elapsed = time.monotonic() - started
    _log(f"[ban] Import terminé : {total:,} adresse(s) en {elapsed:.0f}s")
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description="Import BAN France → Postgres local")
    ap.add_argument("--download", action="store_true", help="Télécharger adresses-france.csv.gz si absent")
    ap.add_argument("--force-download", action="store_true", help="Re-télécharger même si le fichier existe")
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Chemin CSV.gz BAN")
    ap.add_argument("--apply-schema", action="store_true")
    ap.add_argument("--truncate", action="store_true", help="Vider scout_ban_adresses avant import")
    args = ap.parse_args()

    url = resolve_database_url(REPO_ROOT)
    if not url:
        raise SystemExit("DATABASE_URL / LOCAL_DATABASE_URL manquant (.env.local)")
    if not _is_local_url(url):
        raise SystemExit(
            "Refus : import BAN réservé au Postgres local (LOCAL_DATABASE_URL). "
            "Ne pas charger sur Neon."
        )

    if args.download or args.force_download:
        download_ban_csv(args.csv, force=args.force_download)
    if not args.csv.is_file():
        raise SystemExit(
            f"Fichier BAN introuvable : {args.csv}\n"
            "Relancer avec --download"
        )

    try:
        import psycopg2
    except ImportError as exc:
        raise SystemExit("psycopg2-binary requis") from exc

    conn = psycopg2.connect(url)
    try:
        if args.apply_schema:
            _log(f"[ban] Application schéma {SCHEMA_SQL.name}…")
            apply_schema(conn, SCHEMA_SQL)
        import_csv(conn, args.csv, truncate=args.truncate)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
