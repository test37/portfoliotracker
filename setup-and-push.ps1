#requires -Version 5.1
<#
.SYNOPSIS
    One-shot setup: copy portfolio files into portfoliotracker, init git,
    wipe-or-create the GitHub repo "portfoliotracker", and push.
.PARAMETER GitHubOwner
    Your GitHub username or organization. Required.
.EXAMPLE
    .\setup-and-push.ps1 -GitHubOwner "yourname"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubOwner,

    [string]$SourcePath = 'C:\profile\portfoliogithub',
    [string]$TargetPath = 'C:\profile\portfoliotracker',
    [string]$RepoName   = 'portfoliotracker',
    [switch]$SkipRepoWipe
)

$ErrorActionPreference = 'Stop'

function Test-Cmd {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: '$Name' is not installed. $Hint" -ForegroundColor Red
        exit 1
    }
}

Test-Cmd 'git' 'Install from https://git-scm.com/download/win'
Test-Cmd 'gh'  'Install GitHub CLI from https://cli.github.com/  then run: gh auth login'

# Verify gh is authenticated
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: GitHub CLI is not authenticated. Run: gh auth login" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $SourcePath)) {
    Write-Host "ERROR: Source folder not found: $SourcePath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $TargetPath)) {
    Write-Host "ERROR: Target folder not found: $TargetPath" -ForegroundColor Red
    Write-Host "       Copy the generated portfoliotracker folder there first." -ForegroundColor Yellow
    exit 1
}

# 1. Copy portfolio files into ./site
$siteDir = Join-Path $TargetPath 'site'
Write-Host "Copying portfolio files to $siteDir" -ForegroundColor Cyan
if (Test-Path $siteDir) { Remove-Item $siteDir -Recurse -Force }
New-Item -ItemType Directory -Path $siteDir | Out-Null

$exclude = @('.git', 'node_modules', '.env', '.env.*', 'dist', 'build', '.next', 'out')
$xdArgs  = @()
foreach ($e in $exclude) { $xdArgs += '/XD'; $xdArgs += $e }
robocopy $SourcePath $siteDir /E /NFL /NDL /NJH /NJS /NP @xdArgs | Out-Null
# robocopy exit codes 0-7 are all success
if ($LASTEXITCODE -ge 8) {
    Write-Host "ERROR: robocopy failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

$indexHits = Get-ChildItem -Path $siteDir -Filter 'index.html' -Recurse -ErrorAction SilentlyContinue
if (-not $indexHits) {
    Write-Host "WARNING: No index.html found in $siteDir. Container will 404 until you add one." -ForegroundColor Yellow
}

# 2. Init / refresh git
Push-Location $TargetPath
try {
    if (Test-Path (Join-Path $TargetPath '.git')) {
        Write-Host "INFO: .git already exists, reusing." -ForegroundColor DarkGray
    }
    else {
        git init -b main | Out-Null
    }

    # 3. Wipe / create remote repo
    $repoFull = "$GitHubOwner/$RepoName"
    $exists = $false
    gh repo view $repoFull *> $null
    if ($LASTEXITCODE -eq 0) { $exists = $true }

    if ($exists -and -not $SkipRepoWipe) {
        Write-Host "Repo $repoFull exists. Deleting and recreating..." -ForegroundColor Yellow
        gh repo delete $repoFull --yes
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Failed to delete repo. Run: gh auth refresh -h github.com -s delete_repo" -ForegroundColor Red
            exit 1
        }
        $exists = $false
    }

    if (-not $exists) {
        Write-Host "Creating repo $repoFull..." -ForegroundColor Cyan
        gh repo create $repoFull --public --confirm | Out-Null
    }

    # 4. Commit and push
    $remoteUrl = "https://github.com/$repoFull.git"
    $hasOrigin = $false
    git remote | ForEach-Object { if ($_ -eq 'origin') { $hasOrigin = $true } }
    if ($hasOrigin) {
        git remote set-url origin $remoteUrl
    }
    else {
        git remote add origin $remoteUrl
    }

    git add -A
    git commit -m "Dockerized portfolio: initial commit" --allow-empty | Out-Null
    git branch -M main
    Write-Host "Pushing to $remoteUrl ..." -ForegroundColor Cyan
    git push -u origin main --force
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("   Repo:  https://github.com/{0}/{1}" -f $GitHubOwner, $RepoName)
Write-Host ("   Image: ghcr.io/{0}/{1}:latest  (after Actions completes)" -f $GitHubOwner, $RepoName)
Write-Host ""
Write-Host ("   Next:  cd {0} ; .\deploy.ps1" -f $TargetPath)
