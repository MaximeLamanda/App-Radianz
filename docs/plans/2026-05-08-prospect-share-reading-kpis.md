# Prospect share reading KPIs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enregistrer les sessions de lecture sur `/p/[shareToken]`, persister sous-collection + agrégats Firestore, et afficher résumé + tableau dans `ProspectDrawer` avec chargement à l’ouverture et bouton Actualiser — sans modifier `pipelineStatus` hors `register-view`.

**Architecture:** Factoriser l’éligibilité « vue utile » partagée avec `register-view`. Deux `POST` publics (start/end session) via Admin SDK ; `GET` authentifié pour lister sessions + agrégats. Page publique : UUID session + beacons ; tiroir : `fetch` + SWR optionnel.

**Tech stack:** Next.js App Router, `firebase-admin` (`getAdminDb`, `verifyIdToken`), Firestore, client React existant (`ProspectSharePage`, `ProspectDrawer`), Vitest ou framework de tests du repo pour modules purs.

**Référence design:** `docs/plans/2026-05-08-prospect-share-reading-kpis-design.md`

---

### Task 1: Module d’éligibilité partagé + tests

**Files:**
- Create: `lib/prospect-share-view-eligibility.ts` (nom exact à votre convenance, garder export clair)
- Modify: `app/api/prospect-share/register-view/route.ts` (utiliser le module)
- Create: `lib/prospect-share-view-eligibility.test.ts` (ou chemin aligné sur les tests existants du repo)

**Step 1: Écrire le test en échec**

Couvrir au minimum : prospect introuvable ; pas d’IP visiteur ; pas de `shareLinkCreatorIp` ; `viewerIp === creatorIp` ; statut terminal ; statut déjà `ouvert` ; cas **éligible** pour enregistrer une session (équivalent « pas skipped » côté analytics — aligner les noms de raisons avec les réponses JSON actuelles de `register-view` pour cohérence).

**Step 2: Lancer les tests**

Run: la commande de test du projet ciblant ce fichier (ex. `pnpm test lib/prospect-share-view-eligibility.test.ts` ou équivalent dans `package.json`).

Expected: échec (module ou fonction manquante).

**Step 3: Implémenter le module**

Extraire depuis `register-view` la logique de lecture prospect + comparaison IP + `normalizeProspectPipelineStatus` / `isTerminalPipelineStatus`. Retourner un résultat typé `{ ok: false, reason: ... } | { ok: true, docRef, ... }` utilisable par `register-view` et les routes session.

**Step 4: Refactor `register-view`**

Remplacer le corps conditionnel par des appels au module ; conserver le comportement JSON actuel (`skipped`, `updated`).

**Step 5: Vérifier les tests**

Expected: PASS.

**Step 6: Commit**

```bash
git add lib/prospect-share-view-eligibility.ts lib/prospect-share-view-eligibility.test.ts app/api/prospect-share/register-view/route.ts
git commit -m "refactor(api): factoriser l'éligibilité des vues prospect partagées"
```

---

### Task 2: POST début de session

**Files:**
- Create: `app/api/prospect-share/share-session/start/route.ts`
- Modify: `lib/prospect-share-client.ts` (exporter `startProspectShareSession`)

**Step 1:** Route `POST` : body `{ shareToken, sessionId }`. Valider les chaînes. Utiliser le module d’éligibilité ; si non éligible, renvoyer `{ ok: true, skipped: reason }` sans écrire.

**Step 2:** Si éligible : `set` sur `prospects/{id}/shareSessions/{sessionId}` avec `startedAt: serverTimestamp()`, `status: "open"`, champs optionnels serveur.

**Step 3:** Client : dans `app/p/[shareToken]/page.tsx`, générer `sessionId` stable pour la durée de vie du montage (ref ou `useMemo` + `useEffect`), appeler `startProspectShareSession` une fois `shareToken` connu (après ou en parallèle de `registerProspectSharePageView` selon ordre choisi — éviter double start : garde-fou ref côté client).

**Step 4:** Commit ciblé (route + client minimal start).

---

### Task 3: POST fin de session + agrégats

**Files:**
- Create: `app/api/prospect-share/share-session/end/route.ts`
- Modify: `lib/prospect-share-client.ts` (`endProspectShareSession`)
- Modify: `lib/firestore-prospect.ts` et/ou `types/index.ts` pour champs agrégés si déjà centralisés

**Step 1:** Route `POST` : body `{ shareToken, sessionId, durationMs, maxScrollDepth01 }`. Vérifier éligibilité (même règles que start, ou assouplir uniquement sur session existante — **décision impl.** : refuser si session doc absent pour éviter spam).

**Step 2:** Transaction ou batch : mettre à jour la session (`endedAt`, `durationMs`, `maxScrollDepth01`, `status: "closed"`) ; incrémenter / mettre à jour `shareSessionCount`, `shareLastSessionAt` sur le doc prospect.

**Step 3:** Client : sur `pagehide` / `visibilitychange` (document caché), envoyer end une seule fois (ref `endedSent`).

**Step 4:** Tests : au minimum test unitaire sur calcul agrégat si extrait en fonction pure ; sinon test manuel documenté.

**Step 5:** Commit.

---

### Task 4: GET sessions + agrégats (auth)

**Files:**
- Create: `app/api/prospect-share/share-sessions/route.ts` (ex. `GET ?prospectId=` avec header `Authorization: Bearer`)
- Modify: `lib/firebase-admin.ts` si helper manquant pour `verifyIdToken` réutilisable

**Step 1:** Vérifier le token ; charger le prospect par `prospectId` ; vérifier `data.userId === uid`.

**Step 2:** Lire agrégats sur le doc prospect + query `shareSessions` orderBy `startedAt` desc limit 20.

**Step 3:** Réponse JSON typée côté client.

**Step 4:** Commit.

---

### Task 5: UI tiroir

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx`
- Create (optionnel): `components/solar-scout/ProspectShareReadingKpisPanel.tsx` si le fichier drawer est trop volumineux

**Step 1:** Si `prospect.id` : afficher la section avec résumé + tableau + bouton Actualiser.

**Step 2:** `useEffect` / handler d’ouverture : fetch quand `isOpen && prospect?.id` (respecter la préférence produit « à l’ouverture »).

**Step 3:** États vides (pas de `shareToken` / pas de lignes).

**Step 4:** Vérification manuelle : ouvrir tiroir sur prospect avec lien, consulter `/p/...` depuis autre navigateur, actualiser le tiroir.

**Step 5:** Commit.

---

### Task 6: Types + documentation inline

**Files:**
- Modify: `types/index.ts` (champs agrégats optionnels sur `Prospect` si le type est défini là)

**Step 1:** Ajouter types pour réponse API sessions.

**Step 2:** Commit.

---

## Fin de plan

**Plan enregistré dans** `docs/plans/2026-05-08-prospect-share-reading-kpis.md`.

**Deux options d’exécution :**

1. **Subagent-Driven (cette session)** — une sous-tâche à la fois, relecture entre les tâches ; skill requis : **superpowers:subagent-driven-development**.

2. **Session parallèle** — nouvelle session dans un worktree avec **superpowers:executing-plans** pour enchaîner les tâches avec points de contrôle.

Laquelle préférez-vous ?
