# Script de Mise à Jour depuis le Repository Officiel
# Ce script facilite la mise à jour de votre version modifiée avec la nouvelle version officielle

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("merge", "rebase", "backup")]
    [string]$Method = "merge",
    
    [Parameter(Mandatory=$false)]
    [string]$Branch = "main",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipTests,
    
    [Parameter(Mandatory=$false)]
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Couleurs pour l'affichage
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success { Write-ColorOutput Green $args }
function Write-Error { Write-ColorOutput Red $args }
function Write-Info { Write-ColorOutput Cyan $args }
function Write-Warning { Write-ColorOutput Yellow $args }

Write-Info "🔄 Script de Mise à Jour MultitoolV2"
Write-Info "====================================="
Write-Output ""

# Vérifier que Git est installé
try {
    $gitVersion = git --version
    Write-Success "✅ Git détecté : $gitVersion"
} catch {
    Write-Error "❌ Git n'est pas installé. Veuillez l'installer d'abord."
    exit 1
}

# Vérifier que nous sommes dans un repository Git
if (-not (Test-Path ".git")) {
    Write-Error "❌ Ce dossier n'est pas un repository Git."
    Write-Info "💡 Astuce : Exécutez 'git init' si vous voulez créer un nouveau repository."
    exit 1
}

# Étape 1 : Vérifier l'état actuel
Write-Info "📋 Étape 1 : Vérification de l'état actuel..."
$status = git status --porcelain

if ($status -and -not $Force) {
    Write-Warning "⚠️  Vous avez des modifications non commitées :"
    Write-Output $status
    Write-Output ""
    $response = Read-Host "Voulez-vous les committer avant de continuer ? (O/N)"
    if ($response -eq "O" -or $response -eq "o") {
        Write-Info "💾 Committage des modifications..."
        git add .
        $commitMessage = Read-Host "Message de commit (ou laissez vide pour 'chore: sauvegarde avant mise à jour')"
        if ([string]::IsNullOrWhiteSpace($commitMessage)) {
            $commitMessage = "chore: sauvegarde avant mise à jour"
        }
        git commit -m $commitMessage
        Write-Success "✅ Modifications commitées"
    } else {
        Write-Warning "⚠️  Continuation sans committer. Vos modifications non commitées pourraient être perdues."
        $confirm = Read-Host "Continuer quand même ? (O/N)"
        if ($confirm -ne "O" -and $confirm -ne "o") {
            Write-Info "❌ Opération annulée."
            exit 0
        }
    }
} else {
    Write-Success "✅ Aucune modification non commitée"
}

# Étape 2 : Vérifier/ajouter le remote upstream
Write-Info "📋 Étape 2 : Configuration du remote upstream..."
$remotes = git remote -v
$upstreamExists = $remotes | Select-String "upstream"

if (-not $upstreamExists) {
    Write-Info "➕ Ajout du remote upstream..."
    git remote add upstream https://github.com/Onivoid/MultitoolV2.git
    Write-Success "✅ Remote upstream ajouté"
} else {
    Write-Info "🔄 Mise à jour de l'URL du remote upstream..."
    git remote set-url upstream https://github.com/Onivoid/MultitoolV2.git
    Write-Success "✅ Remote upstream configuré"
}

# Étape 3 : Récupérer la nouvelle version
Write-Info "📋 Étape 3 : Récupération de la nouvelle version..."
try {
    git fetch upstream
    Write-Success "✅ Nouvelles modifications récupérées"
} catch {
    Write-Error "❌ Erreur lors de la récupération : $_"
    exit 1
}

# Vérifier la branche actuelle
$currentBranch = git branch --show-current
Write-Info "📍 Branche actuelle : $currentBranch"

# Étape 4 : Appliquer la mise à jour selon la méthode choisie
Write-Info "📋 Étape 4 : Application de la mise à jour (méthode: $Method)..."

