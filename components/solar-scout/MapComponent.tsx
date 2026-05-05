"use client";

import { useEffect, useRef, useState } from "react";
import { type MapBounds } from "@/lib/swr-hooks";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";
import { loadProspectSurfaces } from "@/lib/prospect-storage";
import { getProspectByPlaceId } from "@/lib/firestore";
import { loadMapPosition, saveMapPosition, getDefaultMapPosition } from "@/lib/map-position-storage";
import type { Prospect, AddressCoordinates, RoofSurface, Contact, PlaceType, Exposure } from "@/types";
import { convertPlaceType, extractContact } from "@/lib/places";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import { geojsonPolygonToGooglePathParts } from "@/lib/geojson-google-polygon";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import { toast } from "sonner";
import { BRAND_LIME, BRAND_LIME_HOVER } from "@/lib/brand-colors";

interface MapComponentProps {
  onProspectUpdate: (prospect: Prospect | null) => void;
  centerCoordinates?: AddressCoordinates | null;
  currentProspect?: Prospect | null;
  onGetMapCenter?: (getCenterFunc: () => AddressCoordinates | null) => void;
  onGetMapBounds?: (getBoundsFunc: () => MapBounds | null) => void;
  onBdnbSurface?: (surfaces: RoofSurface[] | null) => void;
  /** Appelé quand les infos BDNB (année, surface) sont disponibles ou réinitialisées */
  onBdnbInfo?: (info: { anneeConstruction: number | null; surfaceM2: number | null }) => void;
  /** Appelé au début/fin de l'enrichissement (geocode + BDNB + POI) pour afficher le loading */
  onOsmEnrichmentChange?: (enriching: boolean) => void;
  onViewBoundsChange?: (bounds: MapBounds | null) => void;
  /** Couche découverte (export GeoJSON matching v5) */
  matchingV5Rows?: ScoutMatchingV5Row[];
  showMatchingV5Layer?: boolean;
  selectedMatchingV5Id?: string | null;
  /** Toutes les parcelles du même groupe (cross-cadastre / partage) — surbrillance carte */
  selectedMatchingV5GroupIds?: string[];
  onMatchingV5Select?: (row: ScoutMatchingV5Row) => void;
  matchingV5BuildingFeatures?: GeoJSON.Feature[];
  matchingV5SharedParcelFeatures?: GeoJSON.Feature[];
}

