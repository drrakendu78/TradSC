// Window overlay Tauri pour les achats de cargo.
//
// Pattern minimal inspiré de open_overlay_hub :
// - WebviewWindow transparente, always_on_top, sans bordures
// - URL : index.html#/overlay-cargo-buy
// - Position : bas-droite de l'écran principal
// - Taille : 400×320 px (assez pour la card complète)
//
// Cycle de vie :
// - Première fois : create + show + emit event au React
// - Suivantes : show (déjà existante) + emit l'event
// - Le React side fait l'auto-hide après 20s via window.hide()

use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::time::sleep;

use crate::scripts::gamelog_blueprint_watcher::CargoBuyPayload;
use crate::scripts::uex_commodity_api::{suggest_sell_locations, CommoditySuggestionResult};

const CARGO_OVERLAY_LABEL: &str = "cargo_overlay";
const OVERLAY_WIDTH: f64 = 400.0;
const OVERLAY_HEIGHT: f64 = 320.0;
const MARGIN: f64 = 20.0;

/// Dernier payload cargo enregistré côté Rust. Le React le query au mount
/// pour ne plus dépendre de la fragile timing des events Tauri.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCargoPayload {
    pub ts: f64,
    pub shop_name: String,
    pub shop_id: u64,
    pub price_total: f64,
    pub price_per_csu: f64,
    pub commodity_guid: String,
    pub quantity_csu: f64,
    pub box_size: f64,
    pub unit_amount: u64,
}

static LAST_PAYLOAD: Mutex<Option<CachedCargoPayload>> = Mutex::new(None);

pub fn set_last_payload(payload: CachedCargoPayload) {
    if let Ok(mut guard) = LAST_PAYLOAD.lock() {
        *guard = Some(payload);
    }
}

#[tauri::command]
pub fn cargo_overlay_get_last_payload() -> Option<CachedCargoPayload> {
    LAST_PAYLOAD.lock().ok().and_then(|g| g.clone())
}

/// Permet à JS (mode debug ou autre) de set un payload sans passer par le
/// watcher. Utile pour tester l'overlay depuis la devtools.
#[tauri::command]
pub fn cargo_overlay_set_last_payload_cmd(payload: CachedCargoPayload) {
    set_last_payload(payload);
}

/// Calcule la position bas-droite de l'écran principal.
fn bottom_right_position<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;
        let x = screen_w - OVERLAY_WIDTH - MARGIN;
        let y = screen_h - OVERLAY_HEIGHT - MARGIN - 50.0; // 50 px au-dessus taskbar
        return (x, y);
    }
    (1500.0, 700.0) // fallback raisonnable
}

/// Persistance position window cargo overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedPosition {
    x: f64,
    y: f64,
}

fn position_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("cargo_overlay_pos.json"))
}

fn load_saved_position<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let path = position_file_path(app)?;
    let content = std::fs::read_to_string(&path).ok()?;
    let pos: SavedPosition = serde_json::from_str(&content).ok()?;
    Some((pos.x, pos.y))
}

fn save_position<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) {
    let Some(path) = position_file_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let pos = SavedPosition { x, y };
    if let Ok(json) = serde_json::to_string_pretty(&pos) {
        let _ = std::fs::write(&path, json);
    }
}

/// Position initiale : saved si dispo, sinon bas-droite.
fn initial_position<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    load_saved_position(app).unwrap_or_else(|| bottom_right_position(app))
}

