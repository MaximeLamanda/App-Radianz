from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_MATCHING_V5 = _REPO / "data-pipeline" / "matching_v5"
_PYTHON = _REPO / "data-pipeline" / "python"
if str(_PYTHON) not in sys.path:
    sys.path.insert(0, str(_PYTHON))
if str(_MATCHING_V5) not in sys.path:
    sys.path.insert(0, str(_MATCHING_V5))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_load("geoplateforme_geocode", _MATCHING_V5 / "geoplateforme_geocode.py")
_geoplateforme = sys.modules["geoplateforme_geocode"]
GeoplateformeAddressHit = _geoplateforme.GeoplateformeAddressHit
GeoplateformeGeocoder = _geoplateforme.GeoplateformeGeocoder
_resolver = _load("address_resolver_v5", _MATCHING_V5 / "address_resolver_v5.py")


def _hit(**kwargs) -> GeoplateformeAddressHit:
    defaults = dict(
        label="10 Rue Foch 33600 Pessac",
        score=0.95,
        distance_m=10.0,
        citycode="33318",
        result_type="housenumber",
        lon=-0.63,
        lat=44.8,
        street="Rue Foch",
        housenumber="10",
        postcode="33600",
        city="Pessac",
    )
    defaults.update(kwargs)
    return GeoplateformeAddressHit(**defaults)


def test_osm_structured_requires_housenumber_and_street():
    label = _resolver.osm_structured_address_label(
        {"addr:street": "Rue Foch", "addr:housenumber": "12", "addr:postcode": "33600", "addr:city": "Pessac"},
        "",
    )
    assert label
    assert "12" in label
    assert _resolver.osm_structured_address_label({"addr:street": "Rue Foch"}, "") is None
    assert _resolver.osm_structured_address_label({"addr:full": "Entrepôt ZI Nord"}, "") == "Entrepôt ZI Nord"


def test_resolve_osm_step_without_network():
    geo = GeoplateformeGeocoder(json_get=lambda u, t: {"features": []})
    resolver = _resolver.DisplayAddressResolver(geocoder=geo, enabled=True)
    out = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={"addr:street": "Rue A", "addr:housenumber": "1", "addr:city": "Pessac"},
        osm_address_text="",
        zone_source="landuse",
        zone_tag="industrial",
        ppm_info={},
        etab_match={},
        centroid_lat=44.8,
        centroid_lon=-0.63,
    )
    assert out["display_address_confidence"] == "confirmed"
    assert out["display_address_source"] == "osm"


def test_ppm_rejected_without_corroboration():
    calls = {"n": 0}

    def fake_get(url: str, timeout_s: float) -> dict:
        calls["n"] += 1
        return {
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-0.63, 44.8]},
                        "properties": {
                            "type": "housenumber",
                            "label": "99 Autre Rue 33600 Pessac",
                            "score": 0.5,
                            "distance": 5,
                        "citycode": "33318",
                        "street": "Autre Rue",
                        "housenumber": "99",
                        "postcode": "33600",
                        "city": "Pessac",
                    },
                }
            ]
        }

    geo = GeoplateformeGeocoder(json_get=fake_get, min_interval_s=0)
    resolver = _resolver.DisplayAddressResolver(geocoder=geo, enabled=True)
    ppm = {
        "passerelle_address": "10 Rue Foch, Pessac",
        "passerelle_voie_norm": "FOCH",
        "passerelle_numero_match_set": ("10",),
        "passerelle_numero_norm": "10",
    }
    out = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="",
        zone_tag="",
        ppm_info=ppm,
        etab_match={},
        centroid_lat=44.8,
        centroid_lon=-0.63,
    )
    assert out["display_address_confidence"] == "none"
    assert calls["n"] >= 1


def test_ppm_accepted_when_corroborated():
    ban = _hit(label="10 Rue Foch 33600 Pessac", street="Rue Foch", housenumber="10")

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return ban

        def search(self, query: str, *, limit: int = 1):
            return None

    resolver = _resolver.DisplayAddressResolver(geocoder=FakeGeo(), enabled=True)
    ppm = {
        "passerelle_address": "10 Rue Foch, Pessac",
        "passerelle_voie_norm": "FOCH",
        "passerelle_numero_match_set": ("10",),
    }
    out = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="landuse",
        zone_tag="industrial",
        ppm_info=ppm,
        etab_match={},
        centroid_lat=44.8,
        centroid_lon=-0.63,
    )
    assert out["display_address_source"] == "ppm"
    assert "10 Rue Foch" in out["display_address"]


def test_ban_reverse_rejected_in_pro_zone_if_score_low():
    ban = _hit(score=0.86, distance_m=15.0)

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return ban

    resolver = _resolver.DisplayAddressResolver(geocoder=FakeGeo(), enabled=True)
    out = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="landuse",
        zone_tag="industrial",
        ppm_info={},
        etab_match={},
        centroid_lat=44.8,
        centroid_lon=-0.63,
    )
    assert out["display_address_confidence"] == "none"
    assert out["display_address"] == ""


