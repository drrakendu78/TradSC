# Test du watcher Game.log : injecte une fausse ligne "Schémas reçu" dans le
# Game.log de Star Citizen LIVE pour valider la détection sans avoir à jouer.
#
# Usage :
#   .\scripts\fake-blueprint.ps1 "Canon laser Omnisky III"
#   .\scripts\fake-blueprint.ps1 "Morozov Legs" -Language en
#   .\scripts\fake-blueprint.ps1 "Pouet Cacahuète" -Path "D:\autre\chemin\Game.log"
#
# Prérequis :
#   - PowerShell EN ADMIN (Program Files protégé en écriture)
#   - Star Citizen NON LANCÉ (sinon fichier locké par le jeu)
#   - StarTrad ouvert avec le watcher démarré (Card "Auto-détection → Démarrer")
#
# /!\ LOCAL ONLY — ne pas commit (ajouté au .gitignore via wildcard scripts/dev/* si tu déplaces).

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [Parameter()]
    [ValidateSet('fr', 'en')]
    [string]$Language = 'fr',

    [Parameter()]
    [string]$Path = 'C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log'
)

if (-not (Test-Path $Path)) {
    Write-Error "Game.log introuvable à $Path. Lance Star Citizen au moins une fois pour le créer, ou passe -Path."
    exit 1
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
# Escapes Unicode pour é et ç — évite le piège du double encoding si le .ps1
# est lu en CP-1252 par PowerShell au lieu d'UTF-8 (cas par défaut sans BOM).
$eAcute = [char]0x00E9
$cCedil = [char]0x00E7
$schemas = 'Sch' + $eAcute + 'mas re' + $cCedil + 'u'
$pattern   = if ($Language -eq 'en') { "Received Blueprint: $Name`:" } else { "$schemas : $Name`:" }
$line      = '<' + $timestamp + '> [Notice] <SHUDEvent_OnNotification> Added notification "' + $pattern + ' " [41] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: []'

# IMPORTANT : Add-Content ne fonctionne pas si le fichier est ouvert en lecture
# par un autre processus (le watcher StarTrad maintient un handle de read en
# continu). On passe par FileStream avec FileShare::ReadWrite pour partager
# l'accès — exactement comme SC le fait quand il écrit ses logs.
$stream = $null
$writer = $null
try {
    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Append,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::ReadWrite
    )
    $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::UTF8)
    $writer.WriteLine($line)
    $writer.Flush()

    Write-Host "[OK] Ligne ajoutée au Game.log ($Language) :" -ForegroundColor Green
    Write-Host "     Schéma  : $Name" -ForegroundColor Cyan
    Write-Host "     Pattern : $pattern" -ForegroundColor DarkGray
    Write-Host "     Path    : $Path" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Le watcher devrait détecter la ligne dans les 200 ms." -ForegroundColor Yellow
} catch {
    Write-Error "Échec d'écriture : $_"
    Write-Host ""
    Write-Host "Causes probables :" -ForegroundColor Yellow
    Write-Host " - PowerShell pas en admin (Program Files = protégé)" -ForegroundColor DarkYellow
    Write-Host " - Star Citizen tourne et locke en exclusif" -ForegroundColor DarkYellow
    exit 1
} finally {
    if ($writer) { $writer.Close() }
    if ($stream) { $stream.Close() }
}
