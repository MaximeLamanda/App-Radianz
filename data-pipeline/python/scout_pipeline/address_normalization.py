from __future__ import annotations

import re
import unicodedata


_VOIE_ALIASES = {
    "AV": "AVENUE",
    "AV.": "AVENUE",
    "AVE": "AVENUE",
    "BD": "BOULEVARD",
    "BD.": "BOULEVARD",
    "BLVD": "BOULEVARD",
    "RTE": "ROUTE",
    "RTE.": "ROUTE",
    "CHE": "CHEMIN",
    "CHE.": "CHEMIN",
    "ALL": "ALLEE",
    "ALL.": "ALLEE",
    "PL": "PLACE",
    "PL.": "PLACE",
    "FG": "FAUBOURG",
    "FG.": "FAUBOURG",
    "IMP": "IMPASSE",
    "IMP.": "IMPASSE",
}


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def normalize_text(text: str | None) -> str:
    raw = _strip_accents(str(text or "")).upper()
    raw = raw.replace("'", " ").replace("-", " ")
    raw = re.sub(r"[^A-Z0-9\s]", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def normalize_numero(text: str | None) -> str:
    v = normalize_text(text)
    m = re.search(r"\d{1,5}", v)
    return m.group(0) if m else ""


def street_number_match_set(numero: str | None) -> frozenset[str]:
    """Ensemble des numéros de voirie (1–5 chiffres) après normalisation — gère plages du type 12-14."""
    v = normalize_text(numero or "")
    if not v:
        return frozenset()
    return frozenset(re.findall(r"\d{1,5}", v))


def normalize_indice_for_match(text: str | None) -> str:
    """BIS / TER / QUATER uniquement ; tout le reste est traité comme absence d’indice pour le score conflit."""
    v = normalize_indice_repetition(text)
    if v in {"BIS", "TER", "QUATER"}:
        return v
    return ""


def normalize_indice_repetition(text: str | None) -> str:
    v = normalize_text(text)
    if v in {"B", "BIS"}:
        return "BIS"
    if v in {"T", "TER"}:
        return "TER"
    if v in {"Q", "QUATER"}:
        return "QUATER"
    return v


def normalize_voie_type(text: str | None) -> str:
    v = normalize_text(text)
    if not v:
        return ""
    return _VOIE_ALIASES.get(v, v)


def normalize_cp(text: str | None) -> str:
    v = normalize_text(text)
    m = re.search(r"\d{5}", v)
    return m.group(0) if m else ""


def normalize_address_parts(
    *,
    numero: str | None,
    indice_repetition: str | None,
    type_voie: str | None,
    libelle_voie: str | None,
    commune: str | None,
    code_postal: str | None = None,
) -> dict[str, str]:
    numero_norm = normalize_numero(numero)
    indice_norm = normalize_indice_repetition(indice_repetition)
    type_norm = normalize_voie_type(type_voie)
    voie_norm = normalize_text(libelle_voie)
    commune_norm = normalize_text(commune)
    cp_norm = normalize_cp(code_postal)
    road_parts = [p for p in (numero_norm, indice_norm, type_norm, voie_norm) if p]
    road = " ".join(road_parts)
    city_parts = [p for p in (cp_norm, commune_norm) if p]
    locality = " ".join(city_parts)
    address_norm = ", ".join([p for p in (road, locality) if p]).strip()
    return {
        "numero_norm": numero_norm,
        "indice_norm": indice_norm,
        "type_voie_norm": type_norm,
        "voie_norm": voie_norm,
        "commune_norm": commune_norm,
        "code_postal_norm": cp_norm,
        "address_norm": address_norm,
    }
