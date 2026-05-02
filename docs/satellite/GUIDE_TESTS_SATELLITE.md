# Guide des tests progressifs pour les images satellite

## 🎯 Système de tests automatiques

J'ai implémenté un système qui teste automatiquement différentes configurations **étape par étape** jusqu'à trouver celle qui fonctionne.

## 📋 Comment ça fonctionne

Le système teste automatiquement **5 étapes** dans l'ordre :

### Étape 0 : Configuration de base
- Aucune modification
- Test avec les paramètres par défaut

### Étape 1 : Retirer le paramètre `style` ⭐ (Solution la plus probable)
- Retire le paramètre `style=feature:all|element:labels|visibility:off`
- **Pourquoi** : C'est la seule différence majeure avec roadmap qui fonctionne

### Étape 2 : Retirer style + Arrondir coordonnées
- Retire le style
- Arrondit les coordonnées à 6 décimales
- **Pourquoi** : Trop de précision pourrait déclencher des restrictions

### Étape 3 : Retirer style + Arrondir + Réduire zoom
- Retire le style
- Arrondit les coordonnées
- Réduit le zoom de 2 niveaux (ex: 15 → 13)
- **Pourquoi** : Certains zooms pourraient être bloqués

### Étape 4 : Retirer style + Arrondir + Format explicite
- Retire le style
- Arrondit les coordonnées
- Ajoute `format=png` explicitement
- **Pourquoi** : Spécifier le format pourrait aider

## 🧪 Comment tester

### 1. Ouvrir un prospect
- Cliquez sur un lieu sur la carte
- Le drawer s'ouvre avec l'image satellite

### 2. Observer les logs dans la console
Vous verrez des logs comme :
```
[SatelliteImage] Erreur de chargement Google Maps Static API: { testStep: 0, ... }
[SatelliteImage] 🔄 Test étape 0 échoué, passage à l'étape 1: { removeStyle: true }
[SatelliteImage] ✅ Image satellite Google Maps chargée avec succès: { testStep: 1, solution: "Test étape 1 a réussi !" }
```

### 3. Indicateur visuel
- Si un test est en cours, vous verrez un badge bleu en haut à gauche : "Test étape X/4"
- Quand un test réussit, l'image se charge normalement

## 📊 Résultats attendus

### Scénario 1 : Étape 1 réussit ✅
```
Test étape 0 → Échec
Test étape 1 → ✅ SUCCÈS (retirer style)
→ Solution trouvée : Retirer le paramètre style
```

### Scénario 2 : Étape 2 réussit ✅
```
Test étape 0 → Échec
Test étape 1 → Échec
Test étape 2 → ✅ SUCCÈS (retirer style + arrondir)
→ Solution trouvée : Retirer style + arrondir coordonnées
```

### Scénario 3 : Tous les tests échouent ❌
```
Test étape 0 → Échec
Test étape 1 → Échec
Test étape 2 → Échec
Test étape 3 → Échec
Test étape 4 → Échec
→ Message d'erreur affiché
```

## 🔍 Logs à surveiller

### Logs de succès
```
[SatelliteImage] ✅ Image satellite Google Maps chargée avec succès: {
  testStep: 1,
  testOptions: { removeStyle: true },
  solution: "Test étape 1 a réussi !"
}
```

### Logs d'échec avec passage à l'étape suivante
```
[SatelliteImage] ❌ Erreur HTTP détaillée (Étape de test: 0): { ... }
[SatelliteImage] 🔄 Test étape 0 échoué, passage à l'étape 1: { removeStyle: true }
```

### Logs de l'API
```
[Static Maps API] TEST: Paramètre style retiré (test de diagnostic)
[Static Maps API] TEST: Coordonnées arrondies à 6 décimales: { avant: {...}, après: {...} }
```

## 🎯 Après avoir trouvé la solution

Une fois qu'une étape réussit, notez :
1. **Quelle étape a réussi** (ex: étape 1)
2. **Quelle configuration a fonctionné** (ex: `removeStyle: true`)
3. **Les logs dans la console**

Ensuite, je pourrai appliquer cette solution de manière permanente dans le code.

## 📝 Modifier les tests manuellement

Si vous voulez tester une configuration spécifique, modifiez `components/solar-scout/SatelliteImage.tsx` :

```typescript
const testSteps: SatelliteImageTestOptions[] = [
  {}, // Étape 0
  { removeStyle: true }, // Étape 1
  { removeStyle: true, roundCoordinates: 6 }, // Étape 2
  // Ajoutez vos propres tests ici
];
```

## ⚠️ Notes importantes

- Les tests se font **automatiquement** en cas d'erreur
- Chaque test attend que l'image charge ou échoue avant de passer au suivant
- Si tous les tests échouent, un message d'erreur est affiché
- Les logs détaillés sont dans la console du navigateur

## 🚀 Prochaines étapes

1. **Testez maintenant** : Ouvrez un prospect et observez les logs
2. **Notez quelle étape réussit** : Regardez dans la console
3. **Partagez les résultats** : Dites-moi quelle étape a fonctionné
4. **J'applique la solution** : Je modifierai le code pour utiliser la solution qui fonctionne
