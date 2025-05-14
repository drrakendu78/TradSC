# Chemin vers ta clé privée
$privateKeyPath = "$PSScriptRoot\~\.tauri\key.key"

if (Test-Path $privateKeyPath) {
    Write-Host "Clé privée trouvée à $privateKeyPath"
    Write-Host "Configuration de la variable d'environnement..."
    $env:TAURI_PRIVATE_KEY = Get-Content $privateKeyPath -Raw
    
    Write-Host "Installation des dépendances..."
    npm install

    Write-Host "Construction de l'application..."
    npm run tauri build
} else {
    Write-Host "Erreur : Clé privée non trouvée à $privateKeyPath"
    Write-Host "Assurez-vous d'avoir une clé privée dans le dossier ~\.tauri"
}
