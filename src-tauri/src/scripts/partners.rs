use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

const DISCORD_INVITE_BASE: &str = "https://discord.com/api/v10/invites";
const USER_AGENT: &str = "StarTradFR-Partners/1.0";
/// Cache TTL: 10 minutes. Discord rate-limits ~1 req/s on this endpoint and
/// the count changes slowly, so we don't need a fresh value on every page load.
const DISCORD_CACHE_TTL_SECS: u64 = 600;
/// Twitch avatar barely changes; cache 24h.
const TWITCH_AVATAR_CACHE_TTL_SECS: u64 = 24 * 3600;
/// Twitch live status changes fast; cache 3 min.
const TWITCH_LIVE_CACHE_TTL_SECS: u64 = 180;
const DECAPI_BASE: &str = "https://decapi.me/twitch";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscordInviteInfo {
    pub code: String,
    pub guild_id: Option<String>,
    pub guild_name: Option<String>,
    pub guild_icon_url: Option<String>,
    pub approximate_member_count: Option<u64>,
    pub approximate_presence_count: Option<u64>,
    /// Unix timestamp (seconds) when this entry was fetched.
    pub fetched_at: u64,
    /// True when the value comes from the disk cache (no live HTTP call).
    pub from_cache: bool,
}

#[derive(Deserialize)]
struct RawInviteResponse {
    code: Option<String>,
    approximate_member_count: Option<u64>,
    approximate_presence_count: Option<u64>,
    guild: Option<RawInviteGuild>,
}

#[derive(Deserialize)]
struct RawInviteGuild {
    id: Option<String>,
    name: Option<String>,
    icon: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    code: String,
    guild_id: Option<String>,
    guild_name: Option<String>,
    guild_icon: Option<String>,
    approximate_member_count: Option<u64>,
    approximate_presence_count: Option<u64>,
    fetched_at: u64,
}

fn discord_cache_path() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("partners");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("discord_invites.json"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_cache() -> HashMap<String, CacheEntry> {
    let Some(path) = discord_cache_path() else {
        return HashMap::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_cache(map: &HashMap<String, CacheEntry>) {
    let Some(path) = discord_cache_path() else { return };
    if let Ok(serialized) = serde_json::to_string(map) {
        let _ = fs::write(&path, serialized);
    }
}

fn build_guild_icon_url(guild_id: Option<&str>, icon_hash: Option<&str>) -> Option<String> {
    let id = guild_id?;
    let hash = icon_hash?;
    // Animated icons start with "a_" — request gif extension in that case.
    let ext = if hash.starts_with("a_") { "gif" } else { "png" };
    Some(format!(
        "https://cdn.discordapp.com/icons/{}/{}.{}?size=256",
        id, hash, ext
    ))
}

fn entry_to_info(entry: &CacheEntry, from_cache: bool) -> DiscordInviteInfo {
    DiscordInviteInfo {
        code: entry.code.clone(),
        guild_id: entry.guild_id.clone(),
        guild_name: entry.guild_name.clone(),
        guild_icon_url: build_guild_icon_url(
            entry.guild_id.as_deref(),
            entry.guild_icon.as_deref(),
        ),
        approximate_member_count: entry.approximate_member_count,
        approximate_presence_count: entry.approximate_presence_count,
        fetched_at: entry.fetched_at,
        from_cache,
    }
}

/// Strips any `https://discord.gg/`, `https://discord.com/invite/`, or
/// trailing query string from an invite, returning the bare code.
fn normalize_invite_code(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_proto = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let without_host = without_proto
        .trim_start_matches("discord.gg/")
        .trim_start_matches("discord.com/invite/")
        .trim_start_matches("www.discord.gg/");
    without_host.split(['?', '/']).next().unwrap_or("").to_string()
}

async fn fetch_invite_live(code: &str) -> Result<CacheEntry, String> {
    let url = format!("{}/{}?with_counts=true", DISCORD_INVITE_BASE, code);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Impossible d'initialiser le client HTTP: {}", e))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau vers Discord: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Discord a renvoye un statut HTTP {}",
            response.status()
        ));
    }
    let raw: RawInviteResponse = response
        .json()
        .await
        .map_err(|e| format!("Reponse Discord illisible: {}", e))?;

    Ok(CacheEntry {
        code: raw.code.unwrap_or_else(|| code.to_string()),
        guild_id: raw.guild.as_ref().and_then(|g| g.id.clone()),
        guild_name: raw.guild.as_ref().and_then(|g| g.name.clone()),
        guild_icon: raw.guild.as_ref().and_then(|g| g.icon.clone()),
        approximate_member_count: raw.approximate_member_count,
        approximate_presence_count: raw.approximate_presence_count,
        fetched_at: now_secs(),
    })
}

