"""
Client HTTP minimal pour le service de géocodage Géoplateforme.
https://data.geopf.fr/geocodage/ (reverse + search)
"""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

GEOPLATEFORME_BASE = "https://data.geopf.fr/geocodage"
DEFAULT_TIMEOUT_S = 15.0
_MIN_INTERVAL_S = 1.0 / 40.0  # ≤ 40 req/s


JsonGetFn = Callable[[str, float], dict[str, Any]]


def default_json_get(url: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


@dataclass(frozen=True)
class GeoplateformeAddressHit:
    label: str
    score: float
    distance_m: float | None
    citycode: str
    result_type: str
    lon: float
    lat: float
    street: str
    housenumber: str
    postcode: str
    city: str


def _safe_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def parse_geoplateforme_feature(feature: dict[str, Any] | None) -> GeoplateformeAddressHit | None:
    if not feature or not isinstance(feature, dict):
        return None
    props = feature.get("properties")
    geom = feature.get("geometry")
    if not isinstance(props, dict) or not isinstance(geom, dict):
        return None
    coords = geom.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None
    lon = _safe_float(coords[0])
    lat = _safe_float(coords[1])
    if lon is None or lat is None:
        return None
    label = str(props.get("label") or props.get("name") or "").strip()
    if not label:
        return None
    score = _safe_float(props.get("score"))
    if score is None:
        return None
    dist = _safe_float(props.get("distance"))
    citycode = str(props.get("citycode") or "").strip()
    result_type = str(props.get("type") or props.get("_type") or "").strip().lower()
    return GeoplateformeAddressHit(
        label=label,
        score=score,
        distance_m=dist,
        citycode=citycode,
        result_type=result_type,
        lon=lon,
        lat=lat,
        street=str(props.get("street") or "").strip(),
        housenumber=str(props.get("housenumber") or "").strip(),
        postcode=str(props.get("postcode") or "").strip(),
        city=str(props.get("city") or "").strip(),
    )


def _first_feature(payload: dict[str, Any]) -> dict[str, Any] | None:
    feats = payload.get("features")
    if not isinstance(feats, list) or not feats:
        return None
    first = feats[0]
    return first if isinstance(first, dict) else None


class GeoplateformeGeocoder:
    def __init__(
        self,
        *,
        json_get: JsonGetFn | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        min_interval_s: float = _MIN_INTERVAL_S,
    ) -> None:
        self._json_get = json_get or default_json_get
        self._timeout_s = timeout_s
        self._min_interval_s = min_interval_s
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        now = time.monotonic()
        wait = self._min_interval_s - (now - self._last_request_at)
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def _get(self, path: str, params: dict[str, str | int | float]) -> dict[str, Any] | None:
        qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None and v != ""})
        url = f"{GEOPLATEFORME_BASE}{path}?{qs}"
        self._throttle()
        try:
            return self._json_get(url, self._timeout_s)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            return None

    def reverse(
        self,
        lon: float,
        lat: float,
        *,
        limit: int = 1,
        code_insee: str | None = None,
    ) -> GeoplateformeAddressHit | None:
        _ = code_insee
        payload = self._get("/reverse", {"lon": lon, "lat": lat, "limit": limit})
        if not payload:
            return None
        feat = _first_feature(payload)
        return parse_geoplateforme_feature(feat)

    def search(self, query: str, *, limit: int = 1) -> GeoplateformeAddressHit | None:
        q = str(query or "").strip()
        if len(q) < 5:
            return None
        payload = self._get("/search", {"q": q, "limit": limit})
        if not payload:
            return None
        feat = _first_feature(payload)
        return parse_geoplateforme_feature(feat)
