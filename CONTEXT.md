# StarTrad FR - Contexte Technique

Documentation interne sur le système de mise à jour et les builds.

---

## 1. Système de Mise à Jour Automatique

### 1.1 Architecture

```
GitHub Release
    ├── StarTrad.FR_x.x.x_x64-setup.exe      (installateur NSIS)
    ├── StarTrad.FR_x.x.x_x64-setup.exe.sig  (signature)
    ├── StarTradFR-Installer.msi             (installateur MSI)
    ├── StarTradFR-Portable.exe              (version portable)
    └── latest.json                          (manifest de mise à jour)
```

### 1.2 Fichier latest.json

**Endpoint**: `https://github.com/drrakendu78/TradSC/releases/latest/download/latest.json`

**Format**:
```json
{
    "version": "3.1.9",
    "notes": "Mise a jour vers la version 3.1.9",
    "pub_date": "2026-02-02T12:34:56Z",
    "platforms": {
        "windows-x86_64": {
            "signature": "[contenu du fichier .sig]",
            "url": "https://github.com/drrakendu78/TradSC/releases/download/v3.1.9/StarTrad.FR_3.1.9_x64-setup.exe"
        }
    }
}
```

**Génération**: Automatique via `release.ps1` (étape 6/7)

### 1.3 Système de Signatures

#### Clés cryptographiques

| Fichier | Description | Dans Git |
|---------|-------------|----------|
| `.tauri-signer.key` | Clé privée (protégée par mot de passe) | **NON** |
| `.tauri-signer.key.pub` | Clé publique | **NON** |

#### Clé publique dans tauri.conf.json

```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE1MzkxNjFBRkJDRjNFMjgKUldRb1BzLzdHaFk1RlFSNWlMeWhua00yL3hlM0FWOHpkRzQxQkpWNkwvbGxvaWZsNU5tVlhGelYK"
```

Cette clé (encodée base64) est utilisée pour vérifier les signatures des mises à jour.

#### Génération des signatures

1. `createUpdaterArtifacts: true` dans `tauri.conf.json`
2. Variables d'environnement (configurées automatiquement dans release.ps1) :
   - `TAURI_SIGNING_PRIVATE_KEY` = chemin vers la clé privée
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = mot de passe
3. `pnpm tauri build` génère automatiquement les fichiers `.sig`

#### Flux de vérification

```
App démarre → Fetch latest.json → Compare versions
    ↓
Version plus récente disponible
    ↓
Télécharge l'installateur + lit la signature depuis latest.json
    ↓
Vérifie la signature avec la pubkey de tauri.conf.json
    ↓
Signature valide → Installe la mise à jour
Signature invalide → Rejette (sécurité)
```

### 1.4 Configuration Tauri Updater

**Fichier**: `src-tauri/tauri.conf.json`

```json
"plugins": {
    "updater": {
        "active": true,
        "endpoints": [
            "https://github.com/drrakendu78/TradSC/releases/latest/download/latest.json"
        ],
        "dialog": false,
        "pubkey": "...",
        "windows": {
            "installMode": "passive"
        }
    },
    "deep-link": {
        "desktop": {
            "schemes": ["startradfr"]
        }
    }
}
```

| Option | Valeur | Description |
|--------|--------|-------------|
| `active` | `true` | Active le système de mise à jour |
| `endpoints` | array | URLs pour vérifier les mises à jour |
| `dialog` | `false` | Pas de dialogue natif (UI custom) |
| `pubkey` | string | Clé publique pour vérification |
| `installMode` | `passive` | Installation silencieuse |

### 1.5 Services TypeScript

| Fichier | Rôle |
|---------|------|
| `src/services/updateService.ts` | Orchestration des mises à jour |
| `src/hooks/useUpdater.ts` | Hook React pour l'UI |
| `src/utils/buildInfo.ts` | Détection de la distribution |

#### updateService.ts - Classe UpdateService

**États (UpdateState)**:
```typescript
{
    checking: boolean;      // Vérification en cours
    available: boolean;     // MAJ disponible
    downloading: boolean;   // Téléchargement en cours
    downloaded: boolean;    // Téléchargé
    installing: boolean;    // Installation en cours
    error: string | null;   // Message d'erreur
    updateInfo: Update | null;  // Infos de la MAJ
    progress: number;       // Progression (bytes)
}
```

