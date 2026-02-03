/**
 * Obtient les détails d'un lieu avec la nouvelle API Places (New)
 * Retourne primaryTypeDisplayName (libellé exact affiché sur Google Maps)
 */
export async function getPlaceDetailsNew(
  placeId: string
): Promise<{
  primaryTypeDisplayName: string | null;
  primaryType: string | null;
  types: string[];
  displayName: string | null;
  formattedAddress: string | null;
  websiteURI: string | null;
  nationalPhoneNumber: string | null;
  internationalPhoneNumber: string | null;
} | null> {
  if (!window.google?.maps?.places) {
    return null;
  }

  try {
    const Place = (window.google.maps.places as any).Place;
    if (typeof Place === "undefined") {
      return null;
    }

    const place = new Place({ id: placeId });

    await place.fetchFields({
      fields: [
        "id",
        "displayName",
        "primaryType",
        "primaryTypeDisplayName",
        "types",
        "formattedAddress",
        "websiteURI",
        "nationalPhoneNumber",
        "internationalPhoneNumber",
      ],
    });

    const primaryTypeDisplayName = place.primaryTypeDisplayName;
    const displayName = place.displayName;

    // Extraire le texte du primaryTypeDisplayName
    let primaryTypeDisplayNameText: string | null = null;
    if (primaryTypeDisplayName) {
      if (typeof primaryTypeDisplayName === "string") {
        primaryTypeDisplayNameText = primaryTypeDisplayName;
      } else if ((primaryTypeDisplayName as any).text) {
        primaryTypeDisplayNameText = (primaryTypeDisplayName as any).text;
      }
    }

    return {
      primaryTypeDisplayName: primaryTypeDisplayNameText,
      primaryType: place.primaryType || null,
      types: place.types || [],
      displayName: typeof displayName === "string" ? displayName : (displayName as any)?.text || null,
      formattedAddress: place.formattedAddress || null,
      websiteURI: place.websiteURI || null,
      nationalPhoneNumber: place.nationalPhoneNumber || null,
      internationalPhoneNumber: place.internationalPhoneNumber || null,
    };
  } catch (error) {
    return null;
  }
}
