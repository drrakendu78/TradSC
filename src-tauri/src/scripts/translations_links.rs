use tauri::command;
use serde_json::Value;

fn fix_circuspes_url(url: &str) -> String {
    url.replace("/download_ptu//", "/download/")
}

#[command]
pub async fn get_translations() -> Result<Value, String> {
    let response = reqwest::get("https://scutt.onivoid.fr/api/translations")
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    
    if let Value::Object(mut map) = response {
        // Pour chaque langue (fr, etc.)
        for (_lang, lang_data) in map.iter_mut() {
            if let Value::Object(lang_obj) = lang_data {
                // Si on trouve le tableau "links"
                if let Some(Value::Array(links)) = lang_obj.get_mut("links") {
                    // Pour chaque lien dans le tableau
                    for link in links {
                        if let Value::Object(link_obj) = link {
                            // Si c'est le lien de Circuspes
                            if let Some(Value::String(name)) = link_obj.get("name") {
                                if name == "Circuspes" {
                                    if let Some(Value::String(url)) = link_obj.get_mut("url") {
                                        *url = fix_circuspes_url(url);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(Value::Object(map))
    } else {
        Ok(response)
    }
}
