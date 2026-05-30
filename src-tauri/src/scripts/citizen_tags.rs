// Storage des tags utilisateur sur les joueurs croisés en jeu.
//
// L'utilisateur peut tagger n'importe quel joueur croisé comme :
//   - Friend (ami) : surligné en vert dans le carnet
//   - Org (orgmate) : surligné en bleu
//   - Enemy (rival) : surligné en rouge
//
// + une note libre par joueur (ex "rencontré sur Pyro le 14 mai").
//
// Données stockées dans `app_config_dir/citizen_tags.json`, format :
//   { schemaVersion: 1, tags: { "handle_lowercase": { tag, note, markedAt } } }
//
// Privacy : 100% local. Aucun upload, aucun partage tiers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const TAGS_FILENAME: &str = "citizen_tags.json";
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TagKind {
    Friend,
    Org,
    Enemy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitizenTag {
    pub handle: String,
    pub tag: TagKind,
    pub note: Option<String>,
    pub marked_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagsFile {
    schema_version: u32,
    tags: HashMap<String, CitizenTag>, // key = handle lowercased
}

impl Default for TagsFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            tags: HashMap::new(),
        }
    }
}

fn tags_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Impossible d'obtenir app_config_dir : {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {}: {e}", dir.display()))?;
    Ok(dir.join(TAGS_FILENAME))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_tags<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> TagsFile {
    let path = match tags_path(app) {
        Ok(p) => p,
        Err(_) => return TagsFile::default(),
    };
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return TagsFile::default(),
    };
    match serde_json::from_str::<TagsFile>(&raw) {
        Ok(f) if f.schema_version == SCHEMA_VERSION => f,
        _ => TagsFile::default(),
    }
}

fn save_tags<R: tauri::Runtime>(app: &tauri::AppHandle<R>, tags: &TagsFile) -> Result<(), String> {
    let path = tags_path(app)?;
    let json = serde_json::to_string_pretty(tags).map_err(|e| format!("Sérialisation : {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Écriture {} : {e}", path.display()))
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn citizen_tag_set<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    handle: String,
    tag: TagKind,
    note: Option<String>,
) -> Result<CitizenTag, String> {
    if handle.trim().is_empty() {
        return Err("Handle vide".into());
    }
    let mut file = load_tags(&app);
    let key = handle.to_lowercase();
    let entry = CitizenTag {
        handle: handle.clone(),
        tag,
        note,
        marked_at: now_secs(),
    };
    file.tags.insert(key, entry.clone());
    save_tags(&app, &file)?;
    Ok(entry)
}

#[tauri::command]
pub async fn citizen_tag_remove<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    handle: String,
) -> Result<bool, String> {
    let mut file = load_tags(&app);
    let removed = file.tags.remove(&handle.to_lowercase()).is_some();
    if removed {
        save_tags(&app, &file)?;
    }
    Ok(removed)
}

#[tauri::command]
pub async fn citizen_tag_list<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<CitizenTag>, String> {
    let file = load_tags(&app);
    let mut tags: Vec<_> = file.tags.into_values().collect();
    tags.sort_by(|a, b| b.marked_at.cmp(&a.marked_at));
    Ok(tags)
}

pub fn get_tag_for_handle<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    handle: &str,
) -> Option<CitizenTag> {
    let file = load_tags(app);
    file.tags.get(&handle.to_lowercase()).cloned()
}