**Méthodes principales**:
```typescript
checkForUpdate(silent?)   // Vérifie si une mise à jour est disponible
downloadUpdate()          // Télécharge avec tracking de progression
installAndRelaunch()      // Installe et redémarre l'app
downloadAndInstall()      // Télécharge + installe en une fois
autoUpdate()              // Check + download automatique (silencieux)
```

**Fonctionnalités**:
- Notifications système quand en mode minimisé (tray)
- Support du démarrage avec `--minimized`
- Détection automatique de la distribution (Store vs GitHub)

#### buildInfo.ts - Interfaces

```typescript
interface BuildInfo {
    version: string;
    distribution: "github" | "microsoft-store" | "portable" | "unknown";
    isSigned: boolean;
    isPortable: boolean;
    canAutoUpdate: boolean;
    githubRepo: string;
}

interface SecurityInfo {
    isUnsigned: boolean;
    expectsSmartScreenWarning: boolean;
    allowManualUpdates: boolean;
    allowAutoUpdates: boolean;
    downloadSourceUrl: string;
    checksumVerificationAvailable: boolean;
}
```

**Fonctions utilitaires**:
```typescript
detectDistribution()          // Détecte la source d'installation
canAutoUpdate(distribution)   // false pour "microsoft-store"
isBuildSigned(distribution)   // true pour "microsoft-store"
getSecurityWarningMessage()   // Message SmartScreen si nécessaire
getInstallationInstructions() // Instructions selon la distribution
```

---

## 2. Build Microsoft Store

### 2.1 Différences Store vs GitHub

| Aspect | GitHub | Microsoft Store |
|--------|--------|-----------------|
| Config | `tauri.conf.json` | `tauri.microsoftstore.conf.json` |
| Product Name | `StarTrad FR` | `StarTrad FR Store` (dossier/raccourci différent, titre fenêtre reste "StarTrad FR") |
| Bundle ID | `com.drrakendu78.startradfr` | `com.drrakendu78.startradfr.store` |
| Mise à jour | Auto-update via latest.json | Store gère les MAJ |
| Signature | Signature propre (.sig) | Microsoft signe |
| SmartScreen | Avertissement possible | Aucun avertissement |
| Updater artifacts | Oui | Non |
| Targets | all (NSIS + MSI) | MSI uniquement |

> **Note** : Le `productName` Store est volontairement différent (`StarTrad FR Store`) pour éviter les conflits Windows (notifications, registre) si les deux versions sont installées sur le même PC.

### 2.2 Configuration Store

**Fichier**: `src-tauri/tauri.microsoftstore.conf.json`

Différences clés par rapport à `tauri.conf.json` :
```json
{
    "identifier": "com.drrakendu78.startradfr.store",
    "bundle": {
        "targets": ["msi"],
        "createUpdaterArtifacts": false
    },
    "app": {
        "security": {
            "csp": null
        }
    },
    "plugins": {
        "updater": {
            "active": false
        }
    }
}
```

### 2.3 Script de build Store

**Fichier**: `scripts/build-store.ps1`

```powershell
# Active le mode Store
$env:TAURI_ENV_MS_STORE = "true"

# Build avec la config Store
pnpm tauri build --config src-tauri/tauri.microsoftstore.conf.json

# Nettoyage automatique
Remove-Item env:TAURI_ENV_MS_STORE -ErrorAction SilentlyContinue
```

**Utilisation**:
```powershell
.\scripts\build-store.ps1
```

**Output**: `src-tauri/target/release/bundle/msi/StarTrad FR_x.x.x_x64_fr-FR.msi`

### 2.4 Détection de la distribution

**Fichier**: `src/utils/buildInfo.ts`

