from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_matching_v5_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "data-pipeline" / "matching_v5" / "run_matching_v5.py"
    spec = importlib.util.spec_from_file_location("run_matching_v5", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parcel_pk_to_group_id_transitive_chain():
    mod = _load_matching_v5_module()
    exported = {
        ("33318", "S", "0001"),
        ("33318", "S", "0002"),
        ("33318", "S", "0003"),
    }
    by_building = {
        "bat-1": [
            {"code_insee": "33318", "section": "S", "numero_norm": "0001"},
            {"code_insee": "33318", "section": "S", "numero_norm": "0002"},
        ],
        "bat-2": [
            {"code_insee": "33318", "section": "S", "numero_norm": "0002"},
            {"code_insee": "33318", "section": "S", "numero_norm": "0003"},
        ],
    }
    m = mod.parcel_pk_to_group_id(exported, by_building)
    gids = {m[pk] for pk in exported}
    assert len(gids) == 1
    assert len(next(iter(gids))) == 3
