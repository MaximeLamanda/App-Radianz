import { describe, expect, it } from "vitest";
import {
  comboMeetsDiscoveryActivityTag,
  countZoneTagsFromCombos,
  discoveryComboActivityHeroBadgeLabel,
  discoverySelectableZoneTag,
  pickPrimaryDiscoveryZoneTag,
} from "./discovery-osm-activity-tags";

describe("discoverySelectableZoneTag", () => {
  it("accepte les tags pro", () => {
    expect(discoverySelectableZoneTag("Industrial")).toBe("industrial");
  });
  it("rejette les autres", () => {
    expect(discoverySelectableZoneTag("farmland")).toBeNull();
  });
});

describe("comboMeetsDiscoveryActivityTag", () => {
  it("passe sans filtre", () => {
    expect(comboMeetsDiscoveryActivityTag(["retail"], null)).toBe(true);
  });
  it("filtre par tag", () => {
    expect(comboMeetsDiscoveryActivityTag(["retail", "commercial"], "retail")).toBe(true);
    expect(comboMeetsDiscoveryActivityTag(["commercial"], "retail")).toBe(false);
  });
});

describe("pickPrimaryDiscoveryZoneTag", () => {
  it("retourne le tag prioritaire", () => {
    expect(pickPrimaryDiscoveryZoneTag(["retail", "industrial"])).toBe("industrial");
    expect(pickPrimaryDiscoveryZoneTag(["commercial"])).toBe("commercial");
  });
  it("retourne null sans tag connu", () => {
    expect(pickPrimaryDiscoveryZoneTag([])).toBeNull();
  });
});

describe("discoveryComboActivityHeroBadgeLabel", () => {
  it("ordonne et libelle les tags pro", () => {
    expect(discoveryComboActivityHeroBadgeLabel(["commercial", "industrial"])).toBe(
      "Industriel · Tertiaire"
    );
  });
  it("retourne vide sans tag", () => {
    expect(discoveryComboActivityHeroBadgeLabel([])).toBe("");
  });
});

describe("countZoneTagsFromCombos", () => {
  it("compte par combo", () => {
    const rows = countZoneTagsFromCombos([
      { zoneTags: ["industrial", "commercial"] },
      { zoneTags: ["industrial"] },
    ]);
    expect(rows).toEqual([
      { tag: "industrial", count: 2 },
      { tag: "commercial", count: 1 },
    ]);
  });
});
