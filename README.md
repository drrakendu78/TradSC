# StarTrad FR

Une application de bureau construite avec Tauri et React pour gérer les traductions françaises de Star Citizen.

## 🚀 Installation simple

1. Rendez-vous sur la page [Releases du projet](https://github.com/drrakendu78/TradSC/releases).
2. Téléchargez le fichier `.msi` le plus récent (ex : `Traduction.Francaise.Iridian.For.Prosperity_1.2.0_x64_fr-FR.msi`).
3. Lancez le fichier `.msi` pour installer l'application.
4. Suivez les instructions à l'écran.

### ⚠️ Message « Windows a protégé votre ordinateur » lors de l'installation

Si Windows affiche un message bleu « Windows a protégé votre ordinateur » lors du lancement du fichier `.msi`, voici comment forcer l'exécution :

1. Double-cliquez sur le fichier que vous souhaitez ouvrir.
2. Sur la fenêtre bleue, cliquez sur **Informations complémentaires** (voir image ci-dessous) :

![SmartScreen Informations complémentaires](https://github.com/drrakendu78/TradSC-docs/blob/main/public/smartscreen_info.png?raw=true)

3. Puis cliquez sur **Exécuter quand même** en bas de la fenêtre (voir image ci-dessous) :

![SmartScreen Exécuter quand même](https://github.com/drrakendu78/TradSC-docs/blob/main/public/smartscreen_run.png?raw=true)

> **Note :** Les images ci-dessus sont utilisées uniquement à titre d'illustration et ne sont pas la propriété du projet. Elles servent d'exemple pour guider les utilisateurs dans le processus d'installation.

Windows ouvrira alors le fichier et l'installation pourra continuer normalement.

> **Astuce :** Les prochaines mises à jour seront proposées automatiquement dans l'application grâce au système d'auto-update.

## 🚀 Fonctionnalités

- 🌍 Gestion des traductions françaises
- 🧹 Nettoyage du cache du jeu
- 🎨 Interface utilisateur moderne et personnalisable
- 🌓 Mode sombre/clair
- 📰 Flux RSS des actualités
- ⌨️ Importez vos configurations de touches rapidement et facilement
- 💾 Créez des sauvegardes de vos personnages pour ne jamais perdre vos progrès

## 📋 Prérequis

- [Node.js](https://nodejs.org/) (version 16 ou supérieure)
- [Rust](https://www.rust-lang.org/) (dernière version stable)
- [pnpm](https://pnpm.io/) (gestionnaire de paquets)
- [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## 🛠️ Installation

1. Clonez le dépôt :
```bash
git clone https://github.com/drrakendu78/TradSC.git
cd votre-repo
```

2. Installez les dépendances :
```bash
pnpm install
```

3. Lancez l'application en mode développement :
```bash
pnpm tauri dev
```

## 📦 Construction

Pour créer une version de production :

```bash
pnpm tauri build
```
## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à :

1. Fork le projet
2. Créer une branche pour votre fonctionnalité
3. Commiter vos changements
4. Pousser vers la branche
5. Ouvrir une Pull Request

## 📝 Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🔒 Confidentialité

Consultez notre [Politique de confidentialité](PRIVACY.md) pour plus d'informations.

## 📞 Support

Pour obtenir de l'aide ou signaler un bug :
- Rejoignez notre [Discord](https://discord.gg/xeczPncUY4)
- Ouvrez une [Issue](https://github.com/drrakendu78/TradSC/issues)

## ✨ Remerciements

- L'équipe Iridian For Prosperity
- La communauté Star Citizen
- Tous les contributeurs du projet

