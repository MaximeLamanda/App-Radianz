import type { PlaceType, Contact } from "@/types";

/**
 * Convertit les types de Google Places API vers notre type PlaceType
 */
export function convertPlaceType(types: string[]): PlaceType {
  if (!types || types.length === 0) return "other";

  console.log("Types à convertir:", types);

  // Mapping étendu des types Google Places vers nos types
  const typeMap: Record<string, PlaceType> = {
    // Retail
    store: "retail",
    shopping_mall: "retail",
    shopping_center: "retail",
    clothing_store: "retail",
    furniture_store: "retail",
    electronics_store: "retail",
    department_store: "retail",
    convenience_store: "retail",
    shoe_store: "retail",
    jewelry_store: "retail",
    book_store: "retail",
    home_goods_store: "retail",
    hardware_store: "retail",
    pet_store: "retail",
    bicycle_store: "retail",
    car_dealer: "retail",
    car_repair: "retail",
    car_wash: "retail",
    gas_station: "retail",
    pharmacy: "retail",
    
    // Sport
    gym: "sport",
    stadium: "sport",
    sports_complex: "sport",
    sports_club: "sport",
    fitness_center: "sport",
    swimming_pool: "sport",
    park: "sport",
    
    // Supermarket
    supermarket: "supermarket",
    grocery_or_supermarket: "supermarket",
    food: "supermarket",
    meal_takeaway: "supermarket",
    meal_delivery: "supermarket",
    
    // Warehouse
    warehouse: "warehouse",
    storage: "warehouse",
    storage_facility: "warehouse",
    
    // Office
    office: "office",
    bank: "office",
    post_office: "office",
    real_estate_agency: "office",
    insurance_agency: "office",
    accounting: "office",
    lawyer: "office",
    finance: "office",
    courthouse: "office",
    city_hall: "office",
    local_government_office: "office",
    
    // Industrial
    factory: "industrial",
    industrial: "industrial",
    manufacturing: "industrial",
    plant: "industrial",
    
    // Restaurant (peut être considéré comme retail ou other selon le contexte)
    restaurant: "retail",
    cafe: "retail",
    bar: "retail",
    night_club: "retail",
    
    // Residential
    residential: "residential",
    apartment: "residential",
    house: "residential",
    lodging: "residential",
  };

  // Parcourir les types dans l'ordre de priorité
  // Ignorer les types génériques comme "establishment", "point_of_interest", "locality", etc.
  const ignoredTypes = [
    "establishment",
    "point_of_interest",
    "locality",
    "political",
    "geocode",
    "route",
    "street_address",
    "premise",
    "subpremise",
  ];

  for (const type of types) {
    if (ignoredTypes.includes(type)) {
      continue;
    }
    
    if (typeMap[type]) {
      console.log(`Type détecté: ${type} -> ${typeMap[type]}`);
      return typeMap[type];
    }
  }

  console.log("Aucun type spécifique trouvé, retourne 'other'");
  return "other";
}

/**
 * Extrait les informations de contact depuis un résultat Places API
 */
export function extractContact(place: google.maps.places.PlaceResult): Contact | undefined {
  const contact: Contact = {};

  if (place.website) {
    contact.websiteUri = place.website;
  }

  if (place.international_phone_number) {
    contact.internationalPhoneNumber = place.international_phone_number;
  }

  if (place.formatted_phone_number) {
    contact.nationalPhoneNumber = place.formatted_phone_number;
  }

  if (Object.keys(contact).length === 0) {
    return undefined;
  }

  return contact;
}
