import { formatDirigeantPhysiqueName } from "@/lib/api-gouv-enrichment-map";
import { createManualProspectContact } from "@/lib/prospect-contacts";
import type { DirigeantPhysiqueGouv } from "@/lib/recherche-entreprises";
import type { ProspectContact, ProspectContactOriginKind } from "@/types";

export function sirenFromSiretOrSiren(value: string): string | undefined {
  const t = value.trim();
  if (/^\d{9}$/.test(t)) return t;
  if (/^\d{14}$/.test(t)) return t.slice(0, 9);
  return undefined;
}

export function normalizeContactPersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function dirigeantFullName(d: DirigeantPhysiqueGouv): string {
  return formatDirigeantPhysiqueName(d);
}

export function isDirigeantAlreadyAdded(
  contacts: ProspectContact[] | undefined,
  input: {
    originKind: ProspectContactOriginKind;
    originRef: string;
    fullName: string;
  }
): boolean {
  const ref = input.originRef.trim();
  const nameKey = normalizeContactPersonName(input.fullName);
  if (!ref || !nameKey) return false;
  return (contacts ?? []).some((c) => {
    const kind = c.originKind ?? (c.poiKey ? "poi" : "autre");
    const cRef = (c.originRef ?? c.poiKey ?? "").trim();
    if (kind !== input.originKind || cRef !== ref) return false;
    return normalizeContactPersonName(c.fullName) === nameKey;
  });
}

export function collectUniqueSirensForDirigeantFetch(input: {
  parcelleSirens: string[];
  etablissementSirensOrSirets: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const siren = sirenFromSiretOrSiren(raw);
    if (!siren || seen.has(siren)) return;
    seen.add(siren);
    out.push(siren);
  };
  for (const s of input.parcelleSirens) push(s);
  for (const s of input.etablissementSirensOrSirets) push(s);
  return out;
}

export function contactFromDirigeant(input: {
  dirigeant: DirigeantPhysiqueGouv;
  originKind: "parcelle" | "etablissement";
  originRef: string;
  originLabel: string;
}): ProspectContact {
  const fullName = dirigeantFullName(input.dirigeant);
  if (!fullName) {
    throw new Error("Nom du dirigeant invalide.");
  }
  return createManualProspectContact({
    fullName,
    title: input.dirigeant.qualite,
    originKind: input.originKind,
    originRef: input.originRef,
    originLabel: input.originLabel,
  });
}

export type GouvDirigeantsCacheEntry = {
  status: "loading" | "ok" | "err";
  companyLegalName?: string;
  dirigeantsPhysiques?: DirigeantPhysiqueGouv[];
};
