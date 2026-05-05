#!/usr/bin/env bash
# One-command deploy script (Linux / macOS).
# Usage:  ./deploy.sh           # builds locally and runs
#         ./deploy.sh pull      # pulls from GHCR and runs
set -euo pipefail

CONTAINER_NAME="portfoliotracker"
IMAGE_LOCAL="portfoliotracker:local"
HOST_PORT="${HOST_PORT:-8080}"
GITHUB_OWNER="${GITHUB_OWNER:-}"
TAG="${TAG:-latest}"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is not installed. Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

MODE="${1:-build}"

echo "🛑 Stopping any existing container named $CONTAINER_NAME..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

if [[ "$MODE" == "pull" ]]; then
  if [[ -z "$GITHUB_OWNER" ]]; then
    echo "❌ GITHUB_OWNER env var must be set to pull from GHCR (e.g. GITHUB_OWNER=youruser ./deploy.sh pull)"
    exit 1
  fi
  IMAGE="ghcr.io/${GITHUB_OWNER}/portfoliotracker:${TAG}"
  echo "📥 Pulling $IMAGE..."
  docker pull "$IMAGE"
else
  IMAGE="$IMAGE_LOCAL"
  echo "🔨 Building $IMAGE locally..."
  docker build -t "$IMAGE" .
fi

echo "🚀 Starting container on http://localhost:${HOST_PORT}..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:8080" \
  "$IMAGE"

echo ""
echo "✅ Deployed. Access: http://localhost:${HOST_PORT}"
echo "   Logs:  docker logs -f $CONTAINER_NAME"
echo "   Stop:  docker rm -f $CONTAINER_NAME"
