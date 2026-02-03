# Solar View

Plateforme de capture et gestion de leads pour installations solaires.

## Technologies

- **Next.js 14** avec App Router
- **TypeScript**
- **Tailwind CSS**
- **shadcn/ui** pour les composants UI
- **Firebase** (Firestore, Storage, Analytics)

## Structure du projet

### Modules

1. **Solar Scout** (`/solar-scout`)
   - Module de capture de leads basé sur une adresse
   - Carte Google Maps avec vue satellite
   - Dessin de polygones pour calculer la surface de toit
   - Bandeau latéral avec recherche d'adresse et informations du prospect

2. **Lead Inbox** (`/lead-inbox`)
   - Tableau de bord des leads
   - Affichage des leads avec thumbnails de toiture
   - Informations : nom, quality score, contact

## Installation

```bash
npm install
```

## Configuration

La configuration Firebase est déjà intégrée dans `lib/firebase.ts`.

Pour utiliser Google Maps, vous devrez ajouter votre clé API dans un fichier `.env.local` :

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=votre_cle_api
```

**Important** : Pour utiliser Google Maps, vous devez :
1. Activer les APIs suivantes dans Google Cloud Console :
   - Maps JavaScript API
   - Maps Drawing API (pour le dessin de polygones)
   - Places API (pour la recherche d'adresses)
2. S'assurer que votre clé API a les permissions pour ces APIs

## Développement

```bash
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

## Fonctionnalités implémentées

- [x] Intégration Google Places API pour la recherche d'adresse
- [x] Détection automatique du type de lieu via Places API
- [x] Ajout des prospects au pipeline Firebase
- [x] Dessin de polygones sur la carte pour calculer la surface de toit
