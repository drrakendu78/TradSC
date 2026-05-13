// Capture des inputs joystick (DirectInput / vJoy / HOTAS / sticks divers) via
// la crate `gilrs`. Le browser API `navigator.getGamepads()` ne voit que les
// devices XInput (Xbox / DualSense), donc les sticks DirectInput (vJoy, Sol-R,
// HOTAS Logitech Extreme) sont invisibles cote webview. Ce module les expose
// au frontend pour la dialog d'edition de binding ("En ecoute...").
//
// vJoy expose jusqu'a 128 boutons par device, donc on enumere exhaustivement
// les buttons retournes par gilrs (et pas seulement la liste 17 boutons
// "known" du standard Xbox).

use gilrs::{Gilrs, GilrsBuilder};
use serde::Serialize;
use std::sync::Mutex;
use tauri::command;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GilrsDevice {
    pub slot: u32,
    pub name: String,
    pub connected: bool,
    pub buttons: u32,
    pub axes: u32,
}

/// Enumere les joysticks vus par gilrs (DirectInput sur Windows). Sur Windows
/// avec DirectInput, le nom est souvent generique ("Controleur de jeu HID"),
/// donc le slot est le seul moyen de distinguer plusieurs sticks identiques.
/// Le frontend les ajoute dans la liste hardware pour permettre a l'user de
/// les choisir explicitement via "Lie a".
#[command]
pub fn list_gilrs_joystick_devices() -> Result<Vec<GilrsDevice>, String> {
    let mut guard = GILRS.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    if guard.is_none() {
        let gilrs = GilrsBuilder::new()
            .add_included_mappings(false)
            .build()
            .map_err(|e| format!("Gilrs init failed: {}", e))?;
        *guard = Some(gilrs);
    }
    let gilrs = guard.as_mut().expect("Gilrs initialized above");
    while let Some(_event) = gilrs.next_event() {}

    let mut devices: Vec<GilrsDevice> = Vec::new();
    let mut slot: u32 = 0;
    for (_id, gamepad) in gilrs.gamepads() {
        slot += 1;
        let state = gamepad.state();
        devices.push(GilrsDevice {
            slot,
            name: gamepad.name().to_string(),
            connected: gamepad.is_connected(),
            buttons: state.buttons().count() as u32,
            axes: state.axes().count() as u32,
        });
    }
    Ok(devices)
}

const AXIS_THRESHOLD: f32 = 0.65;
const TRIGGER_THRESHOLD: f32 = 0.6;
const MAX_BUTTONS_PER_DEVICE: usize = 128;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapturedJoystickInput {
    /// Format Star Citizen : `js<slot>_button<n>` (1-based) ou `js<slot>_<axis>`.
    pub input: String,
    pub device_name: String,
    /// Index 1-based (Star Citizen). slot=1 = premier device detecte par gilrs.
    pub slot: u32,
}

static GILRS: Mutex<Option<Gilrs>> = Mutex::new(None);

/// Snapshot des inputs actuellement actifs (boutons presses, axes au-dela du
/// seuil) sur tous les joysticks DirectInput / XInput vus par gilrs.
///
/// Appele en polling depuis la dialog "En ecoute" du BindingsEditor. Combine
/// avec `navigator.getGamepads()` cote browser, on couvre XInput (Xbox-like)
/// + DirectInput (vJoy, HOTAS, sticks divers que la webview ne voit pas).
#[command]
pub fn read_active_joystick_inputs() -> Result<Vec<CapturedJoystickInput>, String> {
    let mut guard = GILRS.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    if guard.is_none() {
        let gilrs = GilrsBuilder::new()
            .add_included_mappings(false)
            .build()
            .map_err(|e| format!("Gilrs init failed: {}", e))?;
        *guard = Some(gilrs);
    }
    let gilrs = guard.as_mut().expect("Gilrs initialized above");

    // Pomper les events pour rafraichir l'etat des devices avant la lecture.
    while let Some(_event) = gilrs.next_event() {}

    let mut inputs: Vec<CapturedJoystickInput> = Vec::new();
    let mut slot_counter: u32 = 0;

    for (_id, gamepad) in gilrs.gamepads() {
        slot_counter += 1;
        let slot = slot_counter;
        let name = gamepad.name().to_string();
        let state = gamepad.state();

        // Buttons : on extrait le vrai index DirectInput depuis le Code brut
        // retourne par gilrs (pas un enumerate, qui produit des decalages
        // quand le device a des "trous" dans la map button1..N).
        //
        // Windows DirectInput : DIJOFS_BUTTON(n) = 0x30 + n, donc le button
        // index Star Citizen (1-based) = (code - 0x30) + 1.
        // Si le format n'est pas DirectInput (XInput), on fallback sur un
        // mapping lineaire et on garde quand meme un index valide.
        const DIJOFS_BUTTON0: u32 = 0x30;
        let mut fallback_idx: u32 = 0;
        for (code, button_data) in state.buttons() {
            fallback_idx += 1;
            let raw = code.into_u32();
            let button_idx = if raw >= DIJOFS_BUTTON0 && raw < DIJOFS_BUTTON0 + MAX_BUTTONS_PER_DEVICE as u32 {
                // Raw au format DIJOFS_BUTTON (offset DirectInput) : on isole
                // l'index 0-based puis on convertit en 1-based pour SC.
                raw - DIJOFS_BUTTON0 + 1
            } else if raw < MAX_BUTTONS_PER_DEVICE as u32 {
                // Raw 0-indexed brut (cas gilrs sur Windows). Button physique
                // 1 = raw 0, donc on ajoute 1 pour 1-based SC.
                raw + 1
            } else {
                fallback_idx
            };
            if button_idx as usize > MAX_BUTTONS_PER_DEVICE {
                continue;
            }
            // Check digital seulement (`is_pressed`) sans seuil analog.
            // Le check `value() > TRIGGER_THRESHOLD` provoquait des
            // declenchements en boucle sur les Sol-R / sticks qui ont des
            // boutons avec une valeur de repos > 0 (~0.6-0.7).
            if button_data.is_pressed() {
                inputs.push(CapturedJoystickInput {
                    input: format!("js{}_button{}", slot, button_idx),
                    device_name: name.clone(),
                    slot,
                });
            }
        }

        // Axes : DIJOFS_X = 0, DIJOFS_Y = 4, DIJOFS_Z = 8, DIJOFS_RX = 12,
        // DIJOFS_RY = 16, DIJOFS_RZ = 20, DIJOFS_SLIDER(n) = 24 + n*4.
        // Fallback : mapping sequentiel par ordre d'apparition.
        let axis_names_seq = ["x", "y", "z", "rotx", "roty", "rotz", "slider1", "slider2"];
        let mut axis_idx_seq: usize = 0;
        for (code, axis_data) in state.axes() {
            let raw = code.into_u32();
            let axis_name: String = match raw {
                0 => "x".into(),
                4 => "y".into(),
                8 => "z".into(),
                12 => "rotx".into(),
                16 => "roty".into(),
                20 => "rotz".into(),
                24 => "slider1".into(),
                28 => "slider2".into(),
                _ => {
                    if axis_idx_seq < axis_names_seq.len() {
                        let n = axis_names_seq[axis_idx_seq].to_string();
                        axis_idx_seq += 1;
                        n
                    } else {
                        continue;
                    }
                }
            };
            if axis_data.value().abs() > AXIS_THRESHOLD {
                inputs.push(CapturedJoystickInput {
                    input: format!("js{}_{}", slot, axis_name),
                    device_name: name.clone(),
                    slot,
                });
            }
        }
    }

    Ok(inputs)
}
