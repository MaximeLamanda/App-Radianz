/**
 * Règles IRIS alignées sur `data-pipeline/matching_v5/run_matching_v5.py`
 * (`is_parc_industriel_iris`).
 */
export function isParcIndustrielIris(nomIris: string | null | undefined): boolean {
  const n = String(nomIris ?? "").trim();
  if (!n || n.toLowerCase() === "nan") return false;
  return n.toLowerCase() === "parc industriel";
}
