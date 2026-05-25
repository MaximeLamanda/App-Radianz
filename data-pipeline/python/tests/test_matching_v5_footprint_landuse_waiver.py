"""Dérogation emprise 400 m² sur landuse commercial / industrial / retail (matching V5)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_osm_landuse_v5():
    repo_root = Path(__file__).resolve().parents[3]
    lu_path = repo_root / "data-pipeline" / "matching_v5" / "osm_landuse_v5.py"
    lu_spec = importlib.util.spec_from_file_location("osm_landuse_v5_waiver", lu_path)
    assert lu_spec is not None and lu_spec.loader is not None
    lu_mod = importlib.util.module_from_spec(lu_spec)
    sys.modules["osm_landuse_v5_waiver"] = lu_mod
    lu_spec.loader.exec_module(lu_mod)
    return lu_mod


def test_building_has_pro_landuse_waiver_industrial():
    landuse = _load_osm_landuse_v5()
    assert landuse.building_has_pro_landuse_waiver(
        {"zone_source": "landuse", "zone_tag": "industrial"}
    )


def test_building_has_pro_landuse_waiver_residential_rejected():
    landuse = _load_osm_landuse_v5()
    assert not landuse.building_has_pro_landuse_waiver(
        {"zone_source": "landuse", "zone_tag": "residential"}
    )


def test_building_has_pro_landuse_waiver_building_use_commercial_rejected():
    landuse = _load_osm_landuse_v5()
    assert not landuse.building_has_pro_landuse_waiver(
        {"zone_source": "building_use", "zone_tag": "commercial"}
    )


def test_footprint_sum_meets_export_threshold_via_landuse_waiver():
    landuse = _load_osm_landuse_v5()
    bdetails = [{"zone_source": "landuse", "zone_tag": "retail"}]
    assert landuse.footprint_sum_meets_export_threshold(
        bdetails,
        50.0,
        400.0,
        min_default=400.0,
        apply_landuse_waiver=True,
    )


def test_footprint_sum_meets_export_threshold_residential_rejected():
    landuse = _load_osm_landuse_v5()
    bdetails = [{"zone_source": "landuse", "zone_tag": "residential"}]
    assert not landuse.footprint_sum_meets_export_threshold(
        bdetails,
        50.0,
        400.0,
        min_default=400.0,
        apply_landuse_waiver=True,
    )


def test_footprint_sum_meets_export_threshold_classic_sum():
    landuse = _load_osm_landuse_v5()
    bdetails = [{"zone_source": "landuse", "zone_tag": "residential"}]
    assert landuse.footprint_sum_meets_export_threshold(
        bdetails,
        500.0,
        400.0,
        min_default=400.0,
        apply_landuse_waiver=True,
    )


def test_footprint_sum_no_waiver_on_shared_candidate_threshold():
    landuse = _load_osm_landuse_v5()
    bdetails = [{"zone_source": "landuse", "zone_tag": "industrial"}]
    assert not landuse.footprint_sum_meets_export_threshold(
        bdetails,
        50.0,
        500.0,
        min_default=400.0,
        apply_landuse_waiver=False,
    )


def test_build_osm_min_footprint_filter_sql_with_waiver():
    landuse = _load_osm_landuse_v5()
    sql, params = landuse.build_osm_min_footprint_filter_sql(
        400.0,
        '"public"."osm_landuse_areas"',
    )
    assert "EXISTS" in sql
    assert "ANY(%s::text[])" in sql
    assert params[0] == 400.0
    assert set(params[1]) == {"commercial", "industrial", "retail"}


def test_build_osm_min_footprint_filter_sql_zero_disables():
    landuse = _load_osm_landuse_v5()
    sql, params = landuse.build_osm_min_footprint_filter_sql(
        0.0,
        '"public"."osm_landuse_areas"',
    )
    assert sql == ""
    assert params == ()
