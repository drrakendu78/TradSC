#![allow(dead_code)] // wire-up prod en cours, utilisé pour l'instant via le bench

// Catalogue des vaisseaux SC via Fleetyards (api.fleetyards.net).
//
// API publique sans clé, JSON propre, à jour avec les patches SC.
// On fetch une fois tous les vaisseaux puis cache local TTL 7 jours.
//
// Stratégie pour le carnet :
//   - Lookup `ship_info("RSI_Perseus")` (canonical) → ShipInfo { name, manufacturer, classification, focus }
//   - `ship_role(...)` → catégorie principale (Combat/Mining/Cargo/etc.)
//
// Fallback : si le catalog n'est pas chargé, on retombe sur la table hardcoded
// `vehicle_category` dans gamelog_history_parser.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const FLEETYARDS_BASE: &str = "https://api.fleetyards.net/v1/models";
const FLEETYARDS_PAGE_SIZE: u32 = 200; // max accepté par l'API
const FLEETYARDS_MAX_PAGES: u32 = 10;  // safety net
const CACHE_FILENAME: &str = "fleetyards_ships.json";
const CACHE_TTL_DAYS: u64 = 7;
const USER_AGENT: &str = "StarTradFR-ShipCatalog/4.2";

/// Rôle dominant d'un vaisseau, dérivé de la classification Fleetyards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShipRole {
    Combat,
    Mining,
    Salvage,
    Cargo,
    Exploration,
    Medical,
    Refuel,
    Racing,
    Touring,
    Industrial,
    Multi,
    Ground,
    Other,
}

impl ShipRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            ShipRole::Combat => "Combat",
            ShipRole::Mining => "Mining",
            ShipRole::Salvage => "Salvage",
            ShipRole::Cargo => "Cargo / Trade",
            ShipRole::Exploration => "Exploration",
            ShipRole::Medical => "Medical",
            ShipRole::Refuel => "Refuel",
            ShipRole::Racing => "Racing",
            ShipRole::Touring => "Touring",
            ShipRole::Industrial => "Industrial",
            ShipRole::Multi => "Multi",
            ShipRole::Ground => "Ground vehicle",
            ShipRole::Other => "Autre",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipInfo {
    pub canonical: String,        // ex "RSI_Perseus" (notre format interne)
    pub name: String,             // ex "Perseus"
    pub manufacturer_code: String,// ex "RSI"
    pub manufacturer_name: String,// ex "Roberts Space Industries"
    pub classification: String,   // raw fleetyards : "combat", "multi", "industrial", etc.
    pub focus: Option<String>,    // ex "Cargo / Hauler"
    pub role: ShipRole,           // dérivé
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheFile {
    fetched_at: u64,
    ships: Vec<ShipInfo>,
}

// ── Fleetyards API response (subset des fields utiles) ──────────────────────

#[derive(Debug, Deserialize)]
struct FleetyardsResponse {
    items: Vec<FleetyardsShip>,
}

#[derive(Debug, Deserialize)]
struct FleetyardsShip {
    #[serde(rename = "scIdentifier")]
    sc_identifier: Option<String>,
    name: Option<String>,
    classification: Option<String>,
    focus: Option<String>,
    manufacturer: Option<FleetyardsManufacturer>,
}

#[derive(Debug, Deserialize)]
struct FleetyardsManufacturer {
    name: Option<String>,
    code: Option<String>,
}

// ── Cache ───────────────────────────────────────────────────────────────────

fn cache_path() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("ships");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(CACHE_FILENAME))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn is_cache_stale(cache: &CacheFile) -> bool {
    let ttl_secs = CACHE_TTL_DAYS * 86400;
    now_secs() > cache.fetched_at + ttl_secs
}

fn load_cache() -> Option<CacheFile> {
    let path = cache_path()?;
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<CacheFile>(&raw).ok()
}

