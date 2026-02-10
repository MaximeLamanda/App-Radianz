# 🔧 Correction du problème de vue satellite

## Problème identifié

L'erreur retournée par Google Maps Static API :
```
Your request cannot be served because satellite and hybrid map types are not available for your account and region.
```

**C'est une restriction au niveau de votre clé API Google Cloud, pas un problème de code.**

## ✅ Solution : Vérifier la configuration de la clé API

### Étape 1 : Accéder à Google Cloud Console

1. Allez sur [Google Cloud Console](https://console.cloud.google.com/)
2. Sélectionnez votre projet
3. Allez dans **APIs & Services** → **Credentials**

### Étape 2 : Vérifier votre clé API

1. Trouvez votre clé API : `AIzaSyAStLFRcDeYY4eupHezPv0L4gp2JsefCx4`
2. Cliquez dessus pour ouvrir les paramètres

### Étape 3 : Vérifier les restrictions

#### A. Restrictions d'API
- **IMPORTANT** : Assurez-vous que **Maps Static API** est activée
- Vérifiez qu'il n'y a pas de restrictions qui bloquent l'accès aux images satellite

#### B. Restrictions d'application
- Si vous avez des restrictions HTTP, assurez-vous que votre domaine est autorisé
- Pour le développement local : `localhost:3000` doit être autorisé

#### C. Restrictions de clé API
- **Vérifiez s'il y a des restrictions géographiques** qui bloquent l'accès aux images satellite pour la région EEA

### Étape 4 : Activer l'API Maps Static

1. Allez dans **APIs & Services** → **Library**
2. Recherchez "Maps Static API"
3. Cliquez dessus et assurez-vous qu'elle est **ENABLED**

### Étape 5 : Vérifier les quotas et facturation

1. Allez dans **APIs & Services** → **Dashboard**
2. Vérifiez que votre projet a un compte de facturation actif (requis pour Maps Static API)
3. Vérifiez les quotas et limites

## 🔍 Test manuel

Pour tester si le problème vient de la clé API, testez cette URL dans votre navigateur :

```
https://maps.googleapis.com/maps/api/staticmap?center=48.5305,2.0427&zoom=15&size=400x300&maptype=satellite&key=VOTRE_CLE_API
```

Si vous obtenez toujours l'erreur EEA, c'est bien un problème de configuration de la clé API.

## ⚠️ Note importante

Si ça marchait avant PVGIS, il est possible que :
1. La clé API ait été modifiée ou restreinte
2. Google ait changé sa politique récemment
3. Les restrictions de la clé API aient été modifiées

## 📝 Actions à prendre

1. ✅ Vérifier que Maps Static API est activée
2. ✅ Vérifier les restrictions de la clé API
3. ✅ Vérifier que le compte de facturation est actif
4. ✅ Tester avec une nouvelle clé API si nécessaire
5. ✅ Contacter le support Google Cloud si le problème persiste
