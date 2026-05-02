"""Lecture des fichiers ``.osm.pbf`` via le paquet PyPI ``osmium`` (roues binaires macOS / Linux).

Découpe bbox recommandée avec la CLI ``osmium`` (``brew install osmium``) pour éviter de
parcourir tout un extrait régional.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import osmium
import osmium.filter
import pandas as pd
from shapely.geometry import LineString, Point, Polygon, box, shape

from scout_pipeline.osm_poi_extract import (
    PBF_POI_CUSTOM_FILTER,
    PARQUET_OSM_COLUMNS,
    _geom_to_wkt,
    _normalize_osm_id,
    _tags_dict_best_display_name,
)

POI_TAG_KEYS: tuple[str, ...] = tuple(PBF_POI_CUSTOM_FILTER.keys())
POI_ENTITY_FILTER = osmium.osm.NODE | osmium.osm.WAY | osmium.osm.RELATION
BUILDING_ENTITY_FILTER = osmium.osm.WAY | osmium.osm.RELATION


def _tags(o: Any) -> dict[str, str]:
    return {t.k: t.v for t in o.tags}


def _phone_website(tags: dict[str, str]) -> tuple[str | None, str | None]:
    phone = tags.get("contact:phone") or tags.get("phone")
    website = tags.get("contact:website") or tags.get("website")
    ph = str(phone).strip() if phone else None
    wh = str(website).strip() if website else None
    return ph or None, wh or None


def _address_tags(tags: dict[str, str]) -> dict[str, str | None]:
    def _clean(key: str) -> str | None:
        v = tags.get(key)
        if v is None:
            return None
        t = str(v).strip()
        return t or None

    return {
        "addr_full": _clean("addr:full"),
        "addr_housenumber": _clean("addr:housenumber"),
        "addr_street": _clean("addr:street"),
        "addr_postcode": _clean("addr:postcode"),
        "addr_city": _clean("addr:city"),
    }


def _poi_categories(tags: dict[str, str]) -> str:
    cats: list[str] = []
    for key in POI_TAG_KEYS:
        v = tags.get(key)
        if v is not None and str(v).strip():
            cats.append(f"{key}:{str(v).strip()}")
    return json.dumps(cats, ensure_ascii=False)


def _clip_pbf_to_bbox_cli(src: Path, bbox: tuple[float, float, float, float]) -> tuple[Path, bool]:
    """Si la CLI ``osmium`` est disponible, écrit un PBF temporaire découpé à la bbox."""
    exe = shutil.which("osmium")
    if not exe:
        print(
            "[osm-extract] Astuce : installez la CLI `osmium` (`brew install osmium`) pour découper "
            "le PBF à la bbox avant lecture — beaucoup plus rapide sur un gros extrait."
        )
        return src, False
    min_lon, min_lat, max_lon, max_lat = bbox
    fd, tmp_path = tempfile.mkstemp(suffix=".osm.pbf", prefix="scout-osm-clip-")
    import os as _os

    _os.close(fd)
    out = Path(tmp_path)
    try:
        subprocess.run(
            [
                exe,
                "extract",
                "--overwrite",
                "-b",
                f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "-o",
                str(out),
                str(src.resolve()),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, OSError) as e:
        try:
            out.unlink(missing_ok=True)
        except OSError:
            pass
        print(f"[osm-extract] Clip osmium échoué ({e!s}), lecture du PBF source entier.")
        return src, False
    print(f"[osm-extract] PBF découpé (CLI osmium) → {out}")
    return out, True


def _geom_from_geojson(gj: str) -> Any | None:
    if not gj:
        return None
    try:
        return shape(json.loads(gj))
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def _way_to_shapely(geojsonfab: osmium.geom.GeoJSONFactory, w: Any) -> Any | None:
    try:
        gj = geojsonfab.create_linestring(w)
    except RuntimeError:
        return None
    g = _geom_from_geojson(gj)
    if g is None or g.is_empty:
        return None
    if isinstance(g, LineString) and w.is_closed() and len(g.coords) >= 4:
        try:
            return Polygon(g.coords)
        except Exception:
            return g
    return g


def _area_to_shapely(geojsonfab: osmium.geom.GeoJSONFactory, a: Any) -> Any | None:
    try:
        gj = geojsonfab.create_multipolygon(a)
    except RuntimeError:
        return None
    return _geom_from_geojson(gj)


class _PoiHandler(osmium.SimpleHandler):
    def __init__(self, bbox_poly: Polygon) -> None:
        super().__init__()
        self.bbox_poly = bbox_poly
        self.rows: list[dict[str, Any]] = []
        self._gjf = osmium.geom.GeoJSONFactory()

    def _append_poi(self, poi_id: str, tags: dict[str, str], geom: Any) -> None:
        if geom is None or geom.is_empty or not self.bbox_poly.intersects(geom):
            return
        phone, website = _phone_website(tags)
        self.rows.append(
            {
                "poi_id": poi_id,
                "name": _tags_dict_best_display_name(tags),
                "categories": _poi_categories(tags),
                "geom_wkt": _geom_to_wkt(geom),
                "source_layer": "osmium_poi",
                "phone": phone,
                "website": website,
                "osm_building": str(tags.get("building") or "").strip(),
                **_address_tags(tags),
            }
        )

    def node(self, n: Any) -> None:
        tags = _tags(n)
        if not any(k in tags for k in POI_TAG_KEYS):
            return
        if not n.location.valid():
            return
        lon, lat = n.location.lon, n.location.lat
        pt = Point(lon, lat)
        self._append_poi(f"pbf:poi:node-{n.id}", tags, pt)

    def way(self, w: Any) -> None:
        tags = _tags(w)
        if not any(k in tags for k in POI_TAG_KEYS):
            return
        geom = _way_to_shapely(self._gjf, w)
        self._append_poi(f"pbf:poi:way-{w.id}", tags, geom)

    def area(self, a: Any) -> None:
        tags = _tags(a)
        if not any(k in tags for k in POI_TAG_KEYS):
            return
        geom = _area_to_shapely(self._gjf, a)
        self._append_poi(f"pbf:poi:area-{a.id}", tags, geom)


class _BuildingHandler(osmium.SimpleHandler):
    def __init__(self, bbox_poly: Polygon) -> None:
        super().__init__()
        self.bbox_poly = bbox_poly
        self.rows: list[dict[str, Any]] = []
        self._gjf = osmium.geom.GeoJSONFactory()

    def _maybe_append(self, oid: int, tags: dict[str, str], geom: Any) -> None:
        if "building" not in tags:
            return
        nm = _tags_dict_best_display_name(tags)
        if not nm:
            return
        if geom is None or geom.is_empty or not self.bbox_poly.intersects(geom):
            return
        bval = str(tags.get("building") or "").strip()
        cats_b = ["fclass:building", f"building:{bval}"] if bval else ["fclass:building"]
        self.rows.append(
            {
                "poi_id": f"pbf:building:{_normalize_osm_id(oid)}",
                "name": nm,
                "categories": json.dumps(cats_b, ensure_ascii=False),
                "geom_wkt": _geom_to_wkt(geom),
                "source_layer": "pbf_building_named",
                "phone": None,
                "website": None,
                "osm_building": bval,
                **_address_tags(tags),
            }
        )

    def way(self, w: Any) -> None:
        tags = _tags(w)
        geom = _way_to_shapely(self._gjf, w)
        self._maybe_append(w.id, tags, geom)

    def area(self, a: Any) -> None:
        tags = _tags(a)
        geom = _area_to_shapely(self._gjf, a)
        self._maybe_append(a.id, tags, geom)


def extract_pbf_osmium_to_parquet(
    *,
    pbf_path: Path,
    bbox: tuple[float, float, float, float],
    out_parquet: Path,
) -> Path:
    min_lon, min_lat, max_lon, max_lat = bbox
    bbox_poly = box(min_lon, min_lat, max_lon, max_lat)
    work_path, is_temp = _clip_pbf_to_bbox_cli(Path(pbf_path), bbox)

    poi_filter = osmium.filter.KeyFilter(*POI_TAG_KEYS).enable_for(POI_ENTITY_FILTER)
    b_filter = osmium.filter.KeyFilter("building").enable_for(BUILDING_ENTITY_FILTER)

    poi_h = _PoiHandler(bbox_poly)
    try:
        poi_h.apply_file(str(work_path), locations=True, idx="flex_mem", filters=[poi_filter])
    except Exception as e:
        if is_temp:
            work_path.unlink(missing_ok=True)
        raise SystemExit(f"[osm-extract] Erreur lecture POI PBF (osmium): {e}") from e

    b_h = _BuildingHandler(bbox_poly)
    try:
        b_h.apply_file(str(work_path), locations=True, idx="flex_mem", filters=[b_filter])
    except Exception as e:
        if is_temp:
            work_path.unlink(missing_ok=True)
        raise SystemExit(f"[osm-extract] Erreur lecture bâtiments PBF (osmium): {e}") from e

    if is_temp:
        try:
            work_path.unlink(missing_ok=True)
        except OSError:
            pass

    all_rows = poi_h.rows + b_h.rows
    out = (
        pd.DataFrame(all_rows)
        if all_rows
        else pd.DataFrame(columns=list(PARQUET_OSM_COLUMNS))
    )
    out_parquet.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_parquet, index=False)
    print(f"[osm-extract] PBF (osmium) → {out_parquet} ({len(out)} lignes)")
    return out_parquet
