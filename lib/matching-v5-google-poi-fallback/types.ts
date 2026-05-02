/** Résultat brut Nearby Search (champs utiles au fallback V5). */
export type NearbyPlaceResult = {
  place_id: string;
  name: string;
  vicinity?: string;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
};

export type RankedNearbyPlace = NearbyPlaceResult & {
  distanceM: number;
  typeScore: number;
  /** Plus haut = meilleur candidat (distance + types + bonus parcelle). */
  relevanceScore: number;
  /** POI dans l’emprise parcelle (MultiPolygon supporté). */
  insideParcel: boolean;
};

export type PlaceDetailsFields = {
  place_id: string;
  formatted_address?: string;
  name?: string;
  types?: string[];
};

export type GooglePoiFallbackOptions = {
  /** Rayon de recherche en mètres (défaut 100). */
  radiusM?: number;
  /** Clé API Google (server). */
  apiKey: string;
  /** Injection pour tests (défaut global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Si défini : seuls les POI dont la position est dans ce polygone / multipolygone
   * (emprise parcelle V5) sont classés ; les autres sont exclus.
   */
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

export type GooglePoiFallbackRunResult = {
  ok: true;
  centroid: { lat: number; lng: number };
  radiusM: number;
  nearbyStatus: string;
  nearbyErrorMessage?: string;
  rawNearbyCount: number;
  /** POI exclus car hors emprise parcelle (si filtre actif). */
  excludedOutsideParcel: number;
  ranked: RankedNearbyPlace[];
  topN: number;
  winner?: PlaceDetailsFields;
  detailsStatus?: string;
  detailsErrorMessage?: string;
};

export type GooglePoiFallbackRunError = {
  ok: false;
  step: "nearby" | "details" | "config";
  message: string;
  nearbyStatus?: string;
};
