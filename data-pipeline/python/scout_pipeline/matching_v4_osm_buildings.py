"""Matching V4 — pile OSM : polygones ``building`` nommés ∩ emprise BDNB.

Tri : **aire d’intersection** (m²) **décroissante** ; à aire égale → distance des
**centroïdes** (m) **croissante** (bâtiment le plus « centré » sur l’emprise en premier).

Les géométries d’entrée sont supposées **déjà dans le même CRS plan** (ex. mètres).
Pour du WGS84, projeter upstream (ex. EPSG:2154 sur métropole FR) via GeoPandas.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from shapely.geometry.base import BaseGeometry


@dataclass(frozen=True)
class RankedOsmBuilding:
    """Un candidat OSM nommé après filtrage intersection + tri."""

    name: str
    geometry: BaseGeometry
    intersection_area_m2: float
    centroid_distance_m: float
    osm_id: str | None = None


def intersection_area_m2(a: BaseGeometry, b: BaseGeometry) -> float:
    if a.is_empty or b.is_empty:
        return 0.0
    inter = a.intersection(b)
    return float(inter.area) if not inter.is_empty else 0.0


def centroid_distance_m(a: BaseGeometry, b: BaseGeometry) -> float:
    ca, cb = a.centroid, b.centroid
    return float(ca.distance(cb))


def rank_osm_named_buildings_for_footprint(
    bdnb_footprint: BaseGeometry,
    osm_buildings: Sequence[dict[str, Any]],
    *,
    geom_key: str = "geometry",
    name_key: str = "name",
    id_key: str = "osm_id",
) -> list[RankedOsmBuilding]:
    """Filtre les bâtiments OSM qui intersectent l’emprise et les trie (design V4).

    ``osm_buildings`` : itérable de dicts avec au minimum ``name`` et ``geometry``
    (objets Shapely). Clés surchargables via ``*_key``.
    """
    rows: list[RankedOsmBuilding] = []
    for raw in osm_buildings:
        geom = raw.get(geom_key)
        if geom is None or getattr(geom, "is_empty", True):
            continue
        nm = str(raw.get(name_key) or "").strip()
        if not nm:
            continue
        area = intersection_area_m2(bdnb_footprint, geom)
        if area <= 0:
            continue
        dist = centroid_distance_m(bdnb_footprint, geom)
        oid = raw.get(id_key)
        oid_s = str(oid).strip() if oid is not None and str(oid).strip() else None
        rows.append(
            RankedOsmBuilding(
                name=nm,
                geometry=geom,
                intersection_area_m2=area,
                centroid_distance_m=dist,
                osm_id=oid_s,
            )
        )

    rows.sort(key=lambda r: (-r.intersection_area_m2, r.centroid_distance_m))
    return rows
