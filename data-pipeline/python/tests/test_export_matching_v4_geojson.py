"""Smoke / régression export CSV → GeoJSON matching V4."""

import json
from pathlib import Path

import pandas as pd

from scout_pipeline.export_matching_v4_geojson import _csv_row_to_feature_properties, export_merged_geojson


def test_csv_row_propagates_v4_trace_fields():
    row = {
        "batiment_id": "bg1",
        "footprint_path": "p0",
        "area_m2": 100,
        "match_path": "A1_OSM",
        "address_used_source": "bdnb",
        "entreprises_a_adresse_count": 2,
        "osm_candidates_tried": 3,
    }
    props = _csv_row_to_feature_properties(row)
    assert props["match_path"] == "A1_OSM"
    assert props["address_used_source"] == "bdnb"
    assert props["entreprises_a_adresse_count"] == 2
    assert props["osm_candidates_tried"] == 3


def test_csv_row_omits_empty_v4_fields():
    row = {"batiment_id": "x", "footprint_path": "", "area_m2": 1}
    props = _csv_row_to_feature_properties(row)
    assert "match_path" not in props
    assert "address_used_source" not in props
    assert "entreprises_a_adresse_count" not in props
    assert "osm_candidates_tried" not in props


def test_export_merged_one_feature(tmp_path: Path):
    base = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                },
                "properties": {
                    "batiment_groupe_id": "B1",
                    "footprint_path": "fp1",
                    "lead_id": "00000000-0000-5000-8000-000000000001",
                },
            }
        ],
    }
    base_path = tmp_path / "base.geojson"
    base_path.write_text(json.dumps(base), encoding="utf-8")

    csv_path = tmp_path / "m.csv"
    pd.DataFrame(
        [
            {
                "batiment_id": "B1",
                "footprint_path": "fp1",
                "area_m2": 50,
                "match_path": "A2_ADDR_SINGLE",
                "entreprises_a_adresse_count": 1,
            }
        ]
    ).to_csv(csv_path, index=False)

    out_path = tmp_path / "out.geojson"
    n, miss, skip = export_merged_geojson(
        matches_csv=csv_path,
        base_geojson=base_path,
        out_geojson=out_path,
        keep_bdnb_staging=False,
        keep_base_pois=False,
    )
    assert n == 1 and miss == 0 and skip == 0
    fc = json.loads(out_path.read_text(encoding="utf-8"))
    p0 = fc["features"][0]["properties"]
    assert p0["match_path"] == "A2_ADDR_SINGLE"
    assert p0["entreprises_a_adresse_count"] == 1
    assert p0["batiment_groupe_id"] == "B1"
