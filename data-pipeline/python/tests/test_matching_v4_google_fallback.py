"""Fallback C1/C2 Google Nearby + find-local-siren."""

from scout_pipeline.matching_v4_find_local_siren_client import FindLocalSirenMatch
from scout_pipeline.matching_v4_google_fallback import run_google_c1_c2_fallback


def test_c1_c2_google_then_find_local_siren(monkeypatch):
    def fake_get(url: str, timeout_s: float) -> dict:
        assert "maps.googleapis.com/maps/api/place/nearbysearch/json" in url
        return {
            "status": "OK",
            "results": [
                {
                    "name": "POI A",
                    "geometry": {"location": {"lat": 44.1, "lng": -0.61}},
                },
                {
                    "name": "POI B",
                    "geometry": {"location": {"lat": 44.2, "lng": -0.62}},
                },
            ],
        }

    calls: list[str] = []

    def fake_post_find_local_siren(**kwargs):  # noqa: ANN003
        calls.append(kwargs["poi_name"])
        if kwargs["poi_name"] == "POI A":
            return None
        return FindLocalSirenMatch(
            siren="999999999",
            siret="99999999900099",
            nom_complet="GAMMA",
            score=900.0,
            winning_query="q2",
        )

    monkeypatch.setattr("scout_pipeline.matching_v4_google_fallback.post_find_local_siren", fake_post_find_local_siren)

    m, poi_name = run_google_c1_c2_fallback(
        find_local_siren_base_url="http://localhost:3000",
        api_key="x",
        address="adresse",
        lat=44.0,
        lon=-0.5,
        radius_m=150.0,
        get_json=fake_get,
        min_score=100.0,
    )
    assert m is not None
    assert m.siren == "999999999"
    assert poi_name == "POI B"
    assert calls == ["POI A", "POI B"]
