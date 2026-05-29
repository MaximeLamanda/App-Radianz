import type { InverterReference } from "@/types";

export type InverterCatalogAddAction = "add" | "restore";

export type InverterCatalogAddableItem = {
  catalogRef: InverterReference;
  action: InverterCatalogAddAction;
};

/** Onduleurs du catalogue absents de la liste utilisateur ou masqués (visible !== true). */
export function getInvertersAddableFromCatalog(
  catalog: InverterReference[],
  userRefs: InverterReference[]
): InverterCatalogAddableItem[] {
  const userById = new Map(userRefs.map((r) => [r.id, r]));
  return catalog
    .filter((catalogRef) => {
      const user = userById.get(catalogRef.id);
      if (!user) return true;
      return user.visible !== true;
    })
    .map((catalogRef): InverterCatalogAddableItem => ({
      catalogRef,
      action: userById.has(catalogRef.id) ? "restore" : "add",
    }))
    .sort((a, b) => a.catalogRef.name.localeCompare(b.catalogRef.name));
}

/** Fusionne le catalogue avec l'existant utilisateur pour réintégration. */
export function mergeInverterFromCatalogForUser(
  catalogRef: InverterReference,
  existing?: InverterReference
): InverterReference {
  if (!existing) {
    return { ...catalogRef, visible: true, recommended: catalogRef.recommended ?? false };
  }
  return {
    ...catalogRef,
    ...existing,
    name: catalogRef.name,
    inverterType: catalogRef.inverterType,
    powerW: catalogRef.powerW,
    efficiencyPercent: catalogRef.efficiencyPercent,
    countryOfOrigin: catalogRef.countryOfOrigin,
    countryCode: catalogRef.countryCode ?? existing.countryCode,
    costEur: catalogRef.costEur,
    imageUrl: catalogRef.imageUrl ?? existing.imageUrl,
    warrantyYears: catalogRef.warrantyYears ?? existing.warrantyYears,
    visible: true,
    recommended: existing.recommended ?? catalogRef.recommended ?? false,
  };
}
