"""Fusionne un CSV de résultats matching V4 avec un GeoJSON d’emprises BDNB (sans PostgreSQL).

Couche « propriétés + polygone » : le CSV `building_matches_v4.csv` est produit par ton
outil amont ; ce module le joint à un GeoJSON de base déjà géoréférencé (colonnes attendues
déduites du schéma d’export ci-dessous, `matching_v4_geojson_export_v1`).

**Schéma CSV / propriétés (union)** — champs existants (stub / matching) + traçabilité V4
optionnelle (ignorés s’absents du CSV) :

- Identité / POI : ``batiment_id``, ``footprint_path``, ``area_m2``, ``primary_poi_*``,
  ``nb_poi_detected``, ``multi_tenant``, ``siren``, ``siret``, scores fuzzy / adresse /
  cadastre, ``siren_alt_list``, ``fallback_google_used``, ``address_lookup_status``,
  ``building_address_ban``, champs consommation / Enedis (voir ``_csv_row_to_feature_properties``).
- **V4 traçabilité** : ``match_path`` (ex. ``A1_OSM``, ``A2_ADDR_SINGLE``),
  ``address_used_source`` (``bdnb`` | ``ban``), ``entreprises_a_adresse_count`` (entier),
  ``osm_candidates_tried`` (nombre d’essais OSM dans la pile A1).

Options :
- ``--keep-bdnb-staging`` : recopie ``bdnb_staging`` depuis le GeoJSON de base.
- ``--keep-base-pois`` : recopie la liste ``pois`` (échantillon Google / SIRENE du fichier
  de base), souvent lourd.

Usage (racine du dépôt) ::
    python -m scout_pipeline.export_matching_v4_geojson \\
      --matches-csv data-pipeline/out/matching/v4/building_matches_v4.csv \\
      --base-geojson data-pipeline/out/scout_bdnb_poi_sample_33318.geojson \\
      --out-geojson data-pipeline/out/matching/v4/scout_matching_v4_33318.geojson
"""

from __future__ import annotations

import argparse
import ast
import json
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd


def _json_sanitize(obj: Any) -> Any:
    """Remplace NaN/NA par null pour un GeoJSON strictement valide (JSON.parse côté Node)."""
    if isinstance(obj, dict):
        return {k: _json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_sanitize(x) for x in obj]
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (int, str)):
        return obj
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    try:
        if pd.isna(obj):
            return None
    except (TypeError, ValueError):
        pass
    return obj


def _row_key(batiment_id: str, footprint_path: str) -> str:
    return f"{batiment_id}|{footprint_path or ''}"


def _normalize_siren(raw: Any) -> str:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    if re.fullmatch(r"-?\d+(\.0+)?", s):
        try:
            n = int(round(float(s)))
            if 100_000_000 <= n <= 999_999_999:
                return str(n)
        except (TypeError, ValueError):
            pass
    digits = re.sub(r"\D", "", s)
    return digits if len(digits) == 9 else ""


def _parse_siren_alt_list(raw: Any) -> list[str]:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return []
    t = str(raw).strip()
    if not t or t == "[]":
        return []
    try:
        arr = ast.literal_eval(t)
    except (SyntaxError, ValueError):
        try:
            arr = json.loads(t.replace("'", '"'))
        except json.JSONDecodeError:
            return []
    if not isinstance(arr, list):
        return []
    out: list[str] = []
    for x in arr:
        n = _normalize_siren(x)
        if n:
            out.append(n)
    return out


def _parse_yearly_consumption(raw: Any) -> dict[str, float]:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return {}
    t = str(raw).strip()
    if not t:
        return {}
    try:
        obj = json.loads(t)
    except json.JSONDecodeError:
        return {}
    if not isinstance(obj, dict):
        return {}
    out: dict[str, float] = {}
    for k, v in obj.items():
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out[str(k)] = n
    return out


