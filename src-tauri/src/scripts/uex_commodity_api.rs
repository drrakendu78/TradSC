#![allow(dead_code)] // wire-up overlay en cours

// UEX Corp API client pour les prix de commodities en live.
//
// 2 endpoints utilisés :
//   - GET /commodities → liste de toutes les commodities (id, name, code)
//   - GET /commodities_prices?id_commodity=X → tous les terminals avec prix
//
// Cache local TTL 5 minutes (les prix UEX sont updated par les joueurs en live).
//
// Aussi :
//   - mapping resourceGUID (Game.log) → name (UEX) : statique JSON embarqué
//   - lookup `suggest_sell_locations(commodity_guid, quantity_scu, buy_price)`

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const UEX_API_BASE: &str = "https://uexcorp.space/api/2.0";
const CACHE_DIR_NAME: &str = "uex_cache";
const COMMODITIES_TTL_SECS: u64 = 24 * 3600; // 1 jour pour la liste (presque pas de changement)
const PRICES_TTL_SECS: u64 = 5 * 60;          // 5 min pour les prix
const USER_AGENT: &str = "StarTradFR-CargoTracker/4.2";

// ── Types UEX API ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UexCommodity {
    pub id: u64,
    pub name: String,
    pub code: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub price_buy: Option<f64>,
    #[serde(default)]
    pub price_sell: Option<f64>,
    #[serde(default)]
    pub is_buyable: Option<u8>,
    #[serde(default)]
    pub is_sellable: Option<u8>,
}

