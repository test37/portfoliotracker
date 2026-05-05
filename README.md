# portfoliotracker

Full-stack portfolio tracking app. Five containers:

| Service     | Image                                              | Purpose                          |
|-------------|----------------------------------------------------|----------------------------------|
| `mariadb`   | `mariadb:11`                                       | Database, schema in `site/db/init` |
| `api`       | `ghcr.io/<owner>/portfolio-api:latest`             | Express API, port 4200            |
| `worker`    | same image as api, runs `src/worker/index.js`      | Background jobs                   |
| `frontend`  | `ghcr.io/<owner>/portfolio-frontend:latest`        | Vite/React build behind nginx    |
| `nginx`     | `nginx:alpine`                                     | Edge proxy, exposes `${APP_PORT}` |

GitHub Actions builds `portfolio-api` and `portfolio-frontend` on every push to
`main` and pushes them to GHCR (multi-arch: amd64 + arm64).

## First-time deploy (Windows)

```powershell
cd C:\profile\portfoliotracker

# 1. Remove the leftover wrapper files from the static-site attempt
.\cleanup-old-files.ps1

# 2. Create .env from the template and edit it
copy .env.example .env
notepad .env       # set MYSQL_*, JWT_SECRET, SMTP_*

# 3. Local build + run (no GHCR needed yet)
.\deploy.ps1
```

Visit <http://localhost:8282> (or whatever `APP_PORT` you set).

## After the first push to GitHub

GitHub Actions runs and publishes:

- `ghcr.io/<owner>/portfolio-api:latest`
- `ghcr.io/<owner>/portfolio-frontend:latest`

Once those exist, you can deploy without building:

```powershell
.\deploy.ps1 -Mode pull
```

## Portainer deployment

1. Stacks → Add stack → **Repository**
2. Repository URL: `https://github.com/<OWNER>/portfoliotracker`
3. Compose path: `stack.yml`
4. Environment variables (paste these in the Portainer panel):

   | Name                   | Notes                                  |
   |------------------------|----------------------------------------|
   | `GITHUB_OWNER`         | your GitHub username                   |
   | `TAG`                  | `latest`                               |
   | `APP_PORT`             | host port (e.g. `8282`)                |
   | `PUBLIC_HOST`          | only used by Traefik labels            |
   | `MYSQL_ROOT_PASSWORD`  | strong random                          |
   | `MYSQL_DATABASE`       | e.g. `portfolio_db`                    |
   | `MYSQL_USER`           | e.g. `portfolio_user`                  |
   | `MYSQL_PASSWORD`       | strong random                          |
   | `JWT_SECRET`           | 32+ random chars                       |
   | `ALPHA_VANTAGE_KEY`    | optional                               |
   | `SMTP_HOST` etc.       | from your mail provider                |

5. Deploy.

If your GHCR images are private, also add a Portainer registry:
**Registries → Add registry → GitHub → username + PAT with `read:packages`**.

## Local-only quick start

```powershell
cp .env.example .env       # edit it
docker compose up -d --build
```

`docker compose down` to stop. `docker compose logs -f api` to tail.

## What's where

```
portfoliotracker/
├── .github/workflows/deploy.yml  ← builds + pushes API + frontend to GHCR
├── docker-compose.yml            ← LOCAL: builds from ./site/*
├── stack.yml                     ← PROD/Portainer: pulls from GHCR
├── .env.example                  ← copy to .env
├── deploy.ps1 / .sh / .bat       ← one-command run
├── cleanup-old-files.ps1         ← removes wrong wrapper files (run once)
└── site/                         ← the actual project (untouched)
    ├── backend/                  ← Node API + worker (Dockerfile inside)
    ├── frontend/                 ← Vite/React (Dockerfile inside)
    ├── db/init/01_schema.sql     ← MariaDB init
    ├── nginx/conf.d/             ← edge nginx config
    └── docker-compose.prod.yml   ← original compose, kept for reference
```

## Things to know / honest caveats

- **Database is MariaDB**, not Postgres. The schema in `site/db/init/01_schema.sql` is MariaDB-specific.
- **The original `site/build-push.sh` pushes to Docker Hub**, the new GitHub Actions workflow pushes to GHCR. Pick one — don't run both or you'll have stale images on Docker Hub.
- **The original `docker-compose.prod.yml` doesn't pass SMTP env vars to the API**. The new `stack.yml` and `docker-compose.yml` fix this. Mailer features will only work after this fix.
- **`site/backend/Dockerfile` says `EXPOSE 4100` but the app listens on `PORT=4200`**. Just documentation noise — the app works because PORT is set via env. If you want it tidy, change `EXPOSE 4100` → `EXPOSE 4200` in `site/backend/Dockerfile`.
- **Git's CRLF warnings on push are normal on Windows** and don't break anything. To silence them: `git config --global core.autocrlf true`.
- **Bind mounts (`./site/db/init`, `./site/nginx/conf.d`) work in Portainer** because Portainer git-clones the repo before deploying. They will not work if you copy `stack.yml` to a server without the repo.

## Deploy on any server (single-command, after Actions has run)

```bash
# Server needs Docker + docker compose plugin
git clone https://github.com/<OWNER>/portfoliotracker.git
cd portfoliotracker
cp .env.example .env && nano .env       # set real values
docker compose -f stack.yml --env-file .env pull
docker compose -f stack.yml --env-file .env up -d
```

## Troubleshooting

**`api` container restarts with `connect ECONNREFUSED ... 3306`**
MariaDB is still initializing. Wait 30s; the `depends_on: condition: service_healthy` should handle this, but on slow disks the first boot can exceed the healthcheck retries. Increase `retries` in the compose if needed.

**404 on `/api/...` from the frontend**
Check `site/nginx/conf.d/portfolio.conf` — that's the routing for `/` (frontend) vs `/api` (API). If you renamed services, update upstream names there.

**`No address associated with hostname` on GHCR pull**
Image hasn't been published yet. Push to `main` and wait for Actions to finish (~2–4 min for both jobs). Check progress at `https://github.com/<OWNER>/portfoliotracker/actions`.

**Mailer crashes the API on startup**
Either set real SMTP values in `.env` or comment out the mailer import in `site/backend/src/index.js` until you have one.
