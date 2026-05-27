"""
Résolution conservative d'adresse d'affichage (matching V5).
Voir docs/plans/2026-05-18-matching-v5-address-resolver-design.md
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from rapidfuzz import fuzz
from shapely.geometry import LineString, MultiPolygon, Polygon, shape
from shapely.ops import transform

from scout_pipeline.address_normalization import (
    normalize_address_parts,
    normalize_text,
    street_number_match_set,
)

from geoplateforme_geocode import GeoplateformeAddressHit, GeoplateformeGeocoder
from import_osm_buildings import _format_osm_address

_PRO_LANDUSE_TAGS = frozenset({"commercial", "industrial", "retail"})
_ACCEPTED_BAN_TYPES = frozenset({"housenumber", "street"})
# Échantillonnage du contour parcelle pour BAN (au lieu du seul centroïde bâtiment/parcelle).
PARCEL_SHAPE_STEP_FRACTION = 0.01
PARCEL_SHAPE_INSET_FRACTION = 0.01
_MAX_PARCEL_BAN_QUERY_POINTS = 64
_EMPTY_DISPLAY: dict[str, str] = {
    "display_address": "",
    "display_address_source": "none",
    "display_address_confidence": "none",
    "display_address_meta_json": "{}",
}


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def is_pro_zone(zone_source: str | None, zone_tag: str | None) -> bool:
    if str(zone_source or "").strip().lower() != "landuse":
        return False
    return str(zone_tag or "").strip().lower() in _PRO_LANDUSE_TAGS


def _shape_from_geojson(geom_geojson: str | dict[str, Any] | None):
    if geom_geojson is None:
        return None
    try:
        if isinstance(geom_geojson, str):
            if not geom_geojson.strip():
                return None
            geom = shape(json.loads(geom_geojson))
        else:
            geom = shape(geom_geojson)
        if geom.is_empty:
            return None
        return geom
    except Exception:
        return None


def centroid_from_geojson(geom_geojson: str | dict[str, Any] | None) -> tuple[float, float] | None:
    geom = _shape_from_geojson(geom_geojson)
    if geom is None:
        return None
    try:
        c = geom.centroid
        return float(c.y), float(c.x)
    except Exception:
        return None


def _to_2154(geom: Any) -> Any:
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    return transform(transformer.transform, geom)


def _to_4326(geom: Any) -> Any:
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    return transform(transformer.transform, geom)


def _largest_polygon(geom: Any) -> Polygon | None:
    if isinstance(geom, Polygon):
        return geom if not geom.is_empty else None
    if isinstance(geom, MultiPolygon):
        polys = [p for p in geom.geoms if isinstance(p, Polygon) and not p.is_empty]
        if not polys:
            return None
        return max(polys, key=lambda p: p.area)
    return None


def parcel_ban_query_points(
    geom_geojson: str | dict[str, Any] | None,
    *,
    step_fraction: float = PARCEL_SHAPE_STEP_FRACTION,
    inset_fraction: float = PARCEL_SHAPE_INSET_FRACTION,
    max_points: int = _MAX_PARCEL_BAN_QUERY_POINTS,
) -> list[tuple[float, float]]:
    """
    Points (lat, lon) le long du contour parcelle pour le géocodage inverse BAN.

    - Pas d'échantillon : ~1 % du périmètre (min. 2 m en Lambert-93).
    - Retrait intérieur : ~1 % de sqrt(surface) pour rester dans la parcelle.
    """
    geom = _shape_from_geojson(geom_geojson)
    if geom is None:
        return []
    try:
        g2154 = _to_2154(geom)
        poly = _largest_polygon(g2154)
        if poly is None:
            return []
        area_m2 = float(poly.area)
        if area_m2 <= 0:
            return []
        scale_m = math.sqrt(area_m2)
        inset_m = max(0.5, float(inset_fraction) * scale_m)
        inner = poly.buffer(-inset_m)
        if inner.is_empty:
            inner = poly
        elif isinstance(inner, MultiPolygon):
            lp = _largest_polygon(inner)
            inner = lp if lp is not None else poly
        elif not isinstance(inner, Polygon):
            inner = poly
        line = LineString(inner.exterior.coords)
        perimeter_m = float(line.length)
        if perimeter_m <= 0:
            c = inner.centroid
            pt4326 = _to_4326(c)
            return [(float(pt4326.y), float(pt4326.x))]
        step_m = max(2.0, float(step_fraction) * perimeter_m)
        n_steps = min(max_points, max(4, int(perimeter_m / step_m) + 1))
        distances = [perimeter_m * i / n_steps for i in range(n_steps)]
        seen: set[tuple[float, float]] = set()
        out: list[tuple[float, float]] = []
        for dist in distances:
            pt = line.interpolate(dist % perimeter_m)
            pt4326 = _to_4326(pt)
            key = (round(float(pt4326.y), 5), round(float(pt4326.x), 5))
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
        return out
    except Exception:
        lat_lon = centroid_from_geojson(geom_geojson)
        return [lat_lon] if lat_lon else []


def osm_structured_address_label(osm_raw_tags: dict[str, Any] | None, osm_address_text: str | None) -> str | None:
    tags = {str(k): str(v).strip() for k, v in (osm_raw_tags or {}).items() if str(v).strip()}
    if tags.get("addr:full"):
        return str(tags["addr:full"]).strip()
    street = (tags.get("addr:street") or tags.get("addr:place") or "").strip()
    hn = (tags.get("addr:housenumber") or "").strip()
    if street and hn:
        return _format_osm_address(tags)
    return None


def _ban_thresholds(*, is_pro: bool, parcel_fallback: bool) -> tuple[float, float]:
    score_min = 0.88 if is_pro else 0.85
    dist_max = 20.0 if is_pro else 25.0
    if parcel_fallback:
        score_min += 0.02
        dist_max += 5.0
    return score_min, dist_max


def _accept_ban_reverse(
    hit: GeoplateformeAddressHit,
    *,
    query_lat: float,
    query_lon: float,
    code_insee: str,
    is_pro: bool,
    parcel_fallback: bool,
) -> tuple[bool, dict[str, Any]]:
    meta: dict[str, Any] = {
        "ban_score": hit.score,
        "ban_type": hit.result_type,
        "ban_label": hit.label,
    }
    if hit.result_type not in _ACCEPTED_BAN_TYPES:
        meta["reject_reason"] = "ban_type_not_address"
        return False, meta
    expected_insee = str(code_insee or "").strip()
    if expected_insee and hit.citycode and hit.citycode != expected_insee:
        meta["reject_reason"] = "ban_citycode_mismatch"
        return False, meta
    score_min, dist_max = _ban_thresholds(is_pro=is_pro, parcel_fallback=parcel_fallback)
    dist_m = hit.distance_m
    if dist_m is None:
        dist_m = haversine_meters(query_lat, query_lon, hit.lat, hit.lon)
    meta["distance_m"] = dist_m
    if hit.score < score_min:
        meta["reject_reason"] = "ban_score_below_threshold"
        return False, meta
    if dist_m > dist_max:
        meta["reject_reason"] = "ban_distance_above_threshold"
        return False, meta
    meta["corroboration"] = "ban_reverse_accepted"
    return True, meta


def _voie_compatible(voie_a: str, voie_b: str) -> bool:
    a = normalize_text(voie_a)
    b = normalize_text(voie_b)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    return float(fuzz.WRatio(a, b)) >= 90.0


def corroborate_ppm_with_ban(
    ppm_info: dict[str, Any],
    ban_hit: GeoplateformeAddressHit,
    *,
    query_lat: float,
    query_lon: float,
    code_insee: str,
) -> tuple[bool, dict[str, Any]]:
    meta: dict[str, Any] = {"step": "ppm_corroboration"}
    passerelle = str(ppm_info.get("passerelle_address") or "").strip()
    if not passerelle:
        meta["reject_reason"] = "no_passerelle"
        return False, meta
    nums = ppm_info.get("passerelle_numero_match_set") or ()
    if isinstance(nums, (list, tuple)):
        nums_set = frozenset(str(x) for x in nums if str(x).strip())
    else:
        nums_set = street_number_match_set(str(ppm_info.get("passerelle_numero_norm") or ""))
    if not nums_set:
        meta["reject_reason"] = "no_passerelle_numero"
        return False, meta
    expected_insee = str(code_insee or "").strip()
    if expected_insee and ban_hit.citycode and ban_hit.citycode != expected_insee:
        meta["reject_reason"] = "ban_citycode_mismatch"
        return False, meta
    voie_ppm = str(ppm_info.get("passerelle_voie_norm") or "").strip()
    voie_ban = normalize_text(ban_hit.street or ban_hit.label)
    if not _voie_compatible(voie_ppm, voie_ban):
        meta["reject_reason"] = "voie_mismatch"
        return False, meta
    ban_num = normalize_text(ban_hit.housenumber)
    ban_nums = street_number_match_set(ban_num) if ban_num else frozenset()
    dist_m = ban_hit.distance_m
    if dist_m is None:
        dist_m = haversine_meters(query_lat, query_lon, ban_hit.lat, ban_hit.lon)
    meta["distance_m"] = dist_m
    if ban_nums:
        if not (nums_set & ban_nums):
            meta["reject_reason"] = "numero_mismatch"
            return False, meta
    elif dist_m > 80.0:
        meta["reject_reason"] = "ban_no_numero_too_far"
        return False, meta
    meta["corroboration"] = "ppm_ban_ok"
    return True, meta


def _confirmed_result(
    address: str,
    source: str,
    meta: dict[str, Any],
) -> dict[str, str]:
    return {
        "display_address": address.strip(),
        "display_address_source": source,
        "display_address_confidence": "confirmed",
        "display_address_meta_json": json.dumps(meta, ensure_ascii=False),
    }


def _best_sirene_address(etab_match: dict[str, Any]) -> str | None:
    if str(etab_match.get("status_technique") or "").strip() != "matched":
        return None
    raw = etab_match.get("sirets_json") or "[]"
    try:
        rows = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return None
    if not isinstance(rows, list):
        return None
    best_score = -1.0
    best_addr = ""
    for row in rows:
        if not isinstance(row, dict):
            continue
        addr = str(row.get("adresse_etablissement") or "").strip()
        if not addr:
            continue
        score = float(row.get("score") or 0.0)
        if score >= best_score:
            best_score = score
            best_addr = addr
    return best_addr or None


@dataclass
class DisplayAddressResolver:
    geocoder: GeoplateformeGeocoder
    enabled: bool = True
    _reverse_cache: dict[tuple[float, float], GeoplateformeAddressHit | None] | None = None

    def __post_init__(self) -> None:
        if self._reverse_cache is None:
            object.__setattr__(self, "_reverse_cache", {})

    def reverse_cached(self, lon: float, lat: float) -> GeoplateformeAddressHit | None:
        key = (round(lon, 5), round(lat, 5))
        if key in self._reverse_cache:
            return self._reverse_cache[key]
        hit = None
        if self.enabled:
            hit = self.geocoder.reverse(lon, lat)
        self._reverse_cache[key] = hit
        return hit

    def reverse_best_for_parcel_shape(
        self,
        parcel_geom_geojson: str | dict[str, Any] | None,
        *,
        code_insee: str,
        is_pro: bool,
        parcel_fallback: bool,
        fallback_lat: float | None = None,
        fallback_lon: float | None = None,
        require_housenumber: bool = False,
    ) -> tuple[GeoplateformeAddressHit | None, float | None, float | None]:
        """
        Essaie le géocodage inverse sur le contour parcelle (1 % / 1 %).
        Retourne le meilleur hit accepté (distance BAN minimale) et le point de requête utilisé.
        """
        points = parcel_ban_query_points(parcel_geom_geojson)
        if not points and fallback_lat is not None and fallback_lon is not None:
            points = [(fallback_lat, fallback_lon)]
        best_hit: GeoplateformeAddressHit | None = None
        best_lat: float | None = None
        best_lon: float | None = None
        best_dist = float("inf")
        for lat, lon in points:
            hit = self.reverse_cached(lon, lat)
            if hit is None:
                continue
            if require_housenumber and not normalize_text(hit.housenumber):
                continue
            ok, meta = _accept_ban_reverse(
                hit,
                query_lat=lat,
                query_lon=lon,
                code_insee=code_insee,
                is_pro=is_pro,
                parcel_fallback=parcel_fallback,
            )
            if not ok:
                continue
            dist_m = float(meta.get("distance_m") or float("inf"))
            if dist_m < best_dist:
                best_dist = dist_m
                best_hit = hit
                best_lat = lat
                best_lon = lon
        return best_hit, best_lat, best_lon

    def resolve_for_building(
        self,
        *,
        code_insee: str,
        osm_raw_tags: dict[str, Any] | None,
        osm_address_text: str | None,
        zone_source: str | None,
        zone_tag: str | None,
        ppm_info: dict[str, Any],
        etab_match: dict[str, Any],
        centroid_lat: float | None,
        centroid_lon: float | None,
        parcel_geom_geojson: str | dict[str, Any] | None = None,
        parcel_fallback: bool = False,
    ) -> dict[str, str]:
        if not self.enabled:
            return dict(_EMPTY_DISPLAY)

        is_pro = is_pro_zone(zone_source, zone_tag)

        osm_label = osm_structured_address_label(osm_raw_tags, osm_address_text)
        if osm_label:
            return _confirmed_result(
                osm_label,
                "osm",
                {"step": 1, "source": "osm_structured_tags"},
            )

        query_lat = centroid_lat
        query_lon = centroid_lon
        ban_hit: GeoplateformeAddressHit | None = None
        ban_query_mode = "centroid"

        if parcel_geom_geojson:
            ban_hit, query_lat, query_lon = self.reverse_best_for_parcel_shape(
                parcel_geom_geojson,
                code_insee=code_insee,
                is_pro=is_pro,
                parcel_fallback=parcel_fallback,
                fallback_lat=centroid_lat,
                fallback_lon=centroid_lon,
            )
            if ban_hit is not None:
                ban_query_mode = "parcel_shape"
        elif query_lat is not None and query_lon is not None:
            ban_hit = self.reverse_cached(query_lon, query_lat)
        else:
            return dict(_EMPTY_DISPLAY)

        if query_lat is None or query_lon is None:
            return dict(_EMPTY_DISPLAY)

        passerelle = str(ppm_info.get("passerelle_address") or "").strip()
        if passerelle and ban_hit is not None:
            ok, ppm_meta = corroborate_ppm_with_ban(
                ppm_info,
                ban_hit,
                query_lat=query_lat,
                query_lon=query_lon,
                code_insee=code_insee,
            )
            if ok:
                return _confirmed_result(
                    passerelle,
                    "ppm",
                    {"step": 2, "ban_query_mode": ban_query_mode, **ppm_meta},
                )

        # Adresse qui a servi au matching SIRENE (passerelle) — pas le libellé BAN reverse ni
        # adresse_etablissement géocodée (ancienne étape 4).
        if passerelle and str(etab_match.get("status_technique") or "").strip() == "matched":
            return _confirmed_result(
                passerelle,
                "ppm",
                {
                    "step": "2b",
                    "corroboration": "sirene_matched_passerelle",
                    "matching_reason": str(etab_match.get("matching_reason") or "").strip() or None,
                },
            )

        if ban_hit is not None:
            ok, ban_meta = _accept_ban_reverse(
                ban_hit,
                query_lat=query_lat,
                query_lon=query_lon,
                code_insee=code_insee,
                is_pro=is_pro,
                parcel_fallback=parcel_fallback,
            )
            if ok:
                return _confirmed_result(
                    ban_hit.label,
                    "ban_reverse",
                    {"step": 3, "ban_query_mode": ban_query_mode, **ban_meta},
                )

        return dict(_EMPTY_DISPLAY)


def enrich_building_detail_with_display(
    item: dict[str, Any],
    *,
    payload: dict[str, Any],
    ppm_info: dict[str, Any],
    etab_match: dict[str, Any],
    code_insee: str,
    resolver: DisplayAddressResolver,
    parcel_geom_geojson: str | dict[str, Any] | None = None,
) -> dict[str, Any]:
    geom = payload.get("geometry") or ""
    lat_lon = centroid_from_geojson(str(geom) if geom else None)
    lat, lon = lat_lon if lat_lon else (None, None)
    raw_tags = item.get("osm_raw_tags")
    if not isinstance(raw_tags, dict):
        raw_tags = payload.get("raw_tags") if isinstance(payload.get("raw_tags"), dict) else {}
    display = resolver.resolve_for_building(
        code_insee=code_insee,
        osm_raw_tags=raw_tags,
        osm_address_text=str(item.get("osm_address_text") or payload.get("address_text") or ""),
        zone_source=str(item.get("zone_source") or ""),
        zone_tag=str(item.get("zone_tag") or ""),
        ppm_info=ppm_info,
        etab_match=etab_match,
        centroid_lat=lat,
        centroid_lon=lon,
        parcel_geom_geojson=parcel_geom_geojson,
    )
    out = dict(item)
    out.update(display)
    return out


def ppm_needs_passerelle_fallback_for_etab(info: dict[str, Any]) -> bool:
    """PPM absente ou sans numéro de voirie exploitable pour le matching SIRENE."""
    if not str(info.get("passerelle_address") or "").strip():
        return True
    nums = info.get("passerelle_numero_match_set")
    if isinstance(nums, (tuple, list)) and any(str(x).strip() for x in nums):
        return False
    if str(info.get("passerelle_numero_norm") or "").strip():
        return False
    return True


def accept_geoplateforme_for_etab_passerelle(
    hit: GeoplateformeAddressHit,
    *,
    query_lat: float,
    query_lon: float,
    code_insee: str,
    is_pro: bool,
) -> tuple[bool, dict[str, Any]]:
    """Géocodage inverse acceptable comme passerelle SIRENE (numéro obligatoire)."""
    if not normalize_text(hit.housenumber):
        return False, {"reject_reason": "ban_no_housenumber"}
    return _accept_ban_reverse(
        hit,
        query_lat=query_lat,
        query_lon=query_lon,
        code_insee=code_insee,
        is_pro=is_pro,
        parcel_fallback=False,
    )


def build_synthetic_ppm_from_geoplateforme_hit(hit: GeoplateformeAddressHit) -> dict[str, Any]:
    """Bloc `info` PPM compatible avec match_etablissements_for_parcel."""
    label = hit.label.strip()
    nset = street_number_match_set(hit.housenumber)
    addr_norm = normalize_address_parts(
        numero=hit.housenumber,
        indice_repetition="",
        type_voie="",
        libelle_voie=hit.street or label,
        commune=hit.city,
        code_postal=hit.postcode,
    )
    return {
        "passerelle_address": label,
        "passerelle_address_norm": addr_norm.get("address_norm") or None,
        "passerelle_voie_norm": addr_norm.get("voie_norm") or None,
        "passerelle_commune_norm": addr_norm.get("commune_norm") or None,
        "passerelle_numero_norm": addr_norm.get("numero_norm") or None,
        "passerelle_indice_norm": None,
        "passerelle_numero_match_set": tuple(sorted(nset)) if nset else tuple(),
        "passerelle_addresses_json": "[]",
    }


def _parcel_is_pro_zone(
    pk: tuple[str, str, str],
    *,
    by_parcel: dict[tuple[str, str, str], set[str]],
    by_building: dict[str, list[dict[str, Any]]],
) -> bool:
    for bid in by_parcel.get(pk) or ():
        for entry in by_building.get(bid, []):
            if (str(entry.get("code_insee")), str(entry.get("section")), str(entry.get("numero_norm"))) != pk:
                continue
            if is_pro_zone(entry.get("zone_source"), entry.get("zone_tag")):
                return True
    return False


def _parcel_query_centroid(
    pk: tuple[str, str, str],
    *,
    by_parcel: dict[tuple[str, str, str], set[str]],
    by_building: dict[str, list[dict[str, Any]]],
    payload_by_bat: dict[str, dict[str, Any]],
    parcel_geom: dict[tuple[str, str, str], str],
) -> tuple[float, float, bool] | None:
    """(lat, lon, is_pro_zone) — centroïde bâtiment le plus grand, sinon parcelle (repli uniquement)."""
    is_pro = False
    best_fp = -1.0
    best_lat_lon: tuple[float, float] | None = None
    for bid in by_parcel.get(pk) or ():
        for entry in by_building.get(bid, []):
            if (str(entry.get("code_insee")), str(entry.get("section")), str(entry.get("numero_norm"))) != pk:
                continue
            if is_pro_zone(entry.get("zone_source"), entry.get("zone_tag")):
                is_pro = True
            fp = entry.get("footprint_m2")
            try:
                fpv = float(fp) if fp is not None else -1.0
            except (TypeError, ValueError):
                fpv = -1.0
            payload = payload_by_bat.get(bid) or {}
            lat_lon = centroid_from_geojson(str(payload.get("geometry") or ""))
            if lat_lon and fpv > best_fp:
                best_fp = fpv
                best_lat_lon = lat_lon
    if best_lat_lon:
        return best_lat_lon[0], best_lat_lon[1], is_pro
    lat_lon = centroid_from_geojson(parcel_geom.get(pk))
    if lat_lon:
        return lat_lon[0], lat_lon[1], is_pro
    return None


def augment_ppm_passerelle_for_etab(
    ppm: dict[tuple[str, str, str], dict[str, Any]],
    by_parcel: dict[tuple[str, str, str], set[str]],
    by_building: dict[str, list[dict[str, Any]]],
    *,
    code_insee: str,
    parcel_geom: dict[tuple[str, str, str], str],
    payload_by_bat: dict[str, dict[str, Any]],
    geocoder: GeoplateformeGeocoder | None,
    build_synthetic_from_text: Callable[[str], dict[str, Any]],
    log: Callable[[str], None],
) -> tuple[int, int]:
    """
    PPM sans numéro (ou sans adresse) : OSM footprint puis géocodage inverse pour la passerelle SIRENE.
    Retourne (nb_osm, nb_ban).
    """
    osm_added = 0
    ban_added = 0
    reverse_cache: dict[tuple[float, float], GeoplateformeAddressHit | None] = {}

    for pk in sorted(by_parcel.keys()):
        info = ppm.get(pk) or {}
        if not ppm_needs_passerelle_fallback_for_etab(info):
            continue

        merged = False
        for bid in by_parcel.get(pk) or ():
            for entry in by_building.get(bid, []):
                if (
                    str(entry.get("code_insee") or ""),
                    str(entry.get("section") or ""),
                    str(entry.get("numero_norm") or ""),
                ) != pk:
                    continue
                addr = str(entry.get("osm_address_text") or "").strip()
                if not addr:
                    continue
                syn = build_synthetic_from_text(addr)
                if not syn.get("passerelle_numero_match_set"):
                    continue
                base: dict[str, Any] = dict(info)
                base.update(syn)
                base.setdefault("sirens", list(info.get("sirens") or []))
                base.setdefault("passerelle_addresses", list(info.get("passerelle_addresses") or []))
                base.setdefault("siren_rows", dict(info.get("siren_rows") or {}))
                ppm[pk] = base
                info = base
                osm_added += 1
                merged = True
                break
            if merged:
                break

        if not ppm_needs_passerelle_fallback_for_etab(info):
            continue
        if geocoder is None:
            continue

        is_pro = _parcel_is_pro_zone(
            pk,
            by_parcel=by_parcel,
            by_building=by_building,
        )
        parcel_gj = parcel_geom.get(pk)
        fallback = _parcel_query_centroid(
            pk,
            by_parcel=by_parcel,
            by_building=by_building,
            payload_by_bat=payload_by_bat,
            parcel_geom=parcel_geom,
        )
        fallback_lat = fallback[0] if fallback else None
        fallback_lon = fallback[1] if fallback else None
        resolver = DisplayAddressResolver(geocoder=geocoder, enabled=True, _reverse_cache=reverse_cache)
        hit, lat, lon = resolver.reverse_best_for_parcel_shape(
            parcel_gj,
            code_insee=code_insee,
            is_pro=is_pro,
            parcel_fallback=False,
            fallback_lat=fallback_lat,
            fallback_lon=fallback_lon,
            require_housenumber=True,
        )
        if hit is None or lat is None or lon is None:
            continue
        syn = build_synthetic_ppm_from_geoplateforme_hit(hit)
        base = dict(info)
        base.update(syn)
        base.setdefault("sirens", list(info.get("sirens") or []))
        base.setdefault("passerelle_addresses", list(info.get("passerelle_addresses") or []))
        base.setdefault("siren_rows", dict(info.get("siren_rows") or {}))
        ppm[pk] = base
        ban_added += 1

    if osm_added:
        log(f"[v5] Passerelle synthétique (OSM) pour {osm_added} parcelle(s) sans numéro PPM / sans adresse.")
    if ban_added:
        log(
            f"[v5] Passerelle synthétique (géocodage inverse) pour {ban_added} parcelle(s) "
            "sans numéro PPM exploitable."
        )
    return osm_added, ban_added


def pick_parcel_display_from_buildings(bdetails: list[dict[str, Any]]) -> dict[str, str]:
    confirmed = [
        b
        for b in bdetails
        if str(b.get("display_address_confidence") or "") == "confirmed"
        and str(b.get("display_address") or "").strip()
    ]
    if not confirmed:
        return dict(_EMPTY_DISPLAY)
    best = max(confirmed, key=lambda x: float(x.get("footprint_m2") or 0.0))
    return {
        "display_address": str(best.get("display_address") or "").strip(),
        "display_address_source": str(best.get("display_address_source") or "none"),
        "display_address_confidence": "confirmed",
        "display_address_meta_json": str(best.get("display_address_meta_json") or "{}"),
    }


def resolve_parcel_centroid_fallback(
    resolver: DisplayAddressResolver,
    *,
    code_insee: str,
    parcel_geom_geojson: str | None,
    ppm_info: dict[str, Any],
    etab_match: dict[str, Any],
    zone_source: str | None,
    zone_tag: str | None,
) -> dict[str, str]:
    lat_lon = centroid_from_geojson(parcel_geom_geojson)
    lat, lon = lat_lon if lat_lon else (None, None)
    return resolver.resolve_for_building(
        code_insee=code_insee,
        osm_raw_tags=None,
        osm_address_text=None,
        zone_source=zone_source,
        zone_tag=zone_tag,
        ppm_info=ppm_info,
        etab_match=etab_match,
        centroid_lat=lat,
        centroid_lon=lon,
        parcel_geom_geojson=parcel_geom_geojson,
        parcel_fallback=True,
    )
