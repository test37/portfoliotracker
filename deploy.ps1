#requires -Version 5.1
<#
.SYNOPSIS
    Bring the portfoliotracker stack up.
.EXAMPLE
    .\deploy.ps1                # build locally
    .\deploy.ps1 -Mode pull     # pull GHCR images (uses stack.yml)
#>
[CmdletBinding()]
param(
    [ValidateSet('build','pull')]
    [string]$Mode = 'build'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker is not installed. https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}

# Make sure .env exists
if (-not (Test-Path .\.env)) {
    if (Test-Path .\.env.example) {
        Write-Host "No .env found. Copying .env.example to .env -- EDIT IT before continuing." -ForegroundColor Yellow
        Copy-Item .\.env.example .\.env
        Write-Host "Open .env in a text editor, set passwords/secrets, then re-run this script."
        exit 1
    }
    Write-Host "ERROR: .env.example missing." -ForegroundColor Red
    exit 1
}

# Quick sanity: refuse to start if JWT_SECRET still has the placeholder
$envText = Get-Content .\.env -Raw
if ($envText -match 'replace-with-a-long-random-string') {
    Write-Host "ERROR: .env still has placeholder JWT_SECRET. Edit it before deploying." -ForegroundColor Red
    exit 1
}
if ($envText -match 'change-me') {
    Write-Host "WARNING: .env still has 'change-me' values. You should set real passwords." -ForegroundColor Yellow
    $resp = Read-Host "Continue anyway? (y/N)"
    if ($resp -ne 'y') { exit 1 }
}

if ($Mode -eq 'pull') {
    Write-Host "Pulling images and starting via stack.yml..." -ForegroundColor Cyan
    docker compose -f stack.yml --env-file .env pull
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    docker compose -f stack.yml --env-file .env up -d
}
else {
    Write-Host "Building locally and starting via docker-compose.yml..." -ForegroundColor Cyan
    docker compose --env-file .env up -d --build
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Read APP_PORT for the friendly URL
$port = '8282'
foreach ($line in (Get-Content .\.env)) {
    if ($line -match '^APP_PORT=(\S+)') { $port = $matches[1] }
}

Write-Host ""
Write-Host "Stack is up. http://localhost:$port" -ForegroundColor Green
Write-Host "  Logs:  docker compose logs -f"
Write-Host "  Stop:  docker compose down"
