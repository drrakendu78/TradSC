use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::command;

use crate::scripts::gamepath::get_star_citizen_versions;

const SC_CRAFT_BASE: &str = "https://sc-craft.tools";
const USER_AGENT: &str = "StarTradFR-Blueprints/2.0";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintSummary {
    pub id: u64,
    pub blueprint_id: String,
    pub name_en: String,
    pub name_fr: Option<String>,
    pub loc_key: Option<String>,
    pub category: Option<String>,
    pub craft_time_seconds: Option<u64>,
    pub tiers: Option<u64>,
    pub default_owned: bool,
    pub version: Option<String>,
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
    version: Option<String>,
}

static LOC_CACHE: Mutex<LocCache> = Mutex::new(LocCache {
    fr: None,
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

fn ensure_loc_cache() -> Result<(), String> {
    let install =
        pick_live_install_path().ok_or_else(|| "Aucune installation Star Citizen detectee".to_string())?;
    let install_key = install.to_string_lossy().to_string();

    {
        let cache = LOC_CACHE.lock().unwrap();
        if cache.version.as_deref() == Some(&install_key) && cache.fr.is_some() {
            return Ok(());
        }
    }

    let fr_path = locale_file(&install, "french_(france)");
    let fr_map = parse_global_ini(&fr_path);

    if fr_map.is_none() {
        return Err(format!(
            "Impossible de lire le fichier global.ini FR sous {}",
            fr_path.display()
        ));
    }

    let mut cache = LOC_CACHE.lock().unwrap();
    cache.fr = fr_map;
    cache.version = Some(install_key);
    Ok(())
}

fn lookup_fr(key: &Option<String>) -> Option<String> {
    let key = key.as_ref()?;
    let lower = key.to_ascii_lowercase();
    let cache = LOC_CACHE.lock().unwrap();
    cache.fr.as_ref().and_then(|m| m.get(&lower).cloned())
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
            BlueprintSummary {
                id: item.id,
                blueprint_id: item.blueprint_id,
                name_en: item.name.unwrap_or_default(),
                name_fr,
                loc_key: item.loc_key,
                category: item.category,
                craft_time_seconds: item.craft_time_seconds,
                tiers: item.tiers,
                default_owned: item.default_owned.unwrap_or(0) > 0,
                version: item.version,
            }
        })
        .collect())
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
    let summary = BlueprintSummary {
        id: raw.id,
        blueprint_id: raw.blueprint_id,
        name_en: raw.name.unwrap_or_default(),
        name_fr: lookup_fr(&summary_loc_key),
        loc_key: summary_loc_key,
        category: raw.category,
        craft_time_seconds: raw.craft_time_seconds,
        tiers: raw.tiers,
        default_owned: raw.default_owned.unwrap_or(0) > 0,
        version: raw.version,
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
