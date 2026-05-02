from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_matching_v5_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "data-pipeline" / "matching_v5" / "run_matching_v5.py"
    spec = importlib.util.spec_from_file_location("run_matching_v5", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_resolve_multi_parcelles_shared_siren_prefers_max_rows_then_intersection():
    mod = _load_matching_v5_module()
    by_building = {
        "bdnb-bg-5TVB-LQ8V-PY94:1": [
            {
                "code_insee": "33318",
                "section": "HC",
                "numero_norm": "0034",
                "intersection_area_m2": 120.0,
            },
            {
                "code_insee": "33318",
                "section": "HC",
                "numero_norm": "0035",
                "intersection_area_m2": 900.0,
            },
        ]
    }
    ppm = {
        ("33318", "HC", "0034"): {
            "sirens": ["432758597", "111111111"],
            "siren_rows": {"432758597": 5, "111111111": 1},
        },
        ("33318", "HC", "0035"): {
            "sirens": ["432758597", "222222222"],
            "siren_rows": {"432758597": 3, "222222222": 4},
        },
    }

    assigned, decisions = mod.resolve_multi_parcel_buildings(by_building, ppm)

    assert assigned["bdnb-bg-5TVB-LQ8V-PY94:1"] == ("33318", "HC", "0035")
    d = decisions["bdnb-bg-5TVB-LQ8V-PY94:1"]
    assert d["matching_status"] == "partage"
    assert d["matching_decision"] == "shared_siren"
    assert d["matching_siren_selected"] == "432758597"
    assert d["winner_parcelle"] == {"code_insee": "33318", "section": "HC", "numero_norm": "0035"}


def test_resolve_multi_parcelles_without_shared_siren_falls_back_to_intersection():
    mod = _load_matching_v5_module()
    by_building = {
        "bat-2": [
            {
                "code_insee": "33318",
                "section": "AB",
                "numero_norm": "0001",
                "intersection_area_m2": 200.0,
            },
            {
                "code_insee": "33318",
                "section": "AB",
                "numero_norm": "0002",
                "intersection_area_m2": 450.0,
            },
        ]
    }
    ppm = {
        ("33318", "AB", "0001"): {"sirens": ["111111111"], "siren_rows": {"111111111": 2}},
        ("33318", "AB", "0002"): {"sirens": ["222222222"], "siren_rows": {"222222222": 7}},
    }

    assigned, decisions = mod.resolve_multi_parcel_buildings(by_building, ppm)

    assert assigned["bat-2"] == ("33318", "AB", "0002")
    d = decisions["bat-2"]
    assert d["matching_status"] == "partage"
    assert d["matching_decision"] == "unique_by_intersection"
    assert d["matching_siren_selected"] == ""
    assert d["shared_sirens"] == []
