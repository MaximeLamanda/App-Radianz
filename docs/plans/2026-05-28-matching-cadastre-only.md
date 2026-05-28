# Matching Cadastre Only Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Nourrir la table de matching V5 avec les parcelles cadastrales sans batiment via un statut `cadastre_only`, puis les projeter sur la carte sans UI batiment.

**Architecture:** On fait evoluer le schema SQL du matching pour porter un statut de match. Les flux qui renvoient des parcelles cadastre font un upsert idempotent dans la table matching, avec protection anti-downgrade (`matched` ne redevient jamais `cadastre_only`). La lecture UI conserve les parcelles `cadastre_only` pour projection carte-only en s'appuyant sur les IDs de perimetre existants.

**Tech Stack:** Next.js App Router, TypeScript, Postgres/PostGIS, Vitest, scripts Node (`pg`).

---

### Task 1: Schema SQL `match_status` + script d'application

**Files:**
- Create: `data-pipeline/sql/018_scout_matching_v5_match_status.sql`
- Modify: `scripts/apply-matching-v5-combos.mjs`
- Test: `lib/scout-matching-v5-table.test.ts`

**Step 1: Write the failing test**

Ajouter un test dans `lib/scout-matching-v5-table.test.ts` qui valide la disponibilite d'un mapping de colonne `match_status` (ou fallback coherent) pour la table de matching.

```ts
it("expose la colonne match_status pour le matching parcelle", () => {
  const ref = getScoutMatchingV5TableRef(undefined);
  expect(ref.qualifiedSql).toContain("scout_matching_v5");
  // verifier ensuite la logique de lecture qui depend de match_status
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- lib/scout-matching-v5-table.test.ts`  
Expected: FAIL (colonne / mapping non pris en charge).

**Step 3: Write minimal implementation**

SQL `018_scout_matching_v5_match_status.sql`:

```sql
ALTER TABLE public.scout_matching_v5_features
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'matched';

CREATE INDEX IF NOT EXISTS scout_matching_v5_features_match_status_idx
  ON public.scout_matching_v5_features (match_status);

ALTER TABLE public.scout_matching_v5_features
  DROP CONSTRAINT IF EXISTS scout_matching_v5_features_match_status_check;

ALTER TABLE public.scout_matching_v5_features
  ADD CONSTRAINT scout_matching_v5_features_match_status_check
  CHECK (match_status IN ('matched', 'cadastre_only'));
```

Puis brancher ce SQL dans `scripts/apply-matching-v5-combos.mjs` (ou script de migration equivalent deja utilise en prod).

**Step 4: Run test to verify it passes**

Run: `npm run test -- lib/scout-matching-v5-table.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add data-pipeline/sql/018_scout_matching_v5_match_status.sql scripts/apply-matching-v5-combos.mjs lib/scout-matching-v5-table.test.ts
git commit -m "feat(sql): add match_status for cadastre-only parcels"
```

### Task 2: Upsert `cadastre_only` a la lecture cadastre

**Files:**
- Modify: `app/api/matching-v5/parcelles-adjacent/route.ts`
- Modify: `lib/matching-v5-parcelles-adjacent-http.ts`
- Create: `lib/matching-v5-cadastre-only-upsert.ts`
- Test: `lib/matching-v5-parcelles-adjacent-http.test.ts`

**Step 1: Write the failing test**

Ajouter un test API/unitaire qui verifie:
- insertion `cadastre_only` quand une parcelle cadastre est absente du matching;
- non-regression si la parcelle est deja `matched`.

```ts
it("n'ecrase jamais matched par cadastre_only", async () => {
  // setup row matched
  // appel upsert cadastre-only
  // assert match_status reste matched
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- lib/matching-v5-parcelles-adjacent-http.test.ts`  
Expected: FAIL (upsert absent / anti-downgrade absent).

**Step 3: Write minimal implementation**

Creer `lib/matching-v5-cadastre-only-upsert.ts` avec une fonction transactionnelle:

```ts
export async function upsertCadastreOnlyParcelles(client: Client, parcelles: ParcelleInput[]) {
  // INSERT ... ON CONFLICT (scout_v5_id)
  // DO UPDATE SET ...
  // match_status = CASE
  //   WHEN scout_matching_v5_features.match_status = 'matched' THEN 'matched'
  //   ELSE 'cadastre_only'
  // END
}
```

