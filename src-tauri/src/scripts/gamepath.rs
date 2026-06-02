use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::SystemTime;
use tauri::command;

fn get_log_file_path() -> Option<String> {
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = env::var("APPDATA") {
            let rsi_launcher_path = format!("{}\\rsilauncher", appdata);
            let log_file_path = format!("{}\\logs\\log.log", rsi_launcher_path);
            return Some(log_file_path);
        }
    }
    None
}

fn get_launcher_log_list() -> Vec<String> {
    if let Some(log_file_path) = get_log_file_path() {
        if let Ok(contents) = fs::read_to_string(log_file_path) {
            return contents.lines().map(|s| s.to_string()).collect();
        }
    }
    Vec::new()
}

fn check_and_add_path(path: &str, check_exists: bool, sc_install_paths: &mut Vec<String>) {
    let path = path.replace("\\\\", "\\");
    // Normaliser le chemin en supprimant les backslashes à la fin
    let normalized_path = path.trim_end_matches('\\').to_string();

    if !normalized_path.is_empty()
        && !sc_install_paths
            .iter()
            .any(|existing_path| existing_path.trim_end_matches('\\') == normalized_path)
    {
        if !check_exists {
            sc_install_paths.push(normalized_path);
        } else {
            let exe_path = format!("{}\\Bin64\\StarCitizen.exe", normalized_path);
            let data_p4k_path = format!("{}\\Data.p4k", normalized_path);
            if Path::new(&exe_path).exists() && Path::new(&data_p4k_path).exists() {
                sc_install_paths.push(normalized_path);
            }
        }
    }
}

fn get_game_install_path(list_data: &[String], check_exists: bool) -> Vec<String> {
    let mut sc_install_paths = Vec::new();

    // Expression régulière pour détecter les chemins avec des versions dynamiques
    let pattern = r"([a-zA-Z]:\\\\(?:[^\\\\]+\\\\)*StarCitizen\\\\[A-Za-z0-9_\\.\\@\\-]+)";
    let re = match Regex::new(pattern) {
        Ok(re) => re,
        Err(e) => {
            println!("Erreur lors de la compilation de la regex: {}", e);
            return sc_install_paths;
        }
    };

    for line in list_data.iter().rev() {
        for cap in re.captures_iter(line) {
            if let Some(matched_path) = cap.get(0) {
                check_and_add_path(matched_path.as_str(), check_exists, &mut sc_install_paths);
            }
        }
    }

    sc_install_paths
}

fn get_game_channel_id(install_path: &str) -> String {
    // Expression régulière pour capturer la version à la fin du chemin après "StarCitizen\\"
    let re = match Regex::new(r"StarCitizen\\([A-Za-z0-9_\\.\\@-]+)\\?$") {
        Ok(re) => re,
        Err(e) => {
            println!("Erreur lors de la compilation de la regex: {}", e);
            return "UNKNOWN".to_string();
        }
    };

    if let Some(cap) = re.captures(install_path) {
        if let Some(version) = cap.get(1) {
            let version_str = version.as_str();
            // Normaliser en supprimant les backslashes à la fin
            return version_str.trim_end_matches('\\').to_string();
        }
    }
    "UNKNOWN".to_string()
}

fn read_build_manifest_info(
    install_path: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let manifest_path = Path::new(install_path).join("build_manifest.id");
    let Ok(contents) = fs::read_to_string(manifest_path) else {
        return (None, None, None);
    };

    let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return (None, None, None);
    };

    let data = json.get("Data").unwrap_or(&json);
    let clean = |value: Option<&serde_json::Value>| {
        value
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("none"))
            .map(ToOwned::to_owned)
    };

    let build_number =
        clean(data.get("RequestedP4ChangeNum")).or_else(|| clean(data.get("BuildId")));
    let game_version = clean(data.get("Version"));
    let branch = clean(data.get("Branch"));

    (build_number, game_version, branch)
}

