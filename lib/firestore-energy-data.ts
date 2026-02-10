/**
 * Fonctions pour gérer les données de consommation énergétique dans Firebase
 * 
 * Cette collection peut être utilisée comme référence backend pour calculer
 * le potentiel énergétique solaire basé sur le type de bâtiment
 */

import { 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  query,
  where,
  Timestamp
} from "firebase/firestore";
import { db } from "./firebase";
import {
  BUILDING_ENERGY_CONSUMPTION_DATA,
  annualToMonthlyBreakdown,
  type BuildingEnergyConsumption,
} from "./building-energy-consumption";

const ENERGY_DATA_COLLECTION = "building_energy_consumption";

/**
 * Initialise les données de consommation énergétique dans Firebase
 * À exécuter une seule fois pour peupler la base de données
 */
export async function initializeEnergyConsumptionData(): Promise<void> {
  try {
    console.log("Initialisation des données de consommation énergétique dans Firebase...");
    
    const promises = BUILDING_ENERGY_CONSUMPTION_DATA.map(async (data) => {
      const docRef = doc(db, ENERGY_DATA_COLLECTION, data.googlePlaceType);
      await setDoc(docRef, {
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
    
    await Promise.all(promises);
    console.log(`✅ ${BUILDING_ENERGY_CONSUMPTION_DATA.length} types de bâtiments initialisés dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des données:", error);
    throw error;
  }
}

/** Dérive consommation moyenne et par mois si absentes (rétrocompatibilité). */
function withMonthlyConsumption(data: Record<string, unknown>): BuildingEnergyConsumption {
  const annual = (data.consumptionKwhPerM2 as number) ?? 150;
  const monthly =
    typeof data.consumptionKwhPerM2PerMonth === "number"
      ? data.consumptionKwhPerM2PerMonth
      : Math.round((annual / 12) * 10) / 10;
  let byMonth = data.consumptionKwhPerM2ByMonth as number[] | undefined;
  if (!Array.isArray(byMonth) || byMonth.length !== 12) {
    byMonth = annualToMonthlyBreakdown(annual);
  }
  return {
    ...data,
    consumptionKwhPerM2: annual,
    consumptionKwhPerM2PerMonth: monthly,
    consumptionKwhPerM2ByMonth: byMonth,
  } as BuildingEnergyConsumption;
}

/**
 * Récupère la consommation énergétique pour un type de bâtiment depuis Firebase
 * (annuelle, moyenne mensuelle et détail par mois [jan–déc] en kWh/m²).
 */
export async function getEnergyConsumptionFromFirebase(
  googlePlaceType: string
): Promise<BuildingEnergyConsumption | null> {
  try {
    const docRef = doc(db, ENERGY_DATA_COLLECTION, googlePlaceType);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return withMonthlyConsumption(docSnap.data());
    }

    return await getEnergyConsumptionByCategory(googlePlaceType);
  } catch (error) {
    console.error("Erreur lors de la récupération des données:", error);
    return null;
  }
}

/**
 * Récupère la consommation pour un mois donné depuis Firebase (kWh/m²).
 * @param googlePlaceType - Type de bâtiment
 * @param monthIndex - 0 = janvier, 11 = décembre
 */
export async function getEnergyConsumptionForMonthFromFirebase(
  googlePlaceType: string,
  monthIndex: number
): Promise<number> {
  const data = await getEnergyConsumptionFromFirebase(googlePlaceType);
  if (!data) return 12.5;
  const byMonth = data.consumptionKwhPerM2ByMonth;
  if (Array.isArray(byMonth) && byMonth.length === 12 && monthIndex >= 0 && monthIndex <= 11) {
    return byMonth[monthIndex] ?? data.consumptionKwhPerM2PerMonth;
  }
  return data.consumptionKwhPerM2PerMonth;
}

/**
 * Récupère la consommation moyenne pour une catégorie depuis Firebase
 */
async function getEnergyConsumptionByCategory(
  googlePlaceType: string
): Promise<BuildingEnergyConsumption | null> {
  try {
    // Mapper le type Google vers une catégorie
    const categoryMap: Record<string, string> = {
      store: "retail",
      shopping_mall: "retail",
      clothing_store: "retail",
      electronics_store: "retail",
      supermarket: "supermarket",
      grocery_or_supermarket: "supermarket",
      restaurant: "hospitality",
      cafe: "hospitality",
      office: "office",
      bank: "office",
      warehouse: "warehouse",
      storage: "warehouse",
      factory: "industrial",
      industrial: "industrial",
      gym: "sport",
      fitness_center: "sport",
    };
    
    const category = categoryMap[googlePlaceType] || "other";
    
    const q = query(
      collection(db, ENERGY_DATA_COLLECTION),
      where("category", "==", category)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      // Retourner la valeur par défaut
      const defaultDoc = await getDoc(doc(db, ENERGY_DATA_COLLECTION, "other"));
      if (defaultDoc.exists()) {
        return withMonthlyConsumption(defaultDoc.data());
      }
      return null;
    }
    
    // Calculer la moyenne de la catégorie
    let total = 0;
    let count = 0;
    
    querySnapshot.forEach((doc) => {
      const data = doc.data() as BuildingEnergyConsumption;
      total += data.consumptionKwhPerM2;
      count++;
    });
    
    const average = Math.round(total / count);
    const monthlyAverage = Math.round((average / 12) * 10) / 10;

    return {
      googlePlaceType,
      category,
      consumptionKwhPerM2: average,
      consumptionKwhPerM2PerMonth: monthlyAverage,
      consumptionKwhPerM2ByMonth: annualToMonthlyBreakdown(average),
      source: "Calculé depuis Firebase",
      notes: `Moyenne de ${count} types dans la catégorie ${category}`,
    };
  } catch (error) {
    console.error("Erreur lors de la récupération par catégorie:", error);
    return null;
  }
}

/**
 * Met à jour les données de consommation pour un type de bâtiment
 */
export async function updateEnergyConsumptionData(
  googlePlaceType: string,
  data: Partial<BuildingEnergyConsumption>
): Promise<void> {
  try {
    const docRef = doc(db, ENERGY_DATA_COLLECTION, googlePlaceType);
    await setDoc(
      docRef,
      {
        ...data,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Erreur lors de la mise à jour des données:", error);
    throw error;
  }
}

/**
 * Récupère toutes les données de consommation depuis Firebase (avec consommation mensuelle).
 */
export async function getAllEnergyConsumptionData(): Promise<BuildingEnergyConsumption[]> {
  try {
    const querySnapshot = await getDocs(collection(db, ENERGY_DATA_COLLECTION));
    const data: BuildingEnergyConsumption[] = [];
    
    querySnapshot.forEach((d) => {
      data.push(withMonthlyConsumption(d.data()));
    });
    
    return data;
  } catch (error) {
    console.error("Erreur lors de la récupération de toutes les données:", error);
    return [];
  }
}
