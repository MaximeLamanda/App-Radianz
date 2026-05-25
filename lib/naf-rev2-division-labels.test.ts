import { describe, expect, it } from "vitest";
import {
  formatNafRev2DivisionOption,
  labelNafRev2Division,
  searchNafRev2Divisions,
} from "./naf-rev2-division-labels";

describe("labelNafRev2Division", () => {
  it("retourne le libellé pour une division connue", () => {
    expect(labelNafRev2Division("47")).toBe("Commerce de détail");
    expect(formatNafRev2DivisionOption("47")).toBe("47 — Commerce de détail");
  });

  it("recherche par code ou libellé", () => {
    const immo = searchNafRev2Divisions("immobil");
    expect(immo.some((d) => d.code === "68")).toBe(true);
    const byCode = searchNafRev2Divisions("62");
    expect(byCode.some((d) => d.code === "62")).toBe(true);
  });
});
