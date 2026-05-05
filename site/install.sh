#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║     Portfolio Manager Installer       ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not installed!${NC}"
    echo "Install: curl -fsSL https://get.docker.com | sh"
    exit 1
fi
echo -e "${GREEN}✅ Docker found${NC}"

# Create .env if missing
if [ ! -f ".env" ]; then
    cat > .env << 'ENVEOF'
MYSQL_DATABASE=portfolio_db
MYSQL_USER=portfolio_user
MYSQL_PASSWORD=change_this_password
MYSQL_ROOT_PASSWORD=change_this_root_password
JWT_SECRET=change_this_to_random_32_char_string
APP_PORT=8282
ALPHA_VANTAGE_KEY=
ENVEOF
    echo -e "${YELLOW}⚠️  Created .env file${NC}"
    echo -e "${RED}Please edit .env with your values then run this script again!${NC}"
    echo ""
    echo "  nano .env"
    echo ""
    echo "Generate JWT_SECRET with: openssl rand -hex 32"
    exit 1
fi

# Check if passwords are still default
if grep -q "change_this" .env; then
    echo -e "${RED}❌ Please update the default values in .env first!${NC}"
    echo "  nano .env"
    exit 1
fi

export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Create required directories
mkdir -p nginx/conf.d backend/uploads db/init

# Create nginx config
cat > nginx/conf.d/portfolio.conf << 'NGINXEOF'
upstream api { server portfolio_api:4200; }
upstream frontend { server portfolio_frontend:3001; }
server {
    listen 80;
    server_name _;
    client_max_body_size 50M;
    location /api/ {
        proxy_pass http://api/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
    location /uploads/ { alias /var/www/uploads/; }
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
NGINXEOF

# Download docker-compose.prod.yml if not present
if [ ! -f "docker-compose.prod.yml" ]; then
    echo -e "${BLUE}📥 Downloading docker-compose.prod.yml...${NC}"
    curl -sO https://raw.githubusercontent.com/test37/portfolio-backup/main/docker-compose.prod.yml
fi

# Download schema if not present
if [ ! -f "db/init/01_schema.sql" ]; then
    echo -e "${BLUE}📥 Downloading database schema...${NC}"
    curl -s https://raw.githubusercontent.com/test37/portfolio-backup/main/db/init/01_schema.sql -o db/init/01_schema.sql
fi

# Pull and start
echo -e "${BLUE}📥 Pulling images from Docker Hub...${NC}"
docker compose -f docker-compose.prod.yml pull

echo -e "${BLUE}🚀 Starting services...${NC}"
docker compose -f docker-compose.prod.yml up -d

# Wait for DB
echo -e "${BLUE}⏳ Waiting for database...${NC}"
for i in {1..30}; do
    if docker exec portfolio_mariadb healthcheck.sh --connect --innodb_initialized &>/dev/null 2>&1; then
        echo -e "${GREEN}✅ Database ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

sleep 3

# Check services
ALL_OK=1
for svc in portfolio_mariadb portfolio_api portfolio_frontend portfolio_nginx portfolio_worker; do
    if docker ps --filter "name=$svc" --filter "status=running" | grep -q "$svc"; then
        echo -e "${GREEN}  ✅ $svc${NC}"
    else
        echo -e "${RED}  ❌ $svc not running${NC}"
        ALL_OK=0
    fi
done

PORT=${APP_PORT:-8282}
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
if [ $ALL_OK -eq 1 ]; then
    echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║        ✅ Installation Successful!        ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  🌐 App:      ${BLUE}http://${SERVER_IP}:${PORT}${NC}"
    echo -e "  📝 Register: ${BLUE}http://${SERVER_IP}:${PORT}/register${NC}"
    echo ""
    echo "  Next steps:"
    echo "  1. Open the app and click Register"
    echo "  2. Go to Settings to configure email"
    echo "  3. Go to ETF Master to add your ETFs"
    echo "  4. Go to Import to upload statements"
else
    echo -e "${RED}❌ Some services failed. Check logs:${NC}"
    echo "  docker logs portfolio_api"
fi
