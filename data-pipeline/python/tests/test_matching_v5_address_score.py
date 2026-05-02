from __future__ import annotations

import importlib.util
from pathlib import Path

from scout_pipeline.address_normalization import normalize_indice_for_match, street_number_match_set


def _load_matching_v5_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "data-pipeline" / "matching_v5" / "run_matching_v5.py"
    spec = importlib.util.spec_from_file_location("run_matching_v5", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_street_number_match_set_range():
    assert street_number_match_set("12-14") == frozenset({"12", "14"})
    assert street_number_match_set("12") == frozenset({"12"})
    assert street_number_match_set("") == frozenset()
    assert street_number_match_set(None) == frozenset()


def test_normalize_indice_for_match():
    assert normalize_indice_for_match("B") == "BIS"
    assert normalize_indice_for_match("bis") == "BIS"
    assert normalize_indice_for_match("T") == "TER"
    assert normalize_indice_for_match("A") == ""
    assert normalize_indice_for_match("") == ""


def test_score_numero_mismatch_penalty_not_reject():
    mod = _load_matching_v5_module()
    score, reason = mod._score_etablissement_candidate(
        nums_query=frozenset({"10"}),
        indice_query="",
        voie_query="FOCH",
        commune_query="PESSAC",
        cp_query="",
        numero_db="99",
        indice_db="",
        voie_db="FOCH",
        commune_db="PESSAC",
        cp_db="",
    )
    assert "numero_mismatch" in reason
    assert score < 52.0


def test_score_indice_mismatch_penalty_not_reject():
    mod = _load_matching_v5_module()
    score, reason = mod._score_etablissement_candidate(
        nums_query=frozenset({"10"}),
        indice_query="BIS",
        voie_query="FOCH",
        commune_query="PESSAC",
        cp_query="",
        numero_db="10",
        indice_db="TER",
        voie_db="FOCH",
        commune_db="PESSAC",
        cp_db="",
    )
    assert "indice_mismatch" in reason
    assert "numero_match" in reason


def test_score_avec_numero_passerelle_et_etab():
    mod = _load_matching_v5_module()
    score, reason = mod._score_etablissement_candidate(
        nums_query=frozenset({"10"}),
        indice_query="",
        voie_query="FOCH",
        commune_query="PESSAC",
        cp_query="33600",
        numero_db="10",
        indice_db="",
        voie_db="FOCH",
        commune_db="PESSAC",
        cp_db="33600",
    )
    assert "voie_exacte" in reason
    assert "numero_match" in reason
    assert score >= 52.0


def test_score_match_numero_ok():
    mod = _load_matching_v5_module()
    score, reason = mod._score_etablissement_candidate(
        nums_query=frozenset({"10", "12"}),
        indice_query="BIS",
        voie_query="FOCH",
        commune_query="PESSAC",
        cp_query="",
        numero_db="12",
        indice_db="BIS",
        voie_db="FOCH",
        commune_db="PESSAC",
        cp_db="",
    )
    assert score >= 55.0
    assert "numero_match" in reason
    assert "indice_match" in reason


def test_numero_leading_zeros_tier():
    mod = _load_matching_v5_module()
    assert mod._numero_match_tier(frozenset({"8"}), "008") == "numero_leading_zeros"


def test_voie_fuzzy_avec_numero():
    mod = _load_matching_v5_module()
    score, reason = mod._score_etablissement_candidate(
        nums_query=frozenset({"5"}),
        indice_query="",
        voie_query="DE LA REPUBLIQUE",
        commune_query="PESSAC",
        cp_query="",
        numero_db="5",
        indice_db="",
        voie_db="REPUBLIQUE",
        commune_db="PESSAC",
        cp_db="",
    )
    assert "voie_fuzzy_" in reason or "voie_partielle" in reason
    assert "numero_match" in reason
    assert score >= 52.0


def test_match_etablissements_no_passerelle_numero():
    mod = _load_matching_v5_module()
    out = mod.match_etablissements_for_parcel(
        {},
        [],
        {
            "passerelle_address": "RUE FOCH, PESSAC",
            "passerelle_voie_norm": "FOCH",
            "passerelle_commune_norm": "PESSAC",
            "passerelle_numero_match_set": tuple(),
        },
    )
    assert out["status_technique"] == "no_passerelle_numero"
    assert out["siret_count"] == 0
