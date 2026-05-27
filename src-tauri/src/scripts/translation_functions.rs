use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use reqwest::blocking::Client;
use tauri::command;

use super::offline_cache::cache_translation_internal;

pub fn get_language_folder(lang: &str) -> Option<&str> {
    match lang.to_lowercase().as_str() {
        "zh_cn" | "chinese_(simplified)" => Some("chinese_(simplified)"),
        "zh_tw" | "chinese_(traditional)" => Some("chinese_(traditional)"),
        "en" | "english" => Some("english"),
        "fr" | "french_(france)" => Some("french_(france)"),
        "de" | "german_(germany)" => Some("german_(germany)"),
        "it" | "italian_(italy)" => Some("italian_(italy)"),
        "ja" | "japanese_(japan)" => Some("japanese_(japan)"),
        "ko" | "korean_(south_korea)" => Some("korean_(south_korea)"),
        "pl" | "polish_(poland)" => Some("polish_(poland)"),
        "pt_br" | "portuguese_(brazil)" => Some("portuguese_(brazil)"),
        "es_419" | "spanish_(latin_america)" => Some("spanish_(latin_america)"),
        "es" | "spanish_(spain)" => Some("spanish_(spain)"),
        _ => None,
    }
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Vrai/faux helper de matching ligne → "appartient à StarTrad ?".
///
/// Les 3 clés que StarTrad gère dans `user.cfg` :
///   - `Con_Restricted` (pour permettre la console SC)
///   - `g_language` (la langue active, ex: `french_(france)`)
///   - `g_languageAudio` (toujours `english`)
///
/// ⚠️ Attention au piège `g_language` vs `g_languageAudio` : on matche
/// `g_language ` (espace) OU `g_language=` pour ne PAS éliminer
/// `g_languageAudio` au passage.
fn is_startrad_managed_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("Con_Restricted")
        || trimmed.starts_with("g_language ")
        || trimmed.starts_with("g_language=")
        || trimmed.starts_with("g_languageAudio")
}

