use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::command;

use crate::scripts::gamepath::get_star_citizen_versions;

const SC_CRAFT_BASE: &str = "https://sc-craft.tools";
const ERKUL_BASE: &str = "https://server.erkul.games";
const ERKUL_ENDPOINTS: &[&str] = &["shields", "coolers", "qeds", "radars", "weapons"];
const SCCRAFTER_BLUEPRINTS_URL: &str = "https://www.sccrafter.com/Blueprints.json";
/// Official CIG global.ini files hosted by PolyTool (auto-synced from game data).
/// We pull from here instead of the user's local install so that translation
/// coverage is identical for all users regardless of which FR pack they have
/// installed (StarTrad, Circuspes, vanilla, none, etc.).
const POLYTOOL_GLOBAL_FR_URL: &str =
    "https://raw.githubusercontent.com/GerbyTV/PolyToolSC/main/global.ini";
const POLYTOOL_GLOBAL_EN_URL: &str =
    "https://raw.githubusercontent.com/GerbyTV/PolyToolSC/main/global_en.ini";
const USER_AGENT: &str = "StarTradFR-Blueprints/2.2";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintSummary {
    pub id: Option<u64>,
    pub blueprint_id: String,
    pub name_en: String,
    pub name_fr: Option<String>,
    pub loc_key: Option<String>,
    pub category: Option<String>,
    pub craft_time_seconds: Option<u64>,
    pub tiers: Option<u64>,
    pub default_owned: bool,
    pub version: Option<String>,
    /// Class code resolved from global.ini description: civi/mili/indu/stlh/comp
    pub class_code: Option<String>,
    /// Component size (1-10) extracted from sccrafter categoryName or blueprint_id pattern
    pub size: Option<u64>,
}

