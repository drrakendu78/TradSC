use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// Paramètres graphiques confirmés fonctionnels en Star Citizen 4.5+
/// Vérifiés via console in-game (dump CVars)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserCfgSettings {
    pub r_vsync: Option<i32>,
    pub r_motionblur: Option<i32>,
    pub sys_maxfps: Option<i32>,
    pub sys_maxidlefps: Option<i32>,
    pub r_displayinfo: Option<i32>,
    pub r_ssdo: Option<i32>,
    pub r_ssr: Option<i32>,           // r_SSReflections dans user.cfg
    pub r_ssreflhalfres: Option<i32>, // SSR demi-résolution (perf)
    pub r_tsr: Option<i32>,           // Temporal Super Resolution (upscaling)
    // Fonctionnent via attributes.xml / GraphicsSettings.json
    pub e_shadows: Option<i32>,
    pub r_volumetric_clouds: Option<i32>,
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

fn parse_user_cfg_to_map(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("--") || trimmed.starts_with("//") {
            continue;
        }
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_lowercase();
            let value = trimmed[eq_pos + 1..].trim().to_string();
            map.insert(key, value);
        }
    }
    map
}

fn parse_value<T: std::str::FromStr>(map: &HashMap<String, String>, key: &str) -> Option<T> {
    map.get(key).and_then(|v| v.parse().ok())
}

#[command]
pub fn get_user_cfg_advanced_settings(version: String) -> Result<UserCfgSettings, String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");

    if !user_cfg_path.exists() {
        return Ok(UserCfgSettings {
            r_vsync: None,
            r_motionblur: None,
            sys_maxfps: None,
            sys_maxidlefps: None,
            r_displayinfo: None,
            r_ssdo: None,
            r_ssr: None,
            r_ssreflhalfres: None,
            r_tsr: None,
            e_shadows: None,
            r_volumetric_clouds: None,
        });
    }

    let content = fs::read_to_string(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la lecture: {}", e))?;

    let map = parse_user_cfg_to_map(&content);

    Ok(UserCfgSettings {
        r_vsync: parse_value(&map, "r_vsync"),
        r_motionblur: parse_value(&map, "r_motionblur"),
        sys_maxfps: parse_value(&map, "sys_maxfps"),
        sys_maxidlefps: parse_value(&map, "sys_maxidlefps"),
        r_displayinfo: parse_value(&map, "r_displayinfo"),
        r_ssdo: parse_value(&map, "r_ssdo"),
        r_ssr: parse_value(&map, "r_ssreflections"),
        r_ssreflhalfres: parse_value(&map, "r_ssreflhalfres"),
        r_tsr: parse_value(&map, "r_tsr"),
        e_shadows: None, // Géré via attributes.xml
        r_volumetric_clouds: None, // Géré via attributes.xml
    })
}

