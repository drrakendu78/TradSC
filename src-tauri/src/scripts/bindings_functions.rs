use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use starbreaker_p4k::{MappedP4k, P4kEntry};
use tauri::command;
use zip::ZipArchive;

use crate::scripts::gamepath::get_star_citizen_versions;

#[derive(Clone, Serialize)]
pub struct BindingFile {
    name: String,
    path: String,
    source: String,
    editable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputHardwareDevice {
    id: String,
    name: String,
    kind: String,
    source: String,
    virtual_device: bool,
    status: String,
}

#[derive(Deserialize)]
struct PnpEntity {
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "PNPClass")]
    pnp_class: Option<String>,
    #[serde(rename = "Status")]
    status: Option<String>,
    #[serde(rename = "DeviceID")]
    device_id: Option<String>,
}

#[command]
pub fn import_bindings_file(
    source_path: String,
    version: String,
) -> Result<Vec<BindingFile>, String> {
    let base_path = get_version_base_path(&version)?;
    let source_filename = Path::new(&source_path)
        .file_name()
        .ok_or_else(|| "Nom de fichier source invalide".to_string())?
        .to_str()
        .ok_or_else(|| "Nom de fichier source contient des caracteres invalides".to_string())?;

    let dest_folder = bindings_folder(&base_path);
    ensure_bindings_folder(&dest_folder)?;

    let extension = Path::new(source_filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if extension == "xml" {
        let dest_path = unique_destination(&dest_folder, &sanitize_file_name(source_filename));
        fs::copy(&source_path, &dest_path)
            .map_err(|e| format!("Erreur lors de la copie du fichier : {}", e))?;

        if !dest_path.exists() {
            return Err("Le fichier n'a pas ete copie correctement".to_string());
        }

        return Ok(vec![binding_file_from_path(
            dest_path,
            "Mappings importes",
        )?]);
    }

    if matches!(extension.as_str(), "pak" | "p4k" | "zip") {
        return import_bindings_from_archive(&source_path, &dest_folder);
    }

    Err("Format non pris en charge. Selectionnez un XML, PAK, P4K ou ZIP.".to_string())
}

#[command]
pub fn list_bindings_files(version: String) -> Result<Vec<BindingFile>, String> {
    let base_path = get_version_base_path(&version)?;
    let bindings_path = bindings_folder(&base_path);
    let mut bindings = Vec::new();

    if !bindings_path.exists() {
        return Ok(bindings);
    }

    let entries = fs::read_dir(&bindings_path)
        .map_err(|e| format!("Erreur lors de la lecture du dossier : {}", e))?;

    for entry in entries.flatten() {
        if entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("xml"))
        {
            let path = entry.path();
            let source = if is_base_profile_file(&path) {
                "Base Data.pak"
            } else {
                "Mappings exportes"
            };
            bindings.push(binding_file_from_path(path, source)?);
        }
    }

    Ok(bindings)
}

#[command]
pub fn list_control_profiles(version: String) -> Result<Vec<BindingFile>, String> {
    list_bindings_files(version)
}

#[command]
pub fn list_input_hardware_devices() -> Result<Vec<InputHardwareDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        return list_windows_input_hardware_devices();
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[command]
pub fn extract_default_bindings_from_game_data(version: String) -> Result<BindingFile, String> {
    let base_path = get_version_base_path(&version)?;
    let archive_path = find_game_data_archive(&base_path)
        .ok_or_else(|| "Data.p4k/Data.pak introuvable pour cette version".to_string())?;

    let dest_folder = bindings_folder(&base_path);
    ensure_bindings_folder(&dest_folder)?;
    let version_safe = sanitize_file_name(&version)
        .trim_end_matches(".xml")
        .to_string();
    let dest_path = dest_folder.join(format!("startrad_base_defaultProfile_{}.xml", version_safe));

    if !base_profile_cache_is_stale(&dest_path, &archive_path) {
        return binding_file_from_path(dest_path, "Base Data.pak");
    }

    let content = extract_default_profile_xml(&archive_path)?;

    if !content.trim_start().starts_with('<') {
        return Err("defaultProfile.xml a ete trouve, mais son contenu ne ressemble pas a du XML exploitable.".to_string());
    }

    fs::write(&dest_path, content)
        .map_err(|e| format!("Impossible d'ecrire la base extraite : {}", e))?;

    binding_file_from_path(dest_path, "Base Data.pak")
}

