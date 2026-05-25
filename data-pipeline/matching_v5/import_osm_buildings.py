#!/usr/bin/env python3
"""
Import footprints bâtiments OSM (.osm.pbf) vers Postgres (public.osm_building_footprints).

  pip install -r data-pipeline/python/requirements.txt
  python3 data-pipeline/matching_v5/import_osm_buildings.py --input chemin.osm.pbf --truncate
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_PIPELINE_DIR = REPO_ROOT / "data-pipeline" / "python"
if str(PYTHON_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_PIPELINE_DIR))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import osmium  # noqa: E402
import osmium.geom  # noqa: E402
from shapely import from_wkb  # noqa: E402
from shapely.geometry import LineString, Polygon  # noqa: E402
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon  # noqa: E402

from osm_buildings_v5 import (  # noqa: E402
    osm_building_tag_is_importable,
    qualified_osm_buildings_table,
)
from osm_poi_v5 import tags_dict  # noqa: E402

DATABASE_URL_ENV_KEYS = [
    "LOCAL_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
    "Radianz_DATABASE_URL",
    "RADIANZ_POSTGRES_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
]


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env.local", ".env"):
        p = REPO_ROOT / name
        if p.is_file():
            load_dotenv(p)


def resolve_database_url() -> str | None:
    _load_dotenv()
    for k in DATABASE_URL_ENV_KEYS:
        v = os.environ.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _postgres_target_for_log(url: str) -> str:
    """Hôte / base pour les logs (sans mot de passe)."""
    u = url.strip()
    if not u.startswith(("postgres://", "postgresql://")):
        return "(DSN non URL — détail masqué)"
    try:
        p = urlparse(u)
        host = p.hostname or "?"
        port = f":{p.port}" if p.port else ""
        db = (p.path or "").lstrip("/") or "(sans base)"
        return f"{host}{port} db={db}"
    except Exception:
        return "(URL illisible)"


def _truncate_table(cur: Any, qualified: str, *, lock_timeout_ms: int) -> None:
    """TRUNCATE avec lock_timeout optionnel (ms). 0 = attente illimitée."""
    if lock_timeout_ms > 0:
        cur.execute("SET lock_timeout TO %s", (lock_timeout_ms,))
    try:
        cur.execute(f"TRUNCATE TABLE {qualified}")
    finally:
        if lock_timeout_ms > 0:
            cur.execute("SET lock_timeout TO DEFAULT")


def _geom_from_osmium_wkb(wkb: object) -> Any:
    if isinstance(wkb, str):
        return from_wkb(bytes.fromhex(wkb))
    if isinstance(wkb, (bytes, bytearray)):
        return from_wkb(bytes(wkb))
    return from_wkb(bytes(memoryview(wkb)))


def _format_osm_address(tags: dict[str, str]) -> str:
    full = (tags.get("addr:full") or "").strip()
    if full:
        return full
    hn = (tags.get("addr:housenumber") or "").strip()
    hname = (tags.get("addr:housename") or "").strip()
    street = (tags.get("addr:street") or tags.get("addr:place") or "").strip()
    city = (tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or "").strip()
    pc = (tags.get("addr:postcode") or "").strip()
    line1 = " ".join(x for x in (hn, hname, street) if x).strip()
    line2 = " ".join(x for x in (pc, city) if x).strip()
    out = ", ".join(x for x in (line1, line2) if x).strip()
    return out or (tags.get("contact:address") or "").strip()


def _tags_stored(tags: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    allowed_keys = {
        "building",
        "name",
        "official_name",
        "brand",
        "operator",
        "building:levels",
        "building:use",
        "website",
        "contact:website",
        "url",
        "phone",
        "contact:phone",
        "mobile",
        "contact:mobile",
        "amenity",
        "shop",
        "craft",
        "office",
        "healthcare",
        "leisure",
        "tourism",
        "man_made",
    }
    for k, v in tags.items():
        lk = str(k).strip()
        if not lk:
            continue
        if lk in allowed_keys or lk.startswith("addr:"):
            sv = str(v).strip()
            if sv:
                out[lk] = sv
    return out


def _normalize_polygonal(geom: Any) -> ShapelyMultiPolygon | None:
    if geom is None or geom.is_empty:
        return None
    g = geom
    if isinstance(g, LineString):
        if not g.is_ring or len(g.coords) < 4:
            return None
        g = Polygon(g.coords)
    if isinstance(g, Polygon):
        return ShapelyMultiPolygon([g])
    if isinstance(g, ShapelyMultiPolygon):
        return g
    if hasattr(g, "geoms"):
        polys = [p for p in g.geoms if isinstance(p, Polygon)]
        if not polys:
            return None
        return ShapelyMultiPolygon(polys)
    return None


class PbfBuildingsStreamingHandler(osmium.SimpleHandler):
    """
    Écrit les empreintes au fil de l’eau pendant le scan PBF (pas de liste géante en RAM).
    """

    def __init__(
        self,
        cur: Any,
        qualified: str,
        *,
        batch_size: int,
        log_every: int,
    ) -> None:
        super().__init__()
        self._cur = cur
        self._qualified = qualified
        self._batch_size = max(1, int(batch_size))
        self._log_every = max(1000, int(log_every))
        self._wkb = osmium.geom.WKBFactory()
        self._buffer: list[tuple[str, int, str, dict[str, str], str]] = []
        self.ways_kept = 0
        self.relations_kept = 0
        self.skipped_geom = 0
        self._inserted = 0
        self._next_log_at = self._log_every

    def _flush(self) -> None:
        if not self._buffer:
            return
        insert_batch(self._cur, self._qualified, self._buffer)
        self._inserted += len(self._buffer)
        self._buffer.clear()
        if self._inserted >= self._next_log_at:
            print(
                f"[osm_buildings] … {self._inserted} empreintes écrites "
                f"(ways {self.ways_kept}, rel {self.relations_kept}, géom ignorées {self.skipped_geom})",
                flush=True,
            )
            while self._next_log_at <= self._inserted:
                self._next_log_at += self._log_every

    def final_flush(self) -> None:
        self._flush()

    def _emit(self, osm_type: str, osm_id: int, geom: Any, tags: dict[str, str]) -> None:
        norm = _normalize_polygonal(geom)
        if norm is None:
            self.skipped_geom += 1
            return
        self._buffer.append(
            (
                osm_type,
                int(osm_id),
                norm.wkt,
                _tags_stored(tags),
                _format_osm_address(tags),
            )
        )
        if osm_type == "w":
            self.ways_kept += 1
        else:
            self.relations_kept += 1
        if len(self._buffer) >= self._batch_size:
            self._flush()

    def way(self, w: osmium.osm.Way) -> None:
        tags = tags_dict(dict(w.tags))
        if not osm_building_tag_is_importable(tags):
            return
        if not w.is_closed():
            return
        try:
            wkb = self._wkb.create_linestring(w)
            geom = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.skipped_geom += 1
            return
        self._emit("w", int(w.id), geom, tags)

    def area(self, a: osmium.osm.Area) -> None:
        tags = tags_dict(dict(a.tags))
        if not osm_building_tag_is_importable(tags):
            return
        try:
            wkb = self._wkb.create_multipolygon(a)
            geom = _geom_from_osmium_wkb(wkb)
        except Exception:
            self.skipped_geom += 1
            return
        self._emit("r", int(a.id), geom, tags)


def apply_osm_buildings_schema_sql(
    cur: Any,
    *,
    log: Callable[[str], None] | None = None,
    truncate_after_create_table: bool = False,
    qualified: str | None = None,
    truncate_lock_timeout_ms: int = 0,
) -> bool:
    """
    Applique 005_osm_building_footprints.sql statement par statement.

    Si ``truncate_after_create_table`` est True et ``qualified`` est fourni, exécute
    TRUNCATE juste après le CREATE TABLE et *avant* les CREATE INDEX : les index
    se construisent sur une table vide (rapide), au lieu de millions de lignes.

    Retourne True si un TRUNCATE anticipé a été exécuté ici (l’import pourra sauter
    le sien).

    Les CREATE INDEX sur une table déjà très remplie peuvent durer très longtemps
    ; un CREATE INDEX attend aussi des verrous si une autre session tient la table.
    """
    sql_path = REPO_ROOT / "data-pipeline" / "sql" / "005_osm_building_footprints.sql"
    raw = sql_path.read_text(encoding="utf-8")
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    stmts: list[str] = []
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            stmts.append(stmt)
    n = len(stmts)
    truncated_early = False
    if log and n:
        if truncate_after_create_table and qualified:
            log(
                "Schéma 005 : après CREATE TABLE, TRUNCATE puis index "
                "(évite CREATE INDEX sur des millions de lignes avant import)."
            )
        else:
            log(
                "Schéma 005 : une ligne (début/fin) par instruction SQL. "
                "CREATE INDEX sur table déjà pleine, ou attente de verrou (autre client sur cette table) "
                "peuvent laisser plusieurs minutes sans nouvelle ligne sur le même numéro i."
            )
    for i, stmt in enumerate(stmts, start=1):
        one_line = " ".join(stmt.split())
        preview = one_line if len(one_line) <= 160 else one_line[:157] + "…"
        if log:
            log(f"Schéma DDL {i}/{n} début — {preview}")
        t_stmt = time.perf_counter()
        cur.execute(stmt + ";")
        if log:
            log(f"Schéma DDL {i}/{n} fin — {time.perf_counter() - t_stmt:.2f}s")
        if (
            truncate_after_create_table
            and qualified
            and i == 1
            and stmt.lstrip().upper().startswith("CREATE TABLE")
        ):
            if log:
                to = f"lock_timeout={truncate_lock_timeout_ms}ms" if truncate_lock_timeout_ms > 0 else "lock_timeout=0 (illimité)"
                log(
                    f"TRUNCATE {qualified} avant les index (ACCESS EXCLUSIVE ; {to} ; "
                    "autre session sur la table = attente ou erreur au timeout)…"
                )
            t_tr = time.perf_counter()
            _truncate_table(cur, qualified, lock_timeout_ms=truncate_lock_timeout_ms)
            truncated_early = True
            if log:
                log(f"TRUNCATE (pré-index) terminé en {time.perf_counter() - t_tr:.2f}s.")
    return truncated_early


def insert_batch(cur: Any, qualified: str, batch: list[tuple[str, int, str, dict[str, str], str]]) -> None:
    import psycopg2.extras

    rows = [(ot, oid, wkt, psycopg2.extras.Json(tags), addr) for ot, oid, wkt, tags, addr in batch]
    psycopg2.extras.execute_batch(
        cur,
        f"""
        INSERT INTO {qualified} (osm_type, osm_id, geom, tags, address_text)
        VALUES (%s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326)::geometry(MultiPolygon, 4326), %s, %s)
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          tags = EXCLUDED.tags,
          address_text = EXCLUDED.address_text,
          imported_at = now()
        """,
        rows,
        page_size=max(1, len(rows)),
    )


def enrich_code_insee(cur: Any, qualified: str) -> int:
    cur.execute(
        f"""
        WITH matched AS (
          SELECT
            b.osm_type,
            b.osm_id,
            c.code_insee
          FROM {qualified} b
          INNER JOIN public.cadastre_france_feuilles_geom c
            ON c.geom && b.geom
           AND ST_Intersects(c.geom, ST_PointOnSurface(b.geom))
          WHERE c.code_insee IS NOT NULL
            AND btrim(c.code_insee) <> ''
        )
        UPDATE {qualified} dst
        SET code_insee = matched.code_insee
        FROM matched
        WHERE dst.osm_type = matched.osm_type
          AND dst.osm_id = matched.osm_id
          AND COALESCE(dst.code_insee, '') IS DISTINCT FROM matched.code_insee
        """
    )
    return int(cur.rowcount or 0)


def main() -> int:
    ap = argparse.ArgumentParser(description="Import footprints bâtiments OSM (PBF)")
    ap.add_argument("--input", type=Path, default=None)
    ap.add_argument("--ensure-schema", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument(
        "--truncate-lock-timeout-ms",
        type=int,
        default=120_000,
        help="Attente max (ms) du verrou pour chaque TRUNCATE ; 0 = illimité. "
        "Si une autre session tient osm_building_footprints, erreur après ce délai (défaut 120000).",
    )
    ap.add_argument("--batch-size", type=int, default=600)
    ap.add_argument(
        "--log-every",
        type=int,
        default=25_000,
        help="Affiche une ligne de progression tous les N enregistrements écrits (0 = silence pendant le scan).",
    )
    ap.add_argument(
        "--skip-code-insee-enrichment",
        action="store_true",
        help="N'enrichit pas code_insee (évite un UPDATE spatial long sur toute la table après le scan).",
    )
    args = ap.parse_args()

    if args.input is None and not args.ensure_schema:
        ap.error("indiquez --input fichier.osm.pbf et/ou --ensure-schema")
    url = resolve_database_url()
    if not url:
        print("Aucune URL Postgres (DATABASE_URL, LOCAL_DATABASE_URL, ...)", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("psycopg2-binary requis", file=sys.stderr)
        return 1

    t0 = time.perf_counter()

    def _lap(msg: str) -> None:
        print(f"[osm_buildings] +{time.perf_counter() - t0:7.1f}s {msg}", flush=True)

    tgt = _postgres_target_for_log(url)
    _used_env = next((k for k in DATABASE_URL_ENV_KEYS if (os.environ.get(k) or "").strip()), "?")
    _lap(f"Connexion Postgres (schéma) — env {_used_env} → {tgt}")
    qualified = qualified_osm_buildings_table()
    truncate_before_indexes = bool(args.input and args.truncate)
    conn_s = psycopg2.connect(url)
    truncated_in_schema = False
    try:
        _lap("Connecté (schéma) — exécution 005_osm_building_footprints.sql (CREATE TABLE / INDEX IF NOT EXISTS)…")
        conn_s.autocommit = True
        with conn_s.cursor() as cur:
            truncated_in_schema = apply_osm_buildings_schema_sql(
                cur,
                log=_lap,
                truncate_after_create_table=truncate_before_indexes,
                qualified=qualified if truncate_before_indexes else None,
                truncate_lock_timeout_ms=max(0, int(args.truncate_lock_timeout_ms)),
            )
    except psycopg2.errors.LockNotAvailable as e:
        _lap(
            "TRUNCATE (phase schéma) impossible : verrou non obtenu dans le délai lock_timeout. "
            "Une autre session utilise encore la table osm_building_footprints "
            "(éditeur SQL, serveur de dev, autre import). Ferme ces connexions ou lance "
            "node scripts/postgres-terminate-other-sessions.mjs (puis --execute si tu assumes)."
        )
        print(f"[osm_buildings] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn_s.close()
    _lap(f"Schéma appliqué — table {qualified}")
    if args.input is None:
        return 0

    if not args.input.is_file():
        print(f"Fichier introuvable: {args.input}", file=sys.stderr)
        return 1
    _lap(f"Connexion Postgres (import, transaction) → {tgt}")
    conn = psycopg2.connect(url)
    updated_insee = 0
    handler: PbfBuildingsStreamingHandler | None = None
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            if args.truncate:
                if truncated_in_schema:
                    _lap(f"TRUNCATE déjà fait en phase schéma ({qualified}), pas de second TRUNCATE ici.")
                else:
                    lt = max(0, int(args.truncate_lock_timeout_ms))
                    _lap(
                        f"TRUNCATE {qualified} — ACCESS EXCLUSIVE "
                        f"(lock_timeout={lt}ms si >0 ; autre session = attente ou timeout)…"
                    )
                    t_tr = time.perf_counter()
                    _truncate_table(cur, qualified, lock_timeout_ms=lt)
                    _lap(f"TRUNCATE terminé en {time.perf_counter() - t_tr:.2f}s.")
            else:
                _lap(f"Pas de TRUNCATE (ajouter --truncate pour vider {qualified}).")
            log_every = int(args.log_every) if int(args.log_every) > 0 else 2**62
            handler = PbfBuildingsStreamingHandler(
                cur,
                qualified,
                batch_size=int(args.batch_size),
                log_every=log_every,
            )
            _lap(
                f"Début scan PBF (osmium locations=True idx=flex_mem), lots={args.batch_size} : {args.input}"
            )
            t_scan = time.perf_counter()
            handler.apply_file(str(args.input), locations=True, idx="flex_mem")
            handler.final_flush()
            inserted = handler._inserted
            _lap(
                f"Scan PBF terminé en {time.perf_counter() - t_scan:.1f}s — {inserted} empreintes en base "
                f"(ways {handler.ways_kept}, rel {handler.relations_kept}, géom ignorées {handler.skipped_geom})."
            )
            if not args.skip_code_insee_enrichment:
                _lap(
                    "Enrichissement code_insee : UPDATE + jointure spatiale sur "
                    "public.cadastre_france_feuilles_geom (peut durer très longtemps)…"
                )
                t_insee = time.perf_counter()
                updated_insee = enrich_code_insee(cur, qualified)
                dt_insee = time.perf_counter() - t_insee
                _lap(
                    f"Enrichissement code_insee terminé en {dt_insee:.1f}s — "
                    f"{updated_insee} ligne(s) mise(s) à jour."
                )
            else:
                _lap("Enrichissement code_insee ignoré (--skip-code-insee-enrichment).")
        _lap("COMMIT transaction (import + enrichissement)…")
        conn.commit()
        _lap("COMMIT terminé.")
    except psycopg2.errors.LockNotAvailable as e:
        conn.rollback()
        _lap(
            "ROLLBACK : TRUNCATE impossible (lock timeout) — autre session sur osm_building_footprints. "
            "Voir scripts/postgres-terminate-other-sessions.mjs."
        )
        print(f"[osm_buildings] Erreur: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        conn.rollback()
        _lap(f"ROLLBACK après erreur: {e!r}")
        print(f"[osm_buildings] Erreur: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    assert handler is not None
    _lap(
        f"Terminé — upsert {handler._inserted} | code_insee enrichis {updated_insee} | "
        f"ways {handler.ways_kept} | relations {handler.relations_kept} | geom ignorées {handler.skipped_geom}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
