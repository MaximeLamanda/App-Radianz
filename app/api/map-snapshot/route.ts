import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

const LOAD_TIMEOUT_MS = 20000;
const STABILIZATION_MS = 1500;
const BASE_URL =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

function parseParams(request: NextRequest) {
  const u = new URL(request.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  const zoom = u.searchParams.get("zoom") !== null ? Number(u.searchParams.get("zoom")) : 15;
  const w = u.searchParams.get("w") !== null ? Number(u.searchParams.get("w")) : 400;
  const h = u.searchParams.get("h") !== null ? Number(u.searchParams.get("h")) : 300;
  return { lat, lng, zoom, w, h };
}

function validate(lat: number, lng: number, zoom: number, w: number, h: number): string | null {
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return "Paramètre lat invalide (attendu: -90 à 90)";
  if (Number.isNaN(lng) || lng < -180 || lng > 180) return "Paramètre lng invalide (attendu: -180 à 180)";
  if (Number.isNaN(zoom) || zoom < 0 || zoom > 21) return "Paramètre zoom invalide (attendu: 0 à 21)";
  if (Number.isNaN(w) || w < 100 || w > 1200) return "Paramètre w invalide (attendu: 100 à 1200)";
  if (Number.isNaN(h) || h < 100 || h > 1200) return "Paramètre h invalide (attendu: 100 à 1200)";
  return null;
}

export async function GET(request: NextRequest) {
  const { lat, lng, zoom, w, h } = parseParams(request);
  const err = validate(lat, lng, zoom, w, h);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }

  const snapshotUrl = `${BASE_URL}/snapshot/map?lat=${lat}&lng=${lng}&zoom=${zoom}&w=${w}&h=${h}`;
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: w, height: h },
    });

    await page.goto(snapshotUrl, {
      waitUntil: "networkidle",
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.waitForFunction(
      () => (window as any).__MAP_READY__ === true,
      { timeout: LOAD_TIMEOUT_MS }
    );

    await new Promise((r) => setTimeout(r, STABILIZATION_MS));

    const el = page.locator("#snapshot-map").first();
    await el.waitFor({ state: "visible", timeout: 5000 });

    const buffer = await el.screenshot({
      type: "png",
      timeout: 10000,
    });

    await browser.close();

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    const isTimeout = /timeout|Timeout/i.test(message);
    return NextResponse.json(
      { error: isTimeout ? "Timeout de chargement de la carte ou des tuiles." : message },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
