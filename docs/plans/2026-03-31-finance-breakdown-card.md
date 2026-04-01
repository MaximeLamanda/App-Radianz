# Finance breakdown card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implémenter dans `/p/<token>` une section Finance inspirée du bloc “Visitor Channels” avec une barre segmentée représentant la répartition des économies (batterie / direct / injection), plus légende et mini-table.

**Architecture:** Réutiliser les valeurs déjà calculées sur la page partagée (`selfConsumptionDirectKwhTotal`, `selfConsumptionViaBatteryKwhTotal`, `injectionReseauKwhTotal`, `DEFAULT_*_EUR_PER_KWH`) pour dériver des montants en €. Afficher un état vide si aucune donnée.

**Tech Stack:** React + Tailwind (dans `app/p/[shareToken]/page.tsx`), composants UI existants (`Card`, `Separator`, `Button` si utile).

---

### Task 1: Ajouter la card Finance dans `section#finance`

**Files:**
- Modify: `/Users/maximelamanda/Solar-view/app/p/[shareToken]/page.tsx`

**Step 1: Calculs dérivés (dans le render)**
- Calculer `directEur`, `viaBatteryEur`, `injectionEur`, `totalSavings`.
- Calculer `pct*` pour les largeurs/labels, gardes-fous si `totalSavings <= 0`.
- Formattage : `€` ou `k€` (même logique que le bloc existant).

**Step 2: UI (card)**
- Header: “Finance” + (optionnel) bouton “Details” placeholder.
- KPI: Savings total.
- Barre segmentée: 3 segments (bleu, gris, vert), arrondie, hauteur 10px.
- Légende: dot + label + % + montant.
- Mini-table: “Canal | Percent | Total”.

**Step 3: Vérification**
- Run: `npm run lint`
- Expected: pas d’erreurs (warnings existants ok).

