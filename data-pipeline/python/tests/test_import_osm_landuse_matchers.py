"""Filtres landuse / leisure pour import_osm_landuse (sans lecture PBF)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_import_osm_landuse():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "import_osm_landuse.py"
    spec = importlib.util.spec_from_file_location("import_osm_landuse", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    # dépendances du module (osmium, shapely…) : on ne charge que les helpers si possible
    sys.modules["import_osm_landuse"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_default_landuse_includes_agricultural_and_recreation():
    m = _load_import_osm_landuse()
    match = m.build_landuse_matcher("")
    assert match("farmland") == "farmland"
    assert match("meadow") == "meadow"
    assert match("recreation_ground") == "recreation_ground"
    assert match("residential") == "residential"
    assert match("garbage_value_xyz") is None


def test_default_leisure_includes_sports():
    m = _load_import_osm_landuse()
    match = m.build_leisure_matcher("")
    assert match("sports_centre") == "sports_centre"
    assert match("stadium") == "stadium"
    assert match("pitch") == "pitch"
    assert match("playground") is None