export function MapComponent({
  onProspectUpdate,
  centerCoordinates,
  currentProspect,
  onGetMapCenter,
  onGetMapBounds,
  onBdnbSurface,
  onBdnbInfo,
  onOsmEnrichmentChange,
  onViewBoundsChange,
  matchingV5Rows = [],
  showMatchingV5Layer = false,
  selectedMatchingV5Id = null,
  selectedMatchingV5GroupIds = [],
  onMatchingV5Select,
  matchingV5BuildingFeatures = [],
  matchingV5SharedParcelFeatures = [],
}: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const matchingV5PolygonsRef = useRef<google.maps.Polygon[]>([]);
  const matchingV5InfoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const matchingV5BuildingPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const matchingV5SharedParcelPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const isFocusingOnResultRef = useRef<boolean>(false);

  // Ref vers onBdnbSurface pour éviter les stale closures
  const onBdnbSurfaceRef = useRef<((surfaces: RoofSurface[] | null) => void) | undefined>(undefined);
  onBdnbSurfaceRef.current = onBdnbSurface;
  const onBdnbInfoRef = useRef<((info: { anneeConstruction: number | null; surfaceM2: number | null }) => void) | undefined>(undefined);
  onBdnbInfoRef.current = onBdnbInfo;
  const currentProspectRef = useRef<Prospect | null | undefined>(undefined);
  currentProspectRef.current = currentProspect;
  const onProspectUpdateRef = useRef(onProspectUpdate);
  onProspectUpdateRef.current = onProspectUpdate;

  // Fonction pour obtenir le centre de la carte - toujours disponible via ref
  const getMapCenterFunc = useRef<(() => AddressCoordinates | null) | null>(null);
  const getMapBoundsFunc = useRef<(() => MapBounds | null) | null>(null);

  const [, setViewBounds] = useState<MapBounds | null>(null);
  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dernière clé quantifiée (3 décimales) pour éviter setViewBounds si identique */
  const lastQuantizedKeyRef = useRef<string | null>(null);

  // Stocker le dernier centre connu comme fallback
  const lastKnownCenterRef = useRef<AddressCoordinates | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Vérifier que Google Maps est chargé
    if (!window.google || !window.google.maps || !window.google.maps.Map) {
      console.error("Google Maps API n'est pas disponible");
      return;
    }

    // Référence locale pour TypeScript
    const maps = window.google.maps;

    try {
      // Charger la position sauvegardée si centerCoordinates n'est pas fourni
      const savedPosition = loadMapPosition();
      const defaultPosition = savedPosition || getDefaultMapPosition();
      const initialCenter = centerCoordinates || defaultPosition.center;
      const initialZoom = defaultPosition.zoom || 16;
      
      // Initialiser la carte Google Maps avec gestion d'erreur
      // Configuration pour afficher les établissements nativement
      // Utiliser la position sauvegardée ou celle fournie en props
      const map = new maps.Map(mapRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        mapTypeId: maps.MapTypeId.HYBRID, // Satellite + POI et libellés (EEA : JS API uniquement)
        disableDefaultUI: true, // Désactive tous les contrôles par défaut (zoom, type de carte, etc.)
        zoomControl: true, // Réactive +/- malgré disableDefaultUI
        gestureHandling: "greedy", // Capte la molette pour zoomer directement dans la carte
        scrollwheel: true,
        // Activer l'affichage des établissements (POI) nativement
        clickableIcons: true, // Permet de cliquer sur les établissements natifs
        styles: [], // Styles par défaut pour voir les POI natifs
      });

      // Écouter les erreurs de la carte
      maps.event.addListenerOnce(map, "error", () => {
        console.error("Erreur lors de l'initialisation de la carte Google Maps");
      });

      mapInstanceRef.current = map;

      // Stocker le centre initial de la carte comme fallback
      lastKnownCenterRef.current = initialCenter;
      
      // Créer et stocker la fonction pour obtenir le centre de la carte
      // Cette fonction essaie d'abord getCenter(), puis utilise le dernier centre connu comme fallback
      const getCenter = () => {
        if (!mapInstanceRef.current) {
          const fallback = lastKnownCenterRef.current || initialCenter;
          return fallback;
        }
        
        try {
          // TOUJOURS essayer d'obtenir le centre actuel de la carte en premier
          const center = mapInstanceRef.current.getCenter();
          
          if (center) {
            const lat = center.lat();
            const lng = center.lng();
            
            // Vérifier que les coordonnées sont valides (pas NaN)
            if (!isNaN(lat) && !isNaN(lng)) {
              const coordinates = { lat, lng };
              // Mettre à jour le dernier centre connu avec le centre ACTUEL
              lastKnownCenterRef.current = coordinates;
              return coordinates;
            } else {
              const fallback = lastKnownCenterRef.current || initialCenter;
              return fallback;
            }
          } else {
            // Si getCenter() retourne null, utiliser le dernier centre connu
            const fallback = lastKnownCenterRef.current || initialCenter;
            return fallback;
          }
        } catch (error) {
          console.error("[MapComponent] Erreur lors de l'appel à getCenter():", error);
          const fallback = lastKnownCenterRef.current || initialCenter;
          return fallback;
        }
      };
      
      getMapCenterFunc.current = getCenter;

      const getBounds = (): MapBounds | null => {
        if (!mapInstanceRef.current) return null;
        const bounds = mapInstanceRef.current.getBounds();
        if (!bounds) return null;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        if (!ne || !sw) return null;
        const latNe = ne.lat();
        const lngNe = ne.lng();
        const latSw = sw.lat();
        const lngSw = sw.lng();
        if (!Number.isFinite(latNe) || !Number.isFinite(lngNe) || !Number.isFinite(latSw) || !Number.isFinite(lngSw)) return null;
        return { ne: { lat: latNe, lng: lngNe }, sw: { lat: latSw, lng: lngSw } };
      };
      getMapBoundsFunc.current = getBounds;
      
      if (onGetMapCenter) {
        if (typeof getCenter === 'function') {
          onGetMapCenter(getCenter);
        } else {
          console.error("[MapComponent] ERREUR: getCenter n'est pas une fonction!", typeof getCenter);
        }
      }
      
      // Fonction helper pour mettre à jour le dernier centre connu
      const updateLastKnownCenter = () => {
        if (mapInstanceRef.current) {
          try {
            const center = mapInstanceRef.current.getCenter();
            if (center) {
              const lat = center.lat();
              const lng = center.lng();
              if (!isNaN(lat) && !isNaN(lng)) {
                const newCenter = { lat, lng };
                // Ne mettre à jour que si le centre a vraiment changé (éviter les micro-mouvements)
                if (!lastKnownCenterRef.current || 
                    Math.abs(lastKnownCenterRef.current.lat - lat) > 0.00001 ||
                    Math.abs(lastKnownCenterRef.current.lng - lng) > 0.00001) {
                  lastKnownCenterRef.current = newCenter;
                }
              }
            }
          } catch (error) {
            console.error("[MapCenter] Erreur lors de la mise à jour du centre:", error);
          }
        }
      };
      
      // Sauvegarder la position quand la carte bouge
      const savePosition = () => {
        if (mapInstanceRef.current) {
          try {
            const center = mapInstanceRef.current.getCenter();
            const zoom = mapInstanceRef.current.getZoom();
            if (center) {
              const lat = center.lat();
              const lng = center.lng();
              if (!isNaN(lat) && !isNaN(lng)) {
                saveMapPosition({ lat, lng }, zoom || undefined);
              }
            }
          } catch (error) {
            console.error("[MapComponent] Erreur lors de la sauvegarde de la position:", error);
          }
        }
      };
      
      // Écouter les changements de centre pour mettre à jour le dernier centre connu et sauvegarder
      maps.event.addListener(map, "center_changed", () => {
        updateLastKnownCenter();
      });
      
      // Écouter l'événement "idle" (carte prête après mouvement) pour s'assurer que le centre est à jour et sauvegarder
      maps.event.addListener(map, "idle", () => {
        updateLastKnownCenter();
        savePosition();

        // Mise à jour des bounds viewport (debounce 600ms)
        if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
        boundsDebounceRef.current = setTimeout(() => {
          const bounds = map.getBounds();
          if (bounds) {
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const latSw = sw?.lat?.() ?? NaN;
            const lngSw = sw?.lng?.() ?? NaN;
            const latNe = ne?.lat?.() ?? NaN;
            const lngNe = ne?.lng?.() ?? NaN;
            const valid =
              typeof latSw === "number" &&
              typeof lngSw === "number" &&
              typeof latNe === "number" &&
              typeof lngNe === "number" &&
              !isNaN(latSw) &&
              !isNaN(lngSw) &&
              !isNaN(latNe) &&
              !isNaN(lngNe);
            if (!valid) {
              boundsDebounceRef.current = null;
              return;
            }
            const q = (n: number) => Math.round(n * 1e2) / 1e2;
            const key = `${q(latSw)},${q(lngSw)},${q(latNe)},${q(lngNe)}`;
            if (lastQuantizedKeyRef.current !== key) {
              lastQuantizedKeyRef.current = key;
              const nextBounds = {
                ne: { lat: latNe, lng: lngNe },
                sw: { lat: latSw, lng: lngSw },
              };
              setViewBounds(nextBounds);
              onViewBoundsChange?.(nextBounds);
            }
          } else {
            if (lastQuantizedKeyRef.current !== null) {
              lastQuantizedKeyRef.current = null;
              setViewBounds(null);
              onViewBoundsChange?.(null);
            }
          }
          boundsDebounceRef.current = null;
        }, 600);
      });

      // Écouter une première fois "idle" pour l'initialisation
      maps.event.addListenerOnce(map, "idle", () => {
        updateLastKnownCenter();
        savePosition(); // Sauvegarder la position initiale
      });

      // Google Maps affiche déjà nativement les établissements (restaurants, magasins, etc.)
      // sur la carte en mode roadmap - pas besoin de marqueurs custom
      // PlacesService (legacy) n'est plus dispo pour les nouveaux clients Google (depuis mars 2025)
      // On utilise uniquement getPlaceDetailsNew (Place API) pour les détails au clic
      let placesService: google.maps.places.PlacesService | null = null;
      try {
        if (maps.places?.PlacesService) {
          placesService = new maps.places.PlacesService(map);
        }
      } catch {
        // PlacesService indisponible (nouveau client Google) - on utilise uniquement Place API
      }
      
      // Construire un prospect à partir des détails (ancienne API)
      const buildProspectFromLegacyDetails = (
        placeIdParam: string,
        placeDetails: google.maps.places.PlaceResult,
        coordinates: AddressCoordinates,
        address?: string
      ): Prospect | null => {
        const genericTypes = new Set([
          "establishment", "point_of_interest", "locality", "political",
          "geocode", "route", "street_address", "premise", "subpremise",
          "administrative_area_level_1", "administrative_area_level_2",
          "country", "postal_code", "neighborhood", "sublocality",
        ]);
        const findSpecificType = (types: string[]) =>
          types.find((t) => !genericTypes.has(t)) || types[0] || "other";
        const googleTypes = placeDetails.types || [];
        const googlePlaceType = findSpecificType(googleTypes);
        let finalCoordinates = coordinates;
        if (placeDetails.geometry?.location) {
          finalCoordinates = {
            lat: placeDetails.geometry.location.lat(),
            lng: placeDetails.geometry.location.lng(),
          };
        }
        const prospectAddress = placeDetails.formatted_address || address || "";
        if (!prospectAddress) return null;
        const prospect: Prospect = {
          name: placeDetails.name || undefined,
          address: prospectAddress,
          coordinates: finalCoordinates,
          roofSurface: { area: 0, polygon: [] },
          placeType: googlePlaceType,
          placeId: placeIdParam,
          qualityScore: calculateQualityScore(0, convertPlaceType(googleTypes)),
          contact: extractContact(placeDetails),
        };
        const savedSurfaces = loadProspectSurfaces(prospect);
        if (savedSurfaces.length > 0) {
          const totalArea = savedSurfaces.reduce((sum, s) => sum + s.area, 0);
          prospect.roofSurfaces = savedSurfaces;
          prospect.roofSurface = savedSurfaces[savedSurfaces.length - 1] || { area: 0, polygon: [] };
          prospect.qualityScore = calculateQualityScore(totalArea, convertPlaceType(googleTypes));
        }
        return prospect;
      };

      const fetchFromGoogle = (
        placeId: string,
        coordinates: AddressCoordinates,
        address?: string
      ): Promise<Prospect | null> => {
        return getPlaceDetailsNew(placeId)
          .then((newPlaceDetails) => {
            if (newPlaceDetails?.primaryTypeDisplayName || newPlaceDetails?.primaryType) {
              const placeType = (newPlaceDetails.primaryType ?? newPlaceDetails.types?.find((t) => !["establishment", "point_of_interest"].includes(t))) ?? "other";
              const prospectAddress = newPlaceDetails.formattedAddress || address || "";
              if (!prospectAddress) return null;
              const prospect: Prospect = {
                name: newPlaceDetails.displayName || undefined,
                address: prospectAddress,
                coordinates: coordinates,
                roofSurface: { area: 0, polygon: [] },
                placeType,
                placeId,
                qualityScore: calculateQualityScore(0, placeType),
                contact: {
                  websiteUri: newPlaceDetails.websiteURI || undefined,
                  nationalPhoneNumber: newPlaceDetails.nationalPhoneNumber || undefined,
                  internationalPhoneNumber: newPlaceDetails.internationalPhoneNumber || undefined,
                },
              };
              const savedSurfaces = loadProspectSurfaces(prospect);
              if (savedSurfaces.length > 0) {
                const totalArea = savedSurfaces.reduce((sum, s) => sum + s.area, 0);
                prospect.roofSurfaces = savedSurfaces;
                prospect.roofSurface = savedSurfaces[savedSurfaces.length - 1] || { area: 0, polygon: [] };
                prospect.qualityScore = calculateQualityScore(totalArea, placeType);
              }
              return prospect;
            }
            if (placesService) {
              return new Promise<Prospect | null>((resolve) => {
                placesService!.getDetails(
                  {
                    placeId,
                    fields: ["name", "types", "formatted_address", "geometry", "website", "formatted_phone_number", "international_phone_number"],
                  },
                  (placeDetails, detailsStatus) => {
                    if (detailsStatus === "OK" && placeDetails) {
                      resolve(buildProspectFromLegacyDetails(placeId, placeDetails, coordinates, address));
                    } else {
                      resolve(null);
                    }
                  }
                );
              });
            }
            return null;
          })
          .catch(() => {
            if (placesService) {
              return new Promise<Prospect | null>((resolve) => {
                placesService!.getDetails(
                  {
                    placeId,
                    fields: ["name", "types", "formatted_address", "geometry", "website", "formatted_phone_number", "international_phone_number"],
                  },
                  (placeDetails, detailsStatus) => {
                    if (detailsStatus === "OK" && placeDetails) {
                      resolve(buildProspectFromLegacyDetails(placeId, placeDetails, coordinates, address));
                    } else {
                      resolve(null);
                    }
                  }
                );
              });
            }
            return null;
          });
      };

      // Traiter les détails d'un lieu : récupérer Google puis vérifier le pipeline avec nom + adresse (éviter le mauvais lieu si même nom)
      const processPlaceDetails = (
        placeId: string,
        coordinates: AddressCoordinates,
        address?: string
      ) => {
        fetchFromGoogle(placeId, coordinates, address)
          .then((prospect) => {
            if (!prospect) return;
            getProspectByPlaceId(placeId, { name: prospect.name, address: prospect.address })
              .then((existing) => onProspectUpdate(existing ?? prospect));
          })
          .catch(() => {
            fetchFromGoogle(placeId, coordinates, address).then((prospect) => {
              if (prospect) onProspectUpdate(prospect);
            });
          });
      };
      
      maps.event.addListener(map, "click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
        if (!event.latLng) return;

        const clickCoords: AddressCoordinates = {
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        };

        // Clic sur POI Google : mise à jour du prospect si drawer ouvert, sinon création via Places
        const placeId = (event as any).placeId;
        if (placeId) {
          if (event.stop) event.stop();

          const prospect = currentProspectRef.current;
          if (prospect) {
            // Drawer ouvert : mettre à jour name + address du prospect
            getPlaceDetailsNew(placeId).then((details) => {
              if (!details) return;
              const name = details.displayName ?? prospect.name;
              const address = details.formattedAddress ?? prospect.address ?? "";
              onProspectUpdateRef.current({
                ...prospect,
                name: name ?? undefined,
                address: address || prospect.address,
              });
            });
          } else {
            processPlaceDetails(placeId, clickCoords);
          }
        }
      });

      return () => {
        if (boundsDebounceRef.current) {
          clearTimeout(boundsDebounceRef.current);
          boundsDebounceRef.current = null;
        }
        if (mapInstanceRef.current) {
          maps.event.clearInstanceListeners(mapInstanceRef.current);
        }
      };
    } catch (error) {
      console.error("Erreur lors de l'initialisation de Google Maps:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Ne s'exécute qu'une seule fois au montage

  // Exposer les fonctions pour obtenir le centre et les bounds de la carte
  useEffect(() => {
    if (onGetMapCenter && getMapCenterFunc.current) {
      if (typeof getMapCenterFunc.current === 'function') {
        onGetMapCenter(getMapCenterFunc.current);
      } else {
        console.error("[MapComponent] ERREUR: getMapCenterFunc.current n'est pas une fonction!", typeof getMapCenterFunc.current);
      }
    }
    if (onGetMapBounds && getMapBoundsFunc.current) {
      if (typeof getMapBoundsFunc.current === 'function') {
        onGetMapBounds(getMapBoundsFunc.current);
      }
    }
  }, [onGetMapCenter, onGetMapBounds]);

  // Référence pour stocker tous les polygones affichés
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  // Lignes de direction : Sud et orientation du toit
  const directionLinesRef = useRef<google.maps.Polyline[]>([]);

  // Afficher tous les polygones existants du prospect + lignes Sud / orientation
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;
    const LENGTH_M = 12; // longueur des traits en mètres

    // Nettoyer tous les polygones existants
    polygonsRef.current.forEach(polygon => {
      polygon.setMap(null);
    });
    polygonsRef.current = [];

    // Nettoyer les lignes de direction
    directionLinesRef.current.forEach(line => line.setMap(null));
    directionLinesRef.current = [];

    // Récupérer toutes les surfaces
    const surfaces = currentProspect?.roofSurfaces || 
      (currentProspect && currentProspect.roofSurface && (currentProspect.roofSurface.area ?? 0) > 0 ? [currentProspect.roofSurface] : []);

    if (surfaces.length === 0) {
      return;
    }

    const arrowIcon = {
      path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 2.5,
      fillColor: "#fff",
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 1,
    };

    // Créer un polygone pour chaque surface + traits Sud et orientation
    surfaces.forEach((surface, index) => {
      if (!surface.polygon || surface.polygon.length === 0) {
        return;
      }

      const polygon = new maps.Polygon({
        paths: surface.polygon,
        fillColor: BRAND_LIME,
        fillOpacity: 0.35,
        strokeWeight: 2,
        strokeColor: BRAND_LIME_HOVER,
        clickable: false,
        editable: false,
        zIndex: 1,
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);

      const center = calculatePolygonCenter(surface.polygon);

      // Trait direction Sud (cap 180°) — rouge
      const southPoint = pointAtBearing(center, 180, LENGTH_M);
      const southLine = new maps.Polyline({
        path: [
          { lat: center.lat, lng: center.lng },
          { lat: southPoint.lat, lng: southPoint.lng },
        ],
        strokeColor: "#DC2626",
        strokeOpacity: 1,
        strokeWeight: 3,
        icons: [{ icon: { ...arrowIcon, strokeColor: "#DC2626", fillColor: "#DC2626" }, offset: "100%" }],
        map: mapInstanceRef.current,
        zIndex: 2,
      });
      directionLinesRef.current.push(southLine);

      // Perp. 1 = perpendiculaire au plus long côté (orientation toit). Perp. 2 = perpendiculaire de Perp. 1 = direction du côté le plus long
      if (surface.orientation != null) {
        const bearing1 = 180 + surface.orientation;
        const orientationPoint1 = pointAtBearing(center, bearing1, LENGTH_M);
        const orientationLine1 = new maps.Polyline({
          path: [
            { lat: center.lat, lng: center.lng },
            { lat: orientationPoint1.lat, lng: orientationPoint1.lng },
          ],
          strokeColor: "#2563EB",
          strokeOpacity: 1,
          strokeWeight: 3,
          icons: [{ icon: { ...arrowIcon, strokeColor: "#2563EB", fillColor: "#2563EB" }, offset: "100%" }],
          map: mapInstanceRef.current,
          zIndex: 2,
        });
        directionLinesRef.current.push(orientationLine1);

        // Direction du côté le plus long : deux sens possibles (orientation ± 90°)
        let azimuthCote1 = surface.orientation + 90;
        if (azimuthCote1 > 180) azimuthCote1 -= 360;
        if (azimuthCote1 < -180) azimuthCote1 += 360;
        
        let azimuthCote2 = surface.orientation - 90;
        if (azimuthCote2 > 180) azimuthCote2 -= 360;
        if (azimuthCote2 < -180) azimuthCote2 += 360;
        
        // Retenir celle avec l'angle le plus faible (plus proche du Sud)
        const azimuthLongestSide = Math.abs(azimuthCote1) < Math.abs(azimuthCote2) ? azimuthCote1 : azimuthCote2;
        
        // Dessiner les deux flèches du côté dans les deux sens opposés
        const bearing2 = 180 + azimuthLongestSide;
        const bearing2Opposite = (bearing2 + 180) % 360;
        
        // Flèche sens 1
        const orientationPoint2 = pointAtBearing(center, bearing2, LENGTH_M);
        const orientationLine2 = new maps.Polyline({
          path: [
            { lat: center.lat, lng: center.lng },
            { lat: orientationPoint2.lat, lng: orientationPoint2.lng },
          ],
          strokeColor: "#0D9488",
          strokeOpacity: 1,
          strokeWeight: 3,
          icons: [{ icon: { ...arrowIcon, strokeColor: "#0D9488", fillColor: "#0D9488" }, offset: "100%" }],
          map: mapInstanceRef.current,
          zIndex: 2,
        });
        directionLinesRef.current.push(orientationLine2);
        
        // Flèche sens opposé
        const orientationPoint2Opposite = pointAtBearing(center, bearing2Opposite, LENGTH_M);
        const orientationLine2Opposite = new maps.Polyline({
          path: [
            { lat: center.lat, lng: center.lng },
            { lat: orientationPoint2Opposite.lat, lng: orientationPoint2Opposite.lng },
          ],
          strokeColor: "#0D9488",
          strokeOpacity: 1,
          strokeWeight: 3,
          icons: [{ icon: { ...arrowIcon, strokeColor: "#0D9488", fillColor: "#0D9488" }, offset: "100%" }],
          map: mapInstanceRef.current,
          zIndex: 2,
        });
        directionLinesRef.current.push(orientationLine2Opposite);
      }
    });
  }, [currentProspect?.roofSurfaces, currentProspect?.roofSurface.polygon]);

  // Centrer la carte sur les coordonnées sélectionnées (seulement si la carte existe déjà)
  useEffect(() => {
    if (centerCoordinates && mapInstanceRef.current) {
      // Marquer qu'on est en train de se concentrer sur un résultat spécifique
      // Cela empêche l'ajustement automatique des bounds pendant le zoom
      isFocusingOnResultRef.current = true;
      
      const maps = window.google?.maps;
      if (!maps) {
        console.error("[MapComponent] ERREUR: window.google.maps n'existe pas!");
        return;
      }

      const currentCenter = mapInstanceRef.current.getCenter();
      if (!currentCenter) {
        console.error("[MapComponent] ERREUR: currentCenter est null!");
        return;
      }

      // Ne centrer que si les coordonnées sont significativement différentes
      const latDiff = Math.abs(currentCenter.lat() - centerCoordinates.lat);
      const lngDiff = Math.abs(currentCenter.lng() - centerCoordinates.lng);
      
      // Seuil de 0.0001 degré (environ 11 mètres) pour éviter les micro-mouvements
      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        // Animation fluide vers le nouveau centre avec zoom
        // Utiliser panTo pour une animation fluide, puis zoomer
        mapInstanceRef.current.panTo({
          lat: centerCoordinates.lat,
          lng: centerCoordinates.lng,
        });
        
        // Zoomer après un court délai pour une animation plus fluide
        setTimeout(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setZoom(18); // Zoom légèrement moins fort pour une meilleure vue
          }
        }, 300);
        
        // Réinitialiser le flag après un délai plus long pour permettre à l'animation de se terminer
        setTimeout(() => {
          isFocusingOnResultRef.current = false;
        }, 1500);
      } else {
        isFocusingOnResultRef.current = false;
      }
    } else {
      isFocusingOnResultRef.current = false;
    }
  }, [centerCoordinates]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    matchingV5PolygonsRef.current.forEach((poly) => poly.setMap(null));
    matchingV5PolygonsRef.current = [];
    if (matchingV5InfoWindowRef.current) {
      matchingV5InfoWindowRef.current.close();
      matchingV5InfoWindowRef.current = null;
    }

    if (!showMatchingV5Layer || matchingV5Rows.length === 0) return;

    const maps = window.google.maps;
    const infoWindow = new maps.InfoWindow();
    matchingV5InfoWindowRef.current = infoWindow;

    const groupSet =
      selectedMatchingV5GroupIds.length > 0 ? new Set(selectedMatchingV5GroupIds) : null;

    for (const row of matchingV5Rows) {
      const selected = groupSet ? groupSet.has(row.id) : row.id === selectedMatchingV5Id;
      const pathParts = geojsonPolygonToGooglePathParts(row.geometry);
      const isBuilding = row.grain === "building";
      const strokeColor = selected ? (isBuilding ? "#b45309" : "#047857") : isBuilding ? "#d97706" : "#059669";
      const fillColor = selected ? (isBuilding ? "#f59e0b" : "#10b981") : isBuilding ? "#fbbf24" : "#34d399";

      for (const rings of pathParts) {
        const poly = new maps.Polygon({
          map,
          paths: rings,
          strokeColor,
          strokeOpacity: 0.95,
          strokeWeight: selected ? 3 : 2,
          fillColor,
          fillOpacity: 0.24,
          clickable: true,
          zIndex: isBuilding ? 4 : 3,
        });
        poly.addListener("click", () => {
          onMatchingV5Select?.(row);
          const centerBounds = new maps.LatLngBounds();
          for (const ring of rings) {
            for (const pt of ring) centerBounds.extend(pt);
          }
          const c = centerBounds.getCenter();
          const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
          const title =
            row.grain === "building"
              ? `Multi-parcelles · ${esc(row.batimentConstructionId || row.batimentGroupeId || "—")}`
              : `Parcelle ${esc(row.section)} ${esc(row.numeroNorm)}`;
          const sub =
            row.grain === "parcelle"
              ? `${esc(row.statusMetier || "none")} · ${row.siretCount} SIRET · ${row.nbBatiments} bât. · ${Math.round(
                  row.footprintSumM2
                )} m²${
                  row.passerelleAddress ? ` · ${esc(row.passerelleAddress)}` : ""
                }`
              : "Voir panneau pour détail par parcelle";
          infoWindow.setContent(
            `<div style="font-size:12px;max-width:260px;padding:4px;line-height:1.35">
              <div style="font-weight:600;margin-bottom:4px">${title}</div>
              <div style="font-size:11px;color:#444">${sub}</div>
            </div>`
          );
          infoWindow.setPosition(c);
          infoWindow.open({ map, anchor: poly });
        });
        matchingV5PolygonsRef.current.push(poly);
      }
    }

    return () => {
      matchingV5PolygonsRef.current.forEach((poly) => poly.setMap(null));
      matchingV5PolygonsRef.current = [];
      if (matchingV5InfoWindowRef.current) {
        matchingV5InfoWindowRef.current.close();
        matchingV5InfoWindowRef.current = null;
      }
    };
  }, [
    matchingV5Rows,
    showMatchingV5Layer,
    selectedMatchingV5Id,
    selectedMatchingV5GroupIds,
    onMatchingV5Select,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    matchingV5BuildingPolygonsRef.current.forEach((poly) => poly.setMap(null));
    matchingV5BuildingPolygonsRef.current = [];

    if (!showMatchingV5Layer || matchingV5BuildingFeatures.length === 0) return;

    const maps = window.google.maps;
    for (const feat of matchingV5BuildingFeatures) {
      const g = feat.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      const pathParts = geojsonPolygonToGooglePathParts(g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      for (const rings of pathParts) {
        const poly = new maps.Polygon({
          map,
          paths: rings,
          strokeColor: "#0ea5e9",
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: "#38bdf8",
          fillOpacity: 0.14,
          clickable: false,
          zIndex: 6,
        });
        matchingV5BuildingPolygonsRef.current.push(poly);
      }
    }

    return () => {
      matchingV5BuildingPolygonsRef.current.forEach((poly) => poly.setMap(null));
      matchingV5BuildingPolygonsRef.current = [];
    };
  }, [matchingV5BuildingFeatures, showMatchingV5Layer]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    matchingV5SharedParcelPolygonsRef.current.forEach((poly) => poly.setMap(null));
    matchingV5SharedParcelPolygonsRef.current = [];

    if (!showMatchingV5Layer || matchingV5SharedParcelFeatures.length === 0) return;

    const maps = window.google.maps;
    for (const feat of matchingV5SharedParcelFeatures) {
      const g = feat.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      const pathParts = geojsonPolygonToGooglePathParts(g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      for (const rings of pathParts) {
        const poly = new maps.Polygon({
          map,
          paths: rings,
          strokeColor: "#7c3aed",
          strokeOpacity: 0.95,
          strokeWeight: 3,
          fillColor: "#8b5cf6",
          fillOpacity: 0.06,
          clickable: false,
          zIndex: 7,
        });
        matchingV5SharedParcelPolygonsRef.current.push(poly);
      }
    }

    return () => {
      matchingV5SharedParcelPolygonsRef.current.forEach((poly) => poly.setMap(null));
      matchingV5SharedParcelPolygonsRef.current = [];
    };
  }, [matchingV5SharedParcelFeatures, showMatchingV5Layer]);

  const hasSurfaces =
    (currentProspect?.roofSurfaces?.length ?? 0) > 0 ||
    (currentProspect?.roofSurface?.polygon?.length ?? 0) > 0;

  return (
    <div className="absolute inset-0 h-full min-h-[70vh]">
      <div ref={mapRef} className="absolute inset-0 h-full w-full min-h-[70vh]" />

      {hasSurfaces && false && (
        <div className="absolute bottom-3 left-3 z-100 pointer-events-none flex flex-col gap-1 rounded-lg bg-white/95 border border-gray-200 px-2 py-1.5 shadow-sm text-xs">
          <span className="flex items-center gap-2">
            <span className="w-4 h-0.5 rounded bg-[#DC2626]" style={{ minWidth: 12 }} />
            Sud
          </span>
          <span className="flex items-center gap-2">
            <span className="w-4 h-0.5 rounded bg-[#2563EB]" style={{ minWidth: 12 }} />
            Perp. (orientation toit)
          </span>
        </div>
      )}
    </div>
  );
}

