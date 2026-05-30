// Cache des profils RSI Citizens publics.
//
// Pour chaque handle (login compte ou moniker in-game), on tente de fetch
// https://robertsspaceindustries.com/citizens/<handle> et on en extrait :
//   - display_name (nom affiché)
//   - avatar_url (URL CDN de la photo)
//   - org_name + org_url (organisation principale, si publique)
//
// On cache le résultat (succès ou 404) dans `app_config_dir/citizens_cache.json`
// pour éviter de re-fetch à chaque démarrage. TTL par défaut : 30 jours.
//
// Privacy : on ne fetch que des handles déjà rencontrés en jeu (logs Game.log),
// et on ne stocke aucune info personnelle au-delà des champs publics RSI.

use crate::scripts::citizen_tags::{get_tag_for_handle, CitizenTag};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CACHE_FILENAME: &str = "citizens_cache.json";
// v2 : strip "Roberts Space Industries" / "Star Citizen" du displayName parsé.
const CACHE_SCHEMA_VERSION: u32 = 2;
const DEFAULT_TTL_DAYS: u64 = 30;
const USER_AGENT: &str = "StarTradFR/4.2.x (https://startradfr.fr)";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitizenProfile {
    pub handle: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub org_name: Option<String>,
    pub org_sid: Option<String>,
    pub status: ProfileStatus,
    pub fetched_at: u64, // unix ts
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileStatus {
    Found,
    NotFound,
    Private,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    schema_version: u32,
    profiles: HashMap<String, CitizenProfile>, // key = handle lowercased
}

impl Default for CacheFile {
    fn default() -> Self {
        Self {
            schema_version: CACHE_SCHEMA_VERSION,
            profiles: HashMap::new(),
        }
    }
}

fn cache_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Impossible d'obtenir app_config_dir : {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {}: {e}", dir.display()))?;
    Ok(dir.join(CACHE_FILENAME))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_cache<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> CacheFile {
    let path = match cache_path(app) {
        Ok(p) => p,
        Err(_) => return CacheFile::default(),
    };
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return CacheFile::default(),
    };
    match serde_json::from_str::<CacheFile>(&raw) {
        Ok(c) if c.schema_version == CACHE_SCHEMA_VERSION => c,
        _ => CacheFile::default(),
    }
}

fn save_cache<R: tauri::Runtime>(app: &tauri::AppHandle<R>, cache: &CacheFile) -> Result<(), String> {
    let path = cache_path(app)?;
    let json =
        serde_json::to_string_pretty(cache).map_err(|e| format!("Sérialisation JSON : {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Écriture {} : {e}", path.display()))
}

fn is_expired(profile: &CitizenProfile, ttl_days: u64) -> bool {
    let now = now_secs();
    let ttl_secs = ttl_days * 86400;
    now > profile.fetched_at + ttl_secs
}

/// Parse l'HTML d'une page profil RSI pour en extraire avatar + org.
/// Robuste aux changements mineurs de markup (regex large + fallback).
fn parse_profile_html(handle: &str, html: &str) -> CitizenProfile {
    // Avatar : <div class="thumb"><img src="..."/> ou <img class="profile-image" src=...>
    let avatar_re_list = [
        r#"<div class="thumb"[^>]*>\s*<img[^>]+src="([^"]+)""#,
        r#"<img[^>]+class="[^"]*profile-image[^"]*"[^>]+src="([^"]+)""#,
        r#"<img[^>]+class="[^"]*avatar[^"]*"[^>]+src="([^"]+)""#,
    ];
    let mut avatar_url: Option<String> = None;
    for pat in avatar_re_list {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(caps) = re.captures(html) {
                let raw = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !raw.is_empty() {
                    avatar_url = Some(normalize_url(&raw));
                    break;
                }
            }
        }
    }

    // Display name : tag <h1 class="info"> ou similaire, ou meta og:title
    let display_re_list = [
        r#"<meta[^>]+property="og:title"[^>]+content="([^"]+)""#,
        r#"<h1[^>]+class="[^"]*info[^"]*"[^>]*>\s*([^<]+)\s*<"#,
        r#"<title>\s*([^<]+)\s*-\s*Roberts Space"#,
    ];
    let mut display_name: Option<String> = None;
    for pat in display_re_list {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(caps) = re.captures(html) {
                let raw = caps.get(1).map(|m| m.as_str()).unwrap_or("").trim().to_string();
                if !raw.is_empty() {
                    display_name = Some(clean_display_name(&raw));
                    break;
                }
            }
        }
    }

    // Org : <a class="org" href="/orgs/SID">NAME</a> ou data-org-id
    let mut org_name: Option<String> = None;
    let mut org_sid: Option<String> = None;
    if let Ok(re) = regex::Regex::new(
        r#"<a[^>]+href="/orgs/([A-Z0-9_]+)"[^>]*>\s*([^<]+?)\s*</a>"#,
    ) {
        if let Some(caps) = re.captures(html) {
            org_sid = caps.get(1).map(|m| m.as_str().to_string());
            org_name = caps.get(2).map(|m| m.as_str().trim().to_string());
        }
    }

    CitizenProfile {
        handle: handle.to_string(),
        display_name,
        avatar_url,
        org_name,
        org_sid,
        status: ProfileStatus::Found,
        fetched_at: now_secs(),
    }
}

