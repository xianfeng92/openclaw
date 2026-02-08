# OpenClaw Windows Desktop App - Development Launcher
Write-Host "Starting OpenClaw Desktop (Development Mode)..." -ForegroundColor Cyan
Write-Host ""

# Build the app
Write-Host "Building..." -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Run Electron
Write-Host ""
Write-Host "Launching Electron..." -ForegroundColor Green
pnpm dev
