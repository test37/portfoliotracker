#requires -Version 5.1
<#
.SYNOPSIS
    Deploy the portfoliotracker container.
.EXAMPLE
    .\deploy.ps1                 # build locally and run
    .\deploy.ps1 -Mode pull      # pull from GHCR and run
#>
[CmdletBinding()]
param(
    [ValidateSet('build','pull')]
    [string]$Mode = 'build',
    [int]$HostPort = $(if ($env:HOST_PORT) { [int]$env:HOST_PORT } else { 8080 }),
    [string]$GitHubOwner = $env:GITHUB_OWNER,
    [string]$Tag = $(if ($env:TAG) { $env:TAG } else { 'latest' })
)

$ErrorActionPreference = 'Stop'
$ContainerName = 'portfoliotracker'
$ImageLocal    = 'portfoliotracker:local'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}

Write-Host "🛑 Stopping existing container if present..." -ForegroundColor Yellow
docker rm -f $ContainerName 2>$null | Out-Null

if ($Mode -eq 'pull') {
    if ([string]::IsNullOrWhiteSpace($GitHubOwner)) {
        Write-Host "❌ Provide -GitHubOwner or set `$env:GITHUB_OWNER to pull from GHCR." -ForegroundColor Red
        exit 1
    }
    $Image = "ghcr.io/$GitHubOwner/portfoliotracker:$Tag"
    Write-Host "📥 Pulling $Image..." -ForegroundColor Cyan
    docker pull $Image
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    $Image = $ImageLocal
    Write-Host "🔨 Building $Image locally..." -ForegroundColor Cyan
    docker build -t $Image .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "🚀 Starting container on http://localhost:$HostPort ..." -ForegroundColor Green
docker run -d --name $ContainerName --restart unless-stopped -p "${HostPort}:8080" $Image
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "✅ Deployed. Access: http://localhost:$HostPort" -ForegroundColor Green
Write-Host "   Logs:  docker logs -f $ContainerName"
Write-Host "   Stop:  docker rm -f $ContainerName"
