"""
Jointure parking OSM + ENR ↔ parcelles cadastrales ↔ bâtiments matching V5.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from enr_parking_v5 import (
    PARKING_OVERLAP_DEDUP_RATIO,
    PARKING_TYPE_ENR,
    enr_parking_regclass,
    qualified_enr_parking_table,
)
from osm_parking_v5 import osm_parking_regclass, qualified_osm_parking_table
from osm_poi_v5 import normalize_osm_row_for_export, osm_poi_regclass, qualified_osm_poi_table, tags_dict


def parcel_key(code_insee: str, section: str, numero_norm: str) -> tuple[str, str, str]:
    return (str(code_insee or "").strip(), str(section or "").strip(), str(numero_norm or "").strip())


def parking_index_key(osm_type: str, osm_id: int) -> tuple[str, int]:
    """
    Clé stable pour dédupliquer un parking OSM.
    Osmium expose les ways fermées aussi comme Area (id négatif) → aligner r:-123 sur w:123.
    """
    ot = (str(osm_type or "w").strip() or "w")
    oid = int(osm_id)
    if ot == "r" and oid < 0:
        return ("w", abs(oid))
    return (ot, oid)


def parking_source_from_type(osm_type: str) -> str:
    return "enr" if str(osm_type or "").strip() == PARKING_TYPE_ENR else "osm"


def building_parcel_keys_from_by_building(
    by_building: dict[str, list[dict[str, Any]]],
    osm_building_id: str,
) -> set[tuple[str, str, str]]:
    out: set[tuple[str, str, str]] = set()
    for entry in by_building.get(str(osm_building_id or "").strip(), []):
        out.add(
            parcel_key(
                str(entry.get("code_insee") or ""),
                str(entry.get("section") or ""),
                str(entry.get("numero_norm") or ""),
            )
        )
    return {k for k in out if k[0] and k[1] and k[2]}


def common_parcel_keys(
    building_parcels: set[tuple[str, str, str]],
    parking_parcels: set[tuple[str, str, str]],
) -> set[tuple[str, str, str]]:
    return building_parcels & parking_parcels


def link_parkings_to_building(
    building_parcels: set[tuple[str, str, str]],
    parking_index: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Parkings liés si au moins une parcelle commune avec le bâtiment."""
    if not building_parcels:
        return []
    out: list[dict[str, Any]] = []
    for pdata in parking_index.values():
        parking_parcels = pdata.get("parcel_keys") or set()
        if not isinstance(parking_parcels, set):
            parking_parcels = set(parking_parcels)
        shared = common_parcel_keys(building_parcels, parking_parcels)
        if not shared:
            continue
        out.append(build_parking_export_entry(pdata, shared))
    out.sort(key=lambda x: (-float(x.get("parking_area_m2") or 0), str(x.get("osm_parking_id"))))
    return out


def build_parking_export_entry(
    pdata: dict[str, Any],
    common_parcels: set[tuple[str, str, str]],
) -> dict[str, Any]:
    parcels_json = pdata.get("parking_parcels_json") or []
    common_json = [
        {"code_insee": ci, "section": sec, "numero_norm": num}
        for ci, sec, num in sorted(common_parcels)
    ]
    tags = pdata.get("tags") or {}
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except Exception:
            tags = {}
    name = str((tags or {}).get("name") or (tags or {}).get("NomCom") or "").strip()
    ptype = str(pdata.get("osm_type") or "w")
    return {
        "parking_source": parking_source_from_type(ptype),
        "osm_parking_type": ptype,
        "osm_parking_id": int(pdata.get("osm_id") or 0),
        "parking_tag": str(pdata.get("parking_tag") or ""),
        "parking_value": str(pdata.get("parking_value") or "parking"),
        "parking_name": name,
        "parking_area_m2": pdata.get("parking_area_m2"),
        "parking_parcels_json": parcels_json,
        "common_parcels_json": common_json,
        "charging_stations_json": [],
    }


