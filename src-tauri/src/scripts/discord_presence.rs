use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, State};

// ID de l'application Discord (à créer sur https://discord.com/developers/applications)
// Remplacer par votre propre ID d'application
const DISCORD_APP_ID: &str = "1445196098108133406";

/// État global du client Discord
pub struct DiscordState {
    pub client: Mutex<Option<DiscordIpcClient>>,
    pub connected: Mutex<bool>,
    pub current_activity: Mutex<Option<DiscordActivity>>,
}

impl Default for DiscordState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
            connected: Mutex::new(false),
            current_activity: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscordActivity {
    pub state: Option<String>,
    pub details: Option<String>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
}

#[derive(Serialize)]
pub struct DiscordStatus {
    pub connected: bool,
    pub activity: Option<DiscordActivity>,
}

/// Connecte l'application à Discord
#[command]
pub fn connect_discord(state: State<DiscordState>) -> Result<bool, String> {
    let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;

    // Si déjà connecté, retourner
    if *connected_lock {
        return Ok(true);
    }

    // Créer un nouveau client (v1.0.0 ne retourne pas un Result)
    let mut client = DiscordIpcClient::new(DISCORD_APP_ID);

    // Se connecter à Discord
    match client.connect() {
        Ok(_) => {
            *client_lock = Some(client);
            *connected_lock = true;

            // Définir l'activité par défaut
            drop(client_lock);
            drop(connected_lock);

            let default_activity = DiscordActivity {
                state: Some("Gère ses traductions".to_string()),
                details: Some("StarTrad FR".to_string()),
                large_image: Some("icon".to_string()),
                large_text: Some("StarTrad FR".to_string()),
                small_image: None,
                small_text: None,
            };

            let _ = update_discord_activity(state, default_activity);

            Ok(true)
        }
        Err(e) => {
            Err(format!("Impossible de se connecter à Discord: {}. Vérifiez que Discord est ouvert.", e))
        }
    }
}

/// Déconnecte l'application de Discord
#[command]
pub fn disconnect_discord(state: State<DiscordState>) -> Result<(), String> {
    let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;
    let mut activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut client) = *client_lock {
        let _ = client.close();
    }

    *client_lock = None;
    *connected_lock = false;
    *activity_lock = None;

    Ok(())
}

/// Fonction interne pour créer l'activité Discord à partir de notre struct
fn build_discord_activity(activity: &DiscordActivity) -> activity::Activity<'_> {
    let mut discord_activity = activity::Activity::new();

    if let Some(ref state_text) = activity.state {
        discord_activity = discord_activity.state(state_text);
    }

    if let Some(ref details) = activity.details {
        discord_activity = discord_activity.details(details);
    }

    // Configurer les images
    let mut assets = activity::Assets::new();
    let mut has_assets = false;

    if let Some(ref large_image) = activity.large_image {
        assets = assets.large_image(large_image);
        has_assets = true;
    }

    if let Some(ref large_text) = activity.large_text {
        assets = assets.large_text(large_text);
        has_assets = true;
    }

    if let Some(ref small_image) = activity.small_image {
        assets = assets.small_image(small_image);
        has_assets = true;
    }

    if let Some(ref small_text) = activity.small_text {
        assets = assets.small_text(small_text);
        has_assets = true;
    }

    if has_assets {
        discord_activity = discord_activity.assets(assets);
    }

    discord_activity
}

/// Tente de reconnecter à Discord et restaurer l'activité précédente
#[command]
pub fn reconnect_discord(state: State<DiscordState>) -> Result<bool, String> {
    // Récupérer l'activité sauvegardée avant de tout réinitialiser
    let saved_activity = {
        let activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;
        activity_lock.clone()
    };

    // Fermer l'ancienne connexion proprement
    {
        let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
        let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;

        if let Some(ref mut client) = *client_lock {
            let _ = client.close();
        }
        *client_lock = None;
        *connected_lock = false;
    }

    // Créer une nouvelle connexion
    let mut client = DiscordIpcClient::new(DISCORD_APP_ID);

    match client.connect() {
        Ok(_) => {
            // Restaurer l'activité si elle existait
            let activity_to_set = saved_activity.unwrap_or_else(|| DiscordActivity {
                state: Some("Gère ses traductions".to_string()),
                details: Some("StarTrad FR".to_string()),
                large_image: Some("icon".to_string()),
                large_text: Some("StarTrad FR".to_string()),
                small_image: None,
                small_text: None,
            });

            let discord_activity = build_discord_activity(&activity_to_set);

            if client.set_activity(discord_activity).is_ok() {
                let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
                let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;
                let mut activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;

                *client_lock = Some(client);
                *connected_lock = true;
                *activity_lock = Some(activity_to_set);

                Ok(true)
            } else {
                Err("Connexion établie mais impossible de définir l'activité".to_string())
            }
        }
        Err(e) => {
            Err(format!("Discord n'est pas disponible: {}", e))
        }
    }
}

