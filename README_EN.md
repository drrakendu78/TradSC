<div align="center">

# StarTrad FR

**English** | [🇫🇷 Français](README.md)

_French Translation Tool for Star Citizen – Version 3_

[![Release](https://img.shields.io/github/v/release/drrakendu78/TradSC?style=for-the-badge&logo=github&logoColor=white)](https://github.com/drrakendu78/TradSC/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/drrakendu78/TradSC/total?style=for-the-badge&logo=download&logoColor=white)](https://github.com/drrakendu78/TradSC/releases)
[![License](https://img.shields.io/github/license/drrakendu78/TradSC?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/drrakendu78/TradSC?style=for-the-badge&logo=star&logoColor=white)](https://github.com/drrakendu78/TradSC/stargazers)

<br/>

<a href="https://apps.microsoft.com/detail/9P29JDL68WBZ?referrer=appbadge&mode=full">
  <img src="https://get.microsoft.com/images/en%20light.svg" width="200"/>
</a>

<br/>

<sub>
✔️ <strong>Microsoft Store</strong> version: application <strong>signed and distributed by Microsoft</strong><br/>
✔️ <strong>EXE / MSI</strong> versions available on GitHub (unsigned)<br/>
➡️ EXE / MSI versions include an additional feature:<br/>
<strong>automatic RSI Launcher download button</strong> if not installed.
</sub>

---

**StarTrad FR** is a modern and free desktop application to manage the French translation for Star Citizen.
Built with <strong>Tauri 2</strong>, <strong>React</strong> and <strong>TypeScript</strong>, it offers an intuitive interface and many features to enhance your gaming experience.

> **Note**: StarTrad FR is based on [MultitoolV2](https://github.com/Onivoid/MultitoolV2) developed by [Onivoid](https://github.com/Onivoid), adapted and specialized for the French translation of Star Citizen.

</div>

## Features

### French Translation

- Install French translations for Star Citizen (LIVE, PTU, EPTU, TECH-PREVIEW)
- **SCEFRA**: Main French translation
- **Hugo Lisoir Community**: Circuspes translation
- Support for multiple translation sources
- Automatic background check for translation updates
- One-click clean uninstall
- Select from multiple available translations via dropdown menu
- **Offline cache**: Local backup of translations for installation without internet

### Cloud & Synchronization

- **Discord Login**: Secure authentication via Discord OAuth
- **Deep Link Protocol**: Browser popup "Open StarTrad FR?" for seamless connection
- **Cloud backup**: Save your characters and configurations to the cloud
- **Preferences sync**: Access your settings on all your devices
- **Cloud restore**: Download and restore your backups anytime

### Discord Rich Presence

- Display your StarTrad FR activity on Discord
- Custom status based on current action (translation, configuration, etc.)
- Automatic reconnection on Discord disconnect
- Enable/disable in settings

### Automatic Updates

- Automatic check on application startup
- Background service to check for translation updates
- Direct download of the installation file (.msi)
- Silent mode: background check without interruption

### Cache Management

- Clean Star Citizen cache (shaders, builds, etc.)
- Analyze disk space used by folder
- Quick access to system folders

### Character Management

- **Local presets**: Manage, duplicate and delete your characters
- **Online presets**: Download from Star Citizen Characters
- **Automatic backup**: Create backups of your configurations
- **Multi-version restore**: Restore to different game versions
- Character preview (images provided by Star Citizen Characters)

### Bindings Management

- Import XML control configuration files
- List all installed bindings
- Easy deletion of unwanted bindings
- Quick access to bindings folder

### RSI Launcher

- Automatic detection of installed RSI Launcher
- Quick launcher start from the application
- Installation status display

### Graphics Settings

- Configure graphics renderer (DX11, DX12, Vulkan)
- Resolution management in user.cfg
- Apply settings without opening the game

### Star Citizen News

- Integrated RSS feed with latest news
- Article image display
- Clickable links to full articles
- Home widget with 3 latest news items

### Patchnotes & Tracking

- Real-time tracking of project updates
- Commit and change history
- Dedicated patchnotes interface

### Interface & Experience

- **Customizable themes**: Colors and styles of your choice
- **Dark/Light mode**: Easy toggle
- **Transparency**: Modern visual effects (Windows Acrylic)
- **System Tray**: Minimize to taskbar
- **Single instance**: Only one instance of the application at a time
- **Auto-start**: Option to launch on Windows startup
- **Start minimized**: Discreet launch in tray
- **Custom links**: Add your own links to the sidebar

---

## Installation

### Microsoft Store (Recommended)

StarTrad FR is available on the **Microsoft Store** as an application **officially signed and distributed by Microsoft**.

- ✅ Digital signature managed by Microsoft
- ✅ No Windows SmartScreen alerts
- ✅ Clean installation and uninstallation
- ✅ Automatic updates via Store

<a href="https://apps.microsoft.com/detail/9P29JDL68WBZ?referrer=appbadge&mode=full">
  <img src="https://get.microsoft.com/images/en%20light.svg" width="200"/>
</a>

---

### Portable Version (Recommended)

_No installation, no Windows warnings_

1. Download `startradfr.exe` from [Releases](https://github.com/drrakendu78/TradSC/releases/latest)
2. Run the file directly
3. Enjoy!

---

### Standard Installation (MSI / EXE)

_System installation – recommended for classic use outside Microsoft Store_

1. Download `StarTrad FR_x.x.x_x64-setup.exe` or `StarTrad FR_x.x.x_x64_fr-FR.msi`
2. If SmartScreen appears: **"More info" → "Run anyway"**
3. Follow the installation wizard

---

### "Windows protected your PC" Message

This message may appear **only for versions outside Microsoft Store** (EXE / MSI / portable).

1. Click on **More info**
2. Click on **Run anyway**

> **Note**: Versions distributed outside Microsoft Store are not individually signed.
> The project remains **100% free, open-source and auditable**, with public builds via GitHub Actions.

## Security & Transparency

### Why "Unsigned Application"?

This application is **100% free and open-source**. Code signing certificates cost ~$300/year, which goes against the philosophy of total gratuity.

| This Project | Closed Apps |
| --- | --- |
| Public source code | Closed code |
| Reproducible builds | Opaque process |
| SHA256 checksums | Blind trust |
| Active community | Paid support |
| Free forever | Freemium model |

### Integrity Verification

```powershell
# Verify the checksum of the downloaded file
Get-FileHash "StarTrad FR_3.1.4_x64-setup.exe" -Algorithm SHA256
```

**Guarantees:**

- Fully auditable source code
- Public GitHub Actions builds
- No personal data collection
- No undocumented network communication

---

## Technologies

<div align="center">

| Frontend | Backend | Build & Deploy | Quality |
| --- | --- | --- | --- |
| ![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black) | ![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) | ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white) | ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) |
| ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) | ![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=black) | ![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white) | ![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white) |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) | ![Tokio](https://img.shields.io/badge/Tokio-000000?style=for-the-badge&logo=rust&logoColor=white) | ![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white) | ![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black) |

</div>

---

## Quick Start

### For Users

```bash
# Download from GitHub releases
https://github.com/drrakendu78/TradSC/releases/latest
```

### For Developers

```bash
# Clone the project
git clone https://github.com/drrakendu78/TradSC.git
cd TradSC

# Install dependencies
pnpm install

# Run in development
pnpm tauri dev

# Production build
pnpm tauri build
```

---

## Prerequisites (Development)

- Node.js (version 18 or higher)
- Rust (latest stable version)
- pnpm (package manager)
- Visual Studio C++ Build Tools
- WebView2

---

## Community & Support

### Partners & Translation Sources

- **[SCEFRA](https://discord.com/invite/DccQN8BN2V)** - French translations for Star Citizen
- **Hugo Lisoir Community** - Circuspes translation
- **[Star Citizen Characters](https://www.star-citizen-characters.com/)** - Preset database

### Support

For help or to report a bug:

- Open an [Issue](https://github.com/drrakendu78/TradSC/issues) on GitHub

---

## Contributing

1. **Fork** the project
2. **Create** your feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add: Amazing Feature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

---

## License

This project is licensed under the **MIT** License - see the [LICENSE](LICENSE) file for details.

---

## Recent Changelog

### Version 3.1.4
- Deep Link Protocol `startradfr://` for Discord OAuth
- "Open StarTrad FR?" popup in browser
- Logout fix

### Version 3.1.3
- Scroll fix on presets
- Browser button fix on news

### Version 3.1.2
- Auto-update fix
- Cloud preferences sync
- News improvements

### Version 3.1.1
- Discord RPC auto-reconnection
- Cloud backup fixes

### Version 3.1.0
- Cloud preferences sync
- New patchnotes and news UI

---

## Acknowledgments

<div align="center">

**Developed with passion by [Drrakendu78](https://github.com/drrakendu78)**

### Credits

**StarTrad FR** is based on **[MultitoolV2](https://github.com/Onivoid/MultitoolV2)** developed by **[Onivoid](https://github.com/Onivoid)**.

A big thank you to **Onivoid** for creating this solid and open-source foundation!

_Thanks also to the French Star Citizen community and contributors!_

[![Contributors](https://img.shields.io/github/contributors/drrakendu78/TradSC?style=for-the-badge)](https://github.com/drrakendu78/TradSC/graphs/contributors)

---

### If this project helps you, feel free to give it a star!

[![Star History Chart](https://api.star-history.com/svg?repos=drrakendu78/TradSC&type=Date)](https://star-history.com/#drrakendu78/TradSC&Date)

</div>
