# Chemin vers ta clé privée
$privateKeyPath = "$PSScriptRoot\~\.tauri\key.key"

if (Test-Path $privateKeyPath) {
    $env:TAURI_PRIVATE_KEY = Get-Content $privateKeyPath -Raw
    pnpm tauri build
} else {
    Write-Host "Erreur : Clé privée non trouvée à $privateKeyPath"
}