#[command]
pub fn delete_bindings_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if is_base_profile_file(path) {
        return Err("La base Data.pak est protegee et ne peut pas etre supprimee.".to_string());
    }

    fs::remove_file(file_path)
        .map_err(|e| format!("Erreur lors de la suppression du fichier : {}", e))
}

#[command]
pub fn refresh_bindings() -> Result<(), String> {
    Ok(())
}

#[command]
pub fn open_bindings_folder(version: String) -> Result<bool, String> {
    let base_path = get_version_base_path(&version)?;
    let bindings_path = bindings_folder(&base_path);
    ensure_bindings_folder(&bindings_path)?;

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(bindings_path)
            .spawn()
            .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        let open_cmd = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        Command::new(open_cmd)
            .arg(bindings_path)
            .spawn()
            .map_err(|e| format!("Erreur lors de l'ouverture du dossier : {}", e))?;
    }

    Ok(true)
}

fn base_profile_cache_is_stale(dest_path: &Path, archive_path: &Path) -> bool {
    if !dest_path.exists() {
        return true;
    }

    let Ok(dest_modified) = fs::metadata(dest_path).and_then(|metadata| metadata.modified()) else {
        return true;
    };
    let Ok(archive_modified) = fs::metadata(archive_path).and_then(|metadata| metadata.modified())
    else {
        return false;
    };

    archive_modified > dest_modified
}

fn extract_default_profile_xml(archive_path: &Path) -> Result<String, String> {
    extract_default_profile_from_p4k(archive_path).or_else(|p4k_error| {
        extract_default_profile_from_zip(archive_path).map_err(|zip_error| {
            format!(
                "Impossible de lire defaultProfile.xml dans {}. Lecteur P4K: {}. Fallback ZIP: {}",
                archive_path.display(),
                p4k_error,
                zip_error
            )
        })
    })
}

fn extract_default_profile_from_p4k(archive_path: &Path) -> Result<String, String> {
    let p4k = MappedP4k::open(archive_path)
        .map_err(|e| format!("archive P4K non lisible: {}", e))?;
    let entry = find_default_profile_entry(&p4k)
        .ok_or_else(|| "defaultProfile.xml introuvable dans l'index P4K".to_string())?;
    let bytes = p4k
        .read(entry)
        .map_err(|e| format!("lecture P4K de {} impossible: {}", entry.name, e))?;

    decode_game_xml(&bytes)
}

fn find_default_profile_entry(p4k: &MappedP4k) -> Option<&P4kEntry> {
    let candidates = [
        "Data\\Libs\\Config\\defaultProfile.xml",
        "Libs\\Config\\defaultProfile.xml",
        "data\\libs\\config\\defaultprofile.xml",
        "libs\\config\\defaultprofile.xml",
    ];

    for candidate in candidates {
        if let Some(entry) = p4k.entry_case_insensitive(candidate) {
            return Some(entry);
        }
    }

    let mut fallback = None;
    for entry in p4k.entries() {
        let normalized = entry.name.replace('/', "\\").to_ascii_lowercase();
        if normalized.ends_with("\\libs\\config\\defaultprofile.xml")
            || normalized == "libs\\config\\defaultprofile.xml"
            || normalized == "data\\libs\\config\\defaultprofile.xml"
        {
            return Some(entry);
        }

        if normalized.ends_with("\\defaultprofile.xml") || normalized == "defaultprofile.xml" {
            fallback = Some(entry);
        }
    }

    fallback
}