/// Nettoie un display_name parsé du HTML RSI pour ne garder que le handle.
/// Strip les suffixes "- Roberts Space Industries", "| Star Citizen", etc.
fn clean_display_name(raw: &str) -> String {
    let mut s = raw.trim().to_string();

    // Strip après " - " ou " | "
    for sep in [" - ", " | ", " — ", " : "] {
        if let Some(idx) = s.find(sep) {
            s.truncate(idx);
            s = s.trim().to_string();
        }
    }

    // Strip patterns marketing RSI/SC isolés ou collés
    let suffixes_to_strip = [
        " Roberts Space Industries",
        "Roberts Space Industries",
        " Star Citizen",
        "Star Citizen",
        " - RSI",
        " RSI",
        " Citizen Profile",
        " Profile",
    ];
    for suffix in suffixes_to_strip {
        if let Some(idx) = s.to_lowercase().find(&suffix.to_lowercase()) {
            s.truncate(idx);
            s = s.trim().to_string();
        }
    }

    // Nettoie les caractères de ponctuation orphelins en bout
    s = s.trim_end_matches(['-', '|', '—', ':', ',', ' ']).to_string();
    s.trim().to_string()
}

/// Normalise une URL : ajoute "https:" si manquant.
fn normalize_url(raw: &str) -> String {
    if raw.starts_with("//") {
        format!("https:{}", raw)
    } else if raw.starts_with("/") {
        format!("https://robertsspaceindustries.com{}", raw)
    } else {
        raw.to_string()
    }
}

/// Fetch un profil RSI en HTTP. Retourne le profil parsé ou un statut d'erreur.
pub async fn fetch_profile(handle: &str) -> CitizenProfile {
    let url = format!("https://robertsspaceindustries.com/citizens/{}", handle);
    let client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return CitizenProfile {
                handle: handle.to_string(),
                display_name: None,
                avatar_url: None,
                org_name: None,
                org_sid: None,
                status: ProfileStatus::Error,
                fetched_at: now_secs(),
            };
        }
    };
    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => {
            return CitizenProfile {
                handle: handle.to_string(),
                display_name: None,
                avatar_url: None,
                org_name: None,
                org_sid: None,
                status: ProfileStatus::Error,
                fetched_at: now_secs(),
            };
        }
    };

    let status = response.status();
    if status.as_u16() == 404 {
        return CitizenProfile {
            handle: handle.to_string(),
            display_name: None,
            avatar_url: None,
            org_name: None,
            org_sid: None,
            status: ProfileStatus::NotFound,
            fetched_at: now_secs(),
        };
    }
    if !status.is_success() {
        return CitizenProfile {
            handle: handle.to_string(),
            display_name: None,
            avatar_url: None,
            org_name: None,
            org_sid: None,
            status: ProfileStatus::Error,
            fetched_at: now_secs(),
        };
    }

    let html = match response.text().await {
        Ok(t) => t,
        Err(_) => {
            return CitizenProfile {
                handle: handle.to_string(),
                display_name: None,
                avatar_url: None,
                org_name: None,
                org_sid: None,
                status: ProfileStatus::Error,
                fetched_at: now_secs(),
            };
        }
    };

    // Détection profil privé : RSI affiche un message "This is a private profile"
    if html.to_lowercase().contains("this is a private profile")
        || html.to_lowercase().contains("profile is private")
    {
        return CitizenProfile {
            handle: handle.to_string(),
            display_name: None,
            avatar_url: None,
            org_name: None,
            org_sid: None,
            status: ProfileStatus::Private,
            fetched_at: now_secs(),
        };
    }

    parse_profile_html(handle, &html)
}