```typescript
export function detectDistribution(): "github" | "microsoft-store" | "portable" | "unknown" {
    // 1. Variable d'environnement build-time (prioritaire)
    if (process.env.TAURI_ENV_MS_STORE === "true") {
        return "microsoft-store";
    }
    if (process.env.TAURI_ENV_DISTRIBUTION === "github") return "github";
    if (process.env.TAURI_ENV_PORTABLE === "true") return "portable";

    // 2. Fallback runtime (chemin WindowsApps = Store)
    if (window.location.href.includes("WindowsApps")) {
        return "microsoft-store";
    }

    // 3. localStorage pour portable
    if (localStorage.getItem("PORTABLE_MODE") === "true") {
        return "github";
    }

    return "github"; // Défaut
}
```

### 2.5 Comportement UI Store

Dans `src/pages/UpdatesPage.tsx` :
- Version Store : affiche bouton "Ouvrir le Store"
- Lien : `ms-windows-store://pdp/?productid=9P29JDL68WBZ`
- Pas de bouton de mise à jour (géré par le Store)

---

## 3. Variables d'environnement

### Build-time (injectées via vite.config.ts)

```typescript
// vite.config.ts
define: {
    "process.env.TAURI_ENV_MS_STORE": JSON.stringify(process.env.TAURI_ENV_MS_STORE),
    "process.env.TAURI_ENV_PORTABLE": JSON.stringify(process.env.TAURI_ENV_PORTABLE),
    "process.env.TAURI_ENV_DISTRIBUTION": JSON.stringify(process.env.TAURI_ENV_DISTRIBUTION),
}
```

| Variable | Valeur | Description |
|----------|--------|-------------|
| `TAURI_ENV_MS_STORE` | `true` | Build Microsoft Store |
| `TAURI_ENV_DISTRIBUTION` | `github` | Build GitHub standard |
| `TAURI_ENV_PORTABLE` | `true` | Build portable |

### Signature (release.ps1)

| Variable | Description |
|----------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Chemin vers `.tauri-signer.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Mot de passe de la clé |

---

## 4. Fichiers clés

```
TradSC-main/
├── src-tauri/
│   ├── tauri.conf.json                 # Config GitHub (avec updater)
│   ├── tauri.microsoftstore.conf.json  # Config Store (sans updater)
│   └── tauri.portable.conf.json        # Config portable
├── src/
│   ├── services/
│   │   └── updateService.ts            # Service de mise à jour
│   ├── hooks/
│   │   └── useUpdater.ts               # Hook React
│   ├── pages/
│   │   └── UpdatesPage.tsx             # Page des mises à jour
│   └── utils/
│       └── buildInfo.ts                # Détection distribution
├── scripts/
│   └── build-store.ps1                 # Script build Store
├── builds/                             # Dossier des builds finaux
├── release.ps1                         # Script release complet
├── .tauri-signer.key                   # Clé privée (NE PAS COMMIT)
└── .tauri-signer.key.pub               # Clé publique (NE PAS COMMIT)
```

---

## 5. Workflow de Release (Local uniquement)

> **Note**: On ne utilise plus GitHub Actions. Tout est buildé localement.

### Release GitHub (avec signatures)

**Commande**:
```powershell
.\release.ps1 -Version "3.2.0" -Patchnotes "## Nouveautés`n- Feature 1`n- Fix bug"
```

**Paramètres**:
| Paramètre | Obligatoire | Description |
|-----------|-------------|-------------|
| `-Version` | Oui | Numéro de version (ex: "3.2.0") |
| `-Patchnotes` | Oui | Notes de version (markdown) |
| `-NoPublish` | Non | Ne pas publier sur GitHub (build seulement) |

**Étapes du script (7 étapes)**:

1. **[1/7]** Met à jour la version dans `tauri.conf.json`
2. **[2/7]** Build avec signature (configure les variables d'env automatiquement)
3. **[3/7]** Copie les fichiers vers `builds/`
4. **[4/7]** Lit la signature du fichier `.sig`
5. **[5/7]** Génère les checksums SHA256
6. **[6/7]** Crée `latest.json` avec la signature
7. **[7/7]** Crée `PATCHNOTES_x.x.x.md`

**Fichiers générés**:
```
builds/
├── StarTrad.FR_3.2.0_x64-setup.exe      # Installateur NSIS
├── StarTrad.FR_3.2.0_x64-setup.exe.sig  # Signature
├── StarTradFR-Installer.msi             # Installateur MSI
├── StarTradFR-Portable.exe              # Version portable
└── latest.json                          # Manifest pour updater

