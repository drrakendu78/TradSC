<div align="center">

# StarTrad FR

[🇬🇧 English](README_EN.md) | **🇫🇷 Français**

_Traduction française pour Star Citizen – Version 3_

[![Release](https://img.shields.io/github/v/release/drrakendu78/TradSC?style=for-the-badge&logo=github&logoColor=white)](https://github.com/drrakendu78/TradSC/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/drrakendu78/TradSC/total?style=for-the-badge&logo=download&logoColor=white)](https://github.com/drrakendu78/TradSC/releases)
[![License](https://img.shields.io/github/license/drrakendu78/TradSC?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/drrakendu78/TradSC?style=for-the-badge&logo=star&logoColor=white)](https://github.com/drrakendu78/TradSC/stargazers)

<br/>

<a href="https://apps.microsoft.com/detail/9P29JDL68WBZ?referrer=appbadge&mode=full">
  <img src="https://get.microsoft.com/images/fr%20light.svg" width="200"/>
</a>

<br/>

<sub>
✔️ Version <strong>Microsoft Store</strong> : application <strong>signée et distribuée par Microsoft</strong><br/>
✔️ Versions <strong>EXE / MSI</strong> disponibles sur GitHub (non signées)<br/>
➡️ Les versions EXE / MSI incluent une fonctionnalité supplémentaire :<br/>
<strong>bouton de téléchargement automatique du RSI Launcher</strong> s’il n’est pas installé.
</sub>

---

**StarTrad FR** est une application desktop moderne et gratuite pour gérer la traduction française de Star Citizen.  
Développée avec <strong>Tauri 2</strong>, <strong>React</strong> et <strong>TypeScript</strong>, elle offre une interface intuitive et de nombreuses fonctionnalités pour améliorer votre expérience de jeu.

> **Note** : StarTrad FR est basé sur [MultitoolV2](https://github.com/Onivoid/MultitoolV2) développé par [Onivoid](https://github.com/Onivoid), adapté et spécialisé pour la traduction française de Star Citizen.

</div>

## Fonctionnalités

### Traduction Française

- Installation de traductions françaises pour Star Citizen (LIVE, PTU, EPTU, TECH-PREVIEW)
- **SCEFRA** : Traduction française principale
- **Communauté Hugo Lisoir** : Traduction des circuspes
- Support de multiples sources de traduction
- Vérification automatique des mises à jour des traductions en arrière-plan
- Désinstallation propre en un clic
- Sélection parmi plusieurs traductions disponibles via menu déroulant
- **Cache hors-ligne** : Sauvegarde locale des traductions pour installation sans internet

### Cloud & Synchronisation

- **Connexion Discord** : Authentification sécurisée via OAuth Discord
- **Deep Link Protocol** : Popup navigateur "Ouvrir StarTrad FR ?" pour une connexion fluide
- **Sauvegarde cloud** : Sauvegardez vos personnages et configurations dans le cloud
- **Synchronisation des préférences** : Retrouvez vos paramètres sur tous vos appareils
- **Restauration cloud** : Téléchargez et restaurez vos sauvegardes à tout moment

### Discord Rich Presence

- Affichage de votre activité StarTrad FR sur Discord
- Statut personnalisé selon l'action en cours (traduction, configuration, etc.)
- Reconnexion automatique en cas de déconnexion Discord
- Activation/désactivation dans les paramètres

### Mises à Jour Automatiques

- Vérification automatique au démarrage de l'application
- Service de fond pour vérifier les mises à jour des traductions
- Téléchargement direct du fichier d'installation (.msi)
- Mode silencieux : vérification en arrière-plan sans interruption

### Gestion du Cache

- Nettoyage du cache Star Citizen (shaders, builds, etc.)
- Analyse de l'espace disque utilisé par dossier
- Ouverture rapide des dossiers système

### Gestion des Personnages

- **Presets locaux** : Gestion, duplication et suppression de vos personnages
- **Presets en ligne** : Téléchargement depuis Star Citizen Characters
- **Sauvegarde automatique** : Création de sauvegardes de vos configurations
- **Restauration multi-versions** : Restauration vers différentes versions du jeu
- Prévisualisation des personnages (images fournies par Star Citizen Characters)

### Gestion des Bindings

- Import de fichiers XML de configuration des contrôles
- Liste de tous les bindings installés
- Suppression facile des bindings non désirés
- Ouverture rapide du dossier des bindings

### RSI Launcher

- Détection automatique du RSI Launcher installé
- Lancement rapide du launcher depuis l'application
- Affichage du statut d'installation

### Paramètres Graphiques

- Configuration du renderer graphique (DX11, DX12, Vulkan)
- Gestion de la résolution dans user.cfg
- Application des paramètres sans ouvrir le jeu

### Actualités Star Citizen

- Flux RSS intégré avec les dernières actualités
- Affichage des images des articles
- Liens cliquables vers les articles complets
- Widget d'accueil avec les 3 dernières actualités

### Patchnotes & Suivi

- Suivi en temps réel des mises à jour du projet
- Historique des commits et changements
- Interface dédiée aux patchnotes

### Interface & Expérience

- **Thèmes personnalisables** : Couleurs et styles au choix
- **Mode sombre/clair** : Basculement facile
- **Transparence** : Effets visuels modernes (Windows Acrylic)
- **System Tray** : Minimisation dans la barre des tâches
- **Instance unique** : Une seule instance de l'application à la fois
- **Démarrage automatique** : Option pour lancer au démarrage de Windows
- **Démarrage minimisé** : Lancement discret dans le tray
- **Liens personnalisés** : Ajoutez vos propres liens dans la sidebar

---

## Installation

### Microsoft Store (recommandé)

StarTrad FR est disponible sur le **Microsoft Store** en tant qu’application **signée et distribuée officiellement par Microsoft**.

- ✅ Signature numérique gérée par Microsoft
- ✅ Aucune alerte Windows SmartScreen
- ✅ Installation et désinstallation propres
- ✅ Mises à jour automatiques via le Store

<a href="https://apps.microsoft.com/detail/9P29JDL68WBZ?referrer=appbadge&mode=full">
  <img src="https://get.microsoft.com/images/fr%20light.svg" width="200"/>
</a>

---

### Version Portable (Recommandée)

_Aucune installation, aucun avertissement Windows_

1. Téléchargez `startradfr.exe` depuis les [Releases](https://github.com/drrakendu78/TradSC/releases/latest)
2. Lancez directement le fichier
3. Profitez !

---

### Installation Standard (MSI / EXE)

_Installation système – recommandée pour un usage classique hors Microsoft Store_

1. Téléchargez `StarTrad FR_x.x.x_x64-setup.exe` ou `StarTrad FR_x.x.x_x64_fr-FR.msi`
2. Si SmartScreen apparaît : **« Plus d'infos » → « Exécuter quand même »**
3. Suivez l'assistant d'installation

---

### Message « Windows a protégé votre ordinateur »

Ce message peut apparaître **uniquement pour les versions hors Microsoft Store** (EXE / MSI / portable).

1. Cliquez sur **Informations complémentaires**
2. Cliquez sur **Exécuter quand même**

> **Note** : les versions distribuées hors Microsoft Store ne sont pas signées individuellement.  
> Le projet reste **100 % gratuit, open-source et auditable**, avec des builds publics via GitHub Actions.

## Sécurité & Transparence

### Pourquoi "Application non-signée" ?

Cette application est **100% gratuite et open-source**. Les certificats de signature coûtent ~300€/an, ce qui va à l'encontre de la philosophie de gratuité totale.

| Ce Projet | Apps Fermées |
| --- | --- |
| Code source public | Code fermé |
| Builds reproductibles | Processus opaque |
| Checksums SHA256 | Confiance aveugle |
| Communauté active | Support payant |
| Gratuit à vie | Modèle freemium |

### Vérification d'intégrité

```powershell
# Vérifier le checksum du fichier téléchargé
Get-FileHash "StarTrad FR_3.1.4_x64-setup.exe" -Algorithm SHA256
```

**Garanties :**

- Code source entièrement auditable
- Builds GitHub Actions publics
- Aucune collecte de données personnelles
- Aucune communication réseau non documentée

---

## Technologies

<div align="center">

| Frontend | Backend | Build & Deploy | Qualité |
| --- | --- | --- | --- |
| ![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black) | ![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) | ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white) | ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) |
| ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) | ![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=black) | ![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white) | ![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white) |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) | ![Tokio](https://img.shields.io/badge/Tokio-000000?style=for-the-badge&logo=rust&logoColor=white) | ![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white) | ![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black) |

</div>

---

## Démarrage Rapide

### Pour les Utilisateurs

```bash
# Télécharger depuis les releases GitHub
https://github.com/drrakendu78/TradSC/releases/latest
```

### Pour les Développeurs

```bash
# Cloner le projet
git clone https://github.com/drrakendu78/TradSC.git
cd TradSC

# Installer les dépendances
pnpm install

# Lancer en développement
pnpm tauri dev

# Build de production
pnpm tauri build
```

---

## Prérequis (Développement)

- Node.js (version 18 ou supérieure)
- Rust (dernière version stable)
- pnpm (gestionnaire de paquets)
- Visual Studio C++ Build Tools
- WebView2

---

## Communauté & Support

### Partenaires & Sources de Traduction

- **[SCEFRA](https://discord.com/invite/DccQN8BN2V)** - Traductions françaises de Star Citizen
- **Communauté Hugo Lisoir** - Traduction des circuspes
- **[Star Citizen Characters](https://www.star-citizen-characters.com/)** - Base de données de presets

### Support

Pour obtenir de l'aide ou signaler un bug :

- Ouvrez une [Issue](https://github.com/drrakendu78/TradSC/issues) sur GitHub

---

## Contribution

1. **Fork** le projet
2. **Créez** votre branche feature (`git checkout -b feature/AmazingFeature`)
3. **Committez** vos changements (`git commit -m 'Add: Amazing Feature'`)
4. **Push** vers la branche (`git push origin feature/AmazingFeature`)
5. **Ouvrez** une Pull Request

---

## Licence

Ce projet est sous licence **MIT** - voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## Changelog Récent

### Version 3.1.4
- Deep Link Protocol `startradfr://` pour OAuth Discord
- Popup "Ouvrir StarTrad FR ?" dans le navigateur
- Correction de la déconnexion

### Version 3.1.3
- Correction du scroll sur les presets
- Correction du bouton navigateur sur les actualités

### Version 3.1.2
- Correction de l'auto-update
- Synchronisation cloud des préférences
- Amélioration des actualités

### Version 3.1.1
- Auto-reconnexion Discord RPC
- Correction des sauvegardes cloud

### Version 3.1.0
- Synchronisation cloud des préférences
- Nouvelle UI patchnotes et actualités

---

## Remerciements

<div align="center">

**Développé avec passion par [Drrakendu78](https://github.com/drrakendu78)**

### Crédits

**StarTrad FR** est basé sur **[MultitoolV2](https://github.com/Onivoid/MultitoolV2)** développé par **[Onivoid](https://github.com/Onivoid)**.

Un grand merci à **Onivoid** pour avoir créé cette base solide et open-source !

_Merci également à la communauté Star Citizen française et aux contributeurs !_

[![Contributors](https://img.shields.io/github/contributors/drrakendu78/TradSC?style=for-the-badge)](https://github.com/drrakendu78/TradSC/graphs/contributors)

---

### Si ce projet vous aide, n'hésitez pas à lui donner une étoile !

[![Star History Chart](https://api.star-history.com/svg?repos=drrakendu78/TradSC&type=Date)](https://star-history.com/#drrakendu78/TradSC&Date)

</div>
