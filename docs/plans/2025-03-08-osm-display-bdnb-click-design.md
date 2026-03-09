# Design : OSM pour l'affichage, BDNB au clic

**Date :** 2025-03-08  
**Statut :** Validé  
**Périmètre :** France uniquement (v1)

## Objectif

Remplacer le chargement des tuiles BDNB pour l'affichage par l'API Overpass (OSM). Les polygones OSM servent à l'affichage et à la surface. BDNB n'est appelé qu'au clic pour récupérer uniquement l'année de construction.

## Décisions de conception

| Décision | Choix |
|----------|-------|
| Source des polygones | OSM (Overpass) |
| Source de la surface | Toujours OSM |
| Données BDNB utilisées | Année uniquement (anneeConstruction) |
| Clic carte (hors polygone) | Supprimé – seul le clic sur polygone OSM crée un prospect |
| Adresse / POI | Géocodage simple (v1) – recherche POI en phase 2 |
| Style polygones | Bleu conservé (#60A5FA) |

## Architecture

```
Affichage (bounds, zoom ≥ 16)
    → Overpass API → polygones OSM
    → Affichage en bleu sur Google Maps

Clic sur polygone OSM
    → Centroïde du polygone
    → En parallèle : Geocoder(centroïde) → adresse
    → En parallèle : BDNB point(centroïde) → anneeConstruction
    → Prospect = { polygon OSM, area OSM, address, anneeConstruction? }
    → Drawer ouvert
```

## Flux de données

### API

| Route | Rôle |
|-------|------|
| `GET /api/osm-buildings?swLat=&swLng=&neLat=&neLng=` | Overpass : ways building dans la bbox, format `{ id, polygonSurfaces }` |
| `GET /api/bdnb?lat=&lng=` | Inchangé, mode point – on utilise uniquement `anneeConstruction` |

### Hook SWR

- `useOsmBuildings(bounds)` remplace `useBdnbTiles`
- Une requête par bounds (pas de grille de tuiles)
- Clé : `["osm-buildings", bounds]`

### MapComponent

- Affichage : polygones OSM (bleu) + polygones prospect (jaune)
- Clic : uniquement sur polygones OSM → handler dédié
- Supprimé : `useBdnbTiles`, `supplementalBdnbBatiments`, fetch BDNB sur clic carte

### Prospect créé au clic

- `address` : Geocoder(centroïde)
- `coordinates` : centroïde
- `roofSurface` / `roofSurfaces` : polygone OSM (aire calculée côté client)
- `anneeConstruction` : BDNB si trouvé, sinon undefined
- Pas de `bdnbBatimentId` (pas de lien OSM ↔ BDNB)

**Règle d'unicité des ids de surfaces :** Les surfaces créées depuis OSM doivent avoir un id incluant l'id du bâtiment (`osmBuilding.id`) pour éviter les collisions lorsque plusieurs bâtiments sont fusionnés ou comparés. Format recommandé : `${osmBuilding.id}-${index}`.

## Gestion des erreurs

| Cas | Comportement |
|-----|--------------|
| Overpass timeout/erreur | Pas de polygones, pas de toast |
| BDNB ne trouve rien | Prospect créé sans anneeConstruction |
| Geocoder échoue | Adresse = "lat, lng" |
| Zoom < 16 | Pas de chargement OSM |
| Clic sur POI Google | Comportement actuel conservé (processPlaceDetails) |

## Seuils

- Zoom ≥ 16 pour afficher les bâtiments
- Debounce 400 ms sur le mouvement de carte
