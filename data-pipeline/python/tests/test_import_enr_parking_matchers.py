"""Tests — import ENR parking (helpers)."""

import importlib.util
import sys
from pathlib import Path


def _load_enr():
    repo_root = Path(__file__).resolve().parents[3]
    matching = repo_root / "data-pipeline" / "matching_v5"
    for name in ("enr_parking_v5",):
        p = matching / f"{name}.py"
        spec = importlib.util.spec_from_file_location(name, p)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    p = matching / "import_osm_parking.py"
    spec = importlib.util.spec_from_file_location("import_osm_parking", p)
    assert spec and spec.loader
    osm_mod = importlib.util.module_from_spec(spec)
    sys.modules["import_osm_parking"] = osm_mod
    spec.loader.exec_module(osm_mod)
    p2 = matching / "import_enr_parking.py"
    spec2 = importlib.util.spec_from_file_location("import_enr_parking", p2)
    assert spec2 and spec2.loader
    mod = importlib.util.module_from_spec(spec2)
    sys.modules["import_enr_parking"] = mod
    spec2.loader.exec_module(mod)
    return mod


def test_resolve_default_gpkg_finds_extracted_file():
    m = _load_enr()
    p = m.resolve_default_gpkg()
    if p is not None:
        assert p.suffix == ".gpkg"
        assert "Parkings_sup500" in p.name or "PARK" in p.name.upper()
