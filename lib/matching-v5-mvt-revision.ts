/**
 * Révision des tuiles MVT bâtiments matching V5 — bump après `REFRESH` de la MV ou déploiement
 * pour invalider caches navigateur (ETag + `SCOUT_BUILDINGS_MVT_REVISION`).
 */
export function getScoutBuildingsMvtRevision(): string {
  const v = process.env.SCOUT_BUILDINGS_MVT_REVISION?.trim();
  return v && v.length > 0 ? v : "0";
}
