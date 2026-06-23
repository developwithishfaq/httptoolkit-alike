# Convenience dev launcher (Windows): backend in this window, frontend in a new one.
# Usage:  ./scripts/dev.ps1   (run from repo root)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "[dev] installing frontend deps if needed..." -ForegroundColor Cyan
if (-not (Test-Path "$root/frontend/node_modules")) {
    Push-Location "$root/frontend"
    npm install
    Pop-Location
}

Write-Host "[dev] starting Vite (new window) -> http://localhost:5173" -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$root/frontend`"; npm run dev"

Write-Host "[dev] starting backend (this window) -> proxy :8080, web/ws :8770" -ForegroundColor Cyan
Push-Location $root
python -m backend
Pop-Location
