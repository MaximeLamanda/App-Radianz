"""Tests agrégats combo Discovery (surface dédupliquée, waiver landuse)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_discovery_combos_v5():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "discovery_combos_v5.py"
    spec = importlib.util.spec_from_file_location("discovery_combos_v5_test", mod_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["discovery_combos_v5_test"] = mod
    spec.loader.exec_module(mod)
    return mod


def _parcelle(
    scout_v5_id: str,
    *,
    buildings_json: str = "[]",
    footprint_sum_m2: float = 0,
    section: str = "A",
    numero_norm: str = "0001",
) -> dict:
    return {
        "scout_v5_id": scout_v5_id,
        "code_insee": "33318",
        "section": section,
        "numero_norm": numero_norm,
        "footprint_sum_m2": footprint_sum_m2,
        "buildings_json": buildings_json,
        "building_geometries_json": "[]",
        "properties_json": {},
    }


def test_combo_footprint_dedup_shared_bc_684():
    dc = _load_discovery_combos_v5()
    shared_bc = "bc-shared"
    p1 = _parcelle(
        "p1",
        footprint_sum_m2=551,
        buildings_json=(
            f'[{{"batiment_construction_id":"{shared_bc}","footprint_m2":551,'
            '"matching_status":"partage"}]'
        ),
    )
    p2 = _parcelle(
        "p2",
        section="B",
        numero_norm="0002",
        footprint_sum_m2=684,
        buildings_json=(
            f'[{{"batiment_construction_id":"{shared_bc}","footprint_m2":551,"matching_status":"partage"}},'
            '{"batiment_construction_id":"bc-other","footprint_m2":133,"matching_status":"partage"}]'
        ),
    )
    records = dc.build_combo_records_for_commune([p1, p2])
    assert len(records) == 1
    assert records[0]["footprint_sum_m2"] == 684


def test_isolated_parcelle_combo_id():
    dc = _load_discovery_combos_v5()
    p3 = _parcelle("p3", section="C", numero_norm="0003")
    records = dc.build_combo_records_for_commune([p3])
    assert len(records) == 1
    assert records[0]["combo_id"] == "combo:p3"


def test_waiver_industrial_below_400():
    dc = _load_discovery_combos_v5()
    p1 = _parcelle(
        "p1",
        footprint_sum_m2=50,
        buildings_json='[{"batiment_construction_id":"bc-1","footprint_m2":50,'
        '"zone_source":"landuse","zone_tag":"industrial"}]',
    )
    records = dc.build_combo_records_for_commune([p1])
    assert records[0]["has_landuse_waiver"] is True
    assert records[0]["footprint_sum_m2"] == 50


def test_combo_zone_tags_union():
    dc = _load_discovery_combos_v5()
    json_shared = '[{"batiment_construction_id":"bc-x","matching_status":"partage","zone_tag":"industrial"}]'
    p1 = _parcelle("p1", buildings_json=json_shared)
    p2 = _parcelle(
        "p2",
        section="B",
        numero_norm="0002",
        buildings_json=(
            '[{"batiment_construction_id":"bc-x","matching_status":"partage","zone_tag":"retail"},'
            '{"batiment_construction_id":"bc-y","zone_tag":"commercial"}]'
        ),
    )
    records = dc.build_combo_records_for_commune([p1, p2])
    assert len(records) == 1
    assert records[0]["zone_tags"] == ["commercial", "industrial", "retail"]


def test_combo_construction_years_union():
    dc = _load_discovery_combos_v5()
    p1 = _parcelle(
        "p1",
        buildings_json='[{"batiment_construction_id":"bc-1","annee_construction":1998}]',
    )
    p2 = _parcelle(
        "p2",
        section="B",
        numero_norm="0002",
        buildings_json='[{"batiment_construction_id":"bc-2","annee_construction":2012}]',
    )
    records = dc.build_combo_records_for_commune([p1, p2])
    assert len(records) == 2
    years = sorted({y for r in records for y in r["construction_years"]})
    assert years == [1998, 2012]


def _buildings_with_parkings(parkings_json: list[dict]) -> str:
    import json

    return json.dumps(
        [
            {
                "batiment_construction_id": "bc-1",
                "parkings_json": parkings_json,
            }
        ],
        ensure_ascii=False,
    )


def test_combo_parking_sum_dedup_same_parking():
    dc = _load_discovery_combos_v5()
    import json

    parking = {
        "osm_parking_type": "w",
        "osm_parking_id": 1,
        "parking_area_m2": 1200.0,
        "parking_parcels_json": [],
        "common_parcels_json": [],
        "charging_stations_json": [],
    }
    # Deux bâtiments sur la même parcelle avec le même parking → une seule fois.
    bj = json.dumps(
        [
            {"batiment_construction_id": "bc-1", "parkings_json": [parking]},
            {"batiment_construction_id": "bc-2", "parkings_json": [parking]},
        ],
        ensure_ascii=False,
    )
    records = dc.build_combo_records_for_commune([_parcelle("p1", buildings_json=bj)])
    assert len(records) == 1
    assert records[0]["parking_sum_m2"] == 1200.0


def test_combo_parking_sum_two_distinct():
    dc = _load_discovery_combos_v5()
    bj = _buildings_with_parkings(
        [
            {"osm_parking_type": "w", "osm_parking_id": 1, "parking_area_m2": 800.0},
            {"osm_parking_type": "w", "osm_parking_id": 2, "parking_area_m2": 500.0},
        ]
    )
    records = dc.build_combo_records_for_commune([_parcelle("p1", buildings_json=bj)])
    assert records[0]["parking_sum_m2"] == 1300.0


def test_combo_parking_sum_zero_without_parking():
    dc = _load_discovery_combos_v5()
    records = dc.build_combo_records_for_commune([_parcelle("p1")])
    assert records[0]["parking_sum_m2"] == 0.0


def test_combo_parcel_contour_sum_two_parcelles():
    dc = _load_discovery_combos_v5()
    # Carré ~111 m de côté à l’équateur (~12 300 m²)
    square = {
        "type": "Polygon",
        "coordinates": [
            [
                [0.0, 0.0],
                [0.001, 0.0],
                [0.001, 0.001],
                [0.0, 0.001],
                [0.0, 0.0],
            ]
        ],
    }
    p1 = _parcelle("p1", footprint_sum_m2=100)
    p1["geom_geojson"] = square
    p2 = _parcelle("p2", section="B", numero_norm="0002", footprint_sum_m2=200)
    p2["geom_geojson"] = square
    records = dc.build_combo_records_for_commune([p1, p2])
    assert len(records) == 2
    for rec in records:
        assert rec["parcel_contour_sum_m2"] > 10_000


def test_partage_two_parcelles_same_combo():
    dc = _load_discovery_combos_v5()
    json_a = '[{"batiment_construction_id":"bc-x","matching_status":"partage"}]'
    p1 = _parcelle("p1", buildings_json=json_a)
    p2 = _parcelle("p2", section="B", numero_norm="0002", buildings_json=json_a)
    index = dc.build_parcelle_combo_index([p1, p2])
    assert index["p1"] == "combo:p1|p2"
    assert index["p2"] == "combo:p1|p2"


def test_naf_division_from_ape():
    dc = _load_discovery_combos_v5()
    assert dc.naf_division_from_ape("47.11F") == "47"
    assert dc.naf_division_from_ape("  68.20B ") == "68"
    assert dc.naf_division_from_ape("") is None
    assert dc.naf_division_from_ape("X47") is None


def test_combo_owner_and_domiciliation_sirens_union():
    import json

    dc = _load_discovery_combos_v5()
    p1 = _parcelle("p1")
    p1["passerelle_addresses_json"] = json.dumps(
        [{"siren": "111111111", "denomination": "Owner A"}],
        ensure_ascii=False,
    )
    p1["sirets_json"] = json.dumps(
        [
            {
                "siret": "11111111100001",
                "siren": "222222222",
                "activite_principale": "47.11F",
            }
        ],
        ensure_ascii=False,
    )
    p2 = _parcelle("p2", section="B", numero_norm="0002")
    p2["passerelle_addresses_json"] = json.dumps(
        [{"siren": "333333333"}],
        ensure_ascii=False,
    )
    p2["sirets_json"] = json.dumps(
        [
            {
                "siret": "33333333300001",
                "siren": "222222222",
                "activite_principale": "68.20B",
            }
        ],
        ensure_ascii=False,
    )
    records = dc.build_combo_records_for_commune([p1, p2])
    assert len(records) == 2
    r1 = next(r for r in records if r["combo_id"] == "combo:p1")
    assert r1["owner_sirens"] == ["111111111"]
    assert r1["domiciliation_sirens"] == ["222222222"]
    assert r1["naf_divisions"] == ["47"]
    r2 = next(r for r in records if r["combo_id"] == "combo:p2")
    assert r2["owner_sirens"] == ["333333333"]
    assert r2["naf_divisions"] == ["68"]
