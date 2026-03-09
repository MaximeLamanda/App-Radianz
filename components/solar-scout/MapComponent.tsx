"use client";

import { useEffect, useRef, useState } from "react";
import { useOsmBuildings, type MapBounds, type OsmBuildingDisplay } from "@/lib/swr-hooks";
import { fetchWithAuth } from "@/lib/api-client";
import { loadProspectSurfaces } from "@/lib/prospect-storage";
import { getProspectByPlaceId } from "@/lib/firestore";
import { loadMapPosition, saveMapPosition, getDefaultMapPosition } from "@/lib/map-position-storage";
import type { Prospect, AddressCoordinates, RoofSurface, Contact, PlaceType, Exposure, PlaceSearchResult } from "@/types";

/** Overlay Google Maps : bouton "Valider" ancré à une position lat/lng sur la carte */
function createValidationButtonOverlay() {
  if (typeof window === "undefined" || !window.google?.maps) {
    return null;
  }

  class ValidationButtonOverlay extends window.google.maps.OverlayView {
    private position: google.maps.LatLng;
    private onClick: () => void;
    private div: HTMLDivElement | null = null;

    constructor(position: google.maps.LatLng, onClick: () => void) {
      super();
      this.position = position;
      this.onClick = onClick;
    }

    onAdd() {
      this.div = document.createElement("div");
      this.div.style.cssText =
        "position:absolute;z-index:100;transform:translate(-50%,-50%);pointer-events:auto;";
      const btn = document.createElement("button");
      btn.textContent = "Valider";
      btn.type = "button";
      btn.style.cssText =
        "padding:8px 14px;font-size:13px;font-weight:600;color:#fff;background:#4285F4;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);white-space:nowrap;";
      btn.onclick = (e) => {
        e.stopPropagation();
        this.onClick();
      };
      this.div.appendChild(btn);
      const panes = this.getPanes();
      if (panes) panes.overlayMouseTarget.appendChild(this.div);
    }

    draw() {
      if (!this.div || !this.position) return;
      const proj = this.getProjection();
      if (!proj) return;
      const point = proj.fromLatLngToDivPixel(this.position);
      if (point) {
        this.div.style.left = String(point.x) + "px";
        this.div.style.top = String(point.y) + "px";
      }
    }

    onRemove() {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  }

  return ValidationButtonOverlay;
}
import { convertPlaceType, extractContact } from "@/lib/places";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import { searchPoiForPolygon, findNearestOsmBuildingToPoint } from "@/lib/poi-near-polygon";
import { toast } from "sonner";

interface MapComponentProps {
  onProspectUpdate: (prospect: Prospect | null) => void;
  isDrawing: boolean;
  onDrawingChange: (isDrawing: boolean) => void;
  centerCoordinates?: AddressCoordinates | null;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }>; orientation?: number }) => void;
  currentProspect?: Prospect | null;
  shouldValidateDrawing?: boolean;
  onValidationComplete?: () => void;
  onValidateDrawing?: () => void;
  searchResults?: PlaceSearchResult[];
  onSearchResultClick?: (result: PlaceSearchResult) => void;
  onGetMapCenter?: (getCenterFunc: () => AddressCoordinates | null) => void;
  onGetMapBounds?: (getBoundsFunc: () => MapBounds | null) => void;
  onBdnbSurface?: (surfaces: RoofSurface[] | null) => void;
  /** Appelé quand les infos BDNB (année, surface) sont disponibles ou réinitialisées */
  onBdnbInfo?: (info: { anneeConstruction: number | null; surfaceM2: number | null }) => void;
  /** Bounds pour charger les bâtiments OSM (uniquement au clic sur le bouton) */
  osmBoundsToFetch?: MapBounds | null;
  /** Appelé au clic sur un polygone OSM pour quitter la vue recherche (vider les résultats) */
  onOsmPolygonClick?: () => void;
  /** Appelé au début/fin de l'enrichissement OSM (geocode + BDNB + POI) pour afficher le loading */
  onOsmEnrichmentChange?: (enriching: boolean) => void;
}

