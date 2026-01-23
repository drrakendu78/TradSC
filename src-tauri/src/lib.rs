mod scripts;

use is_elevated::is_elevated;
use scripts::background_service::{
    get_background_service_config, load_background_service_config, save_background_service_config,
    set_background_service_config, start_background_service, start_background_service_internal,
    stop_background_service, BackgroundServiceState,
};
use scripts::bindings_functions::{
    delete_bindings_file, import_bindings_file, list_bindings_files, open_bindings_folder,
    refresh_bindings,
};
use scripts::cache_functions::{
    clear_cache, delete_folder, get_cache_informations, open_cache_folder,
};
use scripts::character_backup::{
    create_character_backup, delete_character_backup, get_character_backup_directory,
    list_character_backups, open_character_backup_folder, restore_character_backup_to_version,
    set_character_backup_directory,
};
use scripts::cloud_backup::{
    create_user_backup, restore_backup, upload_backup_to_supabase, list_user_backups,
    download_backup_from_supabase, delete_backup_from_supabase,
    save_preferences_to_cloud, load_preferences_from_cloud, delete_preferences_from_cloud,
};
use scripts::oauth_callback::start_oauth_callback_server;
use scripts::gamepath::{get_star_citizen_versions, check_rsi_launcher, launch_rsi_launcher, get_folder_creation_date};
use scripts::graphics_settings::{
    get_graphics_renderer, set_graphics_renderer,
    get_user_cfg_resolution, set_user_cfg_resolution,
};
use scripts::local_characters_functions::{
    delete_character, download_character, duplicate_character, get_character_informations,
    open_characters_folder,
};
use scripts::patchnote::get_latest_commits;
use scripts::presets_list_functions::get_characters;
use scripts::startup_manager::{
    disable_auto_startup, enable_auto_startup, is_auto_startup_enabled,
};
use scripts::system_tray::setup_system_tray;
use scripts::theme_preferences::{load_theme_selected, save_theme_selected};
use scripts::translation_functions::{
    apply_branding_to_local_file, init_translation_files, is_game_translated, is_translation_up_to_date,
    uninstall_translation, update_translation, install_translation_from_cache,
};
use scripts::translation_preferences::{load_translations_selected, save_translations_selected};
use scripts::translations_links::{get_translation_by_setting, get_translation_last_updated, get_translations};
use scripts::updater_functions::{download_and_install_update, download_and_install_update_immediate, trigger_immediate_install};
use scripts::app_stats::{get_app_stats, get_playtime, debug_game_paths};
use scripts::discord_presence::{
    connect_discord, disconnect_discord, update_discord_activity, get_discord_status,
    set_translating_activity, clear_discord_activity, reconnect_discord, check_and_reconnect_discord,
    DiscordState,
};
use scripts::offline_cache::{
    cache_translation, list_cached_translations, get_cached_translation,
    delete_cached_translation, clear_translation_cache, is_translation_cached,
    get_translation_cache_info, open_translation_cache_folder, cache_all_installed_translations,
};
use tauri::{command, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use window_vibrancy::apply_acrylic;

#[command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Erreur d'écriture: {}", e))
}

#[command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Erreur de lecture: {}", e))
}

#[command]
async fn open_external(url: String, _app_handle: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
    }

#[command]
async fn start_oauth_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    start_oauth_callback_server(app_handle).await
}

#[command]
async fn restart_as_admin(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe
            .to_str()
            .ok_or_else(|| "Chemin exécutable invalide".to_string())?;

        // Vérifier si c'est une app Store (WindowsApps dans le chemin)
        if exe_str.contains("WindowsApps") {
            return Err("Les applications Microsoft Store ne peuvent pas être élevées en administrateur. Veuillez utiliser la version MSI ou portable.".to_string());
        }

        // Échapper les quotes pour PowerShell
        let escaped = exe_str.replace("'", "''");
        
        // Utiliser le chemin complet de PowerShell
        let powershell_path = std::path::Path::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        
        let ps_cmd = if powershell_path.exists() {
            powershell_path.to_str().unwrap()
        } else {
            "powershell.exe"
        };

        // Commande PowerShell pour lancer en admin
        let ps_command = format!(
            "Start-Process -FilePath '{}' -Verb RunAs",
            escaped
        );

        let result = Command::new(ps_cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .arg("-NoProfile")
            .arg("-WindowStyle")
            .arg("Hidden")
            .arg("-Command")
            .arg(ps_command)
            .spawn();

        match result {
            Ok(_) => {
        // Attendre un peu pour que la nouvelle instance démarre
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        // Fermer l'application actuelle
        app_handle.exit(0);
        Ok(())
            }
            Err(e) => {
                Err(format!("Erreur lors du redémarrage en administrateur: {}. Essayez de lancer l'application manuellement en tant qu'administrateur.", e))
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Élévation non supportée sur cette plateforme".to_string())
    }
}

#[command]
fn is_running_as_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        is_elevated()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[command]
fn can_elevate_privileges() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Vérifier si c'est une app Microsoft Store
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_str) = exe.to_str() {
                // Les apps Store sont dans WindowsApps et ne peuvent pas être élevées
                if exe_str.contains("WindowsApps") {
                    return false;
                }
            }
        }
        // Pour les autres types d'installation (portable, MSI), l'élévation est possible
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[command]
fn is_minimized_start() -> bool {
    std::env::args().any(|arg| arg == "--minimized")
}

