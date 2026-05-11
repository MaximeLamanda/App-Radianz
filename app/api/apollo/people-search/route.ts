import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth-quota";
import { checkApolloThrottle } from "@/lib/apollo-throttle";
import {
  buildApolloSearchBody,
  extractDomainFromWebsite,
  parseApolloPerson,
  APOLLO_PEOPLE_PER_PAGE,
} from "@/lib/apollo-people-search";
import type { ProspectContact } from "@/types";

export const dynamic = "force-dynamic";

const APOLLO_ENDPOINT = "https://api.apollo.io/v1/mixed_people/search";
const GOOGLE_PLACE_DETAILS_ENDPOINT = "https://maps.googleapis.com/maps/api/place/details/json";

const poiSchema = z.object({
  source: z.enum(["osm", "osm_building", "google"]),
  name: z.string().min(1).max(512),
  website: z.string().max(2048).optional().nullable(),
  externalUrl: z.string().max(2048).optional().nullable(),
  placeId: z.string().max(512).optional().nullable(),
});

const bodySchema = z.object({
  poi: poiSchema,
});

function getApolloApiKey(): string | undefined {
  return process.env.APOLLO_API_KEY?.trim() || undefined;
}

function getGoogleServerKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    undefined
  );
}

async function resolveWebsiteFromPlaceId(
  placeId: string,
  apiKey: string
): Promise<{ ok: true; website: string | null } | { ok: false; status: number; error: string }> {
  const url = new URL(GOOGLE_PLACE_DETAILS_ENDPOINT);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "website,url");
  url.searchParams.set("key", apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    return { ok: false, status: 502, error: "Google Place Details indisponible." };
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: `Google Place Details HTTP ${res.status}` };
  }
  const data = (await res.json()) as {
    status?: string;
    error_message?: string;
    result?: { website?: string };
  };
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return {
      ok: false,
      status: 502,
      error: `Google Place Details ${data.status}${data.error_message ? ` : ${data.error_message}` : ""}`,
    };
  }
  return { ok: true, website: data.result?.website ?? null };
}

type ApolloRawResponse = {
  people?: unknown[];
  pagination?: { total_entries?: number };
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const apolloKey = getApolloApiKey();
  if (!apolloKey) {
    return NextResponse.json(
      {
        error:
          "Clé Apollo manquante côté serveur. Configurez APOLLO_API_KEY dans .env.local puis redémarrez le serveur.",
      },
      { status: 500 }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const throttle = checkApolloThrottle(auth.context.uid);
  if (!throttle.ok) {
    return NextResponse.json(
      {
        error: "Trop de requêtes Apollo. Patientez quelques secondes.",
        retryAfterSeconds: throttle.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  const { poi } = parsed.data;

  let websiteCandidate = (poi.website || "").trim();
  if (!websiteCandidate && poi.source === "google" && poi.placeId) {
    const googleKey = getGoogleServerKey();
    if (!googleKey) {
      return NextResponse.json(
        {
          error:
            "Clé Google Maps manquante (GOOGLE_MAPS_API_KEY ou NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) pour résoudre le site web depuis le placeId.",
        },
        { status: 500 }
      );
    }
    const detailsRes = await resolveWebsiteFromPlaceId(poi.placeId, googleKey);
    if (!detailsRes.ok) {
      return NextResponse.json({ error: detailsRes.error }, { status: detailsRes.status });
    }
    websiteCandidate = detailsRes.website?.trim() ?? "";
  }

  const domain = extractDomainFromWebsite(websiteCandidate);
  if (!domain) {
    return NextResponse.json(
      {
        error:
          "Aucun site web exploitable pour cette ligne. Apollo a besoin d'un domaine pour rechercher les contacts.",
      },
      { status: 400 }
    );
  }

  const apolloBody = buildApolloSearchBody({ domain, perPage: APOLLO_PEOPLE_PER_PAGE });

  let apolloRes: Response;
  try {
    apolloRes = await fetch(APOLLO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Accept: "application/json",
        "X-Api-Key": apolloKey,
      },
      body: JSON.stringify(apolloBody),
    });
  } catch {
    return NextResponse.json({ error: "Apollo indisponible (erreur réseau)." }, { status: 502 });
  }

  if (!apolloRes.ok) {
    let detail: string | undefined;
    try {
      const errJson = (await apolloRes.json()) as { error?: string; message?: string };
      detail = errJson.error || errJson.message;
    } catch {
      detail = undefined;
    }
    if (apolloRes.status === 401) {
      return NextResponse.json(
        { error: `Apollo : clé API invalide ou révoquée${detail ? ` (${detail})` : ""}.` },
        { status: 502 }
      );
    }
    if (apolloRes.status === 402) {
      return NextResponse.json(
        { error: `Apollo : crédits insuffisants${detail ? ` (${detail})` : ""}.` },
        { status: 502 }
      );
    }
    if (apolloRes.status === 429) {
      return NextResponse.json(
        { error: `Apollo : limite de débit atteinte${detail ? ` (${detail})` : ""}.` },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: `Apollo HTTP ${apolloRes.status}${detail ? ` : ${detail}` : ""}` },
      { status: 502 }
    );
  }

  let apolloJson: ApolloRawResponse;
  try {
    apolloJson = (await apolloRes.json()) as ApolloRawResponse;
  } catch {
    return NextResponse.json({ error: "Réponse Apollo non JSON." }, { status: 502 });
  }

  const people = Array.isArray(apolloJson.people) ? apolloJson.people : [];
  const contacts: ProspectContact[] = [];
  for (const raw of people) {
    const contact = parseApolloPerson(raw);
    if (contact) contacts.push(contact);
  }

  return NextResponse.json({
    ok: true,
    domain,
    rawCount: people.length,
    contacts,
  });
}
