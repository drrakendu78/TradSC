use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use reqwest::blocking::Client;
use tauri::command;

use super::offline_cache::cache_translation_internal;

pub fn get_language_folder(lang: &str) -> Option<&str> {
    match lang.to_lowercase().as_str() {
        "fr" => Some("french_(france)"),
        // Vous pouvez ajouter d'autres langues ici
        _ => None,
    }
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Applique le branding StarTrad FR directement sur le contenu (sans vérifier le lien)
fn apply_startrad_branding_direct(content: &str) -> String {
    // Remplacer tous les "Multitool" par "StarTrad FR" (SCEFRA)
    let result = content.replace("Multitool", "StarTrad FR");

    // Remplacer les mentions Discord SCEFRA par le contact StarTrad FR
    let result = result.replace(
        "Discord SCEFRA (SCEFRA sur StarTrad FR)",
        "Discord pseudo drrakendu78 ou sur discord.startrad.link"
    );

    // Branding Circuspes (commentaire en haut du fichier)
    let result = result.replace(
        "; Lien pour télécharger le fichier et informations : https://traduction.circuspes.fr/download/",
        "; Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78"
    );

    // Branding Circuspes (texte dans le jeu)
    let result = result.replace(
        "Initiative de traduction communautaire francophone",
        "Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78"
    );

    // Supprimer le lien Circuspes dans le texte du jeu
    result.replace(" : https://traduction.circuspes.fr/download/", "")
}

/// Vérifie si le fichier local a besoin du branding
fn needs_branding(content: &str) -> bool {
    // SCEFRA: vérifie si "Multitool" est présent
    // Circuspes: vérifie les textes spécifiques
    content.contains("Multitool")
        || content.contains("; Lien pour télécharger le fichier et informations : https://traduction.circuspes.fr/download/")
        || content.contains("Initiative de traduction communautaire francophone")
        || content.contains(" : https://traduction.circuspes.fr/download/")
}

/// Applique le branding StarTrad FR à un fichier local existant
#[command]
pub fn apply_branding_to_local_file(path: String, lang: String) -> Result<bool, String> {
    let base_path = Path::new(&path);

    let lang_folder_name = get_language_folder(&lang)
        .ok_or_else(|| "Langue non prise en charge".to_string())?;

    let global_ini_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name)
        .join("global.ini");

    if !global_ini_path.is_file() {
        return Ok(false); // Fichier non trouvé, rien à faire
    }

    // Lire le fichier
    let mut content_bytes = fs::read(&global_ini_path)
        .map_err(|e| format!("Erreur lecture: {}", e))?;

    // Retirer le BOM si présent
    if content_bytes.starts_with(UTF8_BOM) {
        content_bytes = content_bytes[UTF8_BOM.len()..].to_vec();
    }

    let content = String::from_utf8(content_bytes)
        .map_err(|e| format!("Erreur UTF-8: {}", e))?;

    // Vérifier si le branding est nécessaire
    if !needs_branding(&content) {
            return Ok(false);
    }

    // Appliquer le branding
    let new_content = apply_startrad_branding_direct(&content);

    // Réécrire le fichier avec BOM
    let mut file = File::create(&global_ini_path)
        .map_err(|e| format!("Erreur création: {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(new_content.as_bytes()))
        .map_err(|e| format!("Erreur écriture: {}", e))?;

    Ok(true)
}

/// Applique le branding StarTrad FR selon la source de traduction
fn apply_startrad_branding(content: &str, translation_link: &str) -> String {
    let is_scefra = translation_link.to_lowercase().contains("scefra") || translation_link.contains("SPEED0U");
    let is_circuspes = translation_link.to_lowercase().contains("circuspes");

    let mut result = content.to_string();

    // Branding SCEFRA: remplacer tous les "Multitool" par "StarTrad FR"
    if is_scefra {
        result = result.replace("Multitool", "StarTrad FR");
        // Remplacer les mentions Discord SCEFRA par le contact StarTrad FR
        result = result.replace(
            "Discord SCEFRA (SCEFRA sur StarTrad FR)",
            "Discord pseudo drrakendu78 ou sur discord.startrad.link"
        );
    }

    // Branding Circuspes
    if is_circuspes {
        let search_text3 = "; Lien pour télécharger le fichier et informations : https://traduction.circuspes.fr/download/";
        let replace_text3 = "; Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78";

        let search_text4 = "Initiative de traduction communautaire francophone";
        let replace_text4 = "Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78";

        let search_text5 = " : https://traduction.circuspes.fr/download/";
        let replace_text5 = "";

        result = result
            .replace(search_text3, replace_text3)
            .replace(search_text4, replace_text4)
            .replace(search_text5, replace_text5);
    }

    result
}

#[command]
pub fn is_game_translated(path: String, lang: String) -> bool {
    let base_path = Path::new(&path);

    // Vérifier l'existence du fichier user.cfg
    let user_cfg_path = base_path.join("user.cfg");
    if !user_cfg_path.is_file() {
        return false;
    }

    // Lire le contenu de user.cfg
    let user_cfg_content = match fs::read_to_string(&user_cfg_path) {
        Ok(content) => content,
        Err(_) => return false,
    };

    // Obtenir le nom du dossier de langue
    let lang_folder_name = match get_language_folder(&lang) {
        Some(name) => name,
        None => return false,
    };

    // Vérifier si user.cfg contient la bonne configuration
    if !user_cfg_content.contains(&format!("g_language = {}", lang_folder_name)) {
        return false;
    }

    // Vérifier l'existence des dossiers requis
    let data_path = base_path.join("data");
    let localization_path = data_path.join("Localization");
    let lang_folder_path = localization_path.join(lang_folder_name);
    let global_ini_path = lang_folder_path.join("global.ini");

    data_path.is_dir()
        && localization_path.is_dir()
        && lang_folder_path.is_dir()
        && global_ini_path.is_file()
}

#[command]
pub fn init_translation_files(
    path: String,
    lang: String,
    translation_link: String,
    game_version: Option<String>,
) -> Result<(), String> {
    let base_path = Path::new(&path);

    // Vérifier et créer le dossier 'data'
    let data_path = base_path.join("data");
    if !data_path.exists() {
        fs::create_dir(&data_path)
            .map_err(|e| format!("Erreur lors de la création de 'data': {}", e))?;
    }

    // Vérifier et créer le dossier 'Localization'
    let localization_path = data_path.join("Localization");
    if !localization_path.exists() {
        fs::create_dir(&localization_path)
            .map_err(|e| format!("Erreur lors de la création de 'Localization': {}", e))?;
    }

    // Obtenir le nom du dossier de langue
    let lang_folder_name =
        get_language_folder(&lang).ok_or_else(|| "Langue non prise en charge".to_string())?;

    // Vérifier et créer le dossier de langue
    let lang_folder_path = localization_path.join(lang_folder_name);
    if !lang_folder_path.exists() {
        fs::create_dir(&lang_folder_path)
            .map_err(|e| format!("Erreur lors de la création du dossier de langue: {}", e))?;
    }

    // Télécharger et écrire le fichier 'global.ini' avec UTF-8 BOM
    let global_ini_path = lang_folder_path.join("global.ini");
    let client = Client::new();
    let response = client
        .get(&translation_link)
        .send()
        .map_err(|e| format!("Erreur lors du téléchargement: {}", e))?;
    let content = response
        .text()
        .map_err(|e| format!("Erreur lors de la lecture de la réponse: {}", e))?;

    // Appliquer le branding StarTrad FR pour les traductions SCFRA
    let content = apply_startrad_branding(&content, &translation_link);

    let mut file = File::create(&global_ini_path)
        .map_err(|e| format!("Erreur lors de la création de 'global.ini': {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Erreur lors de l'écriture de 'global.ini': {}", e))?;

    // Créer ou mettre à jour 'user.cfg' à la racine
    let user_cfg_path = base_path.join("user.cfg");
    let mut file = File::create(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la création de 'user.cfg': {}", e))?;
    let cfg_content = format!(
        "g_language = {}\ng_languageAudio = english\n",
        lang_folder_name
    );
    file.write_all(cfg_content.as_bytes())
        .map_err(|e| format!("Erreur lors de l'écriture dans 'user.cfg': {}", e))?;

    // Mettre en cache pour le mode hors-ligne (si game_version fourni)
    if let Some(version) = game_version {
        let _ = cache_translation_internal(&version, &translation_link, &content);
    }

    Ok(())
}

#[command]
pub fn is_translation_up_to_date(path: String, translation_link: String, lang: String) -> bool {
    let base_path = Path::new(&path);

    // Obtenir le nom du dossier de langue
    let lang_folder_name = match get_language_folder(&lang) {
        Some(name) => name,
        None => return false,
    };

    // Chemin vers le fichier local 'global.ini'
    let global_ini_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name)
        .join("global.ini");

    if !global_ini_path.is_file() {
        return false;
    }

    // Lire le fichier local 'global.ini' en tant que bytes
    let mut local_ini_bytes = match fs::read(&global_ini_path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    // Retirer le BOM si présent
    if local_ini_bytes.starts_with(UTF8_BOM) {
        local_ini_bytes = local_ini_bytes[UTF8_BOM.len()..].to_vec();
    }

    let local_ini_content = match String::from_utf8(local_ini_bytes) {
        Ok(content) => content,
        Err(_) => return false,
    };

    // Télécharger le fichier 'global.ini' depuis le 'TranslationLink'
    let client = Client::new();
    let response = match client.get(&translation_link).send() {
        Ok(resp) => resp,
        Err(_) => return false,
    };

    let remote_ini_content = match response.text() {
        Ok(text) => text,
        Err(_) => return false,
    };

    // Appliquer le branding StarTrad FR au contenu distant pour comparaison correcte
    let remote_ini_content = apply_startrad_branding(&remote_ini_content, &translation_link);

    // Normaliser les contenus
    let local_normalized = local_ini_content.replace("\r\n", "\n").trim().to_string();
    let remote_normalized = remote_ini_content.replace("\r\n", "\n").trim().to_string();

    // Comparer les contenus
    local_normalized == remote_normalized
}

#[command]
pub fn update_translation(
    path: String,
    lang: String,
    translation_link: String,
    game_version: Option<String>,
) -> Result<(), String> {
    let base_path = Path::new(&path);

    // Obtenir le nom du dossier de langue
    let lang_folder_name =
        get_language_folder(&lang).ok_or_else(|| "Langue non prise en charge".to_string())?;

    // Chemin vers le dossier de langue
    let lang_folder_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name);

    // Vérifier et créer le dossier de langue s'il n'existe pas
    if !lang_folder_path.exists() {
        fs::create_dir_all(&lang_folder_path)
            .map_err(|e| format!("Erreur lors de la création du dossier de langue: {}", e))?;
    }

    // Chemin vers le fichier 'global.ini' local
    let global_ini_path = lang_folder_path.join("global.ini");

    // Télécharger le fichier 'global.ini' depuis 'translation_link'
    let client = Client::new();
    let response = client
        .get(&translation_link)
        .send()
        .map_err(|e| format!("Erreur lors du téléchargement: {}", e))?;
    let content = response
        .text()
        .map_err(|e| format!("Erreur lors de la lecture de la réponse: {}", e))?;

    // Appliquer le branding StarTrad FR pour les traductions SCFRA
    let content = apply_startrad_branding(&content, &translation_link);

    // Écrire le contenu dans le fichier 'global.ini' local avec UTF-8 BOM
    let mut file = File::create(&global_ini_path)
        .map_err(|e| format!("Erreur lors de la création de 'global.ini': {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Erreur lors de l'écriture de 'global.ini': {}", e))?;

    // Mettre en cache pour le mode hors-ligne (si game_version fourni)
    if let Some(version) = game_version {
        let _ = cache_translation_internal(&version, &translation_link, &content);
    }

    Ok(())
}

#[command]
pub fn uninstall_translation(path: String) -> Result<(), String> {
    let base_path = Path::new(&path);

    // Supprimer le dossier 'data'
    let data_path = base_path.join("data");
    if data_path.exists() {
        fs::remove_dir_all(&data_path)
            .map_err(|e| format!("Erreur lors de la suppression de 'data': {}", e))?;
    }

    // Supprimer le fichier 'user.cfg'
    let user_cfg_path = base_path.join("user.cfg");
    if user_cfg_path.exists() {
        fs::remove_file(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la suppression de 'user.cfg': {}", e))?;
    }

    Ok(())
}

// ============================================================================
// Versions ASYNC pour le background service (évite les conflits avec Tokio)
// ============================================================================

/// Version async de is_translation_up_to_date pour le background service
pub async fn is_translation_up_to_date_async(path: String, translation_link: String, lang: String) -> bool {
    let base_path = Path::new(&path);

    // Obtenir le nom du dossier de langue
    let lang_folder_name = match get_language_folder(&lang) {
        Some(name) => name,
        None => return false,
    };

    // Chemin vers le fichier local 'global.ini'
    let global_ini_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name)
        .join("global.ini");

    if !global_ini_path.is_file() {
        return false;
    }

    // Lire le fichier local 'global.ini' en tant que bytes
    let mut local_ini_bytes = match fs::read(&global_ini_path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    // Retirer le BOM si présent
    if local_ini_bytes.starts_with(UTF8_BOM) {
        local_ini_bytes = local_ini_bytes[UTF8_BOM.len()..].to_vec();
    }

    let local_ini_content = match String::from_utf8(local_ini_bytes) {
        Ok(content) => content,
        Err(_) => return false,
    };

    // Télécharger le fichier 'global.ini' depuis le 'TranslationLink' (ASYNC)
    let client = reqwest::Client::new();
    let response = match client.get(&translation_link).send().await {
        Ok(resp) => resp,
        Err(_) => return false,
    };

    let remote_ini_content = match response.text().await {
        Ok(text) => text,
        Err(_) => return false,
    };

    // Appliquer le branding StarTrad FR au contenu distant pour comparaison correcte
    let remote_ini_content = apply_startrad_branding(&remote_ini_content, &translation_link);

    // Normaliser les contenus
    let local_normalized = local_ini_content.replace("\r\n", "\n").trim().to_string();
    let remote_normalized = remote_ini_content.replace("\r\n", "\n").trim().to_string();

    // Comparer les contenus
    local_normalized == remote_normalized
}

/// Version async de update_translation pour le background service
pub async fn update_translation_async(
    path: String,
    lang: String,
    translation_link: String,
) -> Result<(), String> {
    let base_path = Path::new(&path);

    // Obtenir le nom du dossier de langue
    let lang_folder_name =
        get_language_folder(&lang).ok_or_else(|| "Langue non prise en charge".to_string())?;

    // Chemin vers le dossier de langue
    let lang_folder_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name);

    // Vérifier et créer le dossier de langue s'il n'existe pas
    if !lang_folder_path.exists() {
        fs::create_dir_all(&lang_folder_path)
            .map_err(|e| format!("Erreur lors de la création du dossier de langue: {}", e))?;
    }

    // Chemin vers le fichier 'global.ini' local
    let global_ini_path = lang_folder_path.join("global.ini");

    // Télécharger le fichier 'global.ini' depuis 'translation_link' (ASYNC)
    let client = reqwest::Client::new();
    let response = client
        .get(&translation_link)
        .send()
        .await
        .map_err(|e| format!("Erreur lors du téléchargement: {}", e))?;
    let content = response
        .text()
        .await
        .map_err(|e| format!("Erreur lors de la lecture de la réponse: {}", e))?;

    // Appliquer le branding StarTrad FR pour les traductions SCFRA
    let content = apply_startrad_branding(&content, &translation_link);

    // Écrire le contenu dans le fichier 'global.ini' local avec UTF-8 BOM
    let mut file = File::create(&global_ini_path)
        .map_err(|e| format!("Erreur lors de la création de 'global.ini': {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Erreur lors de l'écriture de 'global.ini': {}", e))?;

    Ok(())
}

// ============================================================================
// Installation depuis le cache (mode hors-ligne)
// ============================================================================

/// Installe une traduction depuis le cache local
#[command]
pub fn install_translation_from_cache(
    path: String,
    lang: String,
    cached_content: String,
) -> Result<(), String> {
    let base_path = Path::new(&path);

    // Vérifier et créer le dossier 'data'
    let data_path = base_path.join("data");
    if !data_path.exists() {
        fs::create_dir(&data_path)
            .map_err(|e| format!("Erreur lors de la création de 'data': {}", e))?;
    }

    // Vérifier et créer le dossier 'Localization'
    let localization_path = data_path.join("Localization");
    if !localization_path.exists() {
        fs::create_dir(&localization_path)
            .map_err(|e| format!("Erreur lors de la création de 'Localization': {}", e))?;
    }

    // Obtenir le nom du dossier de langue
    let lang_folder_name =
        get_language_folder(&lang).ok_or_else(|| "Langue non prise en charge".to_string())?;

    // Vérifier et créer le dossier de langue
    let lang_folder_path = localization_path.join(lang_folder_name);
    if !lang_folder_path.exists() {
        fs::create_dir(&lang_folder_path)
            .map_err(|e| format!("Erreur lors de la création du dossier de langue: {}", e))?;
    }

    // Écrire le fichier 'global.ini' avec UTF-8 BOM
    let global_ini_path = lang_folder_path.join("global.ini");
    let mut file = File::create(&global_ini_path)
        .map_err(|e| format!("Erreur lors de la création de 'global.ini': {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(cached_content.as_bytes()))
        .map_err(|e| format!("Erreur lors de l'écriture de 'global.ini': {}", e))?;

    // Créer ou mettre à jour 'user.cfg' à la racine
    let user_cfg_path = base_path.join("user.cfg");
    let mut file = File::create(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la création de 'user.cfg': {}", e))?;
    let cfg_content = format!(
        "g_language = {}\ng_languageAudio = english\n",
        lang_folder_name
    );
    file.write_all(cfg_content.as_bytes())
        .map_err(|e| format!("Erreur lors de l'écriture dans 'user.cfg': {}", e))?;

    Ok(())
}
