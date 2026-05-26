import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { prepareProspectForFirestore, prospectFromFirestore, type PrepareProspectOptions, type ProspectFirestoreData } from "./firestore-prospect";
import type { Prospect, Lead } from "@/types";

/** Normalise une chaîne pour comparaison (trim, minuscules). */
function normalizeForMatch(value: string | undefined): string {
  if (value == null || value === "") return "";
  return value.trim().toLowerCase();
}

/** Retire les champs undefined d'un objet (Firestore n'accepte pas undefined). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/** Retire récursivement les champs undefined (Firestore les rejette). */
function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefinedDeep(v)])
    ) as T;
  }
  return value;
}

/**
 * Récupère un prospect par son placeId Google (si déjà enregistré dans le pipeline).
 * Si options.name ou options.address sont fournis, le prospect n’est retourné que si
 * le nom et l’adresse correspondent (évite d’ouvrir le mauvais lieu quand deux endroits ont le même nom).
 */
export async function getProspectByPlaceId(
  placeId: string,
  options?: { name?: string; address?: string }
): Promise<Prospect | null> {
  try {
    const prospectsRef = collection(db, "prospects");
    const q = query(
      prospectsRef,
      where("placeId", "==", placeId),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const prospectDoc = snapshot.docs[0];
    const data = prospectDoc.data() as ProspectFirestoreData;
    const prospect = prospectFromFirestore(prospectDoc.id, data);

    if (options) {
      if (options.name != null && options.name !== "" && normalizeForMatch(prospect.name) !== normalizeForMatch(options.name)) return null;
      if (options.address != null && options.address !== "" && normalizeForMatch(prospect.address) !== normalizeForMatch(options.address)) return null;
    }
    return prospect;
  } catch (error) {
    console.error("Erreur lors de la recherche du prospect par placeId:", error);
    return null;
  }
}

/**
 * Récupère un prospect par son ID
 */
export async function getProspectById(prospectId: string): Promise<Prospect | null> {
  try {
    const prospectDoc = await getDoc(doc(db, "prospects", prospectId));
    if (!prospectDoc.exists()) return null;
    const data = prospectDoc.data() as ProspectFirestoreData;
    return prospectFromFirestore(prospectDoc.id, data);
  } catch (error) {
    console.error("Erreur lors de la récupération du prospect:", error);
    return null;
  }
}

/**
 * Attribue les prospects non réclamés (sans userId) à l'utilisateur connecté.
 * Permet de migrer les données existantes vers le premier utilisateur qui se connecte.
 */
export async function claimUnclaimedProspects(userId: string): Promise<number> {
  try {
    const prospectsRef = collection(db, "prospects");
    const q = query(prospectsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const toClaim = snapshot.docs.filter((d) => {
      const data = d.data();
      return !data.userId;
    });
    if (toClaim.length === 0) return 0;
    const BATCH_SIZE = 500;
    let updated = 0;
    for (let i = 0; i < toClaim.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = toClaim.slice(i, i + BATCH_SIZE);
      chunk.forEach((d) => {
        batch.update(d.ref, { userId, updatedAt: Timestamp.now() });
        updated++;
      });
      await batch.commit();
    }
    return updated;
  } catch (error) {
    console.error("Erreur claimUnclaimedProspects:", error);
    throw error;
  }
}

/**
 * Récupère les prospects du pipeline (par userId ou non réclamés pour migration).
 */
export async function getProspectsForPipeline(userId: string): Promise<Prospect[]> {
  try {
    const prospectsRef = collection(db, "prospects");
    const q = query(prospectsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const prospectsData: Prospect[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as ProspectFirestoreData;
      const isOwner = data.userId === userId;
      const isUnclaimed = !data.userId;
      if (isOwner || isUnclaimed) {
        prospectsData.push(prospectFromFirestore(docSnap.id, data));
      }
    });
    return prospectsData;
  } catch (error) {
    console.error("Erreur lors du chargement des prospects:", error);
    throw error;
  }
}

/**
 * Ajoute un prospect au pipeline Firebase
 * @param options - Références panneau/onduleur pour le calcul prix (mêmes que le drawer)
 * @param userId - UID du propriétaire (Firebase Auth)
 */
export async function addProspectToPipeline(
  prospect: Prospect,
  options?: PrepareProspectOptions,
  userId?: string
): Promise<string> {
  try {
    const prospectData = prepareProspectForFirestore(prospect, options, userId);
    const cleanData = stripUndefinedDeep(prospectData) as unknown as Record<string, unknown>;

    const docRef = await addDoc(collection(db, "prospects"), cleanData);
    return docRef.id;
  } catch (error) {
    console.error("Erreur lors de l'ajout du prospect:", error);
    throw error;
  }
}

/**
 * Crée un lead à partir d'un prospect
 */
export async function createLeadFromProspect(
  prospectId: string,
  name: string,
  contactName?: string
): Promise<string> {
  try {
    // Récupérer le prospect
    const prospectDoc = await getDoc(doc(db, "prospects", prospectId));
    
    if (!prospectDoc.exists()) {
      throw new Error("Prospect introuvable");
    }

    const prospectData = prospectDoc.data() as { qualityScore: number; thumbnailUrl?: string };
    
    const docRef = await addDoc(collection(db, "leads"), {
      prospectId,
      name,
      qualityScore: prospectData.qualityScore,
      createdAt: Timestamp.now(),
      ...(contactName != null && { contactName }),
      ...(prospectData.thumbnailUrl != null && { thumbnailUrl: prospectData.thumbnailUrl }),
    });
    
    return docRef.id;
  } catch (error) {
    console.error("Erreur lors de la création du lead:", error);
    throw error;
  }
}

/**
 * Récupère un prospect par son shareToken (pour la page publique prospect).
 */
export async function getProspectByShareToken(shareToken: string): Promise<Prospect | null> {
  try {
    const prospectsRef = collection(db, "prospects");
    const q = query(
      prospectsRef,
      where("shareToken", "==", shareToken),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const prospectDoc = snapshot.docs[0];
    const data = prospectDoc.data() as ProspectFirestoreData;
    return prospectFromFirestore(prospectDoc.id, data);
  } catch (error) {
    console.error("Erreur lors de la recherche du prospect par shareToken:", error);
    return null;
  }
}

/**
 * Met à jour uniquement les overrides prospect (configurationMode, annualConsumptionKwhOverride).
 * Utilisé par la page prospect publique via l'API.
 */
export async function updateProspectOverrides(
  shareToken: string,
  overrides: {
    configurationMode?: Prospect["configurationMode"];
    annualConsumptionKwhOverride?: number | null;
    monthlyConsumptionKwhOverride?: number[] | null;
  }
): Promise<boolean> {
  try {
    const prospect = await getProspectByShareToken(shareToken);
    if (!prospect?.id) return false;
    const prospectRef = doc(db, "prospects", prospect.id);
    const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (overrides.configurationMode != null) updates.configurationMode = overrides.configurationMode;
    if ("annualConsumptionKwhOverride" in overrides)
      updates.annualConsumptionKwhOverride = overrides.annualConsumptionKwhOverride ?? null;
    if ("monthlyConsumptionKwhOverride" in overrides) {
      updates.monthlyConsumptionKwhOverride = overrides.monthlyConsumptionKwhOverride == null
        ? null
        : overrides.monthlyConsumptionKwhOverride.length === 12
          ? overrides.monthlyConsumptionKwhOverride
              .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0))
          : null;
    }
    await updateDoc(prospectRef, updates);
    return true;
  } catch (error) {
    console.error("Erreur updateProspectOverrides:", error);
    return false;
  }
}

/**
 * Met à jour un prospect
 */
export async function updateProspect(
  prospectId: string,
  updates: Partial<Prospect>
): Promise<void> {
  try {
    const prospectRef = doc(db, "prospects", prospectId);
    const sanitized: Record<string, unknown> = {
      ...(stripUndefinedDeep(updates) as Record<string, unknown>),
      updatedAt: Timestamp.now(),
    };
    await updateDoc(prospectRef, sanitized);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du prospect:", error);
    throw error;
  }
}

/**
 * Met à jour un prospect déjà dans le pipeline (utilise prepareProspectForFirestore).
 * Même logique que l'ajout : kWp, prix, break-even recalculés depuis le drawer.
 */
export async function updateProspectInPipeline(
  prospectId: string,
  prospect: Prospect,
  options?: PrepareProspectOptions
): Promise<void> {
  try {
    const fullDoc = prepareProspectForFirestore(prospect, options);
    const { createdAt, ...updateFields } = fullDoc;
    (updateFields as { updatedAt: unknown }).updatedAt = Timestamp.now();
    await updateDoc(doc(db, "prospects", prospectId), updateFields);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du prospect:", error);
    throw error;
  }
}
