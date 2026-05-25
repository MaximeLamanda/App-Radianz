"""
Enedis open data — consommation annuelle entreprise par adresse (matching V5 / Discovery).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

ENEDIS_DATASET_ID = "consommation-annuelle-entreprise-par-adresse"
ENEDIS_RECORDS_URL = (
    "https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets/"
    f"{ENEDIS_DATASET_ID}/records"
)

GEOCODE_MIN_SCORE = 0.75
COMMUNE_BATCH_SIZE = 40
ODS_PAGE_SIZE = 100


def normalize_address_key(label: str) -> str:
    s = unicodedata.normalize("NFD", str(label or "").strip().lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def format_address_label(record: dict[str, Any]) -> str | None:
    commune = str(record.get("nom_commune") or "").strip()
    parts: list[str] = []

    num = record.get("numero_de_voie")
    if num is not None and str(num).strip():
        parts.append(str(num).strip())
    rep = str(record.get("indice_de_repetition") or "").strip()
    if rep:
        parts.append(rep)

    type_voie = str(record.get("type_de_voie") or "").strip()
    libelle = str(record.get("libelle_de_voie") or "").strip()
    street = " ".join(x for x in (type_voie, libelle) if x).strip()
    if street:
        parts.append(street)
    else:
        adresse = str(record.get("adresse") or "").strip()
        if adresse:
            parts.append(adresse)
        else:
            iris = str(record.get("nom_iris") or "").strip()
            if iris:
                parts.append(iris)

    if commune:
        parts.append(commune)
    label = " ".join(parts).replace("  ", " ").strip()
    return label if len(label) >= 5 else None


def site_id_from_record(record: dict[str, Any]) -> str:
    cc = str(record.get("code_commune") or "").strip()
    year = str(record.get("annee") or "").strip()
    tri = record.get("tri_des_adresses")
    if cc and year and tri is not None:
        try:
            t = int(tri)
            if t >= 0:
                return f"{cc}:{year}:{t}"
        except (TypeError, ValueError):
            pass
    label = format_address_label(record) or ""
    mwh = record.get("consommation_annuelle_totale_de_ladresse_mwh") or 0
    return f"{cc}:{year}:{normalize_address_key(label)}:{mwh}"


def _escape_ods_string(value: str) -> str:
    return str(value).replace("'", "''")


def build_ods_where_communes(code_communes: list[str], annee: str) -> str:
    codes = [c.strip() for c in code_communes if re.fullmatch(r"\d{5}", str(c).strip())]
    if not codes:
        return "false"
    in_list = ", ".join(f"'{_escape_ods_string(c)}'" for c in codes)
    return f"code_commune IN ({in_list}) AND annee = '{_escape_ods_string(annee)}'"


def is_valid_wgs84(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return (
        la == la
        and ln == ln
        and -90 <= la <= 90
        and -180 <= ln <= 180
    )


def accept_geocode_hit(hit: Any, code_commune: str, min_score: float = GEOCODE_MIN_SCORE) -> bool:
    if hit is None:
        return False
    cc = str(code_commune).strip()
    if not re.fullmatch(r"\d{5}", cc):
        return False
    if hit.score < min_score:
        return False
    if not is_valid_wgs84(hit.lat, hit.lon):
        return False
    return str(hit.citycode or "").strip() == cc


def parse_record_row(record: dict[str, Any]) -> dict[str, Any] | None:
    code_commune = str(record.get("code_commune") or "").strip()
    annee_raw = str(record.get("annee") or "").strip()
    try:
        annee = int(annee_raw)
    except ValueError:
        return None
    mwh = record.get("consommation_annuelle_totale_de_ladresse_mwh")
    try:
        mwh_f = float(mwh)
    except (TypeError, ValueError):
        return None
    if not re.fullmatch(r"\d{5}", code_commune) or mwh_f <= 0:
        return None
    label = format_address_label(record)
    if not label:
        return None
    naf = str(record.get("code_secteur_naf2") or "").strip() or None
    secteur = str(record.get("code_grand_secteur") or "").strip() or None
    try:
        n_sites = int(record.get("nombre_de_sites") or 1)
    except (TypeError, ValueError):
        n_sites = 1
    return {
        "site_id": site_id_from_record(record),
        "code_commune": code_commune,
        "annee": annee,
        "mwh": mwh_f,
        "adresse_label": label,
        "code_secteur_naf2": naf,
        "code_grand_secteur": secteur,
        "nombre_de_sites": max(1, n_sites),
    }