fn get_launcher_release_version(log_lines: &[String], channel: &str) -> Option<String> {
    let escaped_channel = regex::escape(channel);
    let version_pattern = r"([0-9]+(?:\.[0-9]+)+(?:[-.][A-Za-z0-9]+)*)";
    let patterns = [
        format!(r"(?i)\bSC\s+{}\s+{}", escaped_channel, version_pattern),
        format!(
            r"(?i)\bStar Citizen\s+{}\s+{}",
            escaped_channel, version_pattern
        ),
    ];
    let regexes: Vec<Regex> = patterns
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect();

    for line in log_lines.iter().rev() {
        for re in &regexes {
            if let Some(cap) = re.captures(line) {
                if let Some(version) = cap.get(1) {
                    let version = version.as_str().trim();
                    if !version.is_empty() {
                        return Some(version.to_string());
                    }
                }
            }
        }
    }

    None
}

#[derive(Serialize)]
pub struct VersionInfo {
    pub path: String,
    pub translated: bool,
    pub up_to_date: bool,
    pub release_version: Option<String>,
    pub build_number: Option<String>,
    pub game_version: Option<String>,
    pub branch: Option<String>,
}

#[derive(Serialize)]
pub struct VersionPaths {
    pub versions: HashMap<String, VersionInfo>,
}

#[command]
pub fn get_star_citizen_versions() -> VersionPaths {
    let log_lines = get_launcher_log_list();
    let sc_install_paths = get_game_install_path(&log_lines, true);

    let mut versions = HashMap::new();
    for path in &sc_install_paths {
        // Normaliser le chemin en supprimant les backslashes à la fin
        let normalized_path = path.trim_end_matches('\\').to_string();
        let version = get_game_channel_id(&normalized_path);

        if version != "UNKNOWN" && !versions.contains_key(&version) {
            let (build_number, game_version, branch) = read_build_manifest_info(&normalized_path);
            let release_version = get_launcher_release_version(&log_lines, &version);
            versions.insert(
                version,
                VersionInfo {
                    path: normalized_path,
                    translated: false,
                    up_to_date: false,
                    release_version,
                    build_number,
                    game_version,
                    branch,
                },
            );
        }
    }
    VersionPaths { versions }
}

/// Cherche `RSI Launcher\RSI Launcher.exe` à proximité d'un chemin de jeu
/// donné, en remontant les parents successifs jusqu'à 5 niveaux. Utilisé
/// par `find_rsi_launcher_path` step 0 pour gérer les installs custom où
/// le dossier `Roberts Space Industries\` n'existe pas (ex: pticopate qui
/// a `D:\Games\RSI Games\StarCitizen\LIVE` et `D:\Games\RSI Launcher\`).
///
/// Layout standard SC : jeu = `<X>\Roberts Space Industries\StarCitizen\LIVE`
/// → 2 remontées (`<X>\Roberts Space Industries\`) → trouve launcher ✓.
/// Layout pticopate : jeu = `D:\Games\RSI Games\StarCitizen\LIVE` →
/// 3 remontées (`D:\Games\`) → trouve `D:\Games\RSI Launcher\` ✓.
///
/// Max 5 niveaux pour éviter une recherche jusqu'à la racine drive.
fn find_launcher_near_game(game_path: &str) -> Option<String> {
    let mut current = Path::new(game_path).parent();
    for _ in 0..5 {
        if let Some(parent) = current {
            let candidate = parent.join("RSI Launcher").join("RSI Launcher.exe");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
            current = parent.parent();
        } else {
            break;
        }
    }
    None
}

