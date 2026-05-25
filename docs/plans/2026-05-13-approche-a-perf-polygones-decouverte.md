# Approche A — performance affichage Découverte (implémenté)

**Objectif :** alléger le rendu MVT bâtiments et le surlignage parcelles (Leaflet) sans migration WebGL.

## Tuiles MVT (`/api/matching-v5/tiles/{z}/{x}/{y}`)

- **Cache HTTP :** `Cache-Control: private, max-age=600` (navigateur uniquement, route authentifiée).
- **ETag faible :** hash SHA-256 (révision + z/x/y + corps binaire) ; réponse **304** si `If-None-Match` correspond.
- **Invalidation :** variable d’environnement `SCOUT_BUILDINGS_MVT_REVISION` (défaut `0`) — à incrémenter après `REFRESH` de la MV ou pour forcer le rechargement client. Le script `scripts/refresh-matching-v5-buildings-mv.mjs` rappelle cette astuce en fin de succès.
- **PostGIS :** `ST_SimplifyPreserveTopology(geom, tolerance_deg)` avant `ST_Transform` ; tolérance pilotée par `toleranceDegForMatchingV5MvtZoom` dans [lib/matching-v5-mvt-simplify.ts](lib/matching-v5-mvt-simplify.ts).
- **Payload MVT :** seule la propriété nécessaire au style/clic : `osm_building_id` (plus de `matching_status` dans la tuile).
- **LRU processus :** jusqu’à 256 tuiles mises en cache en RAM (clé `révision:z:x:y`) pour limiter les hits Postgres sur une même instance.

## Clusters overview (zoom ≤ 15)

- **1 marqueur par combo** : regroupement client (`lib/discovery-combo-markers.ts`) = même composante « partage » que le surlignage multi-parcelles / multi-bâtiments au clic.
- Centroïde du combo ; clic cluster → ancre parcelle canonique (tri cadastre). Voir [`2026-05-20-discovery-combo-clusters-design.md`](2026-05-20-discovery-combo-clusters-design.md).

## Surlignage parcelles ([components/discovery/DiscoveryMapView.tsx](components/discovery/DiscoveryMapView.tsx))

- Simplification Douglas–Peucker côté client pour l’affichage uniquement : [lib/geojson-simplify-display.ts](lib/geojson-simplify-display.ts), tolérance liée au zoom via `toleranceDegForParcelHighlightZoom`.

## Vérification

- Tests unitaires : `npm run test:unit` (modules `matching-v5-mvt-*`, `geojson-simplify-display`).
- Manuel : DevTools réseau — enchaîner pan/zoom sur la même tuile ; observer éventuelles **304** et taille des réponses ; après bump de `SCOUT_BUILDINGS_MVT_REVISION`, vérifier que les tuiles se rechargent (nouveau ETag).