/// Extracts size N from sccrafter categoryName ("Veh. Comp. S2"/"Veh. Weapons S6")
/// or fallback to blueprint_id pattern "_s01_" / "_s1_" / "_s1$".
fn extract_size(blueprint_id: &str, category_name: Option<&str>) -> Option<u64> {
    if let Some(cn) = category_name {
        if let Some(idx) = cn.find('S') {
            let after = &cn[idx + 1..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u64>() {
                return Some(n);
            }
        }
    }
    // Match "_s12_" or "_s12" at end
    let lower = blueprint_id.to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('_').collect();
    for p in &parts {
        if let Some(rest) = p.strip_prefix('s') {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = rest.parse::<u64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintDetail {
    #[serde(flatten)]
    pub summary: BlueprintSummary,
    pub ingredients: Vec<IngredientGroup>,
    pub missions: Vec<MissionInfo>,
    pub item_stats: Option<serde_json::Value>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct IngredientGroup {
    pub slot: String,
    pub slot_loc_key: Option<String>,
    pub slot_label_fr: Option<String>,
    pub options: Vec<IngredientOption>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct IngredientOption {
    pub guid: Option<String>,
    pub name: String,
    pub name_fr: Option<String>,
    pub loc_key: Option<String>,
    pub quantity_scu: Option<f64>,
    pub quantity: Option<u64>,
    pub min_quality: Option<u64>,
    pub unit: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MissionInfo {
    pub mission_id: Option<u64>,
    pub name_raw: String,
    pub name_fr: Option<String>,
    pub loc_key: Option<String>,
    pub description_en: Option<String>,
    pub description_fr: Option<String>,
    pub description_loc_key: Option<String>,
    pub contractor: Option<String>,
    pub mission_type: Option<String>,
    pub category: Option<String>,
    pub lawful: Option<bool>,
    pub not_for_release: Option<bool>,
    pub drop_chance: Option<String>,
    pub locations: Option<String>,
    pub time_to_complete_minutes: Option<u64>,
    pub min_standing_name: Option<String>,
    pub min_standing_reputation: Option<i64>,
    pub standing_reward: Option<i64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub versions: Vec<VersionEntry>,
    pub total_blueprints: Option<u64>,
    pub version: Option<String>,
    pub locations: Vec<String>,
    pub mission_types: Vec<String>,
    pub contractors: Vec<String>,
    pub resources: Vec<ResourceHint>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: u64,
    pub version: String,
    pub channel: String,
    #[serde(default)]
    pub active: u8,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHint {
    pub name: String,
    pub loc_key: Option<String>,
}

#[derive(Deserialize)]
struct RawListResponse {
    items: Vec<RawListItem>,
}

#[derive(Deserialize)]
struct RawListItem {
    id: u64,
    blueprint_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    loc_key: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    craft_time_seconds: Option<u64>,
    #[serde(default)]
    tiers: Option<u64>,
    #[serde(default)]
    default_owned: Option<u64>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Deserialize)]
struct RawDetailResponse {
    id: u64,
    blueprint_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    loc_key: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    craft_time_seconds: Option<u64>,
    #[serde(default)]
    tiers: Option<u64>,
    #[serde(default)]
    default_owned: Option<u64>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    item_stats: Option<serde_json::Value>,
    #[serde(default)]
    ingredients: Vec<RawIngredientGroup>,
    #[serde(default)]
    missions: Vec<RawMission>,
}

#[derive(Deserialize)]
struct RawIngredientGroup {
    #[serde(default)]
    slot: Option<String>,
    #[serde(default)]
    slot_loc_key: Option<String>,
    #[serde(default)]
    options: Vec<RawIngredientOption>,
}

#[derive(Deserialize)]
struct RawIngredientOption {
    #[serde(default)]
    guid: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    loc_key: Option<String>,
    #[serde(default)]
    quantity_scu: Option<f64>,
    #[serde(default)]
    quantity: Option<u64>,
    #[serde(default)]
    min_quality: Option<u64>,
    #[serde(default)]
    unit: Option<String>,
}

#[derive(Deserialize)]
struct RawMission {
    #[serde(default)]
    mission_id: Option<u64>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    loc_key: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    description_loc_key: Option<String>,
    #[serde(default)]
    contractor: Option<String>,
    #[serde(default)]
    mission_type: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    lawful: Option<u64>,
    #[serde(default)]
    not_for_release: Option<u64>,
    #[serde(default)]
    drop_chance: Option<String>,
    #[serde(default)]
    locations: Option<String>,
    #[serde(default)]
    time_to_complete_minutes: Option<u64>,
    #[serde(default)]
    min_standing: Option<RawStanding>,
    #[serde(default)]
    standing_reward: Option<i64>,
}

#[derive(Deserialize)]
struct RawStanding {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    reputation: Option<i64>,
}

#[derive(Deserialize)]
struct RawConfigResponse {
    #[serde(default)]
    versions: Vec<VersionEntry>,
    #[serde(default)]
    stats: Option<RawConfigStats>,
    #[serde(default)]
    #[serde(rename = "filterHints")]
    filter_hints: Option<RawFilterHints>,
}

#[derive(Deserialize, Default)]
struct RawConfigStats {
    #[serde(default)]
    #[serde(rename = "totalBlueprints")]
    total_blueprints: Option<u64>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawFilterHints {
    #[serde(default)]
    location: Vec<String>,
    #[serde(default)]
    mission_type: Vec<String>,
    #[serde(default)]
    contractor: Vec<String>,
    #[serde(default)]
    resource: Vec<RawResource>,
}

#[derive(Deserialize)]
struct RawResource {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    loc_key: Option<String>,
}

struct LocCache {
    fr: Option<HashMap<String, String>>,
    /// EN global.ini fallback, used when the user's FR pack misses a key
    /// (different translator like Circuspes, partial translations, etc.).
    /// Guarantees we always have at least an EN string from the official game install.
    en: Option<HashMap<String, String>>,
    /// Map from lowercased item key → class code, extracted from global.ini descriptions.
    classes: Option<HashMap<String, String>>,
    /// Map from lowercased item localName → class code, pulled from erkul.games API.
    erkul_classes: Option<HashMap<String, String>>,
    version: Option<String>,
}

static LOC_CACHE: Mutex<LocCache> = Mutex::new(LocCache {
    fr: None,
    en: None,
    classes: None,
    erkul_classes: None,
    version: None,
});

fn pick_live_install_path() -> Option<PathBuf> {
    let versions = get_star_citizen_versions();
    let preferred = ["LIVE", "PTU", "EPTU", "TECH-PREVIEW"];
    for channel in preferred.iter() {
        if let Some(info) = versions.versions.get(*channel) {
            let path = PathBuf::from(&info.path);
            if path.join("Data.p4k").exists() {
                return Some(path);
            }
        }
    }
    versions.versions.into_iter().find_map(|(_, info)| {
        let path = PathBuf::from(&info.path);
        if path.join("Data.p4k").exists() {
            Some(path)
        } else {
            None
        }
    })
}

fn locale_file(install: &PathBuf, locale_folder: &str) -> PathBuf {
    install
        .join("data")
        .join("Localization")
        .join(locale_folder)
        .join("global.ini")
}

fn parse_global_ini(path: &PathBuf) -> Option<HashMap<String, String>> {
    let raw = fs::read_to_string(path).ok()?;
    let mut map = HashMap::with_capacity(60_000);
    for line in raw.lines() {
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        let Some(eq_idx) = line.find('=') else {
            continue;
        };
        let raw_key = &line[..eq_idx];
        let value = line[eq_idx + 1..].trim();
        let key = raw_key
            .split(|c: char| c == ',' || c.is_whitespace())
            .next()
            .unwrap_or(raw_key)
            .trim()
            .to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        map.entry(key).or_insert_with(|| value.to_string());
    }
    Some(map)
}

/// Extracts a `item_internal_name → class_code` map from a parsed global.ini.
/// Looks at item_DescXXX entries and extracts the class from the localized text:
/// EN "Class: Military", FR "Classe : Militaire".
fn build_class_map(loc_map: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(900);
    for (key, value) in loc_map {
        if !key.starts_with("item_desc") {
            continue;
        }
        let item_key = match key.strip_prefix("item_desc") {
            Some(s) => s.to_string(),
            None => continue,
        };
        if item_key.is_empty() {
            continue;
        }
        if let Some(code) = normalize_class_from_text(value) {
            out.insert(item_key, code.to_string());
        }
    }
    out
}

/// Detects civi/mili/indu/stlh/comp from a localized description string.
/// Supports both EN ("Class: Military") and FR ("Classe : Militaire") variants.
fn normalize_class_from_text(text: &str) -> Option<&'static str> {
    let lower = text.to_ascii_lowercase();
    for marker in &["class:", "classe :", "classe:"] {
        if let Some(idx) = lower.find(marker) {
            let after = &lower[idx + marker.len()..];
            let token: String = after
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_alphabetic() || *c == 'é' || *c == 'è' || *c == 'à')
                .collect();
            let normalized = match token.as_str() {
                "civilian" | "civil" | "civile" => Some("civi"),
                "military" | "militaire" => Some("mili"),
                "industrial" | "industriel" => Some("indu"),
                "stealth" | "furtif" | "discrétion" | "discretion" => Some("stlh"),
                "competition" | "compétition" => Some("comp"),
                _ => None,
            };
            if normalized.is_some() {
                return normalized;
            }
        }
    }
    None
}

fn ensure_loc_cache() -> Result<(), String> {
    let cache_key = "polytool".to_string();

    {
        let cache = LOC_CACHE.lock().unwrap();
        if cache.version.as_deref() == Some(&cache_key)
            && cache.fr.is_some()
            && cache.en.is_some()
            && cache.classes.is_some()
        {
            return Ok(());
        }
    }

    // 1) Try PolyTool's published global.ini (canonical CIG, identical for all users
    //    regardless of which translator they have installed locally).
    let mut fr_map = load_polytool_global("fr");
    let mut en_map = load_polytool_global("en");

    // 2) Fallback to the user's local install if PolyTool cache is missing
    //    (offline first launch, etc.).
    if fr_map.is_none() || en_map.is_none() {
        if let Some(install) = pick_live_install_path() {
            if fr_map.is_none() {
                fr_map = parse_global_ini(&locale_file(&install, "french_(france)"));
            }
            if en_map.is_none() {
                en_map = parse_global_ini(&locale_file(&install, "english"));
            }
        }
    }

    if fr_map.is_none() && en_map.is_none() {
        return Err(
            "Aucun global.ini disponible (ni PolyTool ni install locale). Lance l'app une fois en ligne pour le télécharger.".to_string(),
        );
    }

    let mut class_map = fr_map.as_ref().map(build_class_map).unwrap_or_default();
    if let Some(en) = en_map.as_ref() {
        for (k, v) in build_class_map(en) {
            class_map.entry(k).or_insert(v);
        }
    }

    let erkul_classes = load_erkul_cache_from_disk();

    let mut cache = LOC_CACHE.lock().unwrap();
    cache.fr = fr_map;
    cache.en = en_map;
    cache.classes = Some(class_map);
    if cache.erkul_classes.is_none() {
        cache.erkul_classes = erkul_classes.or(Some(HashMap::new()));
    }
    cache.version = Some(cache_key);
    Ok(())
}

fn lookup_fr(key: &Option<String>) -> Option<String> {
    let key = key.as_ref()?;
    let lower = key.to_ascii_lowercase();
    let cache = LOC_CACHE.lock().unwrap();
    if let Some(v) = cache.fr.as_ref().and_then(|m| m.get(&lower)) {
        return Some(v.clone());
    }
    // Fallback to EN so the UI never shows an empty cell when FR is incomplete
    cache.en.as_ref().and_then(|m| m.get(&lower).cloned())
}

/// Lookup the class code (civi/mili/indu/stlh/comp) for an item.
/// Priority chain:
///   1. global.ini description ("Classe : Militaire") — CIG data, highest authority
///   2. erkul `class` field — covers most shields/coolers/QDs
///   3. Manufacturer mapping (HRST=mili, AMRS=civi, etc.) — lore-based inference
fn lookup_class(internal_name: &str) -> Option<String> {
    let lower = internal_name.to_ascii_lowercase();
    {
        let cache = LOC_CACHE.lock().unwrap();
        if let Some(v) = cache
            .classes
            .as_ref()
            .and_then(|m| m.get(&lower).cloned())
        {
            return Some(v);
        }
        if let Some(v) = cache
            .erkul_classes
            .as_ref()
            .and_then(|m| m.get(&lower).cloned())
        {
            return Some(v);
        }
    }
    manufacturer_class_from_id(&lower).map(|s| s.to_string())
}

/// Maps a manufacturer code (lowercase) to a default class orientation based on lore.
/// Only applied as a last-resort fallback when CIG/erkul don't expose the class.
fn manufacturer_class_from_id(id_lower: &str) -> Option<&'static str> {
    // Extract manufacturer token: usually parts[1] of bp_craft_<mfg>_... OR parts[0] of <mfg>_xxx
    let mfg = if let Some(rest) = id_lower.strip_prefix("bp_craft_") {
        rest.split('_').next().unwrap_or("")
    } else if let Some(rest) = id_lower.strip_prefix("bp_") {
        // shapes like "bp_shld_behr_..." or "bp_powr_amrs_..."
        let mut iter = rest.split('_');
        let _kind = iter.next();
        iter.next().unwrap_or("")
    } else {
        id_lower.split('_').next().unwrap_or("")
    };
    classify_manufacturer(mfg)
}

fn classify_manufacturer(code: &str) -> Option<&'static str> {
    match code {
        // Military / weapons-focused (UEE-aligned)
        "aegs" | "aegis" => Some("mili"),
        "anvl" | "anvil" => Some("mili"),
        "behr" | "behring" => Some("mili"),
        "basl" | "basilisk" => Some("mili"),
        "gmni" | "gemini" => Some("mili"),
        "hrst" | "hurston" => Some("mili"),
        "kast" | "kastak" => Some("mili"),
        "kbar" | "klwe" | "klauswerner" | "kw" => Some("mili"),
        "krig" | "kruger" => Some("mili"),
        // Civilian (recreational, exploration, comfort)
        "amrs" | "amonreese" => Some("civi"),
        "apar" | "apocalypse" => Some("civi"),
        "drak" | "drake" => Some("civi"),
        "misc" | "musashi" => Some("civi"),
        "orig" | "origin" => Some("civi"),
        "rsi" => Some("civi"),
        "csgi" => Some("civi"),
        // Industrial (mining, salvage, construction)
        "grin" | "greycat" | "gctec" => Some("indu"),
        "argo" => Some("indu"),
        "esp" | "esprit" => Some("indu"),
        "hrtd" => Some("indu"),
        "shubin" => Some("indu"),
        // Aliens / not classified
        "banu" | "asas" | "aopoa" | "vncl" | "vndl" | "vnduul" | "vanduul" | "xian" => None,
        _ => None,
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Impossible d'initialiser le client HTTP: {}", e))
}

#[command]
pub async fn blueprints_config() -> Result<ConfigPayload, String> {
    let _ = ensure_loc_cache();

    let url = format!("{}/api/config", SC_CRAFT_BASE);
    let client = http_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau vers sc-craft.tools: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "sc-craft.tools a renvoye un statut HTTP {}",
            response.status()
        ));
    }
    let raw: RawConfigResponse = response
        .json()
        .await
        .map_err(|e| format!("Reponse /api/config illisible: {}", e))?;

    let stats = raw.stats.unwrap_or_default();
    let hints = raw.filter_hints.unwrap_or_default();

    Ok(ConfigPayload {
        versions: raw.versions,
        total_blueprints: stats.total_blueprints,
        version: stats.version,
        locations: hints.location,
        mission_types: hints.mission_type,
        contractors: hints.contractor,
        resources: hints
            .resource
            .into_iter()
            .filter_map(|r| {
                r.name.map(|name| ResourceHint {
                    name,
                    loc_key: r.loc_key,
                })
            })
            .collect(),
    })
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintsListFilters {
    #[serde(default)]
    pub version_id: Option<u64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub mission_type: Option<String>,
    #[serde(default)]
    pub contractor: Option<String>,
    #[serde(default)]
    pub lawful: Option<u8>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub ownable: Option<bool>,
}

#[command]
pub async fn blueprints_list(filters: Option<BlueprintsListFilters>) -> Result<Vec<BlueprintSummary>, String> {
    let _ = ensure_loc_cache();
    let filters = filters.unwrap_or_default();

    let mut url = format!("{}/api/blueprints?limit=99999", SC_CRAFT_BASE);
    if let Some(v) = filters.version_id {
        url.push_str(&format!("&version_id={}", v));
    }
    if let Some(loc) = filters.location.as_ref().filter(|s| !s.is_empty()) {
        url.push_str(&format!(
            "&location={}",
            urlencoding::encode(loc)
        ));
    }
    if let Some(mt) = filters.mission_type.as_ref().filter(|s| !s.is_empty()) {
        url.push_str(&format!(
            "&mission_type={}",
            urlencoding::encode(mt)
        ));
    }
    if let Some(c) = filters.contractor.as_ref().filter(|s| !s.is_empty()) {
        url.push_str(&format!(
            "&contractor={}",
            urlencoding::encode(c)
        ));
    }
    if let Some(l) = filters.lawful {
        url.push_str(&format!("&lawful={}", l));
    }
    if let Some(s) = filters.search.as_ref().filter(|s| !s.is_empty()) {
        url.push_str(&format!("&search={}", urlencoding::encode(s)));
    }
    if filters.ownable.unwrap_or(false) {
        url.push_str("&ownable=1");
    }

    let client = http_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau vers sc-craft.tools: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "sc-craft.tools a renvoye un statut HTTP {}",
            response.status()
        ));
    }
    let raw: RawListResponse = response
        .json()
        .await
        .map_err(|e| format!("Reponse /api/blueprints illisible: {}", e))?;

    Ok(raw
        .items
        .into_iter()
        .map(|item| {
            let name_fr = lookup_fr(&item.loc_key);
            // sc-craft uses blueprint_id like "bp_craft_xxx" — derive item internal name
            let internal_for_class = item
                .blueprint_id
                .strip_prefix("bp_craft_")
                .unwrap_or(&item.blueprint_id);
            let class_code = lookup_class(internal_for_class);
            let size = extract_size(&item.blueprint_id, item.category.as_deref());
            BlueprintSummary {
                id: Some(item.id),
                blueprint_id: item.blueprint_id,
                name_en: item.name.unwrap_or_default(),
                name_fr,
                loc_key: item.loc_key,
                category: item.category,
                craft_time_seconds: item.craft_time_seconds,
                tiers: item.tiers,
                default_owned: item.default_owned.unwrap_or(0) > 0,
                version: item.version,
                class_code,
                size,
            }
        })
        .collect())
}

