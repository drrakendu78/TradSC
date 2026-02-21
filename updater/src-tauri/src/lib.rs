use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

/// Cle publique minisign embarquee (depuis tauri.conf.json du projet principal)
const PUBKEY_BASE64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE1MzkxNjFBRkJDRjNFMjgKUldRb1BzLzdHaFk1RlFSNWlMeWhua00yL3hlM0FWOHpkRzQxQkpWNkwvbGxvaWZsNU5tVlhGelYK";

static UPDATE_ARGS: OnceLock<UpdateArgs> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
struct UpdateArgs {
    url: String,
    sig_url: String,
    name: String,
    app: String,
    pid: u32,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    phase: String,
    percent: u32,
    detail: String,
}

fn parse_args() -> Option<UpdateArgs> {
    let args: Vec<String> = std::env::args().collect();
    let mut url = None;
    let mut sig_url = None;
    let mut name = None;
    let mut app = None;
    let mut pid = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--url" if i + 1 < args.len() => {
                url = Some(args[i + 1].clone());
                i += 2;
            }
            "--sig-url" if i + 1 < args.len() => {
                sig_url = Some(args[i + 1].clone());
                i += 2;
            }
            "--name" if i + 1 < args.len() => {
                name = Some(args[i + 1].clone());
                i += 2;
            }
            "--app" if i + 1 < args.len() => {
                app = Some(args[i + 1].clone());
                i += 2;
            }
            "--pid" if i + 1 < args.len() => {
                pid = args[i + 1].parse().ok();
                i += 2;
            }
            _ => i += 1,
        }
    }

    Some(UpdateArgs {
        url: url?,
        sig_url: sig_url?,
        name: name.unwrap_or_default(),
        app: app?,
        pid: pid?,
    })
}

#[tauri::command]
fn get_update_args() -> Result<UpdateArgs, String> {
    UPDATE_ARGS
        .get()
        .cloned()
        .ok_or_else(|| "No update arguments provided".to_string())
}

#[tauri::command]
async fn start_update(app: AppHandle) -> Result<(), String> {
    let args = UPDATE_ARGS
        .get()
        .cloned()
        .ok_or("No update arguments")?;

    // Phase 1 : Attente de la fermeture de l'app principale
    emit_progress(&app, "waiting", 0, "Attente de la fermeture de StarTrad FR...");
    wait_for_pid(args.pid).await;
    emit_progress(&app, "waiting", 100, "StarTrad FR ferme.");

    // Phase 2 : Telechargement de l'installeur et de la signature
    emit_progress(&app, "downloading", 0, "Demarrage du telechargement...");
    let installer_bytes = download_file_to_memory(&app, &args.url, &args.name).await?;

    emit_progress(&app, "downloading", 100, "Telechargement de la signature...");
    let sig_content = download_signature(&args.sig_url).await?;

    // Phase 3 : Verification de la signature
    emit_progress(&app, "verifying", 0, "Verification de l'integrite...");
    verify_signature(&installer_bytes, &sig_content)?;
    emit_progress(&app, "verifying", 100, "Signature valide.");

    // Sauvegarder l'installeur sur le disque
    let installer_path = save_installer(&installer_bytes, &args.name)?;

    // Phase 4 : Installation
    emit_progress(&app, "installing", 0, "Installation en cours...");
    run_installer(&installer_path).await?;
    emit_progress(&app, "installing", 100, "Installation terminee.");

    // Nettoyage
    let _ = std::fs::remove_file(&installer_path);

    // Phase 5 : Relancement
    emit_progress(&app, "relaunching", 100, "Lancement de StarTrad FR...");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    std::process::Command::new(&args.app)
        .spawn()
        .map_err(|e| format!("Impossible de relancer l'application: {}", e))?;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    app.exit(0);

    Ok(())
}

fn emit_progress(app: &AppHandle, phase: &str, percent: u32, detail: &str) {
    let _ = app.emit(
        "update-progress",
        ProgressPayload {
            phase: phase.to_string(),
            percent,
            detail: detail.to_string(),
        },
    );
}

// --- Attente du processus principal ---

async fn wait_for_pid(pid: u32) {
    loop {
        if !is_process_running(pid) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

#[cfg(target_os = "windows")]
fn is_process_running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        ok != 0 && exit_code == STILL_ACTIVE as u32
    }
}

