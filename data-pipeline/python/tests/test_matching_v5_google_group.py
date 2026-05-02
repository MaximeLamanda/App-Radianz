from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch


def _load_matching_v5_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "data-pipeline" / "matching_v5" / "run_matching_v5.py"
    spec = importlib.util.spec_from_file_location("run_matching_v5", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parcel_pk_to_group_id_transitive_chain():
    mod = _load_matching_v5_module()
    exported = {
        ("33318", "S", "0001"),
        ("33318", "S", "0002"),
        ("33318", "S", "0003"),
    }
    by_building = {
        "bat-1": [
            {"code_insee": "33318", "section": "S", "numero_norm": "0001"},
            {"code_insee": "33318", "section": "S", "numero_norm": "0002"},
        ],
        "bat-2": [
            {"code_insee": "33318", "section": "S", "numero_norm": "0002"},
            {"code_insee": "33318", "section": "S", "numero_norm": "0003"},
        ],
    }
    m = mod.parcel_pk_to_group_id(exported, by_building)
    gids = {m[pk] for pk in exported}
    assert len(gids) == 1
    assert len(next(iter(gids))) == 3


def test_is_parc_industriel_iris():
    mod = _load_matching_v5_module()
    assert mod.is_parc_industriel_iris("Parc Industriel") is True
    assert mod.is_parc_industriel_iris("  parc industriel ") is True
    assert mod.is_parc_industriel_iris("Chartrons-Grand Parc 1") is False


def test_parcel_geometries_union_geojson_two_polygons():
    mod = _load_matching_v5_module()
    p1 = {"type": "Polygon", "coordinates": [[[0.0, 0.0], [0.0, 0.001], [0.001, 0.001], [0.001, 0.0], [0.0, 0.0]]]}
    p2 = {"type": "Polygon", "coordinates": [[[0.002, 0.0], [0.002, 0.001], [0.003, 0.001], [0.003, 0.0], [0.002, 0.0]]]}
    geom = {
        ("33", "A", "1"): json.dumps(p1),
        ("33", "A", "2"): json.dumps(p2),
    }
    gj, ll = mod.parcel_geometries_union_geojson(geom, [("33", "A", "1"), ("33", "A", "2")])
    assert gj is not None and ll is not None
    u = json.loads(gj)
    assert u["type"] in ("Polygon", "MultiPolygon")


def _ppm_no_siret():
    return {
        "siret_count": 0,
        "status_technique": "no_candidate",
        "status_metier": "none",
        "sirets_json": "[]",
        "sirens_json": "[]",
        "matching_confidence": 0.0,
        "matching_reason": "",
    }


def _minimal_gout():
    return {
        "counters": {"nearby_calls": 1, "details_calls": 0, "api_gouv_calls": 0},
        "trace": {
            "nearby_status": "ZERO_RESULTS",
            "nearby_error": "",
            "raw_nearby_count": 0,
            "excluded_outside_parcel": 0,
            "nearby_ranked_json": "[]",
            "winner_place_id": "",
            "winner_name": "",
            "api_gouv_query": "",
            "reject_reason": "no_poi_ranked",
        },
        "formatted_address": None,
        "anchor_address": None,
        "api_etablissements_at_cp": [],
    }


def test_precompute_google_single_api_call_for_two_parcels_parc_industriel():
    mod = _load_matching_v5_module()
    exported = {("33318", "HC", "0001"), ("33318", "HC", "0002")}
    by_building = {
        "b1": [
            {"code_insee": "33318", "section": "HC", "numero_norm": "0001"},
            {"code_insee": "33318", "section": "HC", "numero_norm": "0002"},
        ],
    }
    poly = {"type": "Polygon", "coordinates": [[[-0.61, 44.78], [-0.61, 44.781], [-0.609, 44.781], [-0.609, 44.78], [-0.61, 44.78]]]}
    parcel_geom = {
        ("33318", "HC", "0001"): json.dumps(poly),
        ("33318", "HC", "0002"): json.dumps(poly),
    }
    nom_iris = {
        ("33318", "HC", "0001"): "Parc Industriel",
        ("33318", "HC", "0002"): "Autre",
    }

    def ppm_payload(pk):
        _ = pk
        return _ppm_no_siret()

    pk_to_gid = mod.parcel_pk_to_group_id(exported, by_building)
    stats = {"attempted": 0, "success": 0, "nearby_calls": 0, "details_calls": 0, "api_gouv_calls": 0}
    with patch.object(mod, "run_google_poi_fallback_for_parcel", return_value=_minimal_gout()) as m:
        cache = mod.precompute_google_group_fallback_cache(
            google_fb=True,
            etab_available=True,
            google_key="test-key",
            google_radius_m=100.0,
            exported_pks=exported,
            parcel_geom=parcel_geom,
            nom_iris_by_pk=nom_iris,
            ppm_payload=ppm_payload,
            voie_index={},
            etab_rows=[],
            google_stats=stats,
            pk_to_gid=pk_to_gid,
        )
        assert m.call_count == 1
    assert stats["attempted"] == 1
    gid = tuple(sorted(exported))
    assert gid in cache
    gr = cache[gid]["google_row"]
    assert gr.get("google_nearby_ranked_json") == "[]"


def test_precompute_google_propagates_nearby_ranked_json():
    mod = _load_matching_v5_module()
    exported = {("33318", "HC", "0001"), ("33318", "HC", "0002")}
    by_building = {
        "b1": [
            {"code_insee": "33318", "section": "HC", "numero_norm": "0001"},
            {"code_insee": "33318", "section": "HC", "numero_norm": "0002"},
        ],
    }
    poly = {"type": "Polygon", "coordinates": [[[-0.61, 44.78], [-0.61, 44.781], [-0.609, 44.781], [-0.609, 44.78], [-0.61, 44.78]]]}
    parcel_geom = {
        ("33318", "HC", "0001"): json.dumps(poly),
        ("33318", "HC", "0002"): json.dumps(poly),
    }
    nom_iris = {
        ("33318", "HC", "0001"): "Parc Industriel",
        ("33318", "HC", "0002"): "Autre",
    }

    def ppm_payload(pk):
        _ = pk
        return _ppm_no_siret()

    ranked_json = json.dumps(
        [{"rank": 0, "place_id": "ChIJx", "name": "POI A", "vicinity": None, "types": ["store"], "lat": 44.78, "lng": -0.61}],
        ensure_ascii=False,
    )
    gout = {
        "counters": {"nearby_calls": 1, "details_calls": 1, "api_gouv_calls": 0},
        "trace": {
            "nearby_status": "OK",
            "nearby_error": "",
            "raw_nearby_count": 1,
            "excluded_outside_parcel": 0,
            "nearby_ranked_json": ranked_json,
            "winner_place_id": "ChIJx",
            "winner_name": "POI A",
            "api_gouv_query": "",
            "reject_reason": "api_gouv_error",
        },
        "formatted_address": None,
        "anchor_address": None,
        "api_etablissements_at_cp": [],
    }

    pk_to_gid = mod.parcel_pk_to_group_id(exported, by_building)
    stats = {"attempted": 0, "success": 0, "nearby_calls": 0, "details_calls": 0, "api_gouv_calls": 0}
    with patch.object(mod, "run_google_poi_fallback_for_parcel", return_value=gout):
        cache = mod.precompute_google_group_fallback_cache(
            google_fb=True,
            etab_available=True,
            google_key="test-key",
            google_radius_m=100.0,
            exported_pks=exported,
            parcel_geom=parcel_geom,
            nom_iris_by_pk=nom_iris,
            ppm_payload=ppm_payload,
            voie_index={},
            etab_rows=[],
            google_stats=stats,
            pk_to_gid=pk_to_gid,
        )
    gid = tuple(sorted(exported))
    assert json.loads(cache[gid]["google_row"]["google_nearby_ranked_json"]) == json.loads(ranked_json)


def test_precompute_google_skips_when_no_parc_industriel():
    mod = _load_matching_v5_module()
    exported = {("33318", "HC", "0001"), ("33318", "HC", "0002")}
    by_building = {
        "b1": [
            {"code_insee": "33318", "section": "HC", "numero_norm": "0001"},
            {"code_insee": "33318", "section": "HC", "numero_norm": "0002"},
        ],
    }
    poly = {"type": "Polygon", "coordinates": [[[-0.61, 44.78], [-0.61, 44.781], [-0.609, 44.781], [-0.609, 44.78], [-0.61, 44.78]]]}
    parcel_geom = {
        ("33318", "HC", "0001"): json.dumps(poly),
        ("33318", "HC", "0002"): json.dumps(poly),
    }
    nom_iris = {("33318", "HC", "0001"): "Centre-ville", ("33318", "HC", "0002"): "Autre"}

    def ppm_payload(pk):
        _ = pk
        return _ppm_no_siret()

    pk_to_gid = mod.parcel_pk_to_group_id(exported, by_building)
    stats = {"attempted": 0, "success": 0, "nearby_calls": 0, "details_calls": 0, "api_gouv_calls": 0}
    with patch.object(mod, "run_google_poi_fallback_for_parcel", return_value=_minimal_gout()) as m:
        mod.precompute_google_group_fallback_cache(
            google_fb=True,
            etab_available=True,
            google_key="test-key",
            google_radius_m=100.0,
            exported_pks=exported,
            parcel_geom=parcel_geom,
            nom_iris_by_pk=nom_iris,
            ppm_payload=ppm_payload,
            voie_index={},
            etab_rows=[],
            google_stats=stats,
            pk_to_gid=pk_to_gid,
        )
        assert m.call_count == 0
    assert stats["attempted"] == 0
