use std::path::Path;
use std::process::Command;
use tauri::command;

#[command]
pub fn launch_third_party_application(path: String) -> Result<(), String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Chemin d'application vide.".to_string());
    }

    let app_path = Path::new(trimmed_path);
    if !app_path.exists() {
        return Err("Application introuvable. Verifiez le chemin configure.".to_string());
    }

    if !app_path.is_file() {
        return Err("Le chemin configure ne pointe pas vers un fichier executable.".to_string());
    }

    let mut command = Command::new(app_path);
    if let Some(parent) = app_path.parent() {
        command.current_dir(parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        command.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|e| format!("Impossible de lancer l'application: {}", e))?;

    Ok(())
}
