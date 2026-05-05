#!/usr/bin/env bash
# Transfert Postgres local (docker-compose.yml) → Neon (URL unpooled dans .env.local).
#
# Modes (NEON_TRANSFER_MODE) :
#   full         — dump + pg_restore complet (défaut).
#   no-indexes   — dump + schéma + données SANS index (contraintes FK légères en post-data : voir note).
#   indexes-only — uniquement --section=post-data (besoin d’un dump existant ; voir NEON_TRANSFER_DUMP).
#
# NEON_TRANSFER_DUMP   — pour indexes-only : chemin relatif au repo (ex. var/foo.dump) ou absolu.
# NEON_TRANSFER_SKIP_DUMP=1 — avec indexes-only : ne pas redumper (déjà implicite).
# NEON_DUMP_EXCLUDE_TIGER=1 — pg_dump sans schémas tiger/tiger_data (souvent inutiles pour l’app, dump plus léger).
# NEON_PG_RESTORE_IMAGE — défaut 16 (aligné postgis/postgis:16-3.4).
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [[ -n "${DOCKER_BIN:-}" && -x "${DOCKER_BIN}/docker" ]]; then
  export PATH="${DOCKER_BIN}:$PATH"
elif [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODE="${NEON_TRANSFER_MODE:-full}"
PG_RESTORE_IMG="${NEON_PG_RESTORE_IMAGE:-16}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker introuvable. Ouvre Docker Desktop, ou :" >&2
  echo "  export PATH=\"/Applications/Docker.app/Contents/Resources/bin:\$PATH\"" >&2
  exit 1
fi

USE_HOST_PG=false
if command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then
  USE_HOST_PG=true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node introuvable." >&2
  exit 1
fi

ENV_LOCAL="$ROOT/.env.local"
if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "Fichier manquant : $ENV_LOCAL" >&2
  exit 1
fi

NEON_UNPOOLED="$(node <<'NODE'
const fs = require("fs");
const path = ".env.local";
const t = fs.readFileSync(path, "utf8");
const prefix = "Radianz_DATABASE_URL_UNPOOLED=";
for (const line of t.split(/\r?\n/)) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  if (s.startsWith(prefix)) {
    let v = s.slice(prefix.length).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.stdout.write(v);
    process.exit(0);
  }
}
process.stderr.write("Radianz_DATABASE_URL_UNPOOLED introuvable dans .env.local\n");
process.exit(1);
NODE
)"
if [[ -z "$NEON_UNPOOLED" ]]; then
  exit 1
fi

resolve_dump_for_indexes_only() {
  if [[ -n "${NEON_TRANSFER_DUMP:-}" ]]; then
    local d="$NEON_TRANSFER_DUMP"
    if [[ -f "$d" ]]; then DUMP="$d"; return; fi
    if [[ -f "$ROOT/$d" ]]; then DUMP="$ROOT/$d"; return; fi
    if [[ -f "$ROOT/var/$d" ]]; then DUMP="$ROOT/var/$d"; return; fi
    echo "Dump introuvable : $NEON_TRANSFER_DUMP" >&2
    exit 1
  fi
  local latest
  latest=$(ls -t "$ROOT"/var/solar-view-transfer-*.dump 2>/dev/null | head -1 || true)
  if [[ -z "$latest" || ! -f "$latest" ]]; then
    echo "Aucun var/solar-view-transfer-*.dump. Lance d’abord npm run neon:transfer:no-indexes ou :" >&2
    echo "  NEON_TRANSFER_DUMP=var/ton-fichier.dump npm run neon:transfer:indexes" >&2
    exit 1
  fi
  DUMP="$latest"
}

pg_restore_docker() {
  local section="${1:-}"
  local dump_dir dump_base
  dump_dir="$(dirname "$DUMP")"
  dump_base="$(basename "$DUMP")"
  local args=(--no-owner --no-acl --verbose -d "$NEON_UNPOOLED")
  if [[ -n "$section" ]]; then
    args+=(--section="$section")
  fi
  args+=("/dump/${dump_base}")
  docker run --rm \
    -v "${dump_dir}:/dump:ro" \
    --entrypoint pg_restore \
    "postgres:${PG_RESTORE_IMG}" \
    "${args[@]}"
}

pg_restore_host() {
  local section="${1:-}"
  if [[ -n "$section" ]]; then
    pg_restore --no-owner --no-acl --verbose --section="$section" -d "$NEON_UNPOOLED" "$DUMP"
  else
    pg_restore --no-owner --no-acl --verbose -d "$NEON_UNPOOLED" "$DUMP"
  fi
}

run_pg_restore() {
  local section="${1:-}"
  if [[ "$USE_HOST_PG" == true ]]; then
    pg_restore_host "$section"
  else
    pg_restore_docker "$section"
  fi
}

# --- indexes-only : pas de dump -------------------------------------------------
if [[ "$MODE" == "indexes-only" ]]; then
  resolve_dump_for_indexes_only
  echo "[indexes-only] pg_restore --section=post-data ($DUMP)…"
  run_pg_restore post-data
  echo "Terminé (index / contraintes post-data)."
  exit 0
fi

# --- dump + restore -------------------------------------------------------------
echo "[1] Docker compose up…"
docker compose up -d

mkdir -p "$ROOT/var"
DUMP="$ROOT/var/solar-view-transfer-$(date +%Y%m%d-%H%M%S).dump"

DUMP_EXCLUDE=()
if [[ "${NEON_DUMP_EXCLUDE_TIGER:-}" == "1" ]]; then
  DUMP_EXCLUDE+=(--exclude-schema=tiger --exclude-schema=tiger_data)
  echo "(pg_dump sans tiger / tiger_data — NEON_DUMP_EXCLUDE_TIGER=1)"
fi

if [[ "$USE_HOST_PG" == true ]]; then
  echo "[2] pg_dump local (hôte → $DUMP)…"
  export PGHOST="${PGHOST:-127.0.0.1}"
  export PGPORT="${PGPORT:-5433}"
  export PGUSER="${PGUSER:-bdnb}"
  export PGDATABASE="${PGDATABASE:-bdnb_local}"
  export PGPASSWORD="${PGPASSWORD:-bdnb}"
  pg_dump -Fc -f "$DUMP" "${DUMP_EXCLUDE[@]}"
else
  echo "[2] pg_dump via conteneur postgres-bdnb → $DUMP…"
  docker compose exec -T postgres-bdnb pg_dump -U bdnb -d bdnb_local -Fc "${DUMP_EXCLUDE[@]}" >"$DUMP"
fi

REL_FOR_MSG="${DUMP#"$ROOT/"}"

if [[ "$MODE" == "full" ]]; then
  echo "[3] pg_restore complet vers Neon…"
  run_pg_restore ""
elif [[ "$MODE" == "no-indexes" ]]; then
  echo "[3a] pg_restore --section=pre-data…"
  run_pg_restore pre-data
  echo "[3b] pg_restore --section=data…"
  run_pg_restore data
  echo ""
  echo "Schéma + données envoyés (sans phase post-data : pas d’index / contraintes / triggers de cette section)."
  echo "Après hausse du quota Neon (ou allègement) :"
  echo "  NEON_TRANSFER_DUMP=$REL_FOR_MSG npm run neon:transfer:indexes"
else
  echo "NEON_TRANSFER_MODE inconnu : $MODE (attendu: full | no-indexes | indexes-only)" >&2
  exit 1
fi

echo "Terminé. Dump : $DUMP"
echo "Vérif : compter les lignes sur Neon (psql ou console SQL)."