PATCHNOTES_3.2.0.md                      # Notes de version formatées
```

**Publication automatique**: Si `-NoPublish` n'est pas spécifié, le script publie automatiquement sur GitHub avec `gh release create`.

### Release Store

```powershell
.\scripts\build-store.ps1
```

Puis upload manuel du MSI sur [Microsoft Partner Center](https://partner.microsoft.com/dashboard).

---

## 6. Deep Link Protocol

L'app supporte le protocole `startradfr://` pour les liens profonds.

**Configuration** (`tauri.conf.json`):
```json
"plugins": {
    "deep-link": {
        "desktop": {
            "schemes": ["startradfr"]
        }
    }
}
```

---

## 7. Sécurité

### Clés de signature
- **Ne jamais commit** `.tauri-signer.key` ou `.tauri-signer.key.pub`
- Le mot de passe est stocké dans `release.ps1` (ne pas partager ce fichier)

### Vérification des mises à jour
- Toutes les MAJ sont vérifiées cryptographiquement avec la pubkey
- Si la signature ne correspond pas, la MAJ est rejetée

### SmartScreen
| Distribution | SmartScreen |
|--------------|-------------|
| GitHub (installateur) | Avertissement possible |
| GitHub (portable) | Pas d'avertissement (pas d'installation) |
| Microsoft Store | Aucun avertissement (signé par MS) |

### Checksums
Les checksums SHA256 sont affichés lors de la release et inclus dans les PATCHNOTES pour vérification manuelle.

---

## 8. Paramètres Graphiques Avancés

### 8.1 Architecture

**Fichiers**:
| Fichier | Rôle |
|---------|------|
| `src-tauri/src/scripts/graphics_settings.rs` | Backend Rust - lecture/écriture user.cfg |
| `src/pages/GraphicsSettings.tsx` | Interface React avec 3 onglets |

### 8.2 Paramètres supportés (SC 4.5+)

Le système écrit dans 3 fichiers selon le paramètre :
- **user.cfg** : `[StarCitizen]/[VERSION]/user.cfg` (CVars directs)
- **attributes.xml** : `[StarCitizen]/[VERSION]/user/client/0/profiles/default/attributes.xml`
- **GraphicsSettings.json** : `%APPDATA%/StarCitizen/GraphicsSettings.json`

> **Note SC 4.5** : De nombreux CVars ont été supprimés de la whitelist en SC 4.5 (Aberration chromatique, Bloom, Lens Flares, Vignetting, Fog, Tessellation, Filtrage Aniso, LOD, View Distance, etc.). Seuls les paramètres ci-dessous sont confirmés fonctionnels.

#### Effets visuels (user.cfg)
| CVar | Type | Valeurs | Description |
|------|------|---------|-------------|
| `r_VSync` | int | 0/1 | Synchronisation verticale |
| `r_MotionBlur` | int | 0/1/2 | Flou de mouvement |
| `r_DepthOfField` | int | 0/1/2 | Profondeur de champ |
| `r_FilmGrain` | float | 0.0-1.0 | Grain de film |
| `r_Sharpening` | float | 0.0-1.0 | Netteté |

#### Environnement
| CVar | Fichier | Type | Valeurs | Description |
|------|---------|------|---------|-------------|
| `r_ssdo` | user.cfg | int | 0/1/2 | Ambient Occlusion (SSDO) |
| `r_SSReflections` | user.cfg | int | 0/1/2 | Screen Space Reflections |
| `r_VolumetricClouds` | attributes.xml | int | 0/1 | Nuages volumétriques |
| `e_Shadows` | attributes.xml | int | 0-3 | Qualité des ombres |

#### Performance (user.cfg)
| CVar | Type | Valeurs | Description |
|------|------|---------|-------------|
| `sys_maxFps` | int | 0-240 | Limite FPS (0=illimité) |
| `r_DisplayInfo` | int | 0/1 | Compteur FPS en jeu |
| `sys_budget_videomem` | int | MB | Budget VRAM (0=auto) |
| `r_TexturesStreamPoolSize` | int | MB | Pool de textures |

