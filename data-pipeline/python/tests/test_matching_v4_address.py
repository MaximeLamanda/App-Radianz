"""Résolution d'adresse A2 : BDNB prioritaire, BAN en repli."""

from scout_pipeline.matching_v4_address import (
    extract_bdnb_address,
    resolve_building_address,
)


def test_extract_bdnb_address_from_structured_fields():
    row = {
        "numero_voie": "12",
        "nom_voie": "Rue des Fleurs",
        "code_postal": "33000",
        "nom_commune": "Bordeaux",
    }
    addr = extract_bdnb_address(row)
    assert addr == "12 Rue des Fleurs, 33000 Bordeaux"


def test_resolve_prefers_bdnb_without_ban_call():
    called = {"n": 0}

    def fake_get(url: str, timeout_s: float) -> dict:
        called["n"] += 1
        return {}

    row = {"adresse": "5 avenue Test, 33600 Pessac"}
    out = resolve_building_address(
        row=row,
        fallback_lat=44.8,
        fallback_lon=-0.6,
        get_json=fake_get,
    )
    assert out is not None
    assert out.source == "bdnb"
    assert "Pessac" in out.full_address
    assert called["n"] == 0


def test_resolve_falls_back_to_ban():
    def fake_get(url: str, timeout_s: float) -> dict:
        assert "api-adresse.data.gouv.fr/reverse" in url
        return {
            "features": [
                {
                    "properties": {
                        "label": "8 Rue André Pujol 33600 Pessac",
                    }
                }
            ]
        }

    out = resolve_building_address(
        row={},
        fallback_lat=44.81,
        fallback_lon=-0.62,
        get_json=fake_get,
    )
    assert out is not None
    assert out.source == "ban"
    assert out.full_address == "8 Rue André Pujol 33600 Pessac"
