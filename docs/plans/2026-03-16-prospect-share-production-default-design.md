## Comportement par défaut - carte Production (ProspectSharePage)

- **Contexte**: page de partage `ProspectSharePage`, bloc "Production" avec le composant `MonthlyProductionChart`, deux vues possibles "Mensuel" et "Journalier", plus un slider de mois pour la vue journalière.
- **Objectif**: quand un prospect ouvre le lien partagé, la carte doit être initialisée **en vue "Journalier"** et positionnée **sur le mois de juillet**.
- **Référence temporelle**: le mois de juillet est pris comme **mois 7** de l'année de référence des données du prospect (logique B) – il n'y a pas de champ d'année spécifique dans le modèle, donc seul l'index de mois est utilisé.

### État et data flow

- L'état d'affichage et du mois sélectionné est contrôlé dans `ProspectSharePage` :
  - `chartViewMode: "monthly" | "daily"` contrôle le mode (Mensuel / Journalier).
  - `chartSelectedMonthIndex: number` contrôle le mois sélectionné pour la vue journalière (0 = janvier, 6 = juillet).
- Ces états sont passés en **props contrôlées** à `MonthlyProductionChart` :
  - `viewMode={chartViewMode}`
  - `onViewModeChange={setChartViewMode}`
  - `selectedMonthIndex={chartSelectedMonthIndex}`
  - `onSelectedMonthIndexChange={setChartSelectedMonthIndex}`

### Règles de comportement souhaitées

1. **Initialisation**
   - À l'ouverture de `ProspectSharePage` (lien de partage), la vue doit être :
     - `chartViewMode = "daily"` (onglet "Journalier" activé).
     - `chartSelectedMonthIndex = 6` (mois "Jul" dans le slider et le graphique).
2. **Interaction**
   - L'utilisateur peut à tout moment :
     - Basculer entre "Mensuel" et "Journalier" via les boutons dans le header du bloc.
     - Modifier le mois en vue journalière via le slider (toujours index 0–11).
   - Ces interactions mettent simplement à jour les états contrôlés dans `ProspectSharePage`, sans logique métier supplémentaire.

### Implémentation

- Modification minimale dans `ProspectSharePage` :
  - Changer l'initialisation de l'état :
    - `const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("daily");`
    - `const [chartSelectedMonthIndex, setChartSelectedMonthIndex] = useState(6);`
- Aucun changement dans `MonthlyProductionChart` n'est nécessaire, le composant accepte déjà un `selectedMonthIndex` contrôlé et un `viewMode` contrôlé.