#[derive(Debug, Deserialize)]
struct UexCommoditiesResponse {
    status: String,
    data: Vec<UexCommodity>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UexCommodityPrice {
    pub id: u64,
    pub id_commodity: u64,
    pub id_terminal: Option<u64>,
    pub price_buy: Option<f64>,
    pub price_sell: Option<f64>,
    pub price_sell_avg: Option<f64>,
    pub price_buy_avg: Option<f64>,
    #[serde(default)]
    pub date_modified: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct UexPricesResponse {
    status: String,
    data: Vec<UexCommodityPrice>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UexTerminal {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub is_visible: Option<u8>,
    #[serde(default)]
    pub id_star_system: Option<u64>,
    #[serde(default)]
    pub id_orbit: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct UexTerminalsResponse {
    status: String,
    data: Vec<UexTerminal>,
}

// ── Cache disque ────────────────────────────────────────────────────────────

fn cache_dir() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join(CACHE_DIR_NAME);
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn is_file_fresh(path: &PathBuf, ttl_secs: u64) -> bool {
    let Ok(meta) = fs::metadata(path) else { return false; };
    let Ok(modified) = meta.modified() else { return false; };
    let Ok(elapsed) = modified.elapsed() else { return false; };
    elapsed.as_secs() < ttl_secs
}

// ── Mapping GUID Game.log → UEX commodity name ──────────────────────────────
// Stratégie : cache local `guid_mapping.json` qui s'auto-remplit via détection
// par prix + shop. Quand un GUID inconnu est demandé, on l'ajoute après lookup.

fn guid_mapping_path() -> Option<PathBuf> {
    Some(cache_dir()?.join("guid_mapping.json"))
}

fn load_guid_mapping() -> HashMap<String, String> {
    let Some(path) = guid_mapping_path() else { return HashMap::new(); };
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        .unwrap_or_default()
}

fn save_guid_mapping(map: &HashMap<String, String>) {
    if let Some(path) = guid_mapping_path() {
        if let Ok(json) = serde_json::to_string_pretty(map) {
            let _ = fs::write(&path, json);
        }
    }
}

/// Catégorie (`kind`) d'une commodity par son nom (lecture sync du cache).
/// Ex : "Gold" → "Metal", "Hydrogen" → "Gas". Sert au choix de couleur overlay.
pub fn commodity_kind(name: &str) -> Option<String> {
    let dir = cache_dir()?;
    let raw = fs::read_to_string(dir.join("commodities.json")).ok()?;
    let resp: UexCommoditiesResponse = serde_json::from_str(&raw).ok()?;
    resp.data
        .iter()
        .find(|c| c.name.eq_ignore_ascii_case(name))
        .and_then(|c| c.kind.clone())
}

/// Lookup GUID dans le mapping persistant.
/// Retourne le nom UEX si déjà connu.
pub fn guid_to_commodity_name(guid: &str) -> Option<String> {
    let map = load_guid_mapping();
    map.get(&guid.to_lowercase()).cloned()
}

/// Enregistre un nouveau mapping découvert (GUID → nom UEX).
pub fn register_guid_mapping(guid: &str, commodity_name: &str) {
    let mut map = load_guid_mapping();
    map.insert(guid.to_lowercase(), commodity_name.to_string());
    save_guid_mapping(&map);
}

/// Tente d'identifier une commodity inconnue à partir de son prix observé et
/// du nom du shop. On cherche dans UEX la commodity dont le buy_price_avg à un
/// terminal lié au shopName est le plus proche du prix observé.
///
/// shopPricePerCentiSCU = aUEC par cSCU (centième de SCU).
/// On compare avec UEX price_buy_avg / 100 (car UEX stocke par SCU complet).
async fn detect_commodity_by_price_and_shop(
    price_per_csu: f64,
    shop_name: &str,
) -> Option<String> {
    if price_per_csu <= 0.0 { return None; }
    let commodities = ensure_commodities_cache().await?;
    let terminals = ensure_terminals_cache().await?;
    // Le prix UEX `price_buy` est par SCU (1 SCU = 100 cSCU) → on convertit.
    let target_price_per_scu = price_per_csu * 100.0;
    let tolerance = target_price_per_scu * 0.05; // ~5% (fluctuations)

    // Terminals dont le nom/nickname matche un mot-clé du shop SC.
    // Ex shopName "SCShop_Admin_lt_base_g" → ["admin", "base"]
    let shop_keywords = shop_keywords_from_sc_shop(shop_name);
    let candidate_terminal_ids: Vec<u64> = terminals.iter()
        .filter(|t| {
            let n = normalize(&t.name);
            let nk = normalize(t.nickname.as_deref().unwrap_or(""));
            shop_keywords.iter().any(|kw| n.contains(kw.as_str()) || nk.contains(kw.as_str()))
        })
        .map(|t| t.id)
        .collect();
    if candidate_terminal_ids.is_empty() {
        // Aucun terminal identifiable → on n'engage PAS le scan complet (coûteux).
        return None;
    }

    // id_commodity → nom (depuis le cache commodities, O(1)).
    let name_by_id: HashMap<u64, String> =
        commodities.iter().map(|c| (c.id, c.name.clone())).collect();

    // 1 appel API par terminal candidat (vs 1 par commodity avant).
    let mut best_match: Option<(String, f64)> = None; // (name, delta)
    for tid in candidate_terminal_ids {
        let Some(prices) = ensure_prices_by_terminal(tid).await else { continue; };
        for price in prices.iter() {
            if let Some(p) = price.price_buy.filter(|v| *v > 0.0) {
                let delta = (p - target_price_per_scu).abs();
                if delta < tolerance {
                    if let Some(name) = name_by_id.get(&price.id_commodity) {
                        if best_match.as_ref().map(|(_, d)| delta < *d).unwrap_or(true) {
                            best_match = Some((name.clone(), delta));
                        }
                    }
                }
            }
        }
    }
    best_match.map(|(name, _)| name)
}

/// Normalise pour matcher shop SC ↔ terminal UEX : minuscule + alphanumérique
/// uniquement (vire espaces, apostrophes, tirets). "Dumper's Depot - Area 18"
/// → "dumpersdepotarea18" ; "Area18" → "area18". INDISPENSABLE car le shopName
/// SC est collé (DumpersDepot, Area18) alors qu'UEX a des espaces/apostrophes.
fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Extrait des mots-clés de matching depuis un shopName SC interne.
/// Ex "SCShop_Admin_lt_base_g" → ["admin", "base"] (tokens normalisés).
fn shop_keywords_from_sc_shop(shop_name: &str) -> Vec<String> {
    let cleaned = shop_name.trim_start_matches("SCShop_");
    cleaned
        .split('_')
        .map(normalize)
        .filter(|s| s.len() >= 3 && s != "shop")
        .collect()
}

// ── Fetch UEX API ──────────────────────────────────────────────────────────

async fn fetch_uex_text(endpoint: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("UEX http client: {e}"))?;
    let url = format!("{}/{}", UEX_API_BASE, endpoint);
    let resp = client.get(&url).send().await
        .map_err(|e| format!("UEX fetch {endpoint}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("UEX HTTP {} for {endpoint}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("UEX read {endpoint}: {e}"))
}

async fn ensure_commodities_cache() -> Option<Vec<UexCommodity>> {
    let dir = cache_dir()?;
    let path = dir.join("commodities.json");
    if !is_file_fresh(&path, COMMODITIES_TTL_SECS) {
        if let Ok(text) = fetch_uex_text("commodities").await {
            let _ = fs::write(&path, &text);
        }
    }
    let raw = fs::read_to_string(&path).ok()?;
    let resp: UexCommoditiesResponse = serde_json::from_str(&raw).ok()?;
    Some(resp.data)
}

async fn ensure_prices_cache(commodity_id: u64) -> Option<Vec<UexCommodityPrice>> {
    let dir = cache_dir()?;
    let path = dir.join(format!("prices_{}.json", commodity_id));
    if !is_file_fresh(&path, PRICES_TTL_SECS) {
        let endpoint = format!("commodities_prices?id_commodity={}", commodity_id);
        if let Ok(text) = fetch_uex_text(&endpoint).await {
            let _ = fs::write(&path, &text);
        }
    }
    let raw = fs::read_to_string(&path).ok()?;
    let resp: UexPricesResponse = serde_json::from_str(&raw).ok()?;
    Some(resp.data)
}

/// Prix de TOUTES les commodities à un terminal donné (1 seul appel).
/// Optimise l'auto-détection : évite de fetch les prix commodity par commodity.
async fn ensure_prices_by_terminal(terminal_id: u64) -> Option<Vec<UexCommodityPrice>> {
    let dir = cache_dir()?;
    let path = dir.join(format!("prices_term_{}.json", terminal_id));
    if !is_file_fresh(&path, PRICES_TTL_SECS) {
        let endpoint = format!("commodities_prices?id_terminal={}", terminal_id);
        if let Ok(text) = fetch_uex_text(&endpoint).await {
            let _ = fs::write(&path, &text);
        }
    }
    let raw = fs::read_to_string(&path).ok()?;
    let resp: UexPricesResponse = serde_json::from_str(&raw).ok()?;
    Some(resp.data)
}

async fn ensure_terminals_cache() -> Option<Vec<UexTerminal>> {
    let dir = cache_dir()?;
    let path = dir.join("terminals.json");
    if !is_file_fresh(&path, COMMODITIES_TTL_SECS) {
        if let Ok(text) = fetch_uex_text("terminals").await {
            let _ = fs::write(&path, &text);
        }
    }
    let raw = fs::read_to_string(&path).ok()?;
    let resp: UexTerminalsResponse = serde_json::from_str(&raw).ok()?;
    Some(resp.data)
}

// ── Distances orbitales + temps de trajet (quantum) ────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct OrbitDistance {
    #[serde(default)]
    id_orbit_origin: Option<u64>,
    #[serde(default)]
    id_orbit_destination: Option<u64>,
    /// Gigamètres (Gm). ⚠️ UEX renvoie une CHAÎNE ("42"), pas un nombre.
    #[serde(default)]
    distance: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OrbitDistancesResponse {
    #[allow(dead_code)]
    status: String,
    data: Vec<OrbitDistance>,
}

/// Distances orbite↔orbite pour un couple de systèmes (cache 1 jour).
async fn ensure_orbit_distances(sys_origin: u64, sys_dest: u64) -> Option<Vec<OrbitDistance>> {
    let dir = cache_dir()?;
    let path = dir.join(format!("orbits_{}_{}.json", sys_origin, sys_dest));
    if !is_file_fresh(&path, COMMODITIES_TTL_SECS) {
        let endpoint = format!(
            "orbits_distances?id_star_system_origin={}&id_star_system_destination={}",
            sys_origin, sys_dest
        );
        if let Ok(text) = fetch_uex_text(&endpoint).await {
            let _ = fs::write(&path, &text);
        }
    }
    let raw = fs::read_to_string(&path).ok()?;
    let resp: OrbitDistancesResponse = serde_json::from_str(&raw).ok()?;
    Some(resp.data)
}

/// Vitesse quantum déclarée (km/s), lue dans overlay_settings.json (défaut 120 000).
fn load_qd_speed_kms() -> f64 {
    dirs::data_local_dir()
        .map(|p| p.join("startradfr").join("overlay_settings.json"))
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("qdSpeedKms").and_then(|x| x.as_f64()))
        .filter(|v| *v > 0.0)
        .unwrap_or(120_000.0)
}

/// Temps de trajet (s) achat→revente = distance(Gm)→km / vitesse QD (km/s).
/// None si terminal/orbite/distance inconnus.
async fn compute_travel_seconds(
    buy: Option<&UexTerminal>,
    sell: Option<&UexTerminal>,
    qd_kms: f64,
) -> Option<f64> {
    let (buy, sell) = (buy?, sell?);
    let (bs, bo) = (buy.id_star_system?, buy.id_orbit?);
    let (ss, so) = (sell.id_star_system?, sell.id_orbit?);
    if qd_kms <= 0.0 {
        return None;
    }
    if bs == ss && bo == so {
        return Some(0.0); // même orbite
    }
    let dists = ensure_orbit_distances(bs, ss).await?;
    let gm = dists.iter().find_map(|d| {
        let o = d.id_orbit_origin?;
        let dst = d.id_orbit_destination?;
        if (o == bo && dst == so) || (o == so && dst == bo) {
            d.distance.as_deref()?.parse::<f64>().ok()
        } else {
            None
        }
    })?;
    Some((gm * 1_000_000.0) / qd_kms) // Gm → km, / (km/s)
}

// ── API publique ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellSuggestion {
    pub terminal_name: String,
    pub sell_price_per_csu: f64,
    pub sell_price_total: f64,       // = sell_price_per_csu * quantity_csu
    pub profit_total: f64,           // = sell_price_total - buy_price_total
    pub profit_per_csu: f64,
    pub profit_percent: f64,         // (profit / buy_price_total) * 100
    pub travel_seconds: Option<f64>, // trajet achat→revente (None si inconnu)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommoditySuggestionResult {
    pub commodity_name: String,
    pub commodity_guid: String,
    pub quantity_scu: f64,
    pub buy_price_total: f64,
    pub buy_price_per_csu: f64,
    pub top_sell_locations: Vec<SellSuggestion>,
    pub note: Option<String>, // ex "GUID inconnu — affichage best-effort"
}

/// Suggère les meilleures reventes pour une commodity donnée.
/// Top 3 par sell_price décroissant.
///
/// Si le GUID est inconnu, on tente l'auto-détection via prix + shop. Si la
/// détection réussit, on enregistre le mapping pour les futurs lookups.
#[tauri::command]
pub async fn suggest_sell_locations(
    commodity_guid: String,
    quantity_csu: f64,
    buy_price_total: f64,
    price_per_csu: Option<f64>,
    shop_name: Option<String>,
) -> Result<CommoditySuggestionResult, String> {
    let mut commodity_name = guid_to_commodity_name(&commodity_guid);
    let mut note = None;

    // Auto-détection si GUID inconnu
    if commodity_name.is_none() {
        if let (Some(price), Some(shop)) = (price_per_csu, shop_name.as_deref()) {
            if let Some(detected) = detect_commodity_by_price_and_shop(price, shop).await {
                register_guid_mapping(&commodity_guid, &detected);
                note = Some(format!("Auto-détecté via prix : {} (mapping enregistré)", detected));
                commodity_name = Some(detected);
            } else {
                note = Some(format!("GUID {} non mappé et auto-détection impossible — vérifie UEX", &commodity_guid[..8.min(commodity_guid.len())]));
            }
        } else {
            note = Some(format!("GUID {} non mappé — fournir price_per_csu + shop_name pour auto-détection", &commodity_guid[..8.min(commodity_guid.len())]));
        }
    }

    let commodity_name = commodity_name.unwrap_or_else(|| format!("Commodity #{}", &commodity_guid[..8.min(commodity_guid.len())]));

    let buy_price_per_csu = if quantity_csu > 0.0 { buy_price_total / quantity_csu } else { 0.0 };
    let quantity_scu = quantity_csu / 100.0; // UEX raisonne en SCU (1 SCU = 100 cSCU)
    let mut top_sell_locations = Vec::new();

    if let Some(commodities) = ensure_commodities_cache().await {
        if let Some(commodity) = commodities.iter().find(|c| c.name.eq_ignore_ascii_case(&commodity_name)) {
            if let Some(prices) = ensure_prices_cache(commodity.id).await {
                // Filtre les terminals qui vendent (sell_price > 0)
                let mut sellable: Vec<&UexCommodityPrice> = prices.iter()
                    .filter(|p| p.price_sell.unwrap_or(0.0) > 0.0)
                    .collect();
                sellable.sort_by(|a, b| {
                    b.price_sell.unwrap_or(0.0).partial_cmp(&a.price_sell.unwrap_or(0.0))
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

                let terminals = ensure_terminals_cache().await.unwrap_or_default();
                let terminal_by_id: HashMap<u64, &UexTerminal> = terminals.iter().map(|t| (t.id, t)).collect();

                // Terminal d'ACHAT (pour le temps de trajet) : parmi les terminals
                // qui TRADENT cette commodity, celui dont le nom matche le shop SC.
                // (Sinon le 1er "admin"/"base" parmi 800+ terminals = faux positif
                // avec une orbite sans distance vers les reventes → pas d'ETA.)
                let buy_term: Option<&UexTerminal> = shop_name.as_deref().and_then(|s| {
                    let kws = shop_keywords_from_sc_shop(s);
                    if kws.is_empty() {
                        return None;
                    }
                    prices
                        .iter()
                        .filter_map(|p| p.id_terminal)
                        .filter_map(|tid| terminal_by_id.get(&tid).copied())
                        .find(|t| {
                            let n = normalize(&t.name);
                            let nk = normalize(t.nickname.as_deref().unwrap_or(""));
                            kws.iter().any(|k| n.contains(k.as_str()) || nk.contains(k.as_str()))
                        })
                });
                let qd_kms = load_qd_speed_kms();

                for price in sellable.into_iter().take(3) {
                    // UEX price_sell est PAR SCU ; on revend `quantity_scu` SCU.
                    let sell_per_scu = price.price_sell.unwrap_or(0.0);
                    let sell_per_csu = sell_per_scu / 100.0;
                    let sell_total = sell_per_scu * quantity_scu;
                    let profit = sell_total - buy_price_total;
                    let profit_pct = if buy_price_total > 0.0 { (profit / buy_price_total) * 100.0 } else { 0.0 };
                    let sell_term: Option<&UexTerminal> =
                        price.id_terminal.and_then(|tid| terminal_by_id.get(&tid).copied());
                    let terminal_name = sell_term
                        .map(|t| t.nickname.clone().unwrap_or_else(|| t.name.clone()))
                        .unwrap_or_else(|| "Terminal inconnu".to_string());
                    let travel_seconds = compute_travel_seconds(buy_term, sell_term, qd_kms).await;
                    top_sell_locations.push(SellSuggestion {
                        terminal_name,
                        sell_price_per_csu: sell_per_csu,
                        sell_price_total: sell_total,
                        profit_total: profit,
                        profit_per_csu: sell_per_csu - buy_price_per_csu,
                        profit_percent: profit_pct,
                        travel_seconds,
                    });
                }
            }
        }
    }

    Ok(CommoditySuggestionResult {
        commodity_name,
        commodity_guid,
        quantity_scu: quantity_csu / 100.0,
        buy_price_total,
        buy_price_per_csu,
        top_sell_locations,
        note,
    })
}

// ── Singleton commodities (préchargé pour les lookups O(1)) ─────────────────

static COMMODITIES_BY_NAME: OnceLock<Mutex<HashMap<String, UexCommodity>>> = OnceLock::new();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guid_lookup_unknown_is_none() {
        // Le mapping persistant peut être vide en environnement de test
        assert!(guid_to_commodity_name("definitely-not-a-real-guid-12345").is_none());
    }

    /// Test auto-détection sur des données réelles d'acki.
    /// cargo test --release --lib uex_auto_detect_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn uex_auto_detect_smoke() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        // GUID vu chez acki avec prix 22.29 au shop Admin lt_base_g
        let result = rt.block_on(detect_commodity_by_price_and_shop(22.29, "SCShop_Admin_lt_base_g"));
        println!("Detection result (price 22.29 @ Admin lt_base_g): {:?}", result);
        // Et un autre prix plus bas
        let result2 = rt.block_on(detect_commodity_by_price_and_shop(5.35, "SCShop_Admin_lt_base_g"));
        println!("Detection result (price 5.35 @ Admin lt_base_g): {:?}", result2);
    }

    /// Force fetch UEX commodities pour valider que l'API marche.
    /// cargo test --release --lib uex_fetch_commodities_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn uex_fetch_commodities_smoke() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let commodities = rt.block_on(ensure_commodities_cache()).expect("fetch failed");
        println!("UEX commodities count: {}", commodities.len());
        println!("First 5: {:?}", commodities.iter().take(5).map(|c| &c.name).collect::<Vec<_>>());
    }
}