/// Vérifie si la connexion Discord est toujours active et tente de reconnecter si nécessaire
#[command]
pub fn check_and_reconnect_discord(state: State<DiscordState>) -> Result<bool, String> {
    let is_connected = *state.connected.lock().map_err(|e| e.to_string())?;

    if !is_connected {
        // Pas connecté, essayer de reconnecter
        return reconnect_discord(state);
    }

    // Tester si la connexion est toujours valide en essayant de mettre à jour l'activité
    let saved_activity = {
        let activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;
        activity_lock.clone()
    };

    if let Some(activity) = saved_activity {
        let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;

        if let Some(ref mut client) = *client_lock {
            let discord_activity = build_discord_activity(&activity);

            if client.set_activity(discord_activity).is_err() {
                // La connexion est morte, marquer comme déconnecté et tenter de reconnecter
                drop(client_lock);

                {
                    let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;
                    *connected_lock = false;
                }

                return reconnect_discord(state);
            }
        }
    }

    Ok(true)
}

/// Met à jour l'activité Discord
#[command]
pub fn update_discord_activity(
    state: State<DiscordState>,
    activity: DiscordActivity,
) -> Result<(), String> {
    let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let connected = *state.connected.lock().map_err(|e| e.to_string())?;

    if !connected {
        return Err("Non connecté à Discord".to_string());
    }

    if let Some(ref mut client) = *client_lock {
        let discord_activity = build_discord_activity(&activity);

        match client.set_activity(discord_activity) {
            Ok(_) => {
                // Sauvegarder l'activité courante
                let mut activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;
                *activity_lock = Some(activity);
                Ok(())
            }
            Err(e) => {
                // La connexion est probablement morte, marquer comme déconnecté
                drop(client_lock);
                let mut connected_lock = state.connected.lock().map_err(|e| e.to_string())?;
                *connected_lock = false;
                Err(format!("Connexion Discord perdue: {}", e))
            }
        }
    } else {
        Err("Client Discord non initialisé".to_string())
    }
}

/// Retourne le statut actuel de la connexion Discord
#[command]
pub fn get_discord_status(state: State<DiscordState>) -> Result<DiscordStatus, String> {
    let connected = *state.connected.lock().map_err(|e| e.to_string())?;
    let activity = state
        .current_activity
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    Ok(DiscordStatus {
        connected,
        activity,
    })
}

/// Met à jour l'activité avec la version en cours de traduction
#[command]
pub fn set_translating_activity(
    state: State<DiscordState>,
    version: String,
) -> Result<(), String> {
    let activity = DiscordActivity {
        state: Some(format!("Traduit {}", version)),
        details: Some("StarTrad FR".to_string()),
        large_image: Some("icon".to_string()),
        large_text: Some("StarTrad FR".to_string()),
        small_image: None,
        small_text: None,
    };

    update_discord_activity(state, activity)
}

/// Efface l'activité Discord (présence invisible)
#[command]
pub fn clear_discord_activity(state: State<DiscordState>) -> Result<(), String> {
    let mut client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let connected = *state.connected.lock().map_err(|e| e.to_string())?;

    if !connected {
        return Err("Non connecté à Discord".to_string());
    }

    if let Some(ref mut client) = *client_lock {
        client
            .clear_activity()
            .map_err(|e| format!("Erreur suppression activité Discord: {}", e))?;

        let mut activity_lock = state.current_activity.lock().map_err(|e| e.to_string())?;
        *activity_lock = None;
    }

    Ok(())
}
