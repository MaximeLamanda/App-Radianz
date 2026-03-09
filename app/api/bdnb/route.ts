import { NextRequest, NextResponse } from "next/server";
import { requireAuthAndQuota, incrementQuotaAfterSuccess } from "@/lib/api-auth-quota";

const BDNB_BASE =
  "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox";
const BDNB_FFO_BASE =
  "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_ffo_bat/bbox";

// Conversion WGS84 → Lambert93 (EPSG:2154)
// Utilise une approximation suffisante pour une bbox de quelques dizaines de mètres
function wgs84ToLambert93(lat: number, lng: number): { x: number; y: number } {
  // Constantes de la projection Lambert93
  const a = 6378137.0; // demi-grand axe GRS80
  const e = 0.0818191910428158; // excentricité
  const lc = (3 * Math.PI) / 180; // méridien central = 3°E
  const phi1 = (44 * Math.PI) / 180; // parallèle standard 1
  const phi2 = (49 * Math.PI) / 180; // parallèle standard 2
  const phi0 = (46.5 * Math.PI) / 180; // parallèle d'origine
  const x0 = 700000; // fausse abscisse
  const y0 = 6600000; // fausse ordonnée

  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const sinPhi1 = Math.sin(phi1);
  const sinPhi2 = Math.sin(phi2);
  const sinPhi0 = Math.sin(phi0);

  const eSinPhi1 = e * sinPhi1;
  const eSinPhi2 = e * sinPhi2;
  const eSinPhi0 = e * sinPhi0;

  const m1 =
    Math.cos(phi1) / Math.sqrt(1 - eSinPhi1 * eSinPhi1);
  const m2 =
    Math.cos(phi2) / Math.sqrt(1 - eSinPhi2 * eSinPhi2);

  const tPhi = (phi: number) => {
    const sinP = e * Math.sin(phi);
    return (
      Math.tan(Math.PI / 4 - phi / 2) *
      Math.pow((1 + sinP) / (1 - sinP), e / 2)
    );
  };

  const t1 = tPhi(phi1);
  const t2 = tPhi(phi2);
  const t0 = tPhi(phi0);
  const tLat = tPhi(latRad);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const rho = a * F * Math.pow(tLat, n);
  const theta = n * (lngRad - lc);

  const x = x0 + rho * Math.sin(theta);
  const y = y0 + rho0 - rho * Math.cos(theta);

  return { x, y };
}

// Conversion Lambert93 → WGS84
// Itération de Newton-Raphson pour l'inversion
function lambert93ToWgs84(x: number, y: number): { lat: number; lng: number } {
  const a = 6378137.0;
  const e = 0.0818191910428158;
  const lc = (3 * Math.PI) / 180;
  const phi1 = (44 * Math.PI) / 180;
  const phi2 = (49 * Math.PI) / 180;
  const phi0 = (46.5 * Math.PI) / 180;
  const x0 = 700000;
  const y0 = 6600000;

  const sinPhi1 = Math.sin(phi1);
  const sinPhi2 = Math.sin(phi2);
  const sinPhi0 = Math.sin(phi0);

  const eSinPhi1 = e * sinPhi1;
  const eSinPhi2 = e * sinPhi2;
  const eSinPhi0 = e * sinPhi0;

  const m1 = Math.cos(phi1) / Math.sqrt(1 - eSinPhi1 * eSinPhi1);
  const m2 = Math.cos(phi2) / Math.sqrt(1 - eSinPhi2 * eSinPhi2);

  const tPhi = (phi: number) => {
    const sinP = e * Math.sin(phi);
    return (
      Math.tan(Math.PI / 4 - phi / 2) *
      Math.pow((1 + sinP) / (1 - sinP), e / 2)
    );
  };

  const t1 = tPhi(phi1);
  const t2 = tPhi(phi2);
  const t0 = tPhi(phi0);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);

  const xShifted = x - x0;
  const yShifted = rho0 - (y - y0);
  const rho = Math.sqrt(xShifted * xShifted + yShifted * yShifted) * Math.sign(n);
  const theta = Math.atan2(xShifted, yShifted);

  const lng = theta / n + lc;
  const t = Math.pow(rho / (a * F), 1 / n);

  // Newton-Raphson pour retrouver phi
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 10; i++) {
    const sinP = e * Math.sin(phi);
    phi =
      Math.PI / 2 -
      2 * Math.atan(t * Math.pow((1 - sinP) / (1 + sinP), e / 2));
  }

  return {
    lat: (phi * 180) / Math.PI,
    lng: (lng * 180) / Math.PI,
  };
}

