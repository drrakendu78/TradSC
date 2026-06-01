// Saisie manuelle du Carnet de bord : coéquipiers + morts ajoutés à la main.
//
// Contexte : depuis fin 2025, Star Citizen ne journalise plus les kills/morts
// ni le pseudo de tous les coéquipiers (mesure anti‑stalking de CIG). La saisie
// manuelle permet à l'utilisateur de récupérer ces infos perdues.
//
// Le store est un fichier JSON SÉPARÉ du scan des logs (`carnet_manuel.json`),
// donc un re-scan des Game.log ne l'écrase JAMAIS. Même pattern que
// `gamelog_blueprints.json` (cf. gamelog_blueprint_watcher.rs).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::path::PathResolver;
use tauri::{command, AppHandle, Manager, Runtime};

const SCHEMA_VERSION: u32 = 1;

// ── Types persistés ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTeammate {
    pub id: String,
    pub handle: String,
    #[serde(default)]
    pub note: Option<String>,
    /// Epoch secondes : date d'ajout dans le carnet.
    pub added_ts: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualDeath {
    pub id: String,
    /// Epoch secondes : date de la mort (peut être approximative).
    pub ts: f64,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub killer: Option<String>,
    /// "joueur" | "pnj" | "accident" | "autre".
    pub cause: String,
    #[serde(default)]
    pub ship: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// Epoch secondes : date d'ajout dans le carnet.
    pub added_ts: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualStoreFile {
    pub schema_version: u32,
    #[serde(default)]
    pub teammates: Vec<ManualTeammate>,
    #[serde(default)]
    pub deaths: Vec<ManualDeath>,
}

impl Default for ManualStoreFile {
    fn default() -> Self {
        Self { schema_version: SCHEMA_VERSION, teammates: Vec::new(), deaths: Vec::new() }
    }
}

// ── Paths ──────────────────────────────────────────────────────────────────

fn ensure_config_dir(path: &PathResolver<impl Runtime>) -> Result<PathBuf, String> {
    let dir = path
        .app_config_dir()
        .map_err(|_| "Impossible d'obtenir app_config_dir".to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn store_path(path: &PathResolver<impl Runtime>) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(path)?.join("carnet_manuel.json"))
}

// ── Store I/O ──────────────────────────────────────────────────────────────

pub fn load_store(app: &AppHandle) -> Result<ManualStoreFile, String> {
    let p = store_path(app.path())?;
    if !p.exists() {
        return Ok(ManualStoreFile::default());
    }
    let json = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn save_store(app: &AppHandle, store: &ManualStoreFile) -> Result<(), String> {
    let p = store_path(app.path())?;
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[command]
pub fn carnet_manual_load(app: AppHandle) -> Result<ManualStoreFile, String> {
    load_store(&app)
}

/// Écrit l'intégralité du store (le front gère add/remove puis renvoie le tout).
/// Retourne le store persisté (schema_version normalisé) pour resync front.
#[command]
pub fn carnet_manual_save(app: AppHandle, store: ManualStoreFile) -> Result<ManualStoreFile, String> {
    let mut store = store;
    store.schema_version = SCHEMA_VERSION;
    save_store(&app, &store)?;
    Ok(store)
}