#### Affichage (user.cfg)
| CVar | Type | Valeurs | Description |
|------|------|---------|-------------|
| `r_Gamma` | float | 0.5-1.5 | Correction gamma |
| `r_Width` | int | pixels | Largeur résolution |
| `r_Height` | int | pixels | Hauteur résolution |

### 8.3 Presets graphiques

4 presets préconfigurés disponibles :

| Preset | Description | Cible |
|--------|-------------|-------|
| **Performance** | Max FPS, effets minimaux | PC modeste / Max FPS |
| **Équilibré** | Bon compromis qualité/perf | Usage général |
| **Qualité** | Tous effets activés | PC puissant |
| **Cinématique** | Optimisé pour captures | Screenshots / Vidéos |

### 8.4 Commandes Tauri

```rust
// Lecture/écriture paramètres avancés
get_user_cfg_advanced_settings(version: String) -> UserCfgSettings
set_user_cfg_advanced_settings(settings: UserCfgSettings, version: String)

// Presets
get_graphics_presets() -> Vec<GraphicsPreset>
apply_graphics_preset(preset_name: String, version: String)

// Renderer et résolution (existants)
get_graphics_renderer(version: String) -> i32  // 0=DX11, 1=Vulkan
set_graphics_renderer(renderer: i32, version: String)
get_user_cfg_resolution(version: String) -> [i32, i32]
set_user_cfg_resolution(width: i32, height: i32, version: String)
```

### 8.5 Interface utilisateur

La page `GraphicsSettings.tsx` est organisée en **3 onglets** :

1. **Général**
   - Sélecteur Vulkan / DirectX 11
   - Résolution (prédéfinie ou personnalisée)

2. **Presets**
   - 4 cartes avec aperçu des paramètres
   - Application en un clic

3. **Avancé**
   - Effets visuels (VSync, Motion Blur, DoF, Film Grain, Sharpening)
   - Environnement (SSDO, SSR, Nuages volumétriques, Ombres)
   - Performance (Limite FPS, Compteur FPS, Budget VRAM, Pool textures)
   - Affichage (Gamma)

### 8.6 Améliorations UX (v3.2.0)

- **Onglets contrôlés** : L'onglet actif reste en place après application d'un preset (pas de retour à "Général")
- **Pas de clignotement** : Les settings sont mis à jour localement sans recharger depuis le disque

### 8.8 Sauvegarde Cloud

Les paramètres graphiques (`user.cfg`) sont automatiquement inclus dans les sauvegardes cloud :
- Le fichier `user.cfg` est ajouté au ZIP lors de `create_user_backup`
- À la restauration, `user.cfg` est extrait à la racine du dossier de version

---

## 9. Temps de Jeu

### 9.1 Architecture

**Fichiers**:
| Fichier | Rôle |
|---------|------|
| `src-tauri/src/scripts/app_stats.rs` | Backend Rust - analyse des logs Star Citizen |
| `src/pages/Home.tsx` | Affichage du temps de jeu |
| `src/stores/stats-store.ts` | Store Zustand pour le temps sauvegardé |
| `src/stores/preferences-sync-store.ts` | Synchronisation cloud du temps |

### 9.2 Calcul du temps de jeu

Le backend Rust analyse les fichiers logs de Star Citizen :
- **Chemin** : `[StarCitizen]/[VERSION]/logbackups/*.log`
- **Méthode** : Pour chaque fichier log, extrait le premier et dernier timestamp pour calculer la durée de session
- **Sessions** : Chaque fichier log = 1 session de jeu

### 9.3 Affichage et logique

**Formule** : `totalHours = savedPlaytimeHours + calculatedHours`

| Variable | Source | Description |
|----------|--------|-------------|
| `savedPlaytimeHours` | Cloud (preferences-sync) | Temps historique sauvegardé |
| `calculatedHours` | Backend Rust (logs locaux) | Temps calculé depuis les logs actuels |

**Note** : L'addition des deux valeurs peut créer des doublons si les mêmes logs sont comptés deux fois. C'est un choix délibéré : mieux vaut afficher plus de temps que d'en perdre.

### 9.4 Synchronisation Cloud