// Fonction pour calculer le centre d'un polygone
function calculatePolygonCenter(
  coordinates: Array<{ lat: number; lng: number }>
): AddressCoordinates {
  let latSum = 0;
  let lngSum = 0;

  coordinates.forEach((coord) => {
    latSum += coord.lat;
    lngSum += coord.lng;
  });

  return {
    lat: latSum / coordinates.length,
    lng: lngSum / coordinates.length,
  };
}

/** Retourne un point à `distanceMeters` mètres du `center` dans la direction du cap (bearing en degrés, 0 = Nord, 90 = Est, 180 = Sud). */
function pointAtBearing(
  center: { lat: number; lng: number },
  bearingDeg: number,
  distanceMeters: number
): { lat: number; lng: number } {
  const R = 6371000; // rayon Terre en m
  const br = (bearingDeg * Math.PI) / 180;
  const latRad = (center.lat * Math.PI) / 180;
  const d = distanceMeters / R;
  const lat2 = Math.asin(
    Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(br)
  );
  const lng2 =
    center.lng +
    (180 / Math.PI) *
      Math.atan2(
        Math.sin(br) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2)
      );
  return {
    lat: (lat2 * 180) / Math.PI,
    lng: lng2,
  };
}


// Fonction pour calculer le quality score
function calculateQualityScore(
  area: number,
  placeType: string
): number {
  let score = 0;

  // Score basé sur la surface (max 40 points)
  if (area > 1000) score += 40;
  else if (area > 500) score += 35;
  else if (area > 200) score += 30;
  else if (area > 100) score += 20;
  else if (area > 0) score += 10;
  // Si area = 0, pas de points pour la surface

  // Score basé sur le type de lieu (max 30 points)
  const energyIntensiveTypes = ["warehouse", "supermarket", "industrial"];
  if (energyIntensiveTypes.includes(placeType)) {
    score += 30;
  } else if (placeType === "retail" || placeType === "office") {
    score += 20;
  } else {
    score += 10;
  }


  return Math.min(100, score);
}
