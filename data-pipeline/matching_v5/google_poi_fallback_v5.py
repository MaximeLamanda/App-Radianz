"""
Fallback Google Places (V5) — aligné sur le front /api/matching-v5/google-poi-fallback :
Nearby Search → Place Details (adresse) → recherche api.gouv → filtre CP,
puis re-match local scout_etablissements via adresse synthétique.
"""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from shapely.geometry import Point, shape

from scout_pipeline.address_normalization import (
    normalize_address_parts,
    normalize_text,
    street_number_match_set,
)

JsonGetFn = Callable[[str, float], dict[str, Any]]


def default_json_get(url: str, timeout_s: float = 30.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --- Aligné sur lib/matching-v5-google-poi-fallback/type-weights.ts ---
_TYPE_WEIGHTS: dict[str, float] = {
    "establishment": 1.35,
    "point_of_interest": 1.15,
    "store": 1.2,
    "food": 1.1,
    "restaurant": 1.1,
    "cafe": 1.05,
    "finance": 0.95,
    "health": 1.05,
    "gym": 1.0,
    "lodging": 1.05,
    "route": 0.2,
    "street_address": 0.35,
    "locality": 0.25,
    "political": 0.2,
    "premise": 1.0,
    "subpremise": 0.85,
    "geocode": 0.3,
}


def _score_place_types(types: list[str] | None) -> float:
    if not types:
        return 0.55
    best = 0.5
    for t in types:
        w = _TYPE_WEIGHTS.get(t)
        if w is not None and w > best:
            best = w
    return min(1.5, best)


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


_MAX_DISTANCE_M = 500.0
_PARCEL_INSIDE_BONUS = 0.2


def _parcel_shape_from_geojson(geom_geojson: str) -> Any | None:
    if not (geom_geojson or "").strip():
        return None
    try:
        return shape(json.loads(geom_geojson))
    except Exception:
        return None


def _rank_nearby_for_parcel(
    centroid_lat: float,
    centroid_lng: float,
    results: list[dict[str, Any]],
    parcel_shp: Any | None,
    *,
    max_ranked: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    ranked: list[tuple[float, dict[str, Any]]] = []
    excluded_outside = 0
    for row in results:
        geom = row.get("geometry")
        loc = geom.get("location") if isinstance(geom, dict) else None
        if not isinstance(loc, dict):
            continue
        try:
            plat = float(loc.get("lat"))
            plng = float(loc.get("lng"))
        except (TypeError, ValueError):
            continue
        dist_m = _haversine_meters(centroid_lat, centroid_lng, plat, plng)
        if dist_m > _MAX_DISTANCE_M:
            continue
        inside = False
        if parcel_shp is not None:
            pt = Point(plng, plat)
            try:
                inside = bool(parcel_shp.contains(pt) or parcel_shp.touches(pt))
            except Exception:
                inside = False
            if not inside:
                excluded_outside += 1
                continue
        types = row.get("types")
        tlist = [str(x) for x in types] if isinstance(types, list) else []
        type_score = _score_place_types(tlist)
        dist_norm = 1.0 / (1.0 + dist_m / 30.0)
        relevance = 0.62 * dist_norm + 0.38 * type_score
        if parcel_shp is not None and inside:
            relevance += _PARCEL_INSIDE_BONUS
        ranked.append((relevance, row))
    ranked.sort(key=lambda x: x[0], reverse=True)
    out = [r[1] for r in ranked[:max_ranked]]
    return out, excluded_outside


def _serialize_ranked_nearby(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sous-ensemble stable pour export CSV/GeoJSON (audit admin, sans rejouer Nearby)."""
    serialized: list[dict[str, Any]] = []
    for i, row in enumerate(ranked):
        geom = row.get("geometry")
        lat: float | None = None
        lng: float | None = None
        if isinstance(geom, dict):
            loc = geom.get("location")
            if isinstance(loc, dict):
                try:
                    lat = float(loc.get("lat"))
                    lng = float(loc.get("lng"))
                except (TypeError, ValueError):
                    pass
        types_raw = row.get("types")
        types_list: list[str] | None = None
        if isinstance(types_raw, list):
            types_list = [str(t) for t in types_raw if isinstance(t, str)]
        serialized.append(
            {
                "rank": i,
                "place_id": str(row.get("place_id") or ""),
                "name": str(row.get("name") or ""),
                "vicinity": row.get("vicinity"),
                "types": types_list,
                "lat": lat,
                "lng": lng,
            }
        )
    return serialized


def _parse_nearby_results(data: dict[str, Any]) -> tuple[str, str | None, list[dict[str, Any]]]:
    status = str(data.get("status") or "UNKNOWN")
    err = data.get("error_message")
    err_s = str(err) if isinstance(err, str) else None
    raw = data.get("results")
    if not isinstance(raw, list) or status not in ("OK", "ZERO_RESULTS"):
        return status, err_s, []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("place_id") or "").strip()
        if not pid:
            continue
        name = str(item.get("name") or "").strip() or "(sans nom)"
        vicinity = item.get("vicinity")
        vic_s = str(vicinity) if isinstance(vicinity, str) else None
        types_raw = item.get("types")
        types_list: list[str] | None = None
        if isinstance(types_raw, list):
            types_list = [str(t) for t in types_raw if isinstance(t, str)]
        geom_o = item.get("geometry")
        geometry: dict[str, Any] | None = None
        if isinstance(geom_o, dict):
            loc = geom_o.get("location")
            if isinstance(loc, dict):
                try:
                    la = float(loc.get("lat"))
                    ln = float(loc.get("lng"))
                    geometry = {"location": {"lat": la, "lng": ln}}
                except (TypeError, ValueError):
                    pass
        out.append(
            {
                "place_id": pid,
                "name": name,
                "vicinity": vic_s,
                "types": types_list,
                "geometry": geometry,
            }
        )
    return status, err_s, out


def _extract_code_postal(address: str) -> str | None:
    m = re.search(r"\b(\d{5})\b", address)
    return m.group(1) if m else None


def parse_address_search_context(name: str | None, address: str | None) -> dict[str, Any]:
    """Port TS lib/recherche-entreprises parseAddressSearchContext."""
    n = (name or "").strip() or None
    address_str = (address or "").strip()
    code_postal = _extract_code_postal(address_str) if address_str else None
    segments = [s.strip() for s in address_str.split(",") if s.strip()] if address_str else []
    segment_with_cp = next((s for s in segments if code_postal and code_postal in s), None)
    commune = None
    if segment_with_cp:
        commune = re.sub(r"\d{5}\s*", "", segment_with_cp).strip() or None
    cp_index = segments.index(segment_with_cp) if segment_with_cp in segments else -1
    street_segment = segments[cp_index - 1] if cp_index > 0 else None
    segment_with_zac = next((s for s in segments if re.search(r"zac\s", s, re.I)), None)
    zac_segment = None
    if segment_with_zac:
        zac_segment = re.sub(r"\bde\s+", " ", segment_with_zac, flags=re.I).strip()
    return {
        "name": n,
        "commune": commune,
        "codePostal": code_postal,
        "streetSegment": street_segment,
        "zacSegment": zac_segment,
    }


def build_prioritized_search_queries(ctx: dict[str, Any]) -> list[str]:
    name = ctx.get("name")
    commune = ctx.get("commune")
    code_postal = ctx.get("codePostal")
    street_segment = ctx.get("streetSegment")
    zac_segment = ctx.get("zacSegment")
    steps: list[str] = []
    if street_segment and commune and code_postal:
        steps.append(f'"{street_segment}" {commune} {code_postal}')
    if name and commune and code_postal:
        steps.append(f'"{name}" {commune} {code_postal}')
    if name and commune:
        steps.append(f'"{name}" {commune}')
    if zac_segment and commune:
        steps.append(f'"{zac_segment}" {commune}')
    return steps


def build_synthetic_ppm_from_google_anchor(formatted_address: str) -> dict[str, Any]:
    """Construit un bloc `info` compatible avec match_etablissements_for_parcel."""
    fa = formatted_address.strip()
    ctx = parse_address_search_context(None, fa)
    street = str(ctx.get("streetSegment") or "").strip()
    n_source = street if street else fa
    nset = street_number_match_set(n_source)
    voie_raw = ""
    if street:
        parts = street.split()
        if parts and re.match(r"^\d{1,5}$", parts[0]):
            parts = parts[1:]
            if parts and parts[0].lower() in ("bis", "ter", "quater"):
                parts = parts[1:]
        voie_raw = " ".join(parts).strip()
    addr_norm = normalize_address_parts(
        numero=fa,
        indice_repetition="",
        type_voie="",
        libelle_voie=fa,
        commune="",
        code_postal=fa,
    )
    voie_norm = normalize_text(voie_raw) if voie_raw else str(addr_norm.get("voie_norm") or "")
    commune_norm = normalize_text(str(ctx.get("commune") or "")) or str(addr_norm.get("commune_norm") or "")
    return {
        "passerelle_address": fa,
        "passerelle_indice_norm": "",
        "passerelle_voie_norm": voie_norm,
        "passerelle_commune_norm": commune_norm,
        "passerelle_numero_match_set": tuple(sorted(nset)) if nset else tuple(),
        "passerelle_addresses_json": "[]",
    }


def _fetch_nearby(
    *,
    api_key: str,
    lat: float,
    lng: float,
    radius_m: float,
    get_json: JsonGetFn,
) -> dict[str, Any]:
    qs = urllib.parse.urlencode(
        {
            "location": f"{lat},{lng}",
            "radius": str(int(max(1.0, min(500.0, radius_m)))),
            "key": api_key,
        }
    )
    url = f"https://maps.googleapis.com/maps/api/place/nearbysearch/json?{qs}"
    return get_json(url, 30.0)


def _fetch_place_details(*, api_key: str, place_id: str, get_json: JsonGetFn) -> dict[str, Any]:
    qs = urllib.parse.urlencode(
        {
            "place_id": place_id,
            "fields": "place_id,name,formatted_address,types",
            "key": api_key,
        }
    )
    url = f"https://maps.googleapis.com/maps/api/place/details/json?{qs}"
    return get_json(url, 30.0)


def _fetch_api_gouv_search(q: str, get_json: JsonGetFn) -> tuple[bool, int, str, list[dict[str, Any]]]:
    qs = urllib.parse.urlencode({"q": q, "per_page": "20"})
    url = f"https://recherche-entreprises.api.gouv.fr/search?{qs}"
    try:
        data = get_json(url, 45.0)
    except urllib.error.HTTPError as e:
        return False, int(e.code), str(e), []
    except Exception as e:
        return False, 0, str(e), []
    if not isinstance(data, dict):
        return False, 0, "réponse invalide", []
    results = data.get("results")
    if not isinstance(results, list):
        results = []
    return True, 200, "", [r for r in results if isinstance(r, dict)]


def _parse_coord(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def flatten_api_results_etablissements(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Équivalent minimal de flattenApiResultsToCandidates (siège + matching_etablissements)."""
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for company in results:
        etat = company.get("etat_administratif")
        if etat is not None and str(etat).strip() and str(etat).strip().upper() != "A":
            continue
        nom = str(company.get("nom_complet") or "")
        siren = str(company.get("siren") or "")
        siege = company.get("siege")
        if isinstance(siege, dict):
            siret = str(siege.get("siret") or "").strip()
            if siret and siret not in seen:
                seen.add(siret)
                adr = str(siege.get("geo_adresse") or siege.get("adresse") or "")
                cp = str(siege.get("code_postal") or "")
                candidates.append(
                    {
                        "siren": siren,
                        "siret": siret,
                        "nom_complet": nom,
                        "adresse": adr,
                        "code_postal": cp,
                    }
                )
        for etab in company.get("matching_etablissements") or []:
            if not isinstance(etab, dict):
                continue
            siret = str(etab.get("siret") or "").strip()
            if not siret or siret in seen:
                continue
            seen.add(siret)
            adr = str(etab.get("geo_adresse") or etab.get("adresse") or "")
            cp = str(etab.get("code_postal") or "")
            candidates.append(
                {
                    "siren": siren,
                    "siret": siret,
                    "nom_complet": nom,
                    "adresse": adr,
                    "code_postal": cp,
                }
            )
    return candidates


def empty_google_audit() -> dict[str, Any]:
    return {
        "google_fallback_attempted": "false",
        "google_fallback_success": "false",
        "google_fallback_group_id": "",
        "google_nearby_status": "",
        "google_nearby_error": "",
        "google_raw_nearby_count": "0",
        "google_excluded_outside_parcel": "0",
        "google_nearby_ranked_json": "[]",
        "google_winner_place_id": "",
        "google_winner_name": "",
        "google_anchor_address": "",
        "google_api_gouv_query": "",
        "google_api_gouv_etablissements_count": "0",
        "google_reject_reason": "",
    }


def run_google_poi_fallback_for_parcel(
    *,
    parcel_geom_geojson: str,
    centroid_lat: float,
    centroid_lng: float,
    api_key: str,
    radius_m: float = 100.0,
    get_json: JsonGetFn | None = None,
) -> dict[str, Any]:
    """
    Exécute Nearby → Details → api.gouv (filtré CP).
    Retourne un dict avec formatted_address, api_etablissements_at_cp, counters, trace (audit interne).
    """
    fn = get_json or default_json_get
    counters = {"nearby_calls": 0, "details_calls": 0, "api_gouv_calls": 0}
    trace: dict[str, Any] = {
        "nearby_status": "",
        "nearby_error": "",
        "raw_nearby_count": 0,
        "excluded_outside_parcel": 0,
        "nearby_ranked_json": "[]",
        "winner_place_id": "",
        "winner_name": "",
        "details_status": "",
        "api_gouv_query": "",
        "api_gouv_ok": False,
        "api_gouv_http_status": 0,
        "api_gouv_error": "",
        "reject_reason": "",
    }
    out: dict[str, Any] = {
        "formatted_address": None,
        "anchor_address": None,
        "api_etablissements_at_cp": [],
        "counters": counters,
        "trace": trace,
    }

    parcel_shp = _parcel_shape_from_geojson(parcel_geom_geojson)

    counters["nearby_calls"] += 1
    nearby_raw = _fetch_nearby(api_key=api_key, lat=centroid_lat, lng=centroid_lng, radius_m=radius_m, get_json=fn)
    st, err, parsed = _parse_nearby_results(nearby_raw)
    trace["nearby_status"] = st
    trace["nearby_error"] = err or ""
    trace["raw_nearby_count"] = len(parsed)
    if st not in ("OK", "ZERO_RESULTS"):
        trace["reject_reason"] = "nearby_not_ok"
        return out

    ranked, excluded = _rank_nearby_for_parcel(centroid_lat, centroid_lng, parsed, parcel_shp)
    trace["excluded_outside_parcel"] = excluded
    trace["nearby_ranked_json"] = json.dumps(_serialize_ranked_nearby(ranked), ensure_ascii=False)
    if not ranked:
        trace["reject_reason"] = "no_poi_in_parcel" if excluded > 0 else "no_poi_ranked"
        return out

    winner = ranked[0]
    pid = str(winner.get("place_id") or "")
    trace["winner_place_id"] = pid
    trace["winner_name"] = str(winner.get("name") or "")

    counters["details_calls"] += 1
    det = _fetch_place_details(api_key=api_key, place_id=pid, get_json=fn)
    trace["details_status"] = str(det.get("status") or "")
    if str(det.get("status") or "") != "OK":
        trace["reject_reason"] = "place_details_not_ok"
        return out

    result = det.get("result")
    formatted = None
    if isinstance(result, dict):
        fa = result.get("formatted_address")
        if isinstance(fa, str):
            formatted = fa.strip() or None
    vicinity = str(winner.get("vicinity") or "").strip() or None
    anchor = formatted or vicinity
    out["formatted_address"] = formatted
    out["anchor_address"] = anchor
    if not anchor:
        trace["reject_reason"] = "no_anchor_address"
        return out

    ctx = parse_address_search_context(None, anchor)
    cp = ctx.get("codePostal")
    if not cp:
        trace["reject_reason"] = "no_code_postal_in_anchor"
        return out

    queries = build_prioritized_search_queries(ctx)
    query = queries[0] if queries else ""
    if not query:
        tail = " ".join(
            str(x)
            for x in (ctx.get("streetSegment"), ctx.get("commune"), ctx.get("codePostal"))
            if x
        )
        query = tail
    trace["api_gouv_query"] = query
    if not query:
        trace["reject_reason"] = "no_api_gouv_query"
        return out

    counters["api_gouv_calls"] += 1
    ok, status, msg, api_results = _fetch_api_gouv_search(query, fn)
    trace["api_gouv_ok"] = ok
    trace["api_gouv_http_status"] = status
    if not ok:
        trace["api_gouv_error"] = msg
        trace["reject_reason"] = "api_gouv_error"
        return out

    flat = flatten_api_results_etablissements(api_results)
    cp_trim = str(cp).strip()
    at_cp = [e for e in flat if (e.get("code_postal") or "").strip() == cp_trim]
    out["api_etablissements_at_cp"] = at_cp
    return out
