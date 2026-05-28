# Discovery — alimentation du matching avec parcelles `cadastre_only`

**Date :** 2026-05-28  
**Statut :** Design validé

## Contexte

Aujourd'hui, certaines parcelles cadastrales peuvent etre utiles pour definir/projeter un perimetre, meme quand aucun batiment n'est matche. Le besoin est d'eviter un appel supplementaire et de nourrir directement la base de matching avec ces parcelles.

Objectif: conserver les parcelles sans matching batiment dans la base de matching actuelle avec un statut explicite `cadastre_only`, afin de pouvoir les reprojeter de maniere fiable.

## Decision

Conserver **une source de verite unique** dans `scout_matching_v5` et y stocker les parcelles sans batiment avec `match_status='cadastre_only'`.

- Pas de table annexe dediee.
- Pas de downgrade d'un enregistrement deja `matched`.
- Projection UI des `cadastre_only`: carte uniquement.

## Approches considerees

1. **Table `scout_matching_v5` + `match_status`** (retenue)
   - Avantages: coherence des flux existants (`matchingV5ParcelleIds`), moins de jointures, migration progressive.
   - Inconvenients: schema a faire evoluer + controles d'upsert.
2. Table annexe `cadastre_only`
   - Avantages: isolation.
   - Inconvenients: complexite de lecture/maintenance.
3. Vue materialisee unifiante
   - Avantages: impact schema limite.
   - Inconvenients: refresh/ops et debogage plus difficiles.

## Modele de donnees

### Table cible

`scout_matching_v5` (existant), avec ajout d'un champ `match_status`:

- `matched`
- `cadastre_only`

### Regles

- `cadastre_only` n'est autorise que pour `grain='parcelle'`.
- Unicite logique sur `scout_v5_id` (et `grain='parcelle'`).
- Evolution autorisee: `cadastre_only -> matched`.
- Evolution interdite: `matched -> cadastre_only`.

## Flux d'ecriture (upsert)

Quand une parcelle est obtenue via cadastre (lookup, bbox, edition perimetre):

1. Construire/normaliser `scout_v5_id` (`parcelle:<code_insee>:<section>:<numero_norm>`).
2. Upsert dans `scout_matching_v5`:
   - Absente: insertion `cadastre_only`.
   - Presente `cadastre_only`: refresh geometrie/metadata.
   - Presente `matched`: ne pas degrader le statut.
3. En cas de matching batiment ulterieur: promouvoir l'enregistrement en `matched`.

### Tolerance aux erreurs

- Si l'upsert echoue, ne pas bloquer la projection carte.
- Log applicatif + possibilite de retry asynchrone.

## Flux de lecture / UI

### Lecture

- Les requetes de projection de parcelles incluent `matched` **et** `cadastre_only`.
- Option de rollout: flag API `includeCadastreOnly=1` au debut, puis activation par defaut.

### Rendu interface

- `matched`: comportement actuel.
- `cadastre_only`: affichage carte uniquement, sans cartes batiment/installation et sans recherche batiment automatique a l'ouverture.

## Impact pipeline

- `matchingV5ParcelleIds` reste la reference perimetre.
- Au rechargement, les IDs `cadastre_only` sont conserves et reprojetes.
- `matchingV5ComboId` peut rester `null` pour ces parcelles tant qu'aucun matching batiment n'est etabli.

## Migration et backfill

1. Migration SQL:
   - ajout `match_status`,
   - index sur `match_status`,
   - contrainte de coherence (`cadastre_only` implique `grain='parcelle'`).
2. Backfill idempotent:
   - inserer en `cadastre_only` les parcelles utilisees mais absentes du matching,
   - ne jamais downgrader `matched`.

## Tests

- Upsert: creation `cadastre_only`, update idempotent, protection anti-downgrade.
- Lecture API: inclusion `cadastre_only` dans la projection.
- UI: projection carte-only sans cartes batiment.
- Pipeline save/load: conservation des `matchingV5ParcelleIds` avec parcelles non matchees.

## Plan de rollout

1. Migration + ecriture upsert `cadastre_only` (sans impact rendu).
2. Activation lecture `cadastre_only` pour projection carte.
3. Backfill progressif et monitoring.

Indicateurs:

- volume `cadastre_only`,
- taux de promotion `cadastre_only -> matched`,
- erreurs d'upsert.