Appeler cette fonction depuis la route `parcelles-adjacent` apres extraction/mapping des parcelles.

**Step 4: Run test to verify it passes**

Run: `npm run test -- lib/matching-v5-parcelles-adjacent-http.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/matching-v5-cadastre-only-upsert.ts app/api/matching-v5/parcelles-adjacent/route.ts lib/matching-v5-parcelles-adjacent-http.ts lib/matching-v5-parcelles-adjacent-http.test.ts
git commit -m "feat(matching): upsert cadastre-only parcels without downgrade"
```

### Task 3: Lecture pipeline et projection carte-only

**Files:**
- Modify: `lib/discovery-cadastre-parcel-fetch.ts`
- Modify: `lib/pipeline-matching-v5-drawer-context.ts`
- Modify: `components/solar-scout/ProspectDrawer.tsx`
- Test: `lib/discovery-pipeline-perimeter-persist.test.ts`

**Step 1: Write the failing test**

Ajouter un test qui prouve qu'une parcelle `cadastre_only`:
- est conservee dans `matchingV5ParcelleIds`;
- est projetee sur carte;
- ne declenche pas de rendu batiment.

```ts
it("conserve les parcelles cadastre_only dans le perimetre sans UI batiment", () => {
  // setup pipeline avec parcel ids cadastre_only
  // assert projection map ok
  // assert panneau batiment non affiche
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- lib/discovery-pipeline-perimeter-persist.test.ts`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- Inclure `match_status` dans les types de lecture si necessaire.
- Ne pas filtrer les `cadastre_only` lors de la rehydratation perimetre.
- Conserver la logique "map-only" dans `ProspectDrawer`.

**Step 4: Run test to verify it passes**

Run: `npm run test -- lib/discovery-pipeline-perimeter-persist.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/discovery-cadastre-parcel-fetch.ts lib/pipeline-matching-v5-drawer-context.ts components/solar-scout/ProspectDrawer.tsx lib/discovery-pipeline-perimeter-persist.test.ts
git commit -m "feat(discovery): project cadastre-only parcels as map-only perimeter"
```

### Task 4: Backfill idempotent et verification

**Files:**
- Create: `scripts/backfill-matching-v5-cadastre-only.mjs`
- Modify: `docs/plans/2026-05-28-matching-cadastre-only-design.md`
- Test: `lib/discovery-cadastre-parcel-fetch.test.ts` (ou nouveau test dedie)

**Step 1: Write the failing test**

Test idempotence: deux executions du backfill produisent le meme etat, sans doublon, et sans downgrade.

```ts
it("backfill cadastre_only is idempotent", async () => {
  // run backfill twice
  // assert row count stable and matched rows unchanged
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- lib/discovery-cadastre-parcel-fetch.test.ts`  
Expected: FAIL (script/backfill absent).

**Step 3: Write minimal implementation**

Script Node:

```js
// 1) lire parcelles candidates
// 2) upsert cadastre_only via meme logique que Task 2
// 3) afficher stats (inserted/updated/skipped_matched)
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- lib/discovery-cadastre-parcel-fetch.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/backfill-matching-v5-cadastre-only.mjs lib/discovery-cadastre-parcel-fetch.test.ts docs/plans/2026-05-28-matching-cadastre-only-design.md
git commit -m "chore(matching): add idempotent cadastre-only backfill script"
```

### Task 5: Verification finale end-to-end

**Files:**
- Modify: `docs/plans/2026-05-28-matching-cadastre-only.md`
- Test: `app/api/matching-v5/parcelles-adjacent/route.ts` (via tests existants/integration)

**Step 1: Write the failing check**

Lister un scenario manuel reproductible:
1. Charger une parcelle sans batiment.
2. Sauvegarder pipeline.
3. Reouvrir et verifier projection.

**Step 2: Run checks**

Run:
- `npm run test -- lib/matching-v5-parcelles-adjacent-http.test.ts`
- `npm run test -- lib/discovery-pipeline-perimeter-persist.test.ts`
- `npm run lint`

Expected: PASS global.

**Step 3: Document outcomes**

Ajouter dans le plan:
- commandes executees,
- resultats,
- limites connues.

**Step 4: Commit**

```bash
git add docs/plans/2026-05-28-matching-cadastre-only.md
git commit -m "docs(plan): record cadastre-only rollout verification"
```
