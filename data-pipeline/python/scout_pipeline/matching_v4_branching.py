"""Matching V4 — branches A2/B1/B2/0 + fallback C1/C2.

Ce module orchestre :
- recherche d'entreprises à l'adresse (A2),
- sélection directe en cas de résultat unique (B1),
- fallback Google Nearby + scoring find-local-siren (C1/C2) sinon.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from scout_pipeline.matching_v4_google_fallback import run_google_c1_c2_fallback


class JsonGetFn(Protocol):
    def __call__(self, url: str, timeout_s: float) -> dict[str, Any]: ...


def default_json_get(url: str, timeout_s: float = 30.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


@dataclass(frozen=True)
class AddressEnterprise:
    siren: str
    siret: str
    nom_complet: str
    adresse: str
    code_postal: str


@dataclass(frozen=True)
class BranchResult:
    match_path: str
    siren: str | None
    siret: str | None
    entreprises_a_adresse_count: int
    fallback_google_used: bool
    primary_poi_name: str | None
    primary_poi_source: str | None


def _to_address_enterprise(raw: dict[str, Any]) -> AddressEnterprise | None:
    siren = str(raw.get("siren") or "").strip()
    siret = str(raw.get("siret") or "").strip()
    if not siren or not siret:
        return None
    return AddressEnterprise(
        siren=siren,
        siret=siret,
        nom_complet=str(raw.get("nom_complet") or raw.get("nom_raison_sociale") or "").strip(),
        adresse=str(raw.get("adresse") or "").strip(),
        code_postal=str(raw.get("code_postal") or "").strip(),
    )


def search_enterprises_by_address(
    *,
    address: str,
    get_json: JsonGetFn | None = None,
    per_page: int = 20,
) -> list[AddressEnterprise]:
    fn = get_json or default_json_get
    qs = urllib.parse.urlencode({"q": address, "per_page": str(max(1, min(100, per_page)))})
    url = f"https://recherche-entreprises.api.gouv.fr/search?{qs}"
    data = fn(url, 30.0)
    rows = data.get("results")
    if not isinstance(rows, list):
        return []
    out: list[AddressEnterprise] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        e = _to_address_enterprise(row)
        if e is not None:
            out.append(e)
    return out


def resolve_a2_branches(
    *,
    address: str,
    lat: float,
    lon: float,
    find_local_siren_base_url: str,
    google_api_key: str,
    get_json: JsonGetFn | None = None,
    radius_m: float = 180.0,
    min_score: float = 0.0,
) -> BranchResult:
    rows = search_enterprises_by_address(address=address, get_json=get_json)
    n = len(rows)

    if n == 1:
        e = rows[0]
        return BranchResult(
            match_path="A2_ADDR_SINGLE",
            siren=e.siren,
            siret=e.siret,
            entreprises_a_adresse_count=1,
            fallback_google_used=False,
            primary_poi_name=None,
            primary_poi_source="address",
        )

    if n >= 2:
        m, poi_name = run_google_c1_c2_fallback(
            find_local_siren_base_url=find_local_siren_base_url,
            api_key=google_api_key,
            address=address,
            lat=lat,
            lon=lon,
            radius_m=radius_m,
            get_json=get_json,
            min_score=min_score,
        )
        return BranchResult(
            match_path="A2_ADDR_MULTI_GOOGLE",
            siren=m.siren if m else None,
            siret=m.siret if m else None,
            entreprises_a_adresse_count=n,
            fallback_google_used=True,
            primary_poi_name=poi_name,
            primary_poi_source="google_nearby" if poi_name else None,
        )

    m, poi_name = run_google_c1_c2_fallback(
        find_local_siren_base_url=find_local_siren_base_url,
        api_key=google_api_key,
        address=address,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        get_json=get_json,
        min_score=min_score,
    )
    return BranchResult(
        match_path="A2_ADDR_ZERO_GOOGLE",
        siren=m.siren if m else None,
        siret=m.siret if m else None,
        entreprises_a_adresse_count=0,
        fallback_google_used=True,
        primary_poi_name=poi_name,
        primary_poi_source="google_nearby" if poi_name else None,
    )