fn extract_default_profile_from_zip(archive_path: &Path) -> Result<String, String> {
    let file = fs::File::open(archive_path)
        .map_err(|e| format!("Impossible d'ouvrir {} : {}", archive_path.display(), e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("archive ZIP/PAK non lisible: {}", e))?;

    let target_index = find_default_profile_index(&mut archive)?
        .ok_or_else(|| "defaultProfile.xml introuvable dans l'archive ZIP/PAK".to_string())?;

    let mut entry = archive
        .by_index(target_index)
        .map_err(|e| format!("Impossible de lire defaultProfile.xml : {}", e))?;
    let mut bytes = Vec::new();
    io::copy(&mut entry, &mut bytes)
        .map_err(|e| format!("Impossible d'extraire defaultProfile.xml : {}", e))?;

    decode_game_xml(&bytes)
}

fn decode_game_xml(bytes: &[u8]) -> Result<String, String> {
    if starbreaker_cryxml::is_cryxmlb(bytes) {
        return starbreaker_cryxml::from_bytes(bytes)
            .map(|xml| xml.to_string())
            .map_err(|e| format!("conversion CryXml impossible: {}", e));
    }

    let content = String::from_utf8(bytes.to_vec()).map_err(|_| {
        "defaultProfile.xml a ete trouve, mais son contenu n'est pas du texte UTF-8 ni du CryXml pris en charge.".to_string()
    })?;

    Ok(content.trim_start_matches('\u{feff}').to_string())
}

fn import_bindings_from_archive(
    source_path: &str,
    dest_folder: &Path,
) -> Result<Vec<BindingFile>, String> {
    let source = Path::new(source_path);
    import_bindings_from_p4k_archive(source, dest_folder).or_else(|p4k_error| {
        import_bindings_from_zip_archive(source, dest_folder).map_err(|zip_error| {
            format!(
                "Archive PAK/P4K/ZIP non lisible. Lecteur P4K: {}. Fallback ZIP: {}",
                p4k_error, zip_error
            )
        })
    })
}

fn import_bindings_from_p4k_archive(
    source_path: &Path,
    dest_folder: &Path,
) -> Result<Vec<BindingFile>, String> {
    let p4k = MappedP4k::open(source_path)
        .map_err(|e| format!("archive P4K non lisible: {}", e))?;
    let mut imported = Vec::new();

    for entry in p4k.entries() {
        let entry_name = entry.name.replace('\\', "/");
        let lower = entry_name.to_ascii_lowercase();

        if !lower.ends_with(".xml") || !looks_like_bindings_entry(&lower) {
            continue;
        }

        if imported.len() >= 20 {
            return Err("Archive trop large : plus de 20 profils XML de controles detectes. Importez un XML exporte par le jeu pour eviter les mauvais fichiers.".to_string());
        }

        let raw_name = Path::new(&entry_name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("bindings.xml");
        let safe_name = sanitize_file_name(raw_name);
        let dest_path = unique_destination(dest_folder, &safe_name);
        let bytes = p4k
            .read(entry)
            .map_err(|e| format!("Impossible de lire {} : {}", entry.name, e))?;
        let content = decode_game_xml(&bytes)
            .map_err(|e| format!("Impossible de decoder {} : {}", entry.name, e))?;

        fs::write(&dest_path, content)
            .map_err(|e| format!("Impossible d'ecrire {} : {}", dest_path.display(), e))?;
        imported.push(binding_file_from_path(dest_path, "Archive importee")?);
    }

    if imported.is_empty() {
        return Err("Aucun XML de controles exploitable trouve dans cette archive.".to_string());
    }

    Ok(imported)
}

fn import_bindings_from_zip_archive(
    source_path: &Path,
    dest_folder: &Path,
) -> Result<Vec<BindingFile>, String> {
    let file = fs::File::open(source_path)
        .map_err(|e| format!("Impossible d'ouvrir l'archive : {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Archive PAK/P4K/ZIP non lisible : {}", e))?;

    let mut imported = Vec::new();

    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|e| format!("Erreur de lecture de l'index de l'archive : {}", e))?;

        if entry.is_dir() {
            continue;
        }

        let entry_name = entry.name().replace('\\', "/");
        let lower = entry_name.to_ascii_lowercase();
        drop(entry);

        if !lower.ends_with(".xml") || !looks_like_bindings_entry(&lower) {
            continue;
        }

        if imported.len() >= 20 {
            return Err("Archive trop large : plus de 20 profils XML de controles detectes. Importez un XML exporte par le jeu pour eviter les mauvais fichiers.".to_string());
        }

        let raw_name = Path::new(&entry_name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("bindings.xml");
        let safe_name = sanitize_file_name(raw_name);
        let dest_path = unique_destination(dest_folder, &safe_name);
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Impossible de lire {} : {}", entry_name, e))?;

        let mut bytes = Vec::new();
        io::copy(&mut entry, &mut bytes)
            .map_err(|e| format!("Impossible d'extraire {} : {}", entry_name, e))?;
        let content = decode_game_xml(&bytes)
            .map_err(|e| format!("Impossible de decoder {} : {}", entry_name, e))?;
        fs::write(&dest_path, content)
            .map_err(|e| format!("Impossible d'ecrire {} : {}", dest_path.display(), e))?;
        imported.push(binding_file_from_path(dest_path, "Archive importee")?);
    }

    if imported.is_empty() {
        return Err("Aucun XML de controles exploitable trouve dans cette archive.".to_string());
    }

    Ok(imported)
}

fn looks_like_bindings_entry(path: &str) -> bool {
    path.contains("controls/mappings")
        || path.contains("actionmaps")
        || path.contains("layout_")
        || path.contains("keybind")
        || path.contains("binding")
        || path.contains("bindings")
        || path.contains("defaultprofile")
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' => ch,
            _ => '_',
        })
        .collect();

    if cleaned.to_ascii_lowercase().ends_with(".xml") {
        cleaned
    } else {
        format!("{}.xml", cleaned.trim_end_matches('.'))
    }
}

