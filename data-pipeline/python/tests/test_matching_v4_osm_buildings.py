"""Tri intersection / distance pour candidats OSM nommés (matching V4)."""

from shapely.geometry import box

from scout_pipeline.matching_v4_osm_buildings import (
    centroid_distance_m,
    intersection_area_m2,
    rank_osm_named_buildings_for_footprint,
)


def test_intersection_area_two_overlaps():
    bdnb = box(0, 0, 10, 10)
    # Grande intersection : 8x8 ∩ 10x10 = 64
    big = box(0, 0, 8, 8)
    # Petite : 5,5 à 20,20 → intersection 5x5 = 25
    small = box(5, 5, 20, 20)
    assert intersection_area_m2(bdnb, big) == 64.0
    assert intersection_area_m2(bdnb, small) == 25.0


def test_centroid_distance_order():
    bdnb = box(0, 0, 10, 10)
    near = box(4, 4, 6, 6)
    far = box(100, 100, 101, 101)
    assert centroid_distance_m(bdnb, near) < centroid_distance_m(bdnb, far)


def test_rank_prefers_larger_intersection_then_closer_centroid():
    bdnb = box(0, 0, 10, 10)
    # Même aire d’intersection 25 m² : départager par distance centroïde ↔ centroïde emprise.
    a = box(0, 0, 5, 5)
    b = box(4, 0, 9, 5)
    assert intersection_area_m2(bdnb, a) == intersection_area_m2(bdnb, b) == 25.0
    assert centroid_distance_m(bdnb, b) < centroid_distance_m(bdnb, a)

    osm = [
        {"name": "FarCorner", "geometry": a},
        {"name": "CloserShift", "geometry": b},
    ]
    ranked = rank_osm_named_buildings_for_footprint(bdnb, osm)
    assert [r.name for r in ranked] == ["CloserShift", "FarCorner"]


def test_rank_by_area_first():
    bdnb = box(0, 0, 10, 10)
    large = box(0, 0, 9, 9)  # aire intersection 81
    small = box(0, 0, 4, 4)  # 16
    osm = [
        {"name": "Small", "geometry": small},
        {"name": "Large", "geometry": large},
    ]
    ranked = rank_osm_named_buildings_for_footprint(bdnb, osm)
    assert ranked[0].name == "Large"
    assert ranked[1].name == "Small"


def test_skips_unnamed_or_non_intersecting():
    bdnb = box(0, 0, 2, 2)
    osm = [
        {"name": "", "geometry": box(0, 0, 1, 1)},
        {"name": "X", "geometry": box(10, 10, 11, 11)},
        {"name": "OK", "geometry": box(0, 0, 1, 1)},
    ]
    ranked = rank_osm_named_buildings_for_footprint(bdnb, osm)
    assert len(ranked) == 1
    assert ranked[0].name == "OK"
