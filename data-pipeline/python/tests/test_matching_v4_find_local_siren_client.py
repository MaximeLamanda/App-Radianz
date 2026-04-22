"""Client HTTP find-local-siren (mock, sans serveur Next)."""

from shapely.geometry import box

from scout_pipeline.matching_v4_find_local_siren_client import (
    FindLocalSirenMatch,
    post_find_local_siren,
    try_a1_osm_stack,
)
from scout_pipeline.matching_v4_osm_buildings import RankedOsmBuilding


def test_post_find_local_siren_parses_result():
    def fake_post(url: str, body: dict, timeout_s: float = 60.0) -> dict:
        assert "/api/find-local-siren" in url
        assert body["poiName"] == "Carrefour"
        return {
            "result": {
                "siren": "123456789",
                "siret": "12345678901234",
                "nom_complet": "CARREFOUR",
                "score": 812.5,
                "winningQuery": "Carrefour 33600",
            }
        }

    m = post_find_local_siren(
        base_url="http://localhost:3000",
        poi_name="Carrefour",
        address="12 rue X 33600 Pessac",
        lat=44.8,
        lon=-0.63,
        post_json=fake_post,
    )
    assert isinstance(m, FindLocalSirenMatch)
    assert m.siren == "123456789"
    assert m.score == 812.5
    assert m.winning_query == "Carrefour 33600"


def test_post_returns_none_on_error_field():
    def fake_post(url: str, body: dict, timeout_s: float = 60.0) -> dict:
        return {"error": "bad"}

    m = post_find_local_siren(
        base_url="http://x",
        poi_name="A",
        address="B",
        lat=1.0,
        lon=2.0,
        post_json=fake_post,
    )
    assert m is None


def test_try_a1_stops_at_first_above_min_score():
    calls: list[str] = []

    def fake_post(url: str, body: dict, timeout_s: float = 60.0) -> dict:
        calls.append(body["poiName"])
        if body["poiName"] == "Lidl":
            return {
                "result": {
                    "siren": "111111111",
                    "siret": "11111111111111",
                    "nom_complet": "LIDL",
                    "score": 200.0,
                    "winningQuery": "q1",
                }
            }
        return {
            "result": {
                "siren": "222222222",
                "siret": "22222222222222",
                "nom_complet": "LECLERC",
                "score": 900.0,
                "winningQuery": "q2",
            }
        }

    g = box(0, 0, 1, 1)
    ranked = [
        RankedOsmBuilding("Lidl", g, 1.0, 0.1),
        RankedOsmBuilding("Leclerc", g, 1.0, 0.2),
    ]
    match, tries = try_a1_osm_stack(
        ranked_osm=ranked,
        address="Rue test 33000",
        lat=44.0,
        lon=-0.5,
        base_url="http://localhost",
        min_score=400.0,
        post_json=fake_post,
    )
    assert tries == 2
    assert match is not None
    assert match.siren == "222222222"
    assert calls == ["Lidl", "Leclerc"]
