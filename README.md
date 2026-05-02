# app.Radianz

Plateforme complète de prospection et gestion de leads pour installations solaires photovoltaïques. Application web permettant d'identifier, analyser et qualifier des prospects pour des projets d'énergie solaire.

## 🎯 Vue d'ensemble

Radianz est une application Next.js qui permet aux professionnels du solaire de :
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
- **Recharts** pour les graphiques (production mensuelle, KPIs, répartition par type)
- **Fuse.js** pour la recherche floue (matching SIREN local)
- **API PVGIS** (Commission Européenne) pour la production solaire réelle par localisation
- **API recherche-entreprises** (api.gouv.fr) pour l'enrichissement SIREN/SIRET

## 📁 Structure du projet

### Modules principaux

1. **Home / Tableau de bord** (`/`)
   - Vue d'ensemble des prospects et leads
   - Graphiques : évolution des leads (quotidien/semaine/année), répartition par type de bâtiment
   - Tableau des prospects avec filtres (statut pipeline, type de lieu)
   - Ouverture du drawer prospect via `?prospectId=`

2. **Solar Scout** (`/solar-scout`)
   - Module principal de prospection
   - Carte interactive Google Maps avec vue satellite
   - Recherche d'adresses et de lieux par type
   - Dessin de polygones pour mesurer les surfaces de toit
   - Calcul automatique du potentiel solaire
   - Système de scoring de qualité des prospects
   - Persistance de la position de la carte (localStorage)

3. **Lead Inbox** (`/lead-inbox`)
   - Liste des leads (collection Firestore `leads`)

4. **Admin** (`/admin`)
   - Interface d'administration
   - Initialisation des données de consommation énergétique

### Données et documentation technique

- **`datasource/`** : fichiers lourds (OSM `.pbf`, BDNB zip/CSV, cadastre gzip, parquet PPM) — inventaire dans [`datasource/README.md`](./datasource/README.md)
- **`data-pipeline/`** : ETL Python, schémas SQL, exports matching — [`data-pipeline/README.md`](./data-pipeline/README.md)
- **`docs/`** : matching V5, pipeline BDNB, dépannage Google Maps, notes satellite

### Composants principaux

- `AppSidebar` : Barre latérale de navigation (Home, Solar Scout, Paramètres)
- `MapComponent` : Carte Google Maps avec dessin de polygones
- `Sidebar` : Panneau latéral Solar Scout avec recherche et paramètres
- `ProspectDrawer` : Drawer avec informations détaillées du prospect (PVGIS, SIREN, graphiques)
- `SettingsDrawer` : Drawer global pour gérer les références de panneaux et onduleurs
- `SatelliteImage` : Affichage et analyse d'images satellites
- `MonthlyProductionChart` : Graphique production mensuelle / journalière (PVGIS)
- `GoogleMapsLoader` : Chargement dynamique de l'API Google Maps
- `DrawerProvider` / `drawer-context` : Contexte global pour ouvrir des drawers

### Bibliothèques utilitaires

- `places-search.ts` : Recherche de lieux par type
- `places-new-api.ts` : Détails des lieux via Places API
- `satellite-image.ts` : Récupération d'images satellites
- `solar-settings.ts` : Gestion des paramètres d'équipement solaire
- `building-energy-consumption.ts` : Données de consommation énergétique
- `firestore-energy-data.ts` : Gestion des données énergétiques dans Firestore
- `firestore.ts` : Opérations CRUD sur Firestore
- `firestore-panel-references.ts` : Références de panneaux dans Firebase
- `firestore-inverter-references.ts` : Références d'onduleurs dans Firebase
- `firestore-prospect.ts` : Préparation et lecture des prospects Firestore
- `pvgis.ts` : Intégration API PVGIS (production solaire, données horaires)
- `find-local-siren.ts` : Matching SIREN/SIRET local via API Sirene (api.gouv)
- `recherche-entreprises.ts` : Enrichissement entreprises (api.gouv.fr)
- `surface-to-kwp.ts` : Calcul kWp à partir de la surface de toit
- `geometry.ts` : Utilitaires géométriques (centroïde polygone)
- `map-position-storage.ts` : Persistance de la position de la carte
- `prospect-storage.ts` : Stockage local des prospects
- `place-types-translation.ts` : Traduction des types de lieux Google Places

## 🚀 Installation

