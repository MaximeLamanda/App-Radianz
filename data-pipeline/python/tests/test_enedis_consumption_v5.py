"""Tests enedis_consumption_v5."""

from __future__ import annotations

import sys
from pathlib import Path

MATCHING_V5 = Path(__file__).resolve().parents[2] / "matching_v5"
if str(MATCHING_V5) not in sys.path:
    sys.path.insert(0, str(MATCHING_V5))

from enedis_consumption_v5 import (  # noqa: E402
    accept_geocode_hit,
    build_ods_where_communes,
    format_address_label,
    is_valid_wgs84,
    parse_record_row,
    site_id_from_record,
)
from geoplateforme_geocode import GeoplateformeAddressHit  # noqa: E402


def test_format_address_label():
    label = format_address_label(
        {
            "numero_de_voie": "12",
            "type_de_voie": "RUE",
            "libelle_de_voie": "TEST",
            "nom_commune": "Pessac",
        }
    )
    assert label == "12 RUE TEST Pessac"


def test_site_id_stable():
    sid = site_id_from_record(
        {"code_commune": "33318", "annee": "2024", "tri_des_adresses": 42}
    )
    assert sid == "33318:2024:42"


def test_build_ods_where():
    w = build_ods_where_communes(["33318", "33063"], "2024")
    assert "33318" in w and "annee = '2024'" in w


def test_parse_record_row():
    row = parse_record_row(
        {
            "code_commune": "33318",
            "annee": "2024",
            "consommation_annuelle_totale_de_ladresse_mwh": 10.5,
            "adresse": "ZONE INDUSTRIELLE",
            "nom_commune": "Pessac",
            "tri_des_adresses": 1,
        }
    )
    assert row is not None
    assert row["mwh"] == 10.5


def test_accept_geocode_hit():
    hit = GeoplateformeAddressHit(
        label="x",
        score=0.9,
        distance_m=None,
        citycode="33318",
        result_type="street",
        lon=-0.6,
        lat=44.8,
        street="",
        housenumber="",
        postcode="",
        city="Pessac",
    )
    assert accept_geocode_hit(hit, "33318") is True
    assert is_valid_wgs84(44.8, -0.6) is True
