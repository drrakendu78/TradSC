use std::fs;
use std::path::PathBuf;
use tauri::path::PathResolver;
use tauri::Runtime;

/// Fonction utilitaire générique pour obtenir le chemin d'un fichier de configuration
/// 
/// # Arguments
/// * `path` - Le PathResolver de Tauri
/// * `filename` - Le nom du fichier de configuration (ex: "translations_selected.json")
/// 
/// # Returns
/// * `Ok(PathBuf)` - Le chemin complet du fichier de configuration
/// * `Err(String)` - Message d'erreur si la récupération échoue
pub fn get_config_file_path(
    path: &PathResolver<impl Runtime>,
    filename: &str,
) -> Result<PathBuf, String> {
    let config_dir = path.app_config_dir().map_err(|_| {
        "Impossible d'obtenir le répertoire de configuration de l'application".to_string()
    })?;

    // Créer le répertoire s'il n'existe pas
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }

    // Retourner le chemin complet du fichier
    Ok(config_dir.join(filename))
}

