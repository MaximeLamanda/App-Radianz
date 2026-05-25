#!/usr/bin/env python3
"""
Import Enedis consommation entreprise par adresse → Postgres (scout_enedis_consumption_sites).

  python3 data-pipeline/matching_v5/import_enedis_consumption.py --ensure-schema
  python3 data-pipeline/matching_v5/import_enedis_consumption.py --dep 33 --annee 2024 --geocode
  python3 data-pipeline/matching_v5/import_enedis_consumption.py --code-insee 33318 --annee 2024 --geocode
  python3 data-pipeline/matching_v5/import_enedis_consumption.py --geocode-only-failed --dep 33
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from enedis_consumption_v5 import (  # noqa: E402
    COMMUNE_BATCH_SIZE,
    ENEDIS_RECORDS_URL,
    ODS_PAGE_SIZE,
    accept_geocode_hit,
    build_ods_where_communes,
    is_valid_wgs84,
    parse_record_row,
)
from geoplateforme_geocode import GeoplateformeGeocoder  # noqa: E402
from import_osm_parking import DATABASE_URL_ENV_KEYS, resolve_database_url  # noqa: E402

QUALIFIED_TABLE = "public.scout_enedis_consumption_sites"
DEFAULT_YEARS = [str(y) for y in range(2018, 2025)]


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env.local", ".env"):
        p = REPO_ROOT / name
        if p.is_file():
            load_dotenv(p)


def apply_schema_sql(cur: Any) -> None:
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "017_scout_enedis_consumption_sites.sql"
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            cur.execute(stmt + ";")


def load_communes_insee(
    cur: Any,
    *,
    dep: str | None,
    code_insee: str | None,
) -> list[str]:
    if code_insee:
        c = str(code_insee).strip()
        if not re.fullmatch(r"\d{5}", c):
            raise ValueError(f"code_insee invalide: {code_insee}")
        return [c]

    if dep:
        list_path = REPO_ROOT / "bdnb" / f"dep{dep}_communes_insee.txt"
        if list_path.is_file():
            codes = [
                ln.strip()
                for ln in list_path.read_text(encoding="utf-8").splitlines()
                if ln.strip() and re.fullmatch(r"\d{5}", ln.strip())
            ]
            if codes:
                print(f"[enedis] {len(codes)} commune(s) depuis {list_path.name}", flush=True)
                return sorted(set(codes))
        prefix = str(dep).strip()
        cur.execute(
            """
            SELECT DISTINCT code_insee::text AS code_insee
            FROM public.cadastre_france_feuilles_geom
            WHERE code_insee LIKE %s
            ORDER BY 1
            """,
            (f"{prefix}%",),
        )
        codes = [str(r[0]).strip() for r in cur.fetchall() if r and r[0]]
        print(f"[enedis] {len(codes)} commune(s) cadastre dep {prefix}", flush=True)
        return codes

    raise ValueError("Fournir --dep ou --code-insee")


def fetch_ods_records(code_communes: list[str], annee: str) -> list[dict[str, Any]]:
    where = build_ods_where_communes(code_communes, annee)
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = urllib.parse.urlencode(
            {
                "limit": str(ODS_PAGE_SIZE),
                "offset": str(offset),
                "where": where,
            }
        )
        url = f"{ENEDIS_RECORDS_URL}?{params}"
        req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
            raise RuntimeError(f"Enedis ODS échec offset={offset}: {e}") from e

        results = payload.get("results")
        if not isinstance(results, list) or len(results) == 0:
            break
        for row in results:
            if isinstance(row, dict):
                out.append(row)
        offset += len(results)
        if len(results) < ODS_PAGE_SIZE:
            break
        time.sleep(0.15)
    return out


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def upsert_site(cur: Any, row: dict[str, Any]) -> None:
    cur.execute(
        f"""
        INSERT INTO {QUALIFIED_TABLE} (
          site_id, code_commune, annee, mwh, adresse_label,
          code_secteur_naf2, code_grand_secteur, nombre_de_sites,
          lat, lng, geom, geocode_score, geocode_status, geocode_label
        ) VALUES (
          %s, %s, %s, %s, %s,
          %s, %s, %s,
          %s, %s,
          CASE WHEN %s IS NOT NULL AND %s IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(%s, %s), 4326)
            ELSE NULL END,
          %s, %s, %s
        )
        ON CONFLICT (site_id) DO UPDATE SET
          code_commune = EXCLUDED.code_commune,
          annee = EXCLUDED.annee,
          mwh = EXCLUDED.mwh,
          adresse_label = EXCLUDED.adresse_label,
          code_secteur_naf2 = EXCLUDED.code_secteur_naf2,
          code_grand_secteur = EXCLUDED.code_grand_secteur,
          nombre_de_sites = EXCLUDED.nombre_de_sites,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          geom = EXCLUDED.geom,
          geocode_score = EXCLUDED.geocode_score,
          geocode_status = EXCLUDED.geocode_status,
          geocode_label = EXCLUDED.geocode_label,
          imported_at = now()
        """,
        (
            row["site_id"],
            row["code_commune"],
            row["annee"],
            row["mwh"],
            row["adresse_label"],
            row.get("code_secteur_naf2"),
            row.get("code_grand_secteur"),
            row["nombre_de_sites"],
            row.get("lat"),
            row.get("lng"),
            row.get("lng"),
            row.get("lat"),
            row.get("lng"),
            row.get("lat"),
            row.get("geocode_score"),
            row["geocode_status"],
            row.get("geocode_label"),
        ),
    )


def geocode_row(
    geocoder: GeoplateformeGeocoder,
    base: dict[str, Any],
) -> dict[str, Any]:
    out = dict(base)
    hit = geocoder.search(base["adresse_label"], limit=1)
    if accept_geocode_hit(hit, base["code_commune"]):
        out["lat"] = hit.lat
        out["lng"] = hit.lon
        out["geocode_score"] = hit.score
        out["geocode_label"] = hit.label
        out["geocode_status"] = "ok"
    else:
        out["lat"] = None
        out["lng"] = None
        out["geocode_score"] = hit.score if hit else None
        out["geocode_label"] = hit.label if hit else None
        out["geocode_status"] = "failed"
    return out


def import_for_communes(
    cur: Any,
    code_communes: list[str],
    annee: str,
    *,
    geocode: bool,
    geocoder: GeoplateformeGeocoder | None,
    limit: int | None,
) -> tuple[int, int, int]:
    inserted = 0
    skipped = 0
    geocode_ok = 0
    for batch in chunked(code_communes, COMMUNE_BATCH_SIZE):
        records = fetch_ods_records(batch, annee)
        if limit is not None:
            records = records[: max(0, limit - inserted - skipped)]
        for raw in records:
            parsed = parse_record_row(raw)
            if not parsed:
                skipped += 1
                continue
            if geocode and geocoder:
                row = geocode_row(geocoder, parsed)
                if row["geocode_status"] == "ok":
                    geocode_ok += 1
            else:
                row = {
                    **parsed,
                    "lat": None,
                    "lng": None,
                    "geocode_score": None,
                    "geocode_label": None,
                    "geocode_status": "skipped",
                }
            upsert_site(cur, row)
            inserted += 1
        print(
            f"[enedis] batch communes {len(batch)} — {len(records)} ligne(s) ODS, "
            f"{inserted} upsert(s), {geocode_ok} géocodé(s)",
            flush=True,
        )
        if limit is not None and inserted >= limit:
            break
    return inserted, skipped, geocode_ok


def geocode_failed_only(
    cur: Any,
    code_communes: list[str] | None,
    *,
    conn: Any,
    commit_every: int = 200,
) -> int:
    geocoder = GeoplateformeGeocoder()
    where_commune = ""
    params: list[Any] = []
    if code_communes:
        where_commune = " AND code_commune = ANY(%s)"
        params.append(code_communes)
    cur.execute(
        f"""
        SELECT site_id, code_commune, annee, mwh, adresse_label,
               code_secteur_naf2, code_grand_secteur, nombre_de_sites
        FROM {QUALIFIED_TABLE}
        WHERE geocode_status IN ('failed', 'skipped'){where_commune}
        ORDER BY mwh DESC
        """,
        params,
    )
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    total = len(rows)
    ok = 0
    print(f"[enedis] géocodage — {total} adresse(s) à traiter", flush=True)
    for i, tup in enumerate(rows, start=1):
        base = dict(zip(cols, tup, strict=True))
        updated = geocode_row(geocoder, base)
        upsert_site(cur, updated)
        if updated["geocode_status"] == "ok":
            ok += 1
        if i % commit_every == 0:
            conn.commit()
            print(
                f"[enedis] géocodage — {i}/{total} traitées, {ok} OK",
                flush=True,
            )
    print(f"[enedis] re-géocodage — {ok}/{total} OK", flush=True)
    return ok


def delete_dep(cur: Any, code_communes: list[str], annee: str | None) -> int:
    if annee:
        cur.execute(
            f"DELETE FROM {QUALIFIED_TABLE} WHERE code_commune = ANY(%s) AND annee = %s",
            (code_communes, int(annee)),
        )
    else:
        cur.execute(
            f"DELETE FROM {QUALIFIED_TABLE} WHERE code_commune = ANY(%s)",
            (code_communes,),
        )
    return cur.rowcount


def main() -> int:
    _load_dotenv()
    ap = argparse.ArgumentParser(description="Import consommation Enedis → Postgres")
    ap.add_argument("--ensure-schema", action="store_true")
    ap.add_argument("--dep", type=str, default=None, help="Préfixe dep (ex. 33)")
    ap.add_argument("--code-insee", type=str, default=None)
    ap.add_argument("--annee", type=str, default=None)
    ap.add_argument("--all-years", action="store_true")
    ap.add_argument("--geocode", action="store_true", help="Géocoder via Géoplateforme à l'import")
    ap.add_argument("--geocode-only-failed", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true", help="Avec --geocode-only-failed uniquement")
    ap.add_argument("--truncate-dep", action="store_true", help="DELETE communes du dep avant import")
    ap.add_argument("--limit", type=int, default=None, help="Max lignes (debug)")
    args = ap.parse_args()

    url = resolve_database_url()
    if not url:
        print("Aucune URL Postgres", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("psycopg2-binary requis", file=sys.stderr)
        return 1

    conn = psycopg2.connect(url)
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            if args.ensure_schema:
                apply_schema_sql(cur)
                print("[enedis] Schéma 017 appliqué", flush=True)
                if (
                    not args.dep
                    and not args.code_insee
                    and not args.geocode_only_failed
                ):
                    conn.commit()
                    return 0

            communes = (
                load_communes_insee(cur, dep=args.dep, code_insee=args.code_insee)
                if args.dep or args.code_insee
                else []
            )

            if args.geocode_only_failed:
                targets = communes if communes else None
                geocode_failed_only(cur, targets, conn=conn)
                conn.commit()
                return 0

            if not communes:
                print("Fournir --dep ou --code-insee pour l'import ODS", file=sys.stderr)
                return 1

            years = DEFAULT_YEARS if args.all_years else [args.annee or "2024"]
            geocoder = GeoplateformeGeocoder() if args.geocode else None

            if args.truncate_dep:
                for y in years:
                    n = delete_dep(cur, communes, y if not args.all_years else None)
                    print(f"[enedis] truncate-dep — {n} ligne(s) supprimée(s)", flush=True)

            total_ins = 0
            for year in years:
                print(f"[enedis] Import annee={year} …", flush=True)
                ins, sk, geo = import_for_communes(
                    cur,
                    communes,
                    year,
                    geocode=args.geocode,
                    geocoder=geocoder,
                    limit=args.limit,
                )
                total_ins += ins
                print(
                    f"[enedis] annee={year} terminé — upsert={ins}, ignorés parse={sk}, géocode ok={geo}",
                    flush=True,
                )

            cur.execute(
                f"""
                SELECT geocode_status, count(*)::bigint
                FROM {QUALIFIED_TABLE}
                WHERE code_commune = ANY(%s)
                GROUP BY 1
                """,
                (communes,),
            )
            stats = cur.fetchall()
            print(f"[enedis] Stats géocodage (communes cibles): {stats}", flush=True)
        conn.commit()
        print(f"[enedis] OK — {total_ins} ligne(s) traitées", flush=True)
        return 0
    except Exception as e:
        conn.rollback()
        print(f"[enedis] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
