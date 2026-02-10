import type { PlaceSearchResult, PlaceSearchType, AddressCoordinates, Contact } from "@/types";
import { extractContact } from "./places";

/**
 * Recherche des lieux par type autour d'une position avec un rayon donné
 * @param coordinates Coordonnées du point de départ
 * @param placeType Type de lieu à rechercher
 * @param radius Rayon de recherche en mètres
 * @returns Promise avec la liste des résultats de recherche
 */
export async function searchPlacesByType(
  coordinates: AddressCoordinates,
  placeType: PlaceSearchType,
  radius: number
): Promise<PlaceSearchResult[]> {
  if (!window.google?.maps?.places) {
    throw new Error("Google Maps Places API n'est pas disponible");
  }

  return new Promise((resolve, reject) => {
    const maps = window.google.maps;
    const service = new maps.places.PlacesService(document.createElement("div"));

    const request: google.maps.places.PlaceSearchRequest = {
      location: new maps.LatLng(coordinates.lat, coordinates.lng),
      radius: radius,
      type: placeType,
    };

    service.nearbySearch(request, (results, status) => {
      if (status === maps.places.PlacesServiceStatus.OK && results) {
        const searchResults: PlaceSearchResult[] = results.map((place) => {
          const location = place.geometry?.location;
          const coordinates: AddressCoordinates = location
            ? {
                lat: location.lat(),
                lng: location.lng(),
              }
            : { lat: 0, lng: 0 };

          // Extraire le type principal (le premier type non générique)
          const genericTypes = new Set([
            "establishment",
            "point_of_interest",
            "locality",
            "political",
            "geocode",
            "route",
            "street_address",
            "premise",
            "subpremise",
          ]);

          const specificType =
            place.types?.find((type) => !genericTypes.has(type)) ||
            place.types?.[0] ||
            placeType;

          const contact: Contact | undefined = extractContact(place);

          return {
            placeId: place.place_id || "",
            name: place.name || "",
            address: place.vicinity || place.formatted_address || "",
            coordinates,
            placeType: specificType,
            rating: place.rating,
            userRatingsTotal: place.user_ratings_total,
            types: place.types || [],
            contact,
          };
        });

        resolve(searchResults);
      } else if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]); // Aucun résultat trouvé, retourner un tableau vide
      } else {
        reject(new Error(`Erreur lors de la recherche: ${status}`));
      }
    });
  });
}
