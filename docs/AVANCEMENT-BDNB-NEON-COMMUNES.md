# Avancement — enrichissement BDNB (bâtiments) dans Neon

Ce document sert à **piloter et suivre** le chargement des bâtiments BDNB (Gironde / département 33) dans PostgreSQL (Neon), table `public.bdnb_2025_07a_33`, utilisée notamment par l’API `/api/bdnb-neon`.

---

## Objectif

Importer progressivement les **groupes de bâtiments** issus du millésime BDNB départemental (CSV), filtrés par **code commune INSEE**, sans saturer le stockage Neon ni multiplier les imports inutiles.

**Référence département 33 (CSV local)** : ~**534** communes distinctes dans `bdnb/dep33_extract/batiment_groupe.csv`.

---

## État actuel (à actualiser après chaque import)

| Indicateur | Valeur |
|------------|--------|
| **Dernière mise à jour** | 2026-03-27 |
| **Communes couvertes** | **534** / ~534 (**Gironde complète**) |
| **Lignes bâtiments** | **867 085** (aligné sur le CSV `batiment_groupe`) |
| **Géométries nulles** | 0 (vérifier avec la requête ci-dessous) |

**Reste** : **0** commune dans le 33 pour ce millésime (toutes les communes du CSV sont chargées).

Pour rafraîchir les chiffres :

```sql
SELECT
  COUNT(*)::bigint AS batiments,
  COUNT(DISTINCT code_commune_insee)::bigint AS communes,
  COUNT(*) FILTER (WHERE geom_groupe IS NULL)::bigint AS sans_geom
FROM public.bdnb_2025_07a_33;
```

---

## Fichiers utiles dans le dépôt

| Fichier | Rôle |
|---------|------|
| `bdnb/dep33_extract/*.csv` | Données BDNB Gironde extraites du zip officiel |
| `tmp_dep33_csv_metadata.yml` | Lien S3 vers le zip / métadonnées millésime |
| `bdnb/dep33_communes_insee.txt` | Liste des ~534 codes INSEE présents dans le CSV (générée) |
| `bdnb/dep33_communes_missing.txt` | Codes encore absents de Neon (à régénérer après import) |
| `bdnb/batch20_communes.txt` | Lot de **20** communes (éditable) |
| `bdnb/batch50_communes.txt` | Lot de **50** communes — sélection « proches Bordeaux » |
| `bdnb/batch100_communes.txt` | Lot de **100** communes — sélection « proches Bordeaux » |
| `bdnb/batch200_communes.txt` | Dernier lot régénéré (**115** communes) — fin de couverture 33 |

---

## Commandes d’import

Prérequis : `Radianz_DATABASE_URL` dans `.env.local` (ou variable d’environnement ; voir `lib/server-database-url.ts`).

**Ajouter des communes sans recréer la table** (recommandé) :

```bash
node scripts/import-bdnb-dep33-neon.mjs --communes-file=bdnb/batch200_communes.txt --append
# autres lots : batch20, batch50, batch100, etc.
```

**Autres modes** (voir aussi l’en-tête de `scripts/import-bdnb-dep33-neon.mjs`) :

- `--commune=33075` — une commune
- `--communes=33063,33281,33318` — liste sur la ligne de commande
- `--all` — **tout** le département 33 (très volumineux ; vérifier quota Neon avant)

---

## Stratégie de sélection des communes

1. **Bordeaux Métropole** : les 28 communes de l’EPCI `243300316` sont en général **prioritaires** ; une fois couvertes, élargir la **couronne** autour du centre de Bordeaux.
2. **Lots de 20 à 200** : adapter la taille au besoin (import et suivi).
3. **Proximité** : choisir les communes **encore absentes** de Neon les plus **proches du centre de Bordeaux** (coordonnées des centres via [geo.api.gouv.fr](https://geo.api.gouv.fr)), puis mettre à jour un fichier `bdnb/batch*_communes.txt` (une ligne = un code INSEE, commentaires `#` autorisés en fin de ligne).

---

## Journal des lots (à compléter)

| Date | Lot | Communes (nombre) | Commentaire |
|------|-----|-------------------|-------------|
| 2026-03-27 | Initial + alentours | 29 | Zone urbaine / premières communes |
| 2026-03-27 | +20 codes bas INSEE | +20 | Premières lignes de `dep33_communes_missing.txt` |
| 2026-03-27 | +20 proches Bordeaux | +20 | Tresses, Yvrac, Latresne, Léognan, etc. |
| 2026-03-27 | +50 proches Bordeaux | +50 | `batch50_communes.txt` — Cubzac, Loupes, Martillac, Cestas, Créon, etc. |
| 2026-03-27 | +100 proches Bordeaux | +100 | `batch100_communes.txt` |
| 2026-03-27 | +200 proches Bordeaux | +200 | `batch200_communes.txt` |
| 2026-03-27 | +115 (fin 33) | +115 | Dernières communes manquantes — **département 33 entier** |

---

## Prochaines étapes (checklist)

Pour **un autre département** ou un **nouveau millésime BDNB** : nouvel extrait CSV, adapter le script / table cible, puis imports.

- [x] Gironde (33) — couverture complète pour le millésime importé.

---

## Limites et risques

- **Stockage Neon** : un import `--all` charge l’ensemble du département ; prévoir la taille disponible.
- **Durée** : les imports lisent les gros CSV en streaming ; un lot de 20 communes reste en général rapide, un import complet beaucoup plus long.
- **Doublons** : le mode `--append` utilise `ON CONFLICT (batiment_groupe_id) DO NOTHING` — relancer le même lot ne duplique pas les lignes.

---

## Références

- Script : `scripts/import-bdnb-dep33-neon.mjs`
- Route applicative : `app/api/bdnb-neon/route.ts`
