import L from "leaflet";

let noDefaultApplied = false;

/** Icône vide : aucun PNG Leaflet, aucune épingle bleue si un marqueur oublie son `icon`. */
export const LEAFLET_HIDDEN_MARKER_ICON = L.divIcon({
  className: "leaflet-hidden-marker-icon",
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

/**
 * Remplace `L.Icon.Default` (marker-icon.png) par un DivIcon invisible sur tous les `L.Marker`.
 */
export function disableLeafletDefaultMarkerIcon(): void {
  if (noDefaultApplied) return;
  noDefaultApplied = true;
  L.Marker.prototype.options.icon = LEAFLET_HIDDEN_MARKER_ICON;
}
