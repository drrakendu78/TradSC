use tauri::{command, AppHandle};

const ALLOWED_URL_PREFIX: &str = "https://github.com/drrakendu78/TradSC/releases/";

/// Lance l'updater standalone et ferme l'application principale.
/// L'updater gere le telechargement, la verification de signature, l'installation et le relancement.
#[command]
pub async fn launch_updater(
    url: String,
    sig_url: String,
    name: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    if !url.starts_with(ALLOWED_URL_PREFIX) || !sig_url.starts_with(ALLOWED_URL_PREFIX) {
        return Err("URL de mise à jour non autorisée.".to_string());
    }
    // Trouver l'updater.exe a cote de l'exe principal
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Impossible de trouver l'executable: {}", e))?;
    let app_dir = current_exe
        .parent()
        .ok_or("Impossible de trouver le dossier de l'application")?;
    let updater_exe = app_dir.join("startrad-updater.exe");

    if !updater_exe.exists() {
        return Err(
            "L'updater n'a pas ete trouve. Veuillez reinstaller l'application.".to_string(),
        );
    }

    let pid = std::process::id();
    let app_path = current_exe.to_string_lossy().to_string();

    // Lancer l'updater avec les arguments
    std::process::Command::new(&updater_exe)
        .arg("--url")
        .arg(&url)
        .arg("--sig-url")
        .arg(&sig_url)
        .arg("--name")
        .arg(&name)
        .arg("--app")
        .arg(&app_path)
        .arg("--pid")
        .arg(pid.to_string())
        .spawn()
        .map_err(|e| format!("Impossible de lancer l'updater: {}", e))?;

    // Fermer l'application principale apres un court delai
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    app_handle.exit(0);

    Ok(())
}
