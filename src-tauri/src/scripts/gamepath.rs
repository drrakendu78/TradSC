use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;
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

fn get_game_install_path(list_data: Vec<String>, check_exists: bool) -> Vec<String> {
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
#[derive(Serialize)]
pub struct VersionInfo {
    pub path: String,
    pub translated: bool,
    pub up_to_date: bool,
}

#[derive(Serialize)]
pub struct VersionPaths {
    pub versions: HashMap<String, VersionInfo>,
}

#[command]
pub fn get_star_citizen_versions() -> VersionPaths {
    let log_lines = get_launcher_log_list();
    let sc_install_paths = get_game_install_path(log_lines, true);

    let mut versions = HashMap::new();
    for path in &sc_install_paths {
        // Normaliser le chemin en supprimant les backslashes à la fin
        let normalized_path = path.trim_end_matches('\\').to_string();
        let version = get_game_channel_id(&normalized_path);

        if version != "UNKNOWN" && !versions.contains_key(&version) {
            versions.insert(
                version,
                VersionInfo {
                    path: normalized_path,
                    translated: false,
                    up_to_date: false,
                },
            );
        }
    }
    VersionPaths { versions }
}

/// Trouve le chemin du RSI Launcher s'il est installé
fn find_rsi_launcher_path() -> Option<String> {
    // 1. D'abord, essayer de trouver via les logs RSI (comme pour la détection du jeu)
    // Le launcher est dans le même dossier parent que StarCitizen
    let log_lines = get_launcher_log_list();
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
        "C:\\Program Files (x86)\\Roberts Space Industries\\RSI Launcher\\RSI Launcher.exe".to_string(),
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
                            if let Ok(install_location) = subkey.get_value::<String, _>("InstallLocation") {
                                let launcher_path = format!("{}\\RSI Launcher.exe", install_location.trim_end_matches('\\'));
                                if Path::new(&launcher_path).exists() {
                                    return Some(launcher_path);
                                }
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
                            if let Ok(install_location) = subkey.get_value::<String, _>("InstallLocation") {
                                let launcher_path = format!("{}\\RSI Launcher.exe", install_location.trim_end_matches('\\'));
                                if Path::new(&launcher_path).exists() {
                                    return Some(launcher_path);
                                }
                            }
                        }
                    }
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

/// Vérifie si le RSI Launcher est installé et retourne son chemin
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
