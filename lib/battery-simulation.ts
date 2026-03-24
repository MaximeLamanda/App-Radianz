/**
 * Simulation batterie sur 365 jours : 12 jours types (un par mois), SoC chaîné.
 *
 * Deux règles distinctes dans les calculs :
 *
 * 1) INJECTION BATTERIE (surplus solaire)
 *    Quand il y a du surplus PV, on injecte en priorité dans la batterie jusqu’à
 *    sa capacité max. Le surplus restant part en injection réseau.
 *    → injectionBatteryKwh = surplus PV stocké dans la batterie
 *    → injectionReseauKwh = surplus PV une fois batterie pleine
 *
 * 2) TIRAGE BATTERIE (besoin de consommation)
 *    Quand il y a du tirage (conso > PV), on utilise d’abord le stock de la batterie
 *    si elle a encore de l’énergie. Le besoin restant est tiré du réseau.
 *    → selfConsumptionViaBatteryKwh = tirage batterie (décharge pour la conso)
 *    → gridDrawKwh = tirage réseau (batterie vide)
 *
 * Ordre horaire appliqué : autoconsommation directe (PV → conso) puis tirage
 * batterie puis tirage réseau ; surplus PV → injection batterie puis injection réseau.
 *
 * Démarche unifiée : journalier (12 mois × jours × 24 h, 365 j) → consolidation
 * mensuelle (byMonth) → annuelle (totaux). Une seule fonction runProductionSimulation
 * avec batterie optionnelle (null = sans batterie).
 */

import type { BatteryReference } from "@/types";

/** Activer les logs détaillés (scaleBatteryForCount, runProductionSimulation). Désactivé par défaut. */
const DEBUG_AUTOCONSO = false;

/** SoC initial au 1er janvier (0–1). Plan : 50 %. */
const INITIAL_SOC_FRACTION = 0.5;

export interface BatterySimulationInput {
  /** 12 profils production (24h chacun), index = mois 0–11, valeurs en kWh/heure */
  productionTypicalDayByMonth: number[][];
  /** 12 profils consommation (24h chacun), index = mois 0–11, valeurs en kWh/heure */
  consumptionTypicalDayByMonth: number[][];
  battery: BatteryReference;
  /** SoC initial (0–1). Si non fourni, utilise INITIAL_SOC_FRACTION. */
  initialSocFraction?: number;
}

/** Entrée pour la simulation unifiée (avec ou sans batterie). */
export interface ProductionSimulationInput {
  productionTypicalDayByMonth: number[][];
  consumptionTypicalDayByMonth: number[][];
  /** Si null/undefined : même boucle horaire, sans batterie (surplus → réseau, conso restante → réseau). */
  battery?: BatteryReference | null;
  initialSocFraction?: number;
}

export interface BatterySimulationResult {
  /** kWh autoconsommés directement (PV → conso sans passer par la batterie) */
  selfConsumptionDirectKwh: number;
  /** kWh autoconsommés via la batterie = tirage batterie (décharge pour la conso) */
  selfConsumptionViaBatteryKwh: number;
  /** kWh injectés dans la batterie (surplus PV utilisé pour charger, jusqu’à capa max) */
  injectionBatteryKwh: number;
  /** kWh injectés sur le réseau (surplus PV une fois batterie pleine) */
  injectionReseauKwh: number;
  /** kWh tirés du réseau (conso non couverte par PV ni batterie) */
  gridDrawKwh: number;
  /** @deprecated Utiliser injectionReseauKwh */
  excessKwh: number;
  /** Optionnel : totaux par mois (12 éléments) */
  byMonth?: {
    selfConsumptionDirectKwh: number;
    selfConsumptionViaBatteryKwh: number;
    injectionBatteryKwh: number;
    injectionReseauKwh: number;
    gridDrawKwh: number;
    excessKwh: number;
  }[];
}

const DAYS_CAP = 365;
const daysInMonth = (m: number) => new Date(2000, m + 1, 0).getDate();

/**
 * Retourne une batterie virtuelle équivalente à N unités identiques.
 * Utilisée pour la simulation : capacité, puissance charge/décharge × count.
 * Le coût reste géré séparément dans estimateInstallationPriceEur.
 */
