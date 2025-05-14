// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod events;
mod scripts;

use scripts::bindings_functions::{import_bindings_file, list_bindings_files, delete_bindings_file, open_bindings_folder, refresh_bindings};
use scripts::cache_functions::{clear_cache, delete_folder, get_cache_informations, open_cache_folder};
use scripts::patchnote::get_latest_commits;
use scripts::pathfinder::get_star_citizen_versions;
use scripts::theme_preferences::{load_theme_selected, save_theme_selected};
use scripts::translation_functions::{
    init_translation_files, is_game_translated, is_translation_up_to_date, uninstall_translation,
    update_translation,
};
use scripts::translation_preferences::{load_translations_selected, save_translations_selected};
use scripts::translations_links::get_translations;
use scripts::updater::init_updater;

use tauri::Manager;
use reqwest;

#[tauri::command]
fn open_external(url: String, scope: tauri::AppHandle) {
    tauri::api::shell::open(&scope.shell_scope(), &url, None).unwrap();
}

#[tauri::command]
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

fn main() {
    let context = tauri::generate_context!();
    tauri::Builder::default()
        .setup(|app| {
            // Initialise l'updater
            init_updater(app);
            
            let splashscreen_window = app.get_window("splashscreen").unwrap();
            let main_window = app.get_window("main").unwrap();

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                splashscreen_window.close().unwrap();
                main_window.show().unwrap();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            fetch_rss,
            get_cache_informations,
            delete_folder,
            clear_cache,
            open_cache_folder,
            get_translations,
            get_star_citizen_versions,
            is_game_translated,
            init_translation_files,
            is_translation_up_to_date,
            update_translation,
            uninstall_translation,
            save_translations_selected,
            load_translations_selected,
            save_theme_selected,
            load_theme_selected,
            get_latest_commits,
            import_bindings_file,
            list_bindings_files,
            delete_bindings_file,
            open_bindings_folder,
            refresh_bindings,
        ])
        .run(context)
        .expect("error while running tauri application");
}
