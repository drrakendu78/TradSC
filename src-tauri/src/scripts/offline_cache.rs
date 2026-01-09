use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tauri::command;
use chrono::Utc;

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Informations sur une traduction en cache
#[derive(Serialize, Deserialize, Clone)]
pub struct CachedTranslation {
    /// Version du jeu (LIVE, PTU, etc.)
    pub game_version: String,
    /// Source de la traduction (scefra, circuspes, etc.)
    pub source: String,
    /// URL d'origine de la traduction
    pub original_url: String,
    /// Date de mise en cache (ISO 8601)
    pub cached_at: String,
    /// Taille du fichier en bytes
    pub file_size: u64,
}

/// Liste des traductions en cache
#[derive(Serialize, Deserialize, Default)]
pub struct CacheIndex {
    pub translations: Vec<CachedTranslation>,
}

/// Récupère le dossier de cache des traductions
fn get_cache_directory() -> Result<PathBuf, String> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let cache_dir = PathBuf::from(appdata)
            .join("com.drrakendu78.startradfr")
            .join("translation_cache");

        if !cache_dir.exists() {
            fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Impossible de créer le dossier de cache: {}", e))?;
        }

        Ok(cache_dir)
    } else {
        Err("Variable APPDATA non définie".to_string())
    }
}

/// Récupère le chemin du fichier d'index du cache
fn get_cache_index_path() -> Result<PathBuf, String> {
    let cache_dir = get_cache_directory()?;
    Ok(cache_dir.join("index.json"))
}

/// Charge l'index du cache
fn load_cache_index() -> Result<CacheIndex, String> {
    let index_path = get_cache_index_path()?;

    if !index_path.exists() {
        return Ok(CacheIndex::default());
    }

    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("Erreur lecture index: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Erreur parsing index: {}", e))
}

/// Sauvegarde l'index du cache
fn save_cache_index(index: &CacheIndex) -> Result<(), String> {
    let index_path = get_cache_index_path()?;

    let content = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Erreur sérialisation index: {}", e))?;

    fs::write(&index_path, content)
        .map_err(|e| format!("Erreur écriture index: {}", e))
}

/// Génère un nom de fichier pour le cache basé sur la version et la source
fn get_cache_filename(game_version: &str, source: &str) -> String {
    format!("{}_{}.ini", game_version.to_lowercase(), source.to_lowercase())
}

/// Détecte la source de traduction à partir de l'URL
fn detect_translation_source(url: &str) -> String {
    let url_lower = url.to_lowercase();

    // Détecter les variantes SCFRA
    if url_lower.contains("scefra") || url_lower.contains("speed0u") {
        // Distinguer Settings FR vs Settings EN
        if url_lower.contains("settings_en") || url_lower.contains("settings-en") || url_lower.contains("settingsen") || url_lower.contains("_en.") || url_lower.contains("-en.") {
            "scefra_en".to_string()
        } else {
            "scefra_fr".to_string()
        }
    } else if url_lower.contains("circuspes") {
        "circuspes".to_string()
    } else if url_lower.starts_with("local://") {
        // URL locale générée pour les traductions existantes
        if url_lower.contains("/scefra") {
            "scefra_fr".to_string()
        } else if url_lower.contains("/circuspes") {
            "circuspes".to_string()
        } else {
            "local".to_string()
        }
    } else {
        "unknown".to_string()
    }
}

/// Fonction interne pour sauvegarder une traduction dans le cache (appelable depuis d'autres modules)
pub fn cache_translation_internal(
    game_version: &str,
    translation_url: &str,
    content: &str,
) -> Result<CachedTranslation, String> {
    let cache_dir = get_cache_directory()?;
    let source = detect_translation_source(translation_url);
    let filename = get_cache_filename(game_version, &source);
    let file_path = cache_dir.join(&filename);

    // Écrire le fichier avec BOM UTF-8
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Erreur création fichier cache: {}", e))?;

    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Erreur écriture cache: {}", e))?;

    // Créer l'entrée de cache
    let cached = CachedTranslation {
        game_version: game_version.to_string(),
        source: source.clone(),
        original_url: translation_url.to_string(),
        cached_at: Utc::now().to_rfc3339(),
        file_size: content.len() as u64,
    };

    // Mettre à jour l'index
    let mut index = load_cache_index()?;

    // Supprimer l'ancienne entrée si elle existe
    index.translations.retain(|t|
        !(t.game_version == game_version && t.source == source)
    );

    // Ajouter la nouvelle entrée
    index.translations.push(cached.clone());

    save_cache_index(&index)?;

    Ok(cached)
}