/// Écrit les 3 lignes StarTrad dans `user.cfg` en mode **merge** (pas replace).
///
/// Avant ce refactor : `File::create` truncate + écrit les 3 lignes →
/// écrasement complet du fichier user (perte des optims Vulkan persos,
/// settings custom, etc.). Voir thread Discord dolbyfr 2026-05-19.
///
/// Maintenant : pattern read-modify-write aligné sur
/// `graphics_settings.rs::set_user_cfg_resolution` qui tourne en prod depuis
/// des mois sans casser de configs user. Étapes :
///   1. Lecture de l'existant (ou string vide si fichier absent).
///   2. **Backup** vers `user.cfg.startrad-bak` (filet de sécu, écrasé à
///      chaque appel pour pas accumuler de fichiers).
///   3. Filter out les 3 lignes managed par StarTrad (peu importe où elles
///      étaient — début/milieu/fin).
///   4. Append les 3 lignes managed après la dernière ligne non-vide.
///   5. Réécriture du fichier complet.
///
/// Tout ce qui n'est pas dans les 3 clés StarTrad est **préservé tel quel**.
fn write_user_cfg(base_path: &Path, lang_folder_name: &str) -> Result<(), String> {
    let user_cfg_path = base_path.join("user.cfg");

    // 1. Lire l'existant
    let existing_content = if user_cfg_path.exists() {
        fs::read_to_string(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la lecture de 'user.cfg': {}", e))?
    } else {
        String::new()
    };

    // 2. Backup auto (silencieux, écrase le précédent) — filet si on rate
    if user_cfg_path.exists() {
        let backup_path = base_path.join("user.cfg.startrad-bak");
        let _ = fs::write(&backup_path, &existing_content);
    }

    // 3. Filter out les 3 lignes managed
    let mut lines: Vec<String> = existing_content.lines().map(String::from).collect();
    lines.retain(|line| !is_startrad_managed_line(line));

    // 4. Trouver le point d'insertion : après la dernière ligne non-vide
    let mut insert_index = lines.len();
    for (i, line) in lines.iter().enumerate().rev() {
        if !line.trim().is_empty() {
            insert_index = i + 1;
            break;
        }
    }

    // 5. Insérer les 3 lignes managed (ordre historique préservé)
    let managed_lines = vec![
        "Con_Restricted = 0".to_string(),
        format!("g_language = {}", lang_folder_name),
        "g_languageAudio = english".to_string(),
    ];
    for (i, l) in managed_lines.iter().enumerate() {
        lines.insert(insert_index + i, l.clone());
    }

    // 6. Reconstruire et écrire (newline final pour cohérence avec convention Unix)
    let mut new_content = lines.join("\n");
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    fs::write(&user_cfg_path, new_content)
        .map_err(|e| format!("Erreur lors de l'écriture dans 'user.cfg': {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_startrad_managed_line ──────────────────────────────────────────
    // Garde-fou critique : ces tests doivent rester verts. Si on ajoute une
    // nouvelle clé que StarTrad gère, l'ajouter ici ET dans is_startrad_managed_line.

    #[test]
    fn managed_lines_are_detected() {
        assert!(is_startrad_managed_line("Con_Restricted = 0"));
        assert!(is_startrad_managed_line("g_language = french_(france)"));
        assert!(is_startrad_managed_line("g_language=french_(france)"));  // sans espace
        assert!(is_startrad_managed_line("g_languageAudio = english"));
        assert!(is_startrad_managed_line("  Con_Restricted = 0  "));  // avec spaces
    }

    #[test]
    fn user_lines_are_preserved() {
        // Optims Vulkan (cas dolbyfr)
        assert!(!is_startrad_managed_line("r.LowEndGPU = 1"));
        assert!(!is_startrad_managed_line("r.VulkanBuffering = 0"));
        assert!(!is_startrad_managed_line("r.graphicsRenderer = Vulkan"));
        // Résolution (gérée par graphics_settings, pas par translation)
        assert!(!is_startrad_managed_line("r_width = 2560"));
        assert!(!is_startrad_managed_line("r_height = 1440"));
        // Settings divers
        assert!(!is_startrad_managed_line("sys_MaxFps = 60"));
        assert!(!is_startrad_managed_line("r_MotionBlur = 0"));
        // Commentaires + lignes vides
        assert!(!is_startrad_managed_line("// Mon commentaire"));
        assert!(!is_startrad_managed_line("-- Tiret commentaire"));
        assert!(!is_startrad_managed_line(""));
        assert!(!is_startrad_managed_line("   "));
    }

    #[test]
    fn g_language_vs_g_language_audio_no_false_positive() {
        // Piège : starts_with("g_language") attraperait g_languageAudio aussi.
        // On utilise "g_language " (avec espace) OU "g_language=" pour éviter ça.
        assert!(is_startrad_managed_line("g_language = french_(france)"));
        assert!(is_startrad_managed_line("g_languageAudio = english"));
        // Les deux DOIVENT matcher (ce sont nos lignes), mais une ligne user
        // qui commencerait par "g_languageFoo" (hypothétique) ne doit pas matcher :
        assert!(!is_startrad_managed_line("g_languageFoo = bar"));
    }

    // ── write_user_cfg via tempdir ────────────────────────────────────────
    // Test de bout en bout du pattern read-modify-write avec un faux user.cfg
    // qui simule le cas dolbyfr (lignes Vulkan persos + 3 lignes StarTrad).

    fn fresh_tmp_dir() -> std::path::PathBuf {
        // std::env::temp_dir + nano timestamp + pid pour unicité (pas de tempfile dep).
        let unique = format!(
            "startrad-user-cfg-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_user_cfg_preserves_user_lines() {
        let dir = fresh_tmp_dir();
        let cfg = dir.join("user.cfg");

        // État pré-fix : user.cfg avec lignes Vulkan persos + 3 StarTrad
        let initial = "r.LowEndGPU = 1\nr.VulkanBuffering = 0\nsys_MaxFps = 60\nCon_Restricted = 0\ng_language = french_(france)\ng_languageAudio = english\n";
        fs::write(&cfg, initial).unwrap();

        write_user_cfg(&dir, "french_(france)").unwrap();

        let result = fs::read_to_string(&cfg).unwrap();
        // Les 3 lignes Vulkan persos DOIVENT être préservées (le bug à fixer)
        assert!(result.contains("r.LowEndGPU = 1"), "r.LowEndGPU perdu !");
        assert!(result.contains("r.VulkanBuffering = 0"), "r.VulkanBuffering perdu !");
        assert!(result.contains("sys_MaxFps = 60"), "sys_MaxFps perdu !");
        // Les 3 lignes StarTrad doivent être présentes (refactor cohérent)
        assert!(result.contains("Con_Restricted = 0"));
        assert!(result.contains("g_language = french_(france)"));
        assert!(result.contains("g_languageAudio = english"));
        // Pas de duplication des lignes managed
        assert_eq!(result.matches("Con_Restricted = 0").count(), 1);
        assert_eq!(result.matches("g_language = french_(france)").count(), 1);

        // Backup présent
        assert!(dir.join("user.cfg.startrad-bak").exists(), "Backup manquant");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_user_cfg_creates_fresh_file() {
        let dir = fresh_tmp_dir();
        let cfg = dir.join("user.cfg");
        // Pas de fichier initial

        write_user_cfg(&dir, "french_(france)").unwrap();

        assert!(cfg.exists());
        let result = fs::read_to_string(&cfg).unwrap();
        assert!(result.contains("Con_Restricted = 0"));
        assert!(result.contains("g_language = french_(france)"));
        assert!(result.contains("g_languageAudio = english"));
        // Pas de backup parce que le fichier n'existait pas
        assert!(!dir.join("user.cfg.startrad-bak").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_user_cfg_replaces_old_language() {
        let dir = fresh_tmp_dir();
        let cfg = dir.join("user.cfg");
        // Cas user qui change de langue : ancienne langue dans user.cfg
        fs::write(&cfg, "r.MaPersoLine = 1\nCon_Restricted = 0\ng_language = english\ng_languageAudio = english\n").unwrap();

        write_user_cfg(&dir, "french_(france)").unwrap();

        let result = fs::read_to_string(&cfg).unwrap();
        assert!(result.contains("g_language = french_(france)"), "Nouvelle langue absente");
        assert!(!result.contains("g_language = english"), "Ancienne langue toujours là (devrait être remplacée)");
        assert!(result.contains("r.MaPersoLine = 1"), "Ligne perso perdue");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_user_cfg_preserves_user_lines() {
        let dir = fresh_tmp_dir();
        let cfg = dir.join("user.cfg");
        fs::write(&cfg, "r.LowEndGPU = 1\nCon_Restricted = 0\ng_language = french_(france)\ng_languageAudio = english\n").unwrap();

        strip_user_cfg(&dir).unwrap();

        let result = fs::read_to_string(&cfg).unwrap();
        assert!(result.contains("r.LowEndGPU = 1"), "Vulkan perdu à l'uninstall !");
        assert!(!result.contains("Con_Restricted"), "StarTrad pas retiré");
        assert!(!result.contains("g_language"), "StarTrad pas retiré");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_user_cfg_deletes_file_when_empty() {
        let dir = fresh_tmp_dir();
        let cfg = dir.join("user.cfg");
        // Que des lignes StarTrad → après strip → vide → delete
        fs::write(&cfg, "Con_Restricted = 0\ng_language = french_(france)\ng_languageAudio = english\n").unwrap();

        strip_user_cfg(&dir).unwrap();

        assert!(!cfg.exists(), "Fichier devrait être supprimé (rien d'user à garder)");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_user_cfg_noop_when_missing() {
        let dir = fresh_tmp_dir();
        // Pas de user.cfg
        let result = strip_user_cfg(&dir);
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&dir);
    }
}

/// Retire UNIQUEMENT les 3 lignes managed par StarTrad de `user.cfg`,
/// préserve tout le reste. Si après strip le fichier devient vide ou ne
/// contient que des espaces, on supprime le fichier (cohérent avec l'ancien
/// comportement de `uninstall_translation` qui faisait `fs::remove_file`).
/// Sinon on garde le résiduel intact.
///
/// Backup vers `user.cfg.startrad-bak` avant strip (filet de sécu).
fn strip_user_cfg(base_path: &Path) -> Result<(), String> {
    let user_cfg_path = base_path.join("user.cfg");
    if !user_cfg_path.exists() {
        return Ok(());
    }

    let existing_content = fs::read_to_string(&user_cfg_path)
        .map_err(|e| format!("Erreur lors de la lecture de 'user.cfg': {}", e))?;

    // Backup auto avant strip
    let backup_path = base_path.join("user.cfg.startrad-bak");
    let _ = fs::write(&backup_path, &existing_content);

    let stripped: Vec<String> = existing_content
        .lines()
        .filter(|line| !is_startrad_managed_line(line))
        .map(String::from)
        .collect();

    // Si le reste est vide ou ne contient que des lignes vides → delete
    if stripped.iter().all(|l| l.trim().is_empty()) {
        fs::remove_file(&user_cfg_path)
            .map_err(|e| format!("Erreur lors de la suppression de 'user.cfg': {}", e))?;
    } else {
        let mut new_content = stripped.join("\n");
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        fs::write(&user_cfg_path, new_content)
            .map_err(|e| format!("Erreur lors de l'écriture dans 'user.cfg': {}", e))?;
    }

    Ok(())
}

/// Applique le branding StarTrad FR directement sur le contenu (sans vérifier le lien)
fn apply_startrad_branding_direct(content: &str) -> String {
    // Remplacer tous les "Multitool" par "StarTrad FR" (SCEFRA)
    let result = content.replace("Multitool", "StarTrad FR");

    // Remplacer les mentions Discord SCEFRA par le contact StarTrad FR
    let result = result.replace(
        "Discord SCEFRA (SCEFRA sur StarTrad FR)",
        "Discord pseudo drrakendu78 ou sur discord.startrad.link",
    );

    // Branding Circuspes (commentaire en haut du fichier)
    let result = result.replace(
        "; Lien pour télécharger le fichier et informations : https://traduction.circuspes.fr/download/",
        "; Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78"
    );

    // Branding Circuspes (texte dans le jeu)
    let result = result.replace(
        "Initiative de traduction communautaire francophone",
        "Téléchargé via StarTrad FR (Traduction Circuspes) - Besoin d'aide ? Discord: drrakendu78",
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

    let lang_folder_name =
        get_language_folder(&lang).ok_or_else(|| "Langue non prise en charge".to_string())?;

    let global_ini_path = base_path
        .join("data")
        .join("Localization")
        .join(lang_folder_name)
        .join("global.ini");

    if !global_ini_path.is_file() {
        return Ok(false); // Fichier non trouvé, rien à faire
    }

    // Lire le fichier
    let mut content_bytes =
        fs::read(&global_ini_path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Retirer le BOM si présent
    if content_bytes.starts_with(UTF8_BOM) {
        content_bytes = content_bytes[UTF8_BOM.len()..].to_vec();
    }

    let content = String::from_utf8(content_bytes).map_err(|e| format!("Erreur UTF-8: {}", e))?;

    // Vérifier si le branding est nécessaire
    if !needs_branding(&content) {
        return Ok(false);
    }

    // Appliquer le branding
    let new_content = apply_startrad_branding_direct(&content);

    // Réécrire le fichier avec BOM
    let mut file = File::create(&global_ini_path).map_err(|e| format!("Erreur création: {}", e))?;
    file.write_all(UTF8_BOM)
        .and_then(|_| file.write_all(new_content.as_bytes()))
        .map_err(|e| format!("Erreur écriture: {}", e))?;

    Ok(true)
}

/// Applique le branding StarTrad FR selon la source de traduction
fn apply_startrad_branding(content: &str, translation_link: &str) -> String {
    let is_scefra =
        translation_link.to_lowercase().contains("scefra") || translation_link.contains("SPEED0U");
    let is_circuspes = translation_link.to_lowercase().contains("circuspes");

    let mut result = content.to_string();

    // Branding SCEFRA: remplacer tous les "Multitool" par "StarTrad FR"
    if is_scefra {
        result = result.replace("Multitool", "StarTrad FR");
        // Remplacer les mentions Discord SCEFRA par le contact StarTrad FR
        result = result.replace(
            "Discord SCEFRA (SCEFRA sur StarTrad FR)",
            "Discord pseudo drrakendu78 ou sur discord.startrad.link",
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

    // Créer ou mettre à jour 'user.cfg' à la racine — via le helper qui
    // préserve les autres lignes (optims Vulkan, settings perso).
    write_user_cfg(base_path, lang_folder_name)?;

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

    write_user_cfg(base_path, lang_folder_name)?;

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

    // Retirer UNIQUEMENT les 3 lignes managed par StarTrad. Si l'user avait
    // d'autres lignes (optims Vulkan, settings perso), elles sont préservées.
    // Si le fichier devient vide après strip, strip_user_cfg le supprime
    // (cohérent avec l'ancien comportement).
    strip_user_cfg(base_path)?;

    Ok(())
}

// ============================================================================
// Versions ASYNC pour le background service (évite les conflits avec Tokio)
// ============================================================================

/// Version async de is_translation_up_to_date pour le background service
pub async fn is_translation_up_to_date_async(
    path: String,
    translation_link: String,
    lang: String,
) -> bool {
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

    write_user_cfg(base_path, lang_folder_name)?;

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

    // Créer ou mettre à jour 'user.cfg' à la racine — via le helper qui
    // préserve les autres lignes (optims Vulkan, settings perso).
    write_user_cfg(base_path, lang_folder_name)?;

    Ok(())
}
