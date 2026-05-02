"""Résolution des noms OSM (cascade de tags) pour extract GPKG/PBF."""

import pandas as pd

from scout_pipeline.osm_poi_extract import OSM_NAME_TAG_PRIORITY, _series_best_display_name


def test_name_priority_order():
    s = pd.Series({"name": "A", "operator": "B", "brand": "C"})
    assert _series_best_display_name(s) == "A"


def test_operator_when_name_empty():
    s = pd.Series({"name": "", "operator": "Intermarché"})
    assert _series_best_display_name(s) == "Intermarché"


def test_brand_when_name_whitespace_only():
    s = pd.Series({"name": "   ", "brand": "Lidl"})
    assert _series_best_display_name(s) == "Lidl"


def test_name_fr_fallback():
    s = pd.Series({"name": float("nan"), "name:fr": "Mairie"})
    assert _series_best_display_name(s) == "Mairie"


def test_returns_none_when_no_tags():
    s = pd.Series({"code": 123})
    assert _series_best_display_name(s) is None


def test_priority_tuple_has_name_first():
    assert OSM_NAME_TAG_PRIORITY[0] == "name"
