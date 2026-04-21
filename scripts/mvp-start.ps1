# VoiceDesk AI - MVP Startup Script (PowerShell)
# Run this after completing the setup steps in MVP-TEST-PLAN.md

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VoiceDesk AI - MVP Test Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (!(Test-Path ".env")) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    Write-Host "Copy .env.mvp to .env and fill in your API keys first." -ForegroundColor Yellow
    exit 1
}

# Check if Docker is running
$dockerRunning = docker info 2>$null
if (!$dockerRunning) {
    Write-Host "ERROR: Docker is not running!" -ForegroundColor Red
    Write-Host "Start Docker Desktop and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/4] Starting database services..." -ForegroundColor Green
docker-compose -f docker-compose.mvp.yml up -d

# Wait for databases to be ready
Write-Host "[2/4] Waiting for databases..." -ForegroundColor Green
Start-Sleep -Seconds 5

# Check if Prisma client needs generation
$prismaClientPath = "node_modules\.prisma\client\index.js"
if (!(Test-Path $prismaClientPath)) {
    Write-Host "[3/4] Generating Prisma client..." -ForegroundColor Green
    pnpm db:generate
}

# Check if database is seeded
Write-Host "[3/4] Checking database setup..." -ForegroundColor Green

# Push schema if needed
pnpm db:push 2>$null

# Run MVP seed
Write-Host "[4/4] Seeding MVP data..." -ForegroundColor Green
pnpm --filter @voicedesk/database db:seed-mvp

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Database ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. In a NEW terminal, start ngrok:" -ForegroundColor White
Write-Host "   ngrok http 3001" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Copy the ngrok HTTPS URL and update .env:" -ForegroundColor White
Write-Host "   API_URL=https://YOUR_NGROK.ngrok-free.app" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Configure Twilio webhook URL:" -ForegroundColor White
Write-Host "   https://YOUR_NGROK.ngrok-free.app/api/calls/incoming" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Start the API server:" -ForegroundColor White
Write-Host "   pnpm --filter @voicedesk/api dev" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Call your Twilio phone number!" -ForegroundColor White
Write-Host ""
