use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use tauri::command;
use walkdir::WalkDir;
use zip::write::{FileOptions, ZipWriter};
use zip::{CompressionMethod, ZipArchive as ZipArchiveReader};

use crate::scripts::gamepath::get_star_citizen_versions;

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug)]
pub struct BackupInfo {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub size: u64,
}

/// Crée un ZIP du dossier user/ et user.cfg
#[command]
pub fn create_user_backup(version: String) -> Result<String, String> {
    let versions = get_star_citizen_versions();
    let version_path = versions
        .versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let base_path = Path::new(&version_path.path);
    let user_dir = base_path.join("user");
    let user_cfg = base_path.join("user.cfg");

    if !user_dir.exists() && !user_cfg.exists() {
        return Err("Le dossier user/ et user.cfg n'existent pas".to_string());
    }

    // Créer un fichier temporaire pour le ZIP
    let temp_dir = std::env::temp_dir();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let zip_path = temp_dir.join(format!("user_backup_{}.zip", timestamp));

    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Erreur lors de la création du fichier ZIP: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    // Ajouter le dossier user/ s'il existe
    if user_dir.exists() {
        let mut added_dirs = HashSet::new();
        
        for entry in WalkDir::new(&user_dir) {
            let entry = entry.map_err(|e| format!("Erreur lors de la lecture du dossier: {}", e))?;
            let path = entry.path();
            let name = path.strip_prefix(&base_path).unwrap_or(path);
            let zip_name = name.to_string_lossy().replace('\\', "/");

            if path.is_file() {
                // Créer les dossiers parents si nécessaire
                if let Some(parent) = Path::new(&zip_name).parent() {
                    let mut current_path = String::new();
                    for component in parent.components() {
                        if let std::path::Component::Normal(comp) = component {
                            current_path.push_str(comp.to_string_lossy().as_ref());
                            current_path.push('/');
                            if !added_dirs.contains(&current_path) {
                                zip.start_file(&current_path, options)
                                    .map_err(|e| format!("Erreur lors de l'ajout du dossier au ZIP: {}", e))?;
                                zip.write_all(&[])
                                    .map_err(|e| format!("Erreur lors de l'écriture du dossier dans le ZIP: {}", e))?;
                                added_dirs.insert(current_path.clone());
                            }
                        }
                    }
                }

                let mut f = fs::File::open(path)
                    .map_err(|e| format!("Erreur lors de l'ouverture du fichier: {}", e))?;
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer)
                    .map_err(|e| format!("Erreur lors de la lecture du fichier: {}", e))?;

                zip.start_file(&zip_name, options)
                    .map_err(|e| format!("Erreur lors de l'ajout du fichier au ZIP: {}", e))?;
                zip.write_all(&buffer)
                    .map_err(|e| format!("Erreur lors de l'écriture dans le ZIP: {}", e))?;
            }
        }
    }

    // Ajouter user.cfg s'il existe
    if user_cfg.exists() {
        let mut f = fs::File::open(&user_cfg)
            .map_err(|e| format!("Erreur lors de l'ouverture de user.cfg: {}", e))?;
        let mut buffer = Vec::new();
        f.read_to_end(&mut buffer)
            .map_err(|e| format!("Erreur lors de la lecture de user.cfg: {}", e))?;

        zip.start_file("user.cfg", options)
            .map_err(|e| format!("Erreur lors de l'ajout de user.cfg au ZIP: {}", e))?;
        zip.write_all(&buffer)
            .map_err(|e| format!("Erreur lors de l'écriture de user.cfg dans le ZIP: {}", e))?;
    }

    zip.finish()
        .map_err(|e| format!("Erreur lors de la finalisation du ZIP: {}", e))?;

    Ok(zip_path.to_string_lossy().to_string())
}

