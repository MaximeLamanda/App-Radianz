# Solar View

Plateforme complète de prospection et gestion de leads pour installations solaires photovoltaïques. Application web permettant d'identifier, analyser et qualifier des prospects pour des projets d'énergie solaire.

## 🎯 Vue d'ensemble

Solar View est une application Next.js qui permet aux professionnels du solaire de :
- **Prospecter** des bâtiments via Google Maps
- **Analyser** le potentiel solaire des toitures
- **Qualifier** les leads avec un système de scoring
- **Gérer** un pipeline de prospects et leads

## 🛠️ Technologies

- **Next.js 14** avec App Router
- **TypeScript** pour la sécurité de type
- **Tailwind CSS** pour le styling
- **shadcn/ui** pour les composants UI réutilisables
- **Firebase** (Firestore pour la base de données, Storage pour les images)
- **Google Maps API** (Maps JavaScript API, Places API, Static Maps API)
- **Radix UI** pour les composants accessibles

## 📁 Structure du projet

### Modules principaux

1. **Solar Scout** (`/solar-scout`)
   - Module principal de prospection
   - Carte interactive Google Maps avec vue satellite
   - Recherche d'adresses et de lieux par type
   - Dessin de polygones pour mesurer les surfaces de toit
   - Calcul automatique du potentiel solaire
   - Système de scoring de qualité des prospects

2. **Lead Inbox** (`/lead-inbox`)
   - Tableau de bord de gestion des leads
   - Affichage des leads avec thumbnails de toiture
   - Informations : nom, quality score, contact
   - Filtrage et tri des leads

3. **Admin** (`/admin`)
   - Interface d'administration
   - Initialisation des données de consommation énergétique

### Composants principaux

- `MapComponent` : Carte Google Maps avec dessin de polygones
- `Sidebar` : Panneau latéral avec recherche et paramètres
- `ProspectDrawer` : Drawer avec informations détaillées du prospect
- `SatelliteImage` : Affichage et analyse d'images satellites
- `GoogleMapsLoader` : Chargement dynamique de l'API Google Maps

### Bibliothèques utilitaires

- `places-search.ts` : Recherche de lieux par type
- `places-new-api.ts` : Détails des lieux via Places API
- `satellite-image.ts` : Récupération d'images satellites
- `solar-settings.ts` : Gestion des paramètres d'équipement solaire
- `building-energy-consumption.ts` : Données de consommation énergétique
- `firestore-energy-data.ts` : Gestion des données énergétiques dans Firestore
- `firestore.ts` : Opérations CRUD sur Firestore

## 🚀 Installation

```bash
# Cloner le projet
git clone <repository-url>
cd Solar-view

# Installer les dépendances
npm install
```

## ⚙️ Configuration

### Variables d'environnement

Créez un fichier `.env.local` à la racine du projet :

```env
# Google Maps API
# Google Maps API Key (obligatoire)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=votre_cle_api_google_maps

# Firebase (si nécessaire)
NEXT_PUBLIC_FIREBASE_API_KEY=votre_cle_firebase
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=votre_domaine.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=votre_project_id

# Image du panneau par défaut (optionnel)
# Bucket Storage : solarview-8aec9.firebasestorage.app
# Dans Firebase Console → Storage → clic sur l'image → "Obtenir le lien" → coller l'URL ici
# NEXT_PUBLIC_DEFAULT_PANEL_IMAGE_URL=https://firebasestorage.googleapis.com/v0/b/solarview-8aec9.firebasestorage.app/o/...
```

### Configuration Google Cloud Console

