use tauri::command;
use serde_json::Value;

#[command]
pub async fn get_translations() -> Result<Value, String> {
    let response = reqwest::get("https://drrakendu78.github.io/TradSC/translations.json")
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(response)
}