def test_ppm_needs_fallback_when_address_without_numero():
    assert _resolver.ppm_needs_passerelle_fallback_for_etab(
        {"passerelle_address": "RUE FOCH, PESSAC", "passerelle_numero_match_set": tuple()}
    )
    assert not _resolver.ppm_needs_passerelle_fallback_for_etab(
        {"passerelle_address": "10 RUE FOCH", "passerelle_numero_match_set": ("10",)}
    )


def test_augment_ppm_ban_when_ppm_without_numero():
    ban = _hit(label="12 Rue Foch 33600 Pessac", street="Rue Foch", housenumber="12", citycode="33318")

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return ban

    pk = ("33318", "AB", "0001")
    ppm: dict = {
        pk: {
            "passerelle_address": "RUE FOCH, PESSAC",
            "passerelle_numero_match_set": tuple(),
            "sirens": [],
        }
    }
    by_parcel = {pk: {"w:1"}}
    by_building = {
        "w:1": [
            {
                "code_insee": "33318",
                "section": "AB",
                "numero_norm": "0001",
                "footprint_m2": 500.0,
                "zone_source": "",
                "zone_tag": "",
            }
        ]
    }
    geom = json.dumps(
        {
            "type": "Polygon",
            "coordinates": [[[-0.63, 44.8], [-0.629, 44.8], [-0.629, 44.801], [-0.63, 44.801], [-0.63, 44.8]]],
        }
    )
    payload_by_bat = {"w:1": {"geometry": geom}}
    _resolver.augment_ppm_passerelle_for_etab(
        ppm,
        by_parcel,
        by_building,
        code_insee="33318",
        parcel_geom={},
        payload_by_bat=payload_by_bat,
        geocoder=FakeGeo(),
        build_synthetic_from_text=lambda t: _resolver.build_synthetic_ppm_from_geoplateforme_hit(ban),
        log=lambda _m: None,
    )
    assert ppm[pk]["passerelle_numero_match_set"] == ("12",)
    assert "12" in ppm[pk]["passerelle_address"]


def test_matched_passerelle_kept_when_ban_reverse_would_win():
    """Match SIRENE : garder passerelle, pas le libellé BAN reverse (ancienne étape 3/4)."""
    ban = _hit(label="99 Autre Rue 33600 Pessac", street="Autre Rue", housenumber="99", score=0.95)

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return ban

        def search(self, query: str, *, limit: int = 1):
            raise AssertionError("search ne doit pas être appelé pour display_address")

    resolver = _resolver.DisplayAddressResolver(geocoder=FakeGeo(), enabled=True)
    ppm = {
        "passerelle_address": "10 Rue Foch, Pessac",
        "passerelle_voie_norm": "FOCH",
        "passerelle_numero_match_set": ("10",),
    }
    etab = {
        "status_technique": "matched",
        "status_metier": "single",
        "sirets_json": json.dumps(
            [
                {
                    "siret": "123",
                    "adresse_etablissement": "99 Autre Rue 33600 Pessac",
                    "score": 90.0,
                }
            ]
        ),
    }
    out = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="",
        zone_tag="",
        ppm_info=ppm,
        etab_match=etab,
        centroid_lat=44.8,
        centroid_lon=-0.63,
    )
    assert out["display_address_source"] == "ppm"
    assert "10 Rue Foch" in out["display_address"]
    assert "99 Autre Rue" not in out["display_address"]
    meta = json.loads(out["display_address_meta_json"])
    assert meta.get("corroboration") == "sirene_matched_passerelle"


def test_parcel_ban_query_points_samples_perimeter():
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [-0.65446494, 44.78321655],
                [-0.65438385, 44.7835089],
                [-0.6535632, 44.7834763],
                [-0.6536093, 44.78309732],
                [-0.65446494, 44.78321655],
            ]
        ],
    }
    pts = _resolver.parcel_ban_query_points(geom, max_points=32)
    assert len(pts) >= 4
    assert len(pts) <= 32
    lats = [p[0] for p in pts]
    assert max(lats) - min(lats) > 0.0001


