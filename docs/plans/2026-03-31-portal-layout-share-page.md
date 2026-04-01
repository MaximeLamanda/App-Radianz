# Portal share page layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructurer la page `/p/<token>` en “page blog/portal” avec un sommaire sticky à gauche et 4 sections à droite: Recap, Projet, Finance (template), Contact.

**Architecture:** Garder toute la logique/état existants (simulation, boutons, charts, équipements) mais refondre uniquement la structure JSX et le layout Tailwind. Utiliser des ancres HTML (`href="#recap"`) sans scrollspy (Option A).

**Tech Stack:** Next.js (App Router) + React client component + Tailwind + composants UI existants (`Card`, `Separator`, `Button`, charts existants).

---

### Task 1: Créer le layout 2 colonnes + sommaire sticky

**Files:**
- Modify: `/Users/maximelamanda/Solar-view/app/p/[shareToken]/page.tsx`

**Step 1: Refactor le conteneur**
- Remplacer la grille “bento” par `md:grid md:grid-cols-[220px_1fr] md:gap-10`.
- Conserver la barre admin (retour/copie) en haut.

**Step 2: Ajouter le sommaire**
- Ajouter un `<nav>` sticky à gauche (desktop), avec liens:
  - `#recap`, `#projet`, `#finance`, `#contact`
- Sur mobile: afficher le sommaire en haut (non sticky) ou le masquer (selon rendu).

**Step 3: Ajouter les sections à droite**
- `section#recap`: Hero + 3 KPI + bloc graphique + 2 boutons + bloc équipements.
- `section#projet`: placeholder “à venir” + (optionnel) infos adresse/type/surface/année/satellite si conservées.
- `section#finance`: placeholder template (pas la logique finance actuelle).
- `section#contact`: réutiliser la carte “Votre référent”.

**Step 4: Ajuster le contenu Recap**
- Hero:
  - “Hello” + emoji main (Apple)
  - “Welcome to the {company} Portal”
    - `company` = `commercialReferent.company ?? prospect.name ?? "Entreprise"`
- KPI:
  - Saving: `annualSavings` (€/an)
  - Break-even: `breakEvenLabel`
  - Production: `effectiveConfig.effectiveAnnualProductionKwh` converti en GWh

**Step 5: Vérifier lint/build**
- Run: `npm run lint`
- Expected: pas d’erreurs bloquantes liées au refactor.

