# Charger les assemblys necessaires
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
        # Telechargement du fichier avec progression
        $response = Invoke-WebRequest -Uri $url -Method Get -UseBasicParsing
        $totalLength = [int]$response.Headers["Content-Length"]
        $bytesReceived = 0

        # Ouvrir le flux de contenu
        $responseStream = $response.RawContentStream
        $fileStream = [System.IO.File]::Create($localFilePath)

        # Initialisation d'un buffer
        $buffer = New-Object byte[] 8192
        $bytesRead = 0

        while (($bytesRead = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $fileStream.Write($buffer, 0, $bytesRead)
            $bytesReceived += $bytesRead
            $progressBar.Value = [math]::Round(($bytesReceived / $totalLength) * 100)
            $downloadingForm.Refresh()
        }

        $fileStream.Close()
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
    @{Text="Traduire la version Live"; Location=[System.Drawing.Point]::new(10, 100); Click={DownloadAndCopyTranslation -destinationDir $localization1}},
    @{Text="Traduire la version PTU"; Location=[System.Drawing.Point]::new(10, 140); Click={DownloadAndCopyTranslation -destinationDir $localization2}},
    @{Text="Traduire la version TECH-PREVIEW"; Location=[System.Drawing.Point]::new(10, 180); Click={DownloadAndCopyTranslation -destinationDir $localization3}},
    @{Text="Traduire la version EPTU"; Location=[System.Drawing.Point]::new(170, 100); Click={DownloadAndCopyTranslation -destinationDir $localization4}},
    @{Text="Creer un raccourci"; Location=[System.Drawing.Point]::new(170, 140); Click={Create-Shortcut}},
    @{Text="Quitter"; Location=[System.Drawing.Point]::new(170, 180); Click={$form.Close()}}
)

foreach ($buttonInfo in $buttons) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $buttonInfo.Text
    $button.Size = New-Object System.Drawing.Size(150, 30)
    $button.Location = $buttonInfo.Location
    $button.Add_Click($buttonInfo.Click)
    $form.Controls.Add($button)

    # Changer la couleur du bouton lorsqu'il est clique
    $button.Add_MouseDown({ $button.BackColor = [System.Drawing.Color]::LightBlue })
    $button.Add_MouseUp({ $button.BackColor = [System.Drawing.Color]::FromName("Control") })
}

# Afficher le formulaire
[void][System.Windows.Forms.Application]::Run($form)
