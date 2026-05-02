/** Libellés courants trancheEffectifsEtablissement (SIRENE / INSEE). */

const LABELS: Record<string, string> = {
  NN: "Non renseigné",
  "00": "0 salarié",
  "01": "1 ou 2",
  "02": "3 à 5",
  "03": "6 à 9",
  "04": "10 à 19",
  "05": "20 à 49",
  "06": "50 à 99",
  "07": "100 à 199",
  "08": "200 à 249",
  "09": "250 à 499",
  "10": "500 à 999",
  "11": "1 000 à 1 999",
  "12": "2 000 à 4 999",
  "13": "5 000 à 9 999",
  "53": "10 000 et plus",
};

export function labelTrancheEffectifs(code: string | null | undefined): string {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!c) return "—";
  return LABELS[c] ?? c;
}
