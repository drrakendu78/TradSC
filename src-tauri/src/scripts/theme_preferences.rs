use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;
use tauri::path::PathResolver;
use tauri::Manager;
use tauri::Runtime;
use crate::scripts::config_paths::get_config_file_path as get_config_path;

#[command]
fn get_theme_config_file_path(path: &PathResolver<impl Runtime>) -> Result<PathBuf, String> {
    get_config_path(path, "theme_selected.json")
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ThemeSelected {
    primary_color: String,
}

#[command]
pub fn save_theme_selected(app: tauri::AppHandle, data: ThemeSelected) -> Result<(), String> {
    let config_path = get_theme_config_file_path(app.path()).map_err(|e| e.to_string())?;
    let json_data = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    fs::write(config_path, json_data).map_err(|e| e.to_string())
}

#[command]
pub fn load_theme_selected(app: tauri::AppHandle) -> Result<ThemeSelected, String> {
    let config_path = get_theme_config_file_path(app.path()).map_err(|e| e.to_string())?;
    if !config_path.exists() {
        return Ok(ThemeSelected {
            primary_color: "#6463b6".to_string(),
        });
    }
    let json_data = fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let data: ThemeSelected = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;

    Ok(data)
}