def _optional_int_non_negative(v: Any) -> int | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        n = int(float(str(v).replace(",", ".").strip()))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _csv_row_to_feature_properties(row: dict[str, Any]) -> dict[str, Any]:
    """Schéma GeoJSON stable (champs snake_case, alignés sur l’ancien export V3 + champs V4 optionnels)."""
    siren = _normalize_siren(row.get("siren"))
    siret = str(row.get("siret") or "").strip()
    out: dict[str, Any] = {
        "batiment_groupe_id": str(row.get("batiment_id") or "").strip(),
        "footprint_path": str(row.get("footprint_path") or "").strip(),
        "area_m2": float(row.get("area_m2") or 0) or 0.0,
        "primary_poi_id": str(row.get("primary_poi_id") or "").strip() or None,
        "primary_poi_name": str(row.get("primary_poi_name") or "").strip() or None,
        "primary_poi_osm_building": str(row.get("primary_poi_osm_building") or "").strip() or None,
        "primary_poi_score": float(row.get("primary_poi_score") or 0) or 0.0,
        "primary_poi_source": str(row.get("primary_poi_source") or "").strip() or None,
        "nb_poi_detected": int(float(str(row.get("nb_poi_detected") or 0).replace(",", ".")) or 0),
        "multi_tenant": str(row.get("multi_tenant") or "").lower() in ("true", "1", "t"),
        "siren": siren or None,
        "siret": siret or None,
        "match_confidence_score": float(row.get("match_confidence_score") or 0) or 0.0,
        "fuzzy_score_nom": float(row.get("fuzzy_score_nom") or 0) or 0.0,
        "score_adresse": float(row.get("score_adresse") or 0) or 0.0,
        "coherence_cadastre": float(row.get("coherence_cadastre") or 0) or 0.0,
        "siren_alt_list": _parse_siren_alt_list(row.get("siren_alt_list")),
        "fallback_google_used": str(row.get("fallback_google_used") or "").lower() in ("true", "1", "t"),
        "address_lookup_status": str(row.get("address_lookup_status") or "").strip() or None,
        "building_address_ban": str(row.get("building_address_ban") or "").strip() or None,
        "consumption_annual_mwh": float(row.get("consumption_annual_mwh") or 0) or 0.0,
        "consumption_match_method": str(row.get("consumption_match_method") or "").strip() or None,
        "consumption_match_confidence": float(row.get("consumption_match_confidence") or 0) or 0.0,
        "consumption_geocode_lat": _optional_float_latlng(row.get("consumption_geocode_lat")),
        "consumption_geocode_lng": _optional_float_latlng(row.get("consumption_geocode_lng")),
        "consumption_geocode_distance_m": float(row.get("consumption_geocode_distance_m") or 0) or 0.0,
        "consumption_matched_address_raw": str(row.get("consumption_matched_address_raw") or "").strip() or None,
        "consumption_match_status": str(row.get("consumption_match_status") or "").strip() or None,
        "consumption_annual_mwh_by_year": _parse_yearly_consumption(row.get("consumption_annual_mwh_by_year")),
        "enedis_tri_des_adresses": str(row.get("enedis_tri_des_adresses") or "").strip() or None,
        "enedis_code_iris": str(row.get("enedis_code_iris") or "").strip() or None,
        "enedis_code_secteur_naf2": str(row.get("enedis_code_secteur_naf2") or "").strip() or None,
        "enedis_nombre_de_sites": int(float(str(row.get("enedis_nombre_de_sites") or 0).replace(",", ".")) or 0)
        or None,
        "enedis_nombre_de_sites_max": int(float(str(row.get("enedis_nombre_de_sites_max") or 0).replace(",", ".")) or 0)
        or None,
    }

    mp = str(row.get("match_path") or "").strip()
    if mp:
        out["match_path"] = mp
    aus = str(row.get("address_used_source") or "").strip().lower()
    if aus in ("bdnb", "ban"):
        out["address_used_source"] = aus
    eac = _optional_int_non_negative(row.get("entreprises_a_adresse_count"))
    if eac is not None:
        out["entreprises_a_adresse_count"] = eac
    oct_ = _optional_int_non_negative(row.get("osm_candidates_tried"))
    if oct_ is not None:
        out["osm_candidates_tried"] = oct_

    return out


