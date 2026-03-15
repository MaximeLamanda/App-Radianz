# Règles : photo et paramètres des références d’équipement

Règles pour **ajouter ou modifier une photo** et **changer les paramètres** des références (panneaux, onduleurs, batteries) dans Solar-view.

---

## 1. Photo

### 1.1 Comment ajouter ou changer la photo

- **Upload fichier**  
  - Glisser-déposer une image dans la zone « Photo », ou cliquer pour ouvrir le sélecteur de fichier.  
  - Types acceptés : **image/** (JPEG, PNG, WebP, etc.).  
  - Si le type n’est pas une image : message d’erreur « Veuillez sélectionner une image (JPEG, PNG, etc.). ».

- **URL**  
  - Saisir directement une URL d’image dans le champ « Ou coller une URL ».  
  - La valeur remplace ou complète l’upload (pas de vérification de format côté client).

- **Supprimer la photo**  
  - Bouton « Supprimer » à côté de la zone photo (visible quand une image est déjà définie et qu’il n’y a pas d’upload en cours).

### 1.2 Stockage (batteries)

- Avec **utilisateur connecté** (`userId`) :  
  `users/{userId}/battery_references/{timestamp}_{nom_fichier_sanitifé}`
- Sans userId (hors ligne / démo) :  
  `battery_references/{timestamp}_{nom_fichier_sanitifé}`
- Stockage : **Firebase Storage**. Après upload, on récupère l’URL de téléchargement et on la enregistre dans le champ `imageUrl` de la référence (Firestore).

### 1.3 Règles à respecter en code

- `accept="image/*"` sur l’`<input type="file">`.
- Vérifier `file.type.startsWith("image/")` avant l’upload.
- Pendant l’upload : désactiver le bouton / zone de dépôt et afficher un indicateur de chargement.
- En cas d’erreur : afficher un message clair (ex. `uploadError`) sans bloquer le formulaire.

---

## 2. Paramètres modifiables (batterie)

Les champs suivants sont éditables dans le formulaire de référence **batterie** et doivent être persistés en Firestore.

| Paramètre | Champ / clé | Type | Règles / contraintes |
|-----------|--------------|------|------------------------|
| **Nom / modèle** | `name` | string | Obligatoire, trim. Ex. « LUNA2000-7-S1 ». |
| **Capacité** | `capacityKwh` | number | Obligatoire, > 0. Unité : kWh. |
| **Puissance charge** | `powerChargeKw` | number | ≥ 0. Unité : kW. |
| **Puissance décharge** | `powerDischargeKw` | number | ≥ 0. Unité : kW. |
| **Rendement aller-retour** | `roundTripEfficiencyPercent` | number | Obligatoire, > 0. En %. Souvent 50–100. |
| **Coût** | `costEur` | number | ≥ 0. En €. |
| **Garantie** | `warrantyYears` | number (optionnel) | Entier, 0–30. Si 0 ou vide : `undefined`. |
| **Pays d’origine** | `countryOfOrigin` | string | Texte libre. Si vide, enregistrer « — ». |
| **Code pays** | `countryCode` | string (optionnel) | 2 caractères (ex. « cn »). Pour drapeau. |
| **Photo** | `imageUrl` | string (optionnel) | URL Firebase Storage ou toute URL d’image. Vide = pas de photo. |
| **Recommandé** | `recommended` | boolean | Une seule référence « recommandée » par type (panneau, onduleur, batterie). |
| **kWp max recommandé** | `maxKwpRecommended` | number (optionnel) | kWp max pour cette batterie. Ex. 100. |

### 2.1 Validation avant enregistrement (batterie)

- **Obligatoires** : `name` (non vide), `capacityKwh` > 0, `roundTripEfficiencyPercent` > 0, `costEur` ≥ 0.
- **Numériques** : `powerChargeKw`, `powerDischargeKw` ≥ 0 (sinon rejet ou 0 selon le produit).
- Ne pas enregistrer si une de ces conditions échoue ; afficher les erreurs côté formulaire si besoin.

---

## 3. Où c’est utilisé

- **Panneaux** : `PanelReferenceForm` (Sidebar.tsx) — même logique photo (upload + URL) et paramètres (name, powerW, costEur, warranty, country, etc.).
- **Onduleurs** : `InverterReferenceForm` (Sidebar.tsx) — idem.
- **Batteries** : `BatteryReferenceForm` (Sidebar.tsx) — photo (upload + URL), tous les paramètres ci-dessus.
- **Affichage** : Paramètres (SettingsDrawer, SettingsPopup) — onglets Panneaux / Onduleurs / Batteries ; liste + édition ; Firestore pour la persistance.

---

## 4. Récap : nouvelles règles pour photo et paramètres

1. **Photo** : upload (image/*) ou URL ; vérifier `image/` ; stocker l’URL dans `imageUrl` ; permettre suppression.
2. **Paramètres batterie** : respecter le tableau ci-dessus et la validation (obligatoires, min/max, types).
3. **Persistance** : Firestore pour les métadonnées, Firebase Storage pour les fichiers uploadés ; chemin batterie `users/{userId}/battery_references/...`.
4. **Recommandé** : une seule référence « recommandée » par type ; à la sauvegarde, mettre les autres à `recommended: false` si on coche recommandé sur une référence.

Ces règles permettent d’ajouter une photo et de changer les paramètres de façon cohérente dans toute l’app (formulaires, paramètres, calculs batterie).
