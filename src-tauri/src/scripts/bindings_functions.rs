use std::fs;
use std::path::Path;
use tauri::command;
use crate::scripts::pathfinder::get_star_citizen_versions;
use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize)]
pub struct BindingFile {
    name: String,
    path: String,
}

#[command]
pub fn import_bindings_file(source_path: String) -> Result<(), String> {
    // Obtenir le chemin du jeu
    let game_paths = get_star_citizen_versions();
    
    let live_version = game_paths.versions.get("LIVE")
        .ok_or_else(|| "Version LIVE non trouvée".to_string())?;
    
    let base_path = Path::new(&live_version.path);
    let source_filename = Path::new(&source_path)
        .file_name()
        .ok_or_else(|| "Nom de fichier source invalide".to_string())?
        .to_str()
        .ok_or_else(|| "Nom de fichier source contient des caractères invalides".to_string())?;

    // Construire le chemin de destination dans le dossier user/client/0
    let dest_folder = base_path.join("user").join("client").join("0").join("controls").join("mappings");
    let dest_path = dest_folder.join(source_filename);

    // Log des chemins pour debug
    println!("Source path: {}", source_path);
    println!("Destination folder: {}", dest_folder.display());
    println!("Destination file: {}", dest_path.display());

    // Créer tous les dossiers parents si nécessaire
    if !dest_folder.exists() {
        fs::create_dir_all(&dest_folder).map_err(|e| {
            format!("Impossible de créer les dossiers nécessaires : {}", e)
        })?;
    }

    // Copier le fichier
    match fs::copy(&source_path, &dest_path) {
        Ok(_) => {
            // Vérifier que le fichier existe après la copie
            if !dest_path.exists() {
                return Err("Le fichier n'a pas été copié correctement".to_string());
            }
            Ok(())
        },
        Err(e) => Err(format!("Erreur lors de la copie du fichier : {}", e))
    }
}

#[command]
pub fn list_bindings_files() -> Result<Vec<BindingFile>, String> {
    let game_paths = get_star_citizen_versions();
    
    let live_version = game_paths.versions.get("LIVE")
        .ok_or_else(|| "Version LIVE non trouvée".to_string())?;
    
    let bindings_path = Path::new(&live_version.path)
        .join("user")
        .join("client")
        .join("0")
        .join("controls")
        .join("mappings");

    if !bindings_path.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&bindings_path)
        .map_err(|e| format!("Erreur lors de la lecture du dossier : {}", e))?;

    let mut bindings = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            if let Some(extension) = entry.path().extension() {
                if extension == "xml" {
                    if let (Some(name), Some(path)) = (
                        entry.file_name().to_str().map(String::from),
                        entry.path().to_str().map(String::from)
                    ) {
                        bindings.push(BindingFile { name, path });
                    }
                }
            }
        }
    }

    Ok(bindings)
}

#[command]
pub fn delete_bindings_file(file_path: String) -> Result<(), String> {
    fs::remove_file(file_path)
        .map_err(|e| format!("Erreur lors de la suppression du fichier : {}", e))
}

#[command]
pub fn refresh_bindings() -> Result<(), String> {
    // Cette fonction ne fait rien de spécial car la liste est déjà rafraîchie
    // à chaque appel de list_bindings_files()
    Ok(())
}

#[command]
pub fn open_bindings_folder() -> Result<bool, String> {
    let game_paths = get_star_citizen_versions();
    
    let live_version = game_paths.versions.get("LIVE")
        .ok_or_else(|| "Version LIVE non trouvée".to_string())?;
    
    let bindings_path = Path::new(&live_version.path)
        .join("user")
        .join("client")
        .join("0")
        .join("controls")
        .join("mappings");

    if !bindings_path.exists() {
        return Err("Le dossier des bindings n'existe pas".to_string());
    }

    Command::new("explorer")
        .arg(bindings_path)
        .spawn()
        .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;

    Ok(true)
}
