#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from typing import Any

from run_matching_v5 import (
    qualified_bdnb_constructions_table,
    qualified_scout_matching_v5_table,
    resolve_database_url,
    fetch_construction_payloads,
)


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


def _extract_construction_ids(buildings_json_raw: str) -> list[str]:
    s = str(buildings_json_raw or "").strip()
    if not s:
        return []
    try:
        arr = json.loads(s)
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in arr:
        if not isinstance(item, dict):
            continue
        bid = str(item.get("batiment_construction_id") or "").strip()
        if not bid or bid in seen:
            continue
        seen.add(bid)
        out.append(bid)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill des building_geometries_json pour scout_matching_v5_features")
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
    constructions_q, _ = qualified_bdnb_constructions_table()

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

            for batch in _chunked([r["scout_v5_id"] for r in rows], max(1, int(args.batch_size))):
                batch_rows = [r for r in rows if r["scout_v5_id"] in set(batch)]
                all_ids: list[str] = []
                for row in batch_rows:
                    props = row.get("properties_json") or {}
                    if not isinstance(props, dict):
                        continue
                    all_ids.extend(_extract_construction_ids(_buildings_json_raw_for_parse(props.get("buildings_json"))))
                uniq_ids = sorted(set(all_ids))
                payload_by_id: dict[str, dict[str, Any]] = {}
                if uniq_ids:
                    payload_by_id = fetch_construction_payloads(cur, uniq_ids, constructions_q)

                for row in batch_rows:
                    props = row.get("properties_json") or {}
                    if not isinstance(props, dict):
                        continue
                    buildings_json_raw = _buildings_json_raw_for_parse(props.get("buildings_json"))
                    ids = _extract_construction_ids(buildings_json_raw)
                    payload = []
                    for bid in ids:
                        item = payload_by_id.get(bid)
                        if not item:
                            continue
                        try:
                            geometry = json.loads(str(item["geometry"]))
                        except json.JSONDecodeError:
                            continue
                        payload.append(
                            {
                                "batiment_construction_id": item["batiment_construction_id"],
                                "batiment_groupe_id": item.get("batiment_groupe_id"),
                                "footprint_m2": item.get("footprint_m2"),
                                "geometry": geometry,
                            }
                        )
                    if args.dry_run:
                        if payload:
                            updated += 1
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
    finally:
        conn.close()

    mode = "DRY_RUN" if args.dry_run else "APPLIED"
    print(f"[v5-backfill] {mode} scanned={scanned} updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
