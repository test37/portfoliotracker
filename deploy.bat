@echo off
setlocal enabledelayedexpansion

set MODE=%1
if "%MODE%"=="" set MODE=build

where docker >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker is not installed. https://www.docker.com/products/docker-desktop
  exit /b 1
)

if not exist .env (
  if exist .env.example (
    echo No .env found. Copying .env.example to .env -- EDIT IT before continuing.
    copy .env.example .env >nul
    echo Open .env in a text editor, set passwords/secrets, then re-run this script.
    exit /b 1
  )
  echo ERROR: .env.example missing.
  exit /b 1
)

findstr /C:"replace-with-a-long-random-string" .env >nul
if not errorlevel 1 (
  echo ERROR: .env still has placeholder JWT_SECRET. Edit it before deploying.
  exit /b 1
)

if /I "%MODE%"=="pull" (
  echo Pulling images and starting via stack.yml...
  docker compose -f stack.yml --env-file .env pull || exit /b 1
  docker compose -f stack.yml --env-file .env up -d || exit /b 1
) else (
  echo Building locally and starting via docker-compose.yml...
  docker compose --env-file .env up -d --build || exit /b 1
)

echo.
echo Stack is up. Check the APP_PORT setting in your .env for the URL.
echo   Logs:  docker compose logs -f
echo   Stop:  docker compose down
endlocal
