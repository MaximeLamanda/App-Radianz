"""Tests — fusion OSM/ENR avec priorité ENR."""

import importlib.util
import sys
from pathlib import Path


def _load():
    repo_root = Path(__file__).resolve().parents[3]
    matching = repo_root / "data-pipeline" / "matching_v5"
    for name in ("enr_parking_v5", "osm_parking_v5", "osm_poi_v5"):
        p = matching / f"{name}.py"
        spec = importlib.util.spec_from_file_location(name, p)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    mod_path = matching / "parking_match_v5.py"
    spec = importlib.util.spec_from_file_location("parking_match_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["parking_match_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def _square(lon0: float, lat0: float, d: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [lon0, lat0],
                [lon0 + d, lat0],
                [lon0 + d, lat0 + d],
                [lon0, lat0],
            ]
        ],
    }


def test_merge_drops_osm_when_heavily_overlapping_enr():
    m = _load()
    geom = _square(-0.5, 44.8, 0.01)
    enr_rows = [
        {
            "osm_type": "e",
            "osm_id": 1,
            "parking_area_m2": 10000.0,
            "geometry": geom,
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "1",
        }
    ]
    osm_rows = [
        {
            "osm_type": "w",
            "osm_id": 99,
            "parking_area_m2": 10000.0,
            "geometry": geom,
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "1",
        }
    ]
    merged = m.merge_parking_rows_with_enr_priority(osm_rows, enr_rows, overlap_ratio=0.5)
    keys = {(r["osm_type"], r["osm_id"]) for r in merged}
    assert ("e", 1) in keys
    assert ("w", 99) not in keys


def test_merge_keeps_osm_when_geometries_disjoint():
    m = _load()
    enr_rows = [
        {
            "osm_type": "e",
            "osm_id": 1,
            "parking_area_m2": 5000.0,
            "geometry": _square(-0.5, 44.8, 0.01),
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "1",
        }
    ]
    osm_rows = [
        {
            "osm_type": "w",
            "osm_id": 99,
            "parking_area_m2": 5000.0,
            "geometry": _square(-0.3, 44.8, 0.01),
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "2",
        }
    ]
    merged = m.merge_parking_rows_with_enr_priority(osm_rows, enr_rows)
    keys = {(r["osm_type"], r["osm_id"]) for r in merged}
    assert ("e", 1) in keys
    assert ("w", 99) in keys


def test_parking_index_key_merges_negative_relation_with_way():
    m = _load()
    rows = [
        {
            "osm_type": "w",
            "osm_id": 42,
            "parking_area_m2": 1000.0,
            "geometry": _square(-0.5, 44.8, 0.01),
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "1",
            "tags": {},
        },
        {
            "osm_type": "r",
            "osm_id": -42,
            "parking_area_m2": 1000.0,
            "geometry": _square(-0.5, 44.8, 0.01),
            "code_insee": "33318",
            "section": "AB",
            "numero_norm": "2",
            "tags": {},
        },
    ]
    index = m.build_parking_index_from_rows(rows)
    assert len(index) == 1
    assert ("w", 42) in index


def test_build_parking_export_entry_enr_source():
    m = _load()
    entry = m.build_parking_export_entry(
        {
            "osm_type": "e",
            "osm_id": 42,
            "parking_tag": "enr",
            "parking_value": "park_sup_500",
            "tags": {"name": "Pessac"},
            "parking_parcels_json": [],
        },
        {("33318", "AB", "1")},
    )
    assert entry["parking_source"] == "enr"
    assert entry["osm_parking_type"] == "e"
    assert entry["osm_parking_id"] == 42
