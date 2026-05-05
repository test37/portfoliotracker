# Portfolio Manager

A self-hosted portfolio management app for tracking investments, dividends, and performance.

## Tech Stack
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- Database: MariaDB
- Proxy: Nginx
- Container: Docker

## Features
- Multi-portfolio support (RRSP, TFSA, LIRA, Non-Registered)
- Real-time prices via Yahoo Finance + Alpha Vantage + dividendhistory.org
- CSV import from Wealthsimple (single and batch multi-file)
- ETF Master List for correct exchange symbol mapping
- Dividend tracking with CASH/REINVESTED classification
- Reports: Cash Flow, Dividend Income, Performance, Dividend Calendar
- ETF Calculator - compare up to 3 ETFs side by side
- 2FA authentication (TOTP authenticator app + Email OTP)
- TFSA contribution room tracking
- Portfolio allocation pie chart by category (Anchor/Booster/Juicer)

## Quick Start

### 1. Clone
git clone https://github.com/test37/portfolio-backup.git
cd portfolio-backup

### 2. Environment Variables
Set these in Portainer or docker-compose:
- DB_PASSWORD=your_secure_password
- DB_ROOT_PASSWORD=your_root_password
- JWT_SECRET=your_long_random_string
- ALPHA_VANTAGE_KEY=your_key (optional, get free at alphavantage.co)

### 3. Start
docker compose up -d

### 4. Access
http://YOUR_SERVER_IP:8282

## First Time Setup
1. Register your account at /register
2. Setup 2FA in Settings (authenticator app recommended)
3. Configure SMTP in Settings for password reset emails
4. Add ETFs to ETF Master List before importing statements
5. Import your Wealthsimple CSV statements

## ETF Master List
IMPORTANT - Add ETFs here before importing CSV statements.
Maps base symbols (GLCL) to exchange symbols (GLCL.TO) for correct price fetching.

## Importing Statements
1. Go to Import page
2. Check ETF Master List first
3. Drag and drop CSV files or click Browse to add files
4. Click Import All Files for batch processing

## Price Sources
1. Yahoo Finance (primary - free)
2. dividendhistory.org (fallback for Canadian ETFs)
3. Alpha Vantage (final fallback - 25 req/day free)

## Categories
- Anchor (blue) - Stable holdings
- Booster (orange) - Growth holdings
- Juicer (green) - High yield holdings

## Useful Commands
docker restart portfolio_api portfolio_frontend
docker logs portfolio_api -f
docker exec portfolio_mariadb mariadb -u portfolio_user -pPASSWORD portfolio_db

## Backup
cd /data/compose/14
git add .
git commit -m "Backup"
git push origin main
