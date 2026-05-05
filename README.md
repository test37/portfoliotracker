# portfoliotracker

Containerized static portfolio site. Built on `nginx:alpine` (~25 MB image), runs
as a non-root user, ships with a `/healthz` endpoint, and publishes to GitHub
Container Registry on every push to `main`.

## Quick start

```bash
docker run -d -p 80:8080 --name portfoliotracker ghcr.io/YOUR_GITHUB_USERNAME/portfoliotracker:latest
```

Then open <http://localhost>.

## Prerequisites

Just **Docker**. That's it.
- Windows / macOS: <https://www.docker.com/products/docker-desktop>
- Linux: <https://docs.docker.com/engine/install/>

For the GitHub workflow you'll also need:
- A GitHub account
- [GitHub CLI (`gh`)](https://cli.github.com/) — only for the one-shot setup script
- Git

## Project layout

```
portfoliotracker/
├── site/                   ← your portfolio files go here (index.html, css, js, …)
├── Dockerfile
├── nginx.conf
├── docker-compose.yml
├── stack.yml               ← Portainer stack
├── .dockerignore
├── .env.example
├── .github/workflows/deploy.yml
├── deploy.sh / .bat / .ps1 ← one-command run scripts
├── setup-and-push.ps1      ← Windows: copy files + push to GitHub
└── README.md
```

## First-time setup (Windows, automated)

1. Drop the `portfoliotracker` folder at `C:\profile\portfoliotracker`.
2. Make sure your portfolio source is at `C:\profile\portfoliogithub`.
3. Authenticate the GitHub CLI once, with permission to delete repos:
   ```powershell
   gh auth login
   gh auth refresh -h github.com -s delete_repo
   ```
4. Run:
   ```powershell
   cd C:\profile\portfoliotracker
   .\setup-and-push.ps1 -GitHubOwner "your-github-username"
   ```

The script copies your site into `./site/`, wipes any existing `portfoliotracker`
repo, creates a fresh one, and pushes. GitHub Actions builds and pushes the
image to `ghcr.io/your-username/portfoliotracker:latest` on its own.

> **Heads-up:** the script force-pushes and deletes the existing repo if it
> exists. Pass `-SkipRepoWipe` to keep the repo and just push over the top.

## Manual setup (any OS)

```bash
# 1. Put your portfolio files in ./site
mkdir site && cp -r /path/to/your/portfolio/* site/

# 2. Build and run locally
docker compose up -d --build

# 3. Or just docker-run
docker build -t portfoliotracker:local .
docker run -d -p 8080:8080 --name portfoliotracker portfoliotracker:local
```

Visit <http://localhost:8080>.

## One-command deploy scripts

| OS              | Command                              |
|-----------------|--------------------------------------|
| Linux / macOS   | `./deploy.sh` (build) or `./deploy.sh pull` |
| Windows cmd     | `deploy.bat` or `deploy.bat pull`    |
| PowerShell      | `.\deploy.ps1` or `.\deploy.ps1 -Mode pull` |

For `pull` mode, set `GITHUB_OWNER` first (e.g. `export GITHUB_OWNER=youruser`).

## GitHub token setup

The included GitHub Actions workflow uses the **automatically provided
`GITHUB_TOKEN`** — you don't create or paste anything. It just works once you
push the repo.

If you want to publish from your laptop instead of CI:

```bash
# Create a Personal Access Token with 'write:packages' scope at
# https://github.com/settings/tokens, then:
echo $YOUR_PAT | docker login ghcr.io -u YOUR_USERNAME --password-stdin
docker build -t ghcr.io/YOUR_USERNAME/portfoliotracker:latest .
docker push ghcr.io/YOUR_USERNAME/portfoliotracker:latest
```

## Portainer / stacker deployment

In Portainer:

1. **Stacks → Add stack → Repository**
2. Repository URL: `https://github.com/YOUR_USERNAME/portfoliotracker`
3. Compose path: `stack.yml`
4. Environment variables:
   | Name           | Value                            |
   |----------------|----------------------------------|
   | `GITHUB_OWNER` | your GitHub username             |
   | `TAG`          | `latest`                         |
   | `HOST_PORT`    | `8080` (or whatever you want)    |
   | `PUBLIC_HOST`  | `portfolio.example.com` (Traefik) |
5. **Deploy the stack**.

If the image is private, also add Portainer → **Registries → Add registry →
GitHub** with a PAT that has `read:packages`.

## Troubleshooting

**Container exits immediately**
`docker logs portfoliotracker` — usually means `./site/` is empty or has no
`index.html`.

**404 for client-side routes (React Router etc.)**
The default `nginx.conf` already falls back to `index.html`. If you removed
that, restore the `try_files $uri $uri/ /index.html;` line.

**Permission errors writing to `/var/run/nginx.pid`**
You're running an older base image. Rebuild — the current Dockerfile chowns the
pid file before `USER nginx`.

**`gh repo delete` fails with "missing scope"**
Run `gh auth refresh -h github.com -s delete_repo` and try again.

**Image is bigger than expected**
Check `.dockerignore`. Common culprit: `node_modules` getting copied into
`./site/`.

## What about a build step?

If your portfolio needs `npm run build` (Vite, CRA, Next static export, etc.):

1. Open `Dockerfile` and uncomment the **Stage 1: build** block at the top.
2. Change the runtime `COPY` line from
   `COPY --chown=nginx:nginx ./site/ /usr/share/nginx/html/`
   to
   `COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html` (or `/app/build` for CRA).
3. Put your source — including `package.json` — at the project root instead of inside `./site/`.

That's the only change.

## License

MIT
