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

**b) Restrictions d'application :**
- Si vous avez des restrictions HTTP, ajoutez :
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
- Ou temporairement, supprimez les restrictions pour tester

**c) Restrictions d'API :**
- Assurez-vous que "Maps JavaScript API" est dans la liste des APIs autorisées
- Ou supprimez temporairement les restrictions pour tester

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