interface BdnbBatiment {
  batiment_groupe_id: string;
  geom_groupe: GeoJsonGeometry | null;
  annee_construction?: number | null;
  anneeConstruction?: number | null;
  s_geom_groupe: number | null;
}

interface GeoJsonGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}

/**
 * Calcule la distance² entre un point WGS84 et le centroïde d'un polygone Lambert93.
 * On compare en coordonnées Lambert pour éviter la distorsion.
 */
function centroidDistSqLambert(
  geom: GeoJsonGeometry,
  targetX: number,
  targetY: number
): number {
  const ring =
    geom.type === "Polygon"
      ? (geom.coordinates as number[][][])[0]
      : (geom.coordinates as number[][][][])[0][0];

  if (!ring || ring.length === 0) return Infinity;

  let sumX = 0;
  let sumY = 0;
  for (const [cx, cy] of ring) {
    sumX += cx;
    sumY += cy;
  }
  const cX = sumX / ring.length;
  const cY = sumY / ring.length;

  return (cX - targetX) ** 2 + (cY - targetY) ** 2;
}

/**
 * Extrait tous les anneaux extérieurs (Lambert93) d'une géométrie Polygon ou MultiPolygon.
 */
function extractRingsLambert(geom: GeoJsonGeometry): number[][][] {
  if (geom.type === "Polygon") {
    const ring = (geom.coordinates as number[][][])[0];
    return ring ? [ring] : [];
  }
  if (geom.type === "MultiPolygon") {
    return (geom.coordinates as number[][][][])
      .map((poly) => poly[0])
      .filter(Boolean) as number[][][];
  }
  return [];
}

/**
 * Calcule l'aire d'un anneau Lambert93 (en m²) via la formule de Shoelace.
 * En Lambert93 les coordonnées sont en mètres, donc l'aire est directe.
 */
function ringAreaM2Lambert(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Calcule l'orientation (azimut PVGIS) du plus long côté d'un anneau Lambert93.
 * Convention : 0° = Sud, 90° = Ouest, -90° = Est — identique à calculatePolygonOrientation côté client.
 */
function ringOrientationLambert(ring: number[][]): number | null {
  if (ring.length < 3) return null;

  // Calculer longueur et vecteur de chaque côté
  const sides: { length: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6) continue;
    sides.push({ length, dx, dy });
  }

  if (sides.length === 0) return null;
  const sorted = [...sides].sort((a, b) => b.length - a.length);
  const longest = sorted[0];
  const second = sorted[1];

  let dirX = longest.dx / longest.length;
  let dirY = longest.dy / longest.length;

  if (second && second.length > 0) {
    const dot = longest.dx * second.dx + longest.dy * second.dy;
    const cross = longest.dx * second.dy - longest.dy * second.dx;
    if (Math.abs(cross) < 0.01 * longest.length * second.length) {
      const sx = second.dx / second.length;
      const sy = second.dy / second.length;
      dirX = dot >= 0 ? dirX + sx : dirX - sx;
      dirY = dot >= 0 ? dirY + sy : dirY - sy;
      const n = Math.sqrt(dirX * dirX + dirY * dirY);
      if (n > 1e-6) { dirX /= n; dirY /= n; }
    }
  }

  // En Lambert93 : X = Est, Y = Nord → bearing = atan2(dx, dy) (car Nord = +Y)
  const perp1 = { x: -dirY, y: dirX };
  const perp2 = { x: dirY, y: -dirX };

  const toAzimuth = (px: number, py: number): number => {
    // Angle par rapport au Nord géographique, puis conversion en convention PVGIS
    const bearingDeg = (Math.atan2(px, py) * 180) / Math.PI;
    let az = bearingDeg - 180;
    if (az > 180) az -= 360;
    if (az < -180) az += 360;
    return az;
  };

  const az1 = toAzimuth(perp1.x, perp1.y);
  const az2 = toAzimuth(perp2.x, perp2.y);

  let azC1 = az1 + 90; if (azC1 > 180) azC1 -= 360; if (azC1 < -180) azC1 += 360;
  let azC2 = az1 - 90; if (azC2 > 180) azC2 -= 360; if (azC2 < -180) azC2 += 360;

  const candidates = [az1, az2, azC1, azC2];
  const best = candidates.reduce((min, c) => Math.abs(c) < Math.abs(min) ? c : min);
  return Math.round(best * 10) / 10;
}


