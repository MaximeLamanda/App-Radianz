"""Tests — matchers import parking OSM."""

import importlib.util
import sys
from pathlib import Path


def _load_import_osm_parking():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "import_osm_parking.py"
    spec = importlib.util.spec_from_file_location("import_osm_parking", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["import_osm_parking"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_parking_tag_from_tags_amenity_leisure_landuse():
    m = _load_import_osm_parking()
    assert m.parking_tag_from_tags({"amenity": "parking"}) == ("amenity", "parking")
    assert m.parking_tag_from_tags({"leisure": "parking"}) == ("leisure", "parking")
    assert m.parking_tag_from_tags({"landuse": "parking"}) == ("landuse", "parking")
    assert m.parking_tag_from_tags({"amenity": "restaurant"}) is None
    assert m.parking_tag_from_tags({"amenity": "parking", "leisure": "pitch"}) == ("amenity", "parking")


def test_build_parking_matcher_custom_csv():
    m = _load_import_osm_parking()
    matcher = m.build_parking_matcher("amenity=parking")
    assert matcher({"amenity": "parking"}) == ("amenity", "parking")
    assert matcher({"leisure": "parking"}) is None