/// Sauvegarde une traduction dans le cache (commande Tauri)
#[command]
pub fn cache_translation(
    game_version: String,
    translation_url: String,
    content: String,
) -> Result<CachedTranslation, String> {
    let cache_dir = get_cache_directory()?;
    let source = detect_translation_source(&translation_url);
    let filename = get_cache_filename(&game_version, &source);
    let file_path = cache_dir.join(&filename);

    // Écrire le fichier avec BOM UTF-8
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Erreur création fichier cache: {}", e))?;

    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Erreur écriture cache: {}", e))?;

    // Créer l'entrée de cache
    let cached = CachedTranslation {
        game_version: game_version.clone(),
        source: source.clone(),
        original_url: translation_url,
        cached_at: Utc::now().to_rfc3339(),
        file_size: content.len() as u64,
    };

    // Mettre à jour l'index
    let mut index = load_cache_index()?;

    // Supprimer l'ancienne entrée si elle existe
    index.translations.retain(|t|
        !(t.game_version == game_version && t.source == source)
    );

    // Ajouter la nouvelle entrée
    index.translations.push(cached.clone());

    save_cache_index(&index)?;

    Ok(cached)
}

/// Liste les traductions en cache
#[command]
pub fn list_cached_translations() -> Result<Vec<CachedTranslation>, String> {
    let index = load_cache_index()?;
    Ok(index.translations)
}

/// Récupère le contenu d'une traduction depuis le cache
#[command]
pub fn get_cached_translation(
    game_version: String,
    source: String,
) -> Result<String, String> {
    let cache_dir = get_cache_directory()?;
    let filename = get_cache_filename(&game_version, &source);
    let file_path = cache_dir.join(&filename);

    if !file_path.exists() {
        return Err(format!("Traduction {} ({}) non trouvée dans le cache", game_version, source));
    }

    let mut content_bytes = fs::read(&file_path)
        .map_err(|e| format!("Erreur lecture cache: {}", e))?;

    // Retirer le BOM si présent
    if content_bytes.starts_with(UTF8_BOM) {
        content_bytes = content_bytes[UTF8_BOM.len()..].to_vec();
    }

    String::from_utf8(content_bytes)
        .map_err(|e| format!("Erreur UTF-8: {}", e))
}

/// Supprime une traduction du cache
#[command]
pub fn delete_cached_translation(
    game_version: String,
    source: String,
) -> Result<(), String> {
    let cache_dir = get_cache_directory()?;
    let filename = get_cache_filename(&game_version, &source);
    let file_path = cache_dir.join(&filename);

    // Supprimer le fichier s'il existe
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Erreur suppression fichier: {}", e))?;
    }

    // Mettre à jour l'index
    let mut index = load_cache_index()?;
    index.translations.retain(|t|
        !(t.game_version == game_version && t.source == source)
    );
    save_cache_index(&index)?;

    Ok(())
}

/// Vide entièrement le cache de traductions
#[command]
pub fn clear_translation_cache() -> Result<u32, String> {
    let cache_dir = get_cache_directory()?;
    let index = load_cache_index()?;
    let count = index.translations.len() as u32;

    // Supprimer tous les fichiers .ini
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "ini") {
                let _ = fs::remove_file(&path);
            }
        }
    }

    // Réinitialiser l'index
    save_cache_index(&CacheIndex::default())?;

    Ok(count)
}

/// Vérifie si une traduction est disponible dans le cache
#[command]
pub fn is_translation_cached(
    game_version: String,
    source: String,
) -> bool {
    let cache_dir = match get_cache_directory() {
        Ok(dir) => dir,
        Err(_) => return false,
    };

    let filename = get_cache_filename(&game_version, &source);
    let file_path = cache_dir.join(&filename);

    file_path.exists()
}

/// Récupère les informations sur le cache
#[derive(Serialize)]
pub struct CacheInfo {
    pub total_files: u32,
    pub total_size: u64,
    pub cache_path: String,
}

#[command]
pub fn get_translation_cache_info() -> Result<CacheInfo, String> {
    let cache_dir = get_cache_directory()?;
    let index = load_cache_index()?;

    let total_size: u64 = index.translations.iter()
        .map(|t| t.file_size)
        .sum();

    Ok(CacheInfo {
        total_files: index.translations.len() as u32,
        total_size,
        cache_path: cache_dir.to_string_lossy().to_string(),
    })
}

