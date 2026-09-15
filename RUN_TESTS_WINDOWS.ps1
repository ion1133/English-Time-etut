$ErrorActionPreference = "Stop"
Write-Host "English Time Etut - DESTRUCTIVE disposable database test" -ForegroundColor Yellow
Write-Host "This test DROPS and recreates the public schema. NEVER use your production DATABASE_URL." -ForegroundColor Red
$testUrl = Read-Host "Paste the disposable TEST PostgreSQL URL"
if ([string]::IsNullOrWhiteSpace($testUrl)) { throw "Test PostgreSQL URL is required." }
$env:ETUT_TEST_DATABASE_URL = $testUrl
$env:ETUT_TEST_DESTRUCTIVE = "YES"
Write-Host "Installing locked dependencies..." -ForegroundColor Cyan
npm ci
Write-Host "Running syntax checks..." -ForegroundColor Cyan
npm run test:syntax
Write-Host "Running PostgreSQL integration/concurrency suite..." -ForegroundColor Cyan
npm run test:integration