/// Fetch (with disk cache) the approximate member + presence counts for a
/// Discord invite. `code_or_url` can be the bare code (`75gpShnHx`) or a
/// full URL (`https://discord.gg/75gpShnHx`).
#[command]
pub async fn partners_fetch_discord_invite(
    code_or_url: String,
    force_refresh: Option<bool>,
) -> Result<DiscordInviteInfo, String> {
    let code = normalize_invite_code(&code_or_url);
    if code.is_empty() {
        return Err("Code d'invitation Discord vide".into());
    }

    let force = force_refresh.unwrap_or(false);
    let now = now_secs();
    let mut cache = read_cache();

    if !force {
        if let Some(entry) = cache.get(&code) {
            if now.saturating_sub(entry.fetched_at) < DISCORD_CACHE_TTL_SECS {
                return Ok(entry_to_info(entry, true));
            }
        }
    }

    match fetch_invite_live(&code).await {
        Ok(entry) => {
            cache.insert(code.clone(), entry.clone());
            write_cache(&cache);
            Ok(entry_to_info(&entry, false))
        }
        Err(e) => {
            // Fall back to stale cache if the live fetch fails (rate-limit, offline, etc.)
            if let Some(entry) = cache.get(&code) {
                return Ok(entry_to_info(entry, true));
            }
            Err(e)
        }
    }
}

// ───────── Twitch (via decapi.me, no auth) ─────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TwitchStatusInfo {
    pub login: String,
    pub avatar_url: Option<String>,
    pub live: bool,
    pub uptime: Option<String>,
    pub fetched_at: u64,
    pub from_cache: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct TwitchCacheEntry {
    avatar_url: Option<String>,
    avatar_fetched_at: u64,
    live: bool,
    uptime: Option<String>,
    live_fetched_at: u64,
}

fn twitch_cache_path() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("partners");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("twitch_status.json"))
}

fn read_twitch_cache() -> HashMap<String, TwitchCacheEntry> {
    let Some(path) = twitch_cache_path() else {
        return HashMap::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_twitch_cache(map: &HashMap<String, TwitchCacheEntry>) {
    let Some(path) = twitch_cache_path() else { return };
    if let Ok(serialized) = serde_json::to_string(map) {
        let _ = fs::write(&path, serialized);
    }
}

/// Strips `https://www.twitch.tv/` (and variants) from the input to get a
/// bare login. Accepts both raw logins and full Twitch URLs.
fn normalize_twitch_login(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_proto = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let without_host = without_proto
        .trim_start_matches("www.twitch.tv/")
        .trim_start_matches("twitch.tv/")
        .trim_start_matches("m.twitch.tv/");
    without_host
        .split(['?', '/'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Erreur reseau vers decapi: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("decapi a renvoye un statut HTTP {}", response.status()));
    }
    response
        .text()
        .await
        .map_err(|e| format!("Reponse decapi illisible: {}", e))
}

/// Fetches the Twitch avatar URL + live status via decapi.me (zero auth).
/// Each piece has its own cache TTL (24h for avatar, 3 min for live status).
#[command]
pub async fn partners_fetch_twitch_status(
    login_or_url: String,
    force_refresh: Option<bool>,
) -> Result<TwitchStatusInfo, String> {
    let login = normalize_twitch_login(&login_or_url);
    if login.is_empty() {
        return Err("Login Twitch vide".into());
    }

    let force = force_refresh.unwrap_or(false);
    let now = now_secs();
    let mut cache = read_twitch_cache();
    let mut entry = cache.get(&login).cloned().unwrap_or_default();

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Impossible d'initialiser le client HTTP: {}", e))?;

    let avatar_stale = force
        || entry.avatar_url.is_none()
        || now.saturating_sub(entry.avatar_fetched_at) >= TWITCH_AVATAR_CACHE_TTL_SECS;
    let live_stale = force
        || now.saturating_sub(entry.live_fetched_at) >= TWITCH_LIVE_CACHE_TTL_SECS;

    let mut from_cache = !avatar_stale && !live_stale;

    if avatar_stale {
        match fetch_text(&client, &format!("{}/avatar/{}", DECAPI_BASE, login)).await {
            Ok(text) => {
                let trimmed = text.trim();
                // decapi returns a URL on success, or an error sentence like
                // "User not found" otherwise.
                if trimmed.starts_with("http") {
                    entry.avatar_url = Some(trimmed.to_string());
                    entry.avatar_fetched_at = now;
                } else if entry.avatar_url.is_none() {
                    // keep none, but mark fetched so we don't retry on every load
                    entry.avatar_fetched_at = now;
                }
            }
            Err(_) => {
                if entry.avatar_url.is_some() {
                    from_cache = true;
                }
            }
        }
    }

    if live_stale {
        match fetch_text(&client, &format!("{}/uptime/{}", DECAPI_BASE, login)).await {
            Ok(text) => {
                let trimmed = text.trim();
                let lower = trimmed.to_ascii_lowercase();
                let is_offline = lower.contains("is offline")
                    || lower.contains("not live")
                    || lower.contains("user not found");
                entry.live = !is_offline && !trimmed.is_empty();
                entry.uptime = if entry.live {
                    Some(trimmed.to_string())
                } else {
                    None
                };
                entry.live_fetched_at = now;
            }
            Err(_) => {
                // keep previous live state on network error
                from_cache = true;
            }
        }
    }

    cache.insert(login.clone(), entry.clone());
    write_twitch_cache(&cache);

    Ok(TwitchStatusInfo {
        login,
        avatar_url: entry.avatar_url,
        live: entry.live,
        uptime: entry.uptime,
        fetched_at: now,
        from_cache,
    })
}
