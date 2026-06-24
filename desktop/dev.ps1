# One-command dev loop for the desktop app.
#
#   ./desktop/dev.ps1      (from repo root)   — or   npm --prefix desktop run dev:all
#
# Starts the Vite dev server, then launches Electron in dev mode. Electron itself
# spawns the Python backend and loads Vite (:51173) for hot-reload, so this single
# command gives you the full native window with live frontend reload. Backend code
# changes still need a restart (close the window and rerun, or just restart it).
#
# Ctrl+C (or closing the window) tears Vite down; Electron stops the backend it
# spawned on quit. No installer, no PyInstaller — pure source iteration.

$ErrorActionPreference = "Stop"
$desktop = $PSScriptRoot
$root = Split-Path -Parent $desktop

function Wait-Port([int]$port, [int]$timeoutSec = 30) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($c) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

$vite = $null
try {
    if (-not (Test-Path "$root\frontend\node_modules")) {
        Write-Host "[dev] installing frontend deps..." -ForegroundColor Cyan
        Push-Location "$root\frontend"; npm install; Pop-Location
    }
    if (-not (Test-Path "$desktop\node_modules")) {
        Write-Host "[dev] installing desktop deps..." -ForegroundColor Cyan
        Push-Location $desktop; npm install; Pop-Location
    }

    Write-Host "[dev] starting Vite dev server (:51173)..." -ForegroundColor Cyan
    $vite = Start-Process -FilePath "npm.cmd" `
        -ArgumentList @("--prefix", "$root\frontend", "run", "dev") `
        -PassThru -WindowStyle Hidden

    if (-not (Wait-Port 51173 30)) { throw "Vite did not come up on :51173 within 30s" }
    Write-Host "[dev] Vite up. Launching Electron (it spawns the Python backend on :8770/:51080)..." -ForegroundColor Green

    # Foreground — blocks until the Electron window is closed or Ctrl+C.
    Push-Location $desktop
    npm run dev
    Pop-Location
}
finally {
    Write-Host "`n[dev] shutting down Vite..." -ForegroundColor Yellow
    if ($vite) { taskkill /PID $vite.Id /T /F 2>$null | Out-Null }
    # Belt-and-suspenders: kill anything still holding the dev port.
    foreach ($c in (Get-NetTCPConnection -LocalPort 51173 -State Listen -ErrorAction SilentlyContinue)) {
        taskkill /PID $c.OwningProcess /T /F 2>$null | Out-Null
    }
}
