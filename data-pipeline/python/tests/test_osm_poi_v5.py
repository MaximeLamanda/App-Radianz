"""Tests unitaires — normalisation POI OSM matching V5."""

import importlib.util
import sys
from pathlib import Path


def _load_osm_poi_v5():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "osm_poi_v5.py"
    spec = importlib.util.spec_from_file_location("osm_poi_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["osm_poi_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_normalize_osm_row_for_export():
    m = _load_osm_poi_v5()
    out = m.normalize_osm_row_for_export(
        "n",
        123,
        -0.5,
        44.8,
        {"shop": "optician", "name": "Vue Claire", "phone": "0555000000", "website": "https://ex.example"},
    )
    assert out["name"] == "Vue Claire"
    assert out.get("address") == ""
    assert out["phone"] == "0555000000"
    assert out["website"] == "https://ex.example"
    assert out["poi_primary_key"] == "shop"
    assert out["poi_primary_value"] == "optician"
    assert "opticien" in out["poi_type_label"].lower() or "Opticien" in out["poi_type_label"]
    assert out["osm_url"] == "https://www.openstreetmap.org/node/123"


def test_normalize_osm_row_for_export_with_addr():
    m = _load_osm_poi_v5()
    out = m.normalize_osm_row_for_export(
        "n",
        999,
        -0.6,
        44.81,
        {
            "amenity": "cafe",
            "name": "Le Zinc",
            "addr:housenumber": "12",
            "addr:street": "Rue de la Paix",
            "addr:postcode": "33600",
            "addr:city": "Pessac",
        },
    )
    assert "12" in out["address"] and "Rue de la Paix" in out["address"]
    assert "33600" in out["address"] and "Pessac" in out["address"]


def test_normalize_osm_row_addr_full():
    m = _load_osm_poi_v5()
    out = m.normalize_osm_row_for_export(
        "n",
        1,
        0.0,
        0.0,
        {"shop": "yes", "addr:full": "1 place Bellevue, 75001 Paris"},
    )
    assert out["address"] == "1 place Bellevue, 75001 Paris"


def test_poi_tags_interesting_excludes_parking_amenity():
    m = _load_osm_poi_v5()
    assert m.poi_tags_interesting({"amenity": "parking"}) is False
    assert m.poi_tags_interesting({"amenity": "fuel"}) is True


def test_poi_tags_interesting_disused():
    m = _load_osm_poi_v5()
    assert m.poi_tags_interesting({"disused:shop": "yes", "shop": "supermarket"}) is False


def test_normalize_osm_row_leisure_amusement_arcade_french_label():
    m = _load_osm_poi_v5()
    out = m.normalize_osm_row_for_export(
        "n",
        42,
        2.3,
        48.9,
        {"leisure": "amusement_arcade", "name": "Game Box"},
    )
    assert out["poi_type_label"] == "Salle d'arcades"
    assert "leisure:" not in out["poi_type_label"].lower()


def test_normalize_osm_row_unknown_leisure_fallback_no_osm_colon_syntax():
    m = _load_osm_poi_v5()
    out = m.normalize_osm_row_for_export(
        "n",
        99,
        0.0,
        0.0,
        {"leisure": "rare_custom_slug_value", "name": "X"},
    )
    assert "Loisirs" in out["poi_type_label"]
    assert "leisure:" not in out["poi_type_label"].lower()
    assert "—" in out["poi_type_label"]


def test_tags_stored_for_postgres_strips_noise():
    m = _load_osm_poi_v5()
    full = {
        "shop": "car_repair",
        "name": "Garage",
        "phone": "05",
        "building": "yes",
        "source": "survey",
        "wikidata": "Q1",
        "addr:street": "Rue X",
    }
    slim = m.tags_stored_for_postgres(full)
    assert "shop" in slim and "name" in slim and "phone" in slim
    assert "addr:street" in slim
    assert "building" not in slim
    assert "source" not in slim
    assert "wikidata" not in slim
