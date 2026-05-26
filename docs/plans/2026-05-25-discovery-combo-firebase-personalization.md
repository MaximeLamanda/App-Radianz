# Personnalisation combo Discovery via Firebase — plan d’implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rattacher la personnalisation d’un combo Discovery uniquement via `matchingV5ComboId` en Firebase, afficher le combo classique sinon, et supprimer la session mémoire qui provoque les sélections croisées (bug « Point P »).

**Architecture:** Index `Map<comboId, Prospect>` depuis `useProspectsForPipeline` ; au clic, lookup strict sur `selectedComboId`. Persistance à l’ajout pipeline avec `matchingV5ComboId`. Suppression de `comboSelectionSessionByKeyRef` et du matching flou par parcelle partagée.

**Tech stack:** Next.js, React, Firestore (`lib/firestore-prospect.ts`), Vitest, fonctions pures dans `lib/discovery-pipeline-match.ts`.

**Design validé :** `docs/plans/2026-05-25-discovery-combo-firebase-personalization-design.md`

---

### Task 1 : Types + Firestore

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/firestore-prospect.ts`
- Test: `lib/firestore-prospect-discovery.test.ts`

**Step 1: Étendre le test Firestore**

Ajouter dans `lib/firestore-prospect-discovery.test.ts` :

```ts
matchingV5ComboId: "combo:p1|p2",
```

Assert round-trip sur `matchingV5ComboId`.

**Step 2: Lancer le test**

Run: `npm run test:unit -- lib/firestore-prospect-discovery.test.ts`  
Expected: FAIL (champ non sérialisé)

**Step 3: Implémenter**

- `types/index.ts` : `matchingV5ComboId?: string` sur `Prospect`
- `lib/firestore-prospect.ts` : read/write du champ (même pattern que `matchingV5ParcelleIds`)

**Step 4: Vérifier**

Run: `npm run test:unit -- lib/firestore-prospect-discovery.test.ts`  
Expected: PASS

---

### Task 2 : Lookup strict par comboId

**Files:**
- Modify: `lib/discovery-pipeline-match.ts`
- Create: `lib/discovery-pipeline-match.test.ts` (ajouter describe) ou étendre fichier existant
- Modify: `lib/discovery-combo-markers.ts` (import `comboIdFromParcelleIds` si helper legacy)

**Step 1: Tests du lookup**

Dans `lib/discovery-pipeline-match.test.ts`, ajouter :

```ts
describe("findDiscoveryProspectByComboId", () => {
  it("retourne le prospect si matchingV5ComboId correspond", () => { ... });
  it("retourne null si comboId différent même parcelle partagée", () => { ... });
  it("fallback legacy: dérive comboId depuis matchingV5ParcelleIds si champ absent", () => { ... });
});
```

Cas critique : deux prospects ou un prospect avec `matchingV5ParcelleIds` contenant une parcelle du combo B — clic combo B avec `comboId` de B ne doit **pas** retourner le prospect de A.

**Step 2: Run tests — FAIL**

`npm run test:unit -- lib/discovery-pipeline-match.test.ts`

**Step 3: Implémenter**

```ts
export function legacyComboIdFromProspect(
  p: Pick<Prospect, "matchingV5ComboId" | "matchingV5ParcelleIds">
): string | null {
  const direct = p.matchingV5ComboId?.trim();
  if (direct) return direct;
  const ids = p.matchingV5ParcelleIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  return ids.length > 0 ? comboIdFromParcelleIds(ids) : null;
}