/**
 * Batiment BDNB formaté pour le client
 */
interface BdnbBatimentFormatted {
  id: string;
  anneeConstruction: number | null;
  surfaceM2: number | null;
  polygonSurfaces: Array<{
    polygon: Array<{ lat: number; lng: number }>;
    areaM2: number;
    orientation: number | null;
  }>;
  totalAreaM2: number;
}

function getAnneeConstruction(b: BdnbBatiment): number | null {
  const v = b.annee_construction ?? (b as unknown as Record<string, unknown>).anneeConstruction;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchAnneeConstructionFromFfo(
  batimentGroupeId: string,
  center: { x: number; y: number }
): Promise<number | null> {
  const DELTA = 50;
  const url = new URL(BDNB_FFO_BASE);
  url.searchParams.set("xmin", (center.x - DELTA).toFixed(1));
  url.searchParams.set("ymin", (center.y - DELTA).toFixed(1));
  url.searchParams.set("xmax", (center.x + DELTA).toFixed(1));
  url.searchParams.set("ymax", (center.y + DELTA).toFixed(1));
  url.searchParams.set("srid", "2154");
  url.searchParams.set("select", "batiment_groupe_id,annee_construction");
  url.searchParams.set("limit", "10");
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ batiment_groupe_id: string; annee_construction?: number | null }>;
    if (!Array.isArray(data)) return null;
    const row = data.find((r) => r.batiment_groupe_id === batimentGroupeId);
    const v = row?.annee_construction;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function formatBdnbBatiment(b: BdnbBatiment): BdnbBatimentFormatted | null {
  if (!b.geom_groupe) return null;
  const rings = extractRingsLambert(b.geom_groupe);
  if (rings.length === 0) return null;
  const polygonSurfaces = rings.map((ring) => ({
    polygon: ring.map(([x, y]) => lambert93ToWgs84(x, y)),
    areaM2: Math.round(ringAreaM2Lambert(ring)),
    orientation: ringOrientationLambert(ring),
  }));
  const totalAreaM2 = polygonSurfaces.reduce((sum, s) => sum + s.areaM2, 0);
  return {
    id: b.batiment_groupe_id,
    anneeConstruction: getAnneeConstruction(b),
    surfaceM2: b.s_geom_groupe,
    polygonSurfaces,
    totalAreaM2,
  };
}

/**
 * GET /api/bdnb
 *
 * Mode point: ?lat=...&lng=... — retourne le bâtiment le plus proche (comportement existant)
 * Mode bbox: ?swLat=&swLng=&neLat=&neLng= — retourne tous les bâtiments dans la bbox (pour tuiles)
 *
 * Authentification requise (Authorization: Bearer <idToken>).
 * Quotas appliqués selon le statut du profil (admin, premium, starter, demo).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthAndQuota(request, "bdnb");
  if (!authResult.ok) return authResult.response;
  const { uid } = authResult.context;

  const { searchParams } = request.nextUrl;
  const swLatStr = searchParams.get("swLat");
  const swLngStr = searchParams.get("swLng");
  const neLatStr = searchParams.get("neLat");
  const neLngStr = searchParams.get("neLng");
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");

  const isBboxMode =
    swLatStr != null &&
    swLngStr != null &&
    neLatStr != null &&
    neLngStr != null;

  if (isBboxMode) {
    // Mode bbox : tuiles BDNB pour viewport
    const swLat = parseFloat(swLatStr);
    const swLng = parseFloat(swLngStr);
    const neLat = parseFloat(neLatStr);
    const neLng = parseFloat(neLngStr);
    if (
      isNaN(swLat) ||
      isNaN(swLng) ||
      isNaN(neLat) ||
      isNaN(neLng)
    ) {
      return NextResponse.json(
        { error: "swLat, swLng, neLat, neLng doivent être des nombres valides" },
        { status: 400 }
      );
    }
    const sw = wgs84ToLambert93(swLat, swLng);
    const ne = wgs84ToLambert93(neLat, neLng);
    const xmin = Math.min(sw.x, ne.x);
    const ymin = Math.min(sw.y, ne.y);
    const xmax = Math.max(sw.x, ne.x);
    const ymax = Math.max(sw.y, ne.y);

    const url = new URL(BDNB_BASE);
    url.searchParams.set("xmin", xmin.toFixed(1));
    url.searchParams.set("ymin", ymin.toFixed(1));
    url.searchParams.set("xmax", xmax.toFixed(1));
    url.searchParams.set("ymax", ymax.toFixed(1));
    url.searchParams.set("srid", "2154");
    url.searchParams.set(
      "select",
      "batiment_groupe_id,geom_groupe,annee_construction,s_geom_groupe"
    );
    url.searchParams.set("limit", "300");

    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        next: { revalidate: 0 },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[BDNB] Erreur API bbox:", res.status, text);
        return NextResponse.json(
          { error: `Erreur BDNB ${res.status}` },
          { status: res.status }
        );
      }
      const data = (await res.json()) as BdnbBatiment[];
      const withGeom = Array.isArray(data) ? data.filter((b) => b.geom_groupe !== null) : [];
      const batiments = withGeom
        .map((b) => formatBdnbBatiment(b))
        .filter((b): b is BdnbBatimentFormatted => b !== null);
      if (batiments.length >= 300) {
        console.warn("[BDNB] Limite 300 atteinte pour bbox:", {
          swLat,
          swLng,
          neLat,
          neLng,
          nbRetournes: batiments.length,
        });
      }
      incrementQuotaAfterSuccess(uid, "bdnb");
      return NextResponse.json({ batiments });
    } catch (error) {
      console.error("[BDNB] Erreur fetch bbox:", error);
      return NextResponse.json(
        { error: "Erreur lors de la communication avec l'API BDNB" },
        { status: 500 }
      );
    }
  }

  // Mode point : bâtiment le plus proche (comportement existant)
  if (!latStr || !lngStr) {
    return NextResponse.json(
      { error: "lat et lng requis, ou swLat/swLng/neLat/neLng pour le mode bbox" },
      { status: 400 }
    );
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "lat et lng doivent être des nombres valides" },
      { status: 400 }
    );
  }

  const center = wgs84ToLambert93(lat, lng);
  const DELTA_M = 60;
  const url = new URL(BDNB_BASE);
  url.searchParams.set("xmin", (center.x - DELTA_M).toFixed(1));
  url.searchParams.set("ymin", (center.y - DELTA_M).toFixed(1));
  url.searchParams.set("xmax", (center.x + DELTA_M).toFixed(1));
  url.searchParams.set("ymax", (center.y + DELTA_M).toFixed(1));
  url.searchParams.set("srid", "2154");
  url.searchParams.set(
    "select",
    "batiment_groupe_id,geom_groupe,annee_construction,s_geom_groupe"
  );
  url.searchParams.set("limit", "10");

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[BDNB] Erreur API:", res.status, text);
      return NextResponse.json(
        { error: `Erreur BDNB ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const data = (await res.json()) as BdnbBatiment[];

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ batiment: null });
    }

    // Filtrer les bâtiments avec une géométrie valide
    const withGeom = data.filter((b) => b.geom_groupe !== null);

    if (withGeom.length === 0) {
      return NextResponse.json({ batiment: null });
    }

    const nearest = withGeom.reduce((best, current) => {
      const dBest = centroidDistSqLambert(best.geom_groupe!, center.x, center.y);
      const dCurrent = centroidDistSqLambert(current.geom_groupe!, center.x, center.y);
      return dCurrent < dBest ? current : best;
    });

    let formatted = formatBdnbBatiment(nearest);
    if (!formatted) {
      return NextResponse.json({ batiment: null });
    }
    if (formatted.anneeConstruction == null) {
      const anneeFfo = await fetchAnneeConstructionFromFfo(
        formatted.id,
        center
      );
      if (anneeFfo != null) {
        formatted = { ...formatted, anneeConstruction: anneeFfo };
      }
    }
    incrementQuotaAfterSuccess(uid, "bdnb");
    return NextResponse.json({ batiment: formatted });
  } catch (error) {
    console.error("[BDNB] Erreur fetch:", error);
    return NextResponse.json(
      { error: "Erreur lors de la communication avec l'API BDNB" },
      { status: 500 }
    );
  }
}
