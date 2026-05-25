"""Tests unitaires — jointure parking V5."""

import importlib.util
import sys
from pathlib import Path


def _load():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "osm_parking_match_v5.py"
    spec = importlib.util.spec_from_file_location("osm_parking_match_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["osm_parking_match_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_common_parcel_keys():
    m = _load()
    b = {("33", "AB", "1"), ("33", "AB", "2")}
    p = {("33", "AB", "2"), ("33", "AB", "3")}
    assert m.common_parcel_keys(b, p) == {("33", "AB", "2")}


def test_link_parkings_to_building_requires_common_parcel():
    m = _load()
    parking_index = {
        ("w", 10): {
            "osm_type": "w",
            "osm_id": 10,
            "parking_tag": "amenity",
            "parking_value": "parking",
            "parking_area_m2": 500.0,
            "tags": {},
            "parcel_keys": {("33", "AB", "99")},
            "parking_parcels_json": [
                {"code_insee": "33", "section": "AB", "numero_norm": "99", "intersection_area_m2": 500.0}
            ],
        }
    }
    assert m.link_parkings_to_building({("33", "AB", "1")}, parking_index) == []
    linked = m.link_parkings_to_building({("33", "AB", "99")}, parking_index)
    assert len(linked) == 1
    assert linked[0]["osm_parking_id"] == 10
    assert linked[0]["parking_area_m2"] == 500.0


def test_attach_charging_stations_on_common_parcels_only():
    m = _load()
    parkings = [
        {
            "osm_parking_type": "w",
            "osm_parking_id": 1,
            "common_parcels_json": [{"code_insee": "33", "section": "AB", "numero_norm": "1"}],
            "charging_stations_json": [],
        }
    ]
    charging_by_pk = {
        ("33", "AB", "1"): [
            {
                "osm_type": "n",
                "osm_id": 7,
                "name": "Borne A",
                "poi_type_label": "Borne de recharge",
                "raw_tags": {"capacity": "2"},
            }
        ],
        ("33", "AB", "2"): [
            {"osm_type": "n", "osm_id": 8, "name": "Borne B", "raw_tags": {}},
        ],
    }
    out = m.attach_charging_stations_to_parkings(parkings, charging_by_pk)
    assert len(out[0]["charging_stations_json"]) == 1
    assert out[0]["charging_stations_json"][0]["osm_id"] == 7
    assert out[0]["charging_stations_json"][0]["capacity"] == "2"


def test_build_parking_index_from_rows():
    m = _load()
    rows = [
        {
            "osm_type": "w",
            "osm_id": 5,
            "parking_tag": "amenity",
            "parking_value": "parking",
            "parking_area_m2": 100.0,
            "tags": {"name": "P1"},
            "code_insee": "33318",
            "section": "A",
            "numero_norm": "1",
            "intersection_area_m2": 80.0,
            "geometry": {"type": "Polygon", "coordinates": []},
        },
        {
            "osm_type": "w",
            "osm_id": 5,
            "parking_tag": "amenity",
            "parking_value": "parking",
            "parking_area_m2": 100.0,
            "tags": {"name": "P1"},
            "code_insee": "33318",
            "section": "A",
            "numero_norm": "2",
            "intersection_area_m2": 20.0,
            "geometry": {"type": "Polygon", "coordinates": []},
        },
    ]
    idx = m.build_parking_index_from_rows(rows)
    assert ("w", 5) in idx
    assert len(idx[("w", 5)]["parking_parcels_json"]) == 2
    assert ("33318", "A", "2") in idx[("w", 5)]["parcel_keys"]
