#!/usr/bin/env python3
"""Importe les parcelles personnes morales dans Postgres (filtrable par code INSEE)."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch

from scout_pipeline.pg_io import apply_schema, resolve_database_url


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--parquet", type=Path, required=True)
    p.add_argument("--code-insee", default="33318")
    p.add_argument("--apply-schema", action="store_true")
    p.add_argument("--truncate", action="store_true")
    args = p.parse_args()

    url = resolve_database_url()
    if not url:
        raise SystemExit("DATABASE_URL / Radianz_DATABASE_URL manquant")

    schema_path = Path(__file__).resolve().parent.parent / "sql" / "001_scout_schema.sql"
    if not schema_path.is_file():
        raise SystemExit(f"Schéma introuvable: {schema_path}")

    df = pd.read_parquet(args.parquet)
    if "code_insee" not in df.columns:
        raise SystemExit("Colonne code_insee absente du parquet")
    df = df[df["code_insee"].astype(str) == str(args.code_insee)].copy()

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

    rows = [tuple(None if pd.isna(v) else str(v) for v in r) for r in df.itertuples(index=False, name=None)]

    conn = psycopg2.connect(url)
    try:
        if args.apply_schema:
            apply_schema(conn, schema_path)

        with conn.cursor() as cur:
            if args.truncate:
                cur.execute(
                    "DELETE FROM public.parcelles_personnes_morales WHERE code_insee = %s",
                    (str(args.code_insee),),
                )
            if rows:
                execute_batch(
                    cur,
                    """
                    INSERT INTO public.parcelles_personnes_morales (
                      code_insee, nom_commune, numero_siren, denomination, forme_juridique_libelle,
                      numero_voirie, indice_repetition, nature_voie, nom_voie, numero_parcelle, section, millesime
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                    page_size=500,
                )
        conn.commit()
        print(f"[import] code_insee={args.code_insee} lignes={len(rows)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