- **Sauvegarde** : Le temps total est sauvegardé dans les préférences cloud via `preferences-sync-store.ts`
- **Restauration** : `setSavedPlaytimeHours(prefs.stats.playtimeHours)` restaure le temps historique
- **Reset** : `localStorage.removeItem('stats-storage')` dans la console F12 pour remettre à zéro

### 9.5 Interface

Affichage compact dans la carte d'accueil :
- Icône horloge + `Xh Ymin`
- Sous-texte : nombre de sessions ou "Temps de jeu"
- Tooltip explicatif au survol

---

## 10. Photo de profil personnalisée (v3.2.0)

### 10.1 Architecture

**Fichiers**:
| Fichier | Rôle |
|---------|------|
| `src-tauri/src/lib.rs` | 3 commandes Rust (save, get, remove) |
| `src/hooks/useAvatar.ts` | Hook React pour gestion avatar |
| `src/components/custom/auth-dialog.tsx` | UI de changement (onglet Mon compte) |
| `src/components/custom/app-sidebar.tsx` | Affichage avatar sidebar |
| `src/components/custom/user-menu-button.tsx` | Affichage avatar menu |

### 10.2 Stockage

- **Emplacement** : `%APPDATA%/TradSC/custom_avatar.{ext}`
- **Format** : PNG, JPG, JPEG, WEBP
- **Encodage** : Base64 data URL (évite les problèmes Tauri asset protocol)
- **Priorité** : Avatar custom local > Avatar Discord

### 10.3 Commandes Tauri

```rust
save_custom_avatar(source_path: String) -> String    // Copie l'image, retourne le chemin
get_custom_avatar() -> Option<String>                 // Retourne data:image/...;base64,...
remove_custom_avatar()                                // Supprime tous les custom_avatar.*
```

### 10.4 Synchronisation inter-composants

Utilise un `CustomEvent` (`customAvatarChanged`) via `window.dispatchEvent` pour synchroniser l'avatar entre sidebar, menu et dialog sans recharger.

### 10.5 UI

- Overlay caméra au hover sur l'avatar dans "Mon compte"
- Sélecteur de fichier via `@tauri-apps/plugin-dialog`
- Bouton "Revenir à Discord" quand un avatar custom est défini

---

## 11. Statut Serveurs Star Citizen (v3.2.0)

### 11.1 Architecture

**Fichier** : `src/components/custom/server-status.tsx`

### 11.2 Fonctionnement

- Affiche un indicateur dans la barre de contrôle (control-menu)
- Récupère le statut depuis l'API RSI
- Indicateurs visuels : vert (opérationnel), orange (partiel), rouge (hors ligne)

---

## 12. Notes de Build importantes

### 12.1 BOM PowerShell

**Problème** : PowerShell 5.x `Set-Content -Encoding UTF8` ajoute un BOM (Byte Order Mark) aux fichiers JSON.
**Impact** : Vite ne peut pas parser le JSON → erreur `Unexpected token '﻿'`
**Solution** : Utiliser `[System.IO.File]::WriteAllText()` avec `UTF8Encoding($false)` (corrigé dans release.ps1)

### 12.2 Dossier dist/ et builds

**Problème critique** : Si le dossier `dist/` contient un ancien build, Tauri peut empaqueter l'ancien frontend même si le Rust est recompilé en nouvelle version.
**Solution** : Toujours supprimer `dist/` avant un build release :
```powershell
Remove-Item -Recurse -Force dist
npm run tauri build
```

### 12.3 Version affichée

La version dans la barre de titre vient de `VITE_APP_VERSION` (injecté par `vite.config.ts` depuis `tauri.conf.json`).
- **Fichier** : `src/utils/version.ts` → `getAppVersionSync()`
- **Affichage** : `src/components/custom/layout.tsx` ligne 104

---

## 13. Audio / Vidéo de fond (v3.2.1)

### 13.1 Architecture

**Fichiers** :
| Fichier | Rôle |
|---------|------|
| `src/components/custom/background-video.tsx` | Lecteur YouTube caché (1x1px) |
| `src/components/custom/control-menu.tsx` | Contrôles volume/mute |

