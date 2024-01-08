# V�rification des droits d'administrateur
function Test-Admin {
    $currentUser = New-Object Security.Principal.WindowsPrincipal $([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Warning "Ce script n�cessite des privil�ges d'administrateur. Red�marrage avec des droits �lev�s..."
    Start-Sleep -Seconds 2
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-File `"$($MyInvocation.MyCommand.Path)`""
    exit
}

# D�finition de l'encodage de sortie de la console pour supporter les caract�res accentu�s
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$localization1 = Join-Path $ScriptDir "LIVE"
$localization2 = Join-Path $ScriptDir "PTU"
$localization3 = Join-Path $ScriptDir "TECH-PREVIEW"

# Fonction pour afficher le texte art ASCII
function Show-ASCII-Art {
    Write-Host @"
                           *     .--.
                                / /  `
               +               | |
                      '         \ \__,
                  *          +   '--'  *
                      +   /\
         +              .'  '.   *
                *      /======\      +
                      ;:.  _   ;
                      |:. (_)  |
                      |:.  _   |
            +         |:. (_)  |          *
                      ;:.      ;
                    .' \:.    / `.
                   / .-'':._.'`-. \
                   |/    /||\    \|
             jgs _..--"""````"""--.._
           _.-'``                    ``'-._
         -'                                '-

Contributeur:
-Drrakendu78
-Thonelhir
-Woulf2b

"@
}

function Show-Menu {
    Clear-Host
    Show-ASCII-Art
    Write-Host "Menu :"
    Write-Host "1. Traduire la version Live"
    Write-Host "2. Traduire la version PTU"
    Write-Host "3. Traduire la version TECH-PREVIEW"
    Write-Host "4. Creer un raccourci"
    Write-Host "5. Quitter"
}

function Create-Shortcut {
    $desktopPath = [System.Environment]::GetFolderPath('Desktop')
    $shortcutFile = Join-Path $desktopPath "StarCitizen - Translation FR.ps1.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutFile)
    $shortcut.TargetPath = $PSCommandPath
    $shortcut.WorkingDirectory = $ScriptDir
    $shortcut.Save()
    Write-Host "Raccourci cree sur le bureau : $shortcutFile"
}

function DownloadAndCopyTranslation {
    param (
        [string]$destinationDir
    )

    Clear-Host
    Write-Host "Telechargement en cours..."

    $dataPath = Join-Path (Join-Path $destinationDir "data") "Localization\english"
    if (-not (Test-Path -Path $dataPath -PathType Container)) {
        New-Item -Path $dataPath -ItemType Directory -Force
    }

    $url = "https://raw.githubusercontent.com/drrakendu78/TradSC/main/global.ini"
    
    $response = Invoke-WebRequest -Uri $url -Method Get
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($response.Content)
    $remoteHash = Calculate-MD5Hash -bytes $bytes


    $localFilePath = Join-Path $dataPath "global.ini"
    if (Test-Path $localFilePath) {
        $localContent = [System.IO.File]::ReadAllBytes($localFilePath)
        $localHash = Calculate-MD5Hash -bytes $localContent

        if ($remoteHash -eq $localHash) {
            Write-Host "Le fichier est d�j� � jour. Aucune action n�cessaire."
            Read-Host "Appuyez sur Entr�e pour revenir au menu..."
            return
        }
    }

    try {
        Invoke-WebRequest -Uri $url -OutFile $localFilePath
        Write-Host "Fichier de traduction telecharge avec succes dans $dataPath"
    } catch {
        Write-Host "Erreur lors du t�l�chargement du fichier : $_"
    }
}

function Calculate-MD5Hash {
    param (
        [byte[]]$bytes
    )
    $md5 = New-Object System.Security.Cryptography.MD5CryptoServiceProvider
    $hash = $md5.ComputeHash($bytes)
    return [BitConverter]::ToString($hash) -replace '-', ''
}

while ($true) {
    Show-Menu
    $choice = Read-Host "Choisissez une option"

    switch ($choice) {
        '1' {
            DownloadAndCopyTranslation -destinationDir $localization1
        }
        '2' {
            DownloadAndCopyTranslation -destinationDir $localization2
        }
        '3' {
            DownloadAndCopyTranslation -destinationDir $localization3
        }
        '4' {
            Create-Shortcut
        }
        '5' {
            exit
        }
        default {
            Write-Host "Choix invalide. Veuillez choisir une option valide."
            Read-Host "Appuyez sur Entree pour continuer..."
        }
    }
}
