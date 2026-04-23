"""Matching V4 — résolution adresse bâtiment : BDNB/staging d'abord, puis BAN.

Ce module reste volontairement pur et testable : on lui passe des ``dict`` (ligne
Postgres, propriétés GeoJSON, etc.) et un client HTTP injectable pour BAN.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol


class JsonGetFn(Protocol):
    def __call__(self, url: str, timeout_s: float) -> dict[str, Any]: ...


def default_json_get(url: str, timeout_s: float = 20.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _clean_token(v: Any) -> str:
    if v is None:
        return ""
    t = str(v).strip()
    return _norm_spaces(t)


def _pick_first_non_empty(row: dict[str, Any], keys: tuple[str, ...]) -> str:
    for k in keys:
        v = _clean_token(row.get(k))
        if v:
            return v
    return ""


@dataclass(frozen=True)
class ResolvedAddress:
    full_address: str
    source: str  # "bdnb" | "ban"
    lat: float | None
    lon: float | None


def extract_bdnb_address(row: dict[str, Any]) -> str | None:
    """Construit une adresse texte depuis champs BDNB/staging usuels.

    Les noms de colonnes varient selon les tables/imports ; on gère plusieurs alias.
    """
    num = _pick_first_non_empty(row, ("numero_voie", "num_voie", "numero", "street_number"))
    rep = _pick_first_non_empty(row, ("indice_repetition", "rep", "suffixe_voie"))
    voie = _pick_first_non_empty(
        row,
        ("nom_voie", "libelle_voie", "voie", "street_name"),
    )
    cp = _pick_first_non_empty(
        row,
        ("code_postal", "cp", "postal_code"),
    )
    city = _pick_first_non_empty(
        row,
        ("nom_commune", "commune", "city", "city_name"),
    )
    adresse_brute = _pick_first_non_empty(
        row,
        ("building_address_ban", "adresse", "address"),
    )

    parts = []
    if num:
        parts.append(num)
    if rep:
        parts.append(rep)
    if voie:
        parts.append(voie)
    first = _norm_spaces(" ".join(parts))

    tail = _norm_spaces(" ".join([x for x in (cp, city) if x]))
    out = _norm_spaces(", ".join([x for x in (first, tail) if x]))

    if out:
        return out
    if adresse_brute:
        return adresse_brute
    return None


def reverse_geocode_ban(
    *,
    lat: float,
    lon: float,
    get_json: JsonGetFn | None = None,
    timeout_s: float = 20.0,
) -> str | None:
    fn = get_json or default_json_get
    qs = urllib.parse.urlencode({"lat": f"{lat:.7f}", "lon": f"{lon:.7f}", "limit": "1"})
    url = f"https://api-adresse.data.gouv.fr/reverse/?{qs}"
    data = fn(url, timeout_s)
    features = data.get("features")
    if not isinstance(features, list) or not features:
        return None
    p0 = features[0].get("properties") if isinstance(features[0], dict) else None
    if not isinstance(p0, dict):
        return None
    label = _clean_token(p0.get("label"))
    return label or None


def resolve_building_address(
    *,
    row: dict[str, Any],
    fallback_lat: float | None,
    fallback_lon: float | None,
    get_json: JsonGetFn | None = None,
) -> ResolvedAddress | None:
    bdnb = extract_bdnb_address(row)
    if bdnb:
        return ResolvedAddress(full_address=bdnb, source="bdnb", lat=fallback_lat, lon=fallback_lon)
    if fallback_lat is None or fallback_lon is None:
        return None
    ban = reverse_geocode_ban(lat=fallback_lat, lon=fallback_lon, get_json=get_json)
    if not ban:
        return None
    return ResolvedAddress(full_address=ban, source="ban", lat=fallback_lat, lon=fallback_lon)
