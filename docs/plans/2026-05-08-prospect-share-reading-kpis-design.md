# Design — KPIs de lecture de la page prospect partagée

## Contexte

Les commerciaux gèrent des prospects dans un **pipeline** (statuts Firestore : `cree`, `envoye`, `ouvert`, etc.). Une **page générée** `/p/[shareToken]` est consultable par le prospect. Aujourd’hui, `/api/prospect-share/register-view` sert surtout à passer le statut **`ouvert`** lors d’une première vue « utile » (IP visiteur ≠ IP créateur du lien, pas de statut terminal, etc.), sans historique ni métriques d’engagement.

## Objectif produit

Dans le **tiroir prospect** (`ProspectDrawer`), pour tout prospect **déjà enregistré** (document avec `id`), afficher :

1. Un **résumé agrégé** des lectures de la page partagée.
2. Un **tableau détaillé** (une ligne par **session** de consultation).

Tant qu’il n’y a pas de lien ou pas de données : **états vides** explicites (pas masquer le bloc).

**Rafraîchissement** : chargement à l’ouverture du tiroir + bouton **« Actualiser »** (pas de polling ni temps réel en v1).

## Décisions validées

| Sujet | Décision |
|--------|----------|
| Niveau de détail | Résumé **+** lignes par visite / session |
| Emplacement UI | **Uniquement** le tiroir prospect |
| Visibilité | Dès qu’il existe un **`id`** prospect ; vides si pas de `shareToken` ou pas de sessions |
| Stockage | **Sous-collection** Firestore sous le prospect + **champs agrégés** sur le document prospect |
| Passage pipeline `ouvert` | **Exclusivement** via la route existante **`register-view`** ; les routes **analytics** ne modifient **pas** `pipelineStatus` |

## Modèle de données (v1)

### Sous-collection

Chemin : `prospects/{prospectId}/shareSessions/{sessionId}`.

- `sessionId` : UUID généré côté client sur `/p/[shareToken]` au démarrage du suivi.
- Champs typiques : `startedAt` (timestamp serveur), `endedAt` (nullable jusqu’au beacon), `durationMs` (dérivé), `maxScrollDepth01` (nombre 0–1), `status` (`open` \| `closed`), métadonnées optionnelles **non sensibles** (ex. `deviceClass` dérivé d’un UA tronqué côté serveur).
- **Ne pas** exposer en UI : IP en clair ; éventuellement stocker un **hash** côté serveur pour corrélation / dédup futures (v1 minimal : optionnel si complexité jugée trop forte — trancher en impl.).

### Document prospect (agrégats)

Champs dérivés proposés pour le résumé du tiroir (noms indicatifs) :

- `shareSessionCount` (number)
- `shareLastSessionAt` (timestamp)
- Éventuellement en v1 minimal : seulement ces deux champs ; moyenne de durée ou scroll médian = **v2** si besoin.

### Pagination

V1 : charger les **20** dernières sessions (ordre `startedAt` desc). « Voir plus » = hors scope v1.

## Ingestion (page publique)

- **Début de session** : `POST` serveur (corps : `shareToken`, `sessionId`). Crée le document session avec les mêmes **règles d’éligibilité** que pour compter une vue utile (factoriser avec `register-view` : IP créateur, prospect introuvable, statut terminal, même IP que créateur, etc.). Si la session n’est pas éligible : réponse `ok` + `skipped` (comme `register-view`), **sans** créer de document.
- **Fin de session** : `POST` (corps : `shareToken`, `sessionId`, `durationMs`, `maxScrollDepth01`). Met à jour la session, recalcule ou incrémente les **agrégats** sur le prospect (transaction / batch admin).
- **Instrumentation client** : `visibilitychange` / `pagehide` pour envoyer la fin ; mesure du scroll max simple (listener scroll, ratio `scrollY` / scrollable height borné).
- **Parallèle** : l’appel existant **`registerProspectSharePageView(shareToken)`** reste invoqué comme aujourd’hui pour le pipeline **`ouvert`** ; les nouveaux appels analytics sont **complémentaires**.

## Lecture côté tiroir (auth)

- **GET** (ou équivalent) **authentifié** : liste des sessions + champs agrégés du prospect, réservé au **propriétaire** du document `prospects` (`userId` == UID du token), via **Admin SDK** après `verifyIdToken` (même famille que `record-creator-ip`).
- Ne pas compter sur une lecture client Firestore directe de la sous-collection sans ajuster `firestore.rules` ; **préférence** : tout passer par l’API pour rester cohérent avec les routes `prospect-share` existantes et éviter d’élargir par erreur l’accès public.

## UI (`ProspectDrawer`)

- Section **« Lectures de la page partagée »** (libellé final à harmoniser avec le produit).
- **Résumé** : au minimum nombre de sessions + dernière date.
- **Tableau** : colonnes v1 — début, durée, scroll max (%).
- **Bouton Actualiser** ; états de chargement / erreur discrets.
- **Vides** : message si pas de `shareToken` ; message si lien mais aucune session.

## Confidentialité

- Pas d’IP en clair dans l’UI ; UA traité côté serveur de façon minimale.
- Pas de contenu des champs saisis par le visiteur dans les documents session.

## Tests (v1)

- Tests unitaires sur la **fonction partagée** d’éligibilité (alignée sur `register-view`).
- Test ciblé sur la route **fin de session** (session fermée + agrégats cohérents), si faisable sans sur-mocker Firebase (sinon tests limités au module pur).

## Hors scope v1

- Polling / `onSnapshot` temps réel.
- Pagination « suivant » au-delà de 20 lignes.
- Fusion du flip `ouvert` dans les routes analytics.
