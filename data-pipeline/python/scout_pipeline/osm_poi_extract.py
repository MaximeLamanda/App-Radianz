"""Extract Geofabrik OSM → Parquet unifié pour matching V3 (GPKG free ou PBF)."""

from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd


GPKG_LAYERS_POI = ("gis_osm_pois_free", "gis_osm_pois_a_free")
GPKG_LAYER_BUILDINGS = "gis_osm_buildings_a_free"

# Ordre de priorité pour remplir la colonne `name` quand `name=*` est vide (OSM courant).
OSM_NAME_TAG_PRIORITY: tuple[str, ...] = (
    "name",
    "operator",
    "brand",
    "alt_name",
    "short_name",
    "name:fr",
    "name:en",
    "name:de",
    "name:es",
    "name:oc",
    "official_name",
)

# POI PBF : filtres pyrosm (True = toutes les valeurs du tag).
PBF_POI_CUSTOM_FILTER: dict[str, bool] = {
    "amenity": True,
    "shop": True,
    "office": True,
    "craft": True,
    "tourism": True,
    "leisure": True,
    "healthcare": True,
}

# Tags supplémentaires à lire depuis le PBF (noms + contact).
PBF_POI_EXTRA_TAGS: list[str] = [
    "building",
    "phone",
    "website",
    "contact:phone",
    "contact:website",
    "operator",
    "brand",
    "alt_name",
    "short_name",
    "name:fr",
    "name:en",
    "name:de",
    "name:es",
    "name:oc",
    "official_name",
]

PBF_BUILDING_EXTRA_TAGS: list[str] = [
    "operator",
    "brand",
    "alt_name",
    "short_name",
    "name:fr",
    "name:en",
    "name:de",
    "official_name",
]


def _series_best_display_name(s: pd.Series) -> str | None:
    """Premier tag non vide parmi OSM_NAME_TAG_PRIORITY (colonnes absentes ignorées)."""
    for key in OSM_NAME_TAG_PRIORITY:
        if key not in s.index:
            continue
        val = s[key]
        if val is None or (isinstance(val, float) and pd.isna(val)):
            continue
        t = str(val).strip()
        if t:
            return t
    return None


def _tags_dict_best_display_name(tags: dict[str, str]) -> str | None:
    """Même logique que `_series_best_display_name` pour un dict de tags OSM."""
    for key in OSM_NAME_TAG_PRIORITY:
        if key not in tags:
            continue
        t = str(tags[key]).strip()
        if t:
            return t
    return None


def _gdf_cell_str(r: pd.Series, key: str) -> str:
    """Valeur texte d’une colonne GeoDataFrame ; chaîne vide si absente / NaN."""
    if key not in r.index:
        return ""
    val = r.get(key)
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


PARQUET_OSM_COLUMNS = (
    "poi_id",
    "name",
    "categories",
    "geom_wkt",
    "source_layer",
    "phone",
    "website",
    "osm_building",
    "addr_full",
    "addr_housenumber",
    "addr_street",
    "addr_postcode",
    "addr_city",
)


def _gpkg_path_for_read(gpkg_or_zip: Path, inner_gpkg_name: str | None) -> str:
    """Chemin GDAL/GeoPandas : fichier .gpkg ou /vsizip/.../fichier.gpkg dans un zip."""
    p = gpkg_or_zip.resolve()
    if p.suffix.lower() == ".zip":
        inner = inner_gpkg_name
        if not inner:
            with zipfile.ZipFile(p) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith(".gpkg")]
            if not names:
                raise SystemExit(f"Aucun .gpkg dans l’archive: {p}")
            inner = names[0]
        return f"/vsizip/{p.as_posix()}/{inner}"
    return str(p)


def _row_categories_gpkg(
    *,
    fclass: object,
    code: object,
    building_type: object | None = None,
) -> str:
    cats: list[str] = []
    if fclass is not None and str(fclass).strip():
        cats.append(f"fclass:{str(fclass).strip()}")
    if code is not None and pd.notna(code):
        try:
            cats.append(f"code:{int(float(code))}")
        except (TypeError, ValueError):
            cats.append(f"code:{code}")
    if building_type is not None and str(building_type).strip():
        cats.append(f"building_type:{str(building_type).strip()}")
    return json.dumps(cats, ensure_ascii=False)