/// Strip COMPLET des decorations Win32 (style + ex_style).
/// Doit être appelé après chaque `show()` car Windows peut redessiner
/// la title bar lors d'un changement de focus, repaint, ou hide/show.
#[cfg(target_os = "windows")]
fn force_strip_decorations<R: Runtime>(win: &WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos,
        GWL_STYLE, GWL_EXSTYLE,
        WS_CAPTION, WS_BORDER, WS_DLGFRAME, WS_THICKFRAME, WS_SYSMENU,
        WS_EX_DLGMODALFRAME, WS_EX_WINDOWEDGE, WS_EX_CLIENTEDGE, WS_EX_STATICEDGE,
        WS_EX_NOACTIVATE,
        SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE,
        HWND_TOP,
    };
    unsafe {
        if let Ok(hwnd_raw) = win.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            // Style normal
            let style = GetWindowLongW(h, GWL_STYLE);
            let stripped = style
                & !(WS_CAPTION.0 as i32)
                & !(WS_BORDER.0 as i32)
                & !(WS_DLGFRAME.0 as i32)
                & !(WS_THICKFRAME.0 as i32)
                & !(WS_SYSMENU.0 as i32);
            let _ = SetWindowLongW(h, GWL_STYLE, stripped);
            // Extended style : strip + ajoute WS_EX_NOACTIVATE pour ne PAS
            // voler le focus du jeu (sinon Windows force la window vers
            // l'arrière quand le jeu est focused / fullscreen borderless).
            let ex_style = GetWindowLongW(h, GWL_EXSTYLE);
            let stripped_ex = (ex_style
                & !(WS_EX_DLGMODALFRAME.0 as i32)
                & !(WS_EX_WINDOWEDGE.0 as i32)
                & !(WS_EX_CLIENTEDGE.0 as i32)
                & !(WS_EX_STATICEDGE.0 as i32))
                | (WS_EX_NOACTIVATE.0 as i32);
            let _ = SetWindowLongW(h, GWL_EXSTYLE, stripped_ex);
            let _ = SetWindowPos(
                h, HWND_TOP, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

/// Force la window à être topmost (au-dessus de SC borderless).
/// `always_on_top(true)` au build ne suffit pas toujours sur Windows 11 :
/// SC peut prendre le foreground et faire glisser la window en Z-order
/// en dessous. SetWindowPos(HWND_TOPMOST) avec SWP_NOACTIVATE la remet
/// devant sans voler le focus.
#[cfg(target_os = "windows")]
fn force_topmost<R: Runtime>(win: &WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE,
    };
    unsafe {
        if let Ok(hwnd_raw) = win.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            let _ = SetWindowPos(
                h, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

/// Affiche la window SANS voler le focus.
/// `win.show()` (Tauri) → ShowWindow(SW_SHOW) qui ACTIVE la window même
/// si WS_EX_NOACTIVATE est posé. Pour vraiment ne pas voler le focus de
/// SC, il faut ShowWindow(SW_SHOWNOACTIVATE) explicitement.
#[cfg(target_os = "windows")]
fn show_noactivate<R: Runtime>(win: &WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    unsafe {
        if let Ok(hwnd_raw) = win.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn force_strip_decorations<R: Runtime>(_win: &WebviewWindow<R>) {}

#[cfg(not(target_os = "windows"))]
fn force_topmost<R: Runtime>(_win: &WebviewWindow<R>) {}

#[cfg(not(target_os = "windows"))]
fn show_noactivate<R: Runtime>(win: &WebviewWindow<R>) {
    let _ = win.show();
}

/// Rend le focus au jeu juste APRÈS l'apparition de l'overlay. Le
/// `SW_SHOWNOACTIVATE` empêche le vol de focus au moment du show, mais
/// WebView2 peut re-voler le focus clavier pendant son premier paint
/// (init du HWND enfant Chromium). On rejoue donc le hand-off
/// `return_focus_to_game` en plusieurs passes différées plutôt qu'une
/// seule fois, pour gagner la course contre l'init de WebView2.
/// Fire-and-forget : ne bloque pas la commande `cargo_overlay_show`.
fn schedule_focus_return<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..3 {
            sleep(Duration::from_millis(250)).await;
            crate::scripts::overlay::return_focus_to_game(&app);
        }
    });
}

/// Garantit que la window cargo overlay existe et est visible.
/// Si elle existe déjà → la montre + re-strip les decorations (Windows peut
/// les redessiner sur un repaint/focus change).
/// Si elle n'existe pas → la crée.
pub async fn ensure_cargo_overlay<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(CARGO_OVERLAY_LABEL) {
        let _ = win.unminimize();
        let _ = win.set_always_on_top(true);
        // Strip decorations + ajoute WS_EX_NOACTIVATE (pas de focus steal)
        force_strip_decorations(&win);
        // Show SANS activer (pas SW_SHOW qui vole le focus de SC)
        show_noactivate(&win);
        // Force topmost — SC borderless peut sinon glisser au-dessus.
        force_topmost(&win);
        let _ = win.set_decorations(false);
        let _ = win.set_title("");
        // Rend le focus au jeu après ré-affichage (nouvel achat).
        schedule_focus_return(&app);
        return Ok(());
    }

    let (x, y) = initial_position(&app);
    let url = WebviewUrl::App("index.html#/overlay-cargo-buy".into());

    let mut last_err = None;
    for _ in 0..2 {
        match WebviewWindowBuilder::new(&app, CARGO_OVERLAY_LABEL, url.clone())
            .title("")
            .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
            .position(x, y)
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false) // important : ne vole pas le focus du jeu
            .build()
        {
            Ok(win) => {
                // Strip + WS_EX_NOACTIVATE AVANT show (sinon le show vole le focus)
                force_strip_decorations(&win);
                // Show SANS activer — SW_SHOWNOACTIVATE au lieu de SW_SHOW
                show_noactivate(&win);
                // Re-strip APRÈS show (Windows redessine au focus)
                force_strip_decorations(&win);
                // Force topmost — SC borderless peut sinon glisser dessus.
                force_topmost(&win);
                let _ = win.set_decorations(false);
                let _ = win.set_title("");

                // CRITIQUE : listener qui re-strip à chaque event window
                // (Focused, Resized, Moved, ScaleChanged, ThemeChanged).
                // Sans ça, Windows redessine la title bar quand le contenu
                // React passe de "card" à "null" (auto-hide / close).
                // Bonus : save la position au Moved → persiste entre achats.
                let win_clone = win.clone();
                let app_clone = app.clone();
                win.on_window_event(move |event| {
                    use tauri::WindowEvent;
                    match event {
                        WindowEvent::Focused(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                        | WindowEvent::ThemeChanged(_) => {
                            force_strip_decorations(&win_clone);
                            // Re-promote topmost dès que SC pourrait avoir
                            // pris le foreground et fait glisser la window.
                            force_topmost(&win_clone);
                            let _ = win_clone.set_decorations(false);
                        }
                        WindowEvent::Moved(pos) => {
                            force_strip_decorations(&win_clone);
                            let _ = win_clone.set_decorations(false);
                            // Convert physical → logical (la position de
                            // WebviewWindowBuilder est en logical).
                            let scale = win_clone.scale_factor().unwrap_or(1.0);
                            let lx = pos.x as f64 / scale;
                            let ly = pos.y as f64 / scale;
                            save_position(&app_clone, lx, ly);
                        }
                        _ => {}
                    }
                });

                // Rend le focus au jeu après l'apparition (1ère création).
                schedule_focus_return(&app);

                return Ok(());
            }
            Err(e) => {
                last_err = Some(e.to_string());
                if let Some(stale) = app.get_webview_window(CARGO_OVERLAY_LABEL) {
                    let _ = stale.close();
                }
                sleep(Duration::from_millis(120)).await;
            }
        }
    }
    Err(last_err.unwrap_or_else(|| "Cargo overlay create failed".into()))
}

/// Tauri command : force open l'overlay (utile pour debug / test depuis l'UI).
#[tauri::command]
pub async fn cargo_overlay_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    ensure_cargo_overlay(app).await
}

/// Tauri command : force hide l'overlay.
#[tauri::command]
pub async fn cargo_overlay_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(CARGO_OVERLAY_LABEL) {
        let _ = win.hide();
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 2 — Overlay NATIF (sidecar Slint `startrad-cargo-overlay`)
//
// Remplace l'overlay WebView2 ci-dessus (gardé pour réf). On lance un binaire
// natif séparé (focus-safe + click-through, cf. crate `cargo-overlay-sidecar`)
// et on lui pousse le payload JSON de l'achat sur stdin. Pattern repris de
// `startrad-updater` : binaire `externalBin` copié à côté de l'exe principal.
// ════════════════════════════════════════════════════════════════════════════

/// Process du sidecar overlay + son stdin GARDÉ OUVERT (pour les MAJ in-place :
/// un nouvel achat écrit une nouvelle ligne JSON au lieu de re-spawn un process).
struct OverlayProc {
    child: Child,
    stdin: ChildStdin,
}
static OVERLAY_CHILD: Mutex<Option<OverlayProc>> = Mutex::new(None);

/// Résout le chemin du binaire sidecar.
/// - Prod : à côté de l'exe principal (Tauri y copie l'`externalBin`).
/// - Dev (`cargo tauri dev`) : fallback vers le build du crate sidecar.
fn sidecar_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let next = dir.join("startrad-cargo-overlay.exe");
    if next.exists() {
        return Some(next);
    }
    // Fallback DEV : dir = <repo>/src-tauri/target/debug → racine = dir/../../..
    let repo = dir.parent()?.parent()?.parent()?;
    for prof in ["release", "debug"] {
        let p = repo
            .join("cargo-overlay-sidecar")
            .join("target")
            .join(prof)
            .join("startrad-cargo-overlay.exe");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Formate un montant avec des espaces fins comme séparateurs de milliers.
fn format_amount(n: f64) -> String {
    let i = n.round() as i64;
    let s = i.abs().to_string();
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if idx > 0 && (s.len() - idx) % 3 == 0 {
            out.push(' ');
        }
        out.push(ch);
    }
    if i < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// Formate un temps de trajet en ETA compact (~Xs / ~Xmin).
fn fmt_eta(seconds: f64) -> String {
    if seconds < 60.0 {
        format!("~{}s", seconds.round() as i64)
    } else {
        format!("~{} min", (seconds / 60.0).round() as i64)
    }
}

/// Fichier de réglages overlay (coin écran, vitesse QD, etc.) dans le data dir.
fn overlay_settings_path() -> Option<std::path::PathBuf> {
    Some(dirs::data_local_dir()?.join("startradfr").join("overlay_settings.json"))
}

/// Coin écran choisi pour l'overlay ("TR" par défaut).
fn load_overlay_corner() -> String {
    overlay_settings_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("corner").and_then(|c| c.as_str()).map(str::to_string))
        .unwrap_or_else(|| "TR".to_string())
}

/// Définit le coin écran de l'overlay (TR/TL/BR/BL). Persisté.
#[tauri::command]
pub fn cargo_overlay_set_corner(corner: String) -> Result<(), String> {
    let path = overlay_settings_path().ok_or_else(|| "data dir introuvable".to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut v = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    v["corner"] = serde_json::Value::String(corner);
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Définit la vitesse quantum (km/s) pour le calcul des temps de trajet. Persisté.
#[tauri::command]
pub fn cargo_overlay_set_qd_speed(kms: f64) -> Result<(), String> {
    let path = overlay_settings_path().ok_or_else(|| "data dir introuvable".to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut v = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    v["qdSpeedKms"] = serde_json::json!(kms);
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Nettoie un shopName interne SC pour l'affichage.
/// "SCShop_Admin_lt_base_g" → "Admin lt base g".
fn clean_shop_name(raw: &str) -> String {
    let s = raw
        .trim_start_matches("SCShop_")
        .trim_start_matches("SCshop_")
        .trim_start_matches("scshop_")
        .replace('_', " ");
    let s = s.trim();
    if s.is_empty() {
        raw.to_string()
    } else {
        s.to_string()
    }
}

/// Une marchandise du manifeste (cale). Les rachats de la même s'accumulent.
struct ManifestEntry {
    guid: String,
    name: String,
    total_csu: f64,
    total_buy: f64,
    price_per_csu: f64,
    shop: String,
    locations: Vec<serde_json::Value>, // reventes (déjà formatées) pour le total
}

/// Manifeste = tout ce que le joueur transporte (persiste entre les achats, vidé
/// au ✕ / fin de tournée). Source de vérité côté app (le sidecar n'affiche que).
static MANIFEST: Mutex<Vec<ManifestEntry>> = Mutex::new(Vec::new());

/// Vide le manifeste (✕ / fin de tournée).
pub fn clear_manifest() {
    if let Ok(mut m) = MANIFEST.lock() {
        m.clear();
    }
}

/// Reventes (top 3) d'une commodity → JSON SellLoc pour le sidecar (ETA incluse).
fn build_locations_json(sugg: Option<&CommoditySuggestionResult>) -> Vec<serde_json::Value> {
    sugg.map(|s| {
        s.top_sell_locations
            .iter()
            .enumerate()
            .map(|(i, loc)| {
                let pos = loc.profit_total >= 0.0;
                let eta = match loc.travel_seconds {
                    Some(t) if t > 1.0 => fmt_eta(t),
                    _ => String::new(),
                };
                serde_json::json!({
                    "rank": (i + 1) as i64,
                    "terminal": loc.terminal_name,
                    "price": format!("{:.2} aUEC/cSCU", loc.sell_price_per_csu),
                    "eta": eta,
                    "profit": format!("{}{}", if pos { "+" } else { "-" }, format_amount(loc.profit_total.abs())),
                    "percent": format!("{:.0}%", loc.profit_percent),
                    "positive": pos,
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

/// Index couleur COHÉRENT avec la marchandise (palette côté sidecar) :
/// 1) override par nom pour les iconiques (Gold doré, Quantanium vert…),
/// 2) sinon par catégorie UEX (`kind` : Metal→argent, Gas→cyan, Drug→magenta…),
/// 3) sinon ambre.
fn commodity_color_index(name: &str) -> i64 {
    let n = name.to_lowercase();
    let name_map: &[(&str, i64)] = &[
        ("gold", 10),
        ("quantanium", 4),
        ("diamond", 9),
        ("laranite", 3),
        ("copper", 5),
        ("agricium", 6),
        ("quartz", 9),
        ("corundum", 9),
        ("beryl", 9),
        ("recycled", 11),
        ("scrap", 11),
        ("waste", 11),
        ("stim", 6),
        ("medical", 6),
        ("distilled", 8),
        ("processed food", 8),
    ];
    for (k, idx) in name_map {
        if n.contains(k) {
            return *idx;
        }
    }
    let kind = crate::scripts::uex_commodity_api::commodity_kind(name).unwrap_or_default();
    match kind.to_lowercase().as_str() {
        "gas" | "halogen" => 1,
        "metal" | "alloy" => 2,
        "drug" => 12,
        "vice" => 7,
        "medical" | "medicine" => 6,
        "food" | "agricultural" => 8,
        "fuel" | "explosive" => 5,
        "scrap" => 11,
        "man-made" => 13,
        "mineral" | "non-metal" | "natural" | "raw materials" => 9,
        _ => 0,
    }
}

/// Payload manifeste complet (liste de marchandises) pour le sidecar.
fn build_manifest_json(m: &[ManifestEntry]) -> String {
    let entries: Vec<serde_json::Value> = m
        .iter()
        .map(|e| {
            let scu = e.total_csu / 100.0;
            let scu_str = if scu.fract().abs() < 0.005 {
                format!("{scu:.0}")
            } else {
                format!("{scu:.2}")
            };
            let sub = format!("{} SCU · {} aUEC", scu_str, format_amount(e.total_buy));
            let shop = format!(
                "Acheté à {} · {:.2} aUEC/cSCU",
                clean_shop_name(&e.shop),
                e.price_per_csu
            );
            let commodity = if e.name.is_empty() {
                "Marchandise".to_string()
            } else {
                e.name.clone()
            };
            serde_json::json!({
                "guid": e.guid,
                "commodity": commodity,
                "colorIndex": commodity_color_index(&commodity),
                "sub": sub,
                "shop": shop,
                "locations": e.locations,
            })
        })
        .collect();
    serde_json::json!({
        "entries": entries,
        "pinned": false,
        "autoHideMs": 30000,
        "corner": load_overlay_corner(),
    })
    .to_string()
}

/// Spawn (ou re-spawn) le sidecar avec un JSON déjà construit. Tue l'instance
/// précédente (un seul overlay à la fois).
fn spawn_sidecar_with_json(json: &str) {
    let line = format!("{json}\n"); // payloads délimités par newline (streaming)
    let mut guard = match OVERLAY_CHILD.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    // MAJ IN-PLACE si l'overlay tourne encore : on écrit une nouvelle ligne sur
    // son stdin (gardé ouvert) → pas de re-spawn, pas de flicker.
    if let Some(proc) = guard.as_mut() {
        let alive = matches!(proc.child.try_wait(), Ok(None));
        if alive && proc.stdin.write_all(line.as_bytes()).is_ok() {
            let _ = proc.stdin.flush();
            return;
        }
        // mort (auto-hide / ✕) ou pipe cassé → on relance
        let _ = proc.child.kill();
        *guard = None;
    }

    // Sinon : spawn neuf.
    let Some(path) = sidecar_path() else {
        eprintln!("[cargo-overlay] binaire sidecar introuvable");
        return;
    };
    let mut cmd = Command::new(&path);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take();
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(line.as_bytes());
                let _ = stdin.flush();
                // stdin GARDÉ ouvert (stocké) → MAJ in-place + retrait "vendu".
                *guard = Some(OverlayProc { child, stdin });
            }
            // Lit le stdout du sidecar : "SOLD <guid>" (case vendu cliquée) →
            // retire la marchandise du manifeste. Thread par sidecar (s'arrête à
            // l'EOF quand le sidecar meurt).
            if let Some(out) = stdout {
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(out);
                    for line in reader.lines() {
                        let Ok(l) = line else { break };
                        let l = l.trim();
                        if let Some(guid) = l.strip_prefix("SOLD ") {
                            handle_sold(guid.trim());
                        } else if l == "CLEAR" {
                            clear_manifest();
                        }
                    }
                });
            }
        }
        Err(e) => eprintln!("[cargo-overlay] spawn sidecar échoué : {e}"),
    }
}

/// "Vendu" depuis l'overlay : retire la marchandise (guid) du manifeste et
/// renvoie le manifeste à jour au sidecar (sur son stdin).
fn handle_sold(guid: &str) {
    let json = {
        let mut m = match MANIFEST.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let before = m.len();
        m.retain(|e| e.guid != guid);
        if m.len() == before {
            return; // rien retiré → pas la peine de renvoyer
        }
        build_manifest_json(&m)
    };
    if let Ok(mut guard) = OVERLAY_CHILD.lock() {
        if let Some(proc) = guard.as_mut() {
            let line = format!("{json}\n");
            let _ = proc.stdin.write_all(line.as_bytes());
            let _ = proc.stdin.flush();
        }
    }
}

/// Tue l'overlay natif (à appeler à la fermeture de l'app — sinon un overlay
/// épinglé survivrait en orphelin).
pub fn kill_overlay() {
    if let Ok(mut guard) = OVERLAY_CHILD.lock() {
        if let Some(mut proc) = guard.take() {
            let _ = proc.child.kill();
        }
    }
}

/// Lance/MAJ l'overlay pour un achat. Accumule dans le manifeste (même
/// marchandise = +SCU, sinon nouvelle ligne), recalcule les reventes pour le
/// TOTAL, et envoie le manifeste complet au sidecar. Async non bloquant.
pub fn spawn_overlay_for_buy(p: &CargoBuyPayload) {
    let p = p.clone();
    tauri::async_runtime::spawn(async move {
        // 1. Accumuler dans le manifeste (lock court, aucun await sous le lock).
        let (guid, total_csu, total_buy, ppc, shop) = {
            let mut m = match MANIFEST.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if let Some(e) = m.iter_mut().find(|e| e.guid == p.commodity_guid) {
                e.total_csu += p.quantity_csu;
                e.total_buy += p.price_total;
                e.price_per_csu = p.price_per_csu;
                e.shop = p.shop_name.clone();
            } else {
                m.push(ManifestEntry {
                    guid: p.commodity_guid.clone(),
                    name: String::new(),
                    total_csu: p.quantity_csu,
                    total_buy: p.price_total,
                    price_per_csu: p.price_per_csu,
                    shop: p.shop_name.clone(),
                    locations: Vec::new(),
                });
            }
            let e = m
                .iter()
                .find(|e| e.guid == p.commodity_guid)
                .expect("entrée juste insérée");
            (
                e.guid.clone(),
                e.total_csu,
                e.total_buy,
                e.price_per_csu,
                e.shop.clone(),
            )
        };

        // 2. Reventes pour le TOTAL (async, HORS lock).
        let sugg = suggest_sell_locations(guid.clone(), total_csu, total_buy, Some(ppc), Some(shop))
            .await
            .ok();

        // 3. Stocker nom + reventes, construire et envoyer le manifeste complet.
        let json = {
            let mut m = match MANIFEST.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if let Some(e) = m.iter_mut().find(|e| e.guid == guid) {
                if let Some(s) = &sugg {
                    if !s.commodity_name.is_empty() {
                        e.name = s.commodity_name.clone();
                    }
                }
                e.locations = build_locations_json(sugg.as_ref());
            }
            build_manifest_json(&m)
        };
        spawn_sidecar_with_json(&json);
    });
}

/// Commande de test : ouvre l'overlay natif avec des données démo, sans achat
/// réel (à appeler depuis la devtools : `invoke('cargo_overlay_test_native')`).
#[tauri::command]
pub fn cargo_overlay_test_native() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    let i = N.fetch_add(1, Ordering::Relaxed);
    // Cycle sur des marchandises DIFFÉRENTES → on voit le manifeste se remplir
    // en liste ; re-Nitrogen (indices 0 et 3) → accumulation (+SCU sur sa ligne).
    // GUIDs de test mappés dans guid_mapping.json (Aluminum/Gold).
    let demos: [(&str, f64, f64); 3] = [
        ("f9f3251a-8e48-408a-b957-f1e3d5d3e213", 22.29, 200.0), // Nitrogen (mappé)
        ("startrad-test-aluminum", 18.50, 150.0),               // Aluminum
        ("startrad-test-gold", 60.00, 90.0),                    // Gold
    ];
    let (guid, ppc, scu) = demos[i % demos.len()];
    let qty_csu = scu * 100.0;
    let demo = CargoBuyPayload {
        ts: 0.0,
        shop_name: "SCShop_Admin_lt_base_g".into(),
        shop_id: 9_553_341_957_175,
        price_total: qty_csu * ppc,
        price_per_csu: ppc,
        commodity_guid: guid.into(),
        quantity_csu: qty_csu,
        box_size: 8.0,
        unit_amount: 25,
    };
    spawn_overlay_for_buy(&demo);
}
