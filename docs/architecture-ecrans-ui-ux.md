# Architecture des écrans (UI/UX) — synthèse

## 1) Map — Analyse bâtiments (table + filtres surface)

- **Header**
  - Titre de vue + sous-titre (zone / commune / dataset)
  - Actions globales: `Importer/Sync` (optionnel), `Exporter`, `Aide`, `Paramètres`

- **Layout principal**
  - **Split view**: `Map` (gauche/plein) + `Panneau latéral` (droite)
  - Panneau latéral = **Filtres + Résultats (table)**

- **Zone Map**
  - Fond de carte + couches (bâtiments/polygones, contraintes, heatmap optionnelle)
  - Contrôles: zoom, reset view, plein écran, bascule couches
  - Interactions: hover highlight, click select (ouvre le détail)

- **Filtres (panneau latéral)**
  - **Filtre surface**: slider min/max + chips “rapides” (ex: < 200, 200–500, > 500 m²)
  - Recherche texte (adresse / ref / commune)
  - Tri (surface, potentiel, ROI, statut)
  - Toggle “uniquement intéressants / shortlist”
  - Bouton “Réinitialiser”

- **Table résultats**
  - Colonnes: Adresse/ID, Surface, Score/Potentiel, Statut, Actions
  - Ligne cliquable → sélection sur map + ouverture détail
  - Pagination / infinite scroll
  - Sélection multiple (optionnel) + actions batch (ajouter au pipeline, exporter)

- **États**
  - Loading (skeleton table + shimmer map layer)
  - Empty (aucun résultat → suggestions de filtres)
  - Error (retry)


## 2) Map — Détail polygone (focus bâtiment)

- **Déclencheur**
  - Clic sur polygone (map) ou ligne (table)

- **Pattern UI**
  - **Drawer / Sheet** latéral (desktop) + bottom sheet (mobile)

- **Contenu du drawer**
  - **En-tête**: adresse + badges (statut, priorité) + actions rapides
  - **Résumé KPI**: surface, production estimée, économies, ROI / payback (selon dispo)
  - **Média**: mini-map centrée / image satellite / aperçu toiture (optionnel)
  - **Sections**
    - “Données bâtiment” (surface, typologie, contraintes)
    - “Potentiel & hypothèses” (résumé, pas de détails techniques)
    - “Notes” (textarea) + tags (optionnel)
  - **CTA**
    - `Ajouter au pipeline`
    - `Générer vue client / partager`
    - `Marquer non pertinent`

- **États**
  - Loading (drawer skeleton)
  - Incomplet (données manquantes → placeholders cohérents)


## 3) Écran Pipeline — Bâtiments intéressants (backlog commercial)

- **Objectif UI**
  - Retrouver, qualifier, prioriser, convertir en contact / partage

- **Header**
  - Titre “Pipeline”
  - Compteurs (Total, À contacter, En cours, Gagné/Perdu)
  - Actions: `Exporter`, `Créer liste`, `Paramètres`

- **Filtres & vues**
  - Tabs par statut (À qualifier, À contacter, En cours, Clos)
  - Filtres rapides: surface, score, commune, assigné, date d’ajout
  - Recherche
  - Tri (priorité, ROI, date)

- **Liste principale**
  - **Table / List** avec lignes riches
  - Chaque item: adresse, badges statut, surface, score, dernier update, owner
  - Actions inline: `Ouvrir`, `Partager`, `Marquer`, `Assigner`

- **Détail item**
  - Drawer (comme détail polygone) ou page détail (optionnel)
  - Historique d’activité (notes, changements statut)

- **États**
  - Empty state par tab (ex: “Aucun bâtiment à contacter” + CTA “Aller sur la map”)


## 4) Vue client finale — Page “matériel de contact” (share)

- **Objectif UI**
  - Donner une page lisible, “portal”, partageable, avec matière (résumé + preuves + CTA contact)

- **Structure**
  - **Layout type portail**: sommaire gauche (desktop) + sections à droite
  - Sections typiques:
    - **Recap** (hero + 2–4 KPIs + visuels)
    - **Projet** (bâtiment, contexte, hypothèses haut niveau)
    - **Finance** (résumé économies, breakdown simple)
    - **Contact** (référent + CTA)

- **Éléments UI clés**
  - Hero (titre clair + microcopy)
  - KPIs (cartes)
  - Graphiques (production mensuelle, ROI) — lisibles, légendes courtes
  - Bloc “Équipements proposés” (cartes)
  - CTA: `Être recontacté`, `Planifier un appel`, `Télécharger PDF` (optionnel)

- **Footer**
  - Mentions + confiance (données, hypothèses) + lien retour (optionnel)

- **États**
  - Mode “données partielles” (affiche ce qui est dispo, masque le reste proprement)

