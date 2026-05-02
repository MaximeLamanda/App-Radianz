# Guide de dépannage - Google Maps API

## Erreur d'authentification Google Maps

Si vous voyez le message "Erreur d'authentification Google Maps", suivez ces étapes :

### 1. Vérifier la clé API dans .env.local

Assurez-vous que le fichier `.env.local` contient votre clé API :

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=votre_cle_api_ici
```

**Important** : 
- Pas d'espaces autour du `=`
- Pas de guillemets autour de la clé
- Redémarrez le serveur après modification (`npm run dev`)

### 2. Vérifier dans Google Cloud Console

1. Allez sur https://console.cloud.google.com/
2. Sélectionnez votre projet
3. Allez dans **APIs & Services** > **Credentials**
4. Cliquez sur votre clé API

#### Vérifications à faire :

**a) APIs activées :**
- ✅ Maps JavaScript API
- ✅ Maps Drawing API (pour le dessin de polygones)
- ✅ **Maps Static API** (pour les images satellites) ⚠️ IMPORTANT
- ✅ Places API (pour la recherche d'adresses)
- ✅ Geocoding API (pour la conversion d'adresses)

**b) Restrictions d'application :**
- Si vous avez des restrictions HTTP, ajoutez :
  - `http://localhost:3000/*`
  - `http://127.0.0.1:3000/*`
  - `localhost:3000/*` (sans http://)
- **Pour l'API Static Maps**, les restrictions HTTP sont critiques. Si les images satellites ne se chargent pas, vérifiez que ces domaines sont bien autorisés.
- Ou temporairement, supprimez les restrictions pour tester

**c) Restrictions d'API :**
- Assurez-vous que toutes ces APIs sont dans la liste des APIs autorisées :
  - Maps JavaScript API
  - **Maps Static API** ⚠️ Nécessaire pour les images satellites
  - Places API
  - Geocoding API
- Ou temporairement, sélectionnez "Don't restrict key" pour tester

### 3. Tester la clé API directement

Vous pouvez tester votre clé API en ouvrant cette URL dans votre navigateur :

```
https://maps.googleapis.com/maps/api/js?key=VOTRE_CLE_API&libraries=drawing
```

Si vous voyez une erreur dans la réponse, cela vous donnera plus d'informations.

### 4. Erreurs courantes

#### "This API key is not authorized"
→ L'API Maps JavaScript n'est pas activée dans Google Cloud Console

#### "RefererNotAllowedMapError"
→ Les restrictions de domaine bloquent votre domaine. Ajoutez `localhost:3000` aux domaines autorisés.

#### "ApiNotActivatedMapError"
→ Activez l'API Maps JavaScript dans Google Cloud Console

#### "ApiTargetBlockedMapError"
→ **C'est votre erreur actuelle !** Les restrictions d'API bloquent l'utilisation. Solutions :
  - Allez dans Google Cloud Console → APIs & Services → Credentials → Votre clé API
  - Dans "API restrictions", sélectionnez soit :
    - "Don't restrict key" (pour tester rapidement)
    - OU "Restrict key" et ajoutez "Maps JavaScript API" à la liste
  - Dans "Application restrictions", ajoutez `localhost:3000/*` si vous avez des restrictions HTTP
  - Cliquez sur "Save" et attendez quelques secondes
  - Rechargez votre page

### 5. Redémarrer le serveur

Après avoir modifié `.env.local` ou les restrictions dans Google Cloud Console :

```bash
# Arrêter le serveur (Ctrl+C)
# Puis relancer
npm run dev
```

### 6. Vérifier la console du navigateur

Ouvrez la console du navigateur (F12) et regardez les erreurs. Google Maps affiche souvent des messages d'erreur détaillés qui vous aideront à identifier le problème.

## Problème avec les images satellites (API Static Maps)

Si les images satellites ne se chargent pas dans le composant `SatelliteImage` :

### Symptômes
- L'image satellite ne s'affiche pas
- Message d'erreur dans la console du navigateur
- Erreur 403 Forbidden lors du chargement de l'image

### Solutions

1. **Vérifier que l'API Static Maps est activée**
   - Allez dans Google Cloud Console → APIs & Services → Library
   - Recherchez "Maps Static API"
   - Cliquez sur "Enable" si ce n'est pas déjà fait

