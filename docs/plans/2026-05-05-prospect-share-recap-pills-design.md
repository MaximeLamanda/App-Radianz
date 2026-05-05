# Design — Pills récap `ProspectSharePage` (client)

## Contexte

La page partagée `/p/[shareToken]` (`ProspectSharePage`) affiche sous le titre du projet une rangée `drawer-discovery-pills`. Objectif : informations **compréhensibles pour le client**, **sans score** ni métrique interne (matching V5, `qualityScore`, etc.).

## Décisions produit

1. **Priorité « bénéfices »** : mettre en avant la production estimée et l’impact CO₂ en haut de page.
2. **Surface parcelle** : afficher l’aire **cadastrale** (contour(s) parcelle(s) sur la carte), alignée sur la logique du tiroir Discovery (`cartePolygonAreaM2` : somme des aires approximatives des polygones parcelle du cluster, ou polygone unique).
3. **Duplication CO₂ acceptée** : une pill récap reprend le **même ordre de grandeur** que `RadianzCo2AvoidanceRadial` (tonnes CO₂ évitées / an, facteur indicatif **0,052 kg CO₂e / kWh**). La carte reste le support visuel détaillé (% vs consommation) ; la pill sert d’**aperçu immédiat** avant scroll.
4. **kWp** : conservé comme repère technique court (puissance crête du scénario affiché).

## Contenu des pills (ordre suggéré)

| Ordre | Contenu | Source / calcul | Masquage si absent |
|------|---------|-----------------|---------------------|
| 1 | Production estimée **MWh/an** | `effectiveConfig.effectiveAnnualProductionKwh` / 1000 | Pas de production valide |
| 2 | **CO₂ évités / an** (≈ X,X **t**) | `annualProductionKwh × 0,052 / 1000` (même règle que la carte) | Même condition que `hasData` de la carte : prod ≤ 0 ou (conso ≤ 0 et rien à afficher) — aligner sur le composant radial pour éviter deux logiques |
| 3 | **Surface parcelle** (m²) | Champ persisté sur le prospect (voir données) | Champ absent ou ≤ 0 |
| 4 | **kWp** | `effectiveConfig.effectiveKwp` | kWp ≤ 0 |

**Retrait du bandeau récap** : la pill **m² de toit utile** n’est plus affichée ici pour limiter à **quatre** pills et éviter deux surfaces (parcelle vs toit) côte à côte dans la même ligne. La surface de dimensionnement reste accessible dans le reste de l’étude si nécessaire ailleurs.

## Style / UX

- Même famille de `Badge` que l’existant (pill sombre pour métrique « primaire », muted pour contexte).
- Icône **topo** (`/Topoicon.svg`) pour la surface parcelle, comme dans le tiroir interne.
- `title` / `aria` sur la pill CO₂ : rappel court de l’hypothèse **~52 g CO₂e / kWh** (cohérent avec le sous-texte de la carte).

## Données — surface parcelle

Le document Firestore **Prospect** ne contient pas aujourd’hui cette aire. **À ajouter** :

- Champ proposé : `parcelContourAreaM2?: number` (ou nom équivalent aligné sur le code).
- Remplissage : au passage **Discovery → prospect** (`matching-v5-to-prospect` + `prepareProspectForFirestore` / `prospectFromFirestore`), calcul identique au drawer :  
  `parcelleCluster.reduce((s,p) => s + polygonAreaM2ApproxWgs84(p.geometry), 0)` ou `polygonAreaM2ApproxWgs84(row.geometry)` si pas de cluster parcelle.

Prospects **non Discovery** : champ vide → pill parcelle non affichée.

## CO₂ — factorisation (recommandation impl.)

Extraire la constante et le calcul « kg évités / an » dans un petit module partagé (ex. `lib/co2-avoidance-fr.ts`) utilisé par `RadianzCo2AvoidanceRadial` et par `ProspectSharePage`, pour garantir qu’**aucune dérive** n’apparaît entre pill et carte.

## Hors scope

- Afficher le **pourcentage** CO₂ dans la pill (réservé au radial).
- Score, IRIS détaillé, ou métriques pipeline dans ce bandeau.
