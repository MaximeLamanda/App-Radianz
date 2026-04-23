"""Matching V4 — fallback Google C1/C2 (Nearby + find-local-siren)."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Protocol

from scout_pipeline.matching_v4_find_local_siren_client import (
    FindLocalSirenMatch,
    post_find_local_siren,
)


class JsonGetFn(Protocol):
    def __call__(self, url: str, timeout_s: float) -> dict[str, Any]: ...


def default_json_get(url: str, timeout_s: float = 30.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_google_nearby_candidates(
    *,
    api_key: str,
    lat: float,
    lon: float,
    radius_m: float,
    get_json: JsonGetFn | None = None,
) -> list[dict[str, Any]]:
    fn = get_json or default_json_get
    qs = urllib.parse.urlencode(
        {
            "location": f"{lat:.7f},{lon:.7f}",
            "radius": str(int(max(1.0, radius_m))),
            "type": "establishment",
            "key": api_key,
        }
    )
    url = f"https://maps.googleapis.com/maps/api/place/nearbysearch/json?{qs}"
    data = fn(url, 30.0)
    if str(data.get("status") or "") != "OK":
        return []
    rows = data.get("results")
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        geom = row.get("geometry")
        loc = geom.get("location") if isinstance(geom, dict) else None
        if not name or not isinstance(loc, dict):
            continue
        try:
            rlat = float(loc.get("lat"))
            rlon = float(loc.get("lng"))
        except (TypeError, ValueError):
            continue
        out.append({"name": name, "lat": rlat, "lon": rlon})
    return out


def run_google_c1_c2_fallback(
    *,
    find_local_siren_base_url: str,
    api_key: str,
    address: str,
    lat: float,
    lon: float,
    radius_m: float,
    get_json: JsonGetFn | None = None,
    min_score: float = 0.0,
) -> tuple[FindLocalSirenMatch | None, str | None]:
    """Retourne (match, nom_poi_retenu) en appliquant C1 puis C2."""
    cands = fetch_google_nearby_candidates(
        api_key=api_key,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        get_json=get_json,
    )
    for c in cands:
        m = post_find_local_siren(
            base_url=find_local_siren_base_url,
            poi_name=str(c["name"]),
            address=address,
            lat=float(c["lat"]),
            lon=float(c["lon"]),
        )
        if m is not None and m.score >= min_score:
            return m, str(c["name"])
    return None, None
