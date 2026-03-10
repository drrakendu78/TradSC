# Script de build pour Microsoft Store - StarTrad FR
# Usage: .\scripts\build-store.ps1

$ErrorActionPreference = "Stop"

Write-Host "StarTrad FR - Build Microsoft Store" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# Définir la variable d'environnement AVANT le build
Write-Host "Configuration: TAURI_ENV_MS_STORE = true" -ForegroundColor Cyan
$env:TAURI_ENV_MS_STORE = "true"

# Vérifier que la variable est bien définie
Write-Host "Verification: TAURI_ENV_MS_STORE = $env:TAURI_ENV_MS_STORE" -ForegroundColor DarkGray

# Lancer le build
Write-Host "Lancement du build..." -ForegroundColor Yellow
try {
    pnpm tauri build --config src-tauri/tauri.microsoftstore.conf.json

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Build termine avec succes !" -ForegroundColor Green
        Write-Host ""
        Write-Host "Le MSI se trouve dans:" -ForegroundColor Cyan
        Write-Host "  src-tauri/target/release/bundle/msi/" -ForegroundColor White
    } else {
        Write-Host "Build echoue avec le code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}
catch {
    Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    # Nettoyage de la variable d'environnement
    Remove-Item env:TAURI_ENV_MS_STORE -ErrorAction SilentlyContinue
}