def _geom_to_wkt(geom: Any) -> str | None:
    if geom is None or getattr(geom, "is_empty", True):
        return None
    return geom.wkt


def _normalize_osm_id(raw: object) -> str:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return "0"
    return str(int(raw)) if str(raw).replace(".", "", 1).isdigit() else str(raw)


def extract_gpkg_free_to_parquet(
    *,
    gpkg_or_zip: Path,
    bbox: tuple[float, float, float, float],
    out_parquet: Path,
    inner_gpkg_name: str | None = None,
) -> Path:
    """Lit les couches Geofabrik « free » dans la bbox et écrit un Parquet unifié."""
    min_lon, min_lat, max_lon, max_lat = bbox
    gpkg_path = _gpkg_path_for_read(gpkg_or_zip, inner_gpkg_name)
    bbox_tuple = (min_lon, min_lat, max_lon, max_lat)

    all_rows: list[dict[str, Any]] = []

    for layer in GPKG_LAYERS_POI:
        gdf = gpd.read_file(gpkg_path, layer=layer, bbox=bbox_tuple)
        if gdf.empty:
            continue
        gdf = gdf.to_crs(4326)
        for _, r in gdf.iterrows():
            oid = _normalize_osm_id(r.get("osm_id"))
            prefix = "poi_point" if layer == "gis_osm_pois_free" else "poi_a"
            nm = _series_best_display_name(r)
            all_rows.append(
                {
                    "poi_id": f"gpkg:{prefix}:{oid}",
                    "name": nm,
                    "categories": _row_categories_gpkg(
                        fclass=r.get("fclass"),
                        code=r.get("code"),
                        building_type=None,
                    ),
                    "geom_wkt": _geom_to_wkt(r.geometry),
                    "source_layer": "pois_free" if layer == "gis_osm_pois_free" else "pois_a_free",
                    "phone": None,
                    "website": None,
                    "osm_building": _gdf_cell_str(r, "building"),
                    "addr_full": None,
                    "addr_housenumber": None,
                    "addr_street": None,
                    "addr_postcode": None,
                    "addr_city": None,
                }
            )

    bdf = gpd.read_file(gpkg_path, layer=GPKG_LAYER_BUILDINGS, bbox=bbox_tuple)
    if not bdf.empty:
        bdf = bdf.to_crs(4326)
        for _, r in bdf.iterrows():
            nm = _series_best_display_name(r)
            if not nm:
                continue
            oid = _normalize_osm_id(r.get("osm_id"))
            btype = _gdf_cell_str(r, "type") or _gdf_cell_str(r, "building")
            all_rows.append(
                {
                    "poi_id": f"gpkg:building:{oid}",
                    "name": nm,
                    "categories": _row_categories_gpkg(
                        fclass=r.get("fclass"),
                        code=r.get("code"),
                        building_type=r.get("type"),
                    ),
                    "geom_wkt": _geom_to_wkt(r.geometry),
                    "source_layer": "buildings_a_free",
                    "phone": None,
                    "website": None,
                    "osm_building": btype,
                    "addr_full": None,
                    "addr_housenumber": None,
                    "addr_street": None,
                    "addr_postcode": None,
                    "addr_city": None,
                }
            )

    out = (
        pd.DataFrame(all_rows)
        if all_rows
        else pd.DataFrame(columns=list(PARQUET_OSM_COLUMNS))
    )

    out_parquet.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_parquet, index=False)
    print(f"[osm-extract] GPKG → {out_parquet} ({len(out)} lignes)")
    return out_parquet


def extract_pbf_to_parquet(
    *,
    pbf_path: Path,
    bbox: tuple[float, float, float, float],
    out_parquet: Path,
) -> Path:
    """Extrait POI depuis un PBF vers le même schéma Parquet (défaut : paquet ``osmium`` / PyPI).

    ``SCOUT_OSM_PBF_BACKEND=pyrosm`` force l’ancien lecteur pyrosm (pip difficile sur macOS récent).
    """
    import os

    backend = (os.environ.get("SCOUT_OSM_PBF_BACKEND") or "osmium").strip().lower()
    if backend == "pyrosm":
        return _extract_pbf_to_parquet_pyrosm(pbf_path=pbf_path, bbox=bbox, out_parquet=out_parquet)

    try:
        from scout_pipeline.osm_pbf_osmium import extract_pbf_osmium_to_parquet
    except ImportError as e:
        raise SystemExit(
            "Lecteur PBF par défaut : `pip install osmium` (paquet PyPI, souvent avec roues binaires). "
            "Alternative : `SCOUT_OSM_PBF_BACKEND=pyrosm` si pyrosm est installé."
        ) from e

    return extract_pbf_osmium_to_parquet(pbf_path=pbf_path, bbox=bbox, out_parquet=out_parquet)


