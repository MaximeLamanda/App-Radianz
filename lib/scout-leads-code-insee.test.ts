import { describe, expect, it } from "vitest";
import { parseOptionalCodeInseeListFromSearchParams } from "./scout-leads-code-insee";

describe("scout-leads-code-insee", () => {
  it("sans param → null (pas de filtre additionnel)", () => {
    expect(parseOptionalCodeInseeListFromSearchParams(new URLSearchParams())).toBeNull();
  });

  it("liste virgule + dédoublonnage + ignore invalide", () => {
    const sp = new URLSearchParams();
    sp.set("codeInsee", "33318,33522,33318,xx");
    expect(parseOptionalCodeInseeListFromSearchParams(sp)).toEqual(["33318", "33522"]);
  });

  it("plusieurs codeInsee", () => {
    const sp = new URLSearchParams();
    sp.append("codeInsee", "33192");
    sp.append("codeInsee", "33547");
    expect(parseOptionalCodeInseeListFromSearchParams(sp)).toEqual(["33192", "33547"]);
  });
});
