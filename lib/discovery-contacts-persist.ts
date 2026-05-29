import { updateProspect } from "@/lib/firestore";
import type { ProspectContact } from "@/types";

/**
 * Enregistre la liste de contacts sur Firestore si `prospectId` est défini,
 * sinon ne fait que retourner la liste (brouillon Discovery en mémoire).
 */
export async function persistDiscoveryContactList(
  prospectId: string | undefined,
  contacts: ProspectContact[]
): Promise<ProspectContact[]> {
  if (prospectId) {
    await updateProspect(prospectId, { contacts });
  }
  return contacts;
}
