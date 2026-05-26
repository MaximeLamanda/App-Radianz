import { describe, it, expect } from "vitest";
import {
  canEnrichPoiWithApollo,
  createManualProspectContact,
  groupProspectContactsByOrigin,
  prospectContactInitials,
  removeProspectContactById,
  resolveContactOriginMeta,
} from "./prospect-contacts";
import type { ProspectContact } from "@/types";

const emptyCtx = {
  poiNameByKey: new Map<string, string>(),
  parcelleLabelById: new Map<string, string>(),
  etablissementLabelBySiret: new Map<string, string>(),
};

function manual(partial: Partial<ProspectContact> & { fullName: string }): ProspectContact {
  return {
    id: partial.id ?? "m1",
    source: "manual",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  };
}

describe("createManualProspectContact", () => {
  it("requires fullName", () => {
    expect(() =>
      createManualProspectContact({ fullName: "  ", originKind: "autre" })
    ).toThrow();
  });

  it("stores origin parcelle", () => {
    const c = createManualProspectContact({
      fullName: "Jean Dupont",
      originKind: "parcelle",
      originRef: "parc-1",
      originLabel: "Section AB 12",
    });
    expect(c.originKind).toBe("parcelle");
    expect(c.originRef).toBe("parc-1");
    expect(c.poiKey).toBeUndefined();
  });

  it("sets poiKey when origin is poi", () => {
    const c = createManualProspectContact({
      fullName: "A",
      originKind: "poi",
      originRef: "poi-1",
      originLabel: "Magasin",
    });
    expect(c.poiKey).toBe("poi-1");
  });

  it("omits undefined optional fields (Firestore-safe)", () => {
    const c = createManualProspectContact({
      fullName: "Jean Dupont",
      originKind: "parcelle",
      originRef: "parc-1",
      originLabel: "Section AB 12",
    });
    expect(Object.values(c).some((v) => v === undefined)).toBe(false);
    expect(c).not.toHaveProperty("poiKey");
    expect(c).not.toHaveProperty("email");
  });
});

describe("groupProspectContactsByOrigin", () => {
  it("groups by origin kind and ref", () => {
    const ctx = {
      ...emptyCtx,
      poiNameByKey: new Map([["k1", "Magasin"]]),
      parcelleLabelById: new Map([["p1", "Parcelle A"]]),
    };
    const contacts = [
      manual({ fullName: "A", originKind: "parcelle", originRef: "p1" }),
      manual({ fullName: "B", originKind: "poi", originRef: "k1", id: "b" }),
      manual({ fullName: "C", originKind: "autre", originLabel: "Partenaire" }),
    ];
    const sections = groupProspectContactsByOrigin(contacts, ctx);
    expect(sections).toHaveLength(3);
    expect(sections[0]?.kind).toBe("parcelle");
    expect(sections[1]?.kind).toBe("poi");
    expect(sections[2]?.kind).toBe("autre");
  });
});

describe("resolveContactOriginMeta", () => {
  it("legacy poiKey maps to poi", () => {
    const meta = resolveContactOriginMeta(
      manual({ fullName: "X", poiKey: "k1" }),
      { ...emptyCtx, poiNameByKey: new Map([["k1", "Lieu"]]) }
    );
    expect(meta.kind).toBe("poi");
    expect(meta.label).toBe("Lieu");
  });
});

describe("canEnrichPoiWithApollo", () => {
  it("true when website or google placeId", () => {
    expect(canEnrichPoiWithApollo({ website: "https://acme.fr", source: "osm" })).toBe(true);
    expect(canEnrichPoiWithApollo({ website: "", source: "google", placeId: "ChIJ" })).toBe(true);
  });
});

describe("removeProspectContactById", () => {
  it("removes by id", () => {
    const list = [manual({ fullName: "A", id: "a" }), manual({ fullName: "B", id: "b" })];
    expect(removeProspectContactById(list, "a")).toHaveLength(1);
  });
});

describe("prospectContactInitials", () => {
  it("uses first and last name when set", () => {
    expect(
      prospectContactInitials(manual({ fullName: "Jean Dupont", firstName: "Jean", lastName: "Dupont" }))
    ).toBe("JD");
  });

  it("derives from fullName", () => {
    expect(prospectContactInitials(manual({ fullName: "Marie Curie" }))).toBe("MC");
  });
});
