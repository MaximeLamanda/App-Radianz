# Plan simplifié : Optimistic updates batterie / onduleur

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplifier les optimistic updates en supprimant la revalidation après succès, qui provoque encore un refetch et annule l'effet visuel instantané.

**Architecture:** Le plan actuel appelle `mutate(undefined, { revalidate: true })` après chaque sauvegarde Firebase réussie. Cela déclenche un refetch de la liste et recrée le problème visuel ("ça recherche la liste à chaque fois"). La simplification consiste à **ne plus revalider après succès** : le cache SWR contient déjà les bonnes données via l'optimistic update. Revalidation uniquement en cas d'erreur (rollback).

**Tech Stack:** React, SWR, Firebase Firestore

---

## Diagnostic

Le flux actuel après un clic sur un switch :

1. Optimistic update : `mutate(nextList, { revalidate: false })` — UI mise à jour immédiatement ✓
2. Sauvegarde Firebase
3. **Succès : `mutate(undefined, { revalidate: true })`** — déclenche un refetch → problème visuel
4. Erreur : `mutate()` — refetch pour rollback ✓

La revalidation en (3) est superflue et contre-productive : les données sont déjà correctes dans le cache.

---

## Fichiers à modifier

- [components/solar-scout/SettingsDrawer.tsx](components/solar-scout/SettingsDrawer.tsx)
- [components/solar-scout/SettingsPopup.tsx](components/solar-scout/SettingsPopup.tsx)

---

### Task 1 : SettingsDrawer — Supprimer revalidation après succès

**Fichier :** `components/solar-scout/SettingsDrawer.tsx`

**Switch onduleurs (lignes ~559-562)** — Remplacer le `.then()` :

```tsx
// AVANT
.then(() => {
  mutateInverters(undefined, { revalidate: true });
})

// APRÈS
.then(() => { /* pas de revalidation — cache déjà correct */ })
```

En pratique : supprimer l'appel à `mutateInverters` dans le `.then()` et laisser le bloc vide ou le supprimer si le `.catch` reste.

**Switch batteries (lignes ~664-667)** — Même modification pour `mutateBatteries`.

---

### Task 2 : SettingsPopup — Supprimer revalidation après succès

**Fichier :** `components/solar-scout/SettingsPopup.tsx`

**Switch onduleurs (lignes ~900-906)** — Dans le `try`, supprimer la ligne `mutateInverters(undefined, { revalidate: true });` après les `await saveInverterReferenceToFirebase`.

**Switch batteries (lignes ~1005-1010)** — Même chose pour `mutateBatteries(undefined, { revalidate: true });`.

---

## Résultat attendu

- Clic sur un switch → UI mise à jour immédiatement (optimistic update)
- Sauvegarde Firebase en arrière-plan, sans refetch
- Erreur → rollback via `mutate()` (refetch)

Plus de "recherche la liste à chaque fois" ni de flicker visuel.