export function scaleBatteryForCount(
  ref: BatteryReference | null | undefined,
  count: number
): BatteryReference | null {
  if (!ref || count < 1) return null;
  if (count === 1) {
    if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
      console.log("[Autoconsommation] scaleBatteryForCount: 1×", ref.name, "→", ref.capacityKwh, "kWh");
    }
    return ref;
  }
  const scaled = {
    ...ref,
    capacityKwh: ref.capacityKwh * count,
    powerChargeKw: ref.powerChargeKw * count,
    powerDischargeKw: ref.powerDischargeKw * count,
    costEur: ref.costEur * count,
  };
  if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
    console.log("[Autoconsommation] scaleBatteryForCount:", count, "×", ref.name, "→", scaled.capacityKwh, "kWh (charge:", scaled.powerChargeKw, "kW, décharge:", scaled.powerDischargeKw, "kW)");
  }
  return scaled;
}

/**
 * Une seule simulation : journalier (365 j × 24 h) → consolidation mensuelle et annuelle.
 * Avec ou sans batterie : même boucle ; si battery == null, pas de SoC (surplus → réseau, conso restante → réseau).
 */
export function runProductionSimulation(input: ProductionSimulationInput): BatterySimulationResult {
  const {
    productionTypicalDayByMonth,
    consumptionTypicalDayByMonth,
    battery = null,
    initialSocFraction = INITIAL_SOC_FRACTION,
  } = input;

  const capacityKwh = battery ? battery.capacityKwh : 0;
  const powerChargeKw = battery ? battery.powerChargeKw : 0;
  const powerDischargeKw = battery ? battery.powerDischargeKw : 0;
  const eta = battery ? (battery.roundTripEfficiencyPercent ?? 90) / 100 : 1;
  const etaCharge = Math.sqrt(eta);
  const etaDischarge = Math.sqrt(eta);

  let socKwh = battery ? Math.max(0, Math.min(capacityKwh, capacityKwh * initialSocFraction)) : 0;

  if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
    if (battery) {
      console.log("[Autoconsommation] runProductionSimulation ENTRÉE — batterie:", battery.name, "| capacité:", capacityKwh, "kWh | charge:", powerChargeKw, "kW | décharge:", powerDischargeKw, "kW | SoC initial:", socKwh.toFixed(2), "kWh");
    } else {
      console.log("[Autoconsommation] runProductionSimulation ENTRÉE — sans batterie");
    }
  }

  let selfConsumptionDirectKwh = 0;
  let selfConsumptionViaBatteryKwh = 0;
  let injectionBatteryKwh = 0;
  let injectionReseauKwh = 0;
  let gridDrawKwh = 0;

  const byMonth: BatterySimulationResult["byMonth"] = Array.from({ length: 12 }, () => ({
    selfConsumptionDirectKwh: 0,
    selfConsumptionViaBatteryKwh: 0,
    injectionBatteryKwh: 0,
    injectionReseauKwh: 0,
    gridDrawKwh: 0,
    excessKwh: 0,
  }));

  let dayOfYear = 0;
  for (let month = 0; month < 12; month++) {
    const prodDay = productionTypicalDayByMonth[month] ?? Array(24).fill(0);
    const consDay = consumptionTypicalDayByMonth[month] ?? Array(24).fill(0);
    const days = daysInMonth(month);

    for (let d = 0; d < days && dayOfYear < DAYS_CAP; d++) {
      for (let h = 0; h < 24; h++) {
        const prod = prodDay[h] ?? 0;
        const cons = consDay[h] ?? 0;

        let remainingConsumption = cons;
        let remainingProduction = prod;

        const direct = Math.min(remainingProduction, remainingConsumption);
        selfConsumptionDirectKwh += direct;
        byMonth[month]!.selfConsumptionDirectKwh += direct;
        remainingProduction -= direct;
        remainingConsumption -= direct;

        if (battery) {
          if (remainingConsumption > 0 && socKwh > 0) {
            const maxDischargeFromBattery = Math.min(powerDischargeKw * 1, socKwh);
            const maxUsableByLoad = maxDischargeFromBattery * etaDischarge;
            const toServe = Math.min(maxUsableByLoad, remainingConsumption);
            const fromBattery = toServe;
            const drawnFromBattery = toServe / etaDischarge;
            selfConsumptionViaBatteryKwh += fromBattery;
            byMonth[month]!.selfConsumptionViaBatteryKwh += fromBattery;
            socKwh -= drawnFromBattery;
            remainingConsumption -= fromBattery;
          }
          if (remainingConsumption > 0) {
            gridDrawKwh += remainingConsumption;
            byMonth[month]!.gridDrawKwh += remainingConsumption;
          }
          if (remainingProduction > 0 && socKwh < capacityKwh) {
            const spaceKwh = capacityKwh - socKwh;
            const maxInputKwh = Math.min(powerChargeKw * 1, remainingProduction);
            const stored = Math.min(spaceKwh, maxInputKwh * etaCharge);
            const pvUsedForCharge = stored / etaCharge;
            socKwh += stored;
            remainingProduction -= pvUsedForCharge;
            injectionBatteryKwh += pvUsedForCharge;
            byMonth[month]!.injectionBatteryKwh += pvUsedForCharge;
          }
        } else {
          if (remainingProduction > 0) {
            injectionReseauKwh += remainingProduction;
            byMonth[month]!.injectionReseauKwh += remainingProduction;
            byMonth[month]!.excessKwh += remainingProduction;
          }
          if (remainingConsumption > 0) {
            gridDrawKwh += remainingConsumption;
            byMonth[month]!.gridDrawKwh += remainingConsumption;
          }
        }

        if (battery && remainingProduction > 0) {
          injectionReseauKwh += remainingProduction;
          byMonth[month]!.injectionReseauKwh += remainingProduction;
          byMonth[month]!.excessKwh += remainingProduction;
        }
      }
      dayOfYear++;
    }
  }

  const result = {
    selfConsumptionDirectKwh: Math.round(selfConsumptionDirectKwh * 100) / 100,
    selfConsumptionViaBatteryKwh: Math.round(selfConsumptionViaBatteryKwh * 100) / 100,
    injectionBatteryKwh: Math.round(injectionBatteryKwh * 100) / 100,
    injectionReseauKwh: Math.round(injectionReseauKwh * 100) / 100,
    gridDrawKwh: Math.round(gridDrawKwh * 100) / 100,
    excessKwh: Math.round(injectionReseauKwh * 100) / 100,
    byMonth,
  };

  if (process.env.NODE_ENV === "development") {
    const totalProdKwh = productionTypicalDayByMonth.reduce(
      (sum, prodDay, m) => sum + (prodDay?.reduce((a, b) => a + b, 0) ?? 0) * daysInMonth(m),
      0
    );
    const totalConsommationKwh = consumptionTypicalDayByMonth.reduce(
      (sum, consDay, m) => sum + (consDay?.reduce((a, b) => a + b, 0) ?? 0) * daysInMonth(m),
      0
    );
    const totalAuto = result.selfConsumptionDirectKwh + result.selfConsumptionViaBatteryKwh;
    const tauxAuto = totalProdKwh > 0 ? Math.round((totalAuto / totalProdKwh) * 100) : 0;
    console.log("[Autoconsommation] runProductionSimulation SORTIE —", {
      direct: result.selfConsumptionDirectKwh,
      viaBatterie: result.selfConsumptionViaBatteryKwh,
      totalAutoconsommation: totalAuto,
      injectionBatterie: result.injectionBatteryKwh,
      injectionReseau: result.injectionReseauKwh,
      tirageReseau: result.gridDrawKwh,
      productionAnnuelle: Math.round(totalProdKwh),
      consommationAnnuelle: Math.round(totalConsommationKwh),
      tauxAutoconsommation: tauxAuto + "%",
    });
  }

  return result;
}

