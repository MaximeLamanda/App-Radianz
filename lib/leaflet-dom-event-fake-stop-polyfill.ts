import L from "leaflet";

const skipByType: Record<string, boolean> = {};

type DomEventWithLegacy = typeof L.DomEvent & {
  fakeStop?: (e: { type: string }) => void;
  skipped?: (e: { type: string }) => boolean;
};

/**
 * Leaflet ≥ 1.8 a retiré `L.DomEvent.fakeStop` / `skipped` ; `leaflet.vectorgrid` (renderer canvas)
 * les utilise encore dans `_onClick`.
 *
 * Depuis Leaflet 1.9, `Map._fireDOMEvent` coupe la chaîne de cibles si `originalEvent._stopped`
 * (voir `Map.js`). Sans `_stopped`, le clic canvas se propage encore jusqu’à la carte : tout
 * `map.on("click", …)` (ex. désélection fond Discovery) s’exécute après le clic MVT et efface
 * la sélection.
 *
 * @see https://github.com/Leaflet/Leaflet.VectorGrid/issues/274
 */
export function ensureLeafletDomEventFakeStopPolyfill(): void {
  const de = L.DomEvent as DomEventWithLegacy;
  if (typeof de.fakeStop === "function") return;
  de.fakeStop = function (e: { type: string; _stopped?: boolean }) {
    skipByType[e.type] = true;
    e._stopped = true;
  };
  if (typeof de.skipped !== "function") {
    de.skipped = function (e: { type: string }) {
      const v = skipByType[e.type];
      skipByType[e.type] = false;
      return Boolean(v);
    };
  }
}