#[command]
async fn fetch_rss() -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://leonick.se/feeds/rsi/atom")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let text = response
        .text()
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Quand une deuxième instance est lancée, afficher et focus la fenêtre existante
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("impossible de récupérer la fenêtre principale");

            #[cfg(target_os = "windows")]
            apply_acrylic(&window, Some((18, 18, 18, 125)))
                .expect("Impossible d'appliquer l'effet de blur sur Windows");

            // Initialiser l'état du service de fond
            let background_state = BackgroundServiceState::default();

            // Charger la configuration sauvegardée et l'appliquer
            match load_background_service_config(app.handle().clone()) {
                Ok(config) => {
                    // Mettre à jour l'état avec la config chargée
                    if let Ok(mut state_config) = background_state.config.lock() {
                        *state_config = config.clone();
                    }

                    // Démarrer le service de fond si activé
                    if config.enabled {
                        let app_handle_clone = app.handle().clone();
                        let state_clone = background_state.clone();

                        // Utiliser le runtime async de Tauri
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) =
                                start_background_service_internal(state_clone, app_handle_clone)
                                    .await
                            {
                                eprintln!("Échec du démarrage du service de fond: {}", e);
                            }
                        });
                    }
                }
                Err(e) => {
                    eprintln!("Échec du chargement de la config du service de fond: {}", e);
                }
            }

            app.manage(background_state);

            // Initialiser l'état Discord Rich Presence
            let discord_state = DiscordState::default();
            app.manage(discord_state);

            // Configurer le system tray
            if let Err(e) = setup_system_tray(&app.handle()) {
                eprintln!("Échec de la configuration du system tray: {}", e);
            }

            // Configurer le handler pour les deep links (startradfr://)
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                for url in urls {
                    // Vérifier si c'est un callback OAuth
                    if url.scheme() == "startradfr" {
                        let path = url.path();
                        if path == "/auth/callback" || path == "auth/callback" {
                            // Extraire les paramètres de l'URL
                            let query = url.query().unwrap_or("");
                            println!("[Deep Link] OAuth callback reçu: {}", query);

                            // Émettre l'événement oauth-callback comme le fait le serveur local
                            if let Err(e) = app_handle.emit("oauth-callback", query.to_string()) {
                                eprintln!("[Deep Link] Erreur émission événement: {}", e);
                            }

                            // Afficher et focus la fenêtre
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                }
            });

            // Vérifier si l'app a été lancée avec le flag --minimized (depuis le démarrage)
            let args: Vec<String> = std::env::args().collect();
            if args.contains(&"--minimized".to_string()) {
                if let Err(e) = window.hide() {
                    eprintln!("Échec de la minimisation de la fenêtre au démarrage: {}", e);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Empêcher la fermeture par défaut
                api.prevent_close();
                // Cacher la fenêtre dans le tray au lieu de la fermer
                if let Err(e) = window.hide() {
                    eprintln!("Échec de la minimisation dans le tray: {}", e);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_theme_selected,
            load_theme_selected,
            get_latest_commits,
            get_star_citizen_versions,
            is_game_translated,
            init_translation_files,
            is_translation_up_to_date,
            update_translation,
            uninstall_translation,
            install_translation_from_cache,
            apply_branding_to_local_file,
            save_translations_selected,
            load_translations_selected,
            get_translations,
            get_translation_by_setting,
            get_translation_last_updated,
            get_cache_informations,
            delete_folder,
            get_character_informations,
            delete_character,
            open_characters_folder,
            duplicate_character,
            download_character,
            get_characters,
            open_external,
            is_running_as_admin,
            can_elevate_privileges,
            is_minimized_start,
            restart_as_admin,
            clear_cache,
            open_cache_folder,
            fetch_rss,
            list_character_backups,
            create_character_backup,
            restore_character_backup_to_version,
            delete_character_backup,
            open_character_backup_folder,
            get_character_backup_directory,
            set_character_backup_directory,
            import_bindings_file,
            list_bindings_files,
            delete_bindings_file,
            open_bindings_folder,
            refresh_bindings,
            get_background_service_config,
            set_background_service_config,
            start_background_service,
            stop_background_service,
            save_background_service_config,
            start_oauth_server,
            load_background_service_config,
            enable_auto_startup,
            disable_auto_startup,
            is_auto_startup_enabled,
                    download_and_install_update,
                    download_and_install_update_immediate,
                    trigger_immediate_install,
            get_graphics_renderer,
            set_graphics_renderer,
            get_user_cfg_resolution,
            set_user_cfg_resolution,
            create_user_backup,
            restore_backup,
            upload_backup_to_supabase,
            list_user_backups,
            download_backup_from_supabase,
            delete_backup_from_supabase,
            save_preferences_to_cloud,
            load_preferences_from_cloud,
            delete_preferences_from_cloud,
            check_rsi_launcher,
            launch_rsi_launcher,
            get_folder_creation_date,
            get_app_stats,
            get_playtime,
            debug_game_paths,
            connect_discord,
            disconnect_discord,
            update_discord_activity,
            get_discord_status,
            set_translating_activity,
            clear_discord_activity,
            reconnect_discord,
            check_and_reconnect_discord,
            cache_translation,
            list_cached_translations,
            get_cached_translation,
            delete_cached_translation,
            clear_translation_cache,
            is_translation_cached,
            get_translation_cache_info,
            open_translation_cache_folder,
            cache_all_installed_translations,
            write_text_file,
            read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
