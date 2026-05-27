# Discovery dirigeants suggérés — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Afficher sous les POI (onglet Contact) les dirigeants personnes physiques api.gouv pour propriétaires parcelle et établissements, avec ajout en un clic et peu d’appels API.

**Architecture:** Étendre `mapResultatApiToEnrichment` avec `dirigeantsPhysiques[]` ; module `lib/discovery-dirigeants-suggestions.ts` pour regroupement, cache SIREN et détection « déjà ajouté » ; composant UI branché dans `ProspectDrawer` avec fetch lazy onglet Contact.

**Tech Stack:** Next.js App Router, React, `/api/recherche-entreprises`, Firestore `updateProspect`, Vitest.

---

### Task 1: Extraction dirigeants PP (API map)

**Files:**
- Modify: `lib/api-gouv-enrichment-map.ts`
- Modify: `lib/recherche-entreprises.ts` (type `EnrichmentResult`)
- Test: `lib/api-gouv-enrichment-map.test.ts`

**Step 1: Write the failing test**

```ts
it("mappe tous les dirigeants personnes physiques", () => {
  const result = mapResultatApiToEnrichment({
    siren: "123456789",
    dirigeants: [
      { type_dirigeant: "personne physique", prenoms: "Jean", nom: "Dupont", qualite: "Président" },
      { type_dirigeant: "personne physique", prenoms: "Marie", nom: "Martin", qualite: "DG" },
      { type_dirigeant: "personne morale", denomination: "HOLDING SA" },
    ],
  });
  expect(result.dirigeantsPhysiques).toHaveLength(2);
  expect(result.dirigeantsPhysiques?.[0]).toMatchObject({ nom: "Dupont", qualite: "Président" });
  expect(result.companyManagerName).toContain("Jean");
});
```

**Step 2: Run test**

Run: `npm test -- lib/api-gouv-enrichment-map.test.ts -t "dirigeants personnes physiques"`
Expected: FAIL

**Step 3: Implement**

- Add `extractDirigeantsPhysiques(result)` returning `{ prenoms?, nom?, qualite? }[]`.
- Set `dirigeantsPhysiques` on `EnrichmentResult`.
- Keep `companyManagerName` = premier PP formaté (comportement actuel).

**Step 4: Run test** — PASS

**Step 5: Commit** (si demandé par l’utilisateur)

---

### Task 2: Helpers suggestions (normalisation, dédup, déjà ajouté)

**Files:**
- Create: `lib/discovery-dirigeants-suggestions.ts`
- Test: `lib/discovery-dirigeants-suggestions.test.ts`

**Step 1: Failing tests**

- `sirenFromSiretOrSiren("12345678901234")` → `"123456789"`
- `normalizeContactPersonName("  Jean  DUPONT ")` insensible casse/accents
- `isDirigeantAlreadyAdded(contacts, { originKind: "parcelle", originRef: "p1", fullName: "Jean Dupont" })` true/false
- `buildDirigeantFetchSirens({ parcelleOwners, etablissementSirets })` déduplique

**Step 2: Run** — FAIL

**Step 3: Implement**

```ts
export function dirigeantFullName(d: { prenoms?: string; nom?: string }): string;
export function contactFromDirigeant(input: {
  dirigeant: DirigeantPhysique;
  originKind: "parcelle" | "etablissement";
  originRef: string;
  originLabel: string;
}): ProspectContact; // via createManualProspectContact
```

**Step 4: Run** — PASS

---

### Task 3: Hook / état fetch onglet Contact (ProspectDrawer)

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1: Unifier ou étendre le cache**

Remplacer / compléter `discoveryGouvUlBySiren` par un record :

```ts
Record<string, {
  status: "loading" | "ok" | "err";
  companyLegalName?: string;
  dirigeantsPhysiques?: DirigeantPhysique[];
}>
```

**Step 2: Effet fetch**

- `useMemo` : liste `{ siren, queryKey }` unique depuis `passerelleFlat` (par parcelle) + `discoverySiretRows` (siren ou siret→siren).
- `useEffect` quand `isOpen && discoveryMainTab === "terrain"` : pour chaque SIREN non en cache, `fetch(/api/recherche-entreprises?q=...)`.
- Respecter `showAllDirigeantsEntities` (bool) + cap 5 par défaut (réutiliser `initialDiscoveryEstablishmentsVisible`).
- Ne pas refetch si `status === "ok"`.

**Step 3: Manual test**

Ouvrir combo pipeline → onglet Contact → Network : ≤ N requêtes (N = SIREN uniques, ≤ 5 si pas « Voir tout »).

---

### Task 4: Composant UI cartes

**Files:**
- Create: `components/discovery/DiscoveryDrawerDirigeantsSuggestions.tsx`

**Props:**

```ts
{
  prospectId?: string;
  existingContacts: ProspectContact[];
  parcelleGroups: Array<{
    parcelleId: string;
    parcelleLabel: string;
    siren: string;
    companyName?: string;
  }>;
  etablissementGroups: Array<{
    siret: string;
    siren: string;
    label: string;
  }>;
  gouvBySiren: Record<string, GouvDirigeantsCacheEntry>;
  showAll: boolean;
  onShowAll: () => void;
  onContactsPersisted: (contacts: ProspectContact[]) => void;
}
```

**UI:**

- Sous-sections avec titres « Propriétaires parcelle » / « Établissements ».
- Skeleton par groupe en `loading`.
- Carte dirigeant : réutiliser styles proches de `ContactRow` dans `DiscoveryDrawerContactsOverview.tsx`.
- Bouton `Ajouter` : async `updateProspect` ; `pending` par carte.
- `Déjà ajouté` si `isDirigeantAlreadyAdded`.

---

### Task 5: Intégration sous POI

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`TabsContent value="terrain"`)

**Step 1:** Après `<DiscoveryDrawerMergedPoiBlock ... />`, insérer :

```tsx
<DiscoveryDrawerDirigeantsSuggestions
  prospectId={pipelineProspectForShareKpis?.id}
  existingContacts={discoveryContacts}
  parcelleGroups={...}
  etablissementGroups={...}
  gouvBySiren={discoveryGouvBySiren}
  showAll={showAllDirigeantEntities}
  onShowAll={() => setShowAllDirigeantEntities(true)}
  onContactsPersisted={handleDiscoveryContactsPersisted}
/>
```

**Step 2:** Construire `parcelleGroups` depuis `passerelleFlat` + `informationParcellesRows` (mapper parcelleLabel → id).

**Step 3:** Construire `etablissementGroups` depuis `discoverySiretRows`.

---

### Task 6: Tests de bout en bout unitaires + lint

**Files:**
- `lib/api-gouv-enrichment-map.test.ts`
- `lib/discovery-dirigeants-suggestions.test.ts`

**Run:**

```bash
npm test -- lib/api-gouv-enrichment-map.test.ts lib/discovery-dirigeants-suggestions.test.ts
```

**Manual checklist:**

- [ ] Onglet Contact : section dirigeants sous POI
- [ ] 5 entités max puis « Voir tout »
- [ ] Ajouter → contact en tête de liste Contacts avec bonne origine
- [ ] Second clic impossible (« Déjà ajouté »)
- [ ] Sans pipeline : Ajouter désactivé
- [ ] Passer par Informations puis Contact : pas de double fetch (cache)

---

## Décisions rappel

| Sujet | Choix |
|-------|--------|
| Dirigeants | Tous PP api.gouv |
| Origine owner | parcelle + id |
| Origine étab. | etablissement + SIRET |
| Doublon UI | Bouton « Déjà ajouté » |
| API | Option 1 — route existante + cache SIREN |
