# portfoliotracker

Full-stack portfolio tracking app. Five containers, all from prebuilt images on GHCR. Deploys via Portainer or plain `docker compose` with no host filesystem dependencies.

## Architecture

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `mariadb` | `ghcr.io/<owner>/portfolio-db` | 3306 (internal) | Database with schema baked in |
| `api` | `ghcr.io/<owner>/portfolio-api` | 4200 (internal) | Express API |
| `worker` | `ghcr.io/<owner>/portfolio-api` | — | Background jobs |
| `frontend` | `ghcr.io/<owner>/portfolio-frontend` | 3000 (internal) | Vite/React build behind nginx |
| `nginx` | `ghcr.io/<owner>/portfolio-nginx` | `${APP_PORT}` (host) | Edge proxy, routes `/` to frontend, `/api/*` to api |

GitHub Actions builds all four images for amd64 + arm64 on every push to `main`. No host bind mounts — everything is in the images.

## Required environment variables

| Name | Example | Required |
|------|---------|----------|
| `GITHUB_OWNER` | `test37` | yes |
| `TAG` | `latest` | no (default `latest`) |
| `APP_PORT` | `8283` | no (default `8282`) |
| `MYSQL_ROOT_PASSWORD` | strong password | yes |
| `MYSQL_DATABASE` | `portfolio_db` | yes |
| `MYSQL_USER` | `portfolio_user` | yes |
| `MYSQL_PASSWORD` | strong password | yes |
| `JWT_SECRET` | 32+ random chars | yes |
| `ALPHA_VANTAGE_KEY` | API key | no |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | mail server config | no (password reset emails won't work without these) |

Generate `JWT_SECRET` with `openssl rand -base64 48`.

## Deploy on a Linux server (CLI)

Requires Docker and the `compose` plugin.

```bash
git clone https://github.com/<owner>/portfoliotracker.git
cd portfoliotracker
cp .env.example .env
nano .env                                # set passwords, JWT_SECRET, etc.
docker compose -f stack.yml --env-file .env pull
docker compose -f stack.yml --env-file .env up -d
```

Open the firewall if needed (RHEL/Rocky example):

```bash
firewall-cmd --add-port=8283/tcp --permanent
firewall-cmd --reload
```

App: `http://<server>:8283`.

## Deploy via Portainer

1. **Stacks → + Add stack**
2. **Name:** `portfoliotracker`
3. **Build method:** Repository
4. **Repository URL:** `https://github.com/<owner>/portfoliotracker`
5. **Compose path:** `stack.yml`
6. Scroll to **Environment variables** and add each variable from the table above
7. **Deploy the stack**

Wait 60–90 seconds for first boot (mariadb initializes the schema). Then visit `http://<server>:<APP_PORT>`.

If your GHCR images are private, also add a registry under **Registries → + Add registry → Custom registry** with URL `ghcr.io` and a GitHub Personal Access Token that has the `read:packages` scope.

## Deploy locally (Windows / macOS)

```powershell
cd portfoliotracker
copy .env.example .env
notepad .env
docker compose pull
docker compose up -d
```

App: `http://localhost:8282` (or whatever `APP_PORT` you set).

## Updating

When new commits land on `main`, GitHub Actions rebuilds the images and updates the `latest` tags. To pull the new images:

**Portainer:** click the stack → **Pull and redeploy**.

**CLI:**
```bash
docker compose -f stack.yml --env-file .env pull
docker compose -f stack.yml --env-file .env up -d
```

## First-use steps inside the app

1. Register an account
2. **Create a portfolio** before trying anything else — most features (including CSV import) require a portfolio to exist first
3. Add holdings, transactions, etc.

## Troubleshooting

**Container `portfoliotracker-mariadb-1` is unhealthy** — Most likely env vars are missing. Verify `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` are all set non-empty. If you redeploy with new vars but the same volume, `docker volume rm portfoliotracker_mariadb_data` first.

**`502 Bad Gateway` from nginx** — One of the upstream containers (api or frontend) isn't running. Check `docker compose ps` and the failing container's logs.

**`ERR_CONNECTION_REFUSED` from your laptop** — Server firewall blocking the port. Open it as shown above.

**Stack name conflict in Portainer** — If you previously deployed via `docker compose` from the CLI, Portainer may show the stack as "Limited control." Delete it (CLI: `docker compose -p portfoliotracker down -v`), remove `/data/compose/<num>` if it lingers, restart Portainer, then redeploy from the UI.

**Import feature does nothing** — Create a portfolio first. Some forms are disabled until a portfolio exists.

**API container restart loops** — Check logs with `docker logs portfoliotracker-api-1`. Usually a database connection issue (mariadb not yet healthy) or missing env var.

## Repo layout

```
portfoliotracker/
├── .github/workflows/deploy.yml  ← builds 4 images on push to main
├── docker-compose.yml            ← local dev (pulls from GHCR)
├── stack.yml                     ← Portainer / production
├── .env.example                  ← template
├── deploy.ps1 / .sh / .bat       ← convenience wrappers (optional)
└── site/
    ├── backend/                  ← Node API + worker (Dockerfile, src/)
    ├── frontend/                 ← Vite/React (Dockerfile, src/)
    ├── db/
    │   ├── Dockerfile            ← extends mariadb:11 with init SQL baked in
    │   └── init/01_schema.sql
    └── nginx/
        ├── Dockerfile            ← extends nginx:alpine with config baked in
        └── conf.d/portfolio.conf ← routes / to frontend, /api/ to api
```

## Backups

The database lives in the named volume `portfoliotracker_mariadb_data`. Backup:

```bash
docker run --rm -v portfoliotracker_mariadb_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/mariadb-$(date +%F).tar.gz -C /data .
```

Restore: stop the stack, remove the volume, recreate from backup, start the stack.

## License

MIT
