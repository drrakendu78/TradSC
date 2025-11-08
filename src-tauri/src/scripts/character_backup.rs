use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::command;
use tauri::Manager;

use crate::scripts::gamepath::get_star_citizen_versions;

const SUBFOLDER_NAME: &str = "Backup de personnages";

#[derive(Serialize)]
pub struct BackupEntry {
    name: String,
    path: String,
    date: String,
}

fn get_backup_config_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| "Impossible d'obtenir le répertoire de configuration de l'application".to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("characters_backup_dir.txt"))
}

fn read_backup_dir_from_config(app_handle: &tauri::AppHandle) -> Result<Option<String>, String> {
    let config_file = get_backup_config_file_path(app_handle)?;
    if !config_file.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(config_file).map_err(|e| e.to_string())?;
    let trimmed = content.trim().to_string();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

fn write_backup_dir_to_config(app_handle: &tauri::AppHandle, dir: &str) -> Result<(), String> {
    let config_file = get_backup_config_file_path(app_handle)?;
    fs::write(config_file, dir).map_err(|e| e.to_string())
}

fn ensure_dir_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else if ty.is_file() {
            // overwrite if exists
            let _ = fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn get_game_customcharacters_dir_for(version: &str) -> Result<PathBuf, String> {
    let game_paths = get_star_citizen_versions();
    let ver = game_paths
        .versions
        .get(version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;
    let base_path = Path::new(&ver.path);
    let cc_dir = base_path.join("user").join("client").join("0").join("customcharacters");
    Ok(cc_dir)
}

fn get_backup_root_dir(app_handle: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    match read_backup_dir_from_config(app_handle)? {
        Some(saved) => {
            let p = PathBuf::from(saved);
            let is_subfolder = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == SUBFOLDER_NAME)
                .unwrap_or(false);
            if is_subfolder {
                Ok(Some(p))
            } else {
                let candidate = p.join(SUBFOLDER_NAME);
                ensure_dir_exists(&candidate)?;
                let candidate_str = candidate.to_string_lossy().to_string();
                write_backup_dir_to_config(app_handle, &candidate_str)?;
                Ok(Some(candidate))
            }
        }
        None => Ok(None),
    }
}

#[command]
pub fn get_character_backup_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    Ok(match get_backup_root_dir(&app_handle)? {
        Some(p) => p.to_string_lossy().to_string(),
        None => String::new(),
    })
}

#[command]
pub fn set_character_backup_directory(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    // Crée le sous-dossier "Backup de personnages" dans le répertoire choisi
    let root = PathBuf::from(&path);
    ensure_dir_exists(&root)?;
    let final_dir = root.join(SUBFOLDER_NAME);
    ensure_dir_exists(&final_dir)?;
    // Sauvegarde initiale automatique depuis LIVE si disponible (optionnel, ne doit pas faire échouer)
    let _ = get_game_customcharacters_dir_for("LIVE").and_then(|src| {
        if src.exists() {
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
            let folder_name = format!("backup_customcharacters_{}", timestamp);
            let dst = final_dir.join(folder_name);
            copy_dir_all(&src, &dst).map_err(|e| e.to_string()) // best effort, ignore les erreurs
        } else {
            Ok(())
        }
    });
    let final_dir_str = final_dir.to_string_lossy().to_string();
    write_backup_dir_to_config(&app_handle, &final_dir_str)
}

#[command]
pub fn list_character_backups(app_handle: tauri::AppHandle) -> Result<Vec<BackupEntry>, String> {
    let backup_root = match get_backup_root_dir(&app_handle)? {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    ensure_dir_exists(&backup_root)?;
    let mut entries_vec: Vec<BackupEntry> = Vec::new();
    for entry in fs::read_dir(&backup_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry
                .file_name()
                .to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "Nom de dossier invalide".to_string())?;
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            let modified = metadata.modified().map_err(|e| e.to_string())?;
            let datetime: chrono::DateTime<chrono::Local> = modified.into();
            let date_str = datetime.format("%Y-%m-%d %H:%M").to_string();
            entries_vec.push(BackupEntry {
                name,
                path: path.to_string_lossy().to_string(),
                date: date_str,
            });
        }
    }
    // tri par date décroissante (plus récent en haut) en se basant sur le nom ou la date
    entries_vec.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(entries_vec)
}

#[command]
pub fn create_character_backup(app_handle: tauri::AppHandle) -> Result<(), String> {
    let src = get_game_customcharacters_dir_for("LIVE")?; // Par défaut LIVE
    if !src.exists() {
        return Err("Le dossier customcharacters n'existe pas".to_string());
    }
    let backup_root = match get_backup_root_dir(&app_handle)? {
        Some(p) => p,
        None => return Err("Veuillez configurer un dossier de sauvegarde".to_string()),
    };
    ensure_dir_exists(&backup_root)?;
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let folder_name = format!("backup_customcharacters_{}", timestamp);
    let dst = backup_root.join(folder_name);
    copy_dir_all(&src, &dst).map_err(|e| e.to_string())
}

#[command]
pub fn restore_character_backup_to_version(backup_path: String, version: String) -> Result<(), String> {
    let src = PathBuf::from(backup_path);
    if !src.exists() {
        return Err("Le dossier de sauvegarde sélectionné est introuvable".to_string());
    }
    let dst = get_game_customcharacters_dir_for(&version)?;
    if dst.exists() {
        fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
    }
    copy_dir_all(&src, &dst).map_err(|e| e.to_string())
}

#[command]
pub fn delete_character_backup(backup_path: String) -> Result<(), String> {
    let p = PathBuf::from(backup_path);
    if p.exists() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub fn open_character_backup_folder(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let p = match get_backup_root_dir(&app_handle)? {
        Some(p) => p,
        None => return Err("Aucun dossier de sauvegarde n'est configuré".to_string()),
    };
    ensure_dir_exists(&p)?;
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(p.as_os_str())
            .spawn()
            .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        let open_cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        Command::new(open_cmd)
            .arg(p.as_os_str())
            .spawn()
            .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;
    }
    Ok(true)
}

