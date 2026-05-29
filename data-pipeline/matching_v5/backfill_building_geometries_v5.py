#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from typing import Any

from osm_buildings_v5 import fetch_osm_geometry_payloads, qualified_osm_buildings_table
from run_matching_v5 import qualified_scout_matching_v5_table, resolve_database_url


def _chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _buildings_json_raw_for_parse(v: Any) -> str:
    """psycopg2 renvoie souvent `buildings_json` comme list/dict ; `str(list)` n'est pas du JSON valide."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v).strip()


def _parse_buildings_json_items(v: Any) -> list[dict[str, Any]]:
    raw = _buildings_json_raw_for_parse(v)
    if not raw:
        return []
    try:
        arr = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    return [item for item in arr if isinstance(item, dict)]


def _osm_building_id_from_item(item: dict[str, Any]) -> str:
    return str(item.get("osm_building_id") or item.get("batiment_construction_id") or "").strip()


def _extract_osm_building_ids(items: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        oid = _osm_building_id_from_item(item)
        if not oid or oid in seen:
            continue
        seen.add(oid)
        out.append(oid)
    return out


def _building_geometry_entry(
    item: dict[str, Any],
    osm_payload: dict[str, Any],
) -> dict[str, Any] | None:
    osm_building_id = _osm_building_id_from_item(item)
    if not osm_building_id:
        return None
    try:
        geometry = json.loads(str(osm_payload["geometry"]))
    except (KeyError, json.JSONDecodeError, TypeError):
        return None
    return {
        "batiment_construction_id": str(item.get("batiment_construction_id") or osm_building_id).strip(),
        "bdnb_batiment_construction_id": item.get("bdnb_batiment_construction_id"),
        "batiment_groupe_id": item.get("batiment_groupe_id"),
        "osm_building_id": osm_building_id,
        "osm_match_status": item.get("osm_match_status") or "",
        "osm_bdnb_intersection_area_m2": item.get("osm_bdnb_intersection_area_m2"),
        "osm_address_text": item.get("osm_address_text") or osm_payload.get("address_text") or "",
        "osm_name": item.get("osm_name") or osm_payload.get("name") or "",
        "osm_website": item.get("osm_website") or osm_payload.get("website") or "",
        "osm_phone": item.get("osm_phone") or osm_payload.get("phone") or "",
        "osm_poi_primary_key": item.get("osm_poi_primary_key") or osm_payload.get("poi_primary_key") or "",
        "osm_poi_primary_value": item.get("osm_poi_primary_value") or osm_payload.get("poi_primary_value") or "",
        "osm_poi_type_label": item.get("osm_poi_type_label") or osm_payload.get("poi_type_label") or "",
        "osm_raw_tags": item.get("osm_raw_tags") or osm_payload.get("raw_tags") or {},
        "zone_tag": item.get("zone_tag") or "",
        "zone_source": item.get("zone_source") or "",
        "landuse_intersection_area_m2": item.get("landuse_intersection_area_m2"),
        "annee_construction": item.get("annee_construction"),
        "footprint_m2": item.get("footprint_m2") or osm_payload.get("footprint_m2"),
        "matching_status": item.get("matching_status") or "",
        "geometry": geometry,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Backfill building_geometries_json depuis osm_building_footprints "
            "(même source que run_matching_v5.py, pas BDNB)."
        )
    )
    ap.add_argument("--code-insee", default="", help="Filtrer une commune INSEE (optionnel)")
    ap.add_argument("--limit", type=int, default=0, help="Limiter le nombre de lignes lues (0 = toutes)")
    ap.add_argument("--batch-size", type=int, default=250, help="Taille des lots de lecture/mise à jour")
    ap.add_argument("--dry-run", action="store_true", help="Calcule le backfill sans écrire en base")
    args = ap.parse_args()

    url = resolve_database_url()
    if not url:
        raise RuntimeError("Aucune URL Postgres disponible")

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as exc:
        raise RuntimeError("psycopg2-binary requis") from exc

    scout_q = qualified_scout_matching_v5_table()
    osm_q = qualified_osm_buildings_table()

    conn = psycopg2.connect(url)
    updated = 0
    scanned = 0
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                ALTER TABLE {scout_q}
                ADD COLUMN IF NOT EXISTS building_geometries_json JSONB NOT NULL DEFAULT '[]'::jsonb
                """
            )
            conn.commit()

            params: list[Any] = []
            where = ["grain = 'parcelle'"]
            if args.code_insee.strip():
                where.append("code_insee = %s")
                params.append(args.code_insee.strip())
            where_sql = " AND ".join(where)
            limit_sql = ""
            if args.limit and args.limit > 0:
                limit_sql = "LIMIT %s"
                params.append(int(args.limit))

            cur.execute(
                f"""
                SELECT scout_v5_id, properties_json
                FROM {scout_q}
                WHERE {where_sql}
                ORDER BY scout_v5_id
                {limit_sql}
                """,
                params,
            )
            rows = cur.fetchall()
            scanned = len(rows)
            batch_size = max(1, int(args.batch_size))
            batch_ids = list(_chunked([r["scout_v5_id"] for r in rows], batch_size))
            n_batches = len(batch_ids)
            print(
                f"[v5-backfill] {scanned} parcelle(s), {n_batches} lot(s) de {batch_size} — source OSM {osm_q}",
                flush=True,
            )

            for batch_idx, batch in enumerate(batch_ids, 1):
                batch_rows = [r for r in rows if r["scout_v5_id"] in set(batch)]
                all_osm_ids: list[str] = []
                for row in batch_rows:
                    props = row.get("properties_json") or {}
                    if not isinstance(props, dict):
                        continue
                    all_osm_ids.extend(
                        _extract_osm_building_ids(_parse_buildings_json_items(props.get("buildings_json")))
                    )
                uniq_osm_ids = sorted(set(all_osm_ids))
                payload_by_osm: dict[str, dict[str, Any]] = {}
                if uniq_osm_ids:
                    payload_by_osm = fetch_osm_geometry_payloads(cur, uniq_osm_ids, osm_q)

                for row in batch_rows:
                    props = row.get("properties_json") or {}
                    if not isinstance(props, dict):
                        continue
                    items = _parse_buildings_json_items(props.get("buildings_json"))
                    payload = []
                    for item in items:
                        osm_id = _osm_building_id_from_item(item)
                        if not osm_id:
                            continue
                        osm_item = payload_by_osm.get(osm_id)
                        if not osm_item:
                            continue
                        entry = _building_geometry_entry(item, osm_item)
                        if entry:
                            payload.append(entry)
                    if args.dry_run:
                        if payload:
                            updated += 1
                        continue
                    if not payload:
                        continue
                    cur.execute(
                        f"""
                        UPDATE {scout_q}
                        SET building_geometries_json = %s::jsonb,
                            properties_json = jsonb_set(
                              COALESCE(properties_json, '{{}}'::jsonb),
                              '{{building_geometries_json}}',
                              %s::jsonb,
                              true
                            )
                        WHERE scout_v5_id = %s
                        """,
                        (
                            json.dumps(payload, ensure_ascii=False),
                            json.dumps(payload, ensure_ascii=False),
                            row["scout_v5_id"],
                        ),
                    )
                    updated += 1
                if not args.dry_run:
                    conn.commit()
                print(
                    f"[v5-backfill] lot {batch_idx}/{n_batches} — {updated} ligne(s) mises à jour",
                    flush=True,
                )
    finally:
        conn.close()

    mode = "DRY_RUN" if args.dry_run else "APPLIED"
    print(f"[v5-backfill] {mode} scanned={scanned} updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