/// Trouve le chemin du RSI Launcher s'il est installé.
///
/// 4 stratégies en fallback (ordre du plus fiable au moins fiable) :
///
/// **0. Déduction depuis le chemin du JEU** (ajouté pour pticopate +
///    amnexiatm — Discord thread #1506590303539171340). La détection du jeu
///    utilise une regex `StarCitizen\\` qui ne dépend pas du dossier parent
///    `Roberts Space Industries\`, donc elle MARCHE même pour les installs
///    custom (ex: `D:\Games\RSI Games\StarCitizen\LIVE`). On remonte les
///    parents du chemin du jeu et on cherche `RSI Launcher\RSI Launcher.exe`
///    à chaque niveau (max 5 niveaux pour éviter la remontée à la racine).
///    Cas pticopate : jeu `D:\Games\RSI Games\StarCitizen\LIVE` → parent
///    `D:\Games\` contient `RSI Launcher\` → trouvé ✓.
///
/// **1. Logs RSI** : regex sur `Roberts Space Industries\\` (ne trouve QUE
///    les installs standards).
///
/// **2. Chemins hardcodés C:\Program Files[(x86)]\Roberts Space Industries\...** (ne marche QUE pour install C: standard).
///
/// **3. Registry Windows** HKLM + HKCU `Uninstall\*` cherchant `DisplayName`
///    contenant "RSI Launcher" (échoue si pas d'install via setup officiel).
fn find_rsi_launcher_path() -> Option<String> {
    // -1. Chemin MANUEL défini par l'utilisateur (priorité absolue, opt-in).
    //     N'est utilisé que s'il a été sauvegardé ET que le .exe existe encore,
    //     sinon on retombe sur l'auto-détection ci-dessous.
    #[cfg(target_os = "windows")]
    {
        if let Some(manual) = read_manual_launcher_path() {
            return Some(manual);
        }
    }

    let log_lines = get_launcher_log_list();

    // 0. Déduction depuis le chemin du jeu. Récupère le premier chemin
    //    valide via la regex StarCitizen\\ (qui marche même sans dossier
    //    parent Roberts Space Industries). Remonte les parents et cherche
    //    RSI Launcher\RSI Launcher.exe à côté.
    if !log_lines.is_empty() {
        let game_paths = get_game_install_path(&log_lines, true);
        for game_path in &game_paths {
            if let Some(launcher) = find_launcher_near_game(game_path) {
                return Some(launcher);
            }
        }
    }

    // 1. D'abord, essayer de trouver via les logs RSI (comme pour la détection du jeu)
    // Le launcher est dans le même dossier parent que StarCitizen
    if !log_lines.is_empty() {
        // Expression régulière pour extraire le chemin Roberts Space Industries
        let re = match Regex::new(r"([a-zA-Z]:\\(?:[^\\]+\\)*Roberts Space Industries)\\") {
            Ok(re) => re,
            Err(_) => return None,
        };

        for line in log_lines.iter().rev() {
            for cap in re.captures_iter(line) {
                if let Some(matched_path) = cap.get(1) {
                    let rsi_path = matched_path.as_str().replace("\\\\", "\\");
                    let launcher_path = format!("{}\\RSI Launcher\\RSI Launcher.exe", rsi_path);
                    if Path::new(&launcher_path).exists() {
                        return Some(launcher_path);
                    }
                }
            }
        }
    }

    // 2. Chemins standards par défaut
    let possible_paths = vec![
        "C:\\Program Files\\Roberts Space Industries\\RSI Launcher\\RSI Launcher.exe".to_string(),
        "C:\\Program Files (x86)\\Roberts Space Industries\\RSI Launcher\\RSI Launcher.exe"
            .to_string(),
    ];

    for path in &possible_paths {
        if Path::new(path).exists() {
            return Some(path.clone());
        }
    }

    // 3. Essayer de trouver via le registre Windows
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // Clé de registre pour les applications installées (HKLM)
        if let Ok(hklm) = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
        {
            for key_name in hklm.enum_keys().filter_map(|x| x.ok()) {
                if let Ok(subkey) = hklm.open_subkey(&key_name) {
                    if let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") {
                        if display_name.contains("RSI Launcher") {
                            if let Some(p) = launcher_from_uninstall_key(&subkey) {
                                return Some(p);
                            }
                        }
                    }
                }
            }
        }

        // Essayer aussi HKCU
        if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
        {
            for key_name in hkcu.enum_keys().filter_map(|x| x.ok()) {
                if let Ok(subkey) = hkcu.open_subkey(&key_name) {
                    if let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") {
                        if display_name.contains("RSI Launcher") {
                            if let Some(p) = launcher_from_uninstall_key(&subkey) {
                                return Some(p);
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Raccourcis Bureau / menu Démarrer (résout le .lnk → vrai chemin du
    //    .exe ; attrape les installs custom hors C: type B:\...\RSI Launcher\).
    //    Dernier recours : on ne le tente que si tout le reste a échoué.
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = find_launcher_via_shortcuts() {
            return Some(path);
        }
    }

    None
}

// ─── Détection manuelle + raccourcis (.lnk) + registre robuste ────────────────

/// Récupère le chemin du RSI Launcher depuis une clé Uninstall, même si
/// `InstallLocation` est VIDE (cas réel : l'installeur RSI ne le remplit pas !).
/// Fallback : `DisplayIcon` (ex `<dir>\uninstallerIcon.ico` → on prend le dossier)
/// puis `UninstallString` (ex `"<dir>\Uninstall RSI Launcher.exe" /allusers`).
#[cfg(target_os = "windows")]
fn launcher_from_uninstall_key(subkey: &winreg::RegKey) -> Option<String> {
    // 1. InstallLocation (souvent vide pour RSI Launcher).
    if let Ok(loc) = subkey.get_value::<String, _>("InstallLocation") {
        let loc = loc.trim().trim_end_matches('\\');
        if !loc.is_empty() {
            let p = format!("{}\\RSI Launcher.exe", loc);
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    // 2. DisplayIcon → dossier d'install (on retire un éventuel index ",0").
    if let Ok(icon) = subkey.get_value::<String, _>("DisplayIcon") {
        let icon_path = icon.split(',').next().unwrap_or(&icon).trim().trim_matches('"');
        if let Some(dir) = Path::new(icon_path).parent() {
            let p = dir.join("RSI Launcher.exe");
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    // 3. UninstallString → on extrait le .exe (entre quotes ou jusqu'au 1er espace).
    if let Ok(uninstall) = subkey.get_value::<String, _>("UninstallString") {
        let trimmed = uninstall.trim();
        let exe = if let Some(stripped) = trimmed.strip_prefix('"') {
            stripped.split('"').next().unwrap_or(stripped)
        } else {
            trimmed.split_whitespace().next().unwrap_or(trimmed)
        };
        if let Some(dir) = Path::new(exe).parent() {
            let p = dir.join("RSI Launcher.exe");
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Fichier où on persiste le chemin manuel du launcher (choisi par l'user).
#[cfg(target_os = "windows")]
fn manual_launcher_path_file() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("StarTradFR").join("launcher_manual_path.txt"))
}

/// Lit le chemin manuel sauvegardé — uniquement s'il existe ET que le .exe est
/// toujours là (sinon None → on retombe sur l'auto-détection).
#[cfg(target_os = "windows")]
fn read_manual_launcher_path() -> Option<String> {
    let file = manual_launcher_path_file()?;
    let content = std::fs::read_to_string(file).ok()?;
    let path = content.trim().to_string();
    if !path.is_empty() && Path::new(&path).exists() {
        Some(path)
    } else {
        None
    }
}

/// Résout la cible d'un raccourci .lnk via WScript.Shell (résolveur Windows
/// natif → gère tous les formats de raccourci). Fenêtre PowerShell masquée.
#[cfg(target_os = "windows")]
fn resolve_shortcut_target(lnk_path: &Path) -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let escaped = lnk_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');Write-Output $s.TargetPath",
        escaped
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if target.is_empty() {
        None
    } else {
        Some(target)
    }
}

/// Cherche un raccourci RSI Launcher sur le Bureau (user + public) et dans le
/// menu Démarrer, et résout sa cible. Marche pour n'importe quel chemin d'install.
#[cfg(target_os = "windows")]
fn find_launcher_via_shortcuts() -> Option<String> {
    let mut dirs_to_scan: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(v) = std::env::var("USERPROFILE") {
        dirs_to_scan.push(std::path::PathBuf::from(v).join("Desktop"));
    }
    if let Ok(v) = std::env::var("PUBLIC") {
        dirs_to_scan.push(std::path::PathBuf::from(v).join("Desktop"));
    }
    if let Ok(v) = std::env::var("APPDATA") {
        dirs_to_scan.push(std::path::PathBuf::from(v).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Ok(v) = std::env::var("ProgramData") {
        dirs_to_scan.push(std::path::PathBuf::from(v).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }

    for dir in dirs_to_scan {
        if !dir.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&dir).max_depth(3).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            let is_lnk = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false);
            if !is_lnk {
                continue;
            }
            // On ne résout que les raccourcis qui ont une chance d'être le launcher
            // (évite de spawn PowerShell pour chaque .lnk du menu Démarrer).
            let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
            if !(fname.contains("rsi") || fname.contains("launcher") || fname.contains("citizen")) {
                continue;
            }
            if let Some(target) = resolve_shortcut_target(p) {
                if target.to_lowercase().ends_with("rsi launcher.exe") && Path::new(&target).exists() {
                    return Some(target);
                }
            }
        }
    }
    None
}

#[derive(Serialize)]
pub struct LauncherStatus {
    pub installed: bool,
    pub path: Option<String>,
}

/// Etat runtime du launcher RSI et de Star Citizen.
#[derive(Serialize)]
pub struct LauncherActivityStatus {
    pub launcher_running: bool,
    pub game_running: bool,
}

#[cfg(target_os = "windows")]
fn is_process_running(process_names: &[&str]) -> bool {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(output) = output else {
        return false;
    };

    if !output.status.success() {
        return false;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    process_names.iter().any(|process_name| {
        let process_name = process_name.to_ascii_lowercase();
        stdout.lines().any(|line| line.contains(&process_name))
    })
}

#[cfg(not(target_os = "windows"))]
fn is_process_running(_process_names: &[&str]) -> bool {
    false
}

#[command]
pub fn check_rsi_launcher() -> LauncherStatus {
    match find_rsi_launcher_path() {
        Some(path) => LauncherStatus {
            installed: true,
            path: Some(path),
        },
        None => LauncherStatus {
            installed: false,
            path: None,
        },
    }
}

#[command]
pub fn get_launcher_activity_status() -> LauncherActivityStatus {
    LauncherActivityStatus {
        launcher_running: is_process_running(&["RSI Launcher.exe"]),
        game_running: is_process_running(&["StarCitizen.exe"]),
    }
}

/// Définit manuellement le chemin du RSI Launcher (l'user pointe son .exe
/// quand l'auto-détection échoue). Persisté, prioritaire sur l'auto-détection.
#[command]
pub fn set_manual_launcher_path(path: String) -> LauncherStatus {
    #[cfg(target_os = "windows")]
    {
        let trimmed = path.trim().to_string();
        if let Some(file) = manual_launcher_path_file() {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&file, &trimmed);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
    check_rsi_launcher()
}

/// Efface le chemin manuel (revient à l'auto-détection seule).
#[command]
pub fn clear_manual_launcher_path() -> LauncherStatus {
    #[cfg(target_os = "windows")]
    {
        if let Some(file) = manual_launcher_path_file() {
            let _ = std::fs::remove_file(file);
        }
    }
    check_rsi_launcher()
}

/// Lance le RSI Launcher
#[command]
pub fn launch_rsi_launcher() -> Result<(), String> {
    match find_rsi_launcher_path() {
        Some(path) => {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                const DETACHED_PROCESS: u32 = 0x00000008;

                Command::new(&path)
                    .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Impossible de lancer le RSI Launcher: {}", e))?;
            }

            #[cfg(not(target_os = "windows"))]
            {
                Command::new(&path)
                    .spawn()
                    .map_err(|e| format!("Impossible de lancer le RSI Launcher: {}", e))?;
            }

            Ok(())
        }
        None => Err("RSI Launcher non trouvé. Veuillez le télécharger.".to_string()),
    }
}

/// Récupère l'URL de téléchargement actuelle du RSI Launcher en scrapant
/// la page download officielle (robertsspaceindustries.com/download).
/// Retourne None si le scrape échoue (le frontend tombera sur l'URL hardcodée).
#[command]
pub async fn get_rsi_launcher_download_url() -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) StarTradFR")
        .build()
        .ok()?;

    let html = client
        .get("https://robertsspaceindustries.com/download")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    // Extraire la première occurrence de l'URL du Launcher installer
    let re = regex::Regex::new(r#"https?://install\.robertsspaceindustries\.com/rel/2/RSI[%20\- ]Launcher-Setup-[0-9.]+\.exe"#)
        .ok()?;
    re.find(&html).map(|m| m.as_str().to_string())
}

/// Récupère la date de modification du fichier global.ini (traduction)
#[command]
pub fn get_folder_creation_date(path: String) -> Option<String> {
    let base_path = Path::new(&path);

    // Chemin vers le global.ini
    let global_ini_path = base_path
        .join("data")
        .join("Localization")
        .join("french_(france)")
        .join("global.ini");

    if !global_ini_path.exists() {
        return None;
    }

    // Récupérer les métadonnées du fichier
    let metadata = match fs::metadata(&global_ini_path) {
        Ok(m) => m,
        Err(_) => return None,
    };

    // Récupérer la date de modification
    let modified_time: SystemTime = metadata.modified().ok()?;

    // Convertir en DateTime
    let datetime: DateTime<Utc> = modified_time.into();

    Some(datetime.to_rfc3339())
}