fn unique_destination(folder: &Path, file_name: &str) -> PathBuf {
    let candidate = folder.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("bindings");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("xml");

    for index in 1..1000 {
        let candidate = folder.join(format!("{}_{}.{}", stem, index, extension));
        if !candidate.exists() {
            return candidate;
        }
    }

    folder.join(format!("{}_copy.{}", stem, extension))
}

fn get_version_base_path(version: &str) -> Result<PathBuf, String> {
    let game_paths = get_star_citizen_versions();

    let version_info = game_paths
        .versions
        .get(version)
        .ok_or_else(|| format!("Version {} non trouvee", version))?;

    Ok(PathBuf::from(&version_info.path))
}

fn bindings_folder(base_path: &Path) -> PathBuf {
    base_path
        .join("user")
        .join("client")
        .join("0")
        .join("controls")
        .join("mappings")
}

fn find_game_data_archive(base_path: &Path) -> Option<PathBuf> {
    let direct_candidates = [
        "Data.p4k",
        "data.p4k",
        "Data.pak",
        "data.pak",
        "GameData.pak",
        "gamedata.pak",
        "CitizenClient/Data/GameData.pak",
        "CitizenClient/data/GameData.pak",
    ];

    for candidate in direct_candidates {
        let path = base_path.join(candidate);
        if path.exists() {
            return Some(path);
        }
    }

    find_archive_with_depth(base_path, 0, 3)
}

fn find_archive_with_depth(path: &Path, depth: usize, max_depth: usize) -> Option<PathBuf> {
    if depth > max_depth || !path.is_dir() {
        return None;
    }

    let entries = fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(name) = entry_path.file_name().and_then(|name| name.to_str()) {
                let lower = name.to_ascii_lowercase();
                if matches!(lower.as_str(), "data.p4k" | "data.pak" | "gamedata.pak") {
                    return Some(entry_path);
                }
            }
        }
    }

    let entries = fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if let Some(found) = find_archive_with_depth(&entry_path, depth + 1, max_depth) {
                return Some(found);
            }
        }
    }

    None
}

