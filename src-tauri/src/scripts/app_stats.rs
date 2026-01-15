use serde::Serialize;
use std::fs;
use std::path::Path;
use std::io::{BufRead, BufReader};
use tauri::command;
use chrono::{DateTime, Utc, NaiveDateTime};
use regex::Regex;

use crate::scripts::character_backup::list_character_backups;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Serialize)]
pub struct AppStats {
    /// Date de première installation (ISO 8601)
    pub first_install_date: Option<String>,
    /// Nombre de jours depuis l'installation
    pub days_since_install: Option<i64>,
    /// Nombre de backups locaux
    pub local_backups_count: u32,
    /// Nombre de traductions installées (fichiers global.ini présents)
    pub translations_installed_count: u32,
    /// Liste des versions avec traduction installée
    pub translated_versions: Vec<String>,
}

/// Récupère les statistiques réelles de l'application
#[command]
pub fn get_app_stats(app_handle: tauri::AppHandle) -> Result<AppStats, String> {
    let first_install_date = get_first_install_date();
    let days_since_install = first_install_date.as_ref().and_then(|date| {
        calculate_days_since(date)
    });

    let local_backups_count = count_local_backups(&app_handle);
    let (translations_installed_count, translated_versions) = count_installed_translations();

    Ok(AppStats {
        first_install_date,
        days_since_install,
        local_backups_count,
        translations_installed_count,
        translated_versions,
    })
}

/// Récupère la date de première installation
/// Essaie dans l'ordre:
/// 1. Registre Windows (pour MSI/installateur)
/// 2. Date de création du dossier AppData de l'app
fn get_first_install_date() -> Option<String> {
    // Essayer le registre Windows d'abord
    #[cfg(target_os = "windows")]
    {
        if let Some(date) = get_install_date_from_registry() {
            return Some(date);
        }
    }

    // Fallback: date de création du dossier AppData
    if let Some(date) = get_appdata_creation_date() {
        return Some(date);
    }

    None
}

