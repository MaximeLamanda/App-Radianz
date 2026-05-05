"""
POI OpenStreetMap — normalisation des tags et jointure parcelles matching V5.

Table par défaut : public.osm_poi (sql/004_osm_poi.sql).
Surcharge : variable d'environnement OSM_POI_TABLE (schéma.table).
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def parse_qualified_table(raw: str, default_schema: str, default_table: str, label: str) -> tuple[str, str]:
    t = (raw or "").strip()
    if not t:
        return default_schema, default_table
    parts = [p.strip() for p in t.split(".") if p.strip()]
    if len(parts) == 1:
        return "public", parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError(f"{label} invalide: {raw!r}")


def validate_ident(name: str, label: str) -> None:
    if not IDENT.match(name):
        raise ValueError(f'{label} invalide: "{name}"')


def qualified_osm_poi_table() -> str:
    raw = os.environ.get("OSM_POI_TABLE", "public.osm_poi")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_poi",
        label="OSM_POI_TABLE",
    )
    validate_ident(schema, "Schéma osm_poi")
    validate_ident(table, "Table osm_poi")
    return f'"{schema}"."{table}"'


def osm_poi_regclass() -> str:
    """Identifiant pour to_regclass (sans guillemets)."""
    raw = os.environ.get("OSM_POI_TABLE", "public.osm_poi")
    schema, table = parse_qualified_table(
        raw,
        default_schema="public",
        default_table="osm_poi",
        label="OSM_POI_TABLE",
    )
    return f"{schema}.{table}"


# Ordre de priorité pour le « type » métier (première clé retenue).
POI_PRIMARY_TAG_KEYS: tuple[str, ...] = (
    "shop",
    "amenity",
    "craft",
    "office",
    "healthcare",
    "leisure",
    "tourism",
    "man_made",
)

# Clés conservées en Postgres (hors géom) — aligné sur normalisation + type POI.
# Les tags `addr:*` sont conservés dynamiquement (voir tags_stored_for_postgres).
_OSM_TAG_KEYS_FOR_STORAGE: frozenset[str] = frozenset(
    POI_PRIMARY_TAG_KEYS
    + (
        "name",
        "official_name",
        "brand",
        "operator",
        "ref",
        "website",
        "contact:website",
        "url",
        "phone",
        "contact:phone",
        "mobile",
        "contact:mobile",
        "contact:address",
    )
)

_EXCLUDED_AMENITY: frozenset[str] = frozenset(
    {
        "parking",
        "parking_space",
        "parking_entrance",
        "motorcycle_parking",
        "bicycle_parking",
        "bench",
        "waste_basket",
        "drinking_water",
        "fountain",
        "toilets",
        "bbq",
        "bicycle_repair_station",
        "vending_machine",
        "atm",
        "post_box",
        "parcel_locker",
    }
)

_EXCLUDED_LEISURE: frozenset[str] = frozenset({"playground", "picnic_table", "slipway", "firepit"})

# Libellé de la clé « primaire » pour repli client (évite leisure: valeur brute).
_OSM_PRIMARY_KEY_LABEL_FR: dict[str, str] = {
    "shop": "Commerce",
    "amenity": "Équipement",
    "craft": "Artisanat",
    "office": "Bureaux",
    "healthcare": "Santé",
    "leisure": "Loisirs",
    "tourism": "Tourisme",
    "man_made": "Ouvrage",
}

_OSM_VALUE_LABEL_FR: dict[tuple[str, str], str] = {
    ("shop", "car_repair"): "Garage / réparation auto",
    ("shop", "car"): "Concession / vente auto",
    ("shop", "supermarket"): "Supermarché",
    ("shop", "convenience"): "Supérette",
    ("shop", "optician"): "Opticien",
    ("shop", "bakery"): "Boulangerie",
    ("shop", "hairdresser"): "Coiffeur",
    ("shop", "beauty"): "Institut de beauté",
    ("shop", "hardware"): "Quincaillerie",
    ("shop", "doityourself"): "Bricolage / jardinage",
    ("amenity", "restaurant"): "Restaurant",
    ("amenity", "cafe"): "Café",
    ("amenity", "fast_food"): "Restauration rapide",
    ("amenity", "bar"): "Bar",
    ("amenity", "pub"): "Pub",
    ("amenity", "fuel"): "Station-service",
    ("amenity", "charging_station"): "Borne de recharge",
    ("amenity", "car_wash"): "Lavage auto",
    ("amenity", "dentist"): "Dentiste",
    ("amenity", "doctors"): "Médecin",
    ("amenity", "pharmacy"): "Pharmacie",
    ("amenity", "bank"): "Banque",
    ("amenity", "post_office"): "Bureau de poste",
    ("craft", "carpenter"): "Menuiserie",
    ("craft", "metal_construction"): "Métallerie",
    ("office", "company"): "Bureau entreprise",
    ("office", "yes"): "Bureau",
    ("tourism", "hotel"): "Hôtel",
    ("tourism", "motel"): "Motel",
    ("tourism", "guest_house"): "Chambre d’hôtes",
    ("tourism", "hostel"): "Auberge de jeunesse",
    ("tourism", "camp_site"): "Camping",
    ("tourism", "attraction"): "Attraction touristique",
    ("tourism", "information"): "Point d’information",
    ("tourism", "museum"): "Musée",
    ("tourism", "artwork"): "Œuvre / art urbain",
    ("tourism", "viewpoint"): "Point de vue",
    ("tourism", "zoo"): "Zoo",
    ("tourism", "theme_park"): "Parc à thème",
    ("tourism", "alpine_hut"): "Refuge de montagne",
    ("tourism", "wilderness_hut"): "Abri",
    ("shop", "yes"): "Magasin",
    ("shop", "mall"): "Centre commercial",
    ("shop", "department_store"): "Grand magasin",
    ("shop", "clothes"): "Vêtements",
    ("shop", "shoes"): "Chaussures",
    ("shop", "electronics"): "Électronique",
    ("shop", "furniture"): "Ameublement",
    ("shop", "florist"): "Fleuriste",
    ("shop", "garden_centre"): "Jardinerie",
    ("shop", "kiosk"): "Kiosque",
    ("shop", "newsagent"): "Presse / tabac",
    ("shop", "tobacco"): "Tabac",
    ("shop", "alcohol"): "Caviste",
    ("shop", "wine"): "Cave à vin",
    ("shop", "butcher"): "Boucherie",
    ("shop", "seafood"): "Poissonnerie",
    ("shop", "cheese"): "Fromagerie",
    ("shop", "pastry"): "Pâtisserie",
    ("shop", "chocolate"): "Chocolatier",
    ("shop", "coffee"): "Torréfacteur / café",
    ("shop", "tea"): "Salon de thé (commerce)",
    ("shop", "pet"): "Animalerie",
    ("shop", "books"): "Librairie",
    ("shop", "sports"): "Magasin de sport",
    ("shop", "bicycle"): "Magasin de vélos",
    ("shop", "motorcycle"): "Magasin de motos",
    ("shop", "tyres"): "Pneumatiques",
    ("shop", "car_parts"): "Pièces auto",
    ("shop", "fuel"): "Point de vente carburant",
    ("shop", "laundry"): "Laverie",
    ("shop", "dry_cleaning"): "Pressing",
    ("shop", "tailor"): "Couturier / retouches",
    ("shop", "tattoo"): "Tatouage / piercing",
    ("shop", "massage"): "Massage (commerce)",
    ("shop", "medical_supply"): "Matériel médical",
    ("shop", "funeral_directors"): "Pompes funèbres",
    ("shop", "travel_agency"): "Agence de voyages",
    ("shop", "ticket"): "Billetterie",
    ("shop", "copyshop"): "Reprographie",
    ("shop", "stationery"): "Papeterie",
    ("shop", "gift"): "Cadeaux / souvenirs",
    ("shop", "toys"): "Jouets",
    ("shop", "music"): "Disquaire / instruments",
    ("shop", "video"): "Vidéo / jeux",
    ("shop", "video_games"): "Jeux vidéo",
    ("shop", "mobile_phone"): "Téléphonie",
    ("shop", "computer"): "Informatique",
    ("shop", "hifi"): "Hi-fi",
    ("shop", "bed"): "Literie",
    ("shop", "carpet"): "Moquettes / tapis",
    ("shop", "curtain"): "Rideaux",
    ("shop", "interior_decoration"): "Décoration",
    ("shop", "lighting"): "Luminaires",
    ("shop", "paint"): "Peinture / droguerie",
    ("shop", "trade"): "Fournitures pro",
    ("shop", "wholesale"): "Vente en gros",
    ("shop", "second_hand"): "Occasion",
    ("shop", "charity"): "Commerce solidaire",
    ("amenity", "kindergarten"): "Crèche / maternelle",
    ("amenity", "school"): "École",
    ("amenity", "college"): "Collège / lycée",
    ("amenity", "university"): "Université",
    ("amenity", "library"): "Bibliothèque",
    ("amenity", "community_centre"): "Centre socioculturel",
    ("amenity", "social_facility"): "Établissement social",
    ("amenity", "place_of_worship"): "Lieu de culte",
    ("amenity", "grave_yard"): "Cimetière",
    ("amenity", "crematorium"): "Crématorium",
    ("amenity", "marketplace"): "Marché",
    ("amenity", "nightclub"): "Boîte de nuit",
    ("amenity", "casino"): "Casino",
    ("amenity", "cinema"): "Cinéma",
    ("amenity", "theatre"): "Théâtre",
    ("amenity", "arts_centre"): "Centre culturel",
    ("amenity", "studio"): "Studio",
    ("amenity", "music_school"): "École de musique",
    ("amenity", "driving_school"): "Auto-école",
    ("amenity", "language_school"): "École de langues",
    ("amenity", "dive_centre"): "Centre de plongée",
    ("amenity", "veterinary"): "Vétérinaire",
    ("amenity", "animal_shelter"): "Refuge animalier",
    ("amenity", "clinic"): "Clinique",
    ("amenity", "hospital"): "Hôpital",
    ("amenity", "nursing_home"): "EHPAD / maison de retraite",
    ("amenity", "social_centre"): "Centre social",
    ("amenity", "police"): "Police",
    ("amenity", "fire_station"): "Caserne de pompiers",
    ("amenity", "townhall"): "Mairie",
    ("amenity", "courthouse"): "Tribunal",
    ("amenity", "prison"): "Établissement pénitentiaire",
    ("amenity", "embassy"): "Ambassade",
    ("amenity", "ranger_station"): "Poste forestier",
    ("amenity", "bicycle_rental"): "Location de vélos",
    ("amenity", "boat_rental"): "Location de bateaux",
    ("amenity", "car_rental"): "Location de voitures",
    ("amenity", "motorcycle_rental"): "Location de motos",
    ("amenity", "taxi"): "Station taxi",
    ("amenity", "bureau_de_change"): "Change",
    ("amenity", "money_transfer"): "Transfert d’argent",
    ("amenity", "payment_terminal"): "Terminal de paiement",
    ("amenity", "vending_machine"): "Distributeur",
    ("amenity", "recycling"): "Point de collecte",
    ("amenity", "waste_transfer_station"): "Déchetterie",
    ("leisure", "amusement_arcade"): "Salle d'arcades",
    ("leisure", "adult_gaming_centre"): "Salle de jeux (adultes)",
    ("leisure", "bowling_alley"): "Bowling",
    ("leisure", "dance"): "Salle de danse",
    ("leisure", "escape_game"): "Escape game",
    ("leisure", "fitness_centre"): "Salle de sport",
    ("leisure", "fitness_station"): "Parcours santé / agrès",
    ("leisure", "golf_course"): "Golf",
    ("leisure", "hackerspace"): "Hackerspace / fab lab",
    ("leisure", "horse_riding"): "Équitation",
    ("leisure", "ice_rink"): "Patinoire",
    ("leisure", "marina"): "Port de plaisance",
    ("leisure", "miniature_golf"): "Mini-golf",
    ("leisure", "park"): "Parc",
    ("leisure", "pitch"): "Terrain de sport",
    ("leisure", "sauna"): "Sauna",
    ("leisure", "sports_centre"): "Complexe sportif",
    ("leisure", "stadium"): "Stade",
    ("leisure", "swimming_pool"): "Piscine",
    ("leisure", "swimming_area"): "Zone de baignade",
    ("leisure", "track"): "Piste",
    ("leisure", "trampoline_park"): "Parc de trampolines",
    ("leisure", "water_park"): "Parc aquatique",
    ("leisure", "wild_swimming"): "Baignade en eau libre",
    ("leisure", "bird_hide"): "Observatoire d’oiseaux",
    ("leisure", "common"): "Terrain communal",
    ("leisure", "dog_park"): "Aire pour chiens",
    ("leisure", "firepit"): "Foyer extérieur",
    ("leisure", "garden"): "Jardin",
    ("leisure", "nature_reserve"): "Réserve naturelle",
    ("leisure", "outdoor_seating"): "Terrasse / sièges extérieurs",
    ("leisure", "picnic_table"): "Table de pique-nique",
    ("leisure", "playground"): "Aire de jeux",
    ("leisure", "slipway"): "Cale de mise à l’eau",
    ("leisure", "tanning_salon"): "Solarium",
    ("leisure", "yoga"): "Yoga",
    ("leisure", "beach_resort"): "Station balnéaire",
    ("leisure", "bandstand"): "Kiosque à musique",
    ("leisure", "bingo"): "Bingo",
    ("leisure", "disc_golf_course"): "Disc golf",
    ("leisure", "fishing"): "Pêche",
    ("leisure", "high_ropes_course"): "Accrobranche",
    ("leisure", "maze"): "Labyrinthe",
    ("leisure", "paintball"): "Paintball",
    ("leisure", "resort"): "Complexe touristique",
    ("leisure", "sports_hall"): "Salle omnisports",
    ("leisure", "water_point"): "Point d’eau",
    ("healthcare", "hospital"): "Hôpital",
    ("healthcare", "clinic"): "Clinique",
    ("healthcare", "doctors"): "Cabinet médical",
    ("healthcare", "dentist"): "Cabinet dentaire",
    ("healthcare", "physiotherapist"): "Kinésithérapeute",
    ("healthcare", "alternative"): "Médecine douce",
    ("healthcare", "podiatrist"): "Podologue",
    ("healthcare", "psychotherapist"): "Psychothérapeute",
    ("healthcare", "speech_therapist"): "Orthophoniste",
    ("healthcare", "laboratory"): "Laboratoire d’analyses",
    ("healthcare", "sample_collection"): "Prélèvement",
    ("healthcare", "counselling"): "Conseil santé",
    ("man_made", "tower"): "Tour",
    ("man_made", "mast"): "Antenne / pylône",
    ("man_made", "works"): "Ouvrage technique",
    ("man_made", "pipeline"): "Canalisation",
    ("man_made", "surveillance"): "Vidéosurveillance",
    ("man_made", "survey_point"): "Repère de nivellement",
    ("man_made", "lighthouse"): "Phare",
    ("man_made", "pier"): "Jetée / ponton",
    ("man_made", "bridge"): "Pont",
    ("man_made", "crane"): "Grue",
    ("man_made", "storage_tank"): "Cuve / réservoir",
    ("man_made", "water_tower"): "Château d’eau",
    ("man_made", "wastewater_plant"): "Station d’épuration",
    ("man_made", "water_works"): "Station de traitement d’eau",
}


def tags_dict(tags: Any) -> dict[str, str]:
    if tags is None:
        return {}
    if isinstance(tags, dict):
        return {str(k): str(v) for k, v in tags.items() if v is not None and str(v).strip() != ""}
    return {}


def _osm_tag_key_stored(key: str) -> bool:
    k = str(key).strip()
    if not k:
        return False
    if k in _OSM_TAG_KEYS_FOR_STORAGE:
        return True
    lk = k.lower()
    return lk.startswith("addr:")


def tags_stored_for_postgres(tags: dict[str, str]) -> dict[str, str]:
    """
    Sous-ensemble des tags écrits en JSONB : uniquement ce qui sert au matching V5
    et à l’export (nom, site, téléphone, type POI, adresse OSM addr:* / contact:address).
    Pas de building=*, source, etc.
    """
    out: dict[str, str] = {}
    for k, v in tags.items():
        if not _osm_tag_key_stored(k):
            continue
        s = str(v).strip()
        if s:
            out[str(k).strip()] = s
    return out


def poi_tags_interesting(tags: dict[str, str]) -> bool:
    for k in list(tags.keys()):
        lk = k.lower()
        if lk.startswith("disused:") or lk.startswith("abandoned:") or lk.startswith("was:"):
            return False
    for key in POI_PRIMARY_TAG_KEYS:
        v = tags.get(key)
        if not v or not str(v).strip():
            continue
        val = str(v).strip().lower()
        if key == "amenity" and val in _EXCLUDED_AMENITY:
            continue
        if key == "leisure" and val in _EXCLUDED_LEISURE:
            continue
        return True
    return False


def _display_name(tags: dict[str, str]) -> str:
    for k in ("name", "official_name", "brand", "operator"):
        v = tags.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _website(tags: dict[str, str]) -> str:
    for k in ("website", "contact:website", "url"):
        v = tags.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _phone(tags: dict[str, str]) -> str:
    for k in ("phone", "contact:phone", "mobile", "contact:mobile"):
        v = tags.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _format_osm_address(tags: dict[str, str]) -> str:
    """
    Une ligne lisible à partir des tags addr:* (ou contact:address en secours).
    """
    full = (tags.get("addr:full") or "").strip()
    if full:
        return full
    hn = (tags.get("addr:housenumber") or "").strip()
    hname = (tags.get("addr:housename") or "").strip()
    street = (tags.get("addr:street") or "").strip()
    place = (tags.get("addr:place") or "").strip()
    ext = (tags.get("addr:unit") or tags.get("addr:flats") or "").strip()

    line1_bits: list[str] = []
    if hn or hname:
        nb = " ".join(p for p in (hn, hname) if p).strip()
        if nb:
            line1_bits.append(nb)
    if street:
        line1_bits.append(street)
    elif place and not street:
        line1_bits.append(place)
    line1 = " ".join(line1_bits).strip()
    if ext and line1:
        line1 = f"{line1}, {ext}"
    elif ext:
        line1 = ext

    city = (
        (tags.get("addr:city") or "").strip()
        or (tags.get("addr:town") or "").strip()
        or (tags.get("addr:village") or "").strip()
    )
    pc = (tags.get("addr:postcode") or "").strip()
    suburb = (tags.get("addr:suburb") or "").strip()
    line2_bits: list[str] = []
    if pc:
        line2_bits.append(pc)
    if city:
        line2_bits.append(city)
    elif suburb:
        line2_bits.append(suburb)
    line2 = " ".join(line2_bits).strip()

    country = (tags.get("addr:country") or "").strip()
    parts: list[str] = []
    if line1:
        parts.append(line1)
    if line2:
        parts.append(line2)
    if country:
        cu = country.upper()
        if not parts:
            parts.append(country)
        elif cu not in ("FR", "FRA", "FRANCE"):
            parts.append(country)

    out = ", ".join(parts).strip()
    if out:
        return out
    contact = (tags.get("contact:address") or "").strip()
    return contact


def _primary_type(tags: dict[str, str]) -> tuple[str | None, str | None]:
    for key in POI_PRIMARY_TAG_KEYS:
        v = tags.get(key)
        if not v or not str(v).strip():
            continue
        val = str(v).strip().lower()
        if key == "amenity" and val in _EXCLUDED_AMENITY:
            continue
        if key == "leisure" and val in _EXCLUDED_LEISURE:
            continue
        return key, str(v).strip()
    return None, None


def poi_type_label_fr(primary_key: str | None, primary_value: str | None) -> str:
    if not primary_key or not primary_value:
        return ""
    k = primary_key.strip().lower()
    v = primary_value.strip().lower()
    hit = _OSM_VALUE_LABEL_FR.get((k, v))
    if hit:
        return hit
    cat = _OSM_PRIMARY_KEY_LABEL_FR.get(k) or primary_key.strip().replace("_", " ").strip().capitalize()
    raw_val = primary_value.strip()
    slug = raw_val.replace("_", " ").strip()
    if not slug:
        return cat
    pretty = " ".join(part.capitalize() for part in slug.split())
    return f"{cat} — {pretty}"


def osm_browse_url(osm_type: str, osm_id: int) -> str:
    t = (osm_type or "n").strip().lower()
    path = {"n": "node", "w": "way", "r": "relation"}.get(t, "node")
    return f"https://www.openstreetmap.org/{path}/{int(osm_id)}"


def normalize_osm_row_for_export(
    osm_type: str,
    osm_id: int,
    lon: float,
    lat: float,
    tags: dict[str, str],
) -> dict[str, Any]:
    pk, pv = _primary_type(tags)
    name = _display_name(tags)
    label_type = poi_type_label_fr(pk, pv)
    addr = _format_osm_address(tags)
    return {
        "osm_type": str(osm_type or "n").strip().lower()[:1],
        "osm_id": int(osm_id),
        "name": name,
        "address": addr,
        "website": _website(tags),
        "phone": _phone(tags),
        "poi_primary_key": pk,
        "poi_primary_value": pv,
        "poi_type_label": label_type,
        "osm_url": osm_browse_url(osm_type, osm_id),
        "lat": float(lat),
        "lng": float(lon),
    }


def empty_osm_poi_audit() -> dict[str, Any]:
    return {
        "osm_pois_json": "[]",
        "osm_poi_count": 0,
        "osm_pois_status": "",
        "osm_poi_truncated": 0,
        "osm_data_as_of": "",
    }


def parcel_osm_export_columns(
    pk: tuple[str, str, str],
    *,
    osm_by_pk: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]],
    global_status: str,
    osm_data_as_of: str,
    disabled: bool,
) -> dict[str, Any]:
    """Champs plats CSV / GeoJSON / properties_json pour une parcelle exportée."""
    if disabled:
        return {
            **empty_osm_poi_audit(),
            "osm_pois_status": "disabled",
        }
    if global_status == "skipped_no_table":
        return {
            **empty_osm_poi_audit(),
            "osm_pois_status": "skipped_no_table",
        }
    if global_status == "error":
        return {
            **empty_osm_poi_audit(),
            "osm_pois_status": "error",
        }
    pois, n, trunc = osm_by_pk.get(pk, ([], 0, 0))
    return {
        "osm_pois_json": json.dumps(pois, ensure_ascii=False),
        "osm_poi_count": int(n),
        "osm_pois_status": "ok",
        "osm_poi_truncated": int(trunc),
        "osm_data_as_of": str(osm_data_as_of or "").strip(),
    }


def building_osm_export_columns() -> dict[str, Any]:
    """Grain building : pas de jointure parcelle unique."""
    return {
        **empty_osm_poi_audit(),
        "osm_pois_status": "not_applicable",
    }


def fetch_osm_pois_for_parcel_keys(
    cur: Any,
    code_insee: str,
    parcel_keys: set[tuple[str, str, str]],
    *,
    max_per_parcel: int = 50,
    osm_data_as_of: str = "",
) -> tuple[dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]], str, str]:
    """
    Retourne (mapping parcel_key -> (liste POI normalisés, count affiché, tronqués), status, osm_data_as_of).
    status: ok | skipped_no_table (relation public.osm_poi absente du catalogue Postgres)
    """
    if not parcel_keys:
        return {}, "ok", str(osm_data_as_of or "")

    reg = osm_poi_regclass()
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (reg,))
    row = cur.fetchone()
    if not row or not row[0]:
        empty: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]] = {
            pk: ([], 0, 0) for pk in parcel_keys
        }
        return empty, "skipped_no_table", str(osm_data_as_of or "")

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
        ST_Distance(
          o.geom::geography,
          ST_PointOnSurface(p.geom)::geography
        )::double precision AS dist_m
      FROM par p
      INNER JOIN {qualified} o
        ON o.geom && p.geom
       AND ST_Within(o.geom, p.geom)
    ),
    ranked AS (
      SELECT *,
        row_number() OVER (
          PARTITION BY code_insee, section, numero_norm
          ORDER BY dist_m NULLS LAST, osm_type, osm_id
        ) AS rn,
        count(*) OVER (PARTITION BY code_insee, section, numero_norm) AS cnt_all
      FROM hits
    )
    SELECT code_insee, section, numero_norm, osm_type, osm_id, tags, lon, lat, rn, cnt_all
    FROM ranked
    WHERE rn <= %s
    ORDER BY code_insee, section, numero_norm, rn
    """

    cur.execute(sql, (cis, secs, nums, code_insee, max_per_parcel))

    out: dict[tuple[str, str, str], list[dict[str, Any]]] = {pk: [] for pk in parcel_keys}
    cnt_all_by_pk: dict[tuple[str, str, str], int] = {}

    for r in cur.fetchall():
        ci, sec, num, ot, oid, tags_raw, lon, lat, _rn, cnt_all = r
        pk = (str(ci), str(sec or ""), str(num or ""))
        try:
            ca = int(cnt_all)
        except (TypeError, ValueError):
            ca = 0
        cnt_all_by_pk[pk] = max(cnt_all_by_pk.get(pk, 0), ca)
        td = tags_dict(tags_raw)
        if not poi_tags_interesting(td):
            continue
        item = normalize_osm_row_for_export(str(ot), int(oid), float(lon), float(lat), td)
        out[pk].append(item)

    result: dict[tuple[str, str, str], tuple[list[dict[str, Any]], int, int]] = {}
    for pk in parcel_keys:
        lst = out.get(pk, [])
        ca = cnt_all_by_pk.get(pk, len(lst))
        trunc_n = max(0, ca - max_per_parcel)
        result[pk] = (lst, len(lst), trunc_n)

    return result, "ok", str(osm_data_as_of or "")
