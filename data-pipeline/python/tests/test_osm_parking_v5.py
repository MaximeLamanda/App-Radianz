"""Tests unitaires — helpers OSM parking V5."""

import importlib.util
import os
import sys
from pathlib import Path


def _load_osm_parking_v5():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "osm_parking_v5.py"
    spec = importlib.util.spec_from_file_location("osm_parking_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["osm_parking_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_qualified_osm_parking_table_default():
    os.environ.pop("OSM_PARKING_TABLE", None)
    m = _load_osm_parking_v5()
    assert m.qualified_osm_parking_table() == '"public"."osm_parking_areas"'


def test_default_parking_tags():
    m = _load_osm_parking_v5()
    assert ("amenity", "parking") in m.DEFAULT_PARKING_TAGS
    assert ("leisure", "parking") in m.DEFAULT_PARKING_TAGS
    assert ("landuse", "parking") in m.DEFAULT_PARKING_TAGS
