"use client";

import { useEffect, useRef, useState } from "react";
import type { Prospect, AddressCoordinates, RoofSurface, Contact, PlaceType, Exposure } from "@/types";
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
}: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);

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
        mapTypeId: maps.MapTypeId.ROADMAP,
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
            if (newPlaceDetails?.primaryTypeDisplayName) {
              const prospect: Prospect = {
                name: newPlaceDetails.displayName || undefined,
                address: newPlaceDetails.formattedAddress || address,
                coordinates: coordinates,
                roofSurface: { area: 0, polygon: [] },
                placeType: newPlaceDetails.primaryTypeDisplayName,
                qualityScore: calculateQualityScore(0, newPlaceDetails.primaryType || "other"),
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

  // Gérer le mode dessin
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (!window.google?.maps) return;

    const maps = window.google.maps;

    if (isDrawing) {
      console.log("[Surface] Mode dessin activé");
      // Activer le mode dessin
      if (!drawingManagerRef.current && maps.drawing && maps.drawing.DrawingManager) {
        console.log("[Surface] Création du DrawingManager");
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
          console.log("[Surface] Polygone dessiné - récupération des coordonnées");
          // Supprimer l'ancien polygone s'il existe
          if (polygonRef.current) {
            console.log("[Surface] Suppression de l'ancien polygone");
            polygonRef.current.setMap(null);
          }

          polygonRef.current = polygon;
          polygon.setEditable(true);
          polygon.setDraggable(false);

          // Extraire les coordonnées pour log
          const path = polygon.getPath();
          const pointCount = path.getLength();
          console.log(`[Surface] Polygone créé avec ${pointCount} points`);
          console.log("[Surface] Polygone rendu éditable - attente de validation");

          // Désactiver le mode dessin après création
          drawingManager.setDrawingMode(null);
        });
      } else if (drawingManagerRef.current) {
        console.log("[Surface] Réactivation du mode dessin (DrawingManager existant)");
        // Réactiver le mode dessin si le manager existe déjà
        drawingManagerRef.current.setDrawingMode(maps.drawing.OverlayType.POLYGON);
      }
    } else {
      console.log("[Surface] Mode dessin désactivé");
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
        console.log("[Surface] Validation du dessin en cours");
        const polygon = polygonRef.current;
        const path = polygon.getPath();
        const coordinates: Array<{ lat: number; lng: number }> = [];
        
        path.forEach((latLng) => {
          coordinates.push({
            lat: latLng.lat(),
            lng: latLng.lng(),
          });
        });

        console.log(`[Surface] Coordonnées extraites: ${coordinates.length} points`);
        const area = calculatePolygonArea(coordinates);
        console.log(`[Surface] Surface calculée: ${area.toFixed(2)} m²`);

        if (area > 0) {
          console.log("[Surface] Mise à jour du prospect avec la nouvelle surface");
          onSurfaceUpdate({
            area,
            polygon: coordinates,
          });

          // Garder le polygone affiché mais le rendre non éditable
          polygon.setEditable(false);
          console.log("[Surface] Polygone validé et rendu non éditable");
          
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
        console.log("[Surface] Annulation du dessin - suppression du polygone");
        // Annulation : supprimer le polygone en cours de dessin
        polygonRef.current.setMap(null);
        polygonRef.current = null;
        console.log("[Surface] Polygone supprimé");
      }
    } else if (!isDrawing && !polygonRef.current) {
      console.log("[Surface] Pas de polygone à valider ou annuler");
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
      console.log("[Surface] Pas de surface existante à afficher");
      return;
    }

    console.log(`[Surface] Affichage de ${surfaces.length} polygone(s) existant(s)`);

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
      console.log(`[Surface] Polygone ${index + 1} affiché (${surface.polygon.length} points, ${surface.area.toFixed(2)} m²)`);
    });

    console.log(`[Surface] ${polygonsRef.current.length} polygone(s) affiché(s) sur la carte`);
  }, [currentProspect?.roofSurfaces, currentProspect?.roofSurface.polygon]);

  // Centrer la carte sur les coordonnées sélectionnées (seulement si la carte existe déjà)
  useEffect(() => {
    if (centerCoordinates && mapInstanceRef.current) {
      const maps = window.google?.maps;
      if (!maps) return;

      const currentCenter = mapInstanceRef.current.getCenter();
      if (!currentCenter) return;

      // Ne centrer que si les coordonnées sont significativement différentes
      const latDiff = Math.abs(currentCenter.lat() - centerCoordinates.lat);
      const lngDiff = Math.abs(currentCenter.lng() - centerCoordinates.lng);
      
      // Seuil de 0.0001 degré (environ 11 mètres) pour éviter les micro-mouvements
      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        mapInstanceRef.current.setCenter({
          lat: centerCoordinates.lat,
          lng: centerCoordinates.lng,
        });
        mapInstanceRef.current.setZoom(18);
      }
    }
  }, [centerCoordinates]);

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
  
  console.log(`[Surface] Point de référence (centre): lat=${centerLat.toFixed(6)}, lng=${centerLng.toFixed(6)}`);
  
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
  console.log(`[Surface] Surface calculée: ${finalArea.toFixed(2)} m²`);
  console.log(`[Surface] Coordonnées projetées (premiers points):`, projectedCoords.slice(0, 3));
  
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
