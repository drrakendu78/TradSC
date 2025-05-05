// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod events;
mod scripts;

use events::{create_menu, handle_menu_event};
use scripts::pathfinder::get_star_citizen_versions;
use scripts::translations_links::get_translations;
use scripts::translation_functions::{is_game_translated, init_translation_files, is_translation_up_to_date, update_translation, uninstall_translation};
use scripts::translation_preferences::{save_translations_selected, load_translations_selected};
use scripts::theme_preferences::{save_theme_selected, load_theme_selected};
use scripts::cache_functions::{get_cache_informations, delete_folder, clear_cache, open_cache_folder};
use scripts::patchnote::get_latest_commits;
use tauri::Manager;
use tokio::time::{sleep, Duration};
use reqwest;

#[tauri::command]
fn open_external(url: String, scope: tauri::AppHandle) {
    if let Err(e) = tauri::api::shell::open(&scope.shell_scope(), &url, None) {
        eprintln!("Failed to open URL: {}", e);
    }
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
  tauri::Builder::default()
    .setup(|app| {
      let splashscreen_window = app.get_window("splashscreen").unwrap();
      let main_window = app.get_window("main").unwrap();
      // we perform the initialization code on a new task so the app doesn't freeze
      tauri::async_runtime::spawn(async move {
        // initialize your app here instead of sleeping :)
        println!("Initializing...");
        sleep(Duration::from_secs(4)).await;
        println!("Done initializing.");

        // After it's done, close the splashscreen and display the main window
        splashscreen_window.close().unwrap();
        main_window.show().unwrap();
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_star_citizen_versions,
      get_translations,
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
      open_external,
      get_cache_informations,
      delete_folder,
      clear_cache,
      open_cache_folder,
      fetch_rss
    ])
    .menu(create_menu())
    .on_menu_event(|event| handle_menu_event(&event.window(), event.menu_item_id()))  
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