def test_ban_reverse_accepts_via_parcel_shape_not_centroid():
    """Centroïde profond dans le lot : BAN trop loin ; un point du contour passe le seuil 25 m."""
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [-0.65446494, 44.78321655],
                [-0.65438385, 44.7835089],
                [-0.6535632, 44.7834763],
                [-0.6536093, 44.78309732],
                [-0.65446494, 44.78321655],
            ]
        ],
    }
    centroid = _resolver.centroid_from_geojson(geom)
    assert centroid is not None
    cent_lat, cent_lon = centroid
    north_lat = 44.7835089
    north_lon = -0.65438385

    def fake_reverse(lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
        if abs(lat - north_lat) < 1e-4 and abs(lon - north_lon) < 1e-4:
            return _hit(label="3 Avenue Léonard de Vinci 33600 Pessac", distance_m=15.0)
        if abs(lat - cent_lat) < 1e-4 and abs(lon - cent_lon) < 1e-4:
            return _hit(label="3 Avenue Léonard de Vinci 33600 Pessac", distance_m=27.0)
        dist = 27.0 if lat < cent_lat else 15.0
        return _hit(label="3 Avenue Léonard de Vinci 33600 Pessac", distance_m=dist)

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return fake_reverse(lon, lat)

    resolver = _resolver.DisplayAddressResolver(geocoder=FakeGeo(), enabled=True)
    out_centroid_only = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="",
        zone_tag="",
        ppm_info={},
        etab_match={},
        centroid_lat=cent_lat,
        centroid_lon=cent_lon,
        parcel_geom_geojson=None,
    )
    assert out_centroid_only["display_address_confidence"] == "none"

    out_shape = resolver.resolve_for_building(
        code_insee="33318",
        osm_raw_tags={},
        osm_address_text="",
        zone_source="",
        zone_tag="",
        ppm_info={},
        etab_match={},
        centroid_lat=cent_lat,
        centroid_lon=cent_lon,
        parcel_geom_geojson=geom,
    )
    assert out_shape["display_address_confidence"] == "confirmed"
    assert out_shape["display_address_source"] == "ban_reverse"
    meta = json.loads(out_shape["display_address_meta_json"])
    assert meta.get("ban_query_mode") == "parcel_shape"


def test_augment_ppm_ban_prefers_closest_hit_on_parcel_shape():
    """Passerelle SIRENE : ne pas s'arrêter au premier hit centroïde (voie voisine)."""
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [-0.65446494, 44.78321655],
                [-0.65438385, 44.7835089],
                [-0.6535632, 44.7834763],
                [-0.6536093, 44.78309732],
                [-0.65446494, 44.78321655],
            ]
        ],
    }
    centroid = _resolver.centroid_from_geojson(geom)
    assert centroid is not None
    cent_lat, cent_lon = centroid
    north_lat = 44.7835089
    north_lon = -0.65438385
    wrong = _hit(
        label="99 Rue Foch 33600 Pessac",
        street="Rue Foch",
        housenumber="99",
        distance_m=12.0,
        score=0.95,
    )
    right = _hit(
        label="14 Avenue Léonard de Vinci 33600 Pessac",
        street="Avenue Léonard de Vinci",
        housenumber="14",
        distance_m=8.0,
        score=0.95,
    )

    def fake_reverse(lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
        if abs(lat - north_lat) < 1e-4 and abs(lon - north_lon) < 1e-4:
            return right
        if abs(lat - cent_lat) < 1e-4 and abs(lon - cent_lon) < 1e-4:
            return wrong
        return wrong

    class FakeGeo(GeoplateformeGeocoder):
        def reverse(self, lon: float, lat: float, *, limit: int = 1, code_insee: str | None = None):
            return fake_reverse(lon, lat)

    pk = ("33318", "HH", "0005")
    ppm: dict = {pk: {"passerelle_address": "", "passerelle_numero_match_set": tuple(), "sirens": []}}
    by_parcel = {pk: {"w:1"}}
    by_building = {
        "w:1": [
            {
                "code_insee": "33318",
                "section": "HH",
                "numero_norm": "0005",
                "footprint_m2": 787.0,
                "zone_source": "landuse",
                "zone_tag": "commercial",
            }
        ]
    }
    payload_by_bat = {"w:1": {"geometry": json.dumps(geom)}}
    _resolver.augment_ppm_passerelle_for_etab(
        ppm,
        by_parcel,
        by_building,
        code_insee="33318",
        parcel_geom={pk: json.dumps(geom)},
        payload_by_bat=payload_by_bat,
        geocoder=FakeGeo(),
        build_synthetic_from_text=lambda t: _resolver.build_synthetic_ppm_from_geoplateforme_hit(right),
        log=lambda _m: None,
    )
    assert ppm[pk]["passerelle_numero_match_set"] == ("14",)
    assert "Léonard" in ppm[pk]["passerelle_address"] or "LEONARD" in ppm[pk]["passerelle_address"].upper()


def test_pick_parcel_display_from_largest_footprint():
    picked = _resolver.pick_parcel_display_from_buildings(
        [
            {"footprint_m2": 100, "display_address": "A", "display_address_confidence": "confirmed", "display_address_source": "osm", "display_address_meta_json": "{}"},
            {"footprint_m2": 500, "display_address": "B", "display_address_confidence": "confirmed", "display_address_source": "ban_reverse", "display_address_meta_json": "{}"},
        ]
    )
    assert picked["display_address"] == "B"