fn blueprints_cache_path() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("blueprints");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("sccrafter_blueprints.json"))
}

fn erkul_cache_path() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("blueprints");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("erkul_classes.json"))
}

fn polytool_global_cache_path(suffix: &str) -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("blueprints");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("polytool_global_{}.ini", suffix)))
}

/// Returns true if `path` is missing or older than `max_age_days`.
fn is_cache_stale(path: &PathBuf, max_age_days: u64) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return true;
    };
    let Ok(modified) = meta.modified() else {
        return true;
    };
    let Ok(elapsed) = modified.elapsed() else {
        return true;
    };
    elapsed.as_secs() > max_age_days * 24 * 60 * 60
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let client = http_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!("{} HTTP {}", url, response.status()));
    }
    response
        .text()
        .await
        .map_err(|e| format!("Reponse {} illisible: {}", url, e))
}

/// Fetches the latest PolyTool global.ini (FR or EN) to disk if cache is stale.
/// Cache lifetime: 7 days.
async fn ensure_polytool_global(suffix: &str, url: &str) {
    let Some(path) = polytool_global_cache_path(suffix) else {
        return;
    };
    if !is_cache_stale(&path, 7) {
        return;
    }
    match fetch_text(url).await {
        Ok(text) => {
            let _ = fs::write(&path, text);
        }
        Err(e) => {
            eprintln!("[blueprints] polytool {} fetch failed: {}", suffix, e);
        }
    }
}

