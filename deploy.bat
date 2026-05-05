@echo off
setlocal enabledelayedexpansion

set CONTAINER_NAME=portfoliotracker
set IMAGE_LOCAL=portfoliotracker:local
if "%HOST_PORT%"=="" set HOST_PORT=8080
if "%TAG%"=="" set TAG=latest

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop
  exit /b 1
)

set MODE=%1
if "%MODE%"=="" set MODE=build

echo Stopping existing container if present...
docker rm -f %CONTAINER_NAME% >nul 2>&1

if /I "%MODE%"=="pull" (
  if "%GITHUB_OWNER%"=="" (
    echo [ERROR] Set GITHUB_OWNER to pull from GHCR.   Example:   set GITHUB_OWNER=youruser ^&^& deploy.bat pull
    exit /b 1
  )
  set IMAGE=ghcr.io/%GITHUB_OWNER%/portfoliotracker:%TAG%
  echo Pulling !IMAGE!...
  docker pull !IMAGE! || exit /b 1
) else (
  set IMAGE=%IMAGE_LOCAL%
  echo Building !IMAGE! locally...
  docker build -t !IMAGE! . || exit /b 1
)

echo Starting container on http://localhost:%HOST_PORT% ...
docker run -d --name %CONTAINER_NAME% --restart unless-stopped -p %HOST_PORT%:8080 !IMAGE! || exit /b 1

echo.
echo Deployed. Access: http://localhost:%HOST_PORT%
echo   Logs:  docker logs -f %CONTAINER_NAME%
echo   Stop:  docker rm -f %CONTAINER_NAME%
endlocal
