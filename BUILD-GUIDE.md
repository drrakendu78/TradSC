# 🚀 Guide de Build One-Click - StarTrad FR

## Pour le développeur (toi)

### Build en un seul clic

Double-clique simplement sur le fichier **`BUILD-ONE-CLICK.bat`** à la racine du projet.

Ce script va automatiquement :
- ✅ Vérifier tous les prérequis (Node.js, Rust, etc.)
- ✅ Nettoyer les anciens builds
- ✅ Installer les dépendances
- ✅ Compiler les versions **Standard** et **Portable**
- ✅ Générer les checksums SHA256
- ✅ Organiser les fichiers dans le dossier `builds/`
- ✅ Ouvrir le dossier `builds/` à la fin

### Structure générée

```
builds/
├── portable/
│   └── StarTrad_FR-Portable_2.0.5.exe
├── installer/
│   ├── StarTrad.FR_2.0.5_x64-setup.exe      (NSIS Installer)
│   └── StarTrad.FR_2.0.5_x64_fr-FR.msi      (MSI Windows Installer)
└── checksums.txt
```

---

## Pour l'utilisateur final

### 3 Types d'installation

#### 1. 🎯 **Installation "One-Click" Simple** (RECOMMANDÉ)

**Fichier :** `StarTrad.FR_2.0.5_x64-setup.exe` (NSIS)

**Avantages :**
- ✅ Installation simplifiée en français
- ✅ Pas de sélection de langue
- ✅ S'installe dans le profil utilisateur (pas besoin d'admin)
- ✅ Désinstallation facile via le Panneau de configuration

**Utilisation :**
1. Double-clic sur `StarTrad.FR_2.0.5_x64-setup.exe`
2. Clic sur "Installer"
3. C'est tout ! 🎉

---

#### 2. 🛠️ **Installation MSI Traditionnelle**

**Fichier :** `StarTrad.FR_2.0.5_x64_fr-FR.msi`

**Avantages :**
- ✅ Installation standard Windows
- ✅ Compatible avec les GPO d'entreprise
- ✅ Peut être déployé en masse

**Utilisation :**
1. Double-clic sur `StarTrad.FR_2.0.5_x64_fr-FR.msi`
2. Suivre l'assistant d'installation
3. Terminé !

---

#### 3. 💼 **Version Portable** (Sans installation)

**Fichier :** `StarTrad_FR-Portable_2.0.5.exe`

**Avantages :**
- ✅ Aucune installation requise
- ✅ Peut être lancé depuis une clé USB
- ✅ Ne laisse pas de traces dans le système
- ✅ Pas d'avertissement Windows SmartScreen

**Utilisation :**
1. Déplacer le fichier où tu veux
2. Double-clic pour lancer
3. C'est prêt !

---

## Installation SILENCIEUSE (pour automatisation)

### NSIS (.exe)

```batch
StarTrad.FR_2.0.5_x64-setup.exe /S
```

### MSI

```batch
msiexec /i StarTrad.FR_2.0.5_x64_fr-FR.msi /qn
```

**Options MSI :**
- `/qn` : Installation complètement silencieuse
- `/qb` : Installation avec barre de progression
- `/passive` : Installation automatique avec interface

---

## Options de Build avancées

### Via PowerShell

```powershell
# Build standard uniquement
.\scripts\build-release.ps1 -Type standard

# Build portable uniquement
.\scripts\build-release.ps1 -Type portable

# Build Microsoft Store
.\scripts\build-release.ps1 -Type msix

# Build TOUT (Standard + Portable + Store)
.\scripts\build-release.ps1 -Type all

# Build public (Standard + Portable, sans Store)
.\scripts\build-release.ps1 -Type public -Clean
```

### Options disponibles

- `-Type` : Type de build (standard, portable, msix, all, public)
- `-Clean` : Nettoie les builds précédents avant de compiler
- `-GenerateChecksums` : Génère les checksums SHA256 (activé par défaut)

---

## Prérequis pour le développement

- ✅ Node.js (v18+)
- ✅ pnpm (`npm install -g pnpm`)
- ✅ Rust et Cargo ([rustup.rs](https://rustup.rs))
- ✅ Tauri CLI (installé automatiquement via pnpm)
- ✅ WiX Toolset v4 (pour les MSI, installé automatiquement)

---

## Dépannage

### Le build échoue ?

1. Vérifie que tous les prérequis sont installés
2. Essaye avec l'option `-Clean` :
   ```batch
   BUILD-ONE-CLICK.bat
   ```

### Windows SmartScreen bloque l'installation ?

C'est normal pour les apps non signées. Solutions :
1. **Clic sur "Informations complémentaires"** puis **"Exécuter quand même"**
2. Ou utilise la **version portable** qui ne déclenche pas SmartScreen

---

## 🎉 C'est tout !

Le build est maintenant automatique et l'installation est simplifiée au maximum pour les utilisateurs !

