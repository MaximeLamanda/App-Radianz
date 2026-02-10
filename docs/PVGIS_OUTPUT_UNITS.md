# Sorties PVGIS et unités

Référence des **unités** utilisées par l’API PVGIS (re.jrc.ec.europa.eu/api/v5_3/PVcalc) et dans l’application.

## Comportement utilisé dans l’app

L’API PVGIS est appelée avec **`peakpower: 1`** (référence 1 kWp). Les sorties **E_y** et **E_m** correspondent alors à la production **pour 1 kWp**. L’application multiplie ces valeurs par le **kWp** de l’installation (déduit de la surface de toit) pour obtenir la production totale affichée.

- **Production totale annuelle** = `E_y × kWp`
- **Production totale mensuelle** = `E_m × kWp`

## Paramètres envoyés à PVGIS

| Paramètre   | Unité | Description |
|------------|--------|-------------|
| `lat`      | degrés | Latitude |
| `lon`      | degrés | Longitude |
| `peakpower`| **kW** | Fixé à **1** dans l’app (référence 1 kWp) ; le scaling par kWp est fait côté client |
| `loss`     | **%**  | Pertes système (ex. 14) |
| `optimalangles` | 0/1 | Calcul des angles optimaux |
| `pvtechchoice`  | string | Ex. `crystSi` |

## Sorties PVGIS (champs bruts, pour peakpower=1)

### Totaux annuels (`outputs.totals.fixed`)

| Champ API  | Unité    | Description |
|------------|----------|-------------|
| `E_y`      | **kWh**  | Production annuelle **pour 1 kWp** (× kWp dans l’app = total) |
| `H(i)_y`   | **kWh/m²** | Irradiation annuelle sur le plan des panneaux (inchangée) |

### Données mensuelles (`outputs.monthly` ou `outputs.monthly.fixed`)

| Champ API  | Unité    | Description |
|------------|----------|-------------|
| `month`    | 1–12     | Mois |
| `E_m`      | **kWh**  | Production mensuelle **pour 1 kWp** (× kWp dans l’app = total) |
| `H(i)_m`   | **kWh/m²** | Irradiation mensuelle sur le plan des panneaux |

### Angles (`inputs.mounting_system.fixed` ou `outputs.optimal`)

| Champ   | Unité    | Description |
|---------|----------|-------------|
| `slope` | **degrés** | Inclinaison optimale |
| `azimuth` | **degrés** | Orientation (0 = sud, 90 = ouest, -90 = est) |

## Données formatées dans l’app (`PVGISData`)

Les unités sont conservées par rapport à l’API :

- `annualProduction` → **kWh**
- `annualIrradiation` → **kWh/m²**
- `monthlyProduction[].production` → **kWh** (par mois)
- `monthlyIrradiation[].irradiation` → **kWh/m²** (par mois)
- `optimalInclination` / `optimalAzimuth` → **degrés**
- `sunshineHoursEquivalent` → **h/an** (heures équivalentes à 1000 W/m² sur l’année, dérivées de l’irradiation annuelle en kWh/m²)

## Affichage dans l’interface

- **Production annuelle** : `X kWh/an`
- **Irradiation annuelle** : `X kWh/m²` (plan des panneaux)
- **Production mensuelle** : graphique en **kWh par mois**
- **Heures équivalentes** : `X h/an` (équivalent 1000 W/m²)
- **Surface disponible** : `X m²`
- **Angle / orientation** : en degrés (°)

Aucune conversion d’unité n’est faite entre PVGIS et l’affichage ; les libellés précisent l’unité quand c’est utile.