2. **Vérifier les restrictions HTTP de la clé API**
   - Allez dans Google Cloud Console → APIs & Services → Credentials
   - Cliquez sur votre clé API
   - Dans "Application restrictions", sélectionnez "HTTP referrers (web sites)"
   - Ajoutez ces domaines :
     - `localhost:3000/*`
     - `127.0.0.1:3000/*`
     - `http://localhost:3000/*`
     - `http://127.0.0.1:3000/*`
   - Cliquez sur "Save"

3. **Tester l'URL directement dans le navigateur**
   - Ouvrez la console du navigateur (F12)
   - Regardez les logs `[SatelliteImage]` qui affichent l'URL complète
   - Copiez l'URL et collez-la directement dans la barre d'adresse du navigateur
   - Si l'image s'affiche dans le navigateur mais pas dans l'application, c'est un problème de restrictions de domaine
   - Si l'image ne s'affiche pas non plus dans le navigateur, vérifiez que l'API Static Maps est bien activée

4. **Vérifier les restrictions d'API**
   - Dans Google Cloud Console → Votre clé API
   - Dans "API restrictions", assurez-vous que "Maps Static API" est dans la liste
   - Ou sélectionnez temporairement "Don't restrict key" pour tester

5. **Vérifier la clé API dans .env.local**
   - Assurez-vous que `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` est bien définie
   - Redémarrez le serveur après modification (`npm run dev`)

### Erreurs courantes pour l'API Static Maps

#### Erreur 403 Forbidden
- **Cause** : Restrictions de domaine HTTP qui bloquent localhost
- **Solution** : Ajoutez `localhost:3000/*` aux restrictions HTTP de la clé API

#### L'image ne se charge pas mais l'URL fonctionne dans le navigateur
- **Cause** : Problème avec Next.js Image ou restrictions CORS
- **Solution** : Le code utilise maintenant une balise `<img>` native par défaut. Si le problème persiste, vérifiez les restrictions de domaine.

#### "This API key is not authorized"
- **Cause** : L'API Static Maps n'est pas activée dans Google Cloud Console
- **Solution** : Activez l'API Static Maps dans Google Cloud Console → APIs & Services → Library

#### Erreur 403 : "Your request cannot be served because satellite and hybrid imagery is not available for this location"
- **Cause** : **Restriction géographique EEA (European Economic Area)** - Google bloque les images satellite/hybrid pour certaines zones géographiques en Europe
- **Message d'erreur typique** : `Your request cannot be served because satellite and hybrid imagery is not available for this location. Please see https://developers.google.com/maps/comms/eea/maps-static.`
- **Pourquoi cela arrive** : Google Maps a des restrictions légales sur les images satellite dans certaines zones de l'EEE (Espace Économique Européen) pour des raisons de sécurité nationale ou de réglementation
- **Solutions possibles** :
  1. **Solution automatique (déjà implémentée)** : L'application bascule automatiquement en mode `roadmap` lorsque cette restriction est détectée
  2. **Utiliser une autre source d'images satellites** :
     - **Mapbox** : Offre des images satellite avec moins de restrictions géographiques
     - **Bing Maps** : Alternative à Google Maps avec des images satellite
     - **OpenStreetMap + services tiers** : Solutions open-source
  3. **Utiliser l'API JavaScript Maps au lieu de Static Maps** : L'API JavaScript peut parfois contourner certaines restrictions, mais nécessite un chargement différent
  4. **Accepter la limitation** : Utiliser le mode `roadmap` pour les zones concernées (solution actuelle)
- **Note** : Cette restriction est **géographique** et ne peut pas être contournée en modifiant la clé API ou les restrictions de domaine. C'est une limitation imposée par Google pour certaines zones spécifiques.

## Obtenir une nouvelle clé API

Si vous n'avez pas de clé API :

1. Allez sur https://console.cloud.google.com/
2. Créez un nouveau projet ou sélectionnez un projet existant
3. Activez les APIs :
   - Maps JavaScript API
   - Maps Drawing API
4. Allez dans **APIs & Services** > **Credentials**
5. Cliquez sur **Create Credentials** > **API Key**
6. Copiez la clé et ajoutez-la dans `.env.local`
7. Configurez les restrictions (recommandé pour la production)

---

## Voir aussi

- Notes et historique de diagnostic **images satellite** : [`satellite/README.md`](./satellite/README.md)
