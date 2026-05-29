import { describe, expect, it } from "vitest";
import { resolveProspectDisplayNameForSave } from "@/components/solar-scout/ProspectDisplayNameEditor";

describe("resolveProspectDisplayNameForSave", () => {
  it("utilise la saisie utilisateur si non vide", () => {
    expect(resolveProspectDisplayNameForSave("  Mon site  ", "Défaut")).toBe("Mon site");
  });

  it("retombe sur le nom généré puis sur Prospect", () => {
    expect(resolveProspectDisplayNameForSave("", "Entrepôt Nord")).toBe("Entrepôt Nord");
    expect(resolveProspectDisplayNameForSave("  ", "")).toBe("Prospect");
  });
});
