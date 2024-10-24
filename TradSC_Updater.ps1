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

# Vérification des droits d'administrateur
function Test-Admin {
    $currentUser = New-Object Security.Principal.WindowsPrincipal $([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    [System.Windows.Forms.MessageBox]::Show("Ce script nécessite des privilèges d'administrateur. Redémarrage avec des droits élevés...", "Erreur", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-File `"$($MyInvocation.MyCommand.Path)`""
    exit
}

# Définition de l'encodage de sortie de la console pour supporter les caractères accentués
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Définir les répertoires de localisation
$localization1 = Join-Path $ScriptDir "LIVE"
$localization2 = Join-Path $ScriptDir "PTU"
$localization3 = Join-Path $ScriptDir "TECH-PREVIEW"
$localization4 = Join-Path $ScriptDir "EPTU"

# Fonction pour télécharger et copier la traduction
function DownloadAndCopyTranslation {
    param (
        [string]$destinationDir
    )

    if (-not $destinationDir) {
        Write-Host "Le répertoire de destination est vide."
        return
    }

    $downloadingForm = New-Object System.Windows.Forms.Form
    $downloadingForm.Text = "Téléchargement"
    $downloadingForm.Size = New-Object System.Drawing.Size(300, 150)
    $downloadingForm.StartPosition = "CenterScreen"

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Téléchargement en cours..."
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(10, 20)
    $downloadingForm.Controls.Add($label)

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Style = 'Continuous'
    $progressBar.Minimum = 0
    $progressBar.Maximum = 100
    $progressBar.Value = 0
    $progressBar.Size = New-Object System.Drawing.Size(250, 20)
    $progressBar.Location = New-Object System.Drawing.Point(10, 50)
    $downloadingForm.Controls.Add($progressBar)

    $downloadingForm.Show()
    $downloadingForm.Refresh()

    $dataPath = Join-Path (Join-Path $destinationDir "data") "Localization\english"
    if (-not (Test-Path -Path $dataPath -PathType Container)) {
        New-Item -Path $dataPath -ItemType Directory -Force
    }

    $localFilePath = Join-Path $dataPath "global.ini"
    $url = "https://traduction.circuspes.fr/download/global.ini"

    if ($destinationDir -eq $localization2) {
        $url = "https://traduction.circuspes.fr/download_ptu/global.ini"
    }

    try {
        Write-Host "Téléchargement depuis l'URL : $url"
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($url, $localFilePath)
        [System.Windows.Forms.MessageBox]::Show("Fichier de traduction téléchargé avec succès dans $dataPath", "Succès", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    } catch {
        Write-Host "Erreur lors du téléchargement : $_"
        [System.Windows.Forms.MessageBox]::Show("Erreur lors du téléchargement du fichier : $_", "Erreur", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    } finally {
        $downloadingForm.Close()
    }
}

# Chemin vers le logo local
$logoFileName = "1-2ESC_Final.png"
$logoPath = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $logoFileName

# URL du logo sur GitHub
$githubLogoUrl = "https://raw.githubusercontent.com/drrakendu78/TradSC/refs/heads/main/1-2ESC_Final.png"

# Chemin vers l'image de fond locale
$backgroundFileName = "background.jpg"
$backgroundPath = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath $backgroundFileName

# URL de l'image de fond sur GitHub
$githubBackgroundUrl = "https://raw.githubusercontent.com/drrakendu78/TradSC/refs/heads/main/test.jpg"

# URL de l'icône
$iconUrl = "https://raw.githubusercontent.com/drrakendu78/TradSC/refs/heads/main/1-2ESC_Final.ico"
$iconPath = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath "1-2ESC_Final.ico"

# Telecharger le logo si necessaire
if (-not (Test-Path -Path $logoPath)) {
    try {
        Write-Host "Telechargement du logo depuis GitHub..."
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($githubLogoUrl, $logoPath)
        Write-Host "Logo telecharge avec succes."
    } catch {
        Write-Host "Erreur lors du telechargement du logo : $_"
    }
}

# Supprimer et telecharger l'image de fond a chaque lancement
try {
    if (Test-Path -Path $backgroundPath) {
        Remove-Item -Path $backgroundPath
    }
    Write-Host "Telechargement de l'image de fond depuis GitHub..."
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($githubBackgroundUrl, $backgroundPath)
    Write-Host "Image de fond telechargee avec succes."
} catch {
    Write-Host "Erreur lors du telechargement de l'image de fond : $_"
}

# Fonction pour creer un raccourci
function Create-Shortcut {
    # Telecharger l'icone
    try {
        Write-Host "Telechargement de l'icone depuis GitHub..."
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($iconUrl, $iconPath)
        Write-Host "Icone telechargee avec succes."
    } catch {
        Write-Host "Erreur lors du telechargement de l'icone : $_"
        return
    }

    $basePath = Join-Path -Path $env:ProgramFiles -ChildPath "Roberts Space Industries\StarCitizen"
    $scriptPath = Join-Path -Path $basePath -ChildPath "TradSC_Updater.ps1"

    if (-not (Test-Path -Path $scriptPath)) {
        Write-Host "Le script TradSC_Updater.ps1 n'a pas ete trouve."
        return
    }

    $shortcutPath = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'StarCitizen - Translation FR.lnk')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $scriptPath
    $shortcut.IconLocation = $iconPath
    $shortcut.Save()
    Write-Host "Raccourci cree sur le bureau."
}

# Creer le formulaire principal
$form = New-Object System.Windows.Forms.Form
$form.Text = "EAGLE SPACE COMPANY - Traduction Star Citizen"
$form.Size = New-Object System.Drawing.Size(600, 600)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::Black

# Ajouter l'image de fond
if (Test-Path -Path $backgroundPath) {
    $form.BackgroundImage = [System.Drawing.Image]::FromFile($backgroundPath)
    $form.BackgroundImageLayout = [System.Windows.Forms.ImageLayout]::Stretch
}

# Ajouter un panneau opaque sur toute la fenetre
$overlayPanel = New-Object System.Windows.Forms.Panel
$overlayPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$overlayPanel.BackColor = [System.Drawing.Color]::FromArgb(150, 0, 0, 0) # Couleur noire semi-transparente
$form.Controls.Add($overlayPanel)

# Ajouter le logo
if (Test-Path -Path $logoPath) {
    $logo = New-Object System.Windows.Forms.PictureBox
    $logo.Size = New-Object System.Drawing.Size(300, 300)
    $logo.Location = New-Object System.Drawing.Point(150, 10)
    $logo.Image = [System.Drawing.Image]::FromFile($logoPath)
    $logo.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::StretchImage
    $logo.BackColor = [System.Drawing.Color]::Transparent
    $overlayPanel.Controls.Add($logo)
} else {
    Write-Host "Le logo n'a pas pu etre telecharge et ne sera pas affiche."
}

# Ajouter le texte des contributeurs
$labelContributors = New-Object System.Windows.Forms.Label
$labelContributors.Text = Show-Contributors
$labelContributors.Size = New-Object System.Drawing.Size(200, 84)
$labelContributors.Location = New-Object System.Drawing.Point(20, 330)
$labelContributors.Font = New-Object System.Drawing.Font("Courier New", 10)
$labelContributors.ForeColor = [System.Drawing.Color]::Gold
$labelContributors.BackColor = [System.Drawing.Color]::Transparent
$overlayPanel.Controls.Add($labelContributors)

# Ajouter les cases a cocher
$checkboxes = @(
    @{Text="Version Live"; Location=[System.Drawing.Point]::new(20, 420); Directory=$localization1},
    @{Text="Version PTU"; Location=[System.Drawing.Point]::new(20, 450); Directory=$localization2},
    @{Text="Version TECH-PREVIEW"; Location=[System.Drawing.Point]::new(20, 480); Directory=$localization3},
    @{Text="Version EPTU"; Location=[System.Drawing.Point]::new(20, 510); Directory=$localization4}
)

$checkboxControls = @()
foreach ($checkboxInfo in $checkboxes) {
    $checkbox = New-Object System.Windows.Forms.CheckBox
    $checkbox.Text = $checkboxInfo.Text
    $checkbox.Location = $checkboxInfo.Location
    $checkbox.Tag = $checkboxInfo.Directory
    $checkbox.ForeColor = [System.Drawing.Color]::Gold
    $checkbox.BackColor = [System.Drawing.Color]::Transparent
    $overlayPanel.Controls.Add($checkbox)
    $checkboxControls += $checkbox
}

# Ajouter les boutons
$buttons = @(
    @{Text="Telecharger les traductions"; Location=[System.Drawing.Point]::new(230, 420); Click={
        foreach ($checkbox in $checkboxControls) {
            if ($checkbox.Checked) {
                $directory = $checkbox.Tag
                if ($directory) {
                    DownloadAndCopyTranslation -destinationDir $directory
                } else {
                    Write-Host "Le repertoire de destination est vide."
                }
            }
        }
    }},
    @{Text="Creer un raccourci"; Location=[System.Drawing.Point]::new(230, 460); Click={Create-Shortcut}},
    @{Text="Quitter"; Location=[System.Drawing.Point]::new(230, 500); Click={$form.Close()}}
)

# Creation des boutons
foreach ($buttonInfo in $buttons) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $buttonInfo.Text
    $button.Size = New-Object System.Drawing.Size(150, 30)
    $button.Location = $buttonInfo.Location
    $button.BackColor = [System.Drawing.Color]::Black
    $button.ForeColor = [System.Drawing.Color]::Gold
    $button.FlatStyle = 'Flat'
    $button.FlatAppearance.BorderColor = [System.Drawing.Color]::Gold
    $button.Add_Click($buttonInfo.Click)
    $overlayPanel.Controls.Add($button)
}

# Afficher le formulaire
[void][System.Windows.Forms.Application]::Run($form)

function Calculate-MD5Hash {
    param (
        [byte[]]$bytes
    )
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = $md5.ComputeHash($bytes)
    return [BitConverter]::ToString($hash) -replace '-', ''
}

function Get-RemoteFileMD5 {
    param (
        [string]$url
    )
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head
        return $response.Headers["Content-MD5"]
    } catch {
        return $null
    }
}

function IsNewVersionAvailable {
    param (
        [string]$localFilePath,
        [string]$url
    )
    if (-Not (Test-Path $localFilePath)) {
        return $true
    }

    $localBytes = [System.IO.File]::ReadAllBytes($localFilePath)
    $localMD5 = Calculate-MD5Hash -bytes $localBytes
    $remoteMD5 = Get-RemoteFileMD5 -url $url

    return $localMD5 -ne $remoteMD5
}

function Backup-File {
    param (
        [string]$filePath
    )
    if (Test-Path $filePath) {
        $backupPath = "$filePath.bak"
        Copy-Item -Path $filePath -Destination $backupPath -Force
    }
}
