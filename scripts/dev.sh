#!/bin/bash
# Libère le port 3000 puis lance le serveur Next.js.
# Si le port reste bloqué, propose de lancer sur le port 3001.

cd "$(dirname "$0")/.."

echo "Arrêt des processus sur le port 3000..."
for i in 1 2 3; do
  pids=$(lsof -ti:3000 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "  Tentative $i : processus tués"
    sleep 2
  else
    break
  fi
done

if lsof -i:3000 >/dev/null 2>&1; then
  echo ""
  echo "⚠️  Le port 3000 est encore utilisé (autre terminal ou application)."
  echo "   Lancement sur le port 3001 à la place."
  echo "   Ouvre : http://localhost:3001"
  echo ""
  exec npm run dev:3001
fi

echo "Démarrage du serveur sur http://localhost:3000"
exec npm run dev