/** Délègue à runProductionSimulation (compatibilité). */
export function runBatterySimulation(input: BatterySimulationInput): BatterySimulationResult {
  return runProductionSimulation({
    productionTypicalDayByMonth: input.productionTypicalDayByMonth,
    consumptionTypicalDayByMonth: input.consumptionTypicalDayByMonth,
    battery: input.battery,
    initialSocFraction: input.initialSocFraction,
  });
}

/** Simulation sans batterie : délègue à runProductionSimulation avec battery: null. */
export function computeSelfConsumptionWithoutBattery(input: {
  productionTypicalDayByMonth: number[][];
  consumptionTypicalDayByMonth: number[][];
}) {
  const result = runProductionSimulation({
    ...input,
    battery: null,
  });
  return {
    selfConsumptionDirectKwh: result.selfConsumptionDirectKwh,
    injectionReseauKwh: result.injectionReseauKwh,
    gridDrawKwh: result.gridDrawKwh,
    byMonth: result.byMonth?.map((m) => ({
      selfConsumptionDirectKwh: m.selfConsumptionDirectKwh,
      injectionReseauKwh: m.injectionReseauKwh,
      gridDrawKwh: m.gridDrawKwh,
    })),
  };
}

/** Résultat horaire pour une heure (jour type). */
export interface BatterySimulationHourlyResult {
  selfConsumptionDirectKwh: number;
  selfConsumptionViaBatteryKwh: number;
  injectionBatteryKwh: number;
  injectionReseauKwh: number;
  gridDrawKwh: number;
}

