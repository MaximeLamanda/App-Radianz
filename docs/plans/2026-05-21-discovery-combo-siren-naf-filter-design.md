# Discovery — filtres SIREN (propriétaire / domiciliation) et NAF (division)

## Contexte

La page Découverte filtre déjà les clusters combo via `scout_matching_v5_combos` et `/api/matching-v5/combos-overview` (surface, parking, ratio empreinte/parcelle en SQL ; année de construction et tag OSM en client sur colonnes pré-agrégées).

Le tiroir affiche déjà :
- **Propriétaire** : SIREN issus du PPM (`passerelle_addresses_json` / cadastre personnes morales)
- **Domiciliation** : établissements retenus par le matching adresse (`sirets_json`), avec `activite_principale` (code NAF / APE SIRENE)

Ces critères ne sont pas encore exploitables dans le panneau filtres carte.

## Décisions validées (brainstorming)

| Sujet | Choix |
|-------|--------|
| Domiciliation | Établissements `sirets_json` uniquement (pas la liste PPM brute) |
| SIREN | Correspondance **exacte** (9 chiffres) |
| NAF | **Division** 2 chiffres (préfixe sur `activite_principale`, ex. `47` → `47.11F`) |
| NAF × mode | Champ NAF **visible uniquement** en mode Domiciliation |
| Données NAF matching | **Déjà présent** dans `sirets_json` (`activite_principale`) — pas de changement SIRENE obligatoire en v1 |
| Architecture | **Approche 1** : pré-agréger sur `scout_matching_v5_combos` + filtre SQL (comme `zone_tags`) |

## Objectifs

- Filtrer les marqueurs combo par SIREN selon la source choisie (propriétaire vs domiciliation).
- Filtrer par division NAF (2 chiffres) en mode domiciliation.
- Combiner SIREN + NAF en **ET** quand les deux sont actifs.
- Réactivité comparable aux filtres surface (requête overview indexée, pas de scan client des parcelles).

## Non-objectifs (v1)

- Recherche SIREN par préfixe partiel.
- NAF en mode Propriétaire (PPM sans code NAF natif).
- Enrichissement API gouv au moment du filtre.
- Filtre NAF sur code complet (5 caractères + lettre) — division seulement.
- Modification des règles de matching adresse dans `run_matching_v5.py`.

## Modèle de données

### Colonnes ajoutées — `public.scout_matching_v5_combos`

Migration `data-pipeline/sql/015_scout_matching_v5_combos_siren_naf.sql` :

| Colonne | Type | Description |
|---------|------|-------------|
| `owner_sirens` | `TEXT[] NOT NULL DEFAULT '{}'` | Union des SIREN PPM valides (`^\d{9}$`) sur toutes les parcelles du combo (`passerelle_addresses_json`) |
| `domiciliation_sirens` | `TEXT[] NOT NULL DEFAULT '{}'` | Union des SIREN des établissements retenus (`sirets_json`) |
| `naf_divisions` | `TEXT[] NOT NULL DEFAULT '{}'` | Divisions NAF 2 chiffres déduites de `activite_principale` des `sirets_json` (ex. `47.11F` → `47`) |

Index GIN sur les trois colonnes (filtre `= ANY(array)` / `@>`).

### Agrégation combo (miroir tiroir)

Pour chaque combo (union des parcelles de la composante connexe) :

1. **`owner_sirens`** : pour chaque entrée `passerelle_addresses_json`, si `siren` match `^\d{9}$`, l’ajouter à l’ensemble.
2. **`domiciliation_sirens`** : pour chaque entrée `sirets_json`, si `siren` match `^\d{9}$`, l’ajouter.
3. **`naf_divisions`** : pour chaque `sirets_json.activite_principale` non vide, extraire les 2 premiers chiffres après normalisation (strip, uppercase) ; ignorer si moins de 2 chiffres en tête.

Sources lues depuis `properties_json` des parcelles `scout_matching_v5_features` (champs déjà exportés par le matching : `passerelle_addresses_json`, `sirets_json`).

