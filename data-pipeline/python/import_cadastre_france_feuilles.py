#!/usr/bin/env python3
"""Importe les géométries cadastrales depuis cadastre-france-feuilles.json.gz vers Postgres."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path
from typing import Generator

import psycopg2
from psycopg2.extras import execute_batch

from scout_pipeline.pg_io import apply_schema, resolve_database_url


def normalize_numero(raw: str | None) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    digits = "".join(ch for ch in s if ch.isdigit())
    if not digits:
        return s
    return digits[-4:].zfill(4)


def iter_geojson_features_from_gz(path: Path, chunk_size: int = 1_048_576) -> Generator[dict, None, None]:
    """Lit un GeoJSON gzippé en streaming et yield les objets feature un par un."""
    decoder = json.JSONDecoder()
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        buffer = ""
        in_features = False
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            buffer += chunk
            if not in_features:
                idx = buffer.find('"features"')
                if idx < 0:
                    buffer = buffer[-200:]
                    continue
                arr = buffer.find("[", idx)
                if arr < 0:
                    continue
                buffer = buffer[arr + 1 :]
                in_features = True

            while True:
                stripped = buffer.lstrip()
                if not stripped:
                    buffer = ""
                    break
                buffer = stripped

                if buffer[0] == "]":
                    return
                if buffer[0] == ",":
                    buffer = buffer[1:]
                    continue

                try:
                    obj, end = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    # Feature incomplète, on lit le chunk suivant.
                    break
                yield obj
                buffer = buffer[end:]

        # Dernière tentative en fin de fichier
        while True:
            stripped = buffer.lstrip()
            buffer = stripped
            if not buffer or buffer[0] == "]":
                return
            if buffer[0] == ",":
                buffer = buffer[1:]
                continue
            obj, end = decoder.raw_decode(buffer)
            yield obj
            buffer = buffer[end:]


def main() -> None:
    p = argparse.ArgumentParser(
        description="Import cadastre GeoJSON.gz vers public.cadastre_france_feuilles_geom. "
        "Sans filtre : tout le fichier. --code-insee : une commune. --dep : préfixe INSEE (tout le département)."
    )
    p.add_argument("--geojson-gz", type=Path, required=True, help="Chemin vers cadastre-france-feuilles.json.gz")
    p.add_argument("--code-insee", default=None, help="Filtre optionnel : une commune (ex. 33318)")
    p.add_argument(
        "--dep",
        default=None,
        metavar="DEPT",
        help="Filtre par département : ne garde que les parcelles dont code_insee commence par cette chaîne "
        "(ex. 33, 971, 2A). Avec --truncate : DELETE des lignes de ce préfixe uniquement (pas TRUNCATE global).",
    )
    p.add_argument("--apply-schema", action="store_true")
    p.add_argument("--truncate", action="store_true")
    p.add_argument("--batch-size", type=int, default=400)
    p.add_argument(
        "--progress-every",
        type=int,
        default=50_000,
        help="Afficher une ligne d'avancement sur stderr tous les N features lus du fichier (0 = désactivé).",
    )
    p.add_argument("--quiet", action="store_true", help="Pas de jalons intermédiaires.")
    args = p.parse_args()

    if args.code_insee and args.dep:
        raise SystemExit("Utiliser soit --code-insee soit --dep, pas les deux.")

    url = resolve_database_url()
    if not url:
        raise SystemExit("DATABASE_URL / Radianz_DATABASE_URL manquant")
    if not args.geojson_gz.is_file():
        raise SystemExit(f"Fichier introuvable: {args.geojson_gz}")

    schema_path = Path(__file__).resolve().parent.parent / "sql" / "001_scout_schema.sql"
    if not schema_path.is_file():
        raise SystemExit(f"Schéma introuvable: {schema_path}")

    def log(msg: str) -> None:
        if not args.quiet:
            print(msg, file=sys.stderr, flush=True)

    conn = psycopg2.connect(url)
    inserted = 0
    skipped = 0
    batch: list[tuple[str | None, str | None, str | None, str | None, str | None, str, str]] = []
    dep_filter = str(args.dep).strip() if args.dep else None
    t0 = time.perf_counter()
    try:
        if args.apply_schema:
            log("[import-cadastre] Application du schéma SQL…")
            apply_schema(conn, schema_path)

        with conn.cursor() as cur:
            if args.truncate:
                if args.code_insee:
                    log(f"[import-cadastre] DELETE parcelles code_insee={args.code_insee}…")
                    cur.execute(
                        "DELETE FROM public.cadastre_france_feuilles_geom WHERE code_insee = %s",
                        (args.code_insee,),
                    )
                elif args.dep:
                    pat = f"{dep_filter}%"
                    log(f"[import-cadastre] DELETE parcelles code_insee LIKE {pat!r}…")
                    cur.execute(
                        "DELETE FROM public.cadastre_france_feuilles_geom WHERE code_insee LIKE %s",
                        (pat,),
                    )
                else:
                    log("[import-cadastre] TRUNCATE cadastre_france_feuilles_geom…")
                    cur.execute("TRUNCATE TABLE public.cadastre_france_feuilles_geom")
        conn.commit()
        if args.truncate:
            log(f"[import-cadastre] Purge terminée ({time.perf_counter() - t0:.1f}s), lecture {args.geojson_gz.name}…")
        else:
            log(f"[import-cadastre] Lecture {args.geojson_gz.name}…")

        def flush() -> None:
            nonlocal inserted, batch
            if not batch:
                return
            with conn.cursor() as cur:
                execute_batch(
                    cur,
                    """
                    INSERT INTO public.cadastre_france_feuilles_geom (
                      source_id, code_insee, section, numero, numero_norm, geom, properties, updated_at
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(%s)), 4326),
                      %s::jsonb,
                      now()
                    )
                    ON CONFLICT (code_insee, section, numero_norm) DO UPDATE SET
                      source_id = EXCLUDED.source_id,
                      numero = EXCLUDED.numero,
                      geom = EXCLUDED.geom,
                      properties = EXCLUDED.properties,
                      updated_at = now()
                    """,
                    batch,
                    page_size=max(50, min(args.batch_size, 1000)),
                )
            conn.commit()
            inserted += len(batch)
            batch = []

        features_read = 0
        for feat in iter_geojson_features_from_gz(args.geojson_gz):
            features_read += 1
            pe = int(args.progress_every)
            if pe > 0 and not args.quiet and features_read % pe == 0:
                log(
                    f"[import-cadastre] … {features_read} features lus du fichier, "
                    f"{inserted} parcelles écrites en base, {skipped} ignorées (filtre / géométrie)"
                )
            if not isinstance(feat, dict):
                skipped += 1
                continue
            geom = feat.get("geometry")
            if not isinstance(geom, dict):
                skipped += 1
                continue
            gtype = geom.get("type")
            if gtype not in {"Polygon", "MultiPolygon"}:
                skipped += 1
                continue

            props = feat.get("properties") if isinstance(feat.get("properties"), dict) else {}
            code_insee = str(props.get("commune") or "").strip() or None
            if args.code_insee and code_insee != str(args.code_insee):
                continue
            if dep_filter is not None:
                if not code_insee or not str(code_insee).startswith(dep_filter):
                    continue
            section = str(props.get("section") or "").strip() or None
            numero = str(props.get("numero") or "").strip() or None
            numero_norm = normalize_numero(numero)
            if not code_insee or not section or not numero_norm:
                skipped += 1
                continue
            source_id = str(props.get("id") or feat.get("id") or "").strip() or None

            batch.append(
                (
                    source_id,
                    code_insee,
                    section,
                    numero,
                    numero_norm,
                    json.dumps(geom, separators=(",", ":")),
                    json.dumps(props, ensure_ascii=False, separators=(",", ":")),
                )
            )
            if len(batch) >= args.batch_size:
                flush()

        flush()
        scope = (
            f"code_insee={args.code_insee}"
            if args.code_insee
            else (f"dep={args.dep!r}" if args.dep else "ALL (fichier entier)")
        )
        dt = time.perf_counter() - t0
        print(
            f"[import-cadastre] {scope} features_lus={features_read} "
            f"inserted_or_updated={inserted} skipped={skipped} ({dt:.1f}s)",
            flush=True,
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()