/**
 * Point d'entrée unique pour la vue journalière : avec ou sans batterie, même format de sortie horaire.
 */
export function runSimulationOneDayForChart(
  prodDay: number[],
  consDay: number[],
  battery?: BatteryReference | null
): BatterySimulationHourlyResult[] {
  if (battery) return runBatterySimulationOneDayWithCarryOver(prodDay, consDay, battery);
  return computeOneDayWithoutBattery(prodDay, consDay);
}

/**
 * Simule un seul jour type (24h) SANS batterie : même logique horaire (PV → conso directe, surplus → réseau, conso restante → réseau).
 * Retourne le même format que runBatterySimulationOneDay pour alimenter la vue journalière (selfConsumptionViaBattery et injectionBattery à 0).
 */
export function computeOneDayWithoutBattery(
  prodDay: number[],
  consDay: number[]
): BatterySimulationHourlyResult[] {
  return Array.from({ length: 24 }, (_, h) => {
    const prod = prodDay[h] ?? 0;
    const cons = consDay[h] ?? 0;
    const direct = Math.min(prod, cons);
    const injectionReseauKwh = Math.max(0, prod - direct);
    const gridDrawKwh = Math.max(0, cons - direct);
    return {
      selfConsumptionDirectKwh: Math.round(direct * 1000) / 1000,
      selfConsumptionViaBatteryKwh: 0,
      injectionBatteryKwh: 0,
      injectionReseauKwh: Math.round(injectionReseauKwh * 1000) / 1000,
      gridDrawKwh: Math.round(gridDrawKwh * 1000) / 1000,
    };
  });
}

/**
 * Simule un seul jour type (24h) avec batterie et retourne le détail par heure.
 * Utilisé pour la vue journalière du graphique (injection batterie, tirage batterie, etc.).
 */
export function runBatterySimulationOneDay(
  prodDay: number[],
  consDay: number[],
  battery: BatteryReference,
  initialSocFraction: number = INITIAL_SOC_FRACTION
): BatterySimulationHourlyResult[] {
  const capacityKwh = battery.capacityKwh;
  const powerChargeKw = battery.powerChargeKw;
  const powerDischargeKw = battery.powerDischargeKw;
  const eta = (battery.roundTripEfficiencyPercent ?? 90) / 100;
  const etaCharge = Math.sqrt(eta);
  const etaDischarge = Math.sqrt(eta);

  let socKwh = Math.max(0, Math.min(capacityKwh, capacityKwh * initialSocFraction));
  const result: BatterySimulationHourlyResult[] = [];

  for (let h = 0; h < 24; h++) {
    const prod = prodDay[h] ?? 0;
    const cons = consDay[h] ?? 0;

    let remainingConsumption = cons;
    let remainingProduction = prod;

    const direct = Math.min(remainingProduction, remainingConsumption);
    remainingProduction -= direct;
    remainingConsumption -= direct;

    // Règle 2 : tirage — priorité batterie si elle a du stock, sinon réseau
    let selfConsumptionViaBatteryKwh = 0;
    if (remainingConsumption > 0 && socKwh > 0) {
      const maxDischargeFromBattery = Math.min(powerDischargeKw * 1, socKwh);
      const maxUsableByLoad = maxDischargeFromBattery * etaDischarge;
      const toServe = Math.min(maxUsableByLoad, remainingConsumption);
      selfConsumptionViaBatteryKwh = toServe;
      const drawnFromBattery = toServe / etaDischarge;
      socKwh -= drawnFromBattery;
      remainingConsumption -= toServe;
    }

    const gridDrawKwh = remainingConsumption;

    // Règle 1 : injection — priorité batterie jusqu'à capa max, puis réseau
    let injectionBatteryKwh = 0;
    if (remainingProduction > 0 && socKwh < capacityKwh) {
      const spaceKwh = capacityKwh - socKwh;
      const maxInputKwh = Math.min(powerChargeKw * 1, remainingProduction);
      const stored = Math.min(spaceKwh, maxInputKwh * etaCharge);
      const pvUsedForCharge = stored / etaCharge;
      socKwh += stored;
      remainingProduction -= pvUsedForCharge;
      injectionBatteryKwh = pvUsedForCharge;
    }

    const injectionReseauKwh = remainingProduction;

    result.push({
      selfConsumptionDirectKwh: Math.round(direct * 1000) / 1000,
      selfConsumptionViaBatteryKwh: Math.round(selfConsumptionViaBatteryKwh * 1000) / 1000,
      injectionBatteryKwh: Math.round(injectionBatteryKwh * 1000) / 1000,
      injectionReseauKwh: Math.round(injectionReseauKwh * 1000) / 1000,
      gridDrawKwh: Math.round(gridDrawKwh * 1000) / 1000,
    });
  }

  return result;
}

