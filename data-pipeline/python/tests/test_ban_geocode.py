from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_ban_geocode():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "ban_geocode.py"
    spec = importlib.util.spec_from_file_location("ban_geocode", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ban_geocode"] = mod
    # geoplateforme_geocode dependency
    geo_path = repo_root / "data-pipeline" / "matching_v5" / "geoplateforme_geocode.py"
    geo_spec = importlib.util.spec_from_file_location("geoplateforme_geocode", geo_path)
    assert geo_spec and geo_spec.loader
    geo_mod = importlib.util.module_from_spec(geo_spec)
    sys.modules["geoplateforme_geocode"] = geo_mod
    geo_spec.loader.exec_module(geo_mod)
    spec.loader.exec_module(mod)
    return mod


_ban = _load_ban_geocode()
build_ban_label = _ban.build_ban_label
distance_m_to_score = _ban.distance_m_to_score
row_to_geoplateforme_hit = _ban.row_to_geoplateforme_hit


def test_distance_m_to_score_at_thresholds():
    assert distance_m_to_score(0) >= 0.99
    assert distance_m_to_score(20) >= 0.88
    assert distance_m_to_score(25) >= 0.85
    assert distance_m_to_score(50) < 0.85


def test_build_ban_label_housenumber():
    label = build_ban_label(
        numero="6",
        rep="",
        nom_voie="Avenue Brémontier",
        code_postal="33600",
        nom_commune="Pessac",
    )
    assert label == "6 Avenue Brémontier 33600 Pessac"


def test_row_to_geoplateforme_hit():
    hit = row_to_geoplateforme_hit(
        (
            "33318_abc",
            "12",
            "",
            "Rue Test",
            "33600",
            "33318",
            "Pessac",
            -0.63,
            44.8,
            8.5,
        )
    )
    assert hit.housenumber == "12"
    assert hit.citycode == "33318"
    assert hit.result_type == "housenumber"
    assert hit.distance_m == 8.5
    assert hit.score >= 0.85
