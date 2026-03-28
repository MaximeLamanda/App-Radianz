/** Logs diagnostic drawer / polygone OSM. Forcer en prod : NEXT_PUBLIC_DEBUG_POLYGON_DRAWER=1 */
export const DEBUG_POLYGON_DRAWER =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEBUG_POLYGON_DRAWER === "1";

export function logPolygonDrawer(stage: string, payload: Record<string, unknown>) {
  if (!DEBUG_POLYGON_DRAWER) return;
  console.info(`[PolygonDrawer] ${stage}`, payload);
}
