use serde::{Deserialize, Serialize};
use std::fs;
use tauri::command;
use tauri::Manager;
use crate::scripts::config_paths::get_config_file_path as get_config_path;

const FILE_NAME: &str = "onboarding.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnboardingState {
    /// `true` quand l'utilisateur a cliqué sur « C'est parti » à la dernière
    /// étape OU sur « Passer ». Bloque la réapparition du wizard au prochain
    /// démarrage.
    pub onboarding_done: bool,
    /// Nombre de fois que le wizard a été monté (incrémenté à chaque ouverture).
    /// Sert au debug.
    #[serde(default)]
    pub attempts: u32,
    /// `true` quand le wizard a été terminé au moins une fois (bouton final ou
    /// Passer). Sert à décider si on affiche le bouton « Passer » dès le début :
    /// la consigne du user est « pas de Passer au tout 1er lancement, oui dès
    /// la 2e fois où ça apparaît » — la 2e fois implique qu'il l'a déjà vu et
    /// fini une fois.
    #[serde(default)]
    pub was_completed: bool,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            onboarding_done: false,
            attempts: 0,
            was_completed: false,
        }
    }
}

fn read_state(app: &tauri::AppHandle) -> OnboardingState {
    let path = match get_config_path(app.path(), FILE_NAME) {
        Ok(p) => p,
        Err(_) => return OnboardingState::default(),
    };
    if !path.exists() {
        return OnboardingState::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<OnboardingState>(&raw).ok())
        .unwrap_or_default()
}

fn write_state(app: &tauri::AppHandle, state: &OnboardingState) -> Result<(), String> {
    let path = get_config_path(app.path(), FILE_NAME)?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[command]
pub fn get_onboarding_state(app: tauri::AppHandle) -> Result<OnboardingState, String> {
    Ok(read_state(&app))
}

/// Incrémente `attempts` et persiste. Appelé par le frontend AVANT de monter
/// la 1re étape : ainsi à la 2e ouverture (attempts >= 1) on saura afficher
/// le bouton « Passer ».
#[command]
pub fn record_onboarding_attempt(app: tauri::AppHandle) -> Result<OnboardingState, String> {
    let mut state = read_state(&app);
    state.attempts = state.attempts.saturating_add(1);
    write_state(&app, &state)?;
    Ok(state)
}

#[command]
pub fn complete_onboarding(app: tauri::AppHandle) -> Result<(), String> {
    let mut state = read_state(&app);
    state.onboarding_done = true;
    state.was_completed = true;
    write_state(&app, &state)
}

/// Réinitialise l'état (utile pour debug ou pour relancer le wizard depuis
/// les paramètres). Met `onboarding_done = false` mais conserve `was_completed`
/// pour que le bouton « Passer » apparaisse au re-trigger.
#[command]
pub fn reset_onboarding(app: tauri::AppHandle) -> Result<(), String> {
    let mut state = read_state(&app);
    state.onboarding_done = false;
    write_state(&app, &state)
}
