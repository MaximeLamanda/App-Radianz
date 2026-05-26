import type { ProspectContact, ProspectContactOriginKind } from "@/types";

export const PROSPECT_CONTACT_ORIGIN_KIND_LABEL: Record<ProspectContactOriginKind, string> = {
  poi: "POI",
  parcelle: "Parcelle",
  etablissement: "Établissement",
  autre: "Autre",
};

export type ManualProspectContactInput = {
  fullName: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  originKind: ProspectContactOriginKind;
  originRef?: string;
  originLabel?: string;
};

export type ProspectContactOriginLabelContext = {
  poiNameByKey: Map<string, string>;
  parcelleLabelById: Map<string, string>;
  etablissementLabelBySiret: Map<string, string>;
};

export type ProspectContactOriginSection = {
  kind: ProspectContactOriginKind;
  key: string;
  label: string;
  contacts: ProspectContact[];
};

/** @deprecated Utiliser `groupProspectContactsByOrigin`. */
export type ProspectContactDisplayGroup = {
  site: ProspectContact[];
  byPoi: Array<{ poiKey: string; label: string; contacts: ProspectContact[] }>;
};

function trimOptional(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t === "" ? undefined : t;
}

/** POI éligible à l'appel Apollo (domaine ou Place Details). */
/** Initiales affichées sur l'avatar (pile tableau, drawer discovery, etc.). */
export function prospectContactInitials(contact: ProspectContact): string {
  const first = contact.firstName?.trim();
  const last = contact.lastName?.trim();
  if (first && last) return `${first[0]!}${last[0]!}`.toUpperCase();
  if (first && first.length >= 2) return first.slice(0, 2).toUpperCase();
  const parts = contact.fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

export function canEnrichPoiWithApollo(poi: {
  website: string;
  source: string;
  placeId?: string;
}): boolean {
  return poi.website.trim() !== "" || (poi.source === "google" && Boolean(poi.placeId?.trim()));
}

export function resolveContactOriginMeta(
  contact: ProspectContact,
  ctx: ProspectContactOriginLabelContext
): { kind: ProspectContactOriginKind; ref: string; label: string } {
  if (contact.originKind) {
    const kind = contact.originKind;
    const ref = (contact.originRef ?? "").trim();
    const explicit = trimOptional(contact.originLabel);
    if (explicit) return { kind, ref, label: explicit };
    if (kind === "poi" && ref) {
      return { kind, ref, label: ctx.poiNameByKey.get(ref) ?? ref };
    }
    if (kind === "parcelle" && ref) {
      return { kind, ref, label: ctx.parcelleLabelById.get(ref) ?? ref };
    }
    if (kind === "etablissement" && ref) {
      return { kind, ref, label: ctx.etablissementLabelBySiret.get(ref) ?? ref };
    }
    return { kind, ref, label: PROSPECT_CONTACT_ORIGIN_KIND_LABEL[kind] };
  }
  if (contact.poiKey) {
    const ref = contact.poiKey;
    return { kind: "poi", ref, label: ctx.poiNameByKey.get(ref) ?? ref };
  }
  return { kind: "autre", ref: "", label: "Site" };
}

export function contactOriginSectionKey(kind: ProspectContactOriginKind, ref: string): string {
  return `${kind}:${ref || "_"}`;
}

const ORIGIN_SECTION_ORDER: ProspectContactOriginKind[] = [
  "parcelle",
  "etablissement",
  "poi",
  "autre",
];

export function groupProspectContactsByOrigin(
  contacts: ProspectContact[] | undefined,
  ctx: ProspectContactOriginLabelContext
): ProspectContactOriginSection[] {
  const buckets = new Map<string, ProspectContactOriginSection>();

  for (const c of contacts ?? []) {
    const meta = resolveContactOriginMeta(c, ctx);
    const key = contactOriginSectionKey(meta.kind, meta.ref);
    const existing = buckets.get(key);
    if (existing) {
      existing.contacts.push(c);
      continue;
    }
    buckets.set(key, {
      kind: meta.kind,
      key: meta.ref,
      label: meta.label,
      contacts: [c],
    });
  }

  return [...buckets.values()].sort((a, b) => {
    const kindCmp =
      ORIGIN_SECTION_ORDER.indexOf(a.kind) - ORIGIN_SECTION_ORDER.indexOf(b.kind);
    if (kindCmp !== 0) return kindCmp;
    return a.label.localeCompare(b.label, "fr");
  });
}

/** @deprecated */
export function filterProspectContactsByScope(
  contacts: ProspectContact[] | undefined,
  poiKey: string | undefined
): ProspectContact[] {
  const list = contacts ?? [];
  if (poiKey === undefined) {
    return list.filter((c) => !c.poiKey && c.originKind !== "poi");
  }
  return list.filter(
    (c) => c.poiKey === poiKey || (c.originKind === "poi" && c.originRef === poiKey)
  );
}

function newManualContactId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createManualProspectContact(input: ManualProspectContactInput): ProspectContact {
  const fullName = input.fullName.trim();
  if (!fullName) {
    throw new Error("Le nom complet est obligatoire.");
  }
  const originKind = input.originKind;
  const originRef = trimOptional(input.originRef);
  const originLabel = trimOptional(input.originLabel);
  const title = trimOptional(input.title);
  const email = trimOptional(input.email);
  const phone = trimOptional(input.phone);
  const linkedinUrl = trimOptional(input.linkedinUrl);
  const now = new Date();

  const contact: ProspectContact = {
    id: newManualContactId(),
    originKind,
    fullName,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
  if (originKind === "poi" && originRef) contact.poiKey = originRef;
  if (originRef) contact.originRef = originRef;
  if (originLabel) contact.originLabel = originLabel;
  if (title) contact.title = title;
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (linkedinUrl) contact.linkedinUrl = linkedinUrl;
  return contact;
}

export function updateManualProspectContact(
  contact: ProspectContact,
  patch: Omit<ManualProspectContactInput, "originKind" | "originRef" | "originLabel"> & {
    originKind?: ProspectContactOriginKind;
    originRef?: string;
    originLabel?: string;
  }
): ProspectContact {
  if (contact.source !== "manual") {
    throw new Error("Seuls les contacts manuels peuvent être modifiés.");
  }
  const fullName = patch.fullName.trim();
  if (!fullName) {
    throw new Error("Le nom complet est obligatoire.");
  }
  const originKind = patch.originKind ?? contact.originKind ?? "autre";
  const originRef = trimOptional(patch.originRef ?? contact.originRef);
  const originLabel = trimOptional(patch.originLabel ?? contact.originLabel);
  const title = trimOptional(patch.title);
  const email = trimOptional(patch.email);
  const phone = trimOptional(patch.phone);
  const linkedinUrl = trimOptional(patch.linkedinUrl);
  const updated: ProspectContact = {
    ...contact,
    fullName,
    originKind,
    updatedAt: new Date(),
  };
  if (originKind === "poi" && originRef) updated.poiKey = originRef;
  else delete updated.poiKey;
  if (originRef) updated.originRef = originRef;
  else delete updated.originRef;
  if (originLabel) updated.originLabel = originLabel;
  else delete updated.originLabel;
  if (title) updated.title = title;
  else delete updated.title;
  if (email) updated.email = email;
  else delete updated.email;
  if (phone) updated.phone = phone;
  else delete updated.phone;
  if (linkedinUrl) updated.linkedinUrl = linkedinUrl;
  else delete updated.linkedinUrl;
  return updated;
}

export function removeProspectContactById(
  contacts: ProspectContact[],
  id: string
): ProspectContact[] {
  return contacts.filter((c) => c.id !== id);
}

/** @deprecated */
export function replaceContactsForScope(
  all: ProspectContact[] | undefined,
  scopePoiKey: string | undefined,
  scoped: ProspectContact[]
): ProspectContact[] {
  const rest = (all ?? []).filter((c) => {
    if (scopePoiKey === undefined) {
      return c.poiKey || c.originKind === "poi";
    }
    return c.poiKey !== scopePoiKey && !(c.originKind === "poi" && c.originRef === scopePoiKey);
  });
  return [...scoped, ...rest];
}

/** @deprecated */
export function groupProspectContactsForDisplay(
  contacts: ProspectContact[] | undefined,
  poiNameByKey: Map<string, string>
): ProspectContactDisplayGroup {
  const site: ProspectContact[] = [];
  const byPoiMap = new Map<string, ProspectContact[]>();

  for (const c of contacts ?? []) {
    const meta = resolveContactOriginMeta(c, {
      poiNameByKey,
      parcelleLabelById: new Map(),
      etablissementLabelBySiret: new Map(),
    });
    if (meta.kind === "poi") {
      const bucket = byPoiMap.get(meta.ref) ?? [];
      bucket.push(c);
      byPoiMap.set(meta.ref, bucket);
      continue;
    }
    if (meta.kind === "autre" && !meta.ref) {
      site.push(c);
      continue;
    }
  }

  const byPoi = [...byPoiMap.entries()]
    .map(([poiKey, poiContacts]) => ({
      poiKey,
      label: poiNameByKey.get(poiKey)?.trim() || poiKey,
      contacts: poiContacts,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));

  return { site, byPoi };
}
