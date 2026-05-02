# Pourquoi les images satellite ne fonctionnent pas ?

## 🔍 Diagnostic basé sur vos logs

D'après les logs de votre console, voici **pourquoi le satellite ne fonctionne pas** :

### ❌ Erreur détectée
```
GET .../staticmap?...maptype=satellite... 403 (Forbidden)
Message: "Your request cannot be served because satellite and hybrid imagery is not available for this location. Please see https://developers.google.com/maps/comms/eea/maps-static."
```

## 📊 Raisons par ordre de probabilité

### 1. 🥇 **RESTRICTION GÉOGRAPHIQUE EEA (95% de probabilité)** ✅ CONFIRMÉ

**C'est votre cas actuel !**

- **Cause** : Google Maps bloque les images satellite/hybrid pour certaines zones géographiques dans l'EEE (Espace Économique Européen)
- **Pourquoi** : Restrictions légales de Google pour des raisons de sécurité nationale ou de réglementation européenne
- **Zones concernées** : Certaines zones en France, notamment autour de Dourdan et Roinville (d'après vos logs)
- **Preuve** : Le message d'erreur mentionne explicitement `eea/maps-static` et `not available for this location`
- **Impact** : Les images `satellite` et `hybrid` sont bloquées, mais `roadmap` fonctionne

**Comment corriger :**
- ✅ **Solution automatique (déjà en place)** : L'application détecte cette erreur et bascule automatiquement en `roadmap`
- 🔄 **Alternative 1** : Utiliser une autre source d'images satellites (Mapbox, Bing Maps)
- 🔄 **Alternative 2** : Utiliser l'API JavaScript Maps au lieu de Static Maps (peut parfois contourner)
- ⚠️ **Limitation** : Cette restriction ne peut **pas** être contournée en modifiant la clé API

---

### 2. 🥈 **API Static Maps non activée (3% de probabilité)**

- **Cause** : L'API Static Maps n'est pas activée dans Google Cloud Console
- **Symptôme** : Erreur 403 avec message "This API key is not authorized"
- **Comment vérifier** :
  1. Allez sur https://console.cloud.google.com/
  2. APIs & Services → Library
  3. Recherchez "Maps Static API"
  4. Vérifiez qu'elle est activée
- **Comment corriger** : Activez l'API Static Maps dans Google Cloud Console

---

### 3. 🥉 **Restrictions de domaine HTTP (1% de probabilité)**

- **Cause** : Les restrictions HTTP de la clé API bloquent `localhost:3000`
- **Symptôme** : Erreur 403 avec message "RefererNotAllowedMapError"
- **Comment vérifier** :
  1. Google Cloud Console → APIs & Services → Credentials
  2. Cliquez sur votre clé API
  3. Vérifiez "Application restrictions"
- **Comment corriger** : Ajoutez `localhost:3000/*` aux restrictions HTTP

---

### 4. **Clé API invalide ou expirée (1% de probabilité)**

- **Cause** : La clé API est invalide, expirée, ou mal configurée
- **Symptôme** : Erreur 403 avec message "This API key is not valid"
- **Comment vérifier** : Testez l'URL directement dans le navigateur
- **Comment corriger** : Régénérez la clé API dans Google Cloud Console

---

## ✅ Solution actuelle (déjà implémentée)

Votre application **détecte automatiquement** la restriction EEA et bascule en mode `roadmap` :

```
[SatelliteImage] Restriction géographique EEA détectée: Passage en mode roadmap
[SatelliteImage] Image chargée avec succès: {mapType: 'roadmap'}
```

**C'est pourquoi vous voyez beaucoup de requêtes en `roadmap` dans vos logs** - le système fonctionne correctement !

---

## 🔧 Solutions pour avoir vraiment des images satellite

Si vous voulez absolument des images satellite pour ces zones, voici les alternatives :

### Option 1 : Utiliser Mapbox (recommandé)

Mapbox offre des images satellite avec moins de restrictions géographiques :

```typescript
// Exemple d'intégration Mapbox
const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/${width}x${height}?access_token=${MAPBOX_TOKEN}`;
```

**Avantages** :
- ✅ Moins de restrictions géographiques
- ✅ Images satellite de bonne qualité
- ✅ API gratuite jusqu'à 50k requêtes/mois

**Inconvénients** :
- ⚠️ Nécessite un compte Mapbox
- ⚠️ Format d'URL différent de Google Maps

---

### Option 2 : Utiliser Bing Maps

Bing Maps propose aussi des images satellite :

```typescript
const bingUrl = `https://dev.virtualearth.net/REST/v1/Imagery/Map/Aerial/${lat},${lng}/${zoom}?mapSize=${width},${height}&key=${BING_KEY}`;
```

**Avantages** :
- ✅ Alternative à Google Maps
- ✅ Images satellite disponibles

**Inconvénients** :
- ⚠️ Nécessite un compte Microsoft Azure
- ⚠️ Format d'URL différent

---

### Option 3 : Accepter la limitation (solution actuelle)

Pour les zones concernées par la restriction EEA :
- ✅ Utiliser `roadmap` (fonctionne toujours)
- ✅ L'application bascule automatiquement
- ✅ Pas de coût supplémentaire
- ✅ Pas de changement d'API nécessaire

---

## 📝 Résumé

**Pourquoi le satellite ne marche pas ?**
→ **Restriction géographique EEA** : Google bloque les images satellite pour certaines zones en Europe (confirmé par vos logs)

**Comment corriger ?**
1. ✅ **Solution actuelle** : Le fallback automatique vers `roadmap` fonctionne
2. 🔄 **Pour vraiment avoir du satellite** : Utiliser Mapbox ou Bing Maps à la place de Google Maps Static API
3. ⚠️ **Limitation** : Cette restriction ne peut pas être contournée avec Google Maps

**Votre application fonctionne correctement** - elle détecte la restriction et utilise `roadmap` automatiquement. C'est le comportement attendu pour les zones concernées par la restriction EEA.