#[cfg(not(target_os = "windows"))]
fn is_process_running(pid: u32) -> bool {
    Path::new(&format!("/proc/{}", pid)).exists()
}

// --- Telechargement ---

async fn download_file_to_memory(
    app: &AppHandle,
    url: &str,
    name: &str,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .user_agent("StarTradFR-Updater/1.0")
        .build()
        .map_err(|e| format!("Erreur client HTTP: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Echec du telechargement: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Le serveur a retourne le statut {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: u32 = 0;
    let mut buffer = Vec::new();

    let display_name = if name.is_empty() {
        url.split('/').last().unwrap_or("mise-a-jour")
    } else {
        name
    };

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Erreur de telechargement: {}", e))?;
        buffer.extend_from_slice(&chunk);

        downloaded += chunk.len() as u64;
        let percent = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0) as u32
        } else {
            0
        };

        if percent != last_percent {
            last_percent = percent;
            let size_mb = downloaded as f64 / 1_048_576.0;
            let total_mb = total_size as f64 / 1_048_576.0;
            let detail = if total_size > 0 {
                format!(
                    "Telechargement de {}... {:.1} / {:.1} Mo ({}%)",
                    display_name, size_mb, total_mb, percent
                )
            } else {
                format!("Telechargement de {}... {:.1} Mo", display_name, size_mb)
            };
            emit_progress(app, "downloading", percent, &detail);
        }
    }

    emit_progress(app, "downloading", 100, "Telechargement termine.");
    Ok(buffer)
}

async fn download_signature(sig_url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("StarTradFR-Updater/1.0")
        .build()
        .map_err(|e| format!("Erreur client HTTP: {}", e))?;

    let response = client
        .get(sig_url)
        .send()
        .await
        .map_err(|e| format!("Echec du telechargement de la signature: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Impossible de telecharger la signature (statut {})",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Erreur de lecture de la signature: {}", e))
}

// --- Verification de signature minisign ---

fn verify_signature(installer_bytes: &[u8], sig_content: &str) -> Result<(), String> {
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};

    // Decoder la cle publique depuis le base64
    let pubkey_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(PUBKEY_BASE64)
            .map_err(|e| format!("Erreur de decodage de la cle publique: {}", e))?,
    )
    .map_err(|e| format!("Erreur UTF-8 cle publique: {}", e))?;

    let pk = PublicKey::decode(&pubkey_text)
        .map_err(|e| format!("Erreur de lecture de la cle publique: {}", e))?;

    let sig = Signature::decode(sig_content)
        .map_err(|e| format!("Erreur de lecture de la signature: {}", e))?;

    pk.verify(installer_bytes, &sig, false)
        .map_err(|_| "La signature est invalide. Le fichier a peut-etre ete modifie.".to_string())?;

    Ok(())
}

// --- Sauvegarde et installation ---

fn save_installer(data: &[u8], name: &str) -> Result<PathBuf, String> {
    let file_name = if name.is_empty() {
        "startradfr-update.exe"
    } else {
        name
    };

    let temp_dir = std::env::temp_dir().join("startradfr-updater");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Impossible de creer le dossier temporaire: {}", e))?;

    let dest = temp_dir.join(file_name);
    std::fs::write(&dest, data)
        .map_err(|e| format!("Impossible de sauvegarder l'installeur: {}", e))?;

    Ok(dest)
}

async fn run_installer(path: &Path) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let child = if ext == "msi" {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std::process::Command::new("msiexec.exe")
                .args(["/i", &path.to_string_lossy(), "/qn", "/norestart"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Err("L'installation MSI n'est supportee que sur Windows".to_string());
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std::process::Command::new(path)
                .args(["/S"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Err("L'installation EXE n'est supportee que sur Windows".to_string());
        }
    };

    let mut process = child.map_err(|e| format!("Impossible de lancer l'installeur: {}", e))?;
    let status = tokio::task::spawn_blocking(move || process.wait())
        .await
        .map_err(|e| format!("Erreur d'attente: {}", e))?
        .map_err(|e| format!("Erreur de l'installeur: {}", e))?;

    if !status.success() {
        return Err(format!(
            "L'installeur s'est termine avec le code {:?}",
            status.code()
        ));
    }

    Ok(())
}

pub fn run() {
    if let Some(args) = parse_args() {
        let _ = UPDATE_ARGS.set(args);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_update_args, start_update])
        .run(tauri::generate_context!())
        .expect("Erreur lors du demarrage de l'updater");
}