/// Loads a parsed global.ini from PolyTool disk cache. Returns None if cache is missing.
fn load_polytool_global(suffix: &str) -> Option<HashMap<String, String>> {
    let path = polytool_global_cache_path(suffix)?;
    parse_global_ini(&path)
}

/// Tauri command: force refresh PolyTool global.ini files (FR + EN) on next call.
#[command]
pub async fn blueprints_refresh_polytool_globals() -> Result<(), String> {
    // Delete cache files so the next ensure_loc_cache call re-downloads them
    if let Some(p) = polytool_global_cache_path("fr") {
        let _ = fs::remove_file(&p);
    }
    if let Some(p) = polytool_global_cache_path("en") {
        let _ = fs::remove_file(&p);
    }
    ensure_polytool_global("fr", POLYTOOL_GLOBAL_FR_URL).await;
    ensure_polytool_global("en", POLYTOOL_GLOBAL_EN_URL).await;
    {
        let mut cache = LOC_CACHE.lock().unwrap();
        cache.fr = load_polytool_global("fr").or(cache.fr.take());
        cache.en = load_polytool_global("en").or(cache.en.take());
        if let Some(en) = cache.en.as_ref() {
            let mut class_map = cache.fr.as_ref().map(build_class_map).unwrap_or_default();
            for (k, v) in build_class_map(en) {
                class_map.entry(k).or_insert(v);
            }
            cache.classes = Some(class_map);
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct ErkulItem {
    #[serde(default)]
    data: Option<ErkulItemData>,
    #[serde(default, rename = "localName")]
    local_name_outer: Option<String>,
}

#[derive(Deserialize)]
struct ErkulItemData {
    #[serde(default, rename = "localName")]
    local_name: Option<String>,
    #[serde(default)]
    class: Option<String>,
}

fn normalize_erkul_class(raw: &str) -> Option<&'static str> {
    match raw.to_ascii_lowercase().as_str() {
        "civilian" | "civi" | "civil" => Some("civi"),
        "military" | "mili" => Some("mili"),
        "industrial" | "indu" => Some("indu"),
        "stealth" | "stlh" | "furtif" => Some("stlh"),
        "competition" | "comp" => Some("comp"),
        _ => None,
    }
}

async fn fetch_erkul_classes() -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(400);
    let client = match http_client() {
        Ok(c) => c,
        Err(_) => return out,
    };
    for endpoint in ERKUL_ENDPOINTS {
        let url = format!("{}/live/{}", ERKUL_BASE, endpoint);
        let req = client
            .get(&url)
            .header("Origin", "https://www.erkul.games")
            .header("Referer", "https://www.erkul.games/");
        let response = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[blueprints] erkul {} failed: {}", endpoint, e);
                continue;
            }
        };
        if !response.status().is_success() {
            eprintln!(
                "[blueprints] erkul {} HTTP {}",
                endpoint,
                response.status()
            );
            continue;
        }
        let items: Vec<ErkulItem> = match response.json().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[blueprints] erkul {} json: {}", endpoint, e);
                continue;
            }
        };
        for item in items {
            let local_name = item
                .data
                .as_ref()
                .and_then(|d| d.local_name.clone())
                .or(item.local_name_outer);
            let class_raw = item.data.and_then(|d| d.class);
            if let (Some(name), Some(cls)) = (local_name, class_raw) {
                if let Some(code) = normalize_erkul_class(&cls) {
                    out.insert(name.to_ascii_lowercase(), code.to_string());
                }
            }
        }
    }
    out
}

