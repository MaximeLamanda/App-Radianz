#!/usr/bin/env python3
"""Importe les parcelles personnes morales dans Postgres (filtrable par code INSEE)."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch

from scout_pipeline.pg_io import apply_schema, resolve_database_url


def main() -> None:
    p = argparse.ArgumentParser(
        description="Import PPM (parcelles personnes morales) depuis un Parquet vers public.parcelles_personnes_morales."
    )
    p.add_argument("--parquet", type=Path, required=True)
    p.add_argument("--code-insee", default=None, help="Une commune (ex. 33318)")
    p.add_argument(
        "--dep",
        default=None,
        metavar="DEPT",
        help="Tout le département : lignes dont code_insee commence par ce préfixe (ex. 33, 971, 2A). "
        "Avec --truncate : DELETE des lignes de ce préfixe uniquement.",
    )
    p.add_argument("--apply-schema", action="store_true")
    p.add_argument("--truncate", action="store_true")
    p.add_argument(
        "--insert-chunk-size",
        type=int,
        default=50_000,
        help="Nombre de lignes par lot INSERT (affiche un jalon sur stderr entre chaque lot).",
    )
    p.add_argument("--quiet", action="store_true", help="Pas de jalons intermédiaires.")
    args = p.parse_args()

    def log(msg: str) -> None:
        if not args.quiet:
            print(msg, file=sys.stderr, flush=True)

    if bool(args.code_insee) == bool(args.dep):
        raise SystemExit("Fournir exactement l'un des deux : --code-insee <INSEE> ou --dep <DEPT>")

    url = resolve_database_url()
    if not url:
        raise SystemExit("DATABASE_URL / Radianz_DATABASE_URL manquant")

    schema_path = Path(__file__).resolve().parent.parent / "sql" / "001_scout_schema.sql"
    if not schema_path.is_file():
        raise SystemExit(f"Schéma introuvable: {schema_path}")

    t0 = time.perf_counter()
    log(f"[import-ppm] Lecture parquet {args.parquet.name}…")
    df = pd.read_parquet(args.parquet)
    if "code_insee" not in df.columns:
        raise SystemExit("Colonne code_insee absente du parquet")
    ci = df["code_insee"].astype(str)
    if args.dep:
        dep = str(args.dep).strip()
        df = df[ci.str.startswith(dep, na=False)].copy()
    else:
        df = df[ci == str(args.code_insee)].copy()
    log(f"[import-ppm] Filtre appliqué : {len(df)} ligne(s) ({time.perf_counter() - t0:.1f}s)")

    cols = [
        "code_insee",
        "nom_commune",
        "numero_siren",
        "denomination",
        "forme_juridique_libelle",
        "numero_voirie",
        "indice_repetition",
        "nature_voie",
        "nom_voie",
        "numero_parcelle",
        "section",
        "millesime",
    ]
    for c in cols:
        if c not in df.columns:
            df[c] = None
    df = df[cols]

    log("[import-ppm] Préparation des tuples…")
    rows = [tuple(None if pd.isna(v) else str(v) for v in r) for r in df.itertuples(index=False, name=None)]

    conn = psycopg2.connect(url)
    try:
        if args.apply_schema:
            log("[import-ppm] Application du schéma SQL…")
            apply_schema(conn, schema_path)

        with conn.cursor() as cur:
            if args.truncate:
                if args.dep:
                    dep = str(args.dep).strip()
                    log(f"[import-ppm] DELETE lignes code_insee LIKE '{dep}%'…")
                    cur.execute(
                        "DELETE FROM public.parcelles_personnes_morales WHERE code_insee LIKE %s",
                        (f"{dep}%",),
                    )
                else:
                    log(f"[import-ppm] DELETE lignes code_insee={args.code_insee}…")
                    cur.execute(
                        "DELETE FROM public.parcelles_personnes_morales WHERE code_insee = %s",
                        (str(args.code_insee),),
                    )
            if rows:
                chunk = max(1_000, int(args.insert_chunk_size))
                sql = """
                    INSERT INTO public.parcelles_personnes_morales (
                      code_insee, nom_commune, numero_siren, denomination, forme_juridique_libelle,
                      numero_voirie, indice_repetition, nature_voie, nom_voie, numero_parcelle, section, millesime
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                total = len(rows)
                for i in range(0, total, chunk):
                    part = rows[i : i + chunk]
                    execute_batch(cur, sql, part, page_size=500)
                    done = min(i + len(part), total)
                    log(f"[import-ppm] … {done}/{total} lignes insérées")
        conn.commit()
        scope = f"dep={args.dep!r}" if args.dep else f"code_insee={args.code_insee}"
        dt = time.perf_counter() - t0
        print(f"[import-ppm] {scope} lignes={len(rows)} ({dt:.1f}s)", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
