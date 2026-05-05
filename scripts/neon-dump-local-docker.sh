#!/usr/bin/env bash
# Dump Postgres local (docker-compose.yml : postgres-bdnb, port 5433).
# Usage : ./scripts/neon-dump-local-docker.sh [chemin-sortie.dump]
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [[ -n "${DOCKER_BIN:-}" && -x "${DOCKER_BIN}/docker" ]]; then
  export PATH="${DOCKER_BIN}:$PATH"
elif [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-${ROOT}/var/solar-view-bdnb_local-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"

if command -v pg_dump >/dev/null 2>&1; then
  export PGHOST="${PGHOST:-127.0.0.1}"
  export PGPORT="${PGPORT:-5433}"
  export PGUSER="${PGUSER:-bdnb}"
  export PGDATABASE="${PGDATABASE:-bdnb_local}"
  export PGPASSWORD="${PGPASSWORD:-bdnb}"
  echo "Dump : $OUT ($PGUSER@$PGHOST:$PGPORT/$PGDATABASE)"
  pg_dump -Fc -f "$OUT"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "pg_dump introuvable et Docker absent. macOS : brew install libpq, ou ouvre Docker Desktop." >&2
    exit 1
  fi
  echo "Dump via conteneur postgres-bdnb → $OUT"
  docker compose up -d >/dev/null
  docker compose exec -T postgres-bdnb pg_dump -U bdnb -d bdnb_local -Fc >"$OUT"
fi

echo "OK."
echo "Restaurer sur Neon (URL directe / unpooled) :"
echo "  pg_restore --no-owner --no-acl --verbose -d \"\$NEON_RESTORE_URL\" \"$OUT\""
echo "Voir docs/NEON-MIGRATION-DOCKER.md"