/// Tauri command: refresh erkul class data in background and persist.
#[command]
pub async fn blueprints_refresh_erkul_classes() -> Result<u64, String> {
    let map = fetch_erkul_classes().await;
    let count = map.len() as u64;
    if let Some(path) = erkul_cache_path() {
        if let Ok(bytes) = serde_json::to_vec(&map) {
            let _ = fs::write(&path, bytes);
        }
    }
    {
        let mut cache = LOC_CACHE.lock().unwrap();
        cache.erkul_classes = Some(map);
    }
    Ok(count)
}

fn load_erkul_cache_from_disk() -> Option<HashMap<String, String>> {
    let path = erkul_cache_path()?;
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn fetch_sccrafter_payload() -> Result<SccrafterPayload, String> {
    let client = http_client()?;
    let response = client
        .get(SCCRAFTER_BLUEPRINTS_URL)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau vers sccrafter: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "sccrafter a renvoye un statut HTTP {}",
            response.status()
        ));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Reponse sccrafter illisible: {}", e))
}

#[derive(Deserialize, Serialize)]
struct SccrafterPayload {
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    blueprints: Vec<SccrafterBlueprint>,
}

#[derive(Deserialize, Serialize)]
struct SccrafterBlueprint {
    #[serde(default)]
    file: Option<String>,
    #[serde(rename = "recordName", default)]
    record_name: Option<String>,
    #[serde(rename = "internalName", default)]
    internal_name: Option<String>,
    #[serde(rename = "blueprintName", default)]
    blueprint_name: Option<String>,
    #[serde(rename = "categoryName", default)]
    category_name: Option<String>,
    #[serde(rename = "isReward", default)]
    is_reward: Option<bool>,
    #[serde(default)]
    seconds: Option<u64>,
    #[serde(default)]
    slots: Option<Vec<serde_json::Value>>,
    #[serde(rename = "rewardMissions", default)]
    reward_missions: Vec<SccrafterMission>,
}