fn save_cache(cache: &CacheFile) -> Result<(), String> {
    let path = cache_path().ok_or("Cache path indisponible")?;
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Mapping classification → ShipRole ────────────────────────────────────────

/// Mappe la classification Fleetyards (combat/multi/industrial/etc.) + focus
/// (Cargo / Hauler, etc.) vers un ShipRole utilisable pour le carnet.
fn derive_role(classification: &str, focus: Option<&str>) -> ShipRole {
    let c = classification.to_lowercase();
    let f = focus.unwrap_or("").to_lowercase();

    // Le focus est plus précis quand dispo — on regarde en premier
    if f.contains("mining") { return ShipRole::Mining; }
    if f.contains("salvage") { return ShipRole::Salvage; }
    if f.contains("cargo") || f.contains("hauler") || f.contains("freight") {
        return ShipRole::Cargo;
    }
    if f.contains("medical") || f.contains("med") { return ShipRole::Medical; }
    if f.contains("refuel") || f.contains("fuel") { return ShipRole::Refuel; }
    if f.contains("racing") || f.contains("race") { return ShipRole::Racing; }
    if f.contains("touring") || f.contains("passenger") || f.contains("transport") {
        return ShipRole::Touring;
    }
    if f.contains("explor") || f.contains("path") || f.contains("scout") {
        return ShipRole::Exploration;
    }
    if f.contains("ground") || f.contains("rover") || f.contains("buggy") {
        return ShipRole::Ground;
    }
    if f.contains("combat") || f.contains("fighter") || f.contains("bomber")
        || f.contains("interdict") || f.contains("gunship") || f.contains("dropship")
        || f.contains("dogfight") || f.contains("battle") {
        return ShipRole::Combat;
    }

    // Fallback : classification générique
    match c.as_str() {
        "combat" | "fighter" | "bomber" | "gunship" | "interdiction" => ShipRole::Combat,
        "mining" => ShipRole::Mining,
        "salvage" => ShipRole::Salvage,
        "cargo" | "transport" | "freighter" | "hauler" => ShipRole::Cargo,
        "exploration" | "explorer" => ShipRole::Exploration,
        "medical" => ShipRole::Medical,
        "refueling" | "refuel" => ShipRole::Refuel,
        "racing" => ShipRole::Racing,
        "touring" | "passenger" => ShipRole::Touring,
        "industrial" => ShipRole::Industrial,
        "ground" | "vehicle" => ShipRole::Ground,
        "multi" => ShipRole::Multi,
        _ => ShipRole::Other,
    }
}

/// Convertit sc_identifier Fleetyards ("rsi_perseus") en canonical ("RSI_Perseus").
/// Format attendu : "<mfg_code>_<model_in_snake_case>"
fn to_canonical(sc_id: &str, mfg_code: &str) -> String {
    let prefix_lower = format!("{}_", mfg_code.to_lowercase());
    if let Some(stripped) = sc_id.strip_prefix(&prefix_lower) {
        // PERSEUS in PascalCase nécessite un mapping manuel ; la plupart
        // des canonicals SC utilisent simplement la 1ère lettre en majuscule.
        let model = stripped.split('_')
            .map(|p| {
                let mut chars = p.chars();
                match chars.next() {
                    Some(f) => f.to_uppercase().chain(chars).collect::<String>(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join("_");
        format!("{}_{}", mfg_code.to_uppercase(), model)
    } else {
        sc_id.to_string()
    }
}

// ── API publique ────────────────────────────────────────────────────────────

pub struct ShipCatalog {
    /// Map canonical lowercased → ShipInfo
    pub by_canonical: HashMap<String, ShipInfo>,
}

impl ShipCatalog {
    pub fn lookup(&self, canonical: &str) -> Option<&ShipInfo> {
        self.by_canonical.get(&canonical.to_lowercase())
    }

    pub fn role(&self, canonical: &str) -> Option<ShipRole> {
        self.lookup(canonical).map(|s| s.role)
    }
}

/// Construit le ShipCatalog depuis le cache disque (si présent et frais).
pub fn load_catalog() -> Option<ShipCatalog> {
    let cache = load_cache()?;
    Some(build_catalog(&cache.ships))
}

fn build_catalog(ships: &[ShipInfo]) -> ShipCatalog {
    let mut by_canonical = HashMap::with_capacity(ships.len());
    for s in ships {
        by_canonical.insert(s.canonical.to_lowercase(), s.clone());
    }
    ShipCatalog { by_canonical }
}

/// Singleton paresseux — utilisé depuis le parser pour catégoriser les vaisseaux.
pub fn get_catalog() -> Option<&'static ShipCatalog> {
    static CATALOG: OnceLock<Option<ShipCatalog>> = OnceLock::new();
    CATALOG.get_or_init(load_catalog).as_ref()
}

/// Fetch Fleetyards (paginé, max 200 items/page) et persist le cache.
/// Itère sur les pages jusqu'à recevoir une page vide ou MAX_PAGES.
pub async fn refresh_catalog() -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    // Collecte tous les items via pagination
    let mut all_items: Vec<FleetyardsShip> = Vec::with_capacity(400);
    for page in 1..=FLEETYARDS_MAX_PAGES {
        let url = format!("{}?perPage={}&page={}", FLEETYARDS_BASE, FLEETYARDS_PAGE_SIZE, page);
        let resp = client.get(&url).send().await
            .map_err(|e| format!("Fleetyards fetch page {}: {e}", page))?;
        if !resp.status().is_success() {
            return Err(format!("Fleetyards HTTP {} page {}", resp.status(), page));
        }
        let json: FleetyardsResponse = resp.json().await
            .map_err(|e| format!("Fleetyards JSON page {}: {e}", page))?;
        let page_count = json.items.len();
        all_items.extend(json.items);
        // Page incomplète = dernière page
        if (page_count as u32) < FLEETYARDS_PAGE_SIZE {
            break;
        }
    }

    let mut ships: Vec<ShipInfo> = Vec::with_capacity(all_items.len());
    for item in all_items {
        let sc_id = match item.sc_identifier {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let mfg = item.manufacturer.unwrap_or(FleetyardsManufacturer { name: None, code: None });
        let mfg_code = mfg.code.unwrap_or_else(|| sc_id.split('_').next().unwrap_or("").to_string()).to_uppercase();
        if mfg_code.is_empty() { continue; }
        let mfg_name = mfg.name.unwrap_or_default();
        let canonical = to_canonical(&sc_id, &mfg_code);
        let classification = item.classification.unwrap_or_default();
        let focus = item.focus.filter(|s| !s.is_empty());
        let role = derive_role(&classification, focus.as_deref());
        ships.push(ShipInfo {
            canonical,
            name: item.name.unwrap_or_default(),
            manufacturer_code: mfg_code,
            manufacturer_name: mfg_name,
            classification,
            focus,
            role,
        });
    }
    let count = ships.len();
    let cache = CacheFile { fetched_at: now_secs(), ships };
    save_cache(&cache)?;
    Ok(count)
}

#[tauri::command]
pub async fn ship_catalog_refresh() -> Result<usize, String> {
    refresh_catalog().await
}

/// Garantit qu'on a un catalog frais avant utilisation (au démarrage de l'app).
pub async fn ensure_fresh_catalog() {
    let needs_refresh = match load_cache() {
        Some(cache) => is_cache_stale(&cache),
        None => true,
    };
    if needs_refresh {
        if let Err(e) = refresh_catalog().await {
            eprintln!("[ship_catalog] refresh failed: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Force fetch + persist le cache Fleetyards.
    /// cargo test --release --lib refresh_ship_catalog_cache -- --ignored --nocapture
    #[test]
    #[ignore]
    fn refresh_ship_catalog_cache() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let count = rt.block_on(refresh_catalog()).expect("Fleetyards fetch failed");
        println!("\n✅ Fleetyards cache écrit : {} vaisseaux", count);
        if let Some(path) = cache_path() {
            println!("   path : {}", path.display());
        }
    }

    #[test]
    fn derive_role_from_focus() {
        assert_eq!(derive_role("multi", Some("Cargo / Hauler")), ShipRole::Cargo);
        assert_eq!(derive_role("multi", Some("Mining")), ShipRole::Mining);
        assert_eq!(derive_role("multi", Some("Salvage")), ShipRole::Salvage);
        assert_eq!(derive_role("multi", Some("Fighter")), ShipRole::Combat);
    }

    #[test]
    fn derive_role_from_classification() {
        assert_eq!(derive_role("combat", None), ShipRole::Combat);
        assert_eq!(derive_role("mining", None), ShipRole::Mining);
        assert_eq!(derive_role("xyz", None), ShipRole::Other);
    }

    #[test]
    fn to_canonical_basic() {
        assert_eq!(to_canonical("rsi_perseus", "RSI"), "RSI_Perseus");
        assert_eq!(to_canonical("misc_hull_b", "MISC"), "MISC_Hull_B");
        assert_eq!(to_canonical("anvl_hornet_f7c_mk2", "ANVL"), "ANVL_Hornet_F7c_Mk2");
    }
}
