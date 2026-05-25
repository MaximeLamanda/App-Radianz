"""Tests unitaires — helpers OSM footprints V5."""

import importlib.util
import sys
from pathlib import Path


def _load_osm_buildings_v5():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "osm_buildings_v5.py"
    spec = importlib.util.spec_from_file_location("osm_buildings_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["osm_buildings_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_format_osm_building_id():
    m = _load_osm_buildings_v5()
    assert m.format_osm_building_id("w", 12) == "w:12"
    assert m.format_osm_building_id("relation", 99) == "r:99"


def test_osm_bdnb_match_status():
    m = _load_osm_buildings_v5()
    assert m.osm_bdnb_match_status(None, 20.0) == "unmatched"
    assert m.osm_bdnb_match_status(0.0, 20.0) == "unmatched"
    assert m.osm_bdnb_match_status(5.0, 20.0) == "low_overlap"
    assert m.osm_bdnb_match_status(20.0, 20.0) == "matched"
    assert m.osm_bdnb_match_status(42.5, 20.0) == "matched"


def test_derive_zone_tag_landuse_priority():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag("industrial", "retail", "warehouse") == ("industrial", "landuse")


def test_derive_zone_tag_farmland_from_landuse():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag("farmland", None, "yes") == ("farmland", "landuse")


def test_derive_zone_tag_building_use_fallback():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag(None, "commercial", "yes") == ("commercial", "building_use")


def test_derive_zone_tag_building_fallback():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag(None, "", "warehouse") == ("warehouse", "building")


def test_derive_zone_tag_building_yes_ignored():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag(None, "", "yes") == ("", "none")
    assert m.derive_zone_tag(None, "", "YES") == ("", "none")


def test_derive_zone_tag_empty():
    m = _load_osm_buildings_v5()
    assert m.derive_zone_tag(None, None, None) == ("", "none")
    assert m.derive_zone_tag("", "  ", "") == ("", "none")


def test_osm_building_tag_is_importable():
    m = _load_osm_buildings_v5()
    assert m.osm_building_tag_is_importable({}) is False
    assert m.osm_building_tag_is_importable({"building": ""}) is False
    assert m.osm_building_tag_is_importable({"building": "no"}) is False
    assert m.osm_building_tag_is_importable({"building": "NO"}) is False
    assert m.osm_building_tag_is_importable({"building": "yes"}) is True
    assert m.osm_building_tag_is_importable({"building": "warehouse"}) is True