/// Ouvre le dossier de cache dans l'explorateur
#[command]
pub fn open_translation_cache_folder() -> Result<(), String> {
    let cache_dir = get_cache_directory()?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le dossier: {}", e))?;
    }

    Ok(())
}

/// Cache toutes les traductions déjà installées (appelé au démarrage)
#[command]
pub fn cache_all_installed_translations() -> Result<u32, String> {
    use regex::Regex;
    use std::path::Path;

    println!("[Cache Traductions] Démarrage de la mise en cache des traductions installées...");

    let mut cached_count = 0u32;

    // Lire le fichier log RSI Launcher pour trouver les installations
    if let Ok(appdata) = std::env::var("APPDATA") {
        let log_path = format!("{}\\rsilauncher\\logs\\log.log", appdata);
        println!("[Cache Traductions] Lecture du log RSI Launcher: {}", log_path);

        if let Ok(log_content) = fs::read_to_string(&log_path) {
            let pattern = r"([a-zA-Z]:\\\\(?:[^\\\\]+\\\\)*StarCitizen\\\\[A-Za-z0-9_\\.\\@\\-]+)";
            if let Ok(re) = Regex::new(pattern) {
                let mut seen_paths = std::collections::HashSet::new();

                for line in log_content.lines().rev() {
                    for cap in re.captures_iter(line) {
                        if let Some(matched_path) = cap.get(0) {
                            let path_str = matched_path.as_str().replace("\\\\", "\\");
                            let normalized_path = path_str.trim_end_matches('\\').to_string();

                            if seen_paths.contains(&normalized_path) {
                                continue;
                            }

                            // Vérifier que le chemin existe et contient le jeu
                            let exe_path = format!("{}\\Bin64\\StarCitizen.exe", normalized_path);
                            if !Path::new(&exe_path).exists() {
                                continue;
                            }

                            seen_paths.insert(normalized_path.clone());

                            // Extraire la version
                            let version_re = Regex::new(r"StarCitizen\\([A-Za-z0-9_\\.\\@-]+)\\?$").ok();
                            let version = version_re.and_then(|re| {
                                re.captures(&normalized_path)
                                    .and_then(|cap| cap.get(1))
                                    .map(|m| m.as_str().trim_end_matches('\\').to_string())
                            });

                            if let Some(version) = version {
                                println!("[Cache Traductions] Version trouvée: {} ({})", version, normalized_path);

                                // Vérifier si une traduction est installée
                                let global_ini_path = format!(
                                    "{}\\data\\Localization\\french_(france)\\global.ini",
                                    normalized_path
                                );

                                if Path::new(&global_ini_path).exists() {
                                    println!("[Cache Traductions] Traduction installée trouvée pour {}", version);

                                    // Vérifier si déjà en cache
                                    let index = load_cache_index().unwrap_or_default();
                                    let already_cached = index.translations.iter()
                                        .any(|t| t.game_version.to_uppercase() == version.to_uppercase());

                                    if !already_cached {
                                        println!("[Cache Traductions] {} n'est pas encore en cache, mise en cache...", version);

                                        // Lire le contenu et le cacher
                                        if let Ok(content) = fs::read_to_string(&global_ini_path) {
                                            // Retirer le BOM si présent
                                            let content = if content.starts_with('\u{feff}') {
                                                content[3..].to_string()
                                            } else {
                                                content
                                            };

                                            // Détecter la source depuis le contenu
                                            let source = if content.contains("SCFRA") || content.contains("StarTrad") {
                                                "scefra_fr"
                                            } else if content.contains("Circuspes") {
                                                "circuspes"
                                            } else {
                                                "local"
                                            };

                                            println!("[Cache Traductions] Source détectée pour {}: {}", version, source);

                                            // Cacher avec une URL fictive
                                            let fake_url = format!("local://{}/{}", version, source);
                                            match cache_translation_internal(&version, &fake_url, &content) {
                                                Ok(_) => {
                                                    println!("[Cache Traductions] ✓ {} ({}) mis en cache avec succès", version, source);
                                                    cached_count += 1;
                                                }
                                                Err(e) => {
                                                    eprintln!("[Cache Traductions] ✗ Erreur lors de la mise en cache de {}: {}", version, e);
                                                }
                                            }
                                        } else {
                                            eprintln!("[Cache Traductions] ✗ Impossible de lire le fichier global.ini pour {}", version);
                                        }
                                    } else {
                                        println!("[Cache Traductions] {} déjà en cache, ignoré", version);
                                    }
                                } else {
                                    println!("[Cache Traductions] Pas de traduction installée pour {}", version);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            println!("[Cache Traductions] Fichier log RSI Launcher non trouvé");
        }
    } else {
        eprintln!("[Cache Traductions] Variable APPDATA non définie");
    }

    println!("[Cache Traductions] Terminé - {} traduction(s) mise(s) en cache", cached_count);
    Ok(cached_count)
}

/// URLs des 3 sources de traduction françaises
const TRANSLATION_SOURCES: &[(&str, &str)] = &[
    ("scefra_fr", "https://raw.githubusercontent.com/SPEED0U/Scefra/main/french_(france)/global.ini"),
    ("scefra_en", "https://raw.githubusercontent.com/SPEED0U/Scefra/refs/heads/settings-en/french_(france)/global.ini"),
    ("circuspes", "https://traduction.circuspes.fr/download/global.ini"),
];

/// Vérifie si le cache a été initialisé (premier lancement)
/// Retourne true si le cache est vide et doit être initialisé
pub fn is_cache_empty_for_version(game_version: &str) -> bool {
    let index = load_cache_index().unwrap_or_default();
    // Vérifier si au moins une source est en cache pour cette version
    !index.translations.iter().any(|t| t.game_version.to_uppercase() == game_version.to_uppercase())
}

/// Télécharge et cache toutes les sources de traduction disponibles (appelé par le service de fond)
pub async fn download_and_cache_all_translations(game_version: &str) -> Result<u32, String> {
    download_and_cache_all_translations_with_force(game_version, false).await
}

/// Télécharge et cache toutes les sources de traduction avec option de forcer le rafraîchissement
pub async fn download_and_cache_all_translations_with_force(game_version: &str, force_refresh: bool) -> Result<u32, String> {
    if force_refresh {
        println!("[Cache Téléchargement] Rafraîchissement forcé des 3 sources pour {}...", game_version);
    } else {
        println!("[Cache Téléchargement] Téléchargement des 3 sources de traduction pour {}...", game_version);
    }

    let mut cached_count = 0u32;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180)) // 3 minutes pour les gros fichiers (Circuspes ~10MB)
        .user_agent("StarTradFR/3.0")
        .build()
        .map_err(|e| format!("Erreur création client HTTP: {}", e))?;

    for (source_name, url) in TRANSLATION_SOURCES {
        println!("[Cache Téléchargement] Téléchargement {} depuis {}...", source_name, url);

        // Vérifier si déjà en cache (sauf si force_refresh)
        if !force_refresh {
            let index = load_cache_index().unwrap_or_default();
            let already_cached = index.translations.iter()
                .any(|t| t.game_version.to_uppercase() == game_version.to_uppercase() && t.source == *source_name);

            if already_cached {
                println!("[Cache Téléchargement] {} ({}) déjà en cache, ignoré", game_version, source_name);
                continue;
            }
        }

        // Télécharger le contenu
        match client.get(*url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.text().await {
                        Ok(content) => {
                            // Retirer le BOM si présent
                            let content = if content.starts_with('\u{feff}') {
                                content[3..].to_string()
                            } else {
                                content
                            };

                            // Cacher la traduction
                            match cache_translation_internal(game_version, url, &content) {
                                Ok(_) => {
                                    println!("[Cache Téléchargement] ✓ {} ({}) téléchargé et mis en cache", game_version, source_name);
                                    cached_count += 1;
                                }
                                Err(e) => {
                                    eprintln!("[Cache Téléchargement] ✗ Erreur cache {} ({}): {}", game_version, source_name, e);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[Cache Téléchargement] ✗ Erreur lecture réponse {} ({}): {}", game_version, source_name, e);
                        }
                    }
                } else {
                    eprintln!("[Cache Téléchargement] ✗ Erreur HTTP {} pour {} ({})", response.status(), game_version, source_name);
                }
            }
            Err(e) => {
                eprintln!("[Cache Téléchargement] ✗ Erreur téléchargement {} ({}): {}", game_version, source_name, e);
            }
        }
    }

    println!("[Cache Téléchargement] Terminé pour {} - {} source(s) téléchargée(s)", game_version, cached_count);
    Ok(cached_count)
}
