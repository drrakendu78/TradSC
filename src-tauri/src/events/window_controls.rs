use tauri::{CustomMenuItem, Menu, Submenu, Window};

pub fn create_menu() -> Menu {
    let minimize = CustomMenuItem::new("minimize".to_string(), "Minimize");
    let close = CustomMenuItem::new("close".to_string(), "Close");
    let submenu = Submenu::new("File", Menu::new().add_item(minimize).add_item(close));
    Menu::new().add_submenu(submenu)
}

pub fn handle_menu_event(window: &Window, menu_item_id: &str) {
    match menu_item_id {
        "minimize" => {
            window.minimize().unwrap();
        }
        "close" => {
            window.close().unwrap();
        }
        _ => {}
    }
}