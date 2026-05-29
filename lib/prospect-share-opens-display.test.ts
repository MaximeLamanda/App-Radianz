import { describe, expect, it } from "vitest";
import {
  getProspectShareOpensDisplay,
  SHARE_OPENS_DOT_CAP,
  SHARE_OPENS_RECENT_MS,
} from "./prospect-share-opens-display";

describe("getProspectShareOpensDisplay", () => {
  it("sans lien partage", () => {
    const d = getProspectShareOpensDisplay({});
    expect(d.hasShareLink).toBe(false);
    expect(d.count).toBe(0);
    expect(d.filledDots).toBe(0);
    expect(d.emptyDots).toBe(0);
    expect(d.tooltip).toMatch(/Aucun lien/);
  });

  it("lien sans ouverture", () => {
    const d = getProspectShareOpensDisplay({ shareToken: "abc" });
    expect(d.hasShareLink).toBe(true);
    expect(d.count).toBe(0);
    expect(d.filledDots).toBe(0);
    expect(d.emptyDots).toBe(SHARE_OPENS_DOT_CAP);
    expect(d.tooltip).toMatch(/aucune ouverture/);
  });

  it("plafonne les points affichés", () => {
    const d = getProspectShareOpensDisplay({
      shareToken: "t",
      shareSessionCount: 12,
      shareLastSessionAt: new Date("2020-01-01"),
    });
    expect(d.filledDots).toBe(SHARE_OPENS_DOT_CAP);
    expect(d.emptyDots).toBe(0);
    expect(d.tooltip).toMatch(/12 ouvertures/);
  });

  it("marque récent si dernière session < 7 j", () => {
    const recent = new Date(Date.now() - SHARE_OPENS_RECENT_MS + 60_000);
    const d = getProspectShareOpensDisplay({
      shareToken: "t",
      shareSessionCount: 1,
      shareLastSessionAt: recent,
    });
    expect(d.isRecent).toBe(true);
  });
});