export function MapComponent({
  onProspectUpdate,
  isDrawing,
  onDrawingChange,
  centerCoordinates,
  onSurfaceUpdate,
  currentProspect,
  shouldValidateDrawing = false,
  onValidationComplete,
  onValidateDrawing,
  searchResults = [],
  onSearchResultClick,
  onGetMapCenter,
  onGetMapBounds,
  onBdnbSurface,
  onBdnbInfo,
  osmBoundsToFetch = null,
  onOsmPolygonClick,
  onOsmEnrichmentChange,
}: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const searchMarkersRef = useRef<google.maps.Marker[]>([]);
  const isFocusingOnResultRef = useRef<boolean>(false);
  const [validationButtonPosition, setValidationButtonPosition] = useState<{ lat: number; lng: number } | null>(null);
  const validationOverlayRef = useRef<google.maps.OverlayView | null>(null);

  // Ref vers onBdnbSurface pour éviter les stale closures
  const onBdnbSurfaceRef = useRef<((surfaces: RoofSurface[] | null) => void) | undefined>(undefined);
  onBdnbSurfaceRef.current = onBdnbSurface;
  const onBdnbInfoRef = useRef<((info: { anneeConstruction: number | null; surfaceM2: number | null }) => void) | undefined>(undefined);
  onBdnbInfoRef.current = onBdnbInfo;
  const currentProspectRef = useRef<Prospect | null | undefined>(undefined);
  currentProspectRef.current = currentProspect;

  // Fonction pour obtenir le centre de la carte - toujours disponible via ref
  const getMapCenterFunc = useRef<(() => AddressCoordinates | null) | null>(null);
  const getMapBoundsFunc = useRef<(() => MapBounds | null) | null>(null);

  // Bounds viewport pour bâtiments OSM (zoom >= 16)
  const [viewBounds, setViewBounds] = useState<MapBounds | null>(null);
  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dernière clé quantifiée (3 décimales) pour éviter setViewBounds si identique → moins de refetch OSM */
  const lastQuantizedKeyRef = useRef<string | null>(null);

  // Hook SWR pour les bâtiments OSM : chargement UNIQUEMENT au clic sur le bouton (bounds figés)
  const { data: osmBuildings = [] } = useOsmBuildings(osmBoundsToFetch ?? null);
  const osmBuildingsRef = useRef<typeof osmBuildings>([]);
  osmBuildingsRef.current = osmBuildings;

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
        const zoom = mapInstanceRef.current.getZoom() ?? 0;
        if (!bounds || zoom < 16) return null;
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

        // Mise à jour des bounds pour bâtiments OSM (debounce 600ms)
        if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
        boundsDebounceRef.current = setTimeout(() => {
          const bounds = map.getBounds();
          const zoom = map.getZoom() ?? 0;
          if (zoom >= 16 && bounds) {
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
              setViewBounds({
                ne: { lat: latNe, lng: lngNe },
                sw: { lat: latSw, lng: lngSw },
              });
            }
          } else {
            if (lastQuantizedKeyRef.current !== null) {
              lastQuantizedKeyRef.current = null;
              setViewBounds(null);
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

        // Clic carte vide : ne rien faire (prospect créé uniquement via clic sur polygone OSM)
        // Clic sur POI Google : mise à jour du prospect si drawer ouvert, sinon nouveau prospect
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
            // POI cliqué : chercher le polygone OSM le plus proche (si analysé)
            const buildings = osmBuildingsRef.current;
            const nearest = buildings.length > 0 ? findNearestOsmBuildingToPoint(clickCoords, buildings) : null;
            if (nearest) {
              handleOsmPolygonClick(nearest);
            } else {
              processPlaceDetails(placeId, clickCoords);
            }
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

  // Gérer le mode dessin
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;

    if (isDrawing) {
      // Masquer le bouton Valider quand on réactive le mode dessin
      setValidationButtonPosition(null);
      // Activer le mode dessin
      if (!drawingManagerRef.current && maps.drawing && maps.drawing.DrawingManager) {
        const drawingManager = new maps.drawing.DrawingManager({
          drawingMode: maps.drawing.OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
            fillColor: "#E4FE55",
            fillOpacity: 0.35,
            strokeWeight: 2,
            strokeColor: "#E4FE55",
            clickable: false,
            editable: true,
            zIndex: 1,
          },
        });

        drawingManager.setMap(mapInstanceRef.current);
        drawingManagerRef.current = drawingManager;

        // Écouter la fin du dessin d'un polygone
        maps.event.addListener(drawingManager, "polygoncomplete", (polygon: google.maps.Polygon) => {
          // Supprimer l'ancien polygone s'il existe
          if (polygonRef.current) {
            polygonRef.current.setMap(null);
          }

          polygonRef.current = polygon;
          polygon.setEditable(true);
          polygon.setDraggable(false);

          // Extraire les coordonnées pour log détaillé
          const path = polygon.getPath();
          const pointCount = path.getLength();
          const coordinates: Array<{ lat: number; lng: number }> = [];
          
          path.forEach((latLng, index) => {
            const coord = {
              lat: latLng.lat(),
              lng: latLng.lng(),
            };
            coordinates.push(coord);
          });
          
          // Calculer l'aire pour prévisualisation
          const previewArea = calculatePolygonArea(coordinates);
          
          // Écouter les modifications du polygone pendant l'édition
          maps.event.addListener(path, "insert_at", () => {
            // Point ajouté - pas besoin de log
          });
          
          maps.event.addListener(path, "remove_at", () => {
            // Point supprimé - pas besoin de log
          });
          
          maps.event.addListener(path, "set_at", () => {
            // Point modifié - pas besoin de log
          });

          // Désactiver le mode dessin après création
          drawingManager.setDrawingMode(null);

          // Afficher le bouton Valider à côté du premier point (dernier point posé quand on ferme le polygone)
          if (path.getLength() > 0) {
            const firstPoint = path.getAt(0);
            setValidationButtonPosition({ lat: firstPoint.lat(), lng: firstPoint.lng() });
          }
        });
        
        // Écouter le début du dessin
        maps.event.addListener(drawingManager, "overlaycomplete", (event: any) => {
          console.log("[Surface] 🎨 Début du dessin d'un overlay:", event.type);
        });
        
        // Écouter les modifications du polygone pendant le dessin
        if (drawingManagerRef.current) {
          maps.event.addListener(drawingManager, "drawingmode_changed", () => {
            const currentMode = drawingManager.getDrawingMode();
            console.log("[Surface] 🖊️ Mode de dessin changé:", currentMode);
          });
        }
      } else if (drawingManagerRef.current) {
        // Réactiver le mode dessin si le manager existe déjà
        drawingManagerRef.current.setDrawingMode(maps.drawing.OverlayType.POLYGON);
      }
    } else {
      // Désactiver le mode dessin
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setDrawingMode(null);
      }
    }
  }, [isDrawing]);

  // Valider le dessin quand isDrawing passe à false et qu'un polygone existe
  useEffect(() => {
    if (!isDrawing && polygonRef.current) {
      if (shouldValidateDrawing && onSurfaceUpdate) {
        const polygon = polygonRef.current;
        const path = polygon.getPath();
        const coordinates: Array<{ lat: number; lng: number }> = [];
        
        path.forEach((latLng) => {
          coordinates.push({
            lat: latLng.lat(),
            lng: latLng.lng(),
          });
        });

        console.log(`[Surface] 📍 Coordonnées extraites: ${coordinates.length} points`);
        console.log(`[Surface] 📐 Détail des coordonnées du polygone:`, coordinates.map((c, i) => 
          `Point ${i + 1}: [${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}]`
        ).join(', '));
        
        const area = calculatePolygonArea(coordinates);
        const orientation = calculatePolygonOrientation(coordinates);
        console.log(`[Surface] 📏 Surface calculée: ${area.toFixed(2)} m²`);
        if (orientation != null) {
          console.log(`[Surface] 🧭 Orientation calculée: ${orientation.toFixed(1)}° (0=Sud, 90=Ouest, -90=Est)`);
        }

        if (area > 0) {
          console.log("[Surface] ✅ Mise à jour du prospect avec la nouvelle surface");
          console.log(`[Surface] 📊 Données de la surface:`, {
            area: area.toFixed(2) + " m²",
            orientation: orientation != null ? `${orientation.toFixed(1)}°` : "non calculée",
            pointCount: coordinates.length,
            firstPoint: coordinates[0],
            lastPoint: coordinates[coordinates.length - 1]
          });
          
          onSurfaceUpdate({
            area,
            polygon: coordinates,
            orientation,
          });

          // Garder le polygone affiché mais le rendre non éditable
          polygon.setEditable(false);
          
          // Réinitialiser le flag de validation et masquer le bouton Valider sur la carte
          setValidationButtonPosition(null);
          if (onValidationComplete) {
            onValidationComplete();
          }
        } else {
          console.warn("[Surface] Surface calculée = 0, validation annulée");
          setValidationButtonPosition(null);
          if (onValidationComplete) {
            onValidationComplete();
          }
        }
      } else if (!shouldValidateDrawing) {
        // Annulation : supprimer le polygone en cours de dessin et le bouton Valider
        setValidationButtonPosition(null);
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    }
  }, [isDrawing, shouldValidateDrawing, onSurfaceUpdate]);

  // Afficher le bouton "Valider" sur la carte à côté du dernier point du polygone
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    const ValidationButtonOverlayClass = createValidationButtonOverlay();
    if (!ValidationButtonOverlayClass) return;

    if (validationButtonPosition && onValidateDrawing && onDrawingChange) {
      const latLng = new window.google.maps.LatLng(
        validationButtonPosition.lat,
        validationButtonPosition.lng
      );
      const overlay = new ValidationButtonOverlayClass(latLng, () => {
        onValidateDrawing!();
        onDrawingChange(false);
      });
      overlay.setMap(map);
      validationOverlayRef.current = overlay;
    } else {
      if (validationOverlayRef.current) {
        validationOverlayRef.current.setMap(null);
        validationOverlayRef.current = null;
      }
    }

    return () => {
      if (validationOverlayRef.current) {
        validationOverlayRef.current.setMap(null);
        validationOverlayRef.current = null;
      }
    };
  }, [validationButtonPosition, onValidateDrawing, onDrawingChange]);

  // Polygones OSM (affichage bleu + clic)
  const osmPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const onProspectUpdateRef = useRef(onProspectUpdate);
  onProspectUpdateRef.current = onProspectUpdate;
  const osmClickIdRef = useRef(0);

  const handleOsmPolygonClick = (osmBuilding: OsmBuildingDisplay) => {
    onOsmPolygonClick?.();
    const firstSurf = osmBuilding.polygonSurfaces[0];
    if (!firstSurf?.polygon?.length || !window.google?.maps) return;

    const myClickId = ++osmClickIdRef.current;
    onOsmEnrichmentChange?.(true);

    const maps = window.google.maps;
    const centroid = calculatePolygonCenter(firstSurf.polygon);

    const geocodePromise = new Promise<string>((resolve) => {
      const geocoder = new maps.Geocoder();
      geocoder.geocode({ location: centroid }, (results, status) => {
        resolve(
          status === "OK" && results?.[0]?.formatted_address
            ? results[0].formatted_address
            : `${centroid.lat.toFixed(6)}, ${centroid.lng.toFixed(6)}`
        );
      });
    });

    const bdnbPromise = fetchWithAuth(`/api/bdnb?lat=${centroid.lat}&lng=${centroid.lng}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data?.batiment?.anneeConstruction != null ? data.batiment.anneeConstruction : undefined))
      .catch(() => undefined);

    const poiPromise = searchPoiForPolygon(centroid, firstSurf.polygon).catch(() => null);

    Promise.all([geocodePromise, bdnbPromise, poiPromise])
      .then(
        async ([address, anneeConstruction, poi]) => {
          if (myClickId !== osmClickIdRef.current) return;

          const roofSurfaces: RoofSurface[] = osmBuilding.polygonSurfaces.map((s, i) => ({
            id: `${osmBuilding.id}-${i}`,
            area: s.areaM2,
            polygon: s.polygon,
            orientation: s.orientation ?? undefined,
          }));
          const totalArea = roofSurfaces.reduce((sum, s) => sum + s.area, 0);

          let prospect: Prospect;

          if (poi?.placeId) {
            const placeDetails = await getPlaceDetailsNew(poi.placeId);
            if (myClickId !== osmClickIdRef.current) return;
            const coords = poi.coordinates ?? centroid;
            const fullAddress = placeDetails?.formattedAddress ?? address;
            const displayName = placeDetails?.displayName ?? poi.name;
            const placeType = placeDetails?.primaryTypeDisplayName ?? "other";
            const contact =
              placeDetails?.nationalPhoneNumber || placeDetails?.internationalPhoneNumber
                ? {
                    nationalPhoneNumber: placeDetails.nationalPhoneNumber ?? undefined,
                    internationalPhoneNumber: placeDetails.internationalPhoneNumber ?? undefined,
                    websiteUri: placeDetails.websiteURI ?? undefined,
                  }
                : undefined;

            prospect = {
              name: displayName,
              address: fullAddress,
              coordinates: coords,
              placeId: poi.placeId,
              roofSurface: roofSurfaces[0] ?? { area: 0, polygon: [] },
              roofSurfaces,
              placeType,
              qualityScore: totalArea > 0 ? Math.min(100, 10 + Math.floor(totalArea / 50)) : 10,
              anneeConstruction: anneeConstruction ?? undefined,
              contact,
            };
          } else {
            const finalAddress = poi?.name ?? address;
            prospect = {
              address: finalAddress,
              name: poi?.name ?? undefined,
              coordinates: centroid,
              roofSurface: roofSurfaces[0] ?? { area: 0, polygon: [] },
              roofSurfaces,
              placeType: "other",
              qualityScore: 10,
              anneeConstruction: anneeConstruction ?? undefined,
            };
          }

          onProspectUpdateRef.current(prospect);
          onBdnbSurfaceRef.current?.(roofSurfaces);
          onBdnbInfoRef.current?.({
            anneeConstruction: anneeConstruction ?? null,
            surfaceM2: totalArea,
          });
        }
      )
      .catch((err) => {
        console.error("[MapComponent] Erreur enrichissement OSM:", err);
        toast.error("Impossible de charger les informations du bâtiment");
      })
      .finally(() => {
        if (myClickId === osmClickIdRef.current) {
          onOsmEnrichmentChange?.(false);
        }
      });
  };

  // Rendre les polygones OSM (bleu) + clic
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    const maps = window.google.maps;

    osmPolygonsRef.current.forEach((p) => p.setMap(null));
    osmPolygonsRef.current = [];

    osmBuildings.forEach((osmBuilding) => {
      osmBuilding.polygonSurfaces.forEach((surf) => {
        if (!surf.polygon || surf.polygon.length === 0) return;
        const polygon = new maps.Polygon({
          paths: surf.polygon,
          fillColor: "#60A5FA",
          fillOpacity: 0.25,
          strokeColor: "#2563EB",
          strokeWeight: 1,
          clickable: true,
          zIndex: 0,
        });
        (polygon as google.maps.Polygon & { _osmBuilding?: OsmBuildingDisplay })._osmBuilding = osmBuilding;
        maps.event.addListener(polygon, "click", () => {
          const b = (polygon as google.maps.Polygon & { _osmBuilding?: OsmBuildingDisplay })._osmBuilding;
          if (b) handleOsmPolygonClick(b);
        });
        polygon.setMap(map);
        osmPolygonsRef.current.push(polygon);
      });
    });

    return () => {
      osmPolygonsRef.current.forEach((p) => {
        if (window.google?.maps?.event) {
          window.google.maps.event.clearInstanceListeners(p);
        }
        p.setMap(null);
      });
      osmPolygonsRef.current = [];
    };
  }, [osmBuildings]);

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

    // Si on a un polygone en cours de dessin, le garder
    if (polygonRef.current) {
      // Ne pas supprimer le polygone en cours de dessin
    }

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
        fillColor: "#E4FE55",
        fillOpacity: 0.35,
        strokeWeight: 2,
        strokeColor: "#E4FE55",
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

  // Afficher les marqueurs des résultats de recherche
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;

    // Nettoyer les marqueurs précédents
    searchMarkersRef.current.forEach((marker) => {
      marker.setMap(null);
    });
    searchMarkersRef.current = [];

    // Créer un marqueur pour chaque résultat de recherche
    searchResults.forEach((result) => {
      const marker = new maps.Marker({
        position: {
          lat: result.coordinates.lat,
          lng: result.coordinates.lng,
        },
        map: mapInstanceRef.current!,
        title: result.name,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#E4FE55",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2,
        },
      });

      // Ajouter un listener pour le clic sur le marqueur
      marker.addListener("click", () => {
        if (onSearchResultClick) {
          onSearchResultClick(result);
        }
      });

      searchMarkersRef.current.push(marker);
    });

    // Ajuster la vue pour afficher tous les marqueurs si on a des résultats
    // MAIS seulement si on n'est pas en train de zoomer sur un résultat spécifique
    // (c'est-à-dire si centerCoordinates n'est pas défini)
    if (searchResults.length > 0 && mapInstanceRef.current && !centerCoordinates && !isFocusingOnResultRef.current) {
      const bounds = new maps.LatLngBounds();
      searchResults.forEach((result) => {
        bounds.extend({
          lat: result.coordinates.lat,
          lng: result.coordinates.lng,
        });
      });
      
      // Étendre les bounds pour ajouter un padding (en degrés approximatifs)
      // Cela crée un effet de marge autour des marqueurs
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      
      // Calculer la différence de latitude et longitude
      const latDiff = ne.lat() - sw.lat();
      const lngDiff = ne.lng() - sw.lng();
      
      // Ajouter 10% de padding de chaque côté
      const paddingFactor = 0.1;
      const paddedNe = new maps.LatLng(
        ne.lat() + latDiff * paddingFactor,
        ne.lng() + lngDiff * paddingFactor
      );
      const paddedSw = new maps.LatLng(
        sw.lat() - latDiff * paddingFactor,
        sw.lng() - lngDiff * paddingFactor
      );
      
      // Créer de nouveaux bounds avec padding
      const paddedBounds = new maps.LatLngBounds(paddedSw, paddedNe);
      
      // Ajuster la vue avec les bounds étendus
      mapInstanceRef.current.fitBounds(paddedBounds);
    }

    return () => {
      // Nettoyage : supprimer les marqueurs
      searchMarkersRef.current.forEach((marker) => {
        marker.setMap(null);
      });
      searchMarkersRef.current = [];
    };
  }, [searchResults, onSearchResultClick, centerCoordinates]);

  const hasSurfaces =
    (currentProspect?.roofSurfaces?.length ?? 0) > 0 ||
    (currentProspect?.roofSurface?.polygon?.length ?? 0) > 0;

  return (
    <div className="absolute inset-0 h-full min-h-[70vh]">
      <div ref={mapRef} className="absolute inset-0 h-full w-full min-h-[70vh]" />

      {hasSurfaces && (
        <div className="absolute bottom-3 left-3 z-100 pointer-events-none flex flex-col gap-1 rounded-lg bg-white/95 border border-gray-200 px-2 py-1.5 shadow-sm text-xs">
          <span className="flex items-center gap-2">
            <span className="w-4 h-0.5 rounded bg-[#DC2626]" style={{ minWidth: 12 }} />
            Sud
          </span>
          <span className="flex items-center gap-2">
            <span className="w-4 h-0.5 rounded bg-[#2563EB]" style={{ minWidth: 12 }} />
            Perp. (orientation toit)
          </span>
          <span className="flex items-center gap-2">
            <span className="w-4 h-0.5 rounded bg-[#0D9488]" style={{ minWidth: 12 }} />
            Côté le plus long
          </span>
        </div>
      )}
    </div>
  );
}

// Fonction pour calculer l'aire d'un polygone en m²
// Utilise la formule de Shoelace sur des coordonnées projetées localement
function calculatePolygonArea(
  coordinates: Array<{ lat: number; lng: number }>
): number {
  if (coordinates.length < 3) {
    console.warn(`[Surface] Calcul impossible: polygone avec moins de 3 points (${coordinates.length} points)`);
    return 0;
  }

  console.log(`[Surface] Calcul de la surface pour ${coordinates.length} points`);
  console.log(`[Surface] Coordonnées d'entrée (premiers points):`, coordinates.slice(0, 3));
  
  // Pour des surfaces relativement petites (toits), on peut utiliser une projection plane locale
  // On convertit les coordonnées lat/lng en mètres en utilisant une projection centrée sur le premier point
  
  const R = 6371000; // Rayon de la Terre en mètres
  const centerLat = coordinates[0].lat;
  const centerLng = coordinates[0].lng;
  
  // Convertir les coordonnées en mètres (projection locale)
  const projectedCoords = coordinates.map(coord => {
    const dLat = (coord.lat - centerLat) * Math.PI / 180;
    const dLng = (coord.lng - centerLng) * Math.PI / 180;
    const latRad = (centerLat * Math.PI) / 180;
    
    // Projection Mercator locale
    const x = dLng * R * Math.cos(latRad);
    const y = dLat * R;
    
    return { x, y };
  });
  
  // Formule de Shoelace pour calculer l'aire d'un polygone
  let area = 0;
  for (let i = 0; i < projectedCoords.length; i++) {
    const j = (i + 1) % projectedCoords.length;
    area += projectedCoords[i].x * projectedCoords[j].y;
    area -= projectedCoords[j].x * projectedCoords[i].y;
  }
  
  const finalArea = Math.abs(area) / 2; // Diviser par 2 pour obtenir l'aire
  
  return finalArea;
}

/**
 * Calcule l'orientation (azimut) du toit depuis le polygone
 * Retourne l'azimut en degrés selon la convention PVGIS : -90° = Est, 0° = Sud, 90° = Ouest
 * Méthode : prendre le(s) plus long(s) côté(s), direction = vecteur du côté ; perpendiculaire = orientation du toit (celle qui pointe vers le Sud).
 */
function calculatePolygonOrientation(
  coordinates: Array<{ lat: number; lng: number }>
): number | undefined {
  if (coordinates.length < 3) return undefined;

  const R = 6371000; // Rayon de la Terre en mètres
  const centerLat = coordinates.reduce((sum, c) => sum + c.lat, 0) / coordinates.length;
  const centerLng = coordinates.reduce((sum, c) => sum + c.lng, 0) / coordinates.length;
  const latRad = (centerLat * Math.PI) / 180;

  // Convertir les coordonnées en mètres (projection locale)
  const projectedCoords = coordinates.map(coord => {
    const dLat = (coord.lat - centerLat) * Math.PI / 180;
    const dLng = (coord.lng - centerLng) * Math.PI / 180;
    const x = dLng * R * Math.cos(latRad);
    const y = dLat * R;
    return { x, y };
  });

  // Calculer longueur et vecteur (dx, dy) de chaque côté
  interface Side {
    index: number;
    length: number;
    dx: number;
    dy: number;
  }

  const sides: Side[] = [];
  for (let i = 0; i < projectedCoords.length; i++) {
    const j = (i + 1) % projectedCoords.length;
    const p1 = projectedCoords[i];
    const p2 = projectedCoords[j];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6) continue;
    sides.push({ index: i, length, dx, dy });
  }

  const sortedSides = [...sides].sort((a, b) => b.length - a.length);
  const longest = sortedSides[0];
  const second = sortedSides[1];
  if (!longest) return undefined;

  // Direction du plus long côté (vecteur unitaire)
  let dirX = longest.dx / longest.length;
  let dirY = longest.dy / longest.length;

  // Si le 2e plus long est quasi parallèle, moyenner les directions (en tenant compte du sens opposé)
  if (second && second.length > 0) {
    const dot = longest.dx * second.dx + longest.dy * second.dy;
    const cross = longest.dx * second.dy - longest.dy * second.dx;
    if (Math.abs(cross) < 0.01 * longest.length * second.length) {
      const sx = second.dx / second.length;
      const sy = second.dy / second.length;
      if (dot >= 0) {
        dirX = dirX + sx;
        dirY = dirY + sy;
      } else {
        dirX = dirX - sx;
        dirY = dirY - sy;
      }
      const n = Math.sqrt(dirX * dirX + dirY * dirY);
      if (n > 1e-6) {
        dirX /= n;
        dirY /= n;
      }
    }
  }

  // Les deux perpendiculaires possibles au plus long côté
  const perp1 = { x: -dirY, y: dirX };
  const perp2 = { x: dirY, y: -dirX };

  function bearingToAzimuth(px: number, py: number): number {
    const perpBearing = Math.atan2(py, px);
    const perpDeg = (perpBearing * 180) / Math.PI;
    let bearingDeg = 90 - perpDeg;
    while (bearingDeg >= 360) bearingDeg -= 360;
    while (bearingDeg < 0) bearingDeg += 360;
    let az = bearingDeg - 180;
    if (az > 180) az -= 360;
    if (az < -180) az += 360;
    return az;
  }

  const azimuth1 = bearingToAzimuth(perp1.x, perp1.y);
  const azimuth2 = bearingToAzimuth(perp2.x, perp2.y);

  // Les deux directions possibles du côté le plus long (perp. des perp.)
  let azimuthCote1 = azimuth1 + 90;
  if (azimuthCote1 > 180) azimuthCote1 -= 360;
  if (azimuthCote1 < -180) azimuthCote1 += 360;
  
  let azimuthCote2 = azimuth1 - 90;
  if (azimuthCote2 > 180) azimuthCote2 -= 360;
  if (azimuthCote2 < -180) azimuthCote2 += 360;

  // Comparer les 4 options : 2 perp. et 2 côtés, et choisir celle avec l'angle le plus faible avec le Sud (|azimuth| min)
  const candidates = [
    { azimuth: azimuth1, type: 'perp' },
    { azimuth: azimuth2, type: 'perp' },
    { azimuth: azimuthCote1, type: 'cote' },
    { azimuth: azimuthCote2, type: 'cote' },
  ];

  // Trouver celle avec la valeur absolue la plus faible (plus proche du Sud = 0°)
  const best = candidates.reduce((min, candidate) => 
    Math.abs(candidate.azimuth) < Math.abs(min.azimuth) ? candidate : min
  );

  return Math.round(best.azimuth * 10) / 10;
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
