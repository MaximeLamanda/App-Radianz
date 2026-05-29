"""
Géocodage inverse BAN via Postgres local (table scout_ban_adresses).

Remplace les appels HTTP Géoplateforme /reverse dans le matching V5.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Protocol

from geoplateforme_geocode import GeoplateformeAddressHit


class _CursorLike(Protocol):
    def execute(self, query: str, params: Any = None) -> None: ...
    def fetchall(self) -> list[tuple[Any, ...]]: ...
    def fetchone(self) -> tuple[Any, ...] | None: ...


def distance_m_to_score(dist_m: float) -> float:
    """Pseudo-score Addok-compatible : 0 m → 0,99 ; 25 m → 0,865 ; 50 m → 0,74."""
    if not math.isfinite(dist_m) or dist_m <= 0:
        return 0.99
    return max(0.0, min(0.99, 0.99 - float(dist_m) * 0.005))


def build_ban_label(
    *,
    numero: str,
    rep: str,
    nom_voie: str,
    code_postal: str,
    nom_commune: str,
) -> str:
    hn = (numero or "").strip()
    if rep and str(rep).strip():
        hn = f"{hn} {str(rep).strip()}".strip()
    street = (nom_voie or "").strip()
    cp = (code_postal or "").strip()
    city = (nom_commune or "").strip()
    parts: list[str] = []
    if hn and street:
        parts.append(f"{hn} {street}")
    elif street:
        parts.append(street)
    elif hn:
        parts.append(hn)
    if cp and city:
        parts.append(f"{cp} {city}")
    elif city:
        parts.append(city)
    return " ".join(parts).strip()


def row_to_geoplateforme_hit(row: tuple[Any, ...]) -> GeoplateformeAddressHit:
    (
        ban_id,
        numero,
        rep,
        nom_voie,
        code_postal,
        code_insee,
        nom_commune,
        lon,
        lat,
        dist_m,
    ) = row
    numero_s = str(numero or "").strip()
    rep_s = str(rep or "").strip()
    hn = numero_s
    if rep_s:
        hn = f"{numero_s} {rep_s}".strip() if numero_s else rep_s
    label = build_ban_label(
        numero=numero_s,
        rep=rep_s,
        nom_voie=str(nom_voie or ""),
        code_postal=str(code_postal or ""),
        nom_commune=str(nom_commune or ""),
    )
    dist = float(dist_m) if dist_m is not None else None
    result_type = "housenumber" if numero_s else "street"
    return GeoplateformeAddressHit(
        label=label or str(ban_id or ""),
        score=distance_m_to_score(dist or 0.0),
        distance_m=dist,
        citycode=str(code_insee or "").strip(),
        result_type=result_type,
        lon=float(lon),
        lat=float(lat),
        street=str(nom_voie or "").strip(),
        housenumber=numero_s,
        postcode=str(code_postal or "").strip(),
        city=str(nom_commune or "").strip(),
    )


_REVERSE_SQL_BASE = """
SELECT
  ban_id,
  numero,
  rep,
  nom_voie,
  code_postal,
  code_insee,
  nom_commune,
  lon,
  lat,
  ST_Distance(
    geom::geography,
    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
  ) AS dist_m
FROM public.scout_ban_adresses
{where}
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)
LIMIT %(limit)s
"""


@dataclass
class LocalBanGeocoder:
    """Géocodage inverse via KNN PostGIS sur scout_ban_adresses."""

    conn: Any
    code_insee: str | None = None
    _table_checked: bool = False

    def _cursor(self) -> _CursorLike:
        return self.conn.cursor()

    def ensure_table(self) -> int:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                  SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'scout_ban_adresses'
                )
                """
            )
            exists = bool(cur.fetchone()[0])
            if not exists:
                raise RuntimeError(
                    "Table public.scout_ban_adresses absente. "
                    "Lancer : npm run import:ban-france"
                )
            cur.execute(
                """
                SELECT COALESCE(
                  (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.scout_ban_adresses'::regclass),
                  0
                )
                """
            )
            n = int(cur.fetchone()[0] or 0)
            if n <= 0:
                cur.execute("SELECT 1 FROM public.scout_ban_adresses LIMIT 1")
                if cur.fetchone() is None:
                    raise RuntimeError(
                        "Table public.scout_ban_adresses vide. "
                        "Lancer : npm run import:ban-france"
                    )
                n = 1
        self._table_checked = True
        return n

    def reverse(
        self,
        lon: float,
        lat: float,
        *,
        limit: int = 1,
        code_insee: str | None = None,
    ) -> GeoplateformeAddressHit | None:
        if not self._table_checked:
            self.ensure_table()
        lim = max(1, int(limit))
        insee = str(code_insee or self.code_insee or "").strip()
        params: dict[str, Any] = {"lon": float(lon), "lat": float(lat), "limit": lim}
        if insee:
            params["code_insee"] = insee
            where = "WHERE code_insee = %(code_insee)s"
        else:
            where = ""
        sql = _REVERSE_SQL_BASE.format(where=where)
        with self._cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        if not rows:
            return None
        return row_to_geoplateforme_hit(rows[0])

    def search(self, query: str, *, limit: int = 1) -> GeoplateformeAddressHit | None:
        """Non implémenté en local — le matching V5 n'utilise que reverse()."""
        return None
