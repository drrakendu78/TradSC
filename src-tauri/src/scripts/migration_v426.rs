use std::fs;
use std::time::UNIX_EPOCH;
use tauri::command;
use tauri::Manager;

/// Retourne le timestamp (secondes Unix) de modification du binaire de l'app
/// actuellement en cours d'exécution. Sert à détecter une réinstallation :
/// chaque install NSIS écrase l'exe avec un nouveau mtime, donc en stockant
/// la valeur en localStorage, on peut comparer au boot pour savoir si on est
/// face à une fresh install (mtime diff) ou un boot normal (mtime identique).
#[command]
pub fn get_app_exe_mtime() -> Result<u64, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&exe_path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let ts = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    Ok(ts)
}

/// Migration ponctuelle v4.2.6 : vide le contenu du dossier `app_config_dir`
/// pour repartir sur du neuf (onboarding.json, theme_selected.json,
/// translations_selected.json, background_service.json, etc.). Le dossier
/// lui-même est conservé. Idempotente (no-op si dossier vide ou inexistant).
///
/// Appelée une seule fois côté JS via le flag de migration localStorage
/// `startradfr_cache_legacy_migration_v426_done` — ne pas appeler ailleurs.
#[command]
pub fn wipe_v426_app_config(app: tauri::AppHandle) -> Result<u32, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "app_config_dir indisponible".to_string())?;

    if !config_dir.exists() {
        return Ok(0);
    }

    let entries = fs::read_dir(&config_dir).map_err(|e| e.to_string())?;
    let mut removed = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        } else if path.is_dir() {
            if fs::remove_dir_all(&path).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}