fn find_default_profile_index(file: &mut ZipArchive<fs::File>) -> Result<Option<usize>, String> {
    let mut fallback = None;

    for index in 0..file.len() {
        let entry = file
            .by_index_raw(index)
            .map_err(|e| format!("Erreur pendant la lecture de l'index de l'archive : {}", e))?;
        let name = entry.name().replace('\\', "/").to_ascii_lowercase();

        if name == "data/libs/config/defaultprofile.xml"
            || name == "libs/config/defaultprofile.xml"
            || name.ends_with("/libs/config/defaultprofile.xml")
        {
            return Ok(Some(index));
        }

        if name.ends_with("/defaultprofile.xml") || name == "defaultprofile.xml" {
            fallback = Some(index);
        }
    }

    Ok(fallback)
}

fn ensure_bindings_folder(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("Impossible de creer les dossiers necessaires : {}", e))
}

#[cfg(target_os = "windows")]
fn list_windows_input_hardware_devices() -> Result<Vec<InputHardwareDevice>, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$pattern = 'vJoy|Joystick|Flightstick|Sol-R|Gamepad|Controller|Controleur|Manette|HOTAS|VKB|VPC|Virpil|Thrustmaster|Logitech|Xbox|DualSense|Wireless Controller|HID'
Get-PnpDevice -PresentOnly |
  Where-Object {
    $_.Status -eq 'OK' -and (
      $_.FriendlyName -match $pattern -or
      $_.Class -eq 'HIDClass' -or
      $_.InstanceId -match 'HIDCLASS|VID_|VJOY|VHF'
    )
  } |
  Select-Object @{Name='Name';Expression={$_.FriendlyName}},@{Name='PNPClass';Expression={$_.Class}},Status,@{Name='DeviceID';Expression={$_.InstanceId}} |
  ConvertTo-Json -Compress
"#;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Impossible d'interroger les peripheriques Windows : {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Reponse Windows peripheriques invalide : {}", e))?;
    let entries: Vec<PnpEntity> = if let Some(items) = json.as_array() {
        items
            .iter()
            .filter_map(|item| serde_json::from_value(item.clone()).ok())
            .collect()
    } else if json.is_object() {
        vec![serde_json::from_value(json).map_err(|e| format!("Peripherique Windows invalide : {}", e))?]
    } else {
        Vec::new()
    };

    let mut devices = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let name = entry.name.unwrap_or_default().trim().to_string();
        let device_id = entry.device_id.unwrap_or_default().trim().to_string();
        let pnp_class = entry.pnp_class.unwrap_or_default();
        if name.is_empty() || !looks_like_input_hardware(&name, &device_id, &pnp_class) {
            continue;
        }

        let key = format!("{}|{}", name.to_ascii_lowercase(), device_id.to_ascii_lowercase());
        if !seen.insert(key) {
            continue;
        }

        devices.push(InputHardwareDevice {
            id: device_id.clone(),
            kind: hardware_kind_from_name(&name, &device_id),
            virtual_device: is_virtual_hardware_name(&name, &device_id),
            source: "windows".to_string(),
            status: entry.status.unwrap_or_else(|| "OK".to_string()),
            name,
        });
    }

    devices.sort_by(|a, b| {
        a.virtual_device
            .cmp(&b.virtual_device)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });

    Ok(devices)
}

