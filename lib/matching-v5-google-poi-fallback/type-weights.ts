/**
 * Poids par type Places (legacy `types[]`).
 * Les valeurs s'additionnent (max par type) puis sont normalisées dans le score final.
 */
const TYPE_WEIGHTS: Record<string, number> = {
  establishment: 1.35,
  point_of_interest: 1.15,
  store: 1.2,
  food: 1.1,
  restaurant: 1.1,
  cafe: 1.05,
  finance: 0.95,
  health: 1.05,
  gym: 1.0,
  lodging: 1.05,
  /** Pénalités */
  route: 0.2,
  street_address: 0.35,
  locality: 0.25,
  political: 0.2,
  premise: 1.0,
  subpremise: 0.85,
  geocode: 0.3,
};

/** Score de type dans [0, 1] environ (boost si plusieurs types pertinents). */
export function scorePlaceTypes(types: string[] | undefined): number {
  if (!types?.length) return 0.55;
  let best = 0.5;
  for (const t of types) {
    const w = TYPE_WEIGHTS[t];
    if (w != null && w > best) best = w;
  }
  return Math.min(1.5, best);
}
