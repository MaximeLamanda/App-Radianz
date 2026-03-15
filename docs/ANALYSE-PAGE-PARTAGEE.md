# Analyse : Pourquoi mes modifications ne s'affichent pas sur la page partagée ?

## 1. CONSTAT : Deux interfaces différentes

Il existe **deux endroits** où le contenu prospect s'affiche :

| Interface | Fichier | URL / Contexte |
|-----------|---------|----------------|
| **Page partagée** | `app/p/[shareToken]/page.tsx` | `/p/abc123` — lien public, ouvert en nouvel onglet |
| **ProspectDrawer** | `components/solar-scout/ProspectDrawer.tsx` | Clic sur un prospect dans Solar Scout — panneau latéral (drawer) |

Si vous testez en **cliquant sur un prospect sur la carte** → vous voyez le **ProspectDrawer**, pas la page partagée.

Pour voir la **page partagée**, il faut ouvrir le lien `/p/[token]` directement (ex. depuis "Copier le lien" ou en collant l'URL dans la barre d'adresse).

---

## 2. État Git : modifications non commitées

Vos modifications sont présentes dans le fichier **mais ne sont pas commitées** :

```
git status → modified: app/p/[shareToken]/page.tsx
```

**Conséquences :**
- En **développement local** (`npm run dev`) → vous devriez voir les modifications
- En **production** (Vercel, Netlify, etc.) → vous voyez l'ancienne version (dernier commit)

---

## 3. Causes possibles

### A. Vous regardez la production déployée
Si vous ouvrez un lien du type `https://votre-app.vercel.app/p/xxx`, c'est la version déployée (sans vos modifications).

**Solution :** commit + push pour redéployer.

### B. Vous regardez le ProspectDrawer au lieu de la page partagée
Clic sur un prospect = drawer latéral. Lien `/p/xxx` = page partagée.

**Solution :** copiez le lien de partage et ouvrez-le dans un nouvel onglet.

### C. Cache du navigateur ou de Next.js
- Cache navigateur : essayez Cmd+Shift+R (Mac) ou Ctrl+Shift+R (Windows)
- Cache Next.js : supprimez `.next` et relancez `npm run dev`

### D. Serveur de dev non relancé
Parfois le hot-reload ne prend pas tout. Relancez `npm run dev`.

---

## 4. Bug détecté : panneaux / onduleurs

Dans `app/p/[shareToken]/page.tsx` :

```tsx
const { data: panelsData } = usePanelReferences();   // ❌ manque ownerUserId
const { data: invertersData } = useInverterReferences();  // ❌ manque ownerUserId
```

Les hooks attendent `userId` (propriétaire du prospect). Sans cela, les refs du propriétaire ne sont pas chargées → fallback sur les valeurs par défaut.

**Correction recommandée :**

```tsx
const ownerUserId = prospect?.userId ?? null;
const { data: panelsData } = usePanelReferences(ownerUserId);
const { data: invertersData } = useInverterReferences(ownerUserId);
```

---

## 5. Actions recommandées

1. **Vérifier où vous testez** : lien `/p/xxx` vs clic sur prospect (drawer).
2. **Commit vos changements** pour les voir en production :
   ```bash
   git add app/p/[shareToken]/page.tsx
   git commit -m "fix: layout mobile page partagée"
   git push
   ```
3. **Corriger les hooks** `usePanelReferences` et `useInverterReferences` avec `ownerUserId`.
4. **Forcer le rafraîchissement** : Cmd+Shift+R ou suppression du cache `.next`.