#[derive(Deserialize, Serialize, Clone)]
struct SccrafterMission {
    #[serde(default)]
    mission: Option<String>,
    #[serde(default)]
    chance: Option<f64>,
    #[serde(default)]
    locations: Vec<String>,
}

/// Derive the blueprint_id (lowercase) from the recordName.
/// "CraftingBlueprintRecord.BP_CRAFT_behr_lmg_ballistic_01_mag" → "bp_craft_behr_lmg_ballistic_01_mag"
fn sccrafter_blueprint_id(bp: &SccrafterBlueprint) -> Option<String> {
    let rn = bp.record_name.as_deref()?;
    let id = rn.strip_prefix("CraftingBlueprintRecord.").unwrap_or(rn);
    Some(id.to_ascii_lowercase())
}

/// Derive the sc-craft-style hierarchical category from the file path.
/// "LIVEfiles\libs\foundry\records\crafting\blueprints\crafting\vehiclegear\weapons\ballistic\cannon\bp_craft_kbar_ballisticcannon_s2.json"
/// → "Vehiclegear / Weapons / Ballistic / Cannon"
fn sccrafter_category_from_file(file: &str) -> Option<String> {
    let normalized = file.replace('\\', "/");
    let anchor = "/blueprints/crafting/";
    let after = normalized.split(anchor).nth(1)?;
    // Drop the final segment (the .json filename)
    let segments: Vec<&str> = after.rsplitn(2, '/').collect();
    if segments.len() < 2 {
        return None;
    }
    let path = segments[1];
    let parts: Vec<String> = path
        .split('/')
        .filter(|p| !p.is_empty() && !p.starts_with('$'))
        .map(|p| {
            let mut chars = p.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" / "))
    }
}