def _optional_float_latlng(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x


def _refine_geocode_props(props: dict[str, Any]) -> None:
    for k in ("consumption_geocode_lat", "consumption_geocode_lng"):
        val = props.get(k)
        if val is not None and val == 0.0:
            props[k] = None


def export_merged_geojson(
    *,
    matches_csv: Path,
    base_geojson: Path,
    out_geojson: Path,
    keep_bdnb_staging: bool,
    keep_base_pois: bool,
) -> tuple[int, int, int]:
    df = pd.read_csv(matches_csv)
    if "batiment_id" not in df.columns:
        raise SystemExit("CSV sans colonne batiment_id")
    csv_map: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        d = row.to_dict()
        bid = str(d.get("batiment_id") or "").strip()
        fp = str(d.get("footprint_path") or "").strip()
        if bid:
            csv_map[_row_key(bid, fp)] = d

    with base_geojson.open(encoding="utf-8") as f:
        base_fc = json.load(f)
    feats_in = base_fc.get("features") or []
    if not isinstance(feats_in, list):
        raise SystemExit("GeoJSON de base : features manquant ou invalide")

    out_features: list[dict[str, Any]] = []
    missing_csv = 0
    skipped_geom = 0
    for feat in feats_in:
        if not isinstance(feat, dict) or feat.get("type") != "Feature":
            continue
        props = feat.get("properties") or {}
        if not isinstance(props, dict):
            continue
        bid = str(props.get("batiment_groupe_id") or "").strip()
        fp = str(props.get("footprint_path") or "").strip()
        key = _row_key(bid, fp)
        row = csv_map.get(key)
        if row is None:
            missing_csv += 1
            continue
        geom = feat.get("geometry")
        if not isinstance(geom, dict):
            skipped_geom += 1
            continue
        gt = geom.get("type")
        if gt not in ("Polygon", "MultiPolygon"):
            skipped_geom += 1
            continue

        api_props = _csv_row_to_feature_properties(row)
        _refine_geocode_props(api_props)
        # Solar Scout / parseBdnbPoiFeatureProperties exigent lead_id (UUID v5 dans l’export build-bdnb-poi-sample).
        lid = props.get("lead_id") or props.get("leadId")
        if lid is not None and str(lid).strip():
            api_props["lead_id"] = str(lid).strip()
        lat = props.get("lat")
        lng = props.get("lng")
        if lat is not None and lng is not None:
            try:
                api_props["lat"] = float(lat)
                api_props["lng"] = float(lng)
            except (TypeError, ValueError):
                pass
        cc = props.get("code_commune_insee")
        if cc is not None and str(cc).strip():
            api_props["code_commune_insee"] = str(cc).strip()
        if keep_bdnb_staging and isinstance(props.get("bdnb_staging"), dict):
            api_props["bdnb_staging"] = props["bdnb_staging"]
        if keep_base_pois and props.get("pois") is not None:
            api_props["pois"] = props["pois"]

        out_features.append({"type": "Feature", "geometry": geom, "properties": api_props})

    out_fc: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": out_features,
        "meta": {
            "schema": "matching_v4_geojson_export_v1",
            "source_matches_csv": str(matches_csv),
            "source_base_geojson": str(base_geojson),
            "features_written": len(out_features),
            "base_features_total": len(feats_in),
            "base_features_without_csv_row": missing_csv,
        },
    }
    out_fc = _json_sanitize(out_fc)
    out_geojson.parent.mkdir(parents=True, exist_ok=True)
    with out_geojson.open("w", encoding="utf-8") as f:
        json.dump(out_fc, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    return len(out_features), missing_csv, skipped_geom


def main() -> None:
    p = argparse.ArgumentParser(description="Export GeoJSON matching V4 (CSV + GeoJSON base, sans Postgres)")
    p.add_argument("--matches-csv", type=Path, required=True, help="CSV avec colonne batiment_id (+ footprint_path)")
    p.add_argument("--base-geojson", type=Path, required=True, help="GeoJSON emprises (ex. scout_bdnb_poi_sample_*.geojson)")
    p.add_argument("--out-geojson", type=Path, required=True, help="FeatureCollection de sortie")
    p.add_argument(
        "--keep-bdnb-staging",
        action="store_true",
        help="Recopier bdnb_staging depuis le GeoJSON de base",
    )
    p.add_argument(
        "--keep-base-pois",
        action="store_true",
        help="Recopier la propriété pois du GeoJSON de base (lourd)",
    )
    args = p.parse_args()
    for path, label in (
        (args.matches_csv, "matches CSV"),
        (args.base_geojson, "base GeoJSON"),
    ):
        if not path.is_file():
            raise SystemExit(f"{label} introuvable: {path}")

    n_out, missing, skip = export_merged_geojson(
        matches_csv=args.matches_csv,
        base_geojson=args.base_geojson,
        out_geojson=args.out_geojson,
        keep_bdnb_staging=bool(args.keep_bdnb_staging),
        keep_base_pois=bool(args.keep_base_pois),
    )
    print(f"[export-v4-geojson] écrit {n_out} features → {args.out_geojson}")
    print(f"[export-v4-geojson] emprises base sans ligne CSV: {missing} | géométries ignorées: {skip}")


if __name__ == "__main__":
    main()
