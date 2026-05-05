#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-build}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. https://docs.docker.com/get-docker/"
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "No .env found. Copying .env.example to .env -- EDIT IT before continuing."
    cp .env.example .env
    echo "Open .env in a text editor, set passwords/secrets, then re-run this script."
    exit 1
  fi
  echo "ERROR: .env.example missing."
  exit 1
fi

if grep -q 'replace-with-a-long-random-string' .env; then
  echo "ERROR: .env still has placeholder JWT_SECRET. Edit it before deploying."
  exit 1
fi
if grep -q 'change-me' .env; then
  echo "WARNING: .env still has 'change-me' values. You should set real passwords."
  read -r -p "Continue anyway? (y/N) " resp
  [[ "$resp" == "y" ]] || exit 1
fi

if [[ "$MODE" == "pull" ]]; then
  echo "Pulling images and starting via stack.yml..."
  docker compose -f stack.yml --env-file .env pull
  docker compose -f stack.yml --env-file .env up -d
else
  echo "Building locally and starting via docker-compose.yml..."
  docker compose --env-file .env up -d --build
fi

PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2 || echo 8282)
echo ""
echo "Stack is up. http://localhost:${PORT:-8282}"
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
