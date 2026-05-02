# Analyse du problème des images satellite

## 🔍 Constats

1. ✅ **Roadmap fonctionne** → La clé API est valide et les restrictions HTTP sont OK
2. ✅ **Ça fonctionnait avant** → Pas de problème géographique (pas de restriction EEA réelle)
3. ❌ **Satellite/Hybrid échouent** → Problème spécifique aux images satellite

## 🎯 Hypothèses sur les inputs qui ont changé

### Hypothèse 1 : Le paramètre `style` cause le problème

**Observation** : Le code ajoute un paramètre `style` uniquement pour `satellite` :
```typescript
if (mapType === "satellite") {
  params.append("style", "feature:all|element:labels|visibility:off");
}
```

**Problème potentiel** : 
- Ce paramètre `style` pourrait être interprété différemment par Google pour les zones EEA
- Google pourrait bloquer les requêtes satellite avec des styles personnalisés dans certaines zones

**Test à faire** : Retirer le paramètre `style` et voir si ça fonctionne

---

### Hypothèse 2 : Format des coordonnées (précision)

**Observation** : Les coordonnées sont passées directement :
```typescript
center: `${coordinates.lat},${coordinates.lng}`
```

**Problème potentiel** :
- Les coordonnées peuvent avoir trop de décimales (ex: `48.530545996965834`)
- Google pourrait avoir changé sa gestion de la précision pour les zones EEA
- Certaines précisions pourraient déclencher des restrictions

**Test à faire** : Arrondir les coordonnées à 6 décimales (précision standard GPS)

---

### Hypothèse 3 : Le paramètre `size` ou `zoom`

**Observation** : 
- Zoom utilisé : `15` (dans ProspectDrawer)
- Size : `400x300`

**Problème potentiel** :
- Certaines combinaisons zoom/size pourraient être bloquées pour satellite mais pas pour roadmap
- Le zoom 15 pourrait être trop élevé pour certaines zones

**Test à faire** : Essayer avec un zoom plus faible (ex: 13 ou 14)

---

### Hypothèse 4 : L'ordre des paramètres dans l'URL

**Observation** : Les paramètres sont ajoutés dans un certain ordre via `URLSearchParams`

**Problème potentiel** :
- L'ordre des paramètres pourrait affecter le traitement par Google
- Le paramètre `style` en dernier pourrait causer des problèmes

**Test à faire** : Réorganiser l'ordre des paramètres

---

### Hypothèse 5 : Le paramètre `maptype` en minuscules vs majuscules

**Observation** : Le code utilise `mapType` directement dans les params

**Problème potentiel** :
- Google pourrait être sensible à la casse pour certaines zones
- Roadmap fonctionne mais satellite non → différence de traitement

**Test à faire** : Vérifier la casse exacte requise par l'API

---

## 💡 Solutions à tester (par ordre de probabilité)

### Solution 1 : Retirer le paramètre `style` ⭐ (HAUTE PROBABILITÉ)

**Pourquoi** : Le paramètre `style` est ajouté uniquement pour satellite, pas pour roadmap. C'est la différence la plus évidente.

**Code à modifier** :
```typescript
// AVANT
if (mapType === "satellite") {
  params.append("style", "feature:all|element:labels|visibility:off");
}

// APRÈS (retirer complètement)
// Pas de style pour satellite
```

---

### Solution 2 : Arrondir les coordonnées à 6 décimales ⭐⭐

**Pourquoi** : Trop de précision pourrait déclencher des restrictions.

**Code à modifier** :
```typescript
// AVANT
center: `${coordinates.lat},${coordinates.lng}`

// APRÈS
center: `${coordinates.lat.toFixed(6)},${coordinates.lng.toFixed(6)}`
```

---

### Solution 3 : Réduire le zoom ⭐

**Pourquoi** : Zoom 15 pourrait être trop élevé pour certaines zones.

**Code à modifier** :
```typescript
// Dans ProspectDrawer.tsx, ligne 272
<SatelliteImage 
  zoom={13}  // Au lieu de 15
  ...
/>
```

---

### Solution 4 : Utiliser `format` explicite

**Pourquoi** : Spécifier le format pourrait aider.

**Code à ajouter** :
```typescript
params.append("format", "png"); // ou "jpg"
```

---

### Solution 5 : Retirer le paramètre `style` ET arrondir les coordonnées ⭐⭐⭐

**Pourquoi** : Combinaison des deux solutions les plus probables.

---

## 🧪 Plan de test recommandé

### Test 1 : Retirer le paramètre `style`
1. Modifier `lib/satellite-image.ts`
2. Retirer la ligne qui ajoute `style`
3. Tester avec un prospect

### Test 2 : Arrondir les coordonnées
1. Modifier `lib/satellite-image.ts`
2. Utiliser `toFixed(6)` pour lat et lng
3. Tester avec un prospect

### Test 3 : Combinaison des deux
1. Appliquer les deux modifications
2. Tester avec un prospect

### Test 4 : Réduire le zoom
1. Modifier `ProspectDrawer.tsx`
2. Changer `zoom={15}` en `zoom={13}`
3. Tester

---

## 📊 Comparaison roadmap vs satellite

| Paramètre | Roadmap (fonctionne) | Satellite (échoue) |
|-----------|---------------------|-------------------|
| `maptype` | `roadmap` | `satellite` |
| `style` | ❌ Pas de style | ✅ `feature:all\|element:labels\|visibility:off` |
| `center` | Même format | Même format |
| `zoom` | 15 | 15 |
| `size` | 400x300 | 400x300 |

**Différence principale** : Le paramètre `style` uniquement présent pour satellite !

---

## 🎯 Recommandation immédiate

**Tester en premier** : Retirer le paramètre `style` car c'est la seule différence majeure entre roadmap (qui fonctionne) et satellite (qui échoue).
