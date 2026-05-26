# Discovery — contacts décisionnaires manuels par POI / site

**Date :** 2026-05-26  
**Statut :** Validé

## Problème

Dans le drawer Discovery (section « POI à proximité »), l’enrichissement Apollo existe en code mais n’est pas toujours disponible (clé API, domaine introuvable). La colonne **Contacts** n’est accessible que si le POI a un site web ou un `placeId` Google (`canEnrich`). Les commerciaux ne peuvent pas saisir un décisionnaire connu manuellement, ni distinguer un contact d’un lieu précis d’un contact « site ».

## Objectifs

| Besoin | Comportement |
|--------|--------------|
| Contact lié à un POI | Champ `poiKey` = clé stable du POI dans le tableau discovery |
| Contact site (sans POI) | Pas de `poiKey` sur le contact |
| Saisie minimale | `fullName` obligatoire ; email, téléphone, LinkedIn, poste optionnels |
| Persistance | Firestore **uniquement** si le combo est déjà au pipeline (`prospectId`) |
| Entrée contact site | Bouton en en-tête section POI **+** liste centralisée sous le tableau |
| UI POI | Dialog unique, onglets **Mes contacts** / **Apollo** |
| Cycle de vie manuel | Création, **édition**, **suppression** |
| Apollo | Onglet séparé ; indisponible si pas de domaine / erreur API — n’empêche pas le manuel |

## Décisions produit (validées)

- Modèle **C** : contacts POI + contacts site.
- Champs obligatoires **A** : nom complet seul.
- Persistance **A** : pas de brouillon local pré-pipeline.
- Entrée site **C** : en-tête + liste centralisée.
- Dialog **A** : onglets Mes contacts / Apollo.
- Édition **B** : edit + delete pour contacts `source: "manual"`.

## Approche technique retenue

**Tableau plat enrichi** — conserver `prospect.contacts[]`, étendre `ProspectContact` plutôt qu’une structure imbriquée ou une sous-collection Firestore.

### Modèle `ProspectContact`

```ts
export interface ProspectContact {
  id?: string;              // UUID (manual) ou Apollo person_id
  poiKey?: string;          // absent = contact site
  firstName?: string;
  lastName?: string;
  fullName: string;
  title?: string;
  email?: string;
  emailStatus?: "verified" | "unverified" | "guessed";
  linkedinUrl?: string;
  phone?: string;
  source: "apollo" | "manual";
  fetchedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  organizationName?: string;
  organizationDomain?: string;
}
```

**Règles :**

- Création manuelle : `id = crypto.randomUUID()`, `source = "manual"`, `createdAt` / `updatedAt` = now.
- Persistance Apollo depuis un POI : chaque contact enregistré reçoit `poiKey: poi.key`.
- Contacts Apollo legacy sans `poiKey` : traités comme contacts site (pas de migration batch MVP).
- Déduplication : inchangée pour Apollo ; manuel par `id`, secours `poiKey + fullName + email` normalisés.

## UX

### Tableau POI

- Bouton **Contacts** visible sur **chaque** ligne (plus de tiret si `!canEnrich`).
- Ouvre le dialog ; onglet par défaut **Mes contacts**.
- Onglet **Apollo** : désactivé ou message explicite si domaine non résolvable.

### Dialog (`DiscoveryDrawerPoiContactsSheet`)

| Onglet | Contenu |
|--------|---------|
| **Mes contacts** | Liste filtrée (`poiKey` ou site), formulaire ajout, édition, suppression (confirm), **Enregistrer** → `mergeProspectContacts` + `updateProspect` |
| **Apollo** | Flux actuel ; enregistrement avec `poiKey` |

### Section POI — en-tête

- Bouton **« Ajouter un contact site »** à côté d’« Enrichir » → dialog `poi = null`, onglet Mes contacts uniquement.

### Liste centralisée

- Bloc **« Contacts du site »** sous le tableau : groupes **Site** puis **par POI** (nom du lieu).
- Lecture seule pour Apollo ; CRUD pour manuels.

### Hors pipeline

- Message et boutons désactivés inchangés ; consultation possible si données déjà en base.

## Flux

```
Clic Contacts (ligne POI ou en-tête site)
  → Dialog onglet Mes contacts
  → CRUD sur copie locale filtrée
  → Enregistrer (si prospectId) → merge + updateProspect → onContactsPersisted

Onglet Apollo (si domaine OK)
  → POST /api/apollo/people-search
  → Enregistrer avec poiKey
```

## Erreurs & validation

- Toast Sonner sur échec Firestore.
- Validation client : `fullName` non vide ; formats email / URL LinkedIn optionnels mais validés si renseignés.
- Suppression manuelle : `AlertDialog` de confirmation.

## Hors scope

- Brouillon contacts pré-pipeline en state React.
- Sous-collection Firestore dédiée.
- Migration batch des contacts Apollo existants.
- Page partagée prospect (`/p/[shareToken]`) — affichage contacts décisionnaires (sauf si déjà prévu ailleurs).

## Fichiers principaux impactés

- `types/index.ts` — `ProspectContact`
- `lib/apollo-people-search.ts` — merge, filtre, helpers manuels
- `components/discovery/DiscoveryDrawerPoiContactsSheet.tsx` — onglets, CRUD manuel
- `components/solar-scout/ProspectDrawer.tsx` — bouton site, liste centralisée, bouton Contacts toujours visible
- `lib/firestore-prospect.ts` — sérialisation dates si besoin

## Références

- UI Apollo actuelle : `components/discovery/DiscoveryDrawerPoiContactsSheet.tsx`
- Tableau POI : `components/solar-scout/ProspectDrawer.tsx` (`DiscoveryDrawerMergedPoiBlock`)
- Route Apollo : `app/api/apollo/people-search/route.ts`
