"""Tests — module enr_parking_v5."""

import importlib.util
import os
import sys
from pathlib import Path


def _load():
    repo_root = Path(__file__).resolve().parents[3]
    mod_path = repo_root / "data-pipeline" / "matching_v5" / "enr_parking_v5.py"
    spec = importlib.util.spec_from_file_location("enr_parking_v5", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["enr_parking_v5"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_qualified_enr_parking_table_default():
    os.environ.pop("ENR_PARKING_TABLE", None)
    m = _load()
    assert m.qualified_enr_parking_table() == '"public"."enr_parking_areas"'


def test_stable_enr_id_deterministic():
    m = _load()
    wkt = "MULTIPOLYGON(((0 0,1 0,1 1,0 0)))"
    a = m.stable_enr_id("33318", 1200, wkt)
    b = m.stable_enr_id("33318", 1200, wkt)
    assert a == b
    assert a != m.stable_enr_id("33318", 1201, wkt)


def test_enr_tags_from_row():
    m = _load()
    tags = m.enr_tags_from_row(
        {"Surfm2": 800, "NomCom": "Pessac", "TYPE": "Parking", "NumCom": "33318"}
    )
    assert tags["surface_m2"] == 800
    assert tags["name"] == "Pessac"
