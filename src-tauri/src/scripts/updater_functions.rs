use tauri::{command, AppHandle};

// Sources autorisees : releases GitHub StarTrad (historique) + releases GitLab
// Stelliverse (migration : la build finale telecharge Stelliverse depuis GitLab).
const ALLOWED_URL_PREFIXES: &[&str] = &[
    "https://github.com/drrakendu78/TradSC/releases/",
    "https://gitlab.com/drrakendu78/Stelliverse/-/releases/",
];

fn url_allowed(u: &str) -> bool {
    ALLOWED_URL_PREFIXES.iter().any(|p| u.starts_with(p))
}

/// Lance l'updater standalone et ferme l'application principale.
/// L'updater gere le telechargement, la verification de signature, l'installation et le relancement.
#[command]
pub async fn launch_updater(
    url: String,
    sig_url: String,
    name: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    if !url_allowed(&url) || !url_allowed(&sig_url) {
        return Err("URL de mise à jour non autorisée.".to_string());
    }
    // Trouver l'updater.exe a cote de l'exe principal
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Impossible de trouver l'executable: {}", e))?;
    let app_dir = current_exe
        .parent()
        .ok_or("Impossible de trouver le dossier de l'application")?;
    let updater_exe = app_dir.join("startrad-updater.exe");

    if !updater_exe.exists() {
        return Err(
            "L'updater n'a pas ete trouve. Veuillez reinstaller l'application.".to_string(),
        );
    }

    let pid = std::process::id();
    let app_path = current_exe.to_string_lossy().to_string();

    // Lancer l'updater avec les arguments
    std::process::Command::new(&updater_exe)
        .arg("--url")
        .arg(&url)
        .arg("--sig-url")
        .arg(&sig_url)
        .arg("--name")
        .arg(&name)
        .arg("--app")
        .arg(&app_path)
        .arg("--pid")
        .arg(pid.to_string())
        .spawn()
        .map_err(|e| format!("Impossible de lancer l'updater: {}", e))?;

    // Fermer l'application principale apres un court delai
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    app_handle.exit(0);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN B : migration geree DIRECTEMENT par l'app principale (startradfr.exe).
// Pas de binaire updater separe (qui pouvait ne pas etre installe / etre verrouille).
// L'app principale est TOUJOURS bien a jour apres l'update → ce code est toujours
// present. Elle telecharge l'installeur Stelliverse depuis GitLab, verifie la signature
// (cle Stelliverse), l'installe en silencieux, lance Stelliverse, desinstalle StarTrad.
// ─────────────────────────────────────────────────────────────────────────────

/// Cle publique minisign de STELLIVERSE (≠ StarTrad) — verifie les releases Stelliverse.
const STELLIVERSE_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDkyMTNCNTQ4RkEyQzM2REQKUldUZE5pejZTTFVUa2szeEQ4T2JHZi9BcjJWY0V3TUNEbnF4ZDAvazRtYXFaSjF2SVdwL2NObTcK";

async fn mig_download(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("StarTradFR-Migration/1.0")
        .build()
        .map_err(|e| format!("Client HTTP: {}", e))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Telechargement echoue: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Le serveur a retourne le statut {}", resp.status()));
    }
    Ok(resp
        .bytes()
        .await
        .map_err(|e| format!("Lecture du telechargement: {}", e))?
        .to_vec())
}

fn mig_verify(installer: &[u8], sig_content: &str) -> Result<(), String> {
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};
    let pk_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(STELLIVERSE_PUBKEY_B64)
            .map_err(|e| format!("Decodage cle: {}", e))?,
    )
    .map_err(|e| format!("UTF-8 cle: {}", e))?;
    let pk = PublicKey::decode(&pk_text).map_err(|e| format!("Lecture cle: {}", e))?;
    let sig_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(sig_content.trim())
            .map_err(|e| format!("Decodage signature: {}", e))?,
    )
    .map_err(|e| format!("UTF-8 signature: {}", e))?;
    let sig = Signature::decode(&sig_text).map_err(|e| format!("Lecture signature: {}", e))?;
    pk.verify(installer, &sig, false)
        .map_err(|_| "La signature est invalide. Le fichier a peut-etre ete modifie.".to_string())
}

/// Lance Stelliverse (si trouve) + desinstalle StarTrad (PowerShell detache, apres la
/// fermeture de cette app). Best-effort : aucune erreur propagee.
#[cfg(windows)]
fn mig_finish() {
    use std::os::windows::process::CommandExt;
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let stelli = std::path::PathBuf::from(&local)
            .join("Stelliverse")
            .join("Stelliverse.exe");
        if stelli.exists() {
            let _ = std::process::Command::new(&stelli)
                .creation_flags(0x0800_0000)
                .spawn();
        }
    }
    if let Ok(self_exe) = std::env::current_exe() {
        if let Some(dir) = self_exe.parent() {
            let unins = dir.join("uninstall.exe");
            if unins.exists() {
                let script = format!(
                    "Start-Sleep -Seconds 4; Start-Process -FilePath '{}' -ArgumentList '/S'",
                    unins.display()
                );
                let _ = std::process::Command::new("powershell")
                    .args([
                        "-NoProfile",
                        "-NonInteractive",
                        "-WindowStyle",
                        "Hidden",
                        "-Command",
                        &script,
                    ])
                    .creation_flags(0x0800_0000)
                    .spawn();
            }
        }
    }
}
#[cfg(not(windows))]
fn mig_finish() {}

/// PLAN B : telecharge + verifie + installe Stelliverse, puis lance Stelliverse et
/// desinstalle StarTrad. Tout depuis l'app principale (aucun binaire separe).
#[command]
pub async fn run_migration(
    url: String,
    sig_url: String,
    name: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    if !url_allowed(&url) || !url_allowed(&sig_url) {
        return Err("URL de migration non autorisée.".to_string());
    }
    let installer = mig_download(&url).await?;
    let sig = String::from_utf8(mig_download(&sig_url).await?)
        .map_err(|e| format!("Signature illisible: {}", e))?;
    mig_verify(&installer, &sig)?;

    let fname = if name.trim().is_empty() {
        "stelliverse-setup.exe".to_string()
    } else {
        name
    };
    let tmp = std::env::temp_dir().join(&fname);
    std::fs::write(&tmp, &installer).map_err(|e| format!("Ecriture installeur: {}", e))?;

    let status = tokio::process::Command::new(&tmp)
        .arg("/S")
        .status()
        .await
        .map_err(|e| format!("Lancement de l'installeur: {}", e))?;
    if !status.success() {
        return Err(format!(
            "L'installeur Stelliverse a echoue (code {:?}).",
            status.code()
        ));
    }
    let _ = std::fs::remove_file(&tmp);

    mig_finish();
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    app_handle.exit(0);
    Ok(())
}