### 13.2 Persistance volume/mute (localStorage)

Le volume et l'état mute sont sauvegardés en `localStorage` :
- `videoVolume` : float 0.0-1.0 (défaut: 0.5)
- `videoMuted` : "true"/"false" (défaut: false)

**Initialisation lazy** (évite les race conditions) :
```typescript
const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('videoVolume');
    return saved ? parseFloat(saved) : 0.5;
});
const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('videoMuted') === 'true';
});
```

### 13.3 Communication inter-composants

Utilise des `CustomEvent` :
- `videoVolumeChange` : émis par control-menu, écouté par background-video
- `videoMuteChange` : émis par control-menu, écouté par background-video

### 13.4 Fix mute YouTube (v3.2.1)

**Problème** : `player.mute()` / `player.unMute()` de l'API YouTube IFrame ne fonctionne pas de manière fiable sur un player caché 1x1px.

**Solution** : Utiliser `player.setVolume(0)` pour muter et `player.setVolume(vol * 100)` pour unmuter.

```typescript
// Mute
youtubePlayerRef.current.setVolume(0);
// Unmute
const savedVolume = localStorage.getItem('videoVolume');
const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
youtubePlayerRef.current.setVolume(vol * 100);
```

---

## 14. MSIX Microsoft Store

### 14.1 Processus de création

1. Build MSI : `$env:TAURI_ENV_MS_STORE="true"; npm run tauri build -- --config src-tauri/tauri.microsoftstore.conf.json`
2. Convertir MSI → MSIX via **MSIX Packaging Tool** (app du Store)
3. Upload MSIX sur [Microsoft Partner Center](https://partner.microsoft.com/dashboard)

### 14.2 Infos du package MSIX

| Champ | Valeur |
|-------|--------|
| Package Name | `Drrakendu78.StarTradFR` |
| Publisher | `CN=7387C4AA-CB2C-4915-B6F4-E6AF460349E8` |
| Publisher Display Name | `Drrakendu78` |
| Package Family Name (PFN) | `Drrakendu78.StarTradFR_ftqmxo67f61dy` |
| ID Store | `9P29IDL68W8Z` |

### 14.3 Capabilities du manifest

```xml
<Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="accessoryManager" />  <!-- requis pour notifications toast -->
    <rescap:Capability Name="runFullTrust" />
</Capabilities>
```

**Note** : `accessoryManager` est ajouté automatiquement par le MSIX Packaging Tool quand on coche "Notifications". C'est une restricted capability qui nécessite une justification lors de la soumission Store.

### 14.4 Startup Task (auto-démarrage)

```xml
<desktop:Extension Category="windows.startupTask" Executable="VFS\ProgramFilesX64\StarTrad FR Store\startradfr.exe" EntryPoint="Windows.FullTrustApplication">
    <desktop:StartupTask TaskId="StarTradFRStartup" Enabled="false" DisplayName="StarTrad FR" />
</desktop:Extension>
```

`Enabled="false"` par défaut - activé par l'option dans les paramètres de l'app.

### 14.5 Build GitHub (avec signatures)

**Commande manuelle** (sans release.ps1) :
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "[contenu de .tauri-signer.key]"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '[mot de passe]'
npm run tauri build
```

### 14.6 gh CLI

- **Chemin** : `C:\Program Files\GitHub CLI\gh.exe`
- **Usage** : `gh release upload`, `gh release create`, etc.
- **Auth** : `gh auth login` (browser-based)

### 14.7 winget (Windows Package Manager)

- **Package ID** : `Drrakendu78.StarTradFR`
- **PR initiale** : https://github.com/microsoft/winget-pkgs/pull/335878
- **Outil** : `wingetcreate` (`winget install wingetcreate`)

**Mise à jour winget** (pour chaque nouvelle version) :
```powershell
wingetcreate update Drrakendu78.StarTradFR --version 3.2.1 --urls https://github.com/drrakendu78/TradSC/releases/download/v3.2.1/StarTrad.FR_3.2.1_x64-setup.exe --submit
```

> **Note** : La première soumission nécessite une review manuelle par un modérateur. Les mises à jour suivantes passent beaucoup plus vite (souvent auto-merge après validation).