/// Lit la date d'installation depuis le registre Windows
#[cfg(target_os = "windows")]
fn get_install_date_from_registry() -> Option<String> {
    // Chercher dans Uninstall pour les installations MSI
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // Essayer d'abord 64-bit
    let uninstall_paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for uninstall_path in &uninstall_paths {
        if let Ok(uninstall) = hklm.open_subkey(uninstall_path) {
            for key_name in uninstall.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(app_key) = uninstall.open_subkey(&key_name) {
                    // Vérifier si c'est notre application
                    if let Ok(display_name) = app_key.get_value::<String, _>("DisplayName") {
                        if display_name.to_lowercase().contains("startrad")
                            || display_name.to_lowercase().contains("star trad") {
                            // Essayer InstallDate (format YYYYMMDD)
                            if let Ok(install_date) = app_key.get_value::<String, _>("InstallDate") {
                                if install_date.len() == 8 {
                                    // Convertir YYYYMMDD en ISO 8601
                                    let year = &install_date[0..4];
                                    let month = &install_date[4..6];
                                    let day = &install_date[6..8];
                                    return Some(format!("{}-{}-{}T00:00:00Z", year, month, day));
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

/// Récupère la date de création du dossier AppData de l'application
fn get_appdata_creation_date() -> Option<String> {
    // Chercher le dossier de config Tauri
    if let Ok(appdata) = std::env::var("APPDATA") {
        let app_folder = Path::new(&appdata).join("com.drrakendu78.startradfr");

        if app_folder.exists() {
            if let Ok(metadata) = fs::metadata(&app_folder) {
                if let Ok(created) = metadata.created() {
                    let datetime: DateTime<Utc> = created.into();
                    return Some(datetime.to_rfc3339());
                }
            }
        }

        // Fallback: dossier StarTradFR dans Documents ou autre
        let alt_folders = [
            Path::new(&appdata).join("StarTradFR"),
            Path::new(&appdata).join("startradfr"),
        ];

        for folder in &alt_folders {
            if folder.exists() {
                if let Ok(metadata) = fs::metadata(folder) {
                    if let Ok(created) = metadata.created() {
                        let datetime: DateTime<Utc> = created.into();
                        return Some(datetime.to_rfc3339());
                    }
                }
            }
        }
    }

    None
}

/// Calcule le nombre de jours depuis une date ISO 8601
fn calculate_days_since(date_str: &str) -> Option<i64> {
    let install_date = DateTime::parse_from_rfc3339(date_str).ok()?;
    let now = Utc::now();
    let duration = now.signed_duration_since(install_date.with_timezone(&Utc));
    Some(duration.num_days())
}

/// Compte le nombre de backups locaux en réutilisant list_character_backups
fn count_local_backups(app_handle: &tauri::AppHandle) -> u32 {
    // Réutiliser list_character_backups pour avoir exactement le même comptage
    match list_character_backups(app_handle.clone()) {
        Ok(backups) => backups.len() as u32,
        Err(_) => 0,
    }
}

/// Compte les traductions installées en vérifiant les fichiers global.ini
fn count_installed_translations() -> (u32, Vec<String>) {
    let mut count = 0u32;
    let mut versions = Vec::new();

    // Utiliser la même méthode que gamepath.rs pour trouver les installations
    let game_paths = get_game_paths_from_log();

    for (version, path) in game_paths {
        let global_ini_path = Path::new(&path)
            .join("data")
            .join("Localization")
            .join("french_(france)")
            .join("global.ini");

        if global_ini_path.exists() {
            count += 1;
            versions.push(version);
        }
    }

    (count, versions)
}

/// Récupère les chemins de jeu depuis le log RSI Launcher (même méthode que gamepath.rs)
fn get_game_paths_from_log() -> Vec<(String, String)> {
    let mut paths = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    // Lire le fichier log RSI Launcher
    if let Ok(appdata) = std::env::var("APPDATA") {
        let log_path = format!("{}\\rsilauncher\\logs\\log.log", appdata);

        if let Ok(log_content) = fs::read_to_string(&log_path) {
            // Regex pour détecter les chemins StarCitizen (même que gamepath.rs)
            let pattern = r"([a-zA-Z]:\\\\(?:[^\\\\]+\\\\)*StarCitizen\\\\[A-Za-z0-9_\\.\\@\\-]+)";
            if let Ok(re) = Regex::new(pattern) {
                for line in log_content.lines().rev() {
                    for cap in re.captures_iter(line) {
                        if let Some(matched_path) = cap.get(0) {
                            let path_str = matched_path.as_str().replace("\\\\", "\\");
                            let normalized_path = path_str.trim_end_matches('\\').to_string();

                            // Éviter les doublons
                            if seen_paths.contains(&normalized_path) {
                                continue;
                            }

                            // Vérifier que le chemin existe et contient le jeu
                            let exe_path = format!("{}\\Bin64\\StarCitizen.exe", normalized_path);
                            let data_p4k_path = format!("{}\\Data.p4k", normalized_path);

                            if Path::new(&exe_path).exists() && Path::new(&data_p4k_path).exists() {
                                // Extraire la version du chemin
                                if let Some(version) = extract_version_from_path(&normalized_path) {
                                    seen_paths.insert(normalized_path.clone());
                                    paths.push((version, normalized_path));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    paths
}

/// Extrait la version (LIVE, PTU, etc.) depuis le chemin
fn extract_version_from_path(path: &str) -> Option<String> {
    let re = Regex::new(r"StarCitizen\\([A-Za-z0-9_\\.\\@-]+)\\?$").ok()?;
    if let Some(cap) = re.captures(path) {
        if let Some(version) = cap.get(1) {
            return Some(version.as_str().trim_end_matches('\\').to_string());
        }
    }
    None
}

// ============================================
// CALCUL DU TEMPS DE JEU
// ============================================

#[derive(Serialize)]
pub struct PlaytimeStats {
    /// Temps de jeu total en heures (avec 2 décimales)
    pub total_hours: f64,
    /// Temps de jeu total formaté (ex: "127h 35min")
    pub formatted: String,
    /// Nombre de sessions de jeu
    pub session_count: u32,
    /// Détails par version (LIVE, PTU, etc.)
    pub by_version: Vec<VersionPlaytime>,
}

#[derive(Serialize)]
pub struct VersionPlaytime {
    pub version: String,
    pub hours: f64,
    pub formatted: String,
    pub session_count: u32,
}

/// Debug: retourne les chemins détectés
#[command]
pub fn debug_game_paths() -> Result<Vec<String>, String> {
    let paths = get_all_game_paths();
    Ok(paths.iter().map(|(v, p)| format!("{}: {}", v, p)).collect())
}

/// Récupère le temps de jeu total depuis les logs Star Citizen
#[command]
pub fn get_playtime() -> Result<PlaytimeStats, String> {
    let mut total_minutes: i64 = 0;
    let mut total_sessions: u32 = 0;
    let mut by_version: Vec<VersionPlaytime> = Vec::new();

    // Récupérer tous les chemins d'installation
    let game_paths = get_all_game_paths();

    for (version, base_path) in game_paths {
        let logbackups_path = Path::new(&base_path).join("logbackups");

        if !logbackups_path.exists() {
            continue;
        }

        let (version_minutes, version_sessions) = calculate_playtime_from_logs(&logbackups_path);

        if version_sessions > 0 {
            let hours = version_minutes as f64 / 60.0;
            by_version.push(VersionPlaytime {
                version: version.clone(),
                hours: (hours * 100.0).round() / 100.0,
                formatted: format_playtime(version_minutes),
                session_count: version_sessions,
            });

            total_minutes += version_minutes;
            total_sessions += version_sessions;
        }
    }

    let total_hours = total_minutes as f64 / 60.0;

    Ok(PlaytimeStats {
        total_hours: (total_hours * 100.0).round() / 100.0,
        formatted: format_playtime(total_minutes),
        session_count: total_sessions,
        by_version,
    })
}

/// Récupère tous les chemins d'installation du jeu (réutilise get_game_paths_from_log)
fn get_all_game_paths() -> Vec<(String, String)> {
    get_game_paths_from_log()
}

/// Calcule le temps de jeu depuis les fichiers de log dans logbackups
fn calculate_playtime_from_logs(logbackups_path: &Path) -> (i64, u32) {
    let mut total_minutes: i64 = 0;
    let mut session_count: u32 = 0;

    // Regex pour extraire le timestamp: <2024-01-15T14:30:00.123456Z>
    let timestamp_re = match Regex::new(r"^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})") {
        Ok(re) => re,
        Err(_) => return (0, 0),
    };

    // Parcourir tous les fichiers .log
    let entries = match fs::read_dir(logbackups_path) {
        Ok(e) => e,
        Err(_) => return (0, 0),
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();

        // Vérifier que c'est un fichier .log
        if !path.is_file() {
            continue;
        }
        if path.extension().map_or(true, |ext| ext != "log") {
            continue;
        }

        // Lire le fichier et extraire les timestamps
        if let Some((start, end)) = extract_session_timestamps(&path, &timestamp_re) {
            let duration = end.signed_duration_since(start);
            let minutes = duration.num_minutes();

            // Ignorer les sessions trop courtes (moins d'1 min) ou trop longues (plus de 24h - probablement une erreur)
            if minutes > 0 && minutes < 24 * 60 {
                total_minutes += minutes;
                session_count += 1;
            }
        }
    }

    (total_minutes, session_count)
}

/// Extrait le premier et le dernier timestamp d'un fichier log
fn extract_session_timestamps(log_path: &Path, timestamp_re: &Regex) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let file = match fs::File::open(log_path) {
        Ok(f) => f,
        Err(_) => return None,
    };

    let reader = BufReader::new(file);
    let mut first_timestamp: Option<NaiveDateTime> = None;
    let mut last_timestamp: Option<NaiveDateTime> = None;

    for line in reader.lines().filter_map(|l| l.ok()) {
        if !line.starts_with('<') {
            continue;
        }

        if let Some(caps) = timestamp_re.captures(&line) {
            if let Some(ts_match) = caps.get(1) {
                // Parser le timestamp (format: 2024-01-15T14:30:00)
                if let Ok(dt) = NaiveDateTime::parse_from_str(ts_match.as_str(), "%Y-%m-%dT%H:%M:%S") {
                    if first_timestamp.is_none() {
                        first_timestamp = Some(dt);
                    }
                    last_timestamp = Some(dt);
                }
            }
        }
    }

    match (first_timestamp, last_timestamp) {
        (Some(start), Some(end)) => Some((start, end)),
        _ => None,
    }
}

/// Formate le temps de jeu en heures et minutes
fn format_playtime(total_minutes: i64) -> String {
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;

    if hours > 0 {
        format!("{}h {:02}min", hours, minutes)
    } else {
        format!("{}min", minutes)
    }
}
