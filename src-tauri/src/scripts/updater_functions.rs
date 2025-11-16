use reqwest::blocking::Client;
use std::fs;
use std::io::Write;
use std::process::Command;
use tauri::{command, AppHandle};
use tauri_plugin_notification::NotificationExt;

#[command]
pub fn download_and_install_update(url: String, app_handle: AppHandle) -> Result<String, String> {
    download_and_install_update_internal(url, app_handle, 30)
}

#[command]
pub fn download_and_install_update_immediate(url: String, app_handle: AppHandle) -> Result<String, String> {
    download_and_install_update_internal(url, app_handle, 0)
}

fn download_and_install_update_internal(url: String, app_handle: AppHandle, delay: u64) -> Result<String, String> {
    // Obtenir le dossier Téléchargements de l'utilisateur
    let downloads_dir = dirs::download_dir()
        .ok_or_else(|| "Impossible de trouver le dossier Téléchargements".to_string())?;

    // Extraire le nom du fichier depuis l'URL
    let file_name = url
        .split('/')
        .last()
        .ok_or_else(|| "Impossible d'extraire le nom du fichier depuis l'URL".to_string())?;

    let file_path = downloads_dir.join(file_name);

    println!("[Updater] Téléchargement depuis: {}", url);
    println!("[Updater] Destination: {}", file_path.display());

    // Créer le client HTTP
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Erreur lors de la création du client: {}", e))?;

    // Télécharger le fichier
    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Erreur lors du téléchargement: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Erreur HTTP {}: Le serveur a retourné une erreur",
            response.status()
        ));
    }

    // Lire les bytes
    let bytes = response
        .bytes()
        .map_err(|e| format!("Erreur lors de la lecture de la réponse: {}", e))?;

    println!("[Updater] Taille téléchargée: {} bytes", bytes.len());

    // Écrire le fichier
    fs::write(&file_path, &bytes)
        .map_err(|e| format!("Erreur lors de l'écriture du fichier: {}", e))?;

    println!("[Updater] Fichier téléchargé avec succès: {}", file_path.display());

    // Envoyer une notification pour informer l'utilisateur
    if let Err(e) = app_handle.notification()
        .builder()
        .title("Mise à jour disponible")
        .body("Installation de la mise à jour en cours. L'application va se fermer et se rouvrir automatiquement.")
        .show() {
        eprintln!("[Updater] Erreur lors de l'envoi de la notification: {}", e);
    }

    // Lancer l'installer automatiquement via un script batch
    println!("[Updater] Lancement de l'installer...");
    
    #[cfg(target_os = "windows")]
    {
        // Obtenir le chemin de l'exécutable actuel pour le relancer après l'installation
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Impossible de récupérer le chemin de l'exécutable: {}", e))?;
        let exe_path = current_exe.to_string_lossy().to_string();
        
        // Créer un script batch temporaire qui :
        // 1. Lance l'installer
        // 2. Attend qu'il se termine
        // 3. Relance l'application
        let temp_dir = std::env::temp_dir();
        let batch_file = temp_dir.join("startradfr_update.bat");
        
        // Détecter le type d'installer et utiliser les bons paramètres
        let installer_args = if file_name.ends_with(".msi") {
            "/quiet /norestart"
        } else {
            // NSIS installer - /S pour silencieux
            "/S"
        };
        
        // Extraire le nom de l'exécutable pour tuer le processus
        let exe_name = current_exe
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("startradfr.exe");
        
        // Créer le contenu du script batch (sans messages visibles)
        // Délai configurable (30 secondes par défaut, 0 pour immédiat)
        let delay_command = if delay > 0 {
            format!("timeout /t {} /nobreak >nul", delay)
        } else {
            String::new()
        };
        
        let batch_content = format!(
            r#"@echo off
chcp 65001 >nul 2>&1
{}
taskkill /F /IM "{}" >nul 2>&1
timeout /t 1 /nobreak >nul
start /wait "" "{}" {}
timeout /t 2 /nobreak >nul
start "" "{}"
"#,
            delay_command,
            exe_name,
            file_path.to_string_lossy(),
            installer_args,
            exe_path
        );
        
        // Écrire le script batch
        let mut file = fs::File::create(&batch_file)
            .map_err(|e| format!("Erreur lors de la création du script batch: {}", e))?;
        file.write_all(batch_content.as_bytes())
            .map_err(|e| format!("Erreur lors de l'écriture du script batch: {}", e))?;
        
        // Créer un script VBScript pour lancer le batch sans fenêtre visible
        let vbs_file = temp_dir.join("startradfr_update.vbs");
        let vbs_content = format!(
            r#"Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""{}""", 0, False
Set WshShell = Nothing
"#,
            batch_file.to_string_lossy().replace('\\', "\\\\")
        );
        
        let mut vbs = fs::File::create(&vbs_file)
            .map_err(|e| format!("Erreur lors de la création du script VBS: {}", e))?;
        vbs.write_all(vbs_content.as_bytes())
            .map_err(|e| format!("Erreur lors de l'écriture du script VBS: {}", e))?;
        
        // Lancer le script VBS qui va exécuter le batch sans fenêtre visible
        Command::new("wscript")
            .arg(&vbs_file)
            .spawn()
            .map_err(|e| format!("Erreur lors du lancement du script VBS: {}", e))?;
        
        println!("[Updater] Installer lancé avec succès via script batch");
        println!("[Updater] Le script batch va fermer l'application, installer la mise à jour, puis relancer l'application");
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Pour Linux/Mac, utiliser chmod +x puis lancer
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&file_path)
                .map_err(|e| format!("Erreur lors de la lecture des permissions: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&file_path, perms)
                .map_err(|e| format!("Erreur lors de la définition des permissions: {}", e))?;
        }
        
        Command::new(&file_path)
            .spawn()
            .map_err(|e| format!("Erreur lors du lancement de l'installer: {}", e))?;
    }

    Ok(file_path.to_string_lossy().to_string())
}