def _extract_pbf_to_parquet_pyrosm(
    *,
    pbf_path: Path,
    bbox: tuple[float, float, float, float],
    out_parquet: Path,
) -> Path:
    """Lecteur PBF historique (pyrosm + GeoPandas)."""
    try:
        from pyrosm import OSM
    except ImportError as e:
        raise SystemExit(
            "pyrosm requis pour SCOUT_OSM_PBF_BACKEND=pyrosm (sinon : défaut osmium, pip install osmium)"
        ) from e

    min_lon, min_lat, max_lon, max_lat = bbox
    osm = OSM(str(pbf_path.resolve()), bounding_box=[min_lon, min_lat, max_lon, max_lat])
    custom_filter = dict(PBF_POI_CUSTOM_FILTER)
    extra = list(PBF_POI_EXTRA_TAGS)
    try:
        pois = osm.get_pois(custom_filter=custom_filter, extra_tags=extra)
    except TypeError:
        pois = osm.get_pois(custom_filter=custom_filter)

    rows: list[dict[str, Any]] = []
    if not pois.empty:
        pois = pois.to_crs(4326)
        cat_keys = ("amenity", "shop", "office", "craft", "tourism", "leisure", "healthcare")
        for _, r in pois.iterrows():
            cats: list[str] = []
            for key in cat_keys:
                v = r.get(key)
                if v is not None and str(v).strip() and (not isinstance(v, float) or not pd.isna(v)):
                    cats.append(f"{key}:{str(v).strip()}")
            oid = _normalize_osm_id(r.get("id") if r.get("id") is not None else r.get("osm_id"))
            phone = r.get("contact:phone") or r.get("phone")
            website = r.get("contact:website") or r.get("website")
            if phone is not None and pd.isna(phone):
                phone = None
            if website is not None and pd.isna(website):
                website = None
            nm = _series_best_display_name(r)
            b_raw = r.get("building")
            if b_raw is not None and not (isinstance(b_raw, float) and pd.isna(b_raw)):
                ob = str(b_raw).strip()
            else:
                ob = ""
            rows.append(
                {
                    "poi_id": f"pbf:poi:{oid}",
                    "name": nm,
                    "categories": json.dumps(cats, ensure_ascii=False),
                    "geom_wkt": _geom_to_wkt(r.geometry),
                    "source_layer": "pyrosm",
                    "phone": str(phone).strip() if phone is not None and str(phone).strip() else None,
                    "website": str(website).strip() if website is not None and str(website).strip() else None,
                    "osm_building": ob,
                    "addr_full": str(r.get("addr:full")).strip() if r.get("addr:full") is not None and str(r.get("addr:full")).strip() else None,
                    "addr_housenumber": str(r.get("addr:housenumber")).strip() if r.get("addr:housenumber") is not None and str(r.get("addr:housenumber")).strip() else None,
                    "addr_street": str(r.get("addr:street")).strip() if r.get("addr:street") is not None and str(r.get("addr:street")).strip() else None,
                    "addr_postcode": str(r.get("addr:postcode")).strip() if r.get("addr:postcode") is not None and str(r.get("addr:postcode")).strip() else None,
                    "addr_city": str(r.get("addr:city")).strip() if r.get("addr:city") is not None and str(r.get("addr:city")).strip() else None,
                }
            )

    # Bâtiments PBF : nom résolu (name / operator / brand / name:* …) comme POI nommé.
    building_rows: list[dict[str, Any]] = []
    try:
        try:
            bdf = osm.get_buildings(extra_tags=PBF_BUILDING_EXTRA_TAGS)
        except TypeError:
            bdf = osm.get_buildings()
    except Exception:
        bdf = None
    if bdf is not None and not getattr(bdf, "empty", True):
        bdf = bdf.to_crs(4326)
        for _, r in bdf.iterrows():
            nm = _series_best_display_name(r)
            if not nm:
                continue
            oid = _normalize_osm_id(r.get("id") if r.get("id") is not None else r.get("osm_id"))
            bval = r.get("building")
            if bval is None or (isinstance(bval, float) and pd.isna(bval)):
                btag = ""
            else:
                btag = str(bval).strip()
            cats_b = ["fclass:building", f"building:{btag}"] if btag else ["fclass:building"]
            gw = _geom_to_wkt(r.geometry)
            if not gw:
                continue
            building_rows.append(
                {
                    "poi_id": f"pbf:building:{oid}",
                    "name": nm,
                    "categories": json.dumps(cats_b, ensure_ascii=False),
                    "geom_wkt": gw,
                    "source_layer": "pbf_building_named",
                    "phone": None,
                    "website": None,
                    "osm_building": btag,
                    "addr_full": str(r.get("addr:full")).strip() if r.get("addr:full") is not None and str(r.get("addr:full")).strip() else None,
                    "addr_housenumber": str(r.get("addr:housenumber")).strip() if r.get("addr:housenumber") is not None and str(r.get("addr:housenumber")).strip() else None,
                    "addr_street": str(r.get("addr:street")).strip() if r.get("addr:street") is not None and str(r.get("addr:street")).strip() else None,
                    "addr_postcode": str(r.get("addr:postcode")).strip() if r.get("addr:postcode") is not None and str(r.get("addr:postcode")).strip() else None,
                    "addr_city": str(r.get("addr:city")).strip() if r.get("addr:city") is not None and str(r.get("addr:city")).strip() else None,
                }
            )

    if not rows and not building_rows:
        out = pd.DataFrame(columns=list(PARQUET_OSM_COLUMNS))
    else:
        parts = []
        if rows:
            parts.append(pd.DataFrame(rows))
        if building_rows:
            parts.append(pd.DataFrame(building_rows))
        out = pd.concat(parts, ignore_index=True) if len(parts) > 1 else parts[0]

    out_parquet.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_parquet, index=False)
    print(f"[osm-extract] PBF → {out_parquet} ({len(out)} lignes)")
    return out_parquet