/// Restaure un backup depuis un fichier ZIP
#[command]
pub fn restore_backup(zip_path: String, version: String) -> Result<(), String> {
    println!("Début de la restauration depuis: {} pour la version {}", zip_path, version);
    
    let versions = get_star_citizen_versions();
    let version_path = versions
        .versions
        .get(&version)
        .ok_or_else(|| format!("Version {} non trouvée", version))?;

    let base_path = Path::new(&version_path.path);
    let user_dir = base_path.join("user");
    let user_cfg = base_path.join("user.cfg");

    println!("Chemin de base: {:?}", base_path);
    println!("Dossier user: {:?}", user_dir);
    println!("Fichier user.cfg: {:?}", user_cfg);

    // Vérifier que le fichier ZIP existe
    if !Path::new(&zip_path).exists() {
        return Err(format!("Le fichier ZIP n'existe pas: {}", zip_path));
    }

    // Ouvrir le fichier ZIP
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("Erreur lors de l'ouverture du ZIP: {}", e))?;
    let mut archive = ZipArchiveReader::new(file)
        .map_err(|e| format!("Erreur lors de la lecture du ZIP: {}", e))?;

    println!("Nombre de fichiers dans le ZIP: {}", archive.len());

    // Supprimer l'ancien dossier user/ et user.cfg s'ils existent
    if user_dir.exists() {
        fs::remove_dir_all(&user_dir)
            .map_err(|e| format!("Erreur lors de la suppression de l'ancien dossier user/: {}", e))?;
    }
    if user_cfg.exists() {
        fs::remove_file(&user_cfg)
            .map_err(|e| format!("Erreur lors de la suppression de l'ancien user.cfg: {}", e))?;
    }

    // Créer le dossier user/ avant d'extraire
    fs::create_dir_all(&user_dir)
        .map_err(|e| format!("Erreur lors de la création du dossier user/: {}", e))?;

    // Extraire tous les fichiers
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Erreur lors de l'extraction du fichier {}: {}", i, e))?;
        
        // Convertir le nom en String pour libérer l'emprunt
        let file_name = file.name().to_string();
        
        println!("Traitement du fichier {}: {}", i, file_name);
        
        // Ignorer les entrées vides ou le dossier racine user/
        if file_name == "user/" || file_name.is_empty() {
            println!("Ignoré (dossier racine ou vide)");
            continue;
        }

        // Déterminer le chemin de destination
        let outpath = if file_name == "user.cfg" {
            // user.cfg va à la racine
            user_cfg.clone()
        } else if file_name.starts_with("user/") {
            // Fichiers dans user/ - extraire le chemin relatif
            let relative_path = file_name.strip_prefix("user/").unwrap_or(&file_name);
            if relative_path.is_empty() {
                continue;
            }
            base_path.join("user").join(relative_path)
        } else {
            // Autres fichiers (ne devrait pas arriver normalement)
            base_path.join(&file_name)
        };

        if file_name.ends_with('/') {
            // C'est un dossier - créer le dossier
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Erreur lors de la création du dossier {}: {}", file_name, e))?;
        } else {
            // C'est un fichier - créer les dossiers parents et extraire
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Erreur lors de la création des dossiers parents pour {}: {}", file_name, e))?;
            }

            // Extraire le fichier
            println!("Extraction vers: {:?}", outpath);
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Erreur lors de la création du fichier {} vers {:?}: {}", file_name, outpath, e))?;
            io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Erreur lors de l'extraction du fichier {}: {}", file_name, e))?;
            println!("Fichier extrait avec succès: {}", file_name);
        }
    }

    println!("Restauration terminée avec succès");
    Ok(())
}

