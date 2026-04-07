use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// État du system tray pour pouvoir mettre à jour les CheckMenuItem depuis le frontend
pub struct TrayState {
    pub discord_item: CheckMenuItem<tauri::Wry>,
    pub bg_service_item: CheckMenuItem<tauri::Wry>,
    pub video_item: CheckMenuItem<tauri::Wry>,
    pub auto_startup_item: CheckMenuItem<tauri::Wry>,
}

/// Configure le system tray de l'application
pub fn setup_system_tray(app: &AppHandle) -> Result<(), String> {
    let e = |e: tauri::Error| e.to_string();

    // === En-tête ===
    let version = app.config().version.clone().unwrap_or_default();
    let header = MenuItem::with_id(app, "header", format!("StarTrad FR v{}", version), false, None::<&str>).map_err(e)?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(e)?;

    // === Navigation rapide ===
    let nav_traduction = MenuItem::with_id(app, "nav_traduction", "Traduction", true, None::<&str>).map_err(e)?;
    let nav_cache = MenuItem::with_id(app, "nav_cache", "Cache", true, None::<&str>).map_err(e)?;
    let nav_persos = MenuItem::with_id(app, "nav_persos", "Persos locaux", true, None::<&str>).map_err(e)?;
    let nav_actualites = MenuItem::with_id(app, "nav_actualites", "Actualités", true, None::<&str>).map_err(e)?;
    let nav_submenu = Submenu::with_items(
        app,
        "Navigation",
        true,
        &[&nav_traduction, &nav_cache, &nav_persos, &nav_actualites],
    ).map_err(e)?;

    let sep2 = PredefinedMenuItem::separator(app).map_err(e)?;

    // === Services (CheckMenuItem avec coche) ===
    let toggle_discord = CheckMenuItem::with_id(app, "toggle_discord", "Discord Rich Presence", true, false, None::<&str>).map_err(e)?;
    let toggle_bg_service = CheckMenuItem::with_id(app, "toggle_bg_service", "Service de fond", true, false, None::<&str>).map_err(e)?;
    let toggle_video = CheckMenuItem::with_id(app, "toggle_video", "Vidéo de fond", true, true, None::<&str>).map_err(e)?;
    let toggle_auto_startup = CheckMenuItem::with_id(app, "toggle_auto_startup", "Démarrage auto Windows", true, false, None::<&str>).map_err(e)?;

    // Sauvegarder les refs pour mise à jour depuis le frontend
    let tray_state = TrayState {
        discord_item: toggle_discord.clone(),
        bg_service_item: toggle_bg_service.clone(),
        video_item: toggle_video.clone(),
        auto_startup_item: toggle_auto_startup.clone(),
    };
    app.manage(Mutex::new(tray_state));

    let sep3 = PredefinedMenuItem::separator(app).map_err(e)?;

    // === Fenêtre ===
    let show_item = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>).map_err(e)?;
    let hide_item = MenuItem::with_id(app, "hide", "Masquer", true, None::<&str>).map_err(e)?;

    let sep4 = PredefinedMenuItem::separator(app).map_err(e)?;

    // === Quitter ===
    let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>).map_err(e)?;

    // Construire le menu complet
    let menu = Menu::with_items(
        app,
        &[
            &header,
            &sep1,
            &nav_submenu,
            &sep2,
            &toggle_discord,
            &toggle_bg_service,
            &toggle_video,
            &toggle_auto_startup,
            &sep3,
            &show_item,
            &hide_item,
            &sep4,
            &quit_item,
        ],
    ).map_err(e)?;

    // Créer le tray icon
    let default_icon = app
        .default_window_icon()
        .ok_or_else(|| "Impossible de récupérer l'icône par défaut".to_string())?;

    let _tray = TrayIconBuilder::new()
        .icon(default_icon.clone())
        .menu(&menu)
        .tooltip("StarTrad FR")
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                // === Fenêtre ===
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.unminimize();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit" => {
                    app.exit(0);
                }

                // === Navigation ===
                "nav_traduction" | "nav_cache" | "nav_persos" | "nav_actualites" => {
                    let route = match id {
                        "nav_traduction" => "/traduction",
                        "nav_cache" => "/cache",
                        "nav_persos" => "/presets-local",
                        "nav_actualites" => "/actualites",
                        _ => "/",
                    };
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.unminimize();
                        let _ = app.emit("tray-navigate", route);
                    }
                }

                // === Services (toggle via CheckMenuItem) ===
                "toggle_discord" => {
                    let _ = app.emit("tray-toggle", "discord");
                }
                "toggle_bg_service" => {
                    let _ = app.emit("tray-toggle", "bg_service");
                }
                "toggle_video" => {
                    let _ = app.emit("tray-toggle", "video");
                }
                "toggle_auto_startup" => {
                    let _ = app.emit("tray-toggle", "auto_startup");
                }

                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
