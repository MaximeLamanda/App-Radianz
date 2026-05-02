#!/usr/bin/env bash
# Télécharge le stock SIRENE national + les extractions BDNB CSV (millésime 2025-07-a)
# pour 19 départements « Grand Ouest » (Bretagne, Pays de la Loire, Nouvelle-Aquitaine).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${ROOT}/data/west-france"
SIRENE_URL="https://object.files.data.gouv.fr/data-pipeline-open/siren/stock/StockEtablissement_utf8.zip"
BDNB_BASE="https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_2025-07-a"

mkdir -p "${DIR}/sirene" "${DIR}/bdnb_zips"

log() { echo "[$(date -Iseconds)] $*"; }

download_sirene() {
  local out="${DIR}/sirene/StockEtablissement_utf8.zip"
  if [[ -f "$out" ]] && [[ $(stat -f%z "$out" 2>/dev/null || stat -c%s "$out" 2>/dev/null) -gt 1000000000 ]]; then
    log "SIRENE : fichier déjà présent (>1 Go), on saute. Supprimez-le pour retélécharger."
    return 0
  fi
  log "SIRENE : téléchargement (fichier ~2,8 Go, reprise avec -C -)…"
  curl -fL --retry 3 --retry-delay 5 -C - --progress-bar \
    "$SIRENE_URL" -o "$out.part" && mv -f "$out.part" "$out"
  log "SIRENE : terminé -> $out"
}

download_bdnb_dep() {
  local d="$1"
  local depcode
  depcode=$(printf '%02d' "$d")
  local name="open_data_millesime_2025-07-a_dep${depcode}_csv.zip"
  local out="${DIR}/bdnb_zips/${name}"
  local url="${BDNB_BASE}/millesime_2025-07-a_dep${depcode}/${name}"

  if [[ -f "$out" ]] && [[ $(stat -f%z "$out" 2>/dev/null || stat -c%s "$out" 2>/dev/null) -gt 1000000 ]]; then
    log "BDNB dep ${depcode} : déjà présent, saut."
    return 0
  fi
  log "BDNB département ${depcode}…"
  curl -fL --retry 3 --retry-delay 5 -C - --progress-bar \
    "$url" -o "$out.part" && mv -f "$out.part" "$out"
  log "BDNB dep ${depcode} : ok -> $out"
}

# Bretagne, Pays de la Loire, Nouvelle-Aquitaine (hors Corse / DOM)
DEPS=(16 17 22 24 29 33 35 40 44 47 49 53 56 64 72 79 85 86 87)

log "Démarrage téléchargements vers ${DIR}"
download_sirene
for d in "${DEPS[@]}"; do
  download_bdnb_dep "$d"
done
log "Tous les téléchargements sont terminés."
