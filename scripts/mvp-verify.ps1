# VoiceDesk AI - MVP Verification Script
# Run this to verify everything is set up correctly

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VoiceDesk AI - MVP Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check .env file
Write-Host "Checking .env file..." -ForegroundColor Yellow
if (Test-Path ".env") {
    $envContent = Get-Content ".env" -Raw
    
    $requiredVars = @(
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_PHONE_NUMBER",
        "DEEPGRAM_API_KEY",
        "ELEVENLABS_API_KEY",
        "OPENAI_API_KEY",
        "DATABASE_URL",
        "REDIS_URL",
        "API_URL"
    )
    
    foreach ($var in $requiredVars) {
        if ($envContent -match "$var=`"[^`"]+`"") {
            Write-Host "  [OK] $var" -ForegroundColor Green
        } elseif ($envContent -match "$var=[^`"\s]+") {
            Write-Host "  [OK] $var" -ForegroundColor Green
        } else {
            Write-Host "  [MISSING] $var" -ForegroundColor Red
            $allGood = $false
        }
    }
} else {
    Write-Host "  [MISSING] .env file not found!" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check Docker containers
Write-Host "Checking Docker containers..." -ForegroundColor Yellow
$postgres = docker ps --filter "name=voicedesk-postgres" --format "{{.Status}}" 2>$null
$redis = docker ps --filter "name=voicedesk-redis" --format "{{.Status}}" 2>$null

if ($postgres -match "Up") {
    Write-Host "  [OK] PostgreSQL is running" -ForegroundColor Green
} else {
    Write-Host "  [DOWN] PostgreSQL not running" -ForegroundColor Red
    $allGood = $false
}

if ($redis -match "Up") {
    Write-Host "  [OK] Redis is running" -ForegroundColor Green
} else {
    Write-Host "  [DOWN] Redis not running" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check API health
Write-Host "Checking API server..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Host "  [OK] API is responding" -ForegroundColor Green
    } else {
        Write-Host "  [ERROR] API returned status $($response.StatusCode)" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "  [DOWN] API not responding (is it running?)" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check ngrok
Write-Host "Checking ngrok tunnel..." -ForegroundColor Yellow
if (Test-Path ".env") {
    $apiUrl = (Get-Content ".env" | Where-Object { $_ -match "API_URL=" }) -replace "API_URL=", "" -replace '"', ''
    
    if ($apiUrl -match "ngrok") {
        try {
            $ngrokResponse = Invoke-WebRequest -Uri "$apiUrl/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($ngrokResponse.StatusCode -eq 200) {
                Write-Host "  [OK] ngrok tunnel working: $apiUrl" -ForegroundColor Green
            }
        } catch {
            Write-Host "  [ERROR] ngrok tunnel not reachable at $apiUrl" -ForegroundColor Red
            $allGood = $false
        }
    } elseif ($apiUrl -match "localhost") {
        Write-Host "  [WARNING] API_URL is localhost - Twilio won't work!" -ForegroundColor Yellow
        Write-Host "           Update API_URL in .env with your ngrok URL" -ForegroundColor Yellow
        $allGood = $false
    } else {
        Write-Host "  [WARNING] API_URL not set or invalid" -ForegroundColor Yellow
        $allGood = $false
    }
}

Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "All checks passed! Ready to test." -ForegroundColor Green
    Write-Host ""
    Write-Host "Call your Twilio phone number to test!" -ForegroundColor White
} else {
    Write-Host "Some checks failed. Fix the issues above." -ForegroundColor Red
    Write-Host ""
    Write-Host "See MVP-TEST-PLAN.md for setup instructions." -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan
