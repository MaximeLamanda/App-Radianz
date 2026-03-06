/**
 * Traductions des types Google Places en français
 * Ces traductions correspondent aux libellés affichés sous les avis sur Google Maps
 */
export const placeTypeTranslations: Record<string, string> = {
  // Établissements d'enseignement
  school: "Établissement d'enseignement",
  university: "Université",
  primary_school: "École primaire",
  secondary_school: "École secondaire",
  
  // Transport
  transit_agency: "Société de transport routier",
  bus_station: "Gare routière",
  train_station: "Gare ferroviaire",
  subway_station: "Station de métro",
  airport: "Aéroport",
  
  // Restaurants
  restaurant: "Restaurant",
  cafe: "Café",
  bar: "Bar",
  bakery: "Boulangerie",
  meal_takeaway: "Restaurant à emporter",
  meal_delivery: "Service de livraison de repas",
  
  // Magasins
  store: "Magasin",
  shopping_mall: "Centre commercial",
  supermarket: "Supermarché",
  grocery_or_supermarket: "Supermarché",
  convenience_store: "Dépanneur",
  clothing_store: "Magasin de vêtements",
  electronics_store: "Magasin d'électronique",
  furniture_store: "Magasin de meubles",
  hardware_store: "Quincaillerie",
  pharmacy: "Pharmacie",
  
  // Bureaux et services
  office: "Bureau",
  bank: "Banque",
  post_office: "Bureau de poste",
  real_estate_agency: "Agence immobilière",
  insurance_agency: "Agence d'assurance",
  accounting: "Cabinet comptable",
  lawyer: "Cabinet d'avocats",
  finance: "Services financiers",
  
  // Entrepôts et industrie
  warehouse: "Entrepôt",
  storage: "Stockage",
  factory: "Usine",
  industrial: "Zone industrielle",
  
  // Sport et loisirs
  gym: "Salle de sport",
  stadium: "Stade",
  sports_complex: "Complexe sportif",
  park: "Parc",
  
  // Autres
  hospital: "Hôpital",
  doctor: "Cabinet médical",
  dentist: "Cabinet dentaire",
  veterinary_care: "Cabinet vétérinaire",
  gas_station: "Station-service",
  car_repair: "Garage automobile",
  car_dealer: "Concessionnaire automobile",
  hotel: "Hôtel",
  lodging: "Hébergement",
  
  // Services publics
  police: "Commissariat de police",
  fire_station: "Caserne de pompiers",
  city_hall: "Mairie",
  courthouse: "Tribunal",
  embassy: "Ambassade",
  
  // Culture et loisirs
  library: "Bibliothèque",
  museum: "Musée",
  art_gallery: "Galerie d'art",
  movie_theater: "Cinéma",
  theater: "Théâtre",
  zoo: "Zoo",
  aquarium: "Aquarium",
  amusement_park: "Parc d'attractions",
  taxi_stand: "Station de taxi",
  
  // Religieux
  church: "Église",
  mosque: "Mosquée",
  synagogue: "Synagogue",
  hindu_temple: "Temple hindou",
  buddhist_temple: "Temple bouddhiste",
  
  // Services
  beauty_salon: "Salon de beauté",
  hair_care: "Salon de coiffure",
  spa: "Spa",
  car_wash: "Lavage de voiture",
  laundry: "Laverie",
  dry_cleaner: "Pressing",
  food: "Restaurant",
  butcher_shop: "Boucherie",
  seafood: "Poissonnerie",
  travel_agency: "Agence de voyage",
  moving_company: "Entreprise de déménagement",
  storage_facility: "Installation de stockage",
};

/**
 * Traduit un type Google Places en français
 */
export function translatePlaceType(type: string): string {
  // Si on a une traduction, l'utiliser
  if (placeTypeTranslations[type]) {
    return placeTypeTranslations[type];
  }
  
  // Sinon, formater le type (remplacer les underscores et capitaliser)
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
