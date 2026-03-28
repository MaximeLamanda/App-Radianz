#!/usr/bin/env node
/**
 * Test minimal APICarto IGN — module cadastre (parcelle).
 * Doc: https://apicarto.ign.fr/api/doc/cadastre
 *
 * Usage:
 *   node scripts/test-apicarto-cadastre.mjs
 *   node scripts/test-apicarto-cadastre.mjs 01390 AA 17
 *
 * Le numéro de parcelle doit être sur 4 caractères côté API (ex. 17 -> 0017).
 */

const BASE = "https://apicarto.ign.fr/api/cadastre/parcelle";

function padNumero(n) {
  const s = String(n).replace(/\D/g, "");
  return s.length <= 4 ? s.padStart(4, "0") : s.slice(-4);
}

async function main() {
  const codeInsee = process.argv[2] ?? "01390";
  const section = process.argv[3] ?? "AA";
  const numeroRaw = process.argv[4] ?? "17";

  const params = new URLSearchParams({
    code_insee: codeInsee,
    section,
    numero: padNumero(numeroRaw),
  });

  const url = `${BASE}?${params}`;
  console.log("GET", url);

  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    console.error("HTTP", res.status, text.slice(0, 500));
    process.exit(1);
  }

  const geo = JSON.parse(text);
  const n = geo.features?.length ?? 0;
  console.log("type:", geo.type, "| features:", n);

  if (n > 0) {
    const f = geo.features[0];
    const p = f.properties ?? {};
    console.log("idu:", p.idu, "| contenance (ca):", p.contenance);
    console.log("geometry:", f.geometry?.type);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