/// Upload un backup vers Supabase Storage
#[command]
pub fn upload_backup_to_supabase(
    zip_path: String,
    user_id: String,
    access_token: String,
    version: String,
) -> Result<String, String> {
    let supabase_url = "https://rronicslgyoubiofbinu.supabase.co";
    let bucket_name = "user-backups";

    // Lire le fichier ZIP
    let zip_data = fs::read(&zip_path)
        .map_err(|e| format!("Erreur lors de la lecture du fichier ZIP: {}", e))?;

    // Générer un nom de fichier unique avec la version
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("{}/backup_{}_{}.zip", user_id, version, timestamp);
    let file_path = format!("/storage/v1/object/{}/{}", bucket_name, file_name);

    // Upload vers Supabase Storage
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(&format!("{}{}", supabase_url, file_path))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/zip")
        .header("x-upsert", "true")
        .body(zip_data)
        .send()
        .map_err(|e| format!("Erreur lors de l'upload: {}", e))?;

    if response.status().is_success() {
        Ok(file_name)
    } else {
        let error_text = response.text().unwrap_or_else(|_| "Erreur inconnue".to_string());
        Err(format!("Erreur lors de l'upload: {}", error_text))
    }
}

/// Liste les backups d'un utilisateur
#[command]
pub fn list_user_backups(user_id: String, access_token: String) -> Result<String, String> {
    let supabase_url = "https://rronicslgyoubiofbinu.supabase.co";
    let bucket_name = "user-backups";

    let file_path = format!("/storage/v1/object/list/{}", bucket_name);
    let prefix = format!("{}/", user_id);

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(&format!("{}{}", supabase_url, file_path))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "prefix": prefix,
            "limit": 100,
            "offset": 0,
            "sortBy": {
                "column": "created_at",
                "order": "desc"
            }
        }))
        .send()
        .map_err(|e| format!("Erreur lors de la récupération de la liste: {}", e))?;

    if response.status().is_success() {
        let text = response.text().map_err(|e| format!("Erreur lors de la lecture de la réponse: {}", e))?;
        Ok(text)
    } else {
        let error_text = response.text().unwrap_or_else(|_| "Erreur inconnue".to_string());
        Err(format!("Erreur lors de la récupération de la liste: {}", error_text))
    }
}

/// Télécharge un backup depuis Supabase Storage
#[command]
pub fn download_backup_from_supabase(
    file_name: String,
    _user_id: String,
    access_token: String,
) -> Result<String, String> {
    let supabase_url = "https://rronicslgyoubiofbinu.supabase.co";
    let bucket_name = "user-backups";

    let file_path = format!("/storage/v1/object/{}/{}", bucket_name, file_name);

    let client = reqwest::blocking::Client::new();
    let response = client
        .get(&format!("{}{}", supabase_url, file_path))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .map_err(|e| format!("Erreur lors du téléchargement: {}", e))?;

    if response.status().is_success() {
        let bytes = response.bytes()
            .map_err(|e| format!("Erreur lors de la lecture des données: {}", e))?;

        // Sauvegarder dans un fichier temporaire
        let temp_dir = std::env::temp_dir();
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let local_path = temp_dir.join(format!("downloaded_backup_{}.zip", timestamp));

        fs::write(&local_path, bytes)
            .map_err(|e| format!("Erreur lors de l'écriture du fichier: {}", e))?;

        Ok(local_path.to_string_lossy().to_string())
    } else {
        let error_text = response.text().unwrap_or_else(|_| "Erreur inconnue".to_string());
        Err(format!("Erreur lors du téléchargement: {}", error_text))
    }
}

/// Supprime un backup depuis Supabase Storage
#[command]
pub fn delete_backup_from_supabase(
    file_name: String,
    _user_id: String,
    access_token: String,
) -> Result<(), String> {
    let supabase_url = "https://rronicslgyoubiofbinu.supabase.co";
    let bucket_name = "user-backups";

    let file_path = format!("/storage/v1/object/{}/{}", bucket_name, file_name);

    let client = reqwest::blocking::Client::new();
    let response = client
        .delete(&format!("{}{}", supabase_url, file_path))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .map_err(|e| format!("Erreur lors de la suppression: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let error_text = response.text().unwrap_or_else(|_| "Erreur inconnue".to_string());
        Err(format!("Erreur lors de la suppression: {}", error_text))
    }
}

