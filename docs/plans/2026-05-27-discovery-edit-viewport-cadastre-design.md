# Discovery — cadastre zone visible en mode édition périmètre

**Date :** 2026-05-27  
**Statut :** Validé / implémenté

## Problème

En personnalisation (« Modifier le périmètre »), seules les parcelles **frontalières** (touchantes + buffer 5 m) étaient proposées. L’utilisateur souhaite voir et sélectionner **toutes les parcelles cadastrales de la zone visible** à l’écran au moment d’entrer en édition.

## Décisions produit

| Sujet | Décision |
|-------|----------|
| Zone chargée | Bbox viewport **figée** à l’entrée en mode édition |
| Refetch au pan | Non |
| Zoom min | `viewportZoom > DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM` (15) |
| Bbox max | ~800 m × 800 m (refus client + serveur) |
| Exclusions | Périmètre effectif au clic « Modifier » (`exclude_ids`) |
| Limite résultats | 200 parcelles ; `truncated: true` + toast si atteint |
| Multi-commune | Jusqu’à 3 `code_insee` dérivés des parcelles du combo |

## API

`GET /api/matching-v5/parcelles-adjacent` — deux modes :

1. **bbox** (Discovery édition) : `swLat`, `swLng`, `neLat`, `neLng`, `code_insee`, `exclude_ids` → `ST_Intersects` sur `cadastre_france_feuilles_geom`
2. **anchor** (legacy) : `parcelle_ids`, `buffer_m`, `exclude_ids` → `ST_Touches` / `ST_DWithin`

Jointures matching V5 + combos inchangées (fusion au clic).

## Fichiers

| Fichier | Rôle |
|---------|------|
| `lib/matching-v5-parcelles-adjacent-http.ts` | Parsing bbox / anchor, garde-fou surface |
| `app/api/matching-v5/parcelles-adjacent/route.ts` | SQL mode bbox |
| `app/discovery/page.tsx` | Figement viewport, fetch bbox, garde zoom |
| `components/discovery/DiscoveryEditModeStatusBanner.tsx` | Libellés |

## Hors scope v1

- Bouton « Actualiser la zone visible »
- Style distinct frontalière vs zone
- Refetch automatique au pan

## Références

- `docs/plans/2026-05-24-discovery-combo-edit-mode-design.md`
- `docs/plans/2026-05-25-discovery-combo-firebase-personalization-design.md`