export function findDiscoveryProspectByComboId(
  comboId: string | null | undefined,
  prospects: readonly Prospect[]
): Prospect | null {
  const cid = comboId?.trim();
  if (!cid) return null;
  for (const p of prospects) {
    if (p.pipelineEntrySource !== "discovery_v5") continue;
    const key = legacyComboIdFromProspect(p);
    if (key === cid) return p;
  }
  return null;
}
```

Marquer `matchingV5SelectionMatchesProspect` comme `@deprecated` ou le restreindre aux tests legacy ; ne plus l’utiliser dans `app/discovery/page.tsx`.

**Step 4: Run tests — PASS**

---

### Task 3 : Persistance à l’ajout pipeline

**Files:**
- Modify: `lib/matching-v5-to-prospect.ts` (`MatchingV5ToProspectDraftOptions`, `matchingV5RowsToProspectDraft`)
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`handleDiscoveryAddToPipeline`)

**Step 1: Passer `matchingV5ComboId` au draft**

Dans `ProspectDrawer`, lors de `matchingV5RowsToProspectDraft`, ajouter :

```ts
matchingV5ComboId: discoveryComboId, // nouvelle prop depuis page
```

La page passe `discoveryComboId={selectedComboId}` au drawer (ou calcule via `comboIdFromParcelleIds` si `selectedComboId` null mais parcelles connues).

**Step 2: Test unitaire draft (optionnel)**

Vérifier que `matchingV5RowsToProspectDraft` inclut `matchingV5ComboId` quand fourni dans options.

**Step 3: Vérifier manuellement**

Ajouter un combo au pipeline → document Firestore contient `matchingV5ComboId`.

---

### Task 4 : Refactor `app/discovery/page.tsx`

**Files:**
- Modify: `app/discovery/page.tsx`
- Delete: `lib/discovery-combo-selection-session.ts` (si plus utilisé)
- Modify: imports / tests associés

**Step 1: Index pipeline par comboId**

```ts
const discoveryProspectByComboId = useMemo(() => {
  const m = new Map<string, Prospect>();
  if (!pipelineProspects?.length) return m;
  for (const p of pipelineProspects) {
    const key = legacyComboIdFromProspect(p);
    if (key && !m.has(key)) m.set(key, p);
  }
  return m;
}, [pipelineProspects]);

const discoveryPipelineMatch = useMemo(() => {
  if (!selectedComboId) return null;
  return discoveryProspectByComboId.get(selectedComboId) ?? null;
}, [selectedComboId, discoveryProspectByComboId]);
```

**Step 2: Supprimer session mémoire**

- Retirer `comboSelectionSessionByKeyRef`, `lastComboSelectionKeyRef`, `persistDiscoveryComboSelectionSession`, imports `discovery-combo-selection-session`
- Simplifier `useLayoutEffect` changement de combo :
  - Si `discoveryPipelineMatch` → `parcelleEditStateFromPersistedParcelleIds`
  - Sinon → `emptyDiscoveryComboParcelleEditState()` + reset bâtiments (défaut tous cochés via effet existant)
- Retirer `handleDiscoveryPipelineAdded` persistance session

**Step 3: Garantir `selectedComboId` sur clic polygone**

Vérifier `onSelectOsmBuildingId` / effet `findComboAnchorForOsmBuilding` : toujours `setSelectedComboId(ctx.comboId)`.

**Step 4: Prop au drawer**

```tsx
discoveryComboId={selectedComboId}
```

**Step 5: Tests régression**

`npm run test:unit -- lib/discovery-pipeline-match.test.ts lib/discovery-combo-effective-parcelles.test.ts lib/firestore-prospect-discovery.test.ts`

---

### Task 5 : Nettoyage + doc

**Files:**
- Delete: `lib/discovery-combo-selection-session.ts` (si orphelin)
- Grep: `comboSelectionSession`, `matchingV5SelectionMatchesProspect` usages restants

**Step 1:** Supprimer fichiers / exports morts  
**Step 2:** Mettre à jour commentaire en tête de `lib/discovery-pipeline-match.ts`

---

## Test plan manuel

1. Ouvrir Discovery, cliquer combo **sans** pipeline → périmètre matching complet, pas de données « Point P ».
2. Modifier périmètre, ajouter au pipeline → re-clic même marqueur → périmètre personnalisé restauré.
3. Clic combo **voisin** (parcelle partagée possible) **sans** pipeline → classique, pas la personnalisation du combo A.
4. Changer de combo puis revenir → sans pipeline en base pour B, pas de brouillon local (choix A).
5. Vérifier Firestore : champ `matchingV5ComboId` présent sur le nouveau prospect.

---

## Exécution

Après validation du plan, utiliser @superpowers:executing-plans ou implémenter tâche par tâche dans une session dédiée.
