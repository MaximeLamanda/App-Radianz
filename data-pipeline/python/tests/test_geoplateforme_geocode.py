from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_geoplateforme():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "geoplateforme_geocode.py"
    spec = importlib.util.spec_from_file_location("geoplateforme_geocode", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["geoplateforme_geocode"] = mod
    spec.loader.exec_module(mod)
    return mod


_geoplateforme = _load_geoplateforme()
GeoplateformeGeocoder = _geoplateforme.GeoplateformeGeocoder
parse_geoplateforme_feature = _geoplateforme.parse_geoplateforme_feature


def test_parse_geoplateforme_feature_housenumber():
    feat = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-0.63, 44.8]},
        "properties": {
            "type": "housenumber",
            "label": "6 Avenue Brémontier 33600 Pessac",
            "score": 0.99,
            "distance": 12,
            "citycode": "33318",
            "street": "Avenue Brémontier",
            "housenumber": "6",
            "postcode": "33600",
            "city": "Pessac",
        },
    }
    hit = parse_geoplateforme_feature(feat)
    assert hit is not None
    assert hit.label.startswith("6 Avenue")
    assert hit.score == 0.99
    assert hit.citycode == "33318"
    assert hit.distance_m == 12.0


def test_geocoder_reverse_uses_injected_json_get():
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-0.63, 44.8]},
                "properties": {
                    "type": "housenumber",
                    "label": "1 Rue Test 33000 Bordeaux",
                    "score": 0.95,
                    "distance": 5,
                    "citycode": "33000",
                    "street": "Rue Test",
                    "housenumber": "1",
                    "postcode": "33000",
                    "city": "Bordeaux",
                },
            }
        ],
    }
    calls: list[str] = []

    def fake_get(url: str, timeout_s: float) -> dict:
        calls.append(url)
        return payload

    geo = GeoplateformeGeocoder(json_get=fake_get, min_interval_s=0)
    hit = geo.reverse(-0.63, 44.8)
    assert hit is not None
    assert hit.label == "1 Rue Test 33000 Bordeaux"
    assert len(calls) == 1
    assert "reverse" in calls[0]
