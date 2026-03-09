# Quotas et statuts de profil

## Vue d'ensemble

Les APIs BDNB et OSM sont limitées par statut utilisateur pour maîtriser les coûts. Google Maps reste côté client, limité globalement via les quotas Google Cloud.

## Statuts

| Statut  | BDNB          | OSM           |
|---------|---------------|---------------|
| Admin   | Illimité      | Illimité      |
| Premium | 5000 / mois   | 2000 / mois   |
| Starter | 500 / mois    | 200 / mois    |
| Demo    | 10 / jour     | 5 / jour      |

## Attribuer le statut Admin

Le statut est stocké dans Firestore : `users/{uid}.status`.

### Option 1 : Console Firebase

1. Ouvrez [Firebase Console](https://console.firebase.google.com/) → Firestore
2. Collection `users` → document avec l'UID de l'utilisateur
3. Ajoutez ou modifiez le champ `status` : `"admin"`

### Option 2 : Script

```bash
# Avec Firebase CLI (firebase-tools)
npx tsx scripts/set-user-status.ts <uid> admin
```

Exemple de script `scripts/set-user-status.ts` :

```typescript
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const uid = process.argv[2];
const status = process.argv[3]; // "admin" | "premium" | "starter" | "demo"

if (!uid || !status) {
  console.error("Usage: npx tsx scripts/set-user-status.ts <uid> <status>");
  process.exit(1);
}

initializeApp({ projectId: "solarview-8aec9" });
const db = getFirestore();
await db.collection("users").doc(uid).set({ status }, { merge: true });
console.log(`Statut ${status} attribué à ${uid}`);
```

### Option 3 : Variable d'environnement (à implémenter)

Une liste d'emails admin peut être configurée via `ADMIN_EMAILS` pour attribution automatique à la première connexion.

## Configuration Firebase Admin (serveur)

Pour que les quotas fonctionnent, les routes API doivent vérifier les tokens Firebase. Configurez :

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxx@solarview-8aec9.iam.gserviceaccount.com"
FIREBASE_PROJECT_ID="solarview-8aec9"
```

Ces valeurs sont disponibles dans Firebase Console → Paramètres du projet → Comptes de service → Générer une nouvelle clé privée.

## Comportement utilisateur non connecté

- Les routes `/api/bdnb` et `/api/osm-buildings` retournent **401** si l'en-tête `Authorization: Bearer <idToken>` est absent ou invalide.
- L'utilisateur doit se connecter pour utiliser BDNB et OSM.