## Pipeline

### `discovery_combos_v5.py`

Nouvelles fonctions :

- `combo_owner_sirens(parcelle_rows) -> list[str]`
- `combo_domiciliation_sirens(parcelle_rows) -> list[str]`
- `combo_naf_divisions(parcelle_rows) -> list[str]`
- `naf_division_from_ape(ape: str) -> str | None` (helper testable)

Intégration dans `build_combo_records_for_commune`.

### `build_discovery_combos.py`

- Étendre la lecture `properties_json` pour exposer `passerelle_addresses_json` et `sirets_json` aux fonctions combo.
- Étendre `INSERT` avec les trois colonnes.

Chaînage inchangé :

```text
run_matching_v5.py --write-postgres --code-insee=…
  → refresh-matching-v5-buildings-mv.mjs
  → build_discovery_combos --code-insee=…
```

## API

### `GET /api/matching-v5/combos-overview`

Query params optionnels :

| Param | Valeurs | Validation |
|-------|---------|------------|
| `sirenRole` | `owner` \| `domiciliation` | Requis si `siren` présent |
| `siren` | 9 chiffres | `^\d{9}$` sinon 400 |
| `nafDivision` | 2 chiffres | `^\d{2}$` ; 400 si présent avec `sirenRole=owner` |

Clauses SQL (ET entre critères actifs) :

- `sirenRole=owner` + `siren` → `$siren = ANY(owner_sirens)`
- `sirenRole=domiciliation` + `siren` → `$siren = ANY(domiciliation_sirens)`
- `nafDivision` (domiciliation seulement) → `$naf = ANY(naf_divisions)`

Helpers dans `lib/discovery-combos-overview-http.ts` :

- `buildCombosOverviewSirenWhere(...)`
- `buildCombosOverviewNafDivisionWhere(...)`
- Extension de `buildCombosOverviewSearchParams`

## UI — `DiscoveryFiltersPanel`

1. **Segmented control** : « Propriétaire » | « Domiciliation » (`sirenRole`).
2. **Champ SIREN** : input numérique, max 9 ; filtre envoyé seulement si 9 chiffres.
3. **Champ Division NAF** : rendu **uniquement** si mode Domiciliation ; 2 chiffres ; filtre actif si `^\d{2}$`.
4. Debounce / refetch overview alignés sur les sliders surface (même politique dans `discovery/page.tsx`).

`hasActiveDiscoveryFilters` inclut SIREN et/ou NAF actifs.

## Tests

### Python (`data-pipeline/python/tests/test_discovery_combos_v5.py`)

- Combo 2 parcelles : SIREN PPM distincts → union `owner_sirens`.
- `sirets_json` avec `activite_principale` `47.11F` et `68.20B` → `naf_divisions` = `['47','68']`.
- APE vide ou invalide → ignoré.

### TypeScript

- `lib/discovery-combos-overview-http.test.ts` : fragments SQL + validation params.
- Optionnel : `naf_division_from_ape` côté TS si helper partagé client (sinon tests via HTTP builders seulement).

## Documentation ops

Mettre à jour `docs/MATCHING-V5.md` et `data-pipeline/matching/README.md` : colonnes 015, params API, rebuild combos après migration.

## Risques / mitigations

| Risque | Mitigation |
|--------|------------|
| Combos non rebuildés après migration | Script apply SQL + `build_discovery_combos` par commune couverte |
| `activite_principale` vide sur vieilles communes | Filtre NAF ne matche pas ; re-run matching + rebuild si besoin |
| Confusion libellés UI | « Propriétaire » / « Domiciliation » alignés tiroir |

## Références

- Design surface SQL : `docs/plans/2026-05-20-discovery-combo-surface-sql-design.md`
- Table combos : `data-pipeline/sql/010_scout_matching_v5_combos.sql`
- Matching SIRET : `data-pipeline/matching_v5/run_matching_v5.py` (`activite_principale` dans `sirets_json`)