Pour utiliser Google Maps, vous devez activer les APIs suivantes dans [Google Cloud Console](https://console.cloud.google.com/) :

1. **Maps JavaScript API** - Pour la carte interactive
2. **Places API** - Pour la recherche d'adresses et de lieux
3. **Maps Static API** - Pour les images satellites
4. **Geocoding API** - Pour la conversion d'adresses en coordonnées

### Configuration Firebase

La configuration Firebase est déjà intégrée dans `lib/firebase.ts`. Assurez-vous que votre projet Firebase est correctement configuré avec :
- Firestore Database activé
- Storage activé (pour les thumbnails)

## 💻 Développement

```bash
# Démarrer le serveur de développement
npm run dev

# Build de production
npm run build

# Démarrer le serveur de production
npm start

# Linter
npm run lint
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

## ✨ Fonctionnalités

### 🔍 Prospection

- **Recherche d'adresses** : Autocomplétion avec Google Places API
- **Recherche par type de lieu** : Recherche de bâtiments par catégorie (entrepôts, supermarchés, bureaux, etc.)
- **Recherche par rayon** : Trouver des bâtiments dans un rayon défini autour d'un point
- **Détection automatique du type** : Identification automatique du type de bâtiment via Places API

### 🗺️ Cartographie

- **Carte interactive** : Google Maps avec vue satellite
- **Dessin de polygones** : Outil de dessin pour mesurer les surfaces de toit
- **Multiples surfaces** : Support de plusieurs surfaces de toit par bâtiment
- **Calcul automatique** : Calcul de la surface en m² en temps réel
- **Marqueurs de recherche** : Affichage des résultats de recherche sur la carte

### 📊 Analyse solaire

- **Potentiel solaire** : Calcul automatique du potentiel d'installation
  - Nombre de panneaux possibles
  - Surface maximale d'installation
  - Production annuelle estimée (kWh/an)
  - Heures d'ensoleillement
- **Paramètres configurables** :
  - Type de panneau (monocristallin, polycristallin, couche mince, bifacial)
  - Type d'onduleur (central, string, micro-onduleur, optimiseur)
  - Puissance et rendement des panneaux
- **Consommation énergétique** : Estimation de la consommation selon le type de bâtiment
- **Couverture solaire** : Calcul du pourcentage de couverture de la consommation

### 🎯 Scoring et qualification

- **Quality Score** : Score de 0 à 100 basé sur :
  - Surface de toit disponible (40 points max)
  - Type de bâtiment (30 points max)
- **Types prioritaires** : Entrepôts, supermarchés et sites industriels ont un score plus élevé

### 📸 Images satellites

- **Affichage d'images satellites** : Utilise uniquement **Google Maps Static API**
- **Configuration** : Nécessite `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` dans `.env.local`
- **Note** : Certaines zones géographiques peuvent être soumises à des restrictions EEA (voir `TROUBLESHOOTING.md`)
- **Détection automatique de toits** : (En développement) Détection via YOLO ou API cloud
- **Thumbnails** : Génération de miniatures pour les leads

### 💾 Gestion des données

- **Pipeline Firebase** : Stockage des prospects et leads dans Firestore
- **Données énergétiques** : Base de données de consommation par type de bâtiment
- **Persistance locale** : Sauvegarde des paramètres d'équipement dans localStorage

### 📋 Gestion des prospects

- **Drawer d'informations** : Panneau latéral avec détails complets du prospect
- **Édition** : Modification des informations du prospect
- **Ajout au pipeline** : Conversion du prospect en lead
- **Suppression de surfaces** : Gestion des surfaces de toit multiples

## 📚 Documentation additionnelle

Le projet inclut plusieurs fichiers de documentation :

- **[ROOFTOP_DETECTION.md](./ROOFTOP_DETECTION.md)** : Guide complet pour la détection automatique de toits
- **[docs/ENERGY_CONSUMPTION_DATA.md](./docs/ENERGY_CONSUMPTION_DATA.md)** : Documentation sur les données de consommation énergétique
- **[docs/INIT_ENERGY_DATA.md](./docs/INIT_ENERGY_DATA.md)** : Guide d'initialisation des données énergétiques
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** : Guide de dépannage

## 🎨 Types de bâtiments supportés

L'application supporte la recherche et l'analyse de nombreux types de bâtiments :

- **Entrepôts** : Warehouses, storage facilities
- **Commerce** : Supermarchés, magasins, centres commerciaux
- **Bureaux** : Offices, banques
- **Industriel** : Usines, sites industriels
- **Restaurants** : Restaurants, cafés, bars
- **Sport** : Salles de sport, piscines
- Et bien d'autres...

## 📈 Données de consommation énergétique

L'application utilise une base de données de consommation énergétique typique par type de bâtiment (en kWh/m²/an), stockée dans **Firebase Firestore** (collection `building_energy_consumption`).

### Mettre les données de consommation dans Firebase

Pour peupler Firebase avec la base de consommation (à faire une fois après configuration Firebase) :

1. **Via l’interface** : lancer l’app (`npm run dev`), puis ouvrir [http://localhost:3000/admin/init-energy-data](http://localhost:3000/admin/init-energy-data) et cliquer sur « Initialiser les données dans Firebase ».
2. **En ligne de commande** : `npm run init-energy-data` (nécessite `npm install` pour avoir `tsx`).

Valeurs typiques (kWh/m²/an) :

- **Supermarchés** : 350 kWh/m²/an (réfrigération intensive)
- **Restaurants** : 464 kWh/m²/an (très énergivore)
- **Entrepôts** : 55 kWh/m²/an (faible consommation)
- **Bureaux** : 190 kWh/m²/an
- Et plus...

Voir [docs/ENERGY_CONSUMPTION_DATA.md](./docs/ENERGY_CONSUMPTION_DATA.md) pour la liste complète et [docs/INIT_ENERGY_DATA.md](./docs/INIT_ENERGY_DATA.md) pour le détail de l’initialisation.

## 🔧 Fonctionnalités en développement

- [ ] Détection automatique de toits via IA (YOLO ou API cloud)
- [ ] Calcul d'exposition solaire (orientation nord/sud/est/ouest)
- [ ] Estimation de coûts d'installation
- [ ] Calcul de ROI et temps de retour sur investissement
- [ ] Export de rapports PDF
- [ ] Intégration CRM
- [ ] Notifications et rappels

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

## 📝 Licence

[À définir]

## 👥 Auteurs

[À compléter]
