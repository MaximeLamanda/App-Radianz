"""Client HTTP vers ``/api/find-local-siren`` (même sémantique que ``findLocalSiren`` côté app).

Le pipeline batch Python appelle le serveur Next local (ou preview) avec
``poiName`` = nom OSM, ``address`` = adresse BDNB/BAN, ``lat`` / ``lon`` = point
de référence (ex. centroïde emprise).

Variables d’environnement utiles :
- ``SCOUT_FIND_LOCAL_SIREN_BASE_URL`` : ex. ``http://127.0.0.1:3000`` (sans slash final).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol


class JsonPostFn(Protocol):
    def __call__(self, url: str, body: dict[str, Any], timeout_s: float) -> dict[str, Any]: ...


def default_json_post(url: str, body: dict[str, Any], timeout_s: float = 60.0) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


@dataclass(frozen=True)
class FindLocalSirenMatch:
    siren: str
    siret: str
    nom_complet: str
    score: float
    winning_query: str | None


def post_find_local_siren(
    *,
    base_url: str,
    poi_name: str,
    address: str,
    lat: float,
    lon: float,
    post_json: JsonPostFn | None = None,
    timeout_s: float = 60.0,
) -> FindLocalSirenMatch | None:
    """POST ``{ poiName, address, lat, lon }`` vers ``/api/find-local-siren``."""
    root = base_url.rstrip("/")
    url = f"{root}/api/find-local-siren"
    fn = post_json or default_json_post
    payload = {"poiName": poi_name, "address": address, "lat": lat, "lon": lon}
    data = fn(url, payload, timeout_s=timeout_s)
    if not isinstance(data, dict):
        return None
    if data.get("error"):
        return None
    inner = data.get("result")
    if not isinstance(inner, dict):
        return None
    siren = str(inner.get("siren") or "").strip()
    siret = str(inner.get("siret") or "").strip()
    if not siren or not siret:
        return None
    nom = str(inner.get("nom_complet") or "").strip()
    try:
        score = float(inner.get("score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    wq = inner.get("winningQuery")
    winning = str(wq).strip() if wq is not None and str(wq).strip() else None
    return FindLocalSirenMatch(
        siren=siren,
        siret=siret,
        nom_complet=nom,
        score=score,
        winning_query=winning,
    )


def resolve_find_local_siren_base_url() -> str:
    return (os.environ.get("SCOUT_FIND_LOCAL_SIREN_BASE_URL") or "").strip().rstrip("/")


def try_a1_osm_stack(
    *,
    ranked_osm: Sequence[Any],
    address: str,
    lat: float,
    lon: float,
    base_url: str | None = None,
    min_score: float = 0.0,
    post_json: JsonPostFn | None = None,
) -> tuple[FindLocalSirenMatch | None, int]:
    """Pour chaque OSM nommé (déjà trié), appelle find-local-siren jusqu’au 1er match score ≥ ``min_score``.

    Retourne ``(match ou None, nombre_tentatives)``.
    """
    root = (base_url or resolve_find_local_siren_base_url()).strip().rstrip("/")
    if not root:
        return None, 0
    tries = 0
    for row in ranked_osm:
        if hasattr(row, "name"):
            name = str(getattr(row, "name") or "").strip()
        elif isinstance(row, dict):
            name = str(row.get("name") or "").strip()
        else:
            continue
        if not name:
            continue
        tries += 1
        m = post_find_local_siren(
            base_url=root,
            poi_name=name,
            address=address,
            lat=lat,
            lon=lon,
            post_json=post_json,
        )
        if m is not None and m.score >= min_score:
            return m, tries
    return None, tries
