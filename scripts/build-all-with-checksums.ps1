# Script de build pour generer la version standard et portable avec checksums SHA256
param([switch]$Clean)

$ErrorActionPreference = "Stop"

Write-Host "StarTrad FR - Build Standard + Portable avec Checksums SHA256" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green

# Verification prerequis
Write-Host "Verification des prerequis..." -ForegroundColor Yellow
try {
    node --version | Out-Null
    pnpm --version | Out-Null
    rustc --version | Out-Null
    Write-Host "[OK] Prerequis OK" -ForegroundColor Green
} catch {
    Write-Error "Prerequis manquants"
    exit 1
}

# Clean si demande
if ($Clean) {
    Write-Host "Nettoyage..." -ForegroundColor Yellow
    if (Test-Path "src-tauri/target") { Remove-Item "src-tauri/target" -Recurse -Force }
    if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
    if (Test-Path "builds") { Remove-Item "builds" -Recurse -Force }
}

# Installation dependances
Write-Host "Installation dependances..." -ForegroundColor Yellow
pnpm install

# Dossier de sortie
$buildsDir = "builds"
if (-not (Test-Path $buildsDir)) { New-Item -ItemType Directory -Path $buildsDir | Out-Null }

# Build version standard
Write-Host ""
Write-Host "BUILD VERSION STANDARD" -ForegroundColor Magenta
Write-Host "======================" -ForegroundColor Magenta
pnpm tauri build --config src-tauri/tauri.conf.json
$standardMsi = Get-ChildItem -Path "src-tauri/target/release/bundle/msi" -Filter "*.msi" | Select-Object -First 1
$standardExe = Get-ChildItem -Path "src-tauri/target/release/bundle/nsis" -Filter "*.exe" | Select-Object -First 1
if ($standardMsi) { 
    Copy-Item $standardMsi.FullName "$buildsDir/$($standardMsi.Name)" -Force
    Write-Host "[OK] MSI copie" -ForegroundColor Green 
}
if ($standardExe) { 
    Copy-Item $standardExe.FullName "$buildsDir/$($standardExe.Name)" -Force
    Write-Host "[OK] EXE copie" -ForegroundColor Green 
}

# Build version portable
Write-Host ""
Write-Host "BUILD VERSION PORTABLE" -ForegroundColor Magenta
Write-Host "======================" -ForegroundColor Magenta
pnpm tauri build --config src-tauri/tauri.portable.conf.json
# Copier l'executable portable
$portableExe = Get-ChildItem -Path "src-tauri/target/release" -Filter "startradfr.exe" | Select-Object -First 1
if ($portableExe) { 
    Copy-Item $portableExe.FullName "$buildsDir/StarTrad_FR-Portable_2.0.2.exe" -Force
    Write-Host "[OK] Executable portable copie" -ForegroundColor Green 
}

# Generation checksums
Write-Host ""
Write-Host "GENERATION CHECKSUMS SHA256" -ForegroundColor Magenta
Write-Host "===========================" -ForegroundColor Magenta
$checksumsFile = "$buildsDir/checksums.txt"
$content = @()
$content += "StarTrad FR - Checksums SHA256"
$content += "Version: 2.0.2"
$content += "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$content += ""
$content += "========================================"
$content += ""

$files = Get-ChildItem -Path $buildsDir -File | Where-Object { $_.Extension -in @('.msi', '.exe') }
foreach ($file in $files) {
    $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLower()
    $content += "$hash  $($file.Name)"
    Write-Host "[OK] $($file.Name): $hash" -ForegroundColor Green
}

$content | Out-File -FilePath $checksumsFile -Encoding UTF8
Write-Host ""
Write-Host "BUILD TERMINE!" -ForegroundColor Green
Write-Host "Fichiers dans: $buildsDir" -ForegroundColor Cyan
Write-Host "Checksums: $checksumsFile" -ForegroundColor Cyan