```bash
# Cloner le projet
git clone <repository-url>
cd app.Radianz

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

# Google Solar API (optionnel, recommandé pour /api/google-solar-insights)
# Clé serveur uniquement : pas de préfixe NEXT_PUBLIC. Activez l’API Solar et la facturation.
# En local : redémarrez `npm run dev` après modification.
GOOGLE_SOLAR_API_KEY=votre_cle_dediee_solar

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
5. **Solar API** - Pour le test « Google Solar » (`GET /api/google-solar-insights`) ; utilisez une clé dédiée `GOOGLE_SOLAR_API_KEY` sans restriction « sites web » (appels depuis le serveur Next.js)

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

# Initialiser les données énergétiques dans Firebase
npm run init-energy-data

# Mettre à jour les profils de consommation horaire (Firebase)
npm run update-hourly-consumption
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

### Routes API

- `GET /api/google-solar-insights` : Test Building Insights (Google Solar), auth requise ; query `lat`, `lng`, optionnel `requiredQuality` (défaut côté app : MEDIUM). Préférez `GOOGLE_SOLAR_API_KEY` dans `.env.local`.
- `POST /api/pvgis` : Données de production solaire PVGIS (annuelles/mensuelles)
- `POST /api/pvgis-hourly` : Profil journalier typique (24h) pour 1 kWp
- `GET /api/find-local-siren` : Matching SIREN/SIRET local (paramètres : `poiName`, `address`, `lat`, `lon`)
- `GET /api/recherche-entreprises` : Enrichissement entreprise via api.gouv
- `GET /api/init-panel-references` : Initialisation des références panneaux dans Firestore
- `GET /api/init-energy-data` : Initialisation des données de consommation énergétique

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
- **PVGIS** (Commission Européenne) : Production solaire réelle par localisation
  - Production annuelle et mensuelle
  - Irradiation et inclinaison/azimut optimaux
  - Profil journalier typique (24h) pour comparaison production/consommation
  - Appel automatique à l'ouverture du drawer prospect
- **Modes de configuration** : Perfect fit (production ≈ consommation) ou Highest production (max surface)
- **Paramètres configurables** :
  - Références de panneaux et onduleurs stockées dans Firebase (Settings Drawer)
  - Type de panneau (monocristallin, polycristallin, couche mince, bifacial)
  - Type d'onduleur (central, string, micro-onduleur, optimiseur)
  - Puissance et rendement des panneaux
- **Consommation énergétique** : Estimation de la consommation selon le type de bâtiment
- **Couverture solaire** : Calcul du pourcentage de couverture de la consommation
- **Orientation du toit** : Azimut calculé depuis le polygone dessiné

### 🎯 Scoring et qualification

- **Quality Score** : Score de 0 à 100 basé sur :
  - Surface de toit disponible (40 points max)
  - Type de bâtiment (30 points max)
- **Types prioritaires** : Entrepôts, supermarchés et sites industriels ont un score plus élevé

### 📸 Images satellites

- **Affichage d'images satellites** : Utilise uniquement **Google Maps Static API**
- **Configuration** : Nécessite `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` dans `.env.local`
- **Note** : Certaines zones géographiques peuvent être soumises à des restrictions EEA (voir [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md))
- **Détection automatique de toits** : (En développement) Détection via YOLO ou API cloud
- **Thumbnails** : Génération de miniatures pour les leads

### 🏢 Enrichissement entreprises (api.gouv.fr)

- **Recherche SIREN/SIRET** : Enrichissement automatique des prospects via `recherche-entreprises.api.gouv.fr`
  - Nom légal, dirigeant, adresse, NAF, téléphone
- **Find Local SIREN** : Matching établissement local vs sièges nationaux (API Sirene)
  - Scoring composite (nom, rue, code postal, distance GPS)
  - 4 requêtes parallèles pour maximiser la pertinence

### 💰 Estimation financière

- **Coûts d'installation** : Estimation à partir des références panneaux/onduleurs
- **Fourchette de prix** : Min/max selon puissance installée
- **ROI et break-even** : Temps de retour sur investissement en années

### 💾 Gestion des données

- **Pipeline Firebase** : Stockage des prospects et leads dans Firestore
- **Références panneaux/onduleurs** : Stockées dans Firebase (priorité) avec fallback localStorage
- **Données énergétiques** : Base de données de consommation par type de bâtiment
- **Persistance locale** : Paramètres d'équipement, position de la carte

### 📋 Gestion des prospects

- **Drawer d'informations** : Panneau latéral avec détails complets du prospect
- **Édition** : Modification des informations du prospect
- **Ajout au pipeline** : Conversion du prospect en lead (avec prix et break-even)
- **Suppression de surfaces** : Gestion des surfaces de toit multiples
- **Ouverture par URL** : `/?prospectId=<id>` pour ouvrir directement un prospect

## 📚 Documentation additionnelle

- **[datasource/README.md](./datasource/README.md)** : inventaire des fichiers sources (cadastre, BDNB, OSM, PPM) et imports
- **[docs/MATCHING-V5.md](./docs/MATCHING-V5.md)** : matching discovery V5 (pipeline + carte)
- **[docs/ROOFTOP_DETECTION.md](./docs/ROOFTOP_DETECTION.md)** : détection automatique de toits (YOLO / API)
- **[docs/satellite/README.md](./docs/satellite/README.md)** : notes historiques satellite / Static API
- **[docs/ENERGY_CONSUMPTION_DATA.md](./docs/ENERGY_CONSUMPTION_DATA.md)** : données de consommation énergétique
- **[docs/INIT_ENERGY_DATA.md](./docs/INIT_ENERGY_DATA.md)** : initialisation des données énergétiques
- **[docs/PVGIS_OUTPUT_UNITS.md](./docs/PVGIS_OUTPUT_UNITS.md)** : unités et sorties PVGIS
- **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** : dépannage Google Maps / clés API

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

- [x] Estimation de coûts d'installation
- [x] Calcul de ROI et temps de retour sur investissement
- [x] Orientation du toit (azimut calculé depuis le polygone)
- [x] Visualisation du polygone bâtiment BDNB au clic (France)
- [ ] Détection automatique de toits via IA (YOLO ou API cloud)
- [ ] Export de rapports PDF
- [ ] Intégration CRM
- [ ] Notifications et rappels

## 🌍 Futur du projet

### Expansion géographique européenne

L'intégration de la BDNB (France) ouvre la voie à une couverture pan-européenne. Chaque pays dispose de sa propre base de données bâtiments, avec des maturités variables :

| Pays | Base de données | Polygones | Année construction | API gratuite |
|---|---|---|---|---|
| 🇫🇷 France | **BDNB** (CSTB) — déjà intégré | ✅ | ✅ | ✅ |
| 🇳🇱 Pays-Bas | **BAG** (Kadaster) | ✅ | ✅ | ✅ (clé simple) |
| 🇪🇸 Espagne | **Catastro** (Ministerio) | ✅ | ✅ | ✅ (sans clé) |
| 🇩🇰 Danemark | **BBR** | ✅ | ✅ | ✅ |
| 🇧🇪 Belgique | **URBIS / CadGIS** | ✅ | partiel | ✅ |
| 🇩🇪 Allemagne | **ALKIS** | ✅ | partiel | variable par Land |
| 🇬🇧 Royaume-Uni | **OS MasterMap / EPC** | ✅ | ✅ (EPC) | ✅ |
| 🇮🇹 Italie | **Catasto** | ✅ | limité | limité |

**Architecture cible** : détecter le pays du point cliqué via reverse geocoding (Nominatim), puis router vers l'API nationale correspondante, avec un fallback OpenStreetMap (Overpass API) pour les pays non encore intégrés.

### Enrichissement des données bâtiment

- **DPE tertiaire** : Intégration des données de performance énergétique ADEME pour affiner l'estimation de consommation des bâtiments prospects (déjà disponible dans la BDNB Expert)
- **Hauteur de bâtiment** : Exploiter `hauteur_mean` (BDNB / BD TOPO IGN) pour estimer le nombre d'étages et la toiture accessible
- **Données photovoltaïques existantes** : Croisement avec le registre des installations PV (ENEDIS/ORE) pour exclure les bâtiments déjà équipés

### Automatisation de la surface de toit

- **Pré-remplissage automatique du polygone** : Utiliser le polygone BDNB comme surface initiale au lieu du dessin manuel, avec possibilité de correction
- **Détection IA de toiture** : Segmentation automatique via modèle YOLO entraîné sur images satellites pour isoler la surface utile réelle (hors équipements techniques, cheminées, etc.)
- **Taux d'occupation du toit** : Estimation automatique du pourcentage de surface disponible selon le type de bâtiment

### Fonctionnalités commerciales

- **Export PDF** : Rapport de prospection complet avec carte, analyse solaire, estimation financière, et logo du commercial
- **Intégration CRM** : Synchronisation avec HubSpot, Salesforce ou Pipedrive via webhooks
- **Lien de partage prospect** : Page publique déjà partiellement développée (`/p/[shareToken]`) pour envoyer une proposition au propriétaire
- **Notifications et rappels** : Alertes de suivi sur les prospects en cours de traitement

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

## 📝 Licence

[À définir]

## 👥 Auteurs

[À compléter]
