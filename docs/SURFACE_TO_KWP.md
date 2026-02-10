# Calcul du kWp à partir de la surface de toit dessinée

## Objectif

À partir de la **surface de toit** dessinée sur la carte (polygone dont l’aire est calculée en m²), on estime la **puissance crête (kWp)** que l’on peut installer sur ce toit.

## Raisonnement en 3 étapes

### 1. Surface de toit (m²)

- L’utilisateur dessine un polygone sur la carte pour délimiter la surface du toit.
- L’aire est calculée en m² à partir des coordonnées géographiques (projection locale + formule de Shoelace).
- Cette valeur est la **surface brute** du toit.

### 2. Surface réellement utilisable (m²)

On ne peut pas couvrir 100 % du toit avec des panneaux :

- obstacles (cheminées, velux, gaines) ;
- zones de circulation / accès ;
- espacement entre panneaux ;
- orientation ou ombrage qui réduisent la zone exploitable.

On applique donc un **coefficient d’utilisation** (par défaut **0,75** = 75 %) :

```
surface_utilisable (m²) = surface_toit (m²) × 0,75
```

Ce coefficient est configurable (voir `DEFAULT_USABLE_ROOF_RATIO` dans `lib/surface-to-kwp.ts`).

### 3. Puissance crête (kWp)

Sous conditions **STC** (Standard Test Conditions : 1000 W/m², 25 °C), la puissance crête par m² de panneau est :

```
puissance_par_m² (kWp/m²) = rendement_panneau (%) / 100
```

Exemple : rendement 20 % → 0,20 kWp/m² (soit 200 Wp/m²).

**Formule finale :**

```
kWp = surface_toit (m²) × coefficient_utilisation × (rendement / 100)
```

Exemple : 100 m² de toit × 0,75 × 0,20 = **15 kWp**.

## Où c’est utilisé dans le code

- **Calcul** : `lib/surface-to-kwp.ts`  
  - `surfaceToKwp(areaM2, settings?, usableRatio)`  
  - `getUsableRoofAreaM2(areaM2, usableRatio)`

- **Paramètres panneaux** : rendement et type de panneau viennent de `lib/solar-settings.ts` (localStorage ou défauts : monocristallin 20 %, etc.).

- **Affichage** : dans le tiroir prospect (ProspectDrawer), un bloc « Puissance crête estimée (kWp) » affiche le kWp, la surface toit, la surface utilisable et rappelle la formule.

## Résumé

| Entrée              | Étape              | Sortie        |
|---------------------|--------------------|---------------|
| Surface toit (m²)   | × 0,75             | Surface utilisable (m²) |
| Surface utilisable  | × (rendement/100) | **kWp**       |

Le kWp estimé est recalculé à chaque mise à jour des surfaces dessinées et est enregistré dans `prospect.solarPotential.estimatedKwp`.
