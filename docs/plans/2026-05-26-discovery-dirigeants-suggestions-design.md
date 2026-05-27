# Discovery — dirigeants suggérés (api.gouv) sous POI

**Date :** 2026-05-26  
**Statut :** Validé

## Problème

Dans l’onglet **Contact** du drawer Discovery, seuls les contacts déjà enregistrés (manuels / Apollo) et les POI sont exploitables. Les dirigeants connus via **api.gouv** (recherche-entreprises) sont affichés partiellement sur l’onglet Informations (un seul gérant, onglet différent) et ne peuvent pas être ajoutés en un clic au projet.

## Objectifs

| Besoin | Comportement |
|--------|--------------|
| Sources | Propriétaires parcelle (SIREN PPM / `passerelle_addresses_json`) + établissements matchés (`sirets_json`) |
| Dirigeants affichés | **Toutes** les personnes physiques (`type_dirigeant === "personne physique"`) |
| Placement UI | Section **sous** « POI à proximité », onglet Contact |
| Ajout rapide | Carte + bouton **Ajouter** → contact manuel prérempli, persisté Firestore si `prospectId` |
| Déjà en liste | Carte visible, bouton désactivé **« Déjà ajouté »** |
| Appels API | **Option 1** : enrichir `/api/recherche-entreprises` + **1 requête par SIREN unique**, cache client, chargement à l’ouverture de l’onglet Contact |

## Décisions produit (validées)

- Dirigeants : **B** — toutes les personnes physiques de l’API.
- Origine propriétaire PPM : **A** — `originKind: parcelle`, `originRef` = id parcelle (`scout_v5_id`).
- Origine établissement : `originKind: etablissement`, `originRef` = SIRET.
- Doublon UI : **B** — carte conservée, bouton **« Déjà ajouté »** désactivé.
- Technique API : **option 1** — route existante + cache client par SIREN (pas de route batch ni pré-calcul SQL).

## Approche technique

### API

Étendre la réponse de `GET /api/recherche-entreprises` :

```ts
dirigeantsPhysiques?: Array<{
  prenoms?: string;
  nom?: string;
  qualite?: string;
}>;
```

Extraction dans `lib/api-gouv-enrichment-map.ts` : filtrer `result.dirigeants` sur `personne physique` avec `nom` + `prenoms`. Conserver `companyManagerName` (1er PP) pour rétrocompat Informations.

### Cache & fetch (drawer)

- Clé cache : **SIREN** (9 chiffres). SIRET → SIREN avant requête.
- Union des SIREN : PPM par parcelle + SIREN des `discoverySiretRows`.
- Déclenchement : drawer ouvert **et** `discoveryMainTab === "terrain"` (pas de fetch dédié sur Informations sauf réutilisation du cache déjà chaud).
- Réutiliser les états `discoveryGouvUlBySiren` / enrichissements existants quand `manager` déjà chargé — compléter avec `dirigeantsPhysiques` si absent (ou unifier vers un seul `discoveryGouvBySiren`).
- Limite affichage : cap initial = `initialDiscoveryEstablishmentsVisible` (5) entités distinctes par sous-section + **« Voir tout »** pour étendre fetch + rendu.

### UI

Nouveau composant `DiscoveryDrawerDirigeantsSuggestions.tsx` :

1. **Propriétaires parcelle** — groupe par parcelle ; cartes dirigeants sous raison sociale (si connue).
2. **Établissements** — groupe par SIRET / dénomination.

Carte : avatar initiales, nom complet, qualité, société. Actions : **Ajouter** | **Déjà ajouté** (disabled).

Sans `prospectId` : lecture seule, tooltip sur Ajouter.

### Ajout contact

`createManualProspectContact` + `mergeProspectContacts` + `updateProspect` :

- `source: "manual"`
- `fullName` = prénoms + nom
- `title` = `qualite`
- `originLabel` = libellé parcelle ou dénomination établissement

**Déjà ajouté** : contact existant avec même `originKind`, `originRef` et nom normalisé (NFKC, minuscules, espaces collapsés).

### Hors scope

- Nouvelle `source` Firestore (`insee` / `api_gouv`).
- Email / téléphone dirigeants (non fournis par api.gouv).
- Brouillon contacts pré-pipeline.
- Route batch dédiée.

## Fichiers principaux

- `lib/api-gouv-enrichment-map.ts` — extraction `dirigeantsPhysiques`
- `lib/recherche-entreprises.ts` — type `EnrichmentResult`
- `lib/discovery-dirigeants-suggestions.ts` — helpers (normalisation nom, dédup SIREN, « déjà ajouté »)
- `components/discovery/DiscoveryDrawerDirigeantsSuggestions.tsx` — UI cartes
- `components/solar-scout/ProspectDrawer.tsx` — intégration sous POI, effet fetch onglet Contact

## Références

- Design contacts manuels : `docs/plans/2026-05-26-discovery-poi-manual-contacts-design.md`
- Onglet Contact actuel : `ProspectDrawer.tsx` (`TabsContent value="terrain"`)
- Cache api.gouv existant : `discoveryGouvUlBySiren`, `discoveryGouvEtabBySiret`
