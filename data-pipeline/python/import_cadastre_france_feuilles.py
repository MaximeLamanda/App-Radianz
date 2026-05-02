#!/usr/bin/env python3
"""Importe les géométries cadastrales depuis cadastre-france-feuilles.json.gz vers Postgres."""

from __future__ import annotations

import argparse
import gzip
import json
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
    p = argparse.ArgumentParser()
    p.add_argument("--geojson-gz", type=Path, required=True, help="Chemin vers cadastre-france-feuilles.json.gz")
    p.add_argument("--code-insee", default=None, help="Filtre optionnel (ex: 33318)")
    p.add_argument("--apply-schema", action="store_true")
    p.add_argument("--truncate", action="store_true")
    p.add_argument("--batch-size", type=int, default=400)
    args = p.parse_args()

    url = resolve_database_url()
    if not url:
        raise SystemExit("DATABASE_URL / Radianz_DATABASE_URL manquant")
    if not args.geojson_gz.is_file():
        raise SystemExit(f"Fichier introuvable: {args.geojson_gz}")

    schema_path = Path(__file__).resolve().parent.parent / "sql" / "001_scout_schema.sql"
    if not schema_path.is_file():
        raise SystemExit(f"Schéma introuvable: {schema_path}")

    conn = psycopg2.connect(url)
    inserted = 0
    skipped = 0
    batch: list[tuple[str | None, str | None, str | None, str | None, str | None, str, str]] = []
    try:
        if args.apply_schema:
            apply_schema(conn, schema_path)

        with conn.cursor() as cur:
            if args.truncate:
                if args.code_insee:
                    cur.execute(
                        "DELETE FROM public.cadastre_france_feuilles_geom WHERE code_insee = %s",
                        (args.code_insee,),
                    )
                else:
                    cur.execute("TRUNCATE TABLE public.cadastre_france_feuilles_geom")
        conn.commit()

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

        for feat in iter_geojson_features_from_gz(args.geojson_gz):
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
        print(
            f"[import-cadastre] code_insee={args.code_insee or 'ALL'} inserted_or_updated={inserted} skipped={skipped}"
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()

