"use client";

import { useEffect, useRef, useState } from "react";
import type { Prospect, AddressCoordinates, RoofSurface, Contact, PlaceType, Exposure, PlaceSearchResult } from "@/types";
import { convertPlaceType, extractContact } from "@/lib/places";
import { getPlaceDetailsNew } from "@/lib/places-new-api";

interface MapComponentProps {
  onProspectUpdate: (prospect: Prospect | null) => void;
  isDrawing: boolean;
  onDrawingChange: (isDrawing: boolean) => void;
  centerCoordinates?: AddressCoordinates | null;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }> }) => void;
  currentProspect?: Prospect | null;
  shouldValidateDrawing?: boolean;
  onValidationComplete?: () => void;
  searchResults?: PlaceSearchResult[];
  onSearchResultClick?: (result: PlaceSearchResult) => void;
  onGetMapCenter?: (getCenterFunc: () => AddressCoordinates | null) => void;
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
  searchResults = [],
  onSearchResultClick,
  onGetMapCenter,
}: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const searchMarkersRef = useRef<google.maps.Marker[]>([]);
  const isFocusingOnResultRef = useRef<boolean>(false);
  
  // Fonction pour obtenir le centre de la carte - toujours disponible via ref
  const getMapCenterFunc = useRef<(() => AddressCoordinates | null) | null>(null);
  
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
      // Initialiser la carte Google Maps avec gestion d'erreur
      // Configuration pour afficher les établissements nativement
      // Coordonnées de Roinville par défaut (sera remplacé par centerCoordinates si fourni)
      const map = new maps.Map(mapRef.current, {
        center: centerCoordinates || { lat: 48.5311, lng: 2.0508 }, // Roinville par défaut
        zoom: 16,
        mapTypeId: maps.MapTypeId.HYBRID, // Satellite + POI et libellés (EEA : JS API uniquement)
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
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
      const initialCenter = centerCoordinates || { lat: 48.5311, lng: 2.0508 };
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
      
      // Exposer la fonction au parent
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
      
      // Écouter les changements de centre pour mettre à jour le dernier centre connu
      maps.event.addListener(map, "center_changed", () => {
        updateLastKnownCenter();
      });
      
      // Écouter l'événement "idle" (carte prête après mouvement) pour s'assurer que le centre est à jour
      maps.event.addListener(map, "idle", () => {
        updateLastKnownCenter();
      });
      
      // Écouter une première fois "idle" pour l'initialisation
      maps.event.addListenerOnce(map, "idle", () => {
        updateLastKnownCenter();
      });

      // Google Maps affiche déjà nativement les établissements (restaurants, magasins, etc.)
      // sur la carte en mode roadmap - pas besoin de marqueurs custom
      // On utilise PlacesService pour obtenir les détails quand on clique sur la carte
      
      // Créer un service Places pour rechercher les établissements au clic
      const placesService = new maps.places.PlacesService(map);
      
      // Fonction helper pour traiter les détails d'un lieu
      const processPlaceDetails = (
        placeId: string,
        coordinates: AddressCoordinates,
        address?: string
      ) => {
        // Essayer d'abord la nouvelle API Places
        getPlaceDetailsNew(placeId)
          .then((newPlaceDetails) => {
            if (newPlaceDetails?.primaryTypeDisplayName || newPlaceDetails?.primaryType) {
              const placeType = (newPlaceDetails.primaryType ?? newPlaceDetails.types?.find((t) => !["establishment", "point_of_interest"].includes(t))) ?? "other";
              const prospect: Prospect = {
                name: newPlaceDetails.displayName || undefined,
                address: newPlaceDetails.formattedAddress || address,
                coordinates: coordinates,
                roofSurface: { area: 0, polygon: [] },
                placeType,
                qualityScore: calculateQualityScore(0, placeType),
                contact: {
                  websiteUri: newPlaceDetails.websiteURI || undefined,
                  nationalPhoneNumber: newPlaceDetails.nationalPhoneNumber || undefined,
                  internationalPhoneNumber: newPlaceDetails.internationalPhoneNumber || undefined,
                },
              };
              
              onProspectUpdate(prospect);
              return;
            }
            
            // Fallback sur l'ancienne API
            placesService.getDetails(
              {
                placeId: placeId,
                fields: ["name", "types", "formatted_address", "geometry", "website", "formatted_phone_number", "international_phone_number"],
              },
              (placeDetails, detailsStatus) => {
                if (detailsStatus === "OK" && placeDetails) {
                  const genericTypes = new Set([
                    "establishment", "point_of_interest", "locality", "political",
                    "geocode", "route", "street_address", "premise", "subpremise",
                    "administrative_area_level_1", "administrative_area_level_2",
                    "country", "postal_code", "neighborhood", "sublocality",
                  ]);

                  const findSpecificType = (types: string[]) => {
                    return types.find(type => !genericTypes.has(type)) || types[0] || "other";
                  };

                  const googleTypes = placeDetails.types || [];
                  const googlePlaceType = findSpecificType(googleTypes);
                  
                  // Utiliser les coordonnées du lieu si disponibles, sinon celles passées
                  let finalCoordinates = coordinates;
                  if (placeDetails.geometry?.location) {
                    finalCoordinates = {
                      lat: placeDetails.geometry.location.lat(),
                      lng: placeDetails.geometry.location.lng(),
                    };
                  }
                  
                  const prospect: Prospect = {
                    name: placeDetails.name || undefined,
                    address: placeDetails.formatted_address || address,
                    coordinates: finalCoordinates,
                    roofSurface: { area: 0, polygon: [] },
                    placeType: googlePlaceType,
                    qualityScore: calculateQualityScore(0, convertPlaceType(googleTypes)),
                    contact: extractContact(placeDetails),
                  };
                  
                  onProspectUpdate(prospect);
                }
              }
            );
          })
          .catch(() => {
            // Erreur avec la nouvelle API, utiliser l'ancienne
            placesService.getDetails(
              {
                placeId: placeId,
                fields: ["name", "types", "formatted_address", "geometry", "website", "formatted_phone_number", "international_phone_number"],
              },
              (placeDetails, detailsStatus) => {
                if (detailsStatus === "OK" && placeDetails) {
                  const genericTypes = new Set([
                    "establishment", "point_of_interest", "locality", "political",
                    "geocode", "route", "street_address", "premise", "subpremise",
                    "administrative_area_level_1", "administrative_area_level_2",
                    "country", "postal_code", "neighborhood", "sublocality",
                  ]);

                  const findSpecificType = (types: string[]) => {
                    return types.find(type => !genericTypes.has(type)) || types[0] || "other";
                  };

                  const googleTypes = placeDetails.types || [];
                  const googlePlaceType = findSpecificType(googleTypes);
                  
                  // Utiliser les coordonnées du lieu si disponibles, sinon celles passées
                  let finalCoordinates = coordinates;
                  if (placeDetails.geometry?.location) {
                    finalCoordinates = {
                      lat: placeDetails.geometry.location.lat(),
                      lng: placeDetails.geometry.location.lng(),
                    };
                  }
                  
                  const prospect: Prospect = {
                    name: placeDetails.name || undefined,
                    address: placeDetails.formatted_address || address,
                    coordinates: finalCoordinates,
                    roofSurface: { area: 0, polygon: [] },
                    placeType: googlePlaceType,
                    qualityScore: calculateQualityScore(0, convertPlaceType(googleTypes)),
                    contact: extractContact(placeDetails),
                  };
                  
                  onProspectUpdate(prospect);
                }
              }
            );
          });
      };
      
      // Écouter uniquement les clics sur les POI de Google Maps
      maps.event.addListener(map, "click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
        // Vérifier si c'est un clic sur un POI (IconMouseEvent avec placeId)
        const placeId = (event as any).placeId;
        
        if (placeId) {
          // Clic sur un POI : utiliser directement le placeId
          // Stopper le comportement par défaut de Google (ouvrir le panneau d'info)
          if (event.stop) {
            event.stop();
          }
          
          // Obtenir les coordonnées depuis l'événement
          if (!event.latLng) return;
          
          const coordinates: AddressCoordinates = {
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
          };
          
          // Appeler directement getDetails avec le placeId
          processPlaceDetails(placeId, coordinates);
        }
        // Si pas de placeId, on ne fait rien (pas de recherche automatique)
      });

      return () => {
        // Nettoyage : supprimer les listeners
        if (mapInstanceRef.current) {
          maps.event.clearInstanceListeners(mapInstanceRef.current);
        }
      };
    } catch (error) {
      console.error("Erreur lors de l'initialisation de Google Maps:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Ne s'exécute qu'une seule fois au montage

  // Exposer la fonction pour obtenir le centre de la carte quand onGetMapCenter change
  useEffect(() => {
    if (onGetMapCenter && getMapCenterFunc.current) {
      if (typeof getMapCenterFunc.current === 'function') {
        onGetMapCenter(getMapCenterFunc.current);
      } else {
        console.error("[MapComponent] ERREUR: getMapCenterFunc.current n'est pas une fonction!", typeof getMapCenterFunc.current);
      }
    }
  }, [onGetMapCenter]);

  // Gérer le mode dessin
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;

    if (isDrawing) {
      // Activer le mode dessin
      if (!drawingManagerRef.current && maps.drawing && maps.drawing.DrawingManager) {
        const drawingManager = new maps.drawing.DrawingManager({
          drawingMode: maps.drawing.OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
            fillColor: "#4285F4",
            fillOpacity: 0.35,
            strokeWeight: 2,
            strokeColor: "#4285F4",
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
        console.log(`[Surface] 📏 Surface calculée: ${area.toFixed(2)} m²`);

        if (area > 0) {
          console.log("[Surface] ✅ Mise à jour du prospect avec la nouvelle surface");
          console.log(`[Surface] 📊 Données de la surface:`, {
            area: area.toFixed(2) + " m²",
            pointCount: coordinates.length,
            firstPoint: coordinates[0],
            lastPoint: coordinates[coordinates.length - 1]
          });
          
          onSurfaceUpdate({
            area,
            polygon: coordinates,
          });

          // Garder le polygone affiché mais le rendre non éditable
          polygon.setEditable(false);
          
          // Réinitialiser le flag de validation
          if (onValidationComplete) {
            onValidationComplete();
          }
        } else {
          console.warn("[Surface] Surface calculée = 0, validation annulée");
          if (onValidationComplete) {
            onValidationComplete();
          }
        }
      } else if (!shouldValidateDrawing) {
        // Annulation : supprimer le polygone en cours de dessin
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
    }
  }, [isDrawing, shouldValidateDrawing, onSurfaceUpdate]);

  // Référence pour stocker tous les polygones affichés
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  // Afficher tous les polygones existants du prospect
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;

    // Nettoyer tous les polygones existants
    polygonsRef.current.forEach(polygon => {
      polygon.setMap(null);
    });
    polygonsRef.current = [];

    // Si on a un polygone en cours de dessin, le garder
    if (polygonRef.current) {
      // Ne pas supprimer le polygone en cours de dessin
    }

    // Récupérer toutes les surfaces
    const surfaces = currentProspect?.roofSurfaces || 
      (currentProspect?.roofSurface.area > 0 ? [currentProspect.roofSurface] : []);

    if (surfaces.length === 0) {
      return;
    }

    // Créer un polygone pour chaque surface
    surfaces.forEach((surface, index) => {
      if (!surface.polygon || surface.polygon.length === 0) {
        return;
      }

      const polygon = new maps.Polygon({
        paths: surface.polygon,
        fillColor: "#4285F4",
        fillOpacity: 0.35,
        strokeWeight: 2,
        strokeColor: "#4285F4",
        clickable: false,
        editable: false,
        zIndex: 1,
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);
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
          fillColor: "#4285F4",
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

  return (
    <div className="h-full w-full">
      <div ref={mapRef} className="h-full w-full" />
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
