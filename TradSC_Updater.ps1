# Charger les assemblys nécessaires
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Fonction pour afficher la liste des contributeurs
function Show-Contributors {
    return @"
Contributeurs:
- Drrakendu78
- Thonelhir
- Woulf2b
"@
}

# Verification des droits d'administrateur
function Test-Admin {
    $currentUser = New-Object Security.Principal.WindowsPrincipal $([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    [System.Windows.Forms.MessageBox]::Show("Ce script necessite des privileges d'administrateur. Redemarrage avec des droits eleves...", "Erreur", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-File `"$($MyInvocation.MyCommand.Path)`""
    exit
}

# Definition de l'encodage de sortie de la console pour supporter les caracteres accentues
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$localization1 = Join-Path $ScriptDir "LIVE"
$localization2 = Join-Path $ScriptDir "PTU"
$localization3 = Join-Path $ScriptDir "TECH-PREVIEW"
$localization4 = Join-Path $ScriptDir "EPTU"  # Ajout de l'option EPTU

# Fonction pour telecharger et copier la traduction
function DownloadAndCopyTranslation {
    param (
        [string]$destinationDir
    )

    $downloadingForm = New-Object System.Windows.Forms.Form
    $downloadingForm.Text = "Telechargement"
    $downloadingForm.Size = New-Object System.Drawing.Size(300, 150)
    $downloadingForm.StartPosition = "CenterScreen"

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Telechargement en cours..."
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(10, 20)
    $downloadingForm.Controls.Add($label)

    $downloadingForm.Show()
    $downloadingForm.Refresh()

    $dataPath = Join-Path (Join-Path $destinationDir "data") "Localization\english"
    if (-not (Test-Path -Path $dataPath -PathType Container)) {
        New-Item -Path $dataPath -ItemType Directory -Force
    }

    $url = "https://traduction.circuspes.fr/download/global.ini"
    
    $response = Invoke-WebRequest -Uri $url -Method Get
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($response.Content)
    $remoteHash = Calculate-MD5Hash -bytes $bytes

    $localFilePath = Join-Path $dataPath "global.ini"
    if (Test-Path $localFilePath) {
        $localContent = [System.IO.File]::ReadAllBytes($localFilePath)
        $localHash = Calculate-MD5Hash -bytes $localContent

        if ($remoteHash -eq $localHash) {
            [System.Windows.Forms.MessageBox]::Show("Le fichier est deja a jour. Aucune action necessaire.", "Information", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
            $downloadingForm.Close()
            return
        }
    }

    try {
        Invoke-WebRequest -Uri $url -OutFile $localFilePath
        [System.Windows.Forms.MessageBox]::Show("Fichier de traduction telecharge avec succes dans $dataPath", "Succes", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    } catch {
        [System.Windows.Forms.MessageBox]::Show("Erreur lors du telechargement du fichier : $_", "Erreur", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }

    $downloadingForm.Close()
}

function Create-Shortcut {
    $desktopPath = [System.Environment]::GetFolderPath('Desktop')
    $shortcutFile = Join-Path $desktopPath "StarCitizen - Translation FR.ps1.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutFile)
    $shortcut.TargetPath = $PSCommandPath
    $shortcut.WorkingDirectory = $ScriptDir
    $shortcut.Save()
    [System.Windows.Forms.MessageBox]::Show("Raccourci cree sur le bureau : $shortcutFile", "Succes", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
}

function Calculate-MD5Hash {
    param (
        [byte[]]$bytes
    )
    $md5 = New-Object System.Security.Cryptography.MD5CryptoServiceProvider
    $hash = $md5.ComputeHash($bytes)
    return [BitConverter]::ToString($hash) -replace '-', ''
}

# Creer le formulaire principal
$form = New-Object System.Windows.Forms.Form
$form.Text = "StarCitizen - Translation FR"
$form.Size = New-Object System.Drawing.Size(361, 258) # largeur = 361, hauteur = 84 + 174
$form.StartPosition = "CenterScreen"

# Ajouter le texte des contributeurs
$labelContributors = New-Object System.Windows.Forms.Label
$labelContributors.Text = Show-Contributors
$labelContributors.Size = New-Object System.Drawing.Size(143, 84)
$labelContributors.Location = New-Object System.Drawing.Point(10, 10)
$labelContributors.Font = New-Object System.Drawing.Font("Courier New", 10)
$form.Controls.Add($labelContributors)

# Ajouter les boutons
$buttons = @(
    @{Text="Traduire la version Live"; Location=[System.Drawing.Point]::new(10, 110); Click={DownloadAndCopyTranslation -destinationDir $localization1}},
    @{Text="Traduire la version PTU"; Location=[System.Drawing.Point]::new(10, 150); Click={DownloadAndCopyTranslation -destinationDir $localization2}},
    @{Text="Traduire la version TECH-PREVIEW"; Location=[System.Drawing.Point]::new(10, 190); Click={DownloadAndCopyTranslation -destinationDir $localization3}},
    @{Text="Traduire la version EPTU"; Location=[System.Drawing.Point]::new(170, 110); Click={DownloadAndCopyTranslation -destinationDir $localization4}},
    @{Text="Creer un raccourci"; Location=[System.Drawing.Point]::new(170, 150); Click={Create-Shortcut}},
    @{Text="Quitter"; Location=[System.Drawing.Point]::new(170, 190); Click={$form.Close()}}
)

foreach ($buttonInfo in $buttons) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $buttonInfo.Text
    $button.Size = New-Object System.Drawing.Size(150, 30)
    $button.Location = $buttonInfo.Location
    $button.Add_Click($buttonInfo.Click)
    $form.Controls.Add($button)
}

# Ajuster les positions des boutons pour correspondre à la nouvelle taille de la fenêtre
$labelContributors.Location = New-Object System.Drawing.Point(10, 10)
$buttons[0].Location = New-Object System.Drawing.Point(10, 100)
$buttons[1].Location = New-Object System.Drawing.Point(10, 140)
$buttons[2].Location = New-Object System.Drawing.Point(10, 180)
$buttons[3].Location = New-Object System.Drawing.Point(170, 100)
$buttons[4].Location = New-Object System.Drawing.Point(170, 140)
$buttons[5].Location = New-Object System.Drawing.Point(170, 180)

# Afficher le formulaire
[void][System.Windows.Forms.Application]::Run($form)
