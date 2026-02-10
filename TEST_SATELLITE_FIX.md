# Test de la correction du problème satellite après PVGIS

## 🔍 Problème identifié

Le composant `SatelliteImage` conservait son état (`mapType`, `isEeaRestriction`, etc.) lors des re-renders causés par les mises à jour PVGIS. Quand PVGIS mettait à jour le prospect, le composant se re-rendait mais gardait son état précédent (par exemple `mapType = "roadmap"` si une erreur avait été détectée avant).

## ✅ Corrections apportées

### 1. Ajout d'une `key` sur SatelliteImage dans ProspectDrawer
- Force un remontage complet du composant quand le prospect change
- Clé basée sur : `prospect.id` (ou `address`) + coordonnées

### 2. Amélioration du useEffect dans SatelliteImage
- Détecte maintenant les changements de coordonnées **ET** d'adresse
- Réinitialise l'état (`mapType = "satellite"`) pour chaque nouveau prospect
- Logs détaillés pour le débogage

## 🧪 Comment tester

### Test 1 : Nouveau prospect
1. Ouvrir l'application
2. Cliquer sur un lieu sur la carte
3. **Vérifier** : Le composant SatelliteImage doit commencer en mode `satellite`
4. **Vérifier dans la console** : Log `[SatelliteImage] 🔄 Données changées, réinitialisation de l'état`

### Test 2 : Après PVGIS
1. Ouvrir un prospect (drawer s'ouvre)
2. Attendre que PVGIS charge les données
3. **Vérifier** : Le composant SatelliteImage doit rester en mode `satellite` (ou basculer en `roadmap` uniquement si vraiment une erreur EEA)
4. **Vérifier dans la console** : Pas de réinitialisation inutile si les coordonnées/adresse n'ont pas changé

### Test 3 : Changement de prospect
1. Ouvrir un prospect A
2. Fermer le drawer
3. Ouvrir un prospect B (différent)
4. **Vérifier** : Le composant SatelliteImage doit être réinitialisé et commencer en `satellite` pour le prospect B

### Test 4 : Même coordonnées, adresse différente
1. Ouvrir un prospect avec une adresse
2. Modifier l'adresse (même coordonnées)
3. **Vérifier** : Le composant doit être réinitialisé (car l'adresse a changé)

## 📊 Logs à surveiller

### Logs normaux (attendu)
```
[SatelliteImage] 🔄 Données changées, réinitialisation de l'état: { previous: null, current: {...}, reason: "Premier rendu" }
[SatelliteImage] Image chargée avec succès: { coordinates: {...}, zoom: 15, mapType: "satellite" }
```

### Logs si erreur EEA (attendu)
```
[SatelliteImage] Test direct de l'URL Static Maps: { status: 403, ... }
[SatelliteImage] ❌ Réponse HTTP d'erreur: { isEeaRestriction: true, ... }
[SatelliteImage] Restriction géographique EEA détectée: Passage en mode roadmap
[SatelliteImage] Image chargée avec succès: { mapType: "roadmap" }
```

### Logs à éviter (problème)
```
// Pas de réinitialisation quand on change de prospect
// mapType reste "roadmap" même pour un nouveau prospect qui devrait supporter satellite
```

## 🔧 Vérifications techniques

1. **La `key` sur SatelliteImage** : Doit changer quand le prospect change
2. **Le useEffect** : Doit se déclencher quand `coordinates` ou `address` change
3. **L'état initial** : `mapType` doit toujours être `"satellite"` au début
4. **Pas de boucles infinies** : Le useEffect ne doit pas causer de re-renders infinis

## 🐛 Si le problème persiste

1. Vérifier que la `key` change bien entre les prospects
2. Vérifier les logs dans la console pour voir si le useEffect se déclenche
3. Vérifier que les coordonnées/adresse changent bien entre les prospects
4. Vérifier s'il y a d'autres endroits où `onProspectUpdate` est appelé qui pourraient causer des re-renders

## 📝 Notes

- Le problème était que React réutilisait le composant entre les re-renders, donc l'état était conservé
- La solution avec `key` force React à démonter/remonter le composant, réinitialisant tous les états
- Le `useEffect` ajoute une couche de sécurité supplémentaire pour réinitialiser l'état même si la `key` ne change pas