def _parse_bbox(ns: list[float]) -> tuple[float, float, float, float]:
    if len(ns) != 4:
        raise SystemExit("--bbox attend 4 valeurs: min_lon min_lat max_lon max_lat")
    return float(ns[0]), float(ns[1]), float(ns[2]), float(ns[3])


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract POI OSM (Geofabrik GPKG free ou PBF) → Parquet V3")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--gpkg", type=Path, help="Chemin vers un fichier .gpkg Geofabrik free")
    src.add_argument("--gpkg-zip", type=Path, help="Chemin vers un .zip contenant un .gpkg")
    src.add_argument(
        "--pbf",
        type=Path,
        help="Chemin vers un .osm.pbf (lecteur par défaut : paquet pip `osmium` ; `brew install osmium` recommandé pour découper à la bbox)",
    )
    parser.add_argument(
        "--gpkg-inner-name",
        default="",
        help="Nom du .gpkg dans le zip (sinon : premier .gpkg trouvé dans l’archive)",
    )
    parser.add_argument(
        "--bbox",
        type=float,
        nargs=4,
        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"),
        required=True,
        help="BBox WGS84",
    )
    parser.add_argument("--out-parquet", type=Path, required=True, help="Fichier Parquet de sortie")
    args = parser.parse_args()

    bbox = _parse_bbox(args.bbox)
    inner = str(args.gpkg_inner_name).strip() or None

    if args.pbf:
        extract_pbf_to_parquet(pbf_path=args.pbf, bbox=bbox, out_parquet=args.out_parquet)
    elif args.gpkg_zip:
        extract_gpkg_free_to_parquet(
            gpkg_or_zip=args.gpkg_zip,
            bbox=bbox,
            out_parquet=args.out_parquet,
            inner_gpkg_name=inner,
        )
    else:
        extract_gpkg_free_to_parquet(
            gpkg_or_zip=args.gpkg,
            bbox=bbox,
            out_parquet=args.out_parquet,
            inner_gpkg_name=None,
        )


if __name__ == "__main__":
    main()