fn build_summary_from_sccrafter(payload: &SccrafterPayload) -> Vec<BlueprintSummary> {
    let version = payload.version.clone();
    let mut out: Vec<BlueprintSummary> = payload
        .blueprints
        .iter()
        .filter_map(|bp| {
            let blueprint_id = sccrafter_blueprint_id(bp)?;
            let filename_root = blueprint_id
                .strip_prefix("bp_craft_")
                .unwrap_or(&blueprint_id)
                .to_string();
            // Try internal_name first (more accurate lookup key), then blueprint_id-derived
            let loc_key = Some(
                bp.internal_name
                    .as_deref()
                    .map(|n| format!("item_name{}", n.to_ascii_lowercase()))
                    .unwrap_or_else(|| format!("item_name{}", filename_root)),
            );
            let name_fr = lookup_fr(&loc_key);
            // EN display: prefer sccrafter's blueprintName (real game name)
            let name_en = bp
                .blueprint_name
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    filename_root
                        .split('_')
                        .map(|t| {
                            let mut c = t.chars();
                            match c.next() {
                                Some(first) => {
                                    first.to_ascii_uppercase().to_string() + c.as_str()
                                }
                                None => String::new(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                });
            let category = bp
                .file
                .as_deref()
                .and_then(sccrafter_category_from_file);
            let class_code = bp.internal_name.as_deref().and_then(lookup_class);
            let size = extract_size(&blueprint_id, bp.category_name.as_deref());
            Some(BlueprintSummary {
                id: None,
                blueprint_id,
                name_en,
                name_fr,
                loc_key,
                category,
                craft_time_seconds: bp.seconds,
                tiers: Some(1),
                default_owned: !bp.is_reward.unwrap_or(false),
                version: version.clone(),
                class_code,
                size,
            })
        })
        .collect();
    out.sort_by(|a, b| a.blueprint_id.cmp(&b.blueprint_id));
    out
}

/// Fetch ALL blueprints (1564+) from sccrafter.com `/Blueprints.json` (5.3 MB single file,
/// uncapped, with missions + recipe + locations inline). Uses a local disk cache for
/// instant loads. The frontend calls `blueprints_revalidate_full` in the background
/// to detect new entries.
#[command]
pub async fn blueprints_list_full() -> Result<Vec<BlueprintSummary>, String> {
    let _ = ensure_loc_cache();

    // Try cache first
    if let Some(path) = blueprints_cache_path() {
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(payload) = serde_json::from_slice::<SccrafterPayload>(&bytes) {
                return Ok(build_summary_from_sccrafter(&payload));
            }
        }
    }

    // No cache (or unreadable): fetch + persist
    let payload = fetch_sccrafter_payload().await?;
    if let Some(path) = blueprints_cache_path() {
        if let Ok(bytes) = serde_json::to_vec(&payload) {
            let _ = fs::write(&path, bytes);
        }
    }
    Ok(build_summary_from_sccrafter(&payload))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevalidateResult {
    pub list: Vec<BlueprintSummary>,
    pub new_count: u64,
    pub removed_count: u64,
    pub changed: bool,
}

/// Background revalidation: always re-downloads from sccrafter, diffs against the
/// disk cache, persists the fresh copy, and returns the new list along with deltas.
/// The frontend calls this after the initial cached load completes.
#[command]
pub async fn blueprints_revalidate_full() -> Result<RevalidateResult, String> {
    let _ = ensure_loc_cache();

    // Old cached ids
    let old_ids: std::collections::HashSet<String> = blueprints_cache_path()
        .and_then(|p| fs::read(&p).ok())
        .and_then(|bytes| serde_json::from_slice::<SccrafterPayload>(&bytes).ok())
        .map(|payload| {
            payload
                .blueprints
                .iter()
                .filter_map(sccrafter_blueprint_id)
                .collect()
        })
        .unwrap_or_default();

    // Fresh fetch
    let fresh = fetch_sccrafter_payload().await?;
    let fresh_ids: std::collections::HashSet<String> = fresh
        .blueprints
        .iter()
        .filter_map(sccrafter_blueprint_id)
        .collect();

    let new_count = fresh_ids.difference(&old_ids).count() as u64;
    let removed_count = old_ids.difference(&fresh_ids).count() as u64;
    let changed = new_count > 0 || removed_count > 0;

    if let Some(path) = blueprints_cache_path() {
        if let Ok(bytes) = serde_json::to_vec(&fresh) {
            let _ = fs::write(&path, bytes);
        }
    }

    let list = build_summary_from_sccrafter(&fresh);
    Ok(RevalidateResult {
        list,
        new_count,
        removed_count,
        changed,
    })
}

/// Resolve a string `blueprint_id` (e.g. "bp_craft_kbar_ballisticcannon_s2")
/// to sc-craft.tools numeric id (e.g. 3532), needed for `blueprint_detail`.
/// Uses `?search=` which returns matching items.
#[command]
pub async fn blueprint_resolve_sc_craft_id(blueprint_id: String) -> Result<Option<u64>, String> {
    let url = format!(
        "{}/api/blueprints?limit=20&search={}",
        SC_CRAFT_BASE,
        urlencoding::encode(&blueprint_id)
    );
    let client = http_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("sc-craft.tools HTTP {}", response.status()));
    }
    let raw: RawListResponse = response
        .json()
        .await
        .map_err(|e| format!("Reponse illisible: {}", e))?;
    let target = blueprint_id.to_ascii_lowercase();
    let matched = raw
        .items
        .into_iter()
        .find(|item| item.blueprint_id.eq_ignore_ascii_case(&target))
        .map(|item| item.id);
    Ok(matched)
}

