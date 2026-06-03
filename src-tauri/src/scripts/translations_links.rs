use regex::Regex;
use serde_json::Value;
use tauri::command;
use std::collections::HashMap;

/// Récupère la date de dernière mise à jour d'une traduction
/// Pour GitHub: utilise l'API commits
/// Pour Circuspes: parse la 4ème ligne du fichier
#[command]
pub async fn get_translation_last_updated(url: String) -> Result<Option<String>, String> {
    // Vérifier si c'est une URL GitHub
    if url.contains("raw.githubusercontent.com") {
        return get_github_last_updated(&url).await;
    }

    // Vérifier si c'est Circuspes
    if url.contains("traduction.circuspes.fr") {
        return get_circuspes_last_updated(&url).await;
    }

    // URL inconnue, pas de date
    Ok(None)
}

/// Récupère la date du dernier commit GitHub pour un fichier
async fn get_github_last_updated(raw_url: &str) -> Result<Option<String>, String> {
    // Convertir l'URL raw en paramètres API
    // https://raw.githubusercontent.com/SPEED0U/Scefra/main/french_(france)/global.ini
    // -> https://api.github.com/repos/SPEED0U/Scefra/commits?path=french_(france)/global.ini&sha=main&per_page=1
    //
    // Cas spécial pour refs/heads:
    // https://raw.githubusercontent.com/SPEED0U/Scefra/refs/heads/settings-en/french_(france)/global.ini
    // -> https://api.github.com/repos/SPEED0U/Scefra/commits?path=french_(france)/global.ini&sha=settings-en&per_page=1

    let (owner, repo, branch, file_path) = if raw_url.contains("/refs/heads/") {
        // Format: raw.githubusercontent.com/owner/repo/refs/heads/branch/path
        let re = Regex::new(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/refs/heads/([^/]+)/(.+)")
            .map_err(|e| e.to_string())?;
        let caps = re.captures(raw_url).ok_or("URL GitHub refs/heads invalide")?;
        (
            caps.get(1).map(|m| m.as_str()).unwrap_or(""),
            caps.get(2).map(|m| m.as_str()).unwrap_or(""),
            caps.get(3).map(|m| m.as_str()).unwrap_or("main"),
            caps.get(4).map(|m| m.as_str()).unwrap_or(""),
        )
    } else {
        // Format standard: raw.githubusercontent.com/owner/repo/branch/path
        let re = Regex::new(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)")
            .map_err(|e| e.to_string())?;
        let caps = re.captures(raw_url).ok_or("URL GitHub invalide")?;
        (
            caps.get(1).map(|m| m.as_str()).unwrap_or(""),
            caps.get(2).map(|m| m.as_str()).unwrap_or(""),
            caps.get(3).map(|m| m.as_str()).unwrap_or("main"),
            caps.get(4).map(|m| m.as_str()).unwrap_or(""),
        )
    };

    let api_url = format!(
        "https://api.github.com/repos/{}/{}/commits?path={}&sha={}&per_page=1",
        owner, repo, file_path, branch
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&api_url)
        .header("User-Agent", "StarTradFR")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let commits: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;

    if let Some(commit) = commits.first() {
        if let Some(date) = commit.get("commit")
            .and_then(|c| c.get("committer"))
            .and_then(|c| c.get("date"))
            .and_then(|d| d.as_str())
        {
            return Ok(Some(date.to_string()));
        }
    }

    Ok(None)
}

/// Récupère la date depuis la 4ème ligne du fichier Circuspes
async fn get_circuspes_last_updated(url: &str) -> Result<Option<String>, String> {
    let client = reqwest::Client::new();

    // Télécharger seulement les premiers bytes (environ 500 caractères suffisent)
    let response = client
        .get(url)
        .header("Range", "bytes=0-500")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = response.text().await.map_err(|e| e.to_string())?;

    // Parser la 4ème ligne: "; Fichier généré le jeudi 18 décembre 2025 à 09:27"
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() >= 4 {
        let line4 = lines[3];
        // Extraire la date française
        // Format: "Fichier généré le [jour] [numero] [mois] [annee] à [heure]"
        if let Some(date) = parse_french_date(line4) {
            return Ok(Some(date));
        }
    }

    Ok(None)
}

/// Parse une date française et la convertit en ISO 8601
fn parse_french_date(line: &str) -> Option<String> {
    // Mois français -> numéro
    let months: HashMap<&str, u32> = [
        ("janvier", 1), ("février", 2), ("mars", 3), ("avril", 4),
        ("mai", 5), ("juin", 6), ("juillet", 7), ("août", 8),
        ("septembre", 9), ("octobre", 10), ("novembre", 11), ("décembre", 12),
    ].iter().cloned().collect();

    // Regex pour extraire: "le [jour] [numero] [mois] [annee] à [heure:minute]"
    let re = Regex::new(r"le \w+ (\d+) (\w+) (\d{4}) à (\d{2}):(\d{2})").ok()?;

    let caps = re.captures(line)?;

    let day: u32 = caps.get(1)?.as_str().parse().ok()?;
    let month_name = caps.get(2)?.as_str().to_lowercase();
    let year: u32 = caps.get(3)?.as_str().parse().ok()?;
    let hour: u32 = caps.get(4)?.as_str().parse().ok()?;
    let minute: u32 = caps.get(5)?.as_str().parse().ok()?;

    let month = *months.get(month_name.as_str())?;

    // Format ISO 8601
    Some(format!("{:04}-{:02}-{:02}T{:02}:{:02}:00Z", year, month, day, hour, minute))
}

#[command]
pub async fn get_translations() -> Result<Value, String> {
    let response = reqwest::get("https://drrakendu78.github.io/TradSC/translations.json")
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(response)
}
