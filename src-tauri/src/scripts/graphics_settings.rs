use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::Path;
use tauri::command;

#[derive(Serialize, Deserialize, Debug)]
struct GraphicsSettings {
    #[serde(rename = "GraphicsSettings")]
    graphics_settings: GraphicsSettingsInner,
}

#[derive(Serialize, Deserialize, Debug)]
struct GraphicsSettingsInner {
    #[serde(rename = "GraphicsRenderer")]
    graphics_renderer: u32,
}

/// Trouve le chemin vers GraphicsSettings.json dans AppData\Local
fn find_graphics_settings_path() -> Result<String, String> {
    let local_appdata = env::var("LOCALAPPDATA")
        .map_err(|_| "Impossible de trouver LOCALAPPDATA".to_string())?;
    
    let star_citizen_path = format!("{}\\Star Citizen", local_appdata);
    let path = Path::new(&star_citizen_path);
    
    if !path.exists() {
        return Err("Le dossier Star Citizen n'existe pas dans AppData\\Local".to_string());
    }
    
    // Chercher dans tous les sous-dossiers
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let graphics_path = entry.path()
                    .join("GraphicsSettings")
                    .join("GraphicsSettings.json");
                
                if graphics_path.exists() {
                    return Ok(graphics_path.to_string_lossy().to_string());
                }
            }
        }
    }
    
    Err("GraphicsSettings.json non trouvé".to_string())
}

/// Lit la valeur actuelle du renderer (Vulkan = 1, DirectX 11 = 0)
/// Lit depuis le user.cfg spécifique à la version pour permettre des configs différentes par version
#[command]
pub fn get_graphics_renderer(version: String) -> Result<u32, String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");

    if !user_cfg_path.exists() {
        return Ok(0); // Par défaut DirectX 11
    }

    let content = fs::read_to_string(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la lecture: {}", e))?;

    // Chercher la ligne r.graphicsRenderer
    for line in content.lines() {
        if line.trim().starts_with("r.graphicsRenderer") {
            if let Some(value) = line.split('=').nth(1) {
                if let Ok(renderer) = value.trim().parse::<u32>() {
                    return Ok(renderer);
                }
            }
        }
    }

    Ok(0) // Par défaut DirectX 11 si non trouvé
}

/// Met à jour le renderer (Vulkan = 1, DirectX 11 = 0)
#[command]
pub fn set_graphics_renderer(renderer: u32, version: String) -> Result<(), String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    // Mettre à jour GraphicsSettings.json
    let path = find_graphics_settings_path()?;

    let settings = GraphicsSettings {
        graphics_settings: GraphicsSettingsInner {
            graphics_renderer: renderer,
        },
    };

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Erreur lors de la sérialisation: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Erreur lors de l'écriture: {}", e))?;

    // Mettre à jour user.cfg avec r.graphicsRenderer (à la fin du fichier)
    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");
    
    // Lire le contenu actuel
    let content = if user_cfg_path.exists() {
        fs::read_to_string(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la lecture: {}", e))?
    } else {
        String::new()
    };
    
    // Séparer le contenu en lignes
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    
    // Supprimer l'ancienne ligne r.graphicsRenderer si elle existe
    lines.retain(|line| {
        let trimmed = line.trim();
        !trimmed.starts_with("r.graphicsRenderer")
    });
    
    // Ajouter r.graphicsRenderer à la fin
    let renderer_line = format!("r.graphicsRenderer = {}", renderer);
    lines.push(renderer_line);
    
    // Reconstruire le contenu
    let new_content = lines.join("\n");
    
    fs::write(&user_cfg_path, new_content)
        .map_err(|e| format!("Erreur lors de l'écriture: {}", e))?;
    
    Ok(())
}

/// Lit la résolution actuelle depuis user.cfg
#[command]
pub fn get_user_cfg_resolution(version: String) -> Result<(u32, u32), String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");
    
    if !user_cfg_path.exists() {
        return Ok((1920, 1080)); // Valeur par défaut
    }
    
    let content = fs::read_to_string(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la lecture: {}", e))?;
    
    let mut width = 1920;
    let mut height = 1080;
    
    for line in content.lines() {
        if line.trim().starts_with("r_width") {
            if let Some(value) = line.split('=').nth(1) {
                if let Ok(w) = value.trim().parse::<u32>() {
                    width = w;
                }
            }
        } else if line.trim().starts_with("r_height") {
            if let Some(value) = line.split('=').nth(1) {
                if let Ok(h) = value.trim().parse::<u32>() {
                    height = h;
                }
            }
        }
    }
    
    Ok((width, height))
}

/// Met à jour la résolution dans user.cfg
#[command]
pub fn set_user_cfg_resolution(width: u32, height: u32, version: String) -> Result<(), String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");
    
    // Lire le contenu actuel
    let content = if user_cfg_path.exists() {
        fs::read_to_string(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la lecture: {}", e))?
    } else {
        String::new()
    };
    
    // Séparer le contenu en lignes
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    
    // Sauvegarder r.graphicsRenderer si elle existe (pour la remettre à la fin)
    let mut graphics_renderer_line: Option<String> = None;
    for line in &lines {
        if line.trim().starts_with("r.graphicsRenderer") {
            graphics_renderer_line = Some(line.clone());
            break;
        }
    }
    
    // Supprimer les anciennes lignes (si elles existent)
    lines.retain(|line| {
        let trimmed = line.trim();
        !trimmed.starts_with("Con_Restricted") 
            && !trimmed.starts_with("r_width") 
            && !trimmed.starts_with("r_height")
            && !trimmed.starts_with("r.graphicsRenderer")
    });
    
    // Trouver où insérer (après la dernière ligne non vide, ou à la fin)
    let mut insert_index = lines.len();
    for (i, line) in lines.iter().enumerate().rev() {
        if !line.trim().is_empty() {
            insert_index = i + 1;
            break;
        }
    }
    
    // Préparer les nouvelles lignes dans le bon ordre (avec espace après Con_Restricted)
    let new_lines = vec![
        "Con_Restricted = 0".to_string(),
        String::new(), // Ligne vide
        format!("r_width = {}", width),
        format!("r_height = {}", height),
    ];
    
    // Insérer les nouvelles lignes
    for (i, new_line) in new_lines.iter().enumerate() {
        lines.insert(insert_index + i, new_line.clone());
    }
    
    // Remettre r.graphicsRenderer à la fin si elle existait
    if let Some(renderer_line) = graphics_renderer_line {
        lines.push(renderer_line);
    }
    
    // Reconstruire le contenu
    let new_content = lines.join("\n");
    
    fs::write(&user_cfg_path, new_content)
        .map_err(|e| format!("Erreur lors de l'écriture: {}", e))?;
    
    Ok(())
}

