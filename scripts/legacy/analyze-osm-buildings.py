#!/usr/bin/env python3
"""
Analyse un extrait OSM (.osm.pbf) : bâtiments, surfaces (ways fermées),
répartition par valeur du tag building=*.

Dépendances : pip install osmium pyproj shapely
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import osmium
from pyproj import Transformer
from shapely.geometry import Polygon


@dataclass
class BuildingStats:
    count_node: int = 0
    count_way: int = 0
    count_way_closed: int = 0
    count_way_open: int = 0
    count_relation: int = 0
    typology: Counter[str] = field(default_factory=Counter)
    # Aires des ways fermées (Lambert-93), en m²
    area_sum_m2: float = 0.0
    area_count: int = 0
    area_min_m2: float | None = None
    area_max_m2: float | None = None
    area_invalid_ways: int = 0


def _ring_coords_from_way(w: osmium.osm.Way) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for n in w.nodes:
        out.append((float(n.lon), float(n.lat)))
    return out


def _way_closed(w: osmium.osm.Way) -> bool:
    if len(w.nodes) < 2:
        return False
    return w.nodes[0].ref == w.nodes[-1].ref


class BuildingHandler(osmium.SimpleHandler):
    def __init__(self, to_lambert: Transformer) -> None:
        super().__init__()
        self.to_lambert = to_lambert
        self.stats = BuildingStats()

    def _record_typology(self, value: str) -> None:
        v = (value or "").strip() or "(vide)"
        self.stats.typology[v] += 1

    def node(self, n: osmium.osm.Node) -> None:
        if "building" not in n.tags:
            return
        self.stats.count_node += 1
        self._record_typology(n.tags["building"])

    def way(self, w: osmium.osm.Way) -> None:
        if "building" not in w.tags:
            return
        self.stats.count_way += 1
        self._record_typology(w.tags["building"])
        if not _way_closed(w):
            self.stats.count_way_open += 1
            return
        self.stats.count_way_closed += 1
        coords = _ring_coords_from_way(w)
        if len(coords) < 4:
            self.stats.area_invalid_ways += 1
            return
        # anneau fermé : dernier point = premier
        xs: list[float] = []
        ys: list[float] = []
        for lon, lat in coords:
            x, y = self.to_lambert.transform(lon, lat)
            xs.append(x)
            ys.append(y)
        ring = list(zip(xs, ys, strict=True))
        try:
            poly = Polygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
            area = float(poly.area)
            if area <= 0:
                self.stats.area_invalid_ways += 1
                return
        except Exception:
            self.stats.area_invalid_ways += 1
            return
        self.stats.area_sum_m2 += area
        self.stats.area_count += 1
        if self.stats.area_min_m2 is None or area < self.stats.area_min_m2:
            self.stats.area_min_m2 = area
        if self.stats.area_max_m2 is None or area > self.stats.area_max_m2:
            self.stats.area_max_m2 = area

    def relation(self, r: osmium.osm.Relation) -> None:
        if "building" not in r.tags:
            return
        self.stats.count_relation += 1
        self._record_typology(r.tags["building"])


def run(path: Path) -> BuildingStats:
    to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    h = BuildingHandler(to_lambert)
    # locations=True : géométrie des ways disponible
    h.apply_file(str(path), locations=True)
    return h.stats


def main() -> int:
    p = argparse.ArgumentParser(description="Analyse des bâtiments OSM dans un fichier .pbf")
    p.add_argument(
        "pbf",
        nargs="?",
        default=str(Path(__file__).resolve().parent.parent / "aquitaine-260406.osm.pbf"),
        help="Chemin vers le fichier .osm.pbf",
    )
    p.add_argument("--json", action="store_true", help="Sortie JSON sur stdout")
    args = p.parse_args()
    path = Path(args.pbf)
    if not path.is_file():
        print(f"Fichier introuvable : {path}", file=sys.stderr)
        return 1

    stats = run(path)

    total_objects = (
        stats.count_node + stats.count_way + stats.count_relation
    )
    mean_area = (
        stats.area_sum_m2 / stats.area_count if stats.area_count else None
    )

    report = {
        "fichier": str(path.resolve()),
        "objets_avec_tag_building": {
            "total": total_objects,
            "nodes": stats.count_node,
            "ways": stats.count_way,
            "ways_fermees": stats.count_way_closed,
            "ways_ouvertes": stats.count_way_open,
            "relations": stats.count_relation,
        },
        "surfaces_ways_fermes_m2": {
            "nombre_avec_aire_valide": stats.area_count,
            "somme_m2": round(stats.area_sum_m2, 2),
            "moyenne_m2": round(mean_area, 2) if mean_area is not None else None,
            "min_m2": round(stats.area_min_m2, 2) if stats.area_min_m2 is not None else None,
            "max_m2": round(stats.area_max_m2, 2) if stats.area_max_m2 is not None else None,
            "ways_aire_invalide_ou_nulle": stats.area_invalid_ways,
        },
        "note": "Les surfaces sont calculées en Lambert-93 (EPSG:2154) pour les ways fermées "
        "avec au moins 4 nœuds. Les bâtiments en node ou relation ne sont pas inclus dans la somme.",
        "typologie_building": dict(stats.typology.most_common()),
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    print(f"Fichier : {report['fichier']}\n")
    o = report["objets_avec_tag_building"]
    print("Objets avec tag building=*")
    print(f"  Total (nodes + ways + relations) : {o['total']:,}")
    print(f"  Nodes   : {o['nodes']:,}")
    print(f"  Ways    : {o['ways']:,}  (fermées : {o['ways_fermees']:,}, ouvertes : {o['ways_ouvertes']:,})")
    print(f"  Relations : {o['relations']:,}")
    print()
    s = report["surfaces_ways_fermes_m2"]
    print("Surfaces (ways fermées, m², Lambert-93)")
    print(f"  Ways avec aire valide : {s['nombre_avec_aire_valide']:,}")
    print(f"  Somme des surfaces    : {s['somme_m2']:,.2f} m² ({s['somme_m2'] / 1_000_000:,.3f} km²)")
    if s["moyenne_m2"] is not None:
        print(f"  Moyenne par way       : {s['moyenne_m2']:,.2f} m²")
    if s["min_m2"] is not None:
        print(f"  Min / Max             : {s['min_m2']:,.2f} / {s['max_m2']:,.2f} m²")
    print(f"  Ways sans aire valide : {s['ways_aire_invalide_ou_nulle']:,}")
    print()
    print(report["note"])
    print()
    print("Typologie (valeur du tag building=*, tri décroissant)")
    for val, cnt in stats.typology.most_common():
        pct = 100.0 * cnt / total_objects if total_objects else 0
        print(f"  {val!r}: {cnt:,} ({pct:.2f} %)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