/// Enrichit une liste de handles : pour chaque, lookup cache puis fetch si
/// absent ou expiré. Retourne tous les profils (même Error/NotFound).
///
/// Stratégie perf : on traite les cache hits instantanément, puis on fetch
/// les manquants en parallèle (chunks de 8 simultanés). Permet de réduire
/// le temps total de ~60×150ms (=9s séquentiel) à ~8 × ~600ms (=5s).
pub async fn enrich_handles<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    handles: &[String],
    ttl_days: Option<u64>,
) -> Vec<CitizenProfile> {
    let ttl = ttl_days.unwrap_or(DEFAULT_TTL_DAYS);
    let cache = load_cache(app);

    // Pass 1 : sépare cache hits vs misses, préserve l'ordre d'entrée
    let mut result: Vec<Option<CitizenProfile>> = vec![None; handles.len()];
    let mut to_fetch: Vec<(usize, String)> = Vec::new();
    for (i, handle) in handles.iter().enumerate() {
        let key = handle.to_lowercase();
        if let Some(cached) = cache.profiles.get(&key) {
            if !is_expired(cached, ttl) {
                result[i] = Some(cached.clone());
                continue;
            }
        }
        to_fetch.push((i, handle.clone()));
    }

    // Pass 2 : fetch les manquants en chunks de 8 en parallèle (rate-friendly)
    const CHUNK_SIZE: usize = 8;
    let mut fetched_profiles: Vec<(String, CitizenProfile)> = Vec::with_capacity(to_fetch.len());
    for chunk in to_fetch.chunks(CHUNK_SIZE) {
        let futures: Vec<_> = chunk.iter().map(|(_, h)| {
            let h = h.clone();
            async move {
                let p = fetch_profile(&h).await;
                (h, p)
            }
        }).collect();
        let results: Vec<(String, CitizenProfile)> = futures_util::future::join_all(futures).await;
        for (h, p) in results.iter() {
            fetched_profiles.push((h.clone(), p.clone()));
        }
        // Petit délai entre chunks pour rester sympa avec RSI
        if chunk.len() == CHUNK_SIZE {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    // Pass 3 : merge les fetched dans le result + persiste le cache
    let mut cache = cache;
    let mut cache_dirty = false;
    for ((idx, _), (_, profile)) in to_fetch.iter().zip(fetched_profiles.iter()) {
        let key = profile.handle.to_lowercase();
        cache.profiles.insert(key, profile.clone());
        cache_dirty = true;
        result[*idx] = Some(profile.clone());
    }
    if cache_dirty {
        let _ = save_cache(app, &cache);
    }

    // Pass 4 : flatten (None ne devrait jamais arriver mais on garde safe)
    result.into_iter().flatten().collect()
}

/// Force un refresh d'un handle (ignore le cache).
pub async fn refresh_handle<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    handle: &str,
) -> CitizenProfile {
    let mut cache = load_cache(app);
    let profile = fetch_profile(handle).await;
    cache.profiles.insert(handle.to_lowercase(), profile.clone());
    let _ = save_cache(app, &cache);
    profile
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedPlayer {
    pub handle: String,
    pub profile: CitizenProfile,
    pub tag: Option<CitizenTag>,
}

/// Enrichit une liste de handles avec leur profil RSI (avatar + org) et leur
/// tag user (friend/org/enemy). Utilisé par le carnet pour afficher les
/// rencontres en combat.
#[tauri::command]
pub async fn enrich_encountered_players<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    handles: Vec<String>,
    ttl_days: Option<u64>,
) -> Result<Vec<EnrichedPlayer>, String> {
    let profiles = enrich_handles(&app, &handles, ttl_days).await;
    let mut out = Vec::with_capacity(profiles.len());
    for p in profiles {
        let tag = get_tag_for_handle(&app, &p.handle);
        out.push(EnrichedPlayer {
            handle: p.handle.clone(),
            profile: p,
            tag,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn citizen_profile_refresh<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    handle: String,
) -> Result<CitizenProfile, String> {
    Ok(refresh_handle(&app, &handle).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_handles_protocol_relative() {
        assert_eq!(normalize_url("//cdn.example.com/img.jpg"), "https://cdn.example.com/img.jpg");
    }

    #[test]
    fn normalize_url_handles_absolute_path() {
        assert_eq!(
            normalize_url("/media/foo.png"),
            "https://robertsspaceindustries.com/media/foo.png"
        );
    }

    #[test]
    fn normalize_url_keeps_full_url() {
        assert_eq!(
            normalize_url("https://example.com/x.png"),
            "https://example.com/x.png"
        );
    }

    #[test]
    fn clean_display_name_strips_rsi_suffix() {
        assert_eq!(clean_display_name("R-om - Roberts Space Industries"), "R-om");
        assert_eq!(clean_display_name("Skjorn_Vaal | Star Citizen"), "Skjorn_Vaal");
        assert_eq!(clean_display_name("DefloiX - Star Citizen | Roberts Space Industries"), "DefloiX");
        assert_eq!(clean_display_name("  Knuckle28  "), "Knuckle28");
        assert_eq!(clean_display_name("R-om - "), "R-om");
        assert_eq!(clean_display_name("foo Citizen Profile"), "foo");
    }

    #[test]
    fn parse_avatar_basic() {
        let html = r#"
            <html><body>
            <div class="thumb"><img src="//cdn.robertsspaceindustries.com/avatar.jpg"/></div>
            <a href="/orgs/STARTRAD">StarTrad FR</a>
            </body></html>
        "#;
        let profile = parse_profile_html("R-om", html);
        assert_eq!(profile.handle, "R-om");
        assert_eq!(profile.avatar_url.as_deref(), Some("https://cdn.robertsspaceindustries.com/avatar.jpg"));
        assert_eq!(profile.org_sid.as_deref(), Some("STARTRAD"));
        assert_eq!(profile.org_name.as_deref(), Some("StarTrad FR"));
    }
}
