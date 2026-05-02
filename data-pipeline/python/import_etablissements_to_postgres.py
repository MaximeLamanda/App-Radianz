#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

from scout_pipeline.address_normalization import normalize_address_parts
from scout_pipeline.pg_io import apply_schema, resolve_database_url


def _clean_str(v: object) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in {"nan", "none"}:
        return ""
    return s


def _iter_csv(path: Path, chunksize: int) -> list[pd.DataFrame]:
    if path.suffix.lower() == ".parquet":
        return [pd.read_parquet(path)]
    return list(pd.read_csv(path, dtype=str, encoding="utf-8", low_memory=False, chunksize=chunksize))


def _build_rows(df: pd.DataFrame) -> list[tuple]:
    out: list[tuple] = []
    for _, r in df.iterrows():
        siret = _clean_str(r.get("siret"))
        siren = _clean_str(r.get("siren"))
        if len(siret) != 14 or not siret.isdigit() or len(siren) != 9 or not siren.isdigit():
            continue
        addr = normalize_address_parts(
            numero=_clean_str(r.get("numeroVoieEtablissement")),
            indice_repetition=_clean_str(r.get("indiceRepetitionEtablissement")),
            type_voie=_clean_str(r.get("typeVoieEtablissement")),
            libelle_voie=_clean_str(r.get("libelleVoieEtablissement")),
            commune=_clean_str(r.get("libelleCommuneEtablissement")),
            code_postal=_clean_str(r.get("codePostalEtablissement")),
        )
        out.append(
            (
                siret,
                siren,
                _clean_str(r.get("denominationUsuelleEtablissement")),
                _clean_str(r.get("etatAdministratifEtablissement")),
                _clean_str(r.get("dateDebut")),
                _clean_str(r.get("numeroVoieEtablissement")),
                _clean_str(r.get("indiceRepetitionEtablissement")),
                _clean_str(r.get("typeVoieEtablissement")),
                _clean_str(r.get("libelleVoieEtablissement")),
                _clean_str(r.get("codePostalEtablissement")),
                _clean_str(r.get("libelleCommuneEtablissement")),
                _clean_str(r.get("codeCommuneEtablissement")),
                addr["numero_norm"],
                addr["voie_norm"],
                addr["commune_norm"],
                addr["address_norm"],
                _clean_str(r.get("trancheEffectifsEtablissement")),
                _clean_str(r.get("anneeEffectifsEtablissement")),
                _clean_str(r.get("activitePrincipaleEtablissement")),
            )
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Import dump établissements vers public.scout_etablissements")
    ap.add_argument("--input", type=Path, required=True, help="CSV ou Parquet établissements")
    ap.add_argument("--chunksize", type=int, default=100_000)
    ap.add_argument("--apply-schema", action="store_true")
    args = ap.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Fichier introuvable: {args.input}")

    url = resolve_database_url()
    if not url:
        raise SystemExit("DATABASE_URL / LOCAL_DATABASE_URL manquant")

    schema_path = Path(__file__).resolve().parent.parent / "sql" / "001_scout_schema.sql"
    if not schema_path.is_file():
        raise SystemExit(f"Schema introuvable: {schema_path}")

    conn = psycopg2.connect(url)
    total = 0
    try:
        if args.apply_schema:
            apply_schema(conn, schema_path)
        with conn.cursor() as cur:
            for chunk in _iter_csv(args.input, args.chunksize):
                rows = _build_rows(chunk)
                if not rows:
                    continue
                execute_values(
                    cur,
                    """
                    INSERT INTO public.scout_etablissements (
                      siret, siren, denomination, etat_administratif, date_debut,
                      numero_voie, indice_repetition, type_voie, libelle_voie,
                      code_postal, commune, code_commune_insee,
                      numero_norm, voie_norm, commune_norm, address_norm,
                      tranche_effectifs, annee_effectifs, activite_principale
                    ) VALUES %s
                    ON CONFLICT (siret) DO UPDATE SET
                      siren = EXCLUDED.siren,
                      denomination = EXCLUDED.denomination,
                      etat_administratif = EXCLUDED.etat_administratif,
                      date_debut = EXCLUDED.date_debut,
                      numero_voie = EXCLUDED.numero_voie,
                      indice_repetition = EXCLUDED.indice_repetition,
                      type_voie = EXCLUDED.type_voie,
                      libelle_voie = EXCLUDED.libelle_voie,
                      code_postal = EXCLUDED.code_postal,
                      commune = EXCLUDED.commune,
                      code_commune_insee = EXCLUDED.code_commune_insee,
                      numero_norm = EXCLUDED.numero_norm,
                      voie_norm = EXCLUDED.voie_norm,
                      commune_norm = EXCLUDED.commune_norm,
                      address_norm = EXCLUDED.address_norm,
                      tranche_effectifs = EXCLUDED.tranche_effectifs,
                      annee_effectifs = EXCLUDED.annee_effectifs,
                      activite_principale = EXCLUDED.activite_principale,
                      updated_at = now()
                    """,
                    rows,
                    page_size=5_000,
                )
                conn.commit()
                total += len(rows)
                print(f"[import-etab] upsert cumule: {total}")
    except Exception as exc:
        conn.rollback()
        raise SystemExit(f"Import échoué: {exc}") from exc
    finally:
        conn.close()

    print(f"[import-etab] terminé: {total} ligne(s) upsert")


if __name__ == "__main__":
    sys.exit(main())
