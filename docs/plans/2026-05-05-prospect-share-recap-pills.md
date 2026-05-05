# ProspectSharePage — pills récap client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remplacer la rangée de pills du récap partagé par **MWh/an**, **CO₂ évités (~t/an)**, **surface parcelle (m²)** et **kWp**, avec persistance de la surface parcelle pour les prospects Discovery et un calcul CO₂ partagé avec `RadianzCo2AvoidanceRadial`.

**Architecture:** Étendre le modèle `Prospect` / Firestore avec `parcelContourAreaM2`, calculé à la création depuis les géométries V5 (même logique que le drawer). Factoriser le facteur CO₂ et le format d’affichage dans `lib/` pour que la pill et la carte utilisent la même formule. Mettre à jour `ProspectSharePage` uniquement pour la rangée `drawer-discovery-pills`.

**Tech Stack:** Next.js App Router, TypeScript, Firestore (`firestore-prospect.ts`), composants React existants.

---

### Task 1: Module CO₂ partagé

**Files:**
- Create: `lib/co2-avoidance-fr.ts` (ou nom équivalent)
- Modify: `components/solar-scout/RadianzCo2AvoidanceRadial.tsx`

**Step 1:** Exporter la constante `CO2E_GRID_KG_PER_KWH_FR = 0.052`, une fonction `avoidedCo2TonnesPerYearFromGridFr(annualProductionKwh: number)` retournant les tonnes, et optionnellement `co2RadialHasData(prod, conso)` alignée sur la logique actuelle de la carte.

**Step 2:** Remplacer les calculs inline dans `RadianzCo2AvoidanceRadial` par les imports du module ; vérifier visuellement qu’aucun changement de chiffres (régression nulle).

**Step 3:** `npm run build` ou `npm run lint` selon les habitudes du repo sur les fichiers touchés.

---

### Task 2: Type + Firestore prospect — `parcelContourAreaM2`

**Files:**
- Modify: `types/index.ts` (`Prospect`)
- Modify: `lib/firestore-prospect.ts` (`ProspectDocument`, `prepareProspectForFirestore`, `prospectFromFirestore`)

**Step 1:** Ajouter `parcelContourAreaM2?: number` au type et au document ; sérialiser uniquement si défini et > 0.

**Step 2:** Vérifier que l’API partagée / hooks renvoient le champ (route `prospect-view` ou équivalent si mapping manuel).

---

### Task 3: Remplissage à la création Discovery

**Files:**
- Modify: `lib/matching-v5-to-prospect.ts` (et tests `matching-v5-to-prospect.test.ts` si présents)

**Step 1:** Implémenter une fonction pure `parcelContourAreaM2FromV5Row(row, parcelleCluster)` reprenant la logique du drawer (`polygonAreaM2ApproxWgs84`, somme sur le cluster parcelle ou géométrie seule).

**Step 2:** Assigner `parcelContourAreaM2` sur le `Prospect` draft retourné quand `pipelineEntrySource === "discovery_v5"` (ou dès que géométrie parcelle disponible).

**Step 3:** Lancer les tests ciblés : `npm test -- matching-v5-to-prospect` (ou suite complète si court).

---

### Task 4: UI — `ProspectSharePage` pills

**Files:**
- Modify: `app/p/[shareToken]/page.tsx`

**Step 1:** Retirer la pill **m² toit** du récap.

**Step 2:** Ajouter pill **MWh/an** (format `fr-FR`, 1 décimale) si production > 0.

**Step 3:** Ajouter pill **CO₂** avec tonnes depuis `lib/co2-avoidance-fr.ts`, affichée sous la **même condition** que la carte (`hasData`), en s’appuyant sur `effectiveConfig.effectiveAnnualProductionKwh` et `liveAnnualConsumptionKwh` déjà disponibles sur la page.

**Step 4:** Ajouter pill **surface parcelle** si `prospect.parcelContourAreaM2` (ou nom final) valide ; icône `Topoicon.svg` comme le drawer ; libellé type « X XXX m² » avec titre explicite (contour cadastral).

**Step 5:** Conserver pill **kWp** existante (style actuel).

**Step 6:** Vérifier le rendu mobile (wrap des pills) et contrastes.

---

### Task 5: Vérification

**Step 1:** `npm run build`

**Step 2:** Ouvrir un lien de partage avec prospect Discovery : vérifier présence parcelle + cohérence CO₂ pill vs carte.

**Step 3:** Prospect sans parcelle stockée : pas de pill parcelle, pas d’erreur.

**Step 4:** Commit avec message clair (feat: pills récap partage MWh, CO₂, parcelle, kWp).
