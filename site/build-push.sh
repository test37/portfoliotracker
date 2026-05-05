#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

DOCKER_USER="test37"
VERSION=${1:-latest}

echo -e "${BLUE}🔨 Building Portfolio Manager images...${NC}"
echo -e "${BLUE}Version: ${VERSION}${NC}"
echo ""

# Build API image
echo -e "${BLUE}📦 Building API image...${NC}"
docker build -t ${DOCKER_USER}/portfolio-api:${VERSION} ./backend
docker tag ${DOCKER_USER}/portfolio-api:${VERSION} ${DOCKER_USER}/portfolio-api:latest
echo -e "${GREEN}✅ API image built${NC}"

# Build Frontend image
echo -e "${BLUE}📦 Building Frontend image...${NC}"
docker build -t ${DOCKER_USER}/portfolio-frontend:${VERSION} ./frontend
docker tag ${DOCKER_USER}/portfolio-frontend:${VERSION} ${DOCKER_USER}/portfolio-frontend:latest
echo -e "${GREEN}✅ Frontend image built${NC}"

# Push images
echo ""
echo -e "${BLUE}🚀 Pushing images to Docker Hub...${NC}"
docker push ${DOCKER_USER}/portfolio-api:${VERSION}
docker push ${DOCKER_USER}/portfolio-api:latest
echo -e "${GREEN}✅ API pushed${NC}"

docker push ${DOCKER_USER}/portfolio-frontend:${VERSION}
docker push ${DOCKER_USER}/portfolio-frontend:latest
echo -e "${GREEN}✅ Frontend pushed${NC}"

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ✅ Images pushed to Docker Hub!       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "Images available at:"
echo "  🐳 https://hub.docker.com/r/${DOCKER_USER}/portfolio-api"
echo "  🐳 https://hub.docker.com/r/${DOCKER_USER}/portfolio-frontend"
echo ""
echo "To deploy on any server:"
echo "  1. Copy docker-compose.prod.yml and .env.example"
echo "  2. Create .env with your values"
echo "  3. Run: docker compose -f docker-compose.prod.yml up -d"
