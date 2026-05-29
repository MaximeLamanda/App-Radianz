import { describe, expect, it, vi, beforeEach } from "vitest";
import { persistDiscoveryContactList } from "./discovery-contacts-persist";
import type { ProspectContact } from "@/types";

vi.mock("@/lib/firestore", () => ({
  updateProspect: vi.fn(),
}));

import { updateProspect } from "@/lib/firestore";

const sampleContacts: ProspectContact[] = [
  {
    id: "c1",
    fullName: "Alice Martin",
    source: "manual",
  },
];

describe("persistDiscoveryContactList", () => {
  beforeEach(() => {
    vi.mocked(updateProspect).mockReset();
    vi.mocked(updateProspect).mockResolvedValue(undefined);
  });

  it("retourne les contacts sans appeler Firestore sans prospectId", async () => {
    const result = await persistDiscoveryContactList(undefined, sampleContacts);
    expect(result).toEqual(sampleContacts);
    expect(updateProspect).not.toHaveBeenCalled();
  });

  it("appelle updateProspect avec prospectId", async () => {
    const result = await persistDiscoveryContactList("prospect-42", sampleContacts);
    expect(result).toEqual(sampleContacts);
    expect(updateProspect).toHaveBeenCalledWith("prospect-42", { contacts: sampleContacts });
  });
});