/**
 * Simule deux jours type consécutifs et retourne le détail horaire du second jour.
 * Ainsi 00h du jour affiché démarre avec le SoC restant à 23h de la « veille » (report).
 * Utilisé pour la vue journalière pour que le report batterie soit visible.
 */
export function runBatterySimulationOneDayWithCarryOver(
  prodDay: number[],
  consDay: number[],
  battery: BatteryReference
): BatterySimulationHourlyResult[] {
  const capacityKwh = battery.capacityKwh;
  const powerChargeKw = battery.powerChargeKw;
  const powerDischargeKw = battery.powerDischargeKw;
  const eta = (battery.roundTripEfficiencyPercent ?? 90) / 100;
  const etaCharge = Math.sqrt(eta);
  const etaDischarge = Math.sqrt(eta);

  let socKwh = 0;
  const resultDay2: BatterySimulationHourlyResult[] = [];

  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    for (let h = 0; h < 24; h++) {
      const prod = prodDay[h] ?? 0;
      const cons = consDay[h] ?? 0;

      let remainingConsumption = cons;
      let remainingProduction = prod;

      const direct = Math.min(remainingProduction, remainingConsumption);
      remainingProduction -= direct;
      remainingConsumption -= direct;

      let selfConsumptionViaBatteryKwh = 0;
      if (remainingConsumption > 0 && socKwh > 0) {
        const maxDischargeFromBattery = Math.min(powerDischargeKw * 1, socKwh);
        const maxUsableByLoad = maxDischargeFromBattery * etaDischarge;
        const toServe = Math.min(maxUsableByLoad, remainingConsumption);
        selfConsumptionViaBatteryKwh = toServe;
        const drawnFromBattery = toServe / etaDischarge;
        socKwh -= drawnFromBattery;
        remainingConsumption -= toServe;
      }

      const gridDrawKwh = remainingConsumption;

      let injectionBatteryKwh = 0;
      if (remainingProduction > 0 && socKwh < capacityKwh) {
        const spaceKwh = capacityKwh - socKwh;
        const maxInputKwh = Math.min(powerChargeKw * 1, remainingProduction);
        const stored = Math.min(spaceKwh, maxInputKwh * etaCharge);
        const pvUsedForCharge = stored / etaCharge;
        socKwh += stored;
        remainingProduction -= pvUsedForCharge;
        injectionBatteryKwh = pvUsedForCharge;
      }

      const injectionReseauKwh = remainingProduction;

      const hourResult = {
        selfConsumptionDirectKwh: Math.round(direct * 1000) / 1000,
        selfConsumptionViaBatteryKwh: Math.round(selfConsumptionViaBatteryKwh * 1000) / 1000,
        injectionBatteryKwh: Math.round(injectionBatteryKwh * 1000) / 1000,
        injectionReseauKwh: Math.round(injectionReseauKwh * 1000) / 1000,
        gridDrawKwh: Math.round(gridDrawKwh * 1000) / 1000,
      };
      if (dayOffset === 1) resultDay2.push(hourResult);
    }
  }

  return resultDay2;
}
