use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;
use tauri::api::path::app_config_dir;

fn get_config_file_path() -> Result<PathBuf, String> {
    let config_dir = app_config_dir(&tauri::Config::default())
        .ok_or_else(|| "Impossible d'obtenir le répertoire de configuration de l'application".to_string())?;

    // Créer le répertoire s'il n'existe pas
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }

    // Nom du fichier de configuration
    let config_file = config_dir.join("translations_selected.json");
    Ok(config_file)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TranslationsSelected {
    #[serde(rename = "LIVE")]
    live: Option<String>,
    #[serde(rename = "PTU")]
    ptu: Option<String>,
    #[serde(rename = "EPTU")]
    eptu: Option<String>,
    #[serde(rename = "TECH-PREVIEW")]
    techpreview: Option<String>,
    #[serde(rename = "4.0_PREVIEW")]
    preview40: Option<String>,
}

#[command]
pub fn save_translations_selected(data: TranslationsSelected) -> Result<(), String> {
    // Obtenir le chemin du fichier de configuration
    let config_path = get_config_file_path().map_err(|e| e.to_string())?;

    // Convertir les données en JSON
    let json_data = serde_json::to_string(&data).map_err(|e| e.to_string())?;

    // Écrire les données dans le fichier
    fs::write(config_path, json_data).map_err(|e| e.to_string())
}

#[command]
pub fn load_translations_selected() -> Result<TranslationsSelected, String> {
    let config_path = get_config_file_path().map_err(|e| e.to_string())?;

    if !config_path.exists() {
        // Si le fichier n'existe pas, retourner des valeurs par défaut
        return Ok(TranslationsSelected {
            live: None,
            ptu: None,
            eptu: None,
            techpreview: None,
            preview40: None,
        });
    }

    // Lire le contenu du fichier
    let json_data = fs::read_to_string(config_path).map_err(|e| e.to_string())?;

    // Désérialiser les données
    let data: TranslationsSelected = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;

    Ok(data)
}