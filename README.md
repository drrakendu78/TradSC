<div align="center">

# 🚀 StarTrad FR

_Traduction française pour Star Citizen - Version 2

[![Release](https://img.shields.io/github/v/release/drrakendu78/TradSC?style=for-the-badge&logo=github&logoColor=white)](https://github.com/drrakendu78/TradSC/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/drrakendu78/TradSC/total?style=for-the-badge&logo=download&logoColor=white)](https://github.com/drrakendu78/TradSC/releases)
[![License](https://img.shields.io/github/license/drrakendu78/TradSC?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/drrakendu78/TradSC?style=for-the-badge&logo=star&logoColor=white)](https://github.com/drrakendu78/TradSC/stargazers)

---

**StarTrad FR** est une application desktop moderne et gratuite pour gérer la traduction française de Star Citizen. Développée avec Tauri 2, React et TypeScript, elle offre une interface intuitive et de nombreuses fonctionnalités pour améliorer votre expérience de jeu.

> 💡 **Note** : StarTrad FR est basé sur [MultitoolV2](https://github.com/Onivoid/MultitoolV2) développé par [Onivoid](https://github.com/Onivoid), adapté et spécialisé pour la traduction française de Star Citizen.

</div>

## ✨ Fonctionnalités

### 🌍 **Traduction Française**

-   Installation de traductions françaises pour Star Citizen
-   **SCEFRA** : Traduction française principale
-   **Communauté Hugo Lisoir** : Traduction des circuspes
-   Support de multiples sources de traduction
-   Vérification automatique des mises à jour des traductions
-   Désinstallation propre en un clic
-   Gestion des traductions FR/EN avec basculement facile
-   Sélection parmi plusieurs traductions disponibles via menu déroulant

### 🔄 **Mises à Jour Automatiques**

-   ✨ **Vérification automatique au démarrage** : L'application vérifie automatiquement les mises à jour disponibles
-   📥 **Téléchargement direct** : Le bouton GitHub télécharge directement le fichier d'installation (.msi) si une mise à jour est disponible
-   🎯 **Priorisation intelligente** : Le système privilégie automatiquement le fichier .msi pour une installation plus propre
-   ⚡ **Mode silencieux** : Vérification en arrière-plan sans notification si aucune mise à jour n'est disponible

### 🧹 **Gestion du Cache**

-   Nettoyage du cache Star Citizen
-   Analyse de l'espace disque utilisé
-   Ouverture rapide des dossiers système

### 👥 **Gestion des Personnages**

-   **Presets locaux** : Gestion, Duplication et Suppression de vos personnages
-   **Presets en ligne** : Téléchargement depuis Star Citizen Characters
-   **Sauvegarde automatique** : Création de sauvegardes de vos configurations de personnages
-   **Restauration multi-versions** : Restauration vers différentes versions du jeu (LIVE, PTU, etc.)
-   Duplication et organisation des presets
-   Prévisualisation des personnages (Images fournies par Star Citizen Characters)

### ⌨️ **Gestion des Bindings**

-   Import de bindings : Importation de fichiers XML de configuration des contrôles
-   Liste des bindings : Affichage de tous les bindings installés
-   Suppression : Suppression facile des bindings non désirés
-   Ouverture du dossier : Accès rapide au dossier des bindings

### 📰 **Actualités Star Citizen**

-   Flux RSS intégré : Affichage des dernières actualités Star Citizen depuis le flux RSS officiel
-   Images des articles : Affichage des images associées aux articles
-   Liens cliquables : Ouverture des articles dans le navigateur par défaut
-   Widget d'accueil : Affichage des 3 dernières actualités sur la page d'accueil

### 📋 **Patchnotes & Suivi**

-   Suivi en temps réel des mises à jour du projet
-   Historique des commits et changements
-   Notifications automatiques des nouvelles versions

### 🎨 **Interface Moderne**

-   **Personnalisation** : Couleurs et thèmes personnalisables
-   **Navigation fluide** : Sidebar avec accès rapide
-   **Transparence** : Effets visuels modernes (Windows)
-   **Mode sombre/clair** : Basculement facile entre les thèmes

---

## 📥 Installation

### 🏆 **RECOMMANDÉ - Version Portable**

_Aucune installation, aucun avertissement Windows_

```bash
1. Téléchargez StarTrad_FR-Portable_2.0.2.exe
2. Lancez directement le fichier
3. Profitez ! ✨
```

### 💾 **Installation Standard (MSI)**

_Installation système classique - Recommandé pour les mises à jour automatiques_

```bash
1. Téléchargez StarTrad FR_2.0.2_x64_fr-FR.msi
2. Si SmartScreen : "Plus d'infos" → "Exécuter quand même"
3. Suivez l'assistant d'installation
```

### ⚠️ **Message « Windows a protégé votre ordinateur » lors de l'installation**

Si Windows affiche un message bleu « Windows a protégé votre ordinateur » lors du lancement du fichier `.msi`, voici comment forcer l'exécution :

1. Double-cliquez sur le fichier que vous souhaitez ouvrir.
2. Sur la fenêtre bleue, cliquez sur **Informations complémentaires**
3. Puis cliquez sur **Exécuter quand même** en bas de la fenêtre

Windows ouvrira alors le fichier et l'installation pourra continuer normalement.

> **Astuce :** Les prochaines mises à jour seront proposées automatiquement dans l'application grâce au système d'auto-update.

---

## ⚠️ Sécurité & Transparence

### 🔓 **Pourquoi "Application non-signée" ?**

Cette application est **100% gratuite et open-source**. Les certificats de signature coûtent ~300€/an, ce qui va à l'encontre de la philosophie de gratuité totale.

**Au lieu d'une signature payante, ce projet offre :**

| ✅ **Ce Modèle**             | ❌ **Apps Fermées**  |
| ---------------------------- | -------------------- |
| 🔍 **Code source public**    | 🔒 Code fermé        |
| 🏗️ **Builds reproductibles** | ❓ Processus opaque  |
| 🛡️ **Checksums SHA256**      | ⚠️ Confiance aveugle |
| 👥 **Communauté active**     | 📞 Support payant    |
| 🆓 **Gratuit à vie**         | 💰 Modèle freemium   |

### 🔐 **Vérifications de Sécurité**

```powershell
# Vérifier l'intégrité du fichier téléchargé
Get-FileHash "StarTrad FR_2.0.2_x64_fr-FR.msi" -Algorithm SHA256
Get-FileHash "StarTrad_FR-Portable_2.0.2.exe" -Algorithm SHA256

# Comparer avec le checksum fourni dans la release
```

**Checksums SHA256 pour la version 2.0.2 :**

- **MSI** : `495662aa563a14a9db8a03037c01236a91d4edcd57152d72e15cc08334d58518`
- **EXE Setup** : `2c9e6b98eaf4e22b80eaa15757713b982aa80a689080b43c0991ad140d12170a`
- **Portable** : `118d1eeb27684b1895169ef8eabad7299a719103d3211f9a6d136b2fe0a85be8`

**Garanties :**

-   ✅ Code source entièrement auditable
-   ✅ Builds GitHub Actions publics
-   ✅ Aucune collecte de données personnelles
-   ✅ Aucune communication réseau non documentée

📖 **Consultez notre Politique de confidentialité :** [PRIVACY.md](PRIVACY.md)

---

## 🛠️ Technologies

<div align="center">

| Frontend                                                                                                                | Backend                                                                                            | Build & Deploy                                                                                                                | Qualité                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)                      | ![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)    | ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white) | ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) |
| ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)       | ![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=black) | ![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white)             | ![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)             |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) | ![Tokio](https://img.shields.io/badge/Tokio-000000?style=for-the-badge&logo=rust&logoColor=white)  | ![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)                                | ![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black)       |

</div>

---

## 🚀 Démarrage Rapide

### Pour les Utilisateurs

```bash
# Télécharger depuis les releases GitHub
https://github.com/drrakendu78/TradSC/releases/latest

# Ou télécharger directement le portable
curl -L -o StarTrad_FR-Portable.exe https://github.com/drrakendu78/TradSC/releases/latest/download/StarTrad_FR-Portable_2.0.2.exe
.\StarTrad_FR-Portable.exe
```

> Vous pouvez aussi télécharger depuis les [GitHub Releases](https://github.com/drrakendu78/TradSC/releases)

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

👀 **Pour les instructions de build détaillées :** [BUILD.md](BUILD.md)

---

## 📋 Prérequis

-   Node.js (version 16 ou supérieure)
-   Rust (dernière version stable)
-   pnpm (gestionnaire de paquets)
-   Visual Studio C++ Build Tools
-   WebView2

📖 **Guide d'installation des outils de build :** [INSTALL_BUILD_TOOLS.md](INSTALL_BUILD_TOOLS.md)

---

## 📊 Statistiques

<div align="center">

![GitHub language count](https://img.shields.io/github/languages/count/drrakendu78/TradSC?style=for-the-badge)
![GitHub top language](https://img.shields.io/github/languages/top/drrakendu78/TradSC?style=for-the-badge)
![GitHub code size](https://img.shields.io/github/languages/code-size/drrakendu78/TradSC?style=for-the-badge)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/drrakendu78/TradSC?style=for-the-badge)

</div>

---

## 💬 Communauté & Support

### 🤝 Partenaires & Sources de Traduction

-   **[SCEFRA](https://discord.com/invite/DccQN8BN2V)** - Traductions françaises de Star Citizen
-   **Communauté Hugo Lisoir** - Traduction des circuspes
-   **[Star Citizen Characters](https://www.star-citizen-characters.com/)** - Base de données de presets

### 📞 Support

Pour obtenir de l'aide ou signaler un bug :

-   Ouvrez une [Issue](https://github.com/drrakendu78/TradSC/issues) sur GitHub

---

## 🤝 Contribution

### Comment contribuer ?

1. 🍴 **Fork** le projet
2. 🌿 **Créez** votre branche feature (`git checkout -b feature/AmazingFeature`)
3. 💾 **Committez** vos changements (`git commit -m 'Add: Amazing Feature'`)
4. 📤 **Push** vers la branche (`git push origin feature/AmazingFeature`)
5. 🔀 **Ouvrez** une Pull Request

📖 **Guide détaillé :** [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📄 Licence

Ce projet est sous licence **MIT** - voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 📝 Changelog

### Version 2.0.2

-   ✨ Vérification automatique des mises à jour au démarrage
-   📥 Téléchargement direct du fichier .msi depuis GitHub
-   🎯 Priorisation intelligente des fichiers de mise à jour
-   🔧 Corrections de bugs et améliorations techniques

📖 **Voir le changelog complet :** [CHANGELOG_V2.md](CHANGELOG_V2.md)  
📋 **Notes de version détaillées :** [PATCHNOTES_2.0.2.md](PATCHNOTES_2.0.2.md)

---

## ❤️ Remerciements

<div align="center">

**Développé avec 💜 par [Drrakendu78](https://github.com/drrakendu78)**

### 🙏 Crédits

**StarTrad FR** est basé sur **[MultitoolV2](https://github.com/Onivoid/MultitoolV2)** développé par **[Onivoid](https://github.com/Onivoid)**.

Un grand merci à **Onivoid** pour avoir créé cette base solide et open-source qui a permis le développement de StarTrad FR !

_Un grand merci également à la communauté Star Citizen française et aux contributeurs qui participent à ce projet !_

[![Contributors](https://img.shields.io/github/contributors/drrakendu78/TradSC?style=for-the-badge)](https://github.com/drrakendu78/TradSC/graphs/contributors)

---

### 🌟 Si ce projet vous aide, n'hésitez pas à lui donner une étoile !

[![Star History Chart](https://api.star-history.com/svg?repos=drrakendu78/TradSC&type=Date)](https://star-history.com/#drrakendu78/TradSC&Date)

</div>
