// Auto-détection des blueprints débloqués via tail du Game.log de Star Citizen.
//
// Méthode : lecture passive du fichier texte que le jeu écrit (zéro hook, zéro
// injection, zéro risque de ban). On parse les lignes de notification
// "Schémas reçu : <nom>:" (FR) et "Received Blueprint: <nom>:" (EN).
//
// Inspiré de Onivoid/MultitoolV2 (gamelog_watcher.rs), simplifié pour v1 :
// pas de corrélation mission ↔ blueprint (gardé pour plus tard si utile).

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::path::PathResolver;
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State};

use crate::scripts::gamepath::get_star_citizen_versions;

const TAIL_POLL_INTERVAL: Duration = Duration::from_millis(200);
const SCHEMA_VERSION: u32 = 1;

// ── Types persistés ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintEntry {
    pub product_name: String,
    pub ts: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintStoreFile {
    pub schema_version: u32,
    pub blueprints: Vec<BlueprintEntry>,
}

impl Default for BlueprintStoreFile {
    fn default() -> Self {
        Self { schema_version: SCHEMA_VERSION, blueprints: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherConfig {
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub enabled: bool,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        Self { auto_start: false, enabled: false }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStatus {
    pub watching: bool,
    pub log_path: Option<String>,
    pub blueprint_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub total: usize,
    pub files_scanned: usize,
    pub matches_found: usize,
    pub files_with_matches: usize,
    pub unique_products_found: usize,
    pub files_failed: usize,
    pub log_directory: String,
    pub game_log_path: String,
    pub read_errors: Vec<String>,
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
    Ok(ensure_config_dir(path)?.join("gamelog_blueprints.json"))
}

fn config_path(path: &PathResolver<impl Runtime>) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(path)?.join("gamelog_watcher.json"))
}

/// Retourne le chemin du Game.log de la version LIVE (ou la première dispo si LIVE absent).
fn get_live_game_log_path() -> Result<PathBuf, String> {
    let versions = get_star_citizen_versions();
    if versions.versions.is_empty() {
        return Err("Aucune installation Star Citizen détectée".to_string());
    }
    let install_path = versions
        .versions
        .get("LIVE")
        .or_else(|| versions.versions.values().next())
        .ok_or_else(|| "Aucune version SC trouvée".to_string())?
        .path
        .clone();
    let log = PathBuf::from(install_path).join("Game.log");
    Ok(log)
}

// ── Store I/O ──────────────────────────────────────────────────────────────

pub fn load_store(app: &AppHandle) -> Result<BlueprintStoreFile, String> {
    let p = store_path(app.path())?;
    if !p.exists() {
        return Ok(BlueprintStoreFile::default());
    }
    let json = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn save_store(app: &AppHandle, store: &BlueprintStoreFile) -> Result<(), String> {
    let p = store_path(app.path())?;
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

pub fn load_config(app: &AppHandle) -> Result<WatcherConfig, String> {
    let p = config_path(app.path())?;
    if !p.exists() {
        return Ok(WatcherConfig::default());
    }
    let json = fs::read_to_string(p).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn save_config(app: &AppHandle, config: &WatcherConfig) -> Result<(), String> {
    let p = config_path(app.path())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

/// Garde la première occurrence par product_name (ts le plus ancien).
fn merge(existing: &[BlueprintEntry], incoming: &[BlueprintEntry]) -> (Vec<BlueprintEntry>, usize) {
    let mut by_name: HashMap<String, BlueprintEntry> = HashMap::new();
    for e in existing {
        by_name.insert(e.product_name.clone(), e.clone());
    }
    let mut added = 0;
    for e in incoming {
        match by_name.get(&e.product_name) {
            None => {
                by_name.insert(e.product_name.clone(), e.clone());
                added += 1;
            }
            Some(cur) if e.ts < cur.ts => {
                by_name.insert(e.product_name.clone(), e.clone());
            }
            _ => {}
        }
    }
    let mut merged: Vec<BlueprintEntry> = by_name.into_values().collect();
    merged.sort_by(|a, b| b.ts.partial_cmp(&a.ts).unwrap_or(std::cmp::Ordering::Equal));
    (merged, added)
}

fn append(app: &AppHandle, incoming: &[BlueprintEntry]) -> Result<usize, String> {
    let mut store = load_store(app)?;
    let (merged, added) = merge(&store.blueprints, incoming);
    store.blueprints = merged;
    save_store(app, &store)?;
    Ok(added)
}

// ── Log parsing ────────────────────────────────────────────────────────────

fn parse_ts(line: &str) -> Option<f64> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"<(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)>").unwrap());
    let caps = re.captures(line)?;
    let raw = caps.get(1)?.as_str().replace('Z', "+00:00");
    DateTime::parse_from_rfc3339(&raw)
        .ok()
        .map(|dt| dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0)
}

fn blueprint_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:Received Blueprint: (.+?):|Sch[eé]mas? reçus? : (.+?):)").unwrap()
    })
}

