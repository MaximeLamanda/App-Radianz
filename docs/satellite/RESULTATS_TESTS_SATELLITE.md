# Résultats des tests - Images satellite Google Maps Static API

## 📊 Résumé des tests effectués

### Tests réalisés (tous échouent avec erreur 403 EEA)

| Étape | Configuration | Résultat | Erreur |
|-------|--------------|----------|--------|
| 0 | Configuration par défaut (avec style, coordonnées précises) | ❌ Échec | 403 EEA |
| 1 | Retirer le paramètre `style` | ❌ Échec | 403 EEA |
| 2 | Retirer style + arrondir coordonnées à 6 décimales | ❌ Échec | 403 EEA |
| 3 | Retirer style + arrondir coordonnées à 4 décimales | ❌ Échec | 403 EEA |
| 4 | Retirer style + arrondir à 4 décimales + zoom réduit de 2 | ❌ Échec | 403 EEA |
| 5 | Retirer style + arrondir à 4 décimales + zoom très faible | ❌ Échec | 403 EEA |
| 6 | Retirer style + arrondir à 6 décimales + format PNG | ❌ Échec | 403 EEA |

**Conclusion** : Aucune variation de paramètres ne fonctionne. Toutes les requêtes retournent la même erreur EEA.

## 🔍 Analyse

### Constats
1. ✅ **Roadmap fonctionne** → La clé API est valide
2. ❌ **Satellite échoue toujours** → Même avec toutes les variations de paramètres
3. 📍 **Coordonnées testées** : `48.530546, 2.042749` (Roinville, France)
4. 🗺️ **Zone géographique** : France (EEE)

### Message d'erreur constant
```
Your request cannot be served because satellite and hybrid imagery is not available for this location. 
Please see https://developers.google.com/maps/comms/eea/maps-static.
```

## 💡 Hypothèses restantes à tester

### Hypothèse 1 : Coordonnées légèrement décalées ⭐⭐⭐
**Idée** : Peut-être que les coordonnées exactes sont dans une zone restreinte, mais un léger décalage fonctionnerait.

**Test à faire** : Ajouter un petit offset aux coordonnées (ex: +0.001 degré ≈ 100m)

### Hypothèse 2 : Utiliser l'API avec un marker au lieu de center ⭐⭐
**Idée** : Au lieu d'utiliser `center`, utiliser un `marker` à la même position.

**Test à faire** : 
```typescript
params.append("markers", `color:red|${lat},${lng}`);
// Retirer le paramètre center
```

### Hypothèse 3 : Utiliser l'API avec un path au lieu de center ⭐
**Idée** : Utiliser un `path` avec un petit rectangle autour des coordonnées.

**Test à faire** :
```typescript
const offset = 0.001; // ~100m
params.append("path", `color:0x00000000|weight:0|fillcolor:0x00000000|${lat-offset},${lng-offset}|${lat+offset},${lng+offset}`);
```

### Hypothèse 4 : Vérifier si les coordonnées ont changé depuis PVGIS ⭐⭐⭐
**Idée** : PVGIS pourrait avoir modifié légèrement les coordonnées. Comparer les coordonnées avant/après PVGIS.

**Test à faire** : Logger les coordonnées exactes utilisées et comparer avec celles qui fonctionnaient avant.

### Hypothèse 5 : Utiliser une clé API différente ⭐
**Idée** : Peut-être que la clé API a des restrictions spécifiques qui ont changé.

**Test à faire** : Créer une nouvelle clé API dans Google Cloud Console et tester.

### Hypothèse 6 : Vérifier le format de l'URL (encodage) ⭐
**Idée** : L'encodage URL pourrait être différent.

**Test à faire** : Vérifier l'encodage exact de l'URL générée.

## 🎯 Solutions à implémenter en priorité

### Solution 1 : Tester avec un offset de coordonnées
Ajouter un petit décalage aux coordonnées pour voir si une zone adjacente fonctionne.

### Solution 2 : Utiliser marker au lieu de center
Changer la méthode de centrage de la carte.

### Solution 3 : Comparer les coordonnées avant/après PVGIS
Vérifier si PVGIS modifie les coordonnées d'une manière qui affecte l'API.

## 📝 Prochaines étapes

1. Implémenter le test avec offset de coordonnées
2. Implémenter le test avec marker
3. Comparer les coordonnées exactes utilisées avant/après PVGIS
4. Vérifier si d'autres zones géographiques fonctionnent