#[command]
pub fn set_user_cfg_advanced_settings(settings: UserCfgSettings, version: String) -> Result<(), String> {
    use crate::scripts::gamepath::get_star_citizen_versions;

    let versions = get_star_citizen_versions();
    let version_path = versions.versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let user_cfg_path = Path::new(&version_path.path).join("user.cfg");

    let content = if user_cfg_path.exists() {
        fs::read_to_string(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la lecture: {}", e))?
    } else {
        String::new()
    };

    // CVars qu'on gère activement (écrits par notre app)
    let managed_keys: &[&str] = &[
        "r_vsync", "r_motionblur", "sys_maxfps", "sys_maxidlefps",
        "r_displayinfo",
        "r_ssdo", "r_ssreflections", "r_ssreflhalfres", "r_tsr",
    ];

    // CVars dépréciés/anciens noms à nettoyer (SC < 4.5 ou plus dans la console)
    let deprecated_keys: &[&str] = &[
        // Anciens noms de CVars qu'on gérait avant
        "r_ssr",                   // ancien nom → r_ssreflections
        "r_displayframegraph",     // ne fonctionne pas via user.cfg
        "r_dof",                   // plus dans la console SC 4.5+
        "r_depthoffield",          // plus dans la console SC 4.5+
        "r_filmgrain",             // plus dans la console SC 4.5+
        "r_sharpening",            // plus dans la console SC 4.5+
        "r_gamma",                 // plus dans la console SC 4.5+
        "r_texturesstreampoolsize",// plus dans la console SC 4.5+
        "sys_budget_videomem",     // plus dans la console SC 4.5+
        // CVars dépréciés depuis SC 4.5
        "r_chromatic_aberration", "r_chromaticaberration",
        "e_shadows", "r_fog", "r_fogshadows",
        "r_volumetricclouds",
        "r_texturestreamingquality", "r_upscalingtechnique",
        "r_bloom", "r_opticsbloom", "r_lensflares",
        "r_vignetting", "r_colorgrading",
        "r_tessellation", "r_texanisotropicfiltering",
        "r_texmaxanisotropy", "r_texminanisotropy",
        "e_viewdistratio", "e_viewdistratiodetail", "e_lodratio",
        "r_shadowscastsunlight", "r_shadowspoolsize",
        "r_antialiasingmode",
        "e_lodmergelodmin", "e_lodmergelodfaceareatargetsize", "e_lodmergelodratio",
    ];

    let mut lines: Vec<String> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            // Garder les lignes vides et commentaires
            if trimmed.is_empty() || trimmed.starts_with("--") || trimmed.starts_with("//") {
                return true;
            }
            // Extraire la clé exacte (avant le '=')
            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_lowercase();
                // Supprimer si c'est un CVar géré ou déprécié
                !managed_keys.contains(&key.as_str()) && !deprecated_keys.contains(&key.as_str())
            } else {
                true
            }
        })
        .map(|s| s.to_string())
        .collect();

    let empty_count = lines.iter().filter(|l| l.trim().is_empty()).count();
    if empty_count > 2 {
        let mut kept_empty = 0;
        lines.retain(|line| {
            if line.trim().is_empty() {
                if kept_empty < 2 {
                    kept_empty += 1;
                    true
                } else {
                    false
                }
            } else {
                true
            }
        });
    }

    let mut new_settings = Vec::new();

    // CVars confirmés dans la console SC 4.5/4.6
    if let Some(v) = settings.r_vsync { new_settings.push(format!("r_VSync = {}", v)); }
    if let Some(v) = settings.r_motionblur { new_settings.push(format!("r_MotionBlur = {}", v)); }
    if let Some(v) = settings.sys_maxfps { new_settings.push(format!("sys_maxFps = {}", v)); }
    if let Some(v) = settings.sys_maxidlefps { new_settings.push(format!("sys_maxIdleFps = {}", v)); }
    if let Some(v) = settings.r_displayinfo { new_settings.push(format!("r_DisplayInfo = {}", v)); }
    if let Some(v) = settings.r_ssdo { new_settings.push(format!("r_ssdo = {}", v)); }
    if let Some(v) = settings.r_ssr { new_settings.push(format!("r_SSReflections = {}", v)); }
    if let Some(v) = settings.r_ssreflhalfres { new_settings.push(format!("r_SSReflHalfRes = {}", v)); }
    if let Some(v) = settings.r_tsr { new_settings.push(format!("r_TSR = {}", v)); }

    if !new_settings.is_empty() {
        if !lines.is_empty() && !lines.last().map(|l| l.trim().is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.extend(new_settings);
    }

    let new_content = lines.join("\n");
    fs::write(&user_cfg_path, new_content)
        .map_err(|e| format!("Erreur lors de l'écriture: {}", e))?;

    // Mettre à jour attributes.xml pour que les paramètres soient pris en compte par le jeu
    let attributes_path = Path::new(&version_path.path)
        .join("user")
        .join("client")
        .join("0")
        .join("Profiles")
        .join("default")
        .join("attributes.xml");

    if attributes_path.exists() {
        if let Ok(xml_content) = fs::read_to_string(&attributes_path) {
            let mut new_xml = xml_content.clone();

            // VolumetricClouds
            if let Some(clouds) = settings.r_volumetric_clouds {
                let sys_spec_value = if clouds > 0 { 4 } else { 1 };
                new_xml = update_xml_attribute(&new_xml, "SysSpec_PlanetVolumetricClouds", sys_spec_value);
            }

            // Shadows
            if let Some(shadows) = settings.e_shadows {
                new_xml = update_xml_attribute(&new_xml, "SysSpec_ShadowMaps", shadows);
            }

            // SSDO -> SysSpec_Shading
            if let Some(ssdo) = settings.r_ssdo {
                new_xml = update_xml_attribute(&new_xml, "SysSpec_Shading", if ssdo > 0 { 4 } else { 1 });
            }

            fs::write(&attributes_path, new_xml)
                .map_err(|e| format!("Erreur lors de l'écriture attributes.xml: {}", e))?;
        }
    }

    // Mettre à jour GraphicsSettings.json dans AppData\Local\Star Citizen
    if let Ok(local_appdata) = env::var("LOCALAPPDATA") {
        let star_citizen_appdata = Path::new(&local_appdata).join("Star Citizen");

        if star_citizen_appdata.exists() {
            if let Ok(entries) = fs::read_dir(&star_citizen_appdata) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        let graphics_settings_dir = entry_path.join("GraphicsSettings");
                        let graphics_settings_path = graphics_settings_dir.join("GraphicsSettings.json");

                        if !graphics_settings_dir.exists() {
                            let _ = fs::create_dir_all(&graphics_settings_dir);
                        }

                        let mut graphics_inner = if graphics_settings_path.exists() {
                            if let Ok(existing_content) = fs::read_to_string(&graphics_settings_path) {
                                if let Ok(existing_json) = serde_json::from_str::<serde_json::Value>(&existing_content) {
                                    if let Some(obj) = existing_json.get("GraphicsSettings").and_then(|v| v.as_object()) {
                                        obj.clone()
                                    } else {
                                        serde_json::Map::new()
                                    }
                                } else {
                                    serde_json::Map::new()
                                }
                            } else {
                                serde_json::Map::new()
                            }
                        } else {
                            serde_json::Map::new()
                        };

                        // Paramètres confirmés dans la console SC 4.5+
                        if let Some(vsync) = settings.r_vsync {
                            graphics_inner.insert("VSync".to_string(), serde_json::Value::Number(vsync.into()));
                        }
                        if let Some(mb) = settings.r_motionblur {
                            graphics_inner.insert("MotionBlur".to_string(), serde_json::Value::Number(mb.into()));
                        }
                        if let Some(clouds) = settings.r_volumetric_clouds {
                            graphics_inner.insert("VolumetricClouds".to_string(), serde_json::Value::Number(clouds.into()));
                        }
                        if let Some(shadows) = settings.e_shadows {
                            graphics_inner.insert("Shadows".to_string(), serde_json::Value::Number(shadows.into()));
                        }
                        if let Some(ssdo) = settings.r_ssdo {
                            graphics_inner.insert("SSDO".to_string(), serde_json::Value::Number(ssdo.into()));
                        }
                        if let Some(ssr) = settings.r_ssr {
                            graphics_inner.insert("SSR".to_string(), serde_json::Value::Number(ssr.into()));
                        }
                        if let Some(fps) = settings.sys_maxfps {
                            graphics_inner.insert("MaxFPS".to_string(), serde_json::Value::Number(fps.into()));
                        }
                        if let Some(display) = settings.r_displayinfo {
                            graphics_inner.insert("DisplayInfo".to_string(), serde_json::Value::Number(display.into()));
                        }

                        let mut json_settings = serde_json::Map::new();
                        json_settings.insert("GraphicsSettings".to_string(), serde_json::Value::Object(graphics_inner));

                        let json_content = serde_json::to_string_pretty(&serde_json::Value::Object(json_settings))
                            .unwrap_or_default();

                        let _ = fs::write(&graphics_settings_path, json_content);
                    }
                }
            }
        }
    }

    Ok(())
}