#[cfg(target_os = "windows")]
fn looks_like_input_hardware(name: &str, device_id: &str, pnp_class: &str) -> bool {
    let haystack = fold_windows_hardware_text(&format!("{} {} {}", name, device_id, pnp_class));
    let class_lower = fold_windows_hardware_text(pnp_class);
    let is_hid = class_lower == "hidclass" || haystack.contains("hidclass") || haystack.contains("hid\\vid_");
    let include = [
        "vjoy",
        "joystick",
        "gamepad",
        "controller",
        "controleur",
        "jeu hid",
        "game controller",
        "manette",
        "flightstick",
        "hotas",
        "vkb",
        "virpil",
        "vpc",
        "sol-r",
        "stick",
        "thrustmaster",
        "logitech",
        "xbox",
        "dualsense",
        "wireless controller",
    ];
    let exclude = [
        "audio",
        "webcam",
        "camera",
        "mouse",
        "souris",
        "keyboard",
        "clavier",
        "controleur systeme hid",
        "peripherique d entree usb",
        "peripherique d",
        "peripherique conforme",
        "peripherique fournisseur hid",
        "usb input device",
        "hid-compliant vendor",
        "hid-compliant system",
        "ethernet",
        "emulation",
        "gpio",
        "hub usb",
        "i2c",
        "concentrateur",
        "root_hub",
        "aura led",
        "barcode",
        "badge",
        "bus enumerator",
    ];

    let name_lower = name.to_ascii_lowercase();
    if name_lower == "vjoy driver" {
        return false;
    }

    (include.iter().any(|part| haystack.contains(part)) || is_hid)
        && !exclude.iter().any(|part| haystack.contains(part))
}

#[cfg(target_os = "windows")]
fn fold_windows_hardware_text(value: &str) -> String {
    value
        .to_lowercase()
        .replace('\u{00e0}', "a")
        .replace('\u{00e1}', "a")
        .replace('\u{00e2}', "a")
        .replace('\u{00e4}', "a")
        .replace('\u{00e7}', "c")
        .replace('\u{00e8}', "e")
        .replace('\u{00e9}', "e")
        .replace('\u{00ea}', "e")
        .replace('\u{00eb}', "e")
        .replace('\u{00ee}', "i")
        .replace('\u{00ef}', "i")
        .replace('\u{00f4}', "o")
        .replace('\u{00f6}', "o")
        .replace('\u{00f9}', "u")
        .replace('\u{00fb}', "u")
        .replace('\u{00fc}', "u")
        .replace('\u{2019}', " ")
        .replace('\'', " ")
}

#[cfg(target_os = "windows")]
fn is_virtual_hardware_name(name: &str, device_id: &str) -> bool {
    let haystack = format!("{} {}", name, device_id).to_ascii_lowercase();
    haystack.contains("vjoy")
        || haystack.contains("virtual")
        || haystack.contains("vhf")
        || haystack.contains("hidhide")
        || haystack.contains("hidclass&col")
}

#[cfg(target_os = "windows")]
fn hardware_kind_from_name(name: &str, device_id: &str) -> String {
    let haystack = format!("{} {}", name, device_id).to_ascii_lowercase();
    if haystack.contains("sol-r")
        || haystack.contains("flightstick")
        || haystack.contains("hotas")
        || haystack.contains("vkb")
        || haystack.contains("virpil")
        || haystack.contains("vpc")
        || haystack.contains("thrustmaster")
        || haystack.contains("joystick")
    {
        return "joystick".to_string();
    }

    if haystack.contains("xbox")
        || haystack.contains("dualsense")
        || haystack.contains("wireless controller")
        || haystack.contains("gamepad")
        || haystack.contains("manette")
    {
        return "gamepad".to_string();
    }

    "joystick".to_string()
}

fn is_base_profile_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("startrad_base_defaultProfile_"))
}

fn binding_file_from_path(path: PathBuf, source: &str) -> Result<BindingFile, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nom de fichier invalide".to_string())?
        .to_string();

    let path_string = path
        .to_str()
        .ok_or_else(|| "Chemin de fichier invalide".to_string())?
        .to_string();

    Ok(BindingFile {
        name,
        path: path_string,
        source: source.to_string(),
        editable: source != "Base Data.pak",
    })
}
