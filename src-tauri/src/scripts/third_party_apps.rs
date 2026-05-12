use std::path::Path;
use std::process::Command;
use tauri::command;

#[command]
pub fn kill_third_party_application(path: String) -> Result<u32, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Chemin d'application vide.".to_string());
    }

    let app_path = Path::new(trimmed);
    let file_name = match app_path.file_name().and_then(|n| n.to_str()) {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => return Err("Impossible de déterminer le nom de l'exécutable.".to_string()),
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("taskkill")
            .args(["/F", "/IM", &file_name])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Impossible d'exécuter taskkill: {}", e))?;

        // taskkill exit code:
        //   0 = succès (au moins un processus tué)
        //   128 = aucun processus trouvé (pas une erreur pour notre usage)
        let code = output.status.code().unwrap_or(-1);
        if code == 0 {
            return Ok(1);
        }
        if code == 128 {
            return Ok(0);
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("taskkill (code {}): {}", code, stderr));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = file_name;
        Err("Non supporté sur cette plateforme.".to_string())
    }
}

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