fn update_xml_attribute(xml: &str, attr_name: &str, value: i32) -> String {
    let pattern = format!(r#"<Attr name="{}" value="[^"]*"/>"#, attr_name);
    let replacement = format!(r#"<Attr name="{}" value="{}"/>"#, attr_name, value);

    if let Ok(re) = regex::Regex::new(&pattern) {
        re.replace(xml, replacement.as_str()).to_string()
    } else {
        xml.to_string()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GraphicsPreset {
    pub name: String,
    pub description: String,
    pub settings: UserCfgSettings,
}

#[command]
pub fn get_graphics_presets() -> Vec<GraphicsPreset> {
    vec![
        GraphicsPreset {
            name: "Performance".to_string(),
            description: "Maximum FPS, effets visuels minimaux".to_string(),
            settings: UserCfgSettings {
                r_vsync: Some(0),
                r_motionblur: Some(0),
                sys_maxfps: Some(0),
                sys_maxidlefps: Some(30),
                r_displayinfo: Some(0),
                r_ssdo: Some(0),
                r_ssr: Some(0),
                r_ssreflhalfres: Some(1),
                r_tsr: Some(1),
                e_shadows: Some(1),
                r_volumetric_clouds: Some(0),
            },
        },
        GraphicsPreset {
            name: "Equilibre".to_string(),
            description: "Bon compromis entre qualite et performance".to_string(),
            settings: UserCfgSettings {
                r_vsync: Some(0),
                r_motionblur: Some(0),
                sys_maxfps: Some(0),
                sys_maxidlefps: Some(60),
                r_displayinfo: Some(0),
                r_ssdo: Some(1),
                r_ssr: Some(1),
                r_ssreflhalfres: Some(1),
                r_tsr: Some(1),
                e_shadows: Some(2),
                r_volumetric_clouds: Some(1),
            },
        },
        GraphicsPreset {
            name: "Qualite".to_string(),
            description: "Qualite visuelle maximale".to_string(),
            settings: UserCfgSettings {
                r_vsync: Some(1),
                r_motionblur: Some(1),
                sys_maxfps: Some(0),
                sys_maxidlefps: Some(60),
                r_displayinfo: Some(0),
                r_ssdo: Some(2),
                r_ssr: Some(2),
                r_ssreflhalfres: Some(0),
                r_tsr: Some(1),
                e_shadows: Some(3),
                r_volumetric_clouds: Some(1),
            },
        },
        GraphicsPreset {
            name: "Cinematique".to_string(),
            description: "Pour les captures video et screenshots".to_string(),
            settings: UserCfgSettings {
                r_vsync: Some(1),
                r_motionblur: Some(2),
                sys_maxfps: Some(60),
                sys_maxidlefps: Some(30),
                r_displayinfo: Some(0),
                r_ssdo: Some(2),
                r_ssr: Some(2),
                r_ssreflhalfres: Some(0),
                r_tsr: Some(1),
                e_shadows: Some(3),
                r_volumetric_clouds: Some(1),
            },
        },
    ]
}

#[command]
pub fn apply_graphics_preset(preset_name: String, version: String) -> Result<(), String> {
    let presets = get_graphics_presets();
    let preset = presets
        .iter()
        .find(|p| p.name == preset_name)
        .ok_or_else(|| format!("Preset '{}' non trouvé", preset_name))?;

    set_user_cfg_advanced_settings(preset.settings.clone(), version)
}