switch ($Method) {
    "backup" {
        Write-Info "💾 Création d'une branche de sauvegarde..."
        $backupBranch = "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        git checkout -b $backupBranch
        Write-Success "✅ Branche de sauvegarde créée : $backupBranch"
        
        git checkout $currentBranch
        Write-Info "🔄 Réinitialisation de la branche principale..."
        git reset --hard upstream/$Branch
        Write-Success "✅ Branche principale mise à jour"
        
        Write-Info "🔀 Application des modifications depuis la sauvegarde..."
        try {
            git cherry-pick $backupBranch
            Write-Success "✅ Modifications appliquées"
        } catch {
            Write-Warning "⚠️  Conflits détectés lors du cherry-pick"
            Write-Info "💡 Résolvez les conflits manuellement, puis exécutez :"
            Write-Output "   git add ."
            Write-Output "   git cherry-pick --continue"
        }
    }
    
    "rebase" {
        Write-Info "🔄 Rebase de votre branche sur upstream/$Branch..."
        try {
            git rebase upstream/$Branch
            Write-Success "✅ Rebase terminé avec succès"
        } catch {
            Write-Warning "⚠️  Conflits détectés lors du rebase"
            Write-Info "💡 Résolvez les conflits manuellement, puis exécutez :"
            Write-Output "   git add <fichiers-résolus>"
            Write-Output "   git rebase --continue"
            Write-Output ""
            Write-Info "   Ou annulez le rebase avec :"
            Write-Output "   git rebase --abort"
        }
    }
    
    "merge" {
        Write-Info "🔀 Merge de upstream/$Branch dans votre branche..."
        try {
            git merge upstream/$Branch
            Write-Success "✅ Merge terminé avec succès"
        } catch {
            Write-Warning "⚠️  Conflits détectés lors du merge"
            Write-Info "💡 Résolvez les conflits manuellement, puis exécutez :"
            Write-Output "   git add <fichiers-résolus>"
            Write-Output "   git commit"
            Write-Output ""
            Write-Info "   Ou annulez le merge avec :"
            Write-Output "   git merge --abort"
        }
    }
}

# Étape 5 : Vérifier les conflits
Write-Info "📋 Étape 5 : Vérification des conflits..."
$conflicts = git diff --name-only --diff-filter=U

if ($conflicts) {
    Write-Warning "⚠️  Fichiers en conflit détectés :"
    Write-Output $conflicts
    Write-Output ""
    Write-Info "💡 Ouvrez ces fichiers dans votre éditeur pour résoudre les conflits."
    Write-Info "   Cherchez les marqueurs : <<<<<<< HEAD, =======, >>>>>>> upstream/$Branch"
} else {
    Write-Success "✅ Aucun conflit détecté"
}

# Étape 6 : Installer les dépendances
Write-Info "📋 Étape 6 : Installation des dépendances..."
if (Test-Path "package.json") {
    try {
        # Vérifier si pnpm est installé
        $pnpmVersion = pnpm --version 2>$null
        if ($pnpmVersion) {
            Write-Info "📦 Installation avec pnpm..."
            pnpm install
            Write-Success "✅ Dépendances installées"
        } else {
            Write-Warning "⚠️  pnpm n'est pas installé. Utilisation de npm..."
            npm install
            Write-Success "✅ Dépendances installées"
        }
    } catch {
        Write-Warning "⚠️  Erreur lors de l'installation des dépendances : $_"
        Write-Info "💡 Vous pouvez installer manuellement avec : pnpm install"
    }
} else {
    Write-Warning "⚠️  package.json non trouvé. Ignoré."
}

# Étape 7 : Tests (optionnel)
if (-not $SkipTests) {
    Write-Info "📋 Étape 7 : Tests de l'application..."
    $testResponse = Read-Host "Voulez-vous tester l'application maintenant ? (O/N)"
    if ($testResponse -eq "O" -or $testResponse -eq "o") {
        Write-Info "🧪 Lancement des tests..."
        Write-Info "💡 Exécutez 'pnpm tauri dev' dans un autre terminal pour tester."
    }
}

# Résumé
Write-Output ""
Write-Success "✅ Mise à jour terminée !"
Write-Output ""
Write-Info "📝 Prochaines étapes :"
Write-Output "   1. Résolvez les conflits si nécessaire"
Write-Output "   2. Testez l'application : pnpm tauri dev"
Write-Output "   3. Si tout fonctionne : git add . && git commit -m 'chore: mise à jour depuis upstream'"
Write-Output ""
Write-Info "📚 Pour plus d'informations, consultez : GUIDE_MISE_A_JOUR.md"

