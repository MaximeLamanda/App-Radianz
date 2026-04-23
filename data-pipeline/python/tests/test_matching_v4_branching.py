"""Branches A2/B1/B2/0 + fallback C1/C2 (tests mockés)."""

from scout_pipeline.matching_v4_branching import (
    resolve_a2_branches,
)
from scout_pipeline.matching_v4_find_local_siren_client import FindLocalSirenMatch


def test_a2_single_address_result_no_google(monkeypatch):
    def fake_get(url: str, timeout_s: float) -> dict:
        assert "recherche-entreprises.api.gouv.fr/search" in url
        return {
            "results": [
                {
                    "siren": "123456789",
                    "siret": "12345678900011",
                    "nom_complet": "ALPHA",
                    "adresse": "x",
                    "code_postal": "33000",
                }
            ]
        }

    def fail_google(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("Google ne doit pas être appelé en cas unique")

    monkeypatch.setattr("scout_pipeline.matching_v4_branching.run_google_c1_c2_fallback", fail_google)

    out = resolve_a2_branches(
        address="12 rue X 33000 Bordeaux",
        lat=44.0,
        lon=-0.5,
        find_local_siren_base_url="http://localhost:3000",
        google_api_key="k",
        get_json=fake_get,
    )
    assert out.match_path == "A2_ADDR_SINGLE"
    assert out.siren == "123456789"
    assert out.entreprises_a_adresse_count == 1
    assert out.fallback_google_used is False


def test_a2_multi_calls_google_fallback(monkeypatch):
    def fake_get(url: str, timeout_s: float) -> dict:
        if "recherche-entreprises.api.gouv.fr/search" in url:
            return {
                "results": [
                    {"siren": "111111111", "siret": "11111111100011"},
                    {"siren": "222222222", "siret": "22222222200022"},
                ]
            }
        return {"status": "OK", "results": []}

    def fake_fallback(**kwargs):  # noqa: ANN003
        return (
            FindLocalSirenMatch(
                siren="333333333",
                siret="33333333300033",
                nom_complet="BETA",
                score=750.0,
                winning_query="q",
            ),
            "Carrefour",
        )

    monkeypatch.setattr("scout_pipeline.matching_v4_branching.run_google_c1_c2_fallback", fake_fallback)

    out = resolve_a2_branches(
        address="x",
        lat=44.0,
        lon=-0.5,
        find_local_siren_base_url="http://localhost:3000",
        google_api_key="k",
        get_json=fake_get,
    )
    assert out.match_path == "A2_ADDR_MULTI_GOOGLE"
    assert out.entreprises_a_adresse_count == 2
    assert out.fallback_google_used is True
    assert out.siren == "333333333"
    assert out.primary_poi_name == "Carrefour"


def test_a2_zero_calls_google_fallback(monkeypatch):
    def fake_get(url: str, timeout_s: float) -> dict:
        return {"results": []}

    monkeypatch.setattr(
        "scout_pipeline.matching_v4_branching.run_google_c1_c2_fallback",
        lambda **kwargs: (None, None),  # noqa: ARG005
    )

    out = resolve_a2_branches(
        address="x",
        lat=44.0,
        lon=-0.5,
        find_local_siren_base_url="http://localhost:3000",
        google_api_key="k",
        get_json=fake_get,
    )
    assert out.match_path == "A2_ADDR_ZERO_GOOGLE"
    assert out.entreprises_a_adresse_count == 0
    assert out.fallback_google_used is True
    assert out.siren is None