def attach_charging_stations_to_parkings(
    parkings: list[dict[str, Any]],
    charging_by_pk: dict[tuple[str, str, str], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in parkings:
        entry = dict(p)
        common = entry.get("common_parcels_json") or []
        seen: set[tuple[str, int]] = set()
        stations: list[dict[str, Any]] = []
        for cp in common:
            pk = parcel_key(
                str(cp.get("code_insee") or ""),
                str(cp.get("section") or ""),
                str(cp.get("numero_norm") or ""),
            )
            for st in charging_by_pk.get(pk, []):
                key = (str(st.get("osm_type") or "n"), int(st.get("osm_id") or 0))
                if key in seen:
                    continue
                seen.add(key)
                item = dict(st)
                cap = str((st.get("raw_tags") or {}).get("capacity") or "").strip()
                if cap:
                    item["capacity"] = cap
                stations.append(item)
        entry["charging_stations_json"] = stations
        out.append(entry)
    return out


def attach_parkings_to_bdetails(
    bdetails: list[dict[str, Any]],
    *,
    by_building: dict[str, list[dict[str, Any]]],
    parking_index: dict[tuple[str, int], dict[str, Any]],
    charging_by_pk: dict[tuple[str, str, str], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for item in bdetails:
        row = dict(item)
        bid = str(row.get("osm_building_id") or "").strip()
        building_parcels = building_parcel_keys_from_by_building(by_building, bid)
        parkings = link_parkings_to_building(building_parcels, parking_index)
        row["parkings_json"] = attach_charging_stations_to_parkings(parkings, charging_by_pk)
        enriched.append(row)
    return enriched


def collect_parking_geometries_for_bdetails(
    bdetails: list[dict[str, Any]],
    parking_index: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    seen: set[tuple[str, int]] = set()
    out: list[dict[str, Any]] = []
    for item in bdetails:
        for p in item.get("parkings_json") or []:
            ot = str(p.get("osm_parking_type") or "w")
            oid = int(p.get("osm_parking_id") or 0)
            key = parking_index_key(ot, oid)
            if key in seen:
                continue
            seen.add(key)
            pdata = parking_index.get(key)
            if not pdata or pdata.get("geometry") is None:
                continue
            out.append(
                {
                    "osm_parking_type": str(pdata.get("osm_type") or key[0]),
                    "osm_parking_id": int(pdata.get("osm_id") or key[1]),
                    "geometry": pdata["geometry"],
                }
            )
    return out


def build_parking_index_from_rows(rows: list[dict[str, Any]]) -> dict[tuple[str, int], dict[str, Any]]:
    index: dict[tuple[str, int], dict[str, Any]] = {}
    for r in rows:
        ot = str(r.get("osm_type") or "w")
        oid = int(r.get("osm_id") or 0)
        key = parking_index_key(ot, oid)
        pk_tuple = parcel_key(
            str(r.get("code_insee") or ""),
            str(r.get("section") or ""),
            str(r.get("numero_norm") or ""),
        )
        inter_m2 = r.get("intersection_area_m2")
        if key not in index:
            tags = r.get("tags") or {}
            if not isinstance(tags, dict):
                tags = tags_dict(tags)
            index[key] = {
                "osm_type": key[0],
                "osm_id": key[1],
                "parking_tag": r.get("parking_tag"),
                "parking_value": r.get("parking_value"),
                "parking_area_m2": r.get("parking_area_m2"),
                "tags": tags,
                "geometry": r.get("geometry"),
                "parcel_keys": set(),
                "parking_parcels_json": [],
            }
        entry = index[key]
        entry["parcel_keys"].add(pk_tuple)
        entry["parking_parcels_json"].append(
            {
                "code_insee": pk_tuple[0],
                "section": pk_tuple[1],
                "numero_norm": pk_tuple[2],
                "intersection_area_m2": inter_m2,
            }
        )
    for entry in index.values():
        entry["parking_parcels_json"].sort(
            key=lambda x: (-float(x.get("intersection_area_m2") or 0), x.get("section", ""), x.get("numero_norm", ""))
        )
    return index


_TRANSFORMER_4326_2154: Any | None = None


def _transformer_4326_2154() -> Any:
    global _TRANSFORMER_4326_2154
    if _TRANSFORMER_4326_2154 is None:
        from pyproj import Transformer

        _TRANSFORMER_4326_2154 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    return _TRANSFORMER_4326_2154


def _shape_from_geojson(geom_raw: Any) -> Any | None:
    from shapely.geometry import shape

    if geom_raw is None:
        return None
    try:
        geom = shape(geom_raw) if isinstance(geom_raw, dict) else geom_raw
    except Exception:
        return None
    if geom is None or geom.is_empty:
        return None
    return geom


def _to_2154(geom: Any) -> Any:
    from shapely.ops import transform

    return transform(_transformer_4326_2154().transform, geom)


def _first_geom_and_area(rows: list[dict[str, Any]]) -> tuple[Any | None, float]:
    for r in rows:
        geom = _shape_from_geojson(r.get("geometry"))
        if geom is None:
            continue
        area_m2 = float(r.get("parking_area_m2") or 0)
        return geom, area_m2
    return None, 0.0


def _overlap_ratio_m2_2154(geom_a_2154: Any, area_a: float, geom_b_2154: Any, area_b: float) -> float:
    if geom_a_2154 is None or geom_b_2154 is None or geom_a_2154.is_empty or geom_b_2154.is_empty:
        return 0.0
    inter = geom_a_2154.intersection(geom_b_2154).area
    a = area_a if area_a > 0 else geom_a_2154.area
    b = area_b if area_b > 0 else geom_b_2154.area
    denom = min(a, b)
    if denom <= 0:
        return 0.0
    return float(inter) / float(denom)


def _overlap_ratio_m2(geom_a: Any, area_a: float, geom_b: Any, area_b: float) -> float:
    if geom_a is None or geom_b is None:
        return 0.0
    return _overlap_ratio_m2_2154(_to_2154(geom_a), area_a, _to_2154(geom_b), area_b)


def _parking_shapes_by_key(
    rows: list[dict[str, Any]],
) -> dict[tuple[str, int], tuple[Any, Any, float]]:
    """(osm_type, osm_id) -> (geom4326, geom2154, area_m2) — une géométrie par parking."""
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[(str(r["osm_type"]), int(r["osm_id"]))].append(r)
    out: dict[tuple[str, int], tuple[Any, Any, float]] = {}
    for key, group in grouped.items():
        geom4326, area = _first_geom_and_area(group)
        if geom4326 is None:
            continue
        out[key] = (geom4326, _to_2154(geom4326), area)
    return out


def merge_parking_rows_with_enr_priority(
    osm_rows: list[dict[str, Any]],
    enr_rows: list[dict[str, Any]],
    *,
    overlap_ratio: float = PARKING_OVERLAP_DEDUP_RATIO,
) -> list[dict[str, Any]]:
    """
    Union OSM + ENR ; retire les parkings OSM fortement recouverts par un ENR (priorité ENR).
    """
    if not osm_rows:
        return list(enr_rows)
    if not enr_rows:
        return list(osm_rows)

    osm_by_key: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for r in osm_rows:
        osm_by_key[(str(r["osm_type"]), int(r["osm_id"]))].append(r)

    enr_shapes = _parking_shapes_by_key(enr_rows)
    if not enr_shapes:
        return list(enr_rows) + list(osm_rows)

    enr_geoms_2154 = [t[1] for t in enr_shapes.values()]
    enr_meta = list(enr_shapes.values())
    try:
        from shapely.strtree import STRtree

        enr_tree: STRtree | None = STRtree(enr_geoms_2154)
    except Exception:
        enr_tree = None

    osm_shapes = _parking_shapes_by_key(osm_rows)
    filtered_osm: list[dict[str, Any]] = []
    for key, rows in osm_by_key.items():
        shape_pack = osm_shapes.get(key)
        if shape_pack is None:
            filtered_osm.extend(rows)
            continue
        _g4326, geom_o_2154, area_o = shape_pack
        drop = False
        if enr_tree is not None:
            try:
                candidate_idx = enr_tree.query(geom_o_2154, predicate="intersects")
            except TypeError:
                candidate_idx = enr_tree.query(geom_o_2154)
            for idx in candidate_idx:
                _eg4326, geom_e_2154, area_e = enr_meta[int(idx)]
                if _overlap_ratio_m2_2154(geom_o_2154, area_o, geom_e_2154, area_e) >= overlap_ratio:
                    drop = True
                    break
        else:
            for _eg4326, geom_e_2154, area_e in enr_meta:
                if _overlap_ratio_m2_2154(geom_o_2154, area_o, geom_e_2154, area_e) >= overlap_ratio:
                    drop = True
                    break
        if not drop:
            filtered_osm.extend(rows)

    return list(enr_rows) + filtered_osm


def _fetch_parking_parcel_intersections_from_table(
    cur: Any,
    code_insee: str,
    qualified: str,
    regclass: str,
    *,
    osm_type_expr: str,
    osm_id_expr: str,
) -> tuple[list[dict[str, Any]], str]:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (regclass,))
    row = cur.fetchone()
    if not row or not row[0]:
        return [], "skipped_no_table"

    sql = f"""
    WITH parcels AS (
      SELECT code_insee, section, numero_norm, geom, ST_Transform(geom, 2154) AS geom_2154
      FROM public.cadastre_france_feuilles_geom
      WHERE code_insee = %s
        AND numero_norm IS NOT NULL
        AND TRIM(numero_norm) <> ''
    ),
    parcels_extent AS (
      SELECT ST_Extent(geom)::geometry AS bbox FROM parcels
    ),
    parking_src AS (
      SELECT
        {osm_type_expr} AS osm_type,
        {osm_id_expr} AS osm_id,
        p.parking_tag,
        p.parking_value,
        p.tags,
        p.geom,
        ST_Transform(p.geom, 2154) AS g2154
      FROM {qualified} p
      WHERE p.geom IS NOT NULL
        AND p.geom && (SELECT bbox FROM parcels_extent)
    ),
    parking_ready AS (
      SELECT
        osm_type,
        osm_id,
        parking_tag,
        parking_value,
        tags,
        geom,
        g2154,
        ST_Area(g2154)::double precision AS parking_area_m2
      FROM parking_src
    )
    SELECT
      pk.osm_type,
      pk.osm_id,
      pk.parking_tag,
      pk.parking_value,
      pk.tags,
      pk.parking_area_m2,
      par.code_insee,
      par.section,
      par.numero_norm,
      ST_Area(ST_Intersection(pk.g2154, par.geom_2154))::double precision AS intersection_area_m2,
      ST_AsGeoJSON(pk.geom)::json AS geometry
    FROM parking_ready pk
    INNER JOIN parcels par
      ON pk.geom && par.geom
     AND ST_Intersects(pk.geom, par.geom)
    WHERE ST_Area(ST_Intersection(pk.g2154, par.geom_2154)) > 0
    ORDER BY pk.osm_type, pk.osm_id, intersection_area_m2 DESC NULLS LAST
    """
    cur.execute(sql, (code_insee,))
    out: list[dict[str, Any]] = []
    for r in cur.fetchall():
        out.append(
            {
                "osm_type": str(r[0]),
                "osm_id": int(r[1]),
                "parking_tag": str(r[2]),
                "parking_value": str(r[3]),
                "tags": r[4],
                "parking_area_m2": r[5],
                "code_insee": str(r[6]),
                "section": str(r[7]),
                "numero_norm": str(r[8]),
                "intersection_area_m2": r[9],
                "geometry": r[10],
            }
        )
    return out, "ok"


def fetch_parking_parcel_intersections(
    cur: Any,
    code_insee: str,
    osm_parking_qualified: str,
) -> tuple[list[dict[str, Any]], str]:
    """Intersections parking OSM × parcelles."""
    return _fetch_parking_parcel_intersections_from_table(
        cur,
        code_insee,
        osm_parking_qualified,
        osm_parking_regclass(),
        osm_type_expr="p.osm_type",
        osm_id_expr="p.osm_id",
    )


def fetch_enr_parking_parcel_intersections(
    cur: Any,
    code_insee: str,
    enr_parking_qualified: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Intersections parking ENR × parcelles (osm_type='e', osm_id=enr_id)."""
    qualified = enr_parking_qualified or qualified_enr_parking_table()
    rows, status = _fetch_parking_parcel_intersections_from_table(
        cur,
        code_insee,
        qualified,
        enr_parking_regclass(),
        osm_type_expr=f"'{PARKING_TYPE_ENR}'",
        osm_id_expr="p.enr_id",
    )
    return rows, status


def fetch_charging_stations_for_parcel_keys(
    cur: Any,
    code_insee: str,
    parcel_keys: set[tuple[str, str, str]],
    *,
    max_per_parcel: int = 20,
) -> tuple[dict[tuple[str, str, str], list[dict[str, Any]]], str]:
    if not parcel_keys:
        return {}, "ok"

    reg = osm_poi_regclass()
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (reg,))
    row = cur.fetchone()
    if not row or not row[0]:
        return {pk: [] for pk in parcel_keys}, "skipped_no_table"

    qualified = qualified_osm_poi_table()
    keys = list(parcel_keys)
    cis = [k[0] for k in keys]
    secs = [k[1] for k in keys]
    nums = [k[2] for k in keys]

    sql = f"""
    WITH tgt AS (
      SELECT x.code_insee, x.section, x.numero_norm
      FROM unnest(%s::text[], %s::text[], %s::text[]) AS x(code_insee, section, numero_norm)
    ),
    par AS (
      SELECT c.code_insee, c.section, c.numero_norm, c.geom
      FROM public.cadastre_france_feuilles_geom c
      INNER JOIN tgt t
        ON c.code_insee = t.code_insee
       AND c.section = t.section
       AND c.numero_norm = t.numero_norm
      WHERE c.code_insee = %s
    ),
    hits AS (
      SELECT
        p.code_insee,
        p.section,
        p.numero_norm,
        o.osm_type,
        o.osm_id,
        o.tags,
        ST_X(o.geom)::double precision AS lon,
        ST_Y(o.geom)::double precision AS lat,
        row_number() OVER (
          PARTITION BY p.code_insee, p.section, p.numero_norm
          ORDER BY o.osm_type, o.osm_id
        ) AS rn
      FROM par p
      INNER JOIN {qualified} o
        ON o.geom && p.geom
       AND ST_Within(o.geom, p.geom)
       AND lower(coalesce(o.tags->>'amenity', '')) = 'charging_station'
    )
    SELECT code_insee, section, numero_norm, osm_type, osm_id, tags, lon, lat
    FROM hits
    WHERE rn <= %s
      ORDER BY code_insee, section, numero_norm, rn
    """
    cur.execute(sql, (cis, secs, nums, code_insee, max_per_parcel))

    out: dict[tuple[str, str, str], list[dict[str, Any]]] = {pk: [] for pk in parcel_keys}
    for r in cur.fetchall():
        ci, sec, num, ot, oid, tags_raw, lon, lat = r
        pk = (str(ci), str(sec or ""), str(num or ""))
        td = tags_dict(tags_raw)
        item = normalize_osm_row_for_export(str(ot), int(oid), float(lon), float(lat), td)
        item["raw_tags"] = td
        out[pk].append(item)
    return out, "ok"