#[command]
pub async fn blueprint_detail(blueprint_internal_id: u64) -> Result<BlueprintDetail, String> {
    let _ = ensure_loc_cache();
    let url = format!("{}/api/blueprints/{}", SC_CRAFT_BASE, blueprint_internal_id);
    let client = http_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Blueprint #{} introuvable (statut HTTP {})",
            blueprint_internal_id,
            response.status()
        ));
    }
    let raw: RawDetailResponse = response
        .json()
        .await
        .map_err(|e| format!("Reponse /api/blueprints/<id> illisible: {}", e))?;

    let summary_loc_key = raw.loc_key.clone();
    let class_code = lookup_class(
        raw.blueprint_id
            .strip_prefix("bp_craft_")
            .unwrap_or(&raw.blueprint_id),
    );
    let size = extract_size(&raw.blueprint_id, raw.category.as_deref());
    let summary = BlueprintSummary {
        id: Some(raw.id),
        blueprint_id: raw.blueprint_id,
        name_en: raw.name.unwrap_or_default(),
        name_fr: lookup_fr(&summary_loc_key),
        loc_key: summary_loc_key,
        category: raw.category,
        craft_time_seconds: raw.craft_time_seconds,
        tiers: raw.tiers,
        default_owned: raw.default_owned.unwrap_or(0) > 0,
        version: raw.version,
        class_code,
        size,
    };

    let ingredients = raw
        .ingredients
        .into_iter()
        .map(|grp| IngredientGroup {
            slot_label_fr: lookup_fr(&grp.slot_loc_key),
            slot: grp.slot.unwrap_or_default(),
            slot_loc_key: grp.slot_loc_key,
            options: grp
                .options
                .into_iter()
                .map(|opt| IngredientOption {
                    name_fr: lookup_fr(&opt.loc_key),
                    guid: opt.guid,
                    name: opt.name.unwrap_or_default(),
                    loc_key: opt.loc_key,
                    quantity_scu: opt.quantity_scu,
                    quantity: opt.quantity,
                    min_quality: opt.min_quality,
                    unit: opt.unit,
                })
                .collect(),
        })
        .collect();

    let missions = raw
        .missions
        .into_iter()
        .map(|m| {
            let (min_standing_name, min_standing_reputation) = m
                .min_standing
                .map(|s| (s.name, s.reputation))
                .unwrap_or((None, None));
            MissionInfo {
                mission_id: m.mission_id,
                name_fr: lookup_fr(&m.loc_key),
                description_fr: lookup_fr(&m.description_loc_key),
                description_en: m.description,
                name_raw: m.name.unwrap_or_default(),
                loc_key: m.loc_key,
                description_loc_key: m.description_loc_key,
                contractor: m.contractor,
                mission_type: m.mission_type,
                category: m.category,
                lawful: m.lawful.map(|v| v > 0),
                not_for_release: m.not_for_release.map(|v| v > 0),
                drop_chance: m.drop_chance,
                locations: m.locations,
                time_to_complete_minutes: m.time_to_complete_minutes,
                min_standing_name,
                min_standing_reputation,
                standing_reward: m.standing_reward,
            }
        })
        .collect();

    Ok(BlueprintDetail {
        summary,
        ingredients,
        missions,
        item_stats: raw.item_stats,
    })
}

#[command]
pub fn blueprints_refresh_localization() -> Result<(), String> {
    {
        let mut cache = LOC_CACHE.lock().unwrap();
        cache.fr = None;
        cache.version = None;
    }
    ensure_loc_cache()
}
