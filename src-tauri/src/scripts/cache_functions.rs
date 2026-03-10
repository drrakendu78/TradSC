use serde::Serialize;
use std::env;
use std::fs;
use std::path::Path;
use tauri::command;
use tokio::process::Command;

#[derive(Serialize)]
struct FolderInfo {
    name: String,
    weight: String,
    path: String,
}

#[derive(Serialize)]
struct Output {
    folders: Vec<FolderInfo>,
}

#[command]
pub fn get_cache_informations() -> String {
    let appdata = match env::var("LOCALAPPDATA") {
        Ok(val) => val,
        Err(e) => {
            println!("Impossible de lire la variable d'environnement APPDATA: {}", e);
            return serde_json::to_string(&Output { folders: Vec::new() })
                .unwrap_or_else(|_| "{\"folders\":[]}".to_string());
        }
    };
    let star_citizen_path = format!("{}\\Star Citizen", appdata);

    let mut folders = Vec::new();

    match fs::read_dir(&star_citizen_path) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let path = entry.path();
                        if path.is_dir() {
                            if let Ok(folder_info) = get_folder_info_safe(&path) {
                                folders.push(folder_info);
                            }
                        }
                    }
                    Err(e) => {
                        println!("Erreur lors de la lecture de l'entrée: {}", e);
                    }
                }
            }
        }
        Err(e) => {
            println!(
                "Erreur lors de l'accès au répertoire {}: {}",
                star_citizen_path, e
            );
        }
    }

    let output = Output { folders };
    serde_json::to_string_pretty(&output)
        .unwrap_or_else(|e| {
            println!("Erreur lors de la sérialisation en JSON: {}", e);
            "{\"folders\":[]}".to_string()
        })
}

fn get_folder_info_safe(path: &Path) -> Result<FolderInfo, String> {
    let folder_name = path
        .file_name()
        .ok_or_else(|| "Nom de fichier invalide".to_string())?
        .to_string_lossy()
        .to_string();
    let folder_weight = get_weight(path);
    let folder_path = path.to_string_lossy().to_string();

    Ok(FolderInfo {
        name: folder_name,
        weight: folder_weight,
        path: folder_path,
    })
}

fn get_weight(path: &Path) -> String {
    let mut total_size = 0;

    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let path = entry.path();
                        if path.is_file() {
                            if let Ok(metadata) = fs::metadata(&path) {
                                total_size += metadata.len();
                            }
                        } else if path.is_dir() {
                            total_size += get_folder_size(&path);
                        }
                    }
                    Err(e) => {
                        println!("Erreur lors de la lecture de l'entrée: {}", e);
                    }
                }
            }
        }
    }

    let size_in_megabytes = total_size as f64 / 1_048_576.0;
    format!("{:.0} Mo", size_in_megabytes)
}

fn get_folder_size(path: &Path) -> u64 {
    let mut total_size = 0;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries {
            match entry {
                Ok(entry) => {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(metadata) = fs::metadata(&path) {
                            total_size += metadata.len();
                        }
                    } else if path.is_dir() {
                        total_size += get_folder_size(&path);
                    }
                }
                Err(e) => {
                    println!("Erreur lors de la lecture de l'entrée: {}", e);
                }
            }
        }
    }

    total_size
}

#[command]
pub fn delete_folder(path: &str) -> bool {
    let path = Path::new(path);
    
    // Validation de sécurité : s'assurer que le chemin est dans LOCALAPPDATA\Star Citizen
    let appdata = match env::var("LOCALAPPDATA") {
        Ok(val) => val,
        Err(_) => return false,
    };
    let star_citizen_path = format!("{}\\Star Citizen", appdata);
    let base_path = Path::new(&star_citizen_path);
    
    // Vérifier que le chemin est bien dans le répertoire autorisé
    if !path.starts_with(base_path) {
        println!("Tentative de suppression d'un chemin non autorisé: {}", path.display());
        return false;
    }
    
    // Vérifier que le chemin existe
    if !path.exists() {
        return false;
    }
    
    if path.is_dir() {
        match fs::remove_dir_all(path) {
            Ok(_) => true,
            Err(e) => {
                println!("Erreur lors de la suppression du dossier {}: {}", path.display(), e);
                false
            }
        }
    } else {
        match fs::remove_file(path) {
            Ok(_) => true,
            Err(e) => {
                println!("Erreur lors de la suppression du fichier {}: {}", path.display(), e);
                false
            }
        }
    }
}

#[command]
pub fn clear_cache() -> bool {
    let appdata = match env::var("LOCALAPPDATA") {
        Ok(val) => val,
        Err(e) => {
            println!("Impossible de lire la variable d'environnement APPDATA: {}", e);
            return false;
        }
    };
    let star_citizen_path = format!("{}\\Star Citizen", appdata);

    if let Ok(entries) = fs::read_dir(&star_citizen_path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    if let Err(e) = fs::remove_dir_all(&path) {
                        println!("Erreur lors de la suppression du dossier {}: {}", path.display(), e);
                        return false;
                    }
                } else {
                    if let Err(e) = fs::remove_file(&path) {
                        println!("Erreur lors de la suppression du fichier {}: {}", path.display(), e);
                        return false;
                    }
                }
            }
        }
        true
    } else {
        false
    }
}

#[command]
pub fn open_cache_folder() -> Result<bool, String> {
    let appdata = env::var("LOCALAPPDATA")
        .map_err(|e| format!("Impossible de lire la variable d'environnement APPDATA: {}", e))?;
    let star_citizen_path = format!("{}\\Star Citizen", appdata);

    // Vérifie si le chemin existe
    if std::path::Path::new(&star_citizen_path).exists() {
        // Ouvre le dossier dans l'explorateur de fichiers
        Command::new("explorer")
            .arg(&star_citizen_path)
            .spawn()
            .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;
        Ok(true)
    } else {
        Err(format!("Le dossier '{}' n'existe pas.", star_citizen_path))
    }
}