fn extract_product_name(line: &str) -> Option<String> {
    let caps = blueprint_pattern().captures(line)?;
    let m = caps.get(1).or_else(|| caps.get(2))?;
    Some(m.as_str().trim().to_string())
}

fn read_lossy(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Lecture {}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn scan_file(path: &Path) -> Result<Vec<BlueprintEntry>, String> {
    let mut out = Vec::new();
    let content = read_lossy(path)?;
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        if let Some(name) = extract_product_name(line) {
            let ts = parse_ts(line).unwrap_or(0.0);
            out.push(BlueprintEntry { product_name: name, ts });
        }
    }
    Ok(out)
}

// ── Thread tailer ──────────────────────────────────────────────────────────

/// Émet un événement de log visible côté UI. Les events `gamelog-watcher:log`
/// alimentent le feed temps réel ("Activité") de la Card frontend.
fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "gamelog-watcher:log",
        serde_json::json!({
            "level": level,
            "message": message.into(),
            "ts": Utc::now().timestamp_millis(),
        }),
    );
}

fn run_tailer(app: AppHandle, log_path: PathBuf, stop: Arc<AtomicBool>) {
    let mut file: Option<File> = None;
    let mut last_size: u64 = 0;
    let mut buffer: Vec<u8> = Vec::new();
    let mut first_open = true;
    let mut emitted_missing = false;

    emit_log(
        &app,
        "info",
        format!("Surveillance démarrée sur {}", log_path.display()),
    );

    while !stop.load(Ordering::Relaxed) {
        let meta = match fs::metadata(&log_path) {
            Ok(m) => m,
            Err(_) => {
                if !emitted_missing {
                    emit_log(
                        &app,
                        "warn",
                        "Game.log introuvable — en attente du lancement de Star Citizen",
                    );
                    emitted_missing = true;
                }
                file = None;
                last_size = 0;
                buffer.clear();
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        if emitted_missing {
            emit_log(&app, "info", "Game.log retrouvé, reprise de la surveillance");
            emitted_missing = false;
        }

        let current_size = meta.len();
        let rotated = file.is_none() || current_size < last_size;

        if rotated {
            let was_open = file.is_some();
            match File::open(&log_path) {
                Ok(mut f) => {
                    if !first_open {
                        let _ = f.seek(SeekFrom::Start(0));
                    }
                    file = Some(f);
                    last_size = 0;
                    buffer.clear();
                    first_open = false;
                    if was_open {
                        emit_log(&app, "info", "Rotation du Game.log détectée, lecture depuis le début");
                    }
                }
                Err(e) => {
                    emit_log(&app, "warn", format!("Impossible d'ouvrir Game.log : {e}"));
                    file = None;
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
            }
        }

        let Some(f) = file.as_mut() else {
            thread::sleep(TAIL_POLL_INTERVAL);
            continue;
        };

        let mut chunk = Vec::new();
        match f.read_to_end(&mut chunk) {
            Ok(0) => {
                thread::sleep(TAIL_POLL_INTERVAL);
                continue;
            }
            Ok(_) => {}
            Err(e) => {
                emit_log(&app, "error", format!("Lecture du Game.log a échoué : {e}"));
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        }

        buffer.extend_from_slice(&chunk);
        while let Some(pos) = buffer.iter().rposition(|&b| b == b'\n') {
            let block: Vec<u8> = buffer.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&block);
            for line in text.lines() {
                if line.is_empty() {
                    continue;
                }
                if let Some(name) = extract_product_name(line) {
                    let ts = parse_ts(line).unwrap_or_else(|| Utc::now().timestamp() as f64);
                    let entry = BlueprintEntry { product_name: name.clone(), ts };
                    match append(&app, &[entry.clone()]) {
                        Ok(added) => {
                            if added > 0 {
                                emit_log(
                                    &app,
                                    "success",
                                    format!("Nouveau schéma détecté : {name}"),
                                );
                                let _ = app.emit("gamelog-watcher:blueprint", &entry);
                            }
                        }
                        Err(e) => emit_log(&app, "error", format!("Sauvegarde échouée : {e}")),
                    }
                }
            }
        }
        last_size = current_size;
    }

    emit_log(&app, "info", "Surveillance arrêtée");
}

// ── State ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct GamelogWatcherState {
    pub is_running: Arc<Mutex<bool>>,
    stop_flag: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    thread_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl Default for GamelogWatcherState {
    fn default() -> Self {
        Self {
            is_running: Arc::new(Mutex::new(false)),
            stop_flag: Arc::new(Mutex::new(None)),
            thread_handle: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn start_internal(state: &GamelogWatcherState, app: AppHandle) -> Result<(), String> {
    {
        let running = state.is_running.lock().map_err(|e| e.to_string())?;
        if *running {
            return Err("La surveillance du Game.log est déjà active".to_string());
        }
    }

    let log_path = get_live_game_log_path()?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);
    let app_clone = app.clone();

    let handle = thread::Builder::new()
        .name("gamelog-bp-watcher".into())
        .spawn(move || run_tailer(app_clone, log_path, stop_clone))
        .map_err(|e| e.to_string())?;

    *state.is_running.lock().map_err(|e| e.to_string())? = true;
    *state.stop_flag.lock().map_err(|e| e.to_string())? = Some(stop);
    *state.thread_handle.lock().map_err(|e| e.to_string())? = Some(handle);

    let mut cfg = load_config(&app)?;
    cfg.enabled = true;
    save_config(&app, &cfg)?;

    // Notifie tous les frontends (page Blueprints, overlay détaché,
    // sidebar Paramètres, etc.) que le watcher a changé d'état, pour
    // qu'ils refresh leur affichage sans avoir besoin d'un poll.
    let _ = app.emit("gamelog-watcher:status_changed", true);

    Ok(())
}

fn stop_internal(state: &GamelogWatcherState, app: &AppHandle) -> Result<(), String> {
    {
        let running = state.is_running.lock().map_err(|e| e.to_string())?;
        if !*running {
            return Ok(());
        }
    }

    let stop = state.stop_flag.lock().map_err(|e| e.to_string())?.clone();
    if let Some(stop) = stop {
        stop.store(true, Ordering::Relaxed);
    }

    if let Ok(mut guard) = state.thread_handle.lock() {
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    *state.is_running.lock().map_err(|e| e.to_string())? = false;
    *state.stop_flag.lock().map_err(|e| e.to_string())? = None;

    let mut cfg = load_config(app)?;
    cfg.enabled = false;
    save_config(app, &cfg)?;

    // Cf. start_internal — notifie les frontends de la transition.
    let _ = app.emit("gamelog-watcher:status_changed", false);

    Ok(())
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[command]
pub fn gamelog_blueprints_load(app: AppHandle) -> Result<BlueprintStoreFile, String> {
    load_store(&app)
}

#[command]
pub fn gamelog_watcher_load_config(app: AppHandle) -> Result<WatcherConfig, String> {
    load_config(&app)
}

#[command]
pub fn gamelog_watcher_save_config(app: AppHandle, config: WatcherConfig) -> Result<(), String> {
    save_config(&app, &config)
}

#[command]
pub fn gamelog_watcher_status(
    app: AppHandle,
    state: State<'_, GamelogWatcherState>,
) -> Result<WatcherStatus, String> {
    let watching = *state.is_running.lock().map_err(|e| e.to_string())?;
    let log_path = get_live_game_log_path().ok().map(|p| p.to_string_lossy().into_owned());
    let store = load_store(&app)?;
    Ok(WatcherStatus { watching, log_path, blueprint_count: store.blueprints.len() })
}

#[command]
pub async fn gamelog_watcher_start(
    app: AppHandle,
    state: State<'_, GamelogWatcherState>,
) -> Result<(), String> {
    start_internal(state.inner(), app)
}

#[command]
pub async fn gamelog_watcher_stop(
    app: AppHandle,
    state: State<'_, GamelogWatcherState>,
) -> Result<(), String> {
    stop_internal(state.inner(), &app)
}

#[command]
pub async fn gamelog_blueprints_import_history(
    app: AppHandle,
    include_current: Option<bool>,
) -> Result<ImportResult, String> {
    let include_current = include_current.unwrap_or(false);
    let game_log = get_live_game_log_path()?;
    let game_log_path = game_log.display().to_string();
    let logbackups = game_log.parent().unwrap().join("logbackups");
    if !logbackups.is_dir() {
        return Err(format!("Dossier logbackups introuvable : {}", logbackups.display()));
    }

    let mut files: Vec<PathBuf> = fs::read_dir(&logbackups)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("log"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();

    if include_current && game_log.is_file() && !files.iter().any(|p| p == &game_log) {
        files.push(game_log.clone());
    }

    if files.is_empty() {
        return Err(format!(
            "Aucun fichier .log dans logbackups ({}) ni Game.log ({})",
            logbackups.display(),
            game_log_path
        ));
    }

    let mut all_incoming = Vec::new();
    let mut read_errors = Vec::new();
    let mut files_failed = 0;
    let mut files_with_matches = 0;
    for path in &files {
        match scan_file(path) {
            Ok(found) => {
                if !found.is_empty() {
                    files_with_matches += 1;
                    all_incoming.extend(found);
                }
            }
            Err(e) => {
                files_failed += 1;
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string());
                read_errors.push(format!("{name}: {e}"));
            }
        }
    }

    let matches_found = all_incoming.len();
    let unique_products_found = all_incoming
        .iter()
        .map(|e| e.product_name.as_str())
        .collect::<HashSet<_>>()
        .len();
    let added = append(&app, &all_incoming)?;
    let store_after = load_store(&app)?;

    Ok(ImportResult {
        imported: added,
        total: store_after.blueprints.len(),
        files_scanned: files.len(),
        matches_found,
        files_with_matches,
        unique_products_found,
        files_failed,
        log_directory: logbackups.display().to_string(),
        game_log_path,
        read_errors: read_errors.into_iter().take(5).collect(),
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_french_notification() {
        let line = r#"<2026-05-16T11:56:52.707Z> [Notice] <SHUDEvent_OnNotification> Added notification "Schémas reçu : Jambes Morozov-SH Thule: " [41] to queue."#;
        let name = extract_product_name(line).unwrap();
        assert_eq!(name, "Jambes Morozov-SH Thule");
    }

    #[test]
    fn matches_english_notification() {
        let line = r#"Added notification "Received Blueprint: Morozov Legs: " [41] to queue"#;
        let name = extract_product_name(line).unwrap();
        assert_eq!(name, "Morozov Legs");
    }

    #[test]
    fn merge_dedupes_by_name_keeps_oldest_ts() {
        let existing = vec![BlueprintEntry { product_name: "A".into(), ts: 100.0 }];
        let incoming = vec![
            BlueprintEntry { product_name: "A".into(), ts: 50.0 },
            BlueprintEntry { product_name: "B".into(), ts: 200.0 },
        ];
        let (merged, added) = merge(&existing, &incoming);
        assert_eq!(added, 1);
        assert_eq!(merged.len(), 2);
        let a = merged.iter().find(|e| e.product_name == "A").unwrap();
        assert_eq!(a.ts, 50.0);
    }
}
