use tauri::Manager;

pub fn init_updater(app: &tauri::App) {
    // Vérifie les mises à jour au démarrage
    tauri::async_runtime::spawn(check_update(app.handle()));

    // Configure le gestionnaire d'événements de mise à jour
    app.listen_global("tauri://update-available", |event| {
        println!("Nouvelle mise à jour disponible: {:?}", event);
    });

    app.listen_global("tauri://update-status", |event| {
        println!("Statut de la mise à jour: {:?}", event);
    });
}

pub async fn check_update(app: tauri::AppHandle) {
    match app.updater().check().await {
        Ok(update) => {
            if update.is_update_available() {
                println!("Mise à jour disponible : {:?}", update.latest_version());
                
                // Télécharge et installe automatiquement la mise à jour
                if let Err(e) = update.download_and_install().await {
                    println!("Erreur lors de la mise à jour : {}", e);
                }
            } else {
                println!("Aucune mise à jour disponible");
            }
        }
        Err(e) => println!("Erreur lors de la vérification des mises à jour : {}", e),
    }
} 