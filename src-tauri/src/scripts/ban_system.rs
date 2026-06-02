//! Système de ban (compte + lien machine) — voir note cerveau
//! "Système de ban & audit logs carnet".
//!
//! 🔑 RÈGLE D'OR : FAIL-OPEN partout. Tout check qui plante / Supabase down
//! => on laisse passer. JAMAIS de faux-ban. Le ban est volontairement "soft"
//! (overlay côté front) : il garde la session active mais verrouille l'UI.

use serde::Serialize;
use tauri::command;

const SUPABASE_URL: &str = "https://rronicslgyoubiofbinu.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyb25pY3NsZ3lvdWJpb2ZiaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTQwNzIsImV4cCI6MjA4MDE5MDA3Mn0.YzsYpn0_2PTrCaqchZAixW_Fh-8iQLcHImgwGM3mGr4";

/// HWID stable de la machine : SHA-256 du `MachineGuid` Windows (registre).
/// Échec => `Err` ; le front traite l'absence de HWID comme "pas de lien device"
/// (fail-soft : le device n'est juste pas enregistré, aucun impact sur le ban compte).
#[command]
pub fn get_machine_id() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use sha2::{Digest, Sha256};
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let crypto = hklm
            .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
            .map_err(|e| format!("registre Cryptography: {}", e))?;
        let guid: String = crypto
            .get_value("MachineGuid")
            .map_err(|e| format!("MachineGuid: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(b"startrad-hwid-v1:");
        hasher.update(guid.trim().as_bytes());
        let digest = hasher.finalize();
        Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("HWID indisponible sur cette plateforme".to_string())
    }
}

#[derive(Serialize)]
pub struct BanStatus {
    pub banned: bool,
    pub reason: Option<String>,
    /// 'soft' | 'severe' (None pour un ban machine). Seul 'severe' déclenche la suppression.
    pub severity: Option<String>,
}

fn not_banned() -> BanStatus {
    BanStatus {
        banned: false,
        reason: None,
        severity: None,
    }
}

/// Vérifie si le compte est banni (table `banned_users`, RLS read-own).
/// 🔑 FAIL-OPEN : toute erreur réseau / HTTP / parse => non banni.
#[command]
pub fn check_user_banned(user_id: String, access_token: String) -> BanStatus {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return not_banned(),
    };

    let url = format!(
        "{}/rest/v1/banned_users?user_id=eq.{}&select=reason,severity",
        SUPABASE_URL, user_id
    );

    let resp = match client
        .get(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .send()
    {
        Ok(r) => r,
        Err(_) => return not_banned(),
    };

    if !resp.status().is_success() {
        return not_banned();
    }

    let body = match resp.text() {
        Ok(t) => t,
        Err(_) => return not_banned(),
    };

    match serde_json::from_str::<Vec<serde_json::Value>>(&body) {
        Ok(rows) if !rows.is_empty() => BanStatus {
            banned: true,
            reason: rows[0]
                .get("reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            severity: rows[0]
                .get("severity")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        },
        _ => not_banned(),
    }
}

/// Vérifie si la MACHINE (HWID) est bannie, via l'edge function service-role
/// `check-hwid-ban` (sans auth : l'évadeur n'a pas de session). Gaté côté
/// fonction par `machine_ban_enabled`. 🔑 FAIL-OPEN.
#[command]
pub fn check_hwid_banned(hwid: String) -> BanStatus {
    if hwid.trim().is_empty() {
        return not_banned();
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return not_banned(),
    };

    let url = format!("{}/functions/v1/check-hwid-ban", SUPABASE_URL);
    let resp = match client
        .post(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON_KEY))
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "hwid": hwid }).to_string())
        .send()
    {
        Ok(r) => r,
        Err(_) => return not_banned(),
    };

    if !resp.status().is_success() {
        return not_banned();
    }
    let body = match resp.text() {
        Ok(t) => t,
        Err(_) => return not_banned(),
    };

    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(v) if v.get("banned").and_then(|b| b.as_bool()).unwrap_or(false) => BanStatus {
            banned: true,
            reason: v.get("reason").and_then(|r| r.as_str()).map(|s| s.to_string()),
            severity: None,
        },
        _ => not_banned(),
    }
}

/// Lie le HWID à l'identité du compte (table `user_devices`, upsert sur
/// `(user_id, hwid)`). Anti-évasion : retrouver les multi-comptes d'une machine.
/// Fail-soft : le front ignore l'erreur (aucun impact sur le ban).
#[command]
#[allow(clippy::too_many_arguments)]
pub fn link_user_device(
    access_token: String,
    user_id: String,
    hwid: String,
    email: Option<String>,
    discord_id: Option<String>,
    discord_username: Option<String>,
    discord_global_name: Option<String>,
) -> Result<(), String> {
    if hwid.trim().is_empty() {
        return Err("hwid vide".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/rest/v1/user_devices?on_conflict=user_id,hwid", SUPABASE_URL);
    let body = serde_json::json!({
        "user_id": user_id,
        "hwid": hwid,
        "email": email,
        "discord_id": discord_id,
        "discord_username": discord_username,
        "discord_global_name": discord_global_name,
        "last_seen": chrono::Utc::now().to_rfc3339(),
    });

    let resp = client
        .post(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .body(body.to_string())
        .send()
        .map_err(|e| format!("link device: {}", e))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let code = resp.status();
        let txt = resp.text().unwrap_or_default();
        Err(format!("link device {}: {}", code, txt))
    }
}
