use tauri::{command, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::{sleep, Duration};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowTextW, IsWindowVisible,
    SetForegroundWindow, SetLayeredWindowAttributes, SetWindowLongW, SetWindowPos,
    GWL_EXSTYLE, GWL_STYLE, HWND_TOP, LWA_ALPHA, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, WS_BORDER, WS_CAPTION, WS_DLGFRAME, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_THICKFRAME,
};

/// Hauteur (en px logiques) de la mini-fenêtre `OverlayWebviewBar` qui se
/// colle au-dessus de chaque webview overlay (sites externes qui refusent
/// l'iframe : SP Viewer, UEX, AllSky, Protixit, etc.). Cette constante est
/// la source de vérité partagée entre `open_webview_overlay` (décale la
/// webview de +36 en Y), `spawn_webview_bar` / `reposition_webview_bar`
/// (positionnent la bar 36 px au-dessus de la webview) et
/// `get_webview_overlay_geometry` (retourne la zone que la bar doit
/// occuper). Doit rester aligné avec le LogicalSize côté `OverlayWebviewBar.tsx`.
pub const WEBVIEW_BAR_HEIGHT: f64 = 36.0;

fn overlay_target_label(id: &str, overlay_type: &str) -> String {
    match overlay_type {
        "webview" => format!("wvoverlay_{}", id),
        _ => format!("overlay_{}", id),
    }
}

fn overlay_control_label(id: &str, overlay_type: &str) -> String {
    match overlay_type {
        "webview" => format!("overlayctl_wv_{}", id),
        _ => format!("overlayctl_if_{}", id),
    }
}

fn close_overlay_control_window(app_handle: &AppHandle, id: &str, overlay_type: &str) {
    let ctl_label = overlay_control_label(id, overlay_type);
    if let Some(control) = app_handle.get_webview_window(&ctl_label) {
        let _ = control.close();
    }
}

fn parse_overlay_target_label(label: &str) -> Option<(String, String)> {
    if let Some(id) = label.strip_prefix("wvoverlay_") {
        if !id.is_empty() {
            return Some((id.to_string(), "webview".to_string()));
        }
    }

    if let Some(id) = label.strip_prefix("overlay_") {
        if !id.is_empty() {
            return Some((id.to_string(), "iframe".to_string()));
        }
    }

    None
}

fn parse_overlay_control_label(label: &str) -> Option<(String, String)> {
    if let Some(id) = label.strip_prefix("overlayctl_wv_") {
        if !id.is_empty() {
            return Some((id.to_string(), "webview".to_string()));
        }
    }

    if let Some(id) = label.strip_prefix("overlayctl_if_") {
        if !id.is_empty() {
            return Some((id.to_string(), "iframe".to_string()));
        }
    }

    None
}

fn open_overlay_targets(app_handle: &AppHandle) -> Vec<(String, String)> {
    app_handle
        .webview_windows()
        .keys()
        .filter_map(|label| parse_overlay_target_label(label.as_str()))
        .collect()
}

fn cleanup_orphaned_control_windows(app_handle: &AppHandle) {
    let windows = app_handle.webview_windows();
    for (label, win) in &windows {
        if let Some((id, overlay_type)) = parse_overlay_control_label(label.as_str()) {
            let target_label = overlay_target_label(&id, &overlay_type);
            if !windows.contains_key(&target_label) {
                let _ = win.close();
            }
        }
    }
}

const CONTROL_WIDTH: i32 = 20;
const CONTROL_HEIGHT: i32 = 20;
const OVERLAY_HUB_LABEL: &str = "overlayhub_main";
// Must match HUB_COLLAPSED_WIDTH / HUB_COLLAPSED_HEIGHT in src/pages/OverlayHub.tsx
// (logical pixels — Tauri scales to physical per monitor DPI).
const OVERLAY_HUB_WIDTH: f64 = 90.0;
const OVERLAY_HUB_HEIGHT: f64 = 42.0;
const OVERLAY_HUB_TOP_OFFSET: f64 = 10.0;
static OVERLAY_HUB_EDIT_MODE: AtomicBool = AtomicBool::new(true);

/// Anchors physiques (x, y, w, h relatives au parent) du bouton œil
/// par overlay. Permet au backend de re-positionner la control window
/// SANS aller-retour IPC quand le parent fire Moved/Resized — ce qui
/// élimine la latence/drift visible quand on drag rapidement la fenêtre
/// parent. La frontend met à jour cette map via `ensure_overlay_control` ;
/// le backend la consulte dans le handler `on_window_event` du parent.
#[derive(Clone, Copy)]
struct ControlAnchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn control_anchors() -> &'static Mutex<HashMap<String, ControlAnchor>> {
    static STORE: OnceLock<Mutex<HashMap<String, ControlAnchor>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store_control_anchor(control_label: &str, anchor: ControlAnchor) {
    if let Ok(mut map) = control_anchors().lock() {
        map.insert(control_label.to_string(), anchor);
    }
}

fn load_control_anchor(control_label: &str) -> Option<ControlAnchor> {
    control_anchors()
        .lock()
        .ok()
        .and_then(|map| map.get(control_label).copied())
}

fn clear_control_anchor(control_label: &str) {
    if let Ok(mut map) = control_anchors().lock() {
        map.remove(control_label);
    }
}

/// Re-positionne la control window de l'overlay (id, overlay_type)
/// si elle existe ET si elle a un anchor stocké. Appelée par le
/// `on_window_event` du parent overlay lors d'un Moved/Resized.
/// No-op silencieux si pas d'anchor (oeil pas encore initialisé) ou
/// si la control window est cachée.
///
/// Implem Windows : Win32 SetWindowPos en SYNCHRONE avec les flags
/// NOACTIVATE | NOSIZE | NOZORDER, qui bypass complètement l'IPC
/// async de Tauri. Sinon, à 60+ Hz pendant un drag, les set_position
/// Tauri saturent la queue d'events de la webview de l'oeil → React
/// ne peut plus traiter les clics → l'œil paraît grisé/désactivé.
/// SetWindowPos avec NOACTIVATE ne touche ni le focus ni le z-order.
/// Fallback Tauri set_position sur non-Windows.
fn resync_control_window(app_handle: &AppHandle, id: &str, overlay_type: &str) {
    let target_label = overlay_target_label(id, overlay_type);
    let control_label = overlay_control_label(id, overlay_type);
    let anchor = match load_control_anchor(&control_label) {
        Some(a) => a,
        None => return,
    };
    let target = match app_handle.get_webview_window(&target_label) {
        Some(t) => t,
        None => return,
    };
    let control = match app_handle.get_webview_window(&control_label) {
        Some(c) => c,
        None => return,
    };
    let (pos, _w, _h) = control_geometry(
        &target,
        Some(anchor.x),
        Some(anchor.y),
        Some(anchor.width),
        Some(anchor.height),
    );

    #[cfg(target_os = "windows")]
    unsafe {
        if let Ok(hwnd_raw) = control.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            // HWND_TOP + PAS de SWP_NOZORDER : bring l'œil au-dessus de la
            // pile topmost (le parent overlay, lui aussi always_on_top,
            // passe devant l'œil quand l'user le drag → l'œil paraît
            // grisé/désactivé). En le re-promouvant à chaque move, il
            // reste visible et cliquable. SWP_NOACTIVATE = pas de focus.
            let _ = SetWindowPos(
                h,
                HWND_TOP,
                pos.x,
                pos.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
            return;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = control.set_position(pos);
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayClosedPayload {
    id: String,
    overlay_type: String,
}

fn control_geometry(
    target: &tauri::WebviewWindow,
    anchor_x: Option<f64>,
    anchor_y: Option<f64>,
    anchor_width: Option<f64>,
    anchor_height: Option<f64>,
) -> (tauri::PhysicalPosition<i32>, i32, i32) {
    let base = target
        .outer_position()
        .unwrap_or(tauri::PhysicalPosition::new(40, 40));
    let size = target
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(600, 800));

    if let (Some(ax), Some(ay)) = (anchor_x, anchor_y) {
        let mut x = base.x + ax.round() as i32;
        let mut y = base.y + ay.round() as i32;
        let mut w = anchor_width
            .unwrap_or(CONTROL_WIDTH as f64)
            .round()
            .max(20.0) as i32;
        let mut h = anchor_height
            .unwrap_or(CONTROL_HEIGHT as f64)
            .round()
            .max(20.0) as i32;

        if x < 0 {
            x = 0;
        }
        if y < 0 {
            y = 0;
        }
        if w < 1 {
            w = CONTROL_WIDTH;
        }
        if h < 1 {
            h = CONTROL_HEIGHT;
        }

        return (tauri::PhysicalPosition::new(x, y), w, h);
    }

    // Fallback (hub lock, pas d'anchor): aligne sur le bouton game actuel (pill 20x20 CSS).
    // Layout drag bar : pr-1 + close(20) + gap-0.5 + hide(20) + gap-0.5 + game(20) depuis la droite.
    let scale = target.scale_factor().unwrap_or(1.0);
    let button_css = 20.0_f64;
    let right_offset_css = 4.0 + 20.0 + 2.0 + 20.0 + 2.0 + button_css; // = 68
    let top_css = 2.0_f64;

    let w = (button_css * scale).round().max(20.0) as i32;
    let h = (button_css * scale).round().max(20.0) as i32;
    let mut x = base.x + size.width as i32 - (right_offset_css * scale).round() as i32;
    let mut y = base.y + (top_css * scale).round() as i32;

    if x < 0 {
        x = 0;
    }
    if y < 0 {
        y = 0;
    }

    (tauri::PhysicalPosition::new(x, y), w, h)
}

fn overlay_hub_geometry(app_handle: &AppHandle, hub_width: f64) -> (f64, f64) {
    if let Some(main) = app_handle.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            // monitor position/size are physical pixels; inner_size/position on the
            // builder accept logical pixels. Convert to logical so scaled displays
            // (125%/150%) don't crop the hub content.
            let scale = monitor.scale_factor();
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            let logical_monitor_x = monitor_pos.x as f64 / scale;
            let logical_monitor_y = monitor_pos.y as f64 / scale;
            let logical_monitor_width = monitor_size.width as f64 / scale;
            let x = logical_monitor_x + ((logical_monitor_width - hub_width) / 2.0).max(0.0);
            let y = logical_monitor_y + OVERLAY_HUB_TOP_OFFSET;
            return (x, y.max(logical_monitor_y));
        }

        if let (Ok(main_pos), Ok(main_size)) = (main.outer_position(), main.outer_size()) {
            let scale = main.scale_factor().unwrap_or(1.0);
            let logical_main_x = main_pos.x as f64 / scale;
            let logical_main_y = main_pos.y as f64 / scale;
            let logical_main_width = main_size.width as f64 / scale;
            let x = logical_main_x + ((logical_main_width - hub_width) / 2.0).max(0.0);
            let y = logical_main_y + OVERLAY_HUB_TOP_OFFSET;
            return (x, y.max(0.0));
        }
    }

    (120.0, OVERLAY_HUB_TOP_OFFSET)
}

#[command]
pub async fn open_overlay_hub(app_handle: AppHandle) -> Result<(), String> {
    let label = OVERLAY_HUB_LABEL;
    let edit_mode = OVERLAY_HUB_EDIT_MODE.load(Ordering::Relaxed);

    if let Some(win) = app_handle.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_ignore_cursor_events(false);
        if win.set_focus().is_ok() {
            return Ok(());
        }

        let _ = win.close();
        sleep(Duration::from_millis(120)).await;
    }

    let (x, y) = overlay_hub_geometry(&app_handle, OVERLAY_HUB_WIDTH);
    let hub_url = "index.html#/overlay-hub";

    let mut last_err = None;
    let mut created_win = None;

    for _ in 0..2 {
        // visible(false) : créé caché pour pouvoir strip les styles Win32
        // AVANT que la window soit montrée → évite le flash de title bar
        // visible jusqu'à ce que l'user interagisse avec le hub.
        match WebviewWindowBuilder::new(&app_handle, label, WebviewUrl::App(hub_url.into()))
            .title("Overlay Hub")
            .inner_size(OVERLAY_HUB_WIDTH, OVERLAY_HUB_HEIGHT)
            .position(x, y)
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()
        {
            Ok(win) => {
                created_win = Some(win);
                break;
            }
            Err(e) => {
                last_err = Some(e.to_string());
                if let Some(stale) = app_handle.get_webview_window(label) {
                    let _ = stale.close();
                }
                sleep(Duration::from_millis(120)).await;
            }
        }
    }

    let win = created_win.ok_or_else(|| {
        last_err.unwrap_or_else(|| "Failed to create overlay hub window".to_string())
    })?;

    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_shadow(false);

    // Windows 11+ : DÉSACTIVER explicitement le round-corner DWM
    // (DWMWCP_DONOTROUND), sinon il se superpose au clipping SetWindowRgn
    // ci-dessous et on voit un cadre arrondi ~8 px DWM **derrière** la pill
    // exacte (mismatch visible). DONOTROUND laisse SetWindowRgn piloter
    // seul la forme de la fenêtre.
    //
    // ÉGALEMENT : strip Win32 WS_CAPTION/WS_BORDER/WS_DLGFRAME/WS_THICKFRAME
    // pour que la title bar Windows ne soit JAMAIS rendue, même si Windows
    // déclenche un repaint inattendu (focus change, IME, etc.). Sans ce
    // strip, le SetWindowRgn clip visuellement mais la title bar peut
    // flasher quand l'user clique sur le hub ou vient de l'ouvrir.
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
        };
        if let Ok(hwnd_raw) = win.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);

            // Strip title bar + bordures Win32
            let style = GetWindowLongW(h, GWL_STYLE);
            let stripped = style
                & !(WS_CAPTION.0 as i32)
                & !(WS_BORDER.0 as i32)
                & !(WS_DLGFRAME.0 as i32)
                & !(WS_THICKFRAME.0 as i32);
            let _ = SetWindowLongW(h, GWL_STYLE, stripped);

            // Désactive le round-corner DWM
            let pref = DWMWCP_DONOTROUND;
            let _ = DwmSetWindowAttribute(
                h,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const _ as *const _,
                std::mem::size_of_val(&pref) as u32,
            );

            // Force le repaint avec les nouveaux styles appliqués
            let _ = SetWindowPos(
                h,
                HWND_TOP,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    // SetWindowRgn : découpe la fenêtre Tauri en pill exacte qui matche
    // le `rounded-full` du hub à l'intérieur. Plus aucun bord rectangulaire
    // visible. Re-appliqué sur chaque event Resized car le ResizeObserver
    // côté frontend change la taille à chaque hover/collapse de catégorie.
    // Trade-off connu : les bords arrondis sont pixelisés (pas d'AA, c'est
    // l'API GDI historique). Si le crénelage devient gênant, alternative
    // = DWMWA_WINDOW_CORNER_PREFERENCE seul (bords lisses mais radius
    // limité à ~8 px Windows 11+).
    // On montre la fenêtre. Styles Win32 strippés et DWM round désactivés,
    // donc PAS de title bar / round corner visible.
    let _ = win.show();

    // SetWindowRgn DOIT être appliqué APRÈS show() car outer_size() retourne
    // 0×0 sur une fenêtre encore hidden → région nulle = fenêtre invisible.
    // On l'applique post-show pour avoir les vraies dimensions.
    #[cfg(target_os = "windows")]
    apply_hub_pill_region(&win);

    let app_for_hub = app_handle.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Resized(_)) {
            #[cfg(target_os = "windows")]
            if let Some(w) = app_for_hub.get_webview_window(OVERLAY_HUB_LABEL) {
                apply_hub_pill_region(&w);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = &app_for_hub;
        }
    });

    if edit_mode {
        let _ = win.set_focus();
    }
    Ok(())
}

/// Découpe la fenêtre du hub en pill arrondie via `SetWindowRgn`.
/// Doit être ré-appelé à chaque resize car la région est figée en pixels
/// physiques et ne suit pas le contenu.
#[cfg(target_os = "windows")]
fn apply_hub_pill_region(win: &tauri::WebviewWindow) {
    // SetWindowRgn et CreateRoundRectRgn vivent tous deux dans
    // Win32::Graphics::Gdi (et non Win32::UI::WindowsAndMessaging).
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    let Ok(size) = win.outer_size() else { return; };
    let Ok(hwnd_raw) = win.hwnd() else { return; };
    let width = size.width as i32;
    let height = size.height as i32;
    if width <= 0 || height <= 0 {
        return;
    }
    // Pour un vrai pill (rounded-full → radius = min(w,h)/2), CreateRoundRectRgn
    // prend la largeur ET la hauteur de l'ellipse du coin. On utilise
    // `min(width, height)` pour que la pill s'adapte automatiquement à
    // l'orientation : horizontal → pill horizontale (corner = height),
    // vertical → pill verticale (corner = width). Vital quand le hub
    // bascule en orientation verticale pour les presets left/right.
    let corner = width.min(height);
    unsafe {
        let h = HWND(hwnd_raw.0 as *mut _);
        // CreateRoundRectRgn utilise une convention [x1,x2[, [y1,y2[ comme
        // pour Rectangle GDI, d'où le `+1` sur les bornes droite/basse.
        let rgn = CreateRoundRectRgn(0, 0, width + 1, height + 1, corner, corner);
        if rgn.is_invalid() {
            return;
        }
        // SetWindowRgn prend ownership de HRGN, donc pas de DeleteObject.
        let _ = SetWindowRgn(h, rgn, true);
    }
}

#[command]
pub async fn toggle_overlay_hub(app_handle: AppHandle) -> Result<bool, String> {
    if let Some(win) = app_handle.get_webview_window(OVERLAY_HUB_LABEL) {
        if win.is_visible().unwrap_or(true) {
            let _ = win.close();
            return Ok(false);
        }
    }

    open_overlay_hub(app_handle).await?;
    Ok(true)
}

#[command]
pub async fn is_overlay_hub_open(app_handle: AppHandle) -> Result<bool, String> {
    if let Some(win) = app_handle.get_webview_window(OVERLAY_HUB_LABEL) {
        return Ok(win.is_visible().unwrap_or(true));
    }

    Ok(false)
}

#[command]
pub async fn set_overlay_hub_mode(app_handle: AppHandle, edit_mode: bool) -> Result<bool, String> {
    OVERLAY_HUB_EDIT_MODE.store(edit_mode, Ordering::Relaxed);

    cleanup_orphaned_control_windows(&app_handle);

    if let Some(win) = app_handle.get_webview_window(OVERLAY_HUB_LABEL) {
        win.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
        if edit_mode {
            let _ = win.set_focus();
        }
    }

    for (id, overlay_type) in open_overlay_targets(&app_handle) {
        let _ = set_overlay_interaction_internal(
            &app_handle,
            &id,
            &overlay_type,
            edit_mode,
            None,
            None,
            None,
            None,
            false,
        );
    }

    // Notify any open hub window so its React state syncs — without this,
    // toggling edit mode via the companion leaves the hub visually stale
    // until the user toggles it again locally.
    let _ = app_handle.emit("overlay_hub_mode_changed", edit_mode);

    Ok(edit_mode)
}

#[command]
pub fn get_overlay_hub_mode() -> bool {
    OVERLAY_HUB_EDIT_MODE.load(Ordering::Relaxed)
}

#[command]
pub fn is_overlay_open(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
) -> Result<bool, String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    let label = overlay_target_label(&id, &overlay_type);

    if let Some(win) = app_handle.get_webview_window(&label) {
        return Ok(win.is_visible().unwrap_or(true));
    }

    Ok(false)
}

#[command]
pub async fn open_overlay(
    app_handle: AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    opacity: f64,
    focused: Option<bool>,
) -> Result<(), String> {
    let label = overlay_target_label(&id, "iframe");
    let global_edit_mode = OVERLAY_HUB_EDIT_MODE.load(Ordering::Relaxed);

    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_shadow(false);
        let _ = win.show();
        let _ = win.unminimize();
        close_overlay_control_window(&app_handle, &id, "iframe");
        if global_edit_mode {
            if win.set_focus().is_ok() {
                return Ok(());
            }
        } else {
            let _ = set_overlay_interaction_internal(
                &app_handle,
                &id,
                "iframe",
                false,
                None,
                None,
                None,
                None,
                false,
            );
            return Ok(());
        }

        // Fenetre stale (fermee mais encore referencee): on force la fermeture puis recreation.
        let _ = win.close();
        sleep(Duration::from_millis(120)).await;
    }

    let opacity_clamped = (opacity * 100.0).clamp(10.0, 100.0) as u32;
    let overlay_url = format!(
        "index.html#/overlay-view?url={}&id={}&opacity={}",
        urlencoding::encode(&url),
        urlencoding::encode(&id),
        opacity_clamped
    );

    let mut last_err = None;
    let mut created_win = None;
    for _ in 0..2 {
        match WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App(overlay_url.clone().into()))
            .title(format!("Overlay - {}", id))
            .inner_size(width, height)
            .position(x, y)
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            // Notif (focused=false) : créée CACHÉE (.visible(false)) — on
            // posera WS_EX_NOACTIVATE puis on la montrera en SW_SHOWNOACTIVATE
            // (le show() d'activation de Tauri volerait le focus sinon).
            .visible(focused != Some(false))
            .focused(focused.unwrap_or(true))
            .build()
        {
            Ok(win) => {
                created_win = Some(win);
                break;
            }
            Err(e) => {
                last_err = Some(e.to_string());
                if let Some(stale) = app_handle.get_webview_window(&label) {
                    let _ = stale.close();
                }
                sleep(Duration::from_millis(120)).await;
            }
        }
    }

    let win = created_win.ok_or_else(|| {
        last_err.unwrap_or_else(|| "Failed to create overlay window".to_string())
    })?;

    // `focused(false)` seul est BUGGÉ sur Windows (tauri #11566 / #7519) et
    // WebView2 re-vole le focus au chargement de la page. Le SEUL mécanisme
    // fiable (= ce que fait le webview bar, qui « ne vole jamais le focus ») :
    // poser WS_EX_NOACTIVATE sur la window. Une window NOACTIVATE ne devient
    // jamais foreground, même quand le HWND enfant WebView2 prend le focus
    // clavier en interne. On l'applique pour les overlays type notification
    // (focused == Some(false)), pas pour le hub/sites ouverts manuellement.
    #[cfg(target_os = "windows")]
    if focused == Some(false) {
        let fg_before = foreground_title();
        let mut noactivate_ok = false;
        unsafe {
            if let Ok(hwnd_raw) = win.hwnd() {
                let h = HWND(hwnd_raw.0 as *mut _);
                let cur = GetWindowLongW(h, GWL_EXSTYLE);
                let _ = SetWindowLongW(h, GWL_EXSTYLE, cur | WS_EX_NOACTIVATE.0 as i32);
                noactivate_ok = (GetWindowLongW(h, GWL_EXSTYLE) & WS_EX_NOACTIVATE.0 as i32) != 0;
            }
        }
        // Montre la window (créée cachée) SANS l'activer.
        show_no_activate(&win);
        println!(
            "[cargo-focus] open '{}' : FG avant = {} | NOACTIVATE posé = {}",
            id, fg_before, noactivate_ok
        );
        // Échantillonne le foreground après coup pour voir SI/QUAND une fenêtre
        // vole le focus (overlay ? webview ? autre ?).
        tauri::async_runtime::spawn(async move {
            for ms in [50u64, 200, 500, 1000, 2000] {
                sleep(Duration::from_millis(ms)).await;
                println!("[cargo-focus]   +{}ms FG = {}", ms, foreground_title());
            }
        });
    }

    let app_handle_for_events = app_handle.clone();
    let id_for_events = id.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::Destroyed => {
            close_overlay_control_window(&app_handle_for_events, &id_for_events, "iframe");
            let control_label = overlay_control_label(&id_for_events, "iframe");
            clear_control_anchor(&control_label);
            let _ = app_handle_for_events.emit(
                "overlay_closed",
                OverlayClosedPayload {
                    id: id_for_events.clone(),
                    overlay_type: "iframe".to_string(),
                },
            );
        }
        // Sync œil sans IPC : à chaque déplacement/resize du parent, on
        // re-positionne la control window depuis l'anchor stocké
        // (sans aller-retour JS). Élimine le drift visible en drag.
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            resync_control_window(&app_handle_for_events, &id_for_events, "iframe");
        }
        _ => {}
    });

    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_shadow(false);
    close_overlay_control_window(&app_handle, &id, "iframe");
    if !global_edit_mode {
        let _ = set_overlay_interaction_internal(
            &app_handle,
            &id,
            "iframe",
            false,
            None,
            None,
            None,
            None,
            false,
        );
    }
    Ok(())
}

#[command]
pub async fn open_webview_overlay(
    app_handle: AppHandle,
    id: String,
    url: String,
    width: f64,
    height: f64,
    opacity: f64,
) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    let global_edit_mode = OVERLAY_HUB_EDIT_MODE.load(Ordering::Relaxed);

    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_shadow(false);
        let _ = win.show();
        let _ = win.unminimize();
        close_overlay_control_window(&app_handle, &id, "webview");
        if global_edit_mode {
            if win.set_focus().is_ok() {
                return Ok(());
            }
        } else {
            let _ = set_overlay_interaction_internal(
                &app_handle,
                &id,
                "webview",
                false,
                None,
                None,
                None,
                None,
                false,
            );
            return Ok(());
        }

        // Fenetre stale (fermee mais encore referencee): on force la fermeture puis recreation.
        let _ = win.close();
        sleep(Duration::from_millis(120)).await;
    }

    let parsed_url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let opacity_pct = ((opacity.clamp(0.1, 1.0)) * 100.0) as u32;
    let id_js = id.replace('\\', "\\\\").replace('\'', "\\'");

    // Init script injecté dans la webview parent. Son rôle est UNIQUEMENT
    // de forcer la transparence du site embarqué + appliquer l'opacité
    // initiale. La bar de contrôle vit dans une fenêtre Tauri séparée
    // (`OverlayWebviewBar.tsx`, route `/overlay-webview-bar`) qui flotte
    // 36 px au-dessus de cette webview. Donc PAS de bar HTML injectée ici
    // (l'ancien code la créait → doublon avec la mini-fenêtre React).
    let init_script = format!(
        r#"
        (function() {{
            if (document.getElementById('__wv_overlay_transparency')) return;

            function forceTransparentRoots() {{
                var roots = [
                    document.documentElement,
                    document.body,
                    document.getElementById('__next'),
                    document.getElementById('root'),
                    document.querySelector('main')
                ];
                roots.forEach(function(el) {{
                    if (!el) return;
                    el.style.setProperty('background', 'transparent', 'important');
                    el.style.setProperty('background-color', 'transparent', 'important');
                }});
            }}

            function clearFullscreenBackgrounds() {{
                if (!document.body) return;
                var vw = window.innerWidth || 0;
                var vh = window.innerHeight || 0;
                var nodes = document.body.querySelectorAll('div,section,main,article,aside');
                var scanned = 0;
                for (var i = 0; i < nodes.length; i++) {{
                    if (scanned > 200) break;
                    var el = nodes[i];
                    var cs = window.getComputedStyle(el);
                    if ((cs.position !== 'fixed' && cs.position !== 'absolute') || cs.display === 'none') {{
                        scanned++;
                        continue;
                    }}
                    var rect = el.getBoundingClientRect();
                    if (rect.width >= vw * 0.95 && rect.height >= vh * 0.95) {{
                        var hasBgColor = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
                        var hasBgImage = cs.backgroundImage && cs.backgroundImage !== 'none';
                        if (hasBgColor || hasBgImage) {{
                            el.style.setProperty('background', 'transparent', 'important');
                            el.style.setProperty('background-color', 'transparent', 'important');
                            el.style.setProperty('background-image', 'none', 'important');
                        }}
                    }}
                    scanned++;
                }}
            }}

            function enforceTransparency() {{
                forceTransparentRoots();
                clearFullscreenBackgrounds();
            }}

            function init() {{
                enforceTransparency();

                var transparentStyle = document.createElement('style');
                transparentStyle.id = '__wv_overlay_transparency';
                transparentStyle.textContent = `
                    html, body, #__next, #root, main {{
                        background: transparent !important;
                        background-color: transparent !important;
                    }}
                    html::before, html::after,
                    body::before, body::after,
                    #__next::before, #__next::after,
                    #root::before, #root::after {{
                        background: transparent !important;
                        background-image: none !important;
                    }}
                `;
                document.documentElement.appendChild(transparentStyle);

                if ('{overlay_id}' === 'protixit-reputation' || '{overlay_id}' === 'scdb-space') {{
                    var scrollbarStyle = document.createElement('style');
                    scrollbarStyle.id = '__wv_overlay_scrollbar_cleanup';
                    scrollbarStyle.textContent = `
                        html, body, * {{
                            scrollbar-width: none !important;
                            -ms-overflow-style: none !important;
                        }}
                        html::-webkit-scrollbar,
                        body::-webkit-scrollbar,
                        *::-webkit-scrollbar {{
                            width: 0 !important;
                            height: 0 !important;
                            display: none !important;
                            background: transparent !important;
                        }}
                    `;
                    document.documentElement.appendChild(scrollbarStyle);
                }}

                // NOTE: l'ancienne bar HTML inject\u00E9e ici a \u00E9t\u00E9 retir\u00E9e.
                // La bar de contr\u00F4le est maintenant rendue par une mini-fen\u00EAtre
                // Tauri React s\u00E9par\u00E9e (`OverlayWebviewBar.tsx`) qui flotte
                // 36 px au-dessus de cette webview \u2014 cf. `spawn_webview_bar`
                // dans ce m\u00EAme fichier. Ne PAS r\u00E9injecter de bar ici sous
                // peine de doublon visuel.

                document.body.style.opacity = {opacity_pct} / 100;

                setTimeout(enforceTransparency, 200);
                setTimeout(enforceTransparency, 1000);
                setInterval(enforceTransparency, 1500);
            }}

            if (document.body) init();
            else document.addEventListener('DOMContentLoaded', init);
        }})();
    "#,
        opacity_pct = opacity_pct,
        overlay_id = id_js
    );


    // Réserve 36 px en haut pour la bar React (`OverlayWebviewBar.tsx`) qui
    // viendra se coller au-dessus. La taille demandée par l'user (`height`)
    // = bar 36 + contenu (height-36), pour que la zone visuelle totale
    // corresponde à ce qui a été commandé.
    let webview_height = (height - WEBVIEW_BAR_HEIGHT).max(120.0);

    let mut last_err = None;
    let mut created_win = None;
    for _ in 0..2 {
        match WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::External(parsed_url.clone()))
            .title(format!("Overlay - {}", id))
            .inner_size(width, webview_height)
            .center()
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .initialization_script(&init_script)
            .build()
        {
            Ok(win) => {
                created_win = Some(win);
                break;
            }
            Err(e) => {
                last_err = Some(e.to_string());
                if let Some(stale) = app_handle.get_webview_window(&label) {
                    let _ = stale.close();
                }
                sleep(Duration::from_millis(120)).await;
            }
        }
    }

    let win = created_win.ok_or_else(|| {
        last_err.unwrap_or_else(|| "Failed to create webview overlay window".to_string())
    })?;

    // Après création, décale la webview de +36 px en Y. Comme `.center()`
    // calcule la position à partir de inner_size(width, webview_height), on
    // pousse manuellement la webview vers le bas pour libérer la bande où
    // la bar va se placer. Net visuel : ensemble [bar 36 + webview h-36]
    // centré verticalement à peu de chose près.
    if let Ok(pos) = win.outer_position() {
        let scale = win.scale_factor().unwrap_or(1.0);
        let new_y_logical = (pos.y as f64 / scale) + WEBVIEW_BAR_HEIGHT;
        let _ = win.set_position(tauri::LogicalPosition::new(
            pos.x as f64 / scale,
            new_y_logical,
        ));
    }

    let app_handle_for_events = app_handle.clone();
    let id_for_events = id.clone();
    win.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Destroyed => {
                close_overlay_control_window(&app_handle_for_events, &id_for_events, "webview");
                let control_label = overlay_control_label(&id_for_events, "webview");
                clear_control_anchor(&control_label);
                close_webview_bar(&app_handle_for_events, &id_for_events);
                let _ = app_handle_for_events.emit(
                    "overlay_closed",
                    OverlayClosedPayload {
                        id: id_for_events.clone(),
                        overlay_type: "webview".to_string(),
                    },
                );
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                let _ = reposition_webview_bar(&app_handle_for_events, &id_for_events);
                // Sync œil sans IPC : re-positionne l'oeil depuis
                // l'anchor stocké en mémoire (élimine le drift IPC).
                resync_control_window(&app_handle_for_events, &id_for_events, "webview");
            }
            _ => {}
        }
    });

    // Spawn la mini-bar React au-dessus de la webview, fire-and-forget.
    let _ = spawn_webview_bar(&app_handle, &id, &win);

    #[cfg(target_os = "windows")]
    {
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        let alpha = ((opacity.clamp(0.1, 1.0)) * 255.0) as u8;
        unsafe {
            let h = HWND(hwnd.0 as *mut _);
            let ex_style = GetWindowLongW(h, GWL_EXSTYLE);
            SetWindowLongW(h, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as i32);
            SetLayeredWindowAttributes(h, None, alpha, LWA_ALPHA).map_err(|e| e.to_string())?;
        }
    }

    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_shadow(false);
    close_overlay_control_window(&app_handle, &id, "webview");
    if !global_edit_mode {
        let _ = set_overlay_interaction_internal(
            &app_handle,
            &id,
            "webview",
            false,
            None,
            None,
            None,
            None,
            false,
        );
    }
    let _ = win;
    Ok(())
}

#[command]
pub async fn set_window_opacity(
    app_handle: AppHandle,
    label: String,
    opacity: f64,
) -> Result<(), String> {
    let win = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;

    #[cfg(target_os = "windows")]
    {
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        let alpha = ((opacity.clamp(0.1, 1.0)) * 255.0) as u8;
        unsafe {
            let h = HWND(hwnd.0 as *mut _);
            let ex_style = GetWindowLongW(h, GWL_EXSTYLE);
            SetWindowLongW(h, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as i32);
            SetLayeredWindowAttributes(h, None, alpha, LWA_ALPHA).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (win, opacity);

    Ok(())
}

fn set_overlay_interaction_internal(
    app_handle: &AppHandle,
    id: &str,
    overlay_type: &str,
    interactive: bool,
    anchor_x: Option<f64>,
    anchor_y: Option<f64>,
    anchor_width: Option<f64>,
    anchor_height: Option<f64>,
    focus_target: bool,
) -> Result<(), String> {
    let target_label = overlay_target_label(id, overlay_type);
    let control_label = overlay_control_label(id, overlay_type);

    let target = app_handle
        .get_webview_window(&target_label)
        .ok_or_else(|| format!("Window '{}' not found", target_label))?;

    if interactive {
        target
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
        if focus_target {
            let _ = target.set_focus();
        }
        if let Some(control) = app_handle.get_webview_window(&control_label) {
            let _ = control.hide();
        }
        return Ok(());
    }

    target
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;

    // Si on reçoit un anchor explicite, on le stocke pour que les
    // handlers Moved/Resized du parent puissent re-positionner l'œil
    // localement (sans IPC) lors d'un drag.
    if let (Some(ax), Some(ay), Some(aw), Some(ah)) =
        (anchor_x, anchor_y, anchor_width, anchor_height)
    {
        store_control_anchor(
            &control_label,
            ControlAnchor {
                x: ax,
                y: ay,
                width: aw,
                height: ah,
            },
        );
    }

    let (anchored_pos, control_width, control_height) = control_geometry(
        &target,
        anchor_x,
        anchor_y,
        anchor_width,
        anchor_height,
    );

    if let Some(control) = app_handle.get_webview_window(&control_label) {
        show_no_activate(&control);
        let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));
        let _ = control.set_position(anchored_pos);
        let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));
        if focus_target {
            let _ = control.set_focus();
        }
    } else {
        let control_url = format!(
            "index.html#/overlay-control?id={}&overlayType={}",
            urlencoding::encode(id),
            urlencoding::encode(overlay_type)
        );

        let control = WebviewWindowBuilder::new(
            app_handle,
            &control_label,
            WebviewUrl::App(control_url.into()),
        )
        .title("Overlay Control")
        .inner_size(control_width as f64, control_height as f64)
        .position(anchored_pos.x as f64, anchored_pos.y as f64)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // CRÉÉE CACHÉE + non-focused : sinon build()/show() ACTIVE la window
        // (la passe foreground = vol de focus) MALGRÉ WS_EX_NOACTIVATE, qui ne
        // bloque que l'activation au clic. On pose NOACTIVATE pendant qu'elle
        // est cachée, puis SW_SHOWNOACTIVATE.
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;

        let _ = control.set_shadow(false);
        let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));

        // Marque la window comme NON-ACTIVATABLE → tous les clics dessus
        // sont délivrés immédiatement comme mousedown sans phase
        // d'activation (Windows ne va pas "consommer" le premier clic
        // pour focuser la window). Sans ce flag, il faut 2 clics pour
        // déclencher le retour en mode édition.
        #[cfg(target_os = "windows")]
        unsafe {
            if let Ok(hwnd_raw) = control.hwnd() {
                let h = HWND(hwnd_raw.0 as *mut _);
                let cur = GetWindowLongW(h, GWL_EXSTYLE);
                let _ = SetWindowLongW(h, GWL_EXSTYLE, cur | WS_EX_NOACTIVATE.0 as i32);
            }
        }

        // Montre la control (créée cachée) SANS l'activer.
        show_no_activate(&control);

        if focus_target {
            let _ = control.set_focus();
        }
    }

    Ok(())
}

#[command]
pub async fn set_overlay_interaction(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
    interactive: bool,
    anchor_x: Option<f64>,
    anchor_y: Option<f64>,
    anchor_width: Option<f64>,
    anchor_height: Option<f64>,
) -> Result<(), String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    set_overlay_interaction_internal(
        &app_handle,
        &id,
        &overlay_type,
        interactive,
        anchor_x,
        anchor_y,
        anchor_width,
        anchor_height,
        true,
    )
}

#[command]
pub async fn close_overlay(app_handle: AppHandle, id: String) -> Result<(), String> {
    let label = overlay_target_label(&id, "iframe");
    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.close();
    }
    close_overlay_control_window(&app_handle, &id, "iframe");
    let _ = app_handle.emit(
        "overlay_closed",
        OverlayClosedPayload {
            id,
            overlay_type: "iframe".to_string(),
        },
    );
    Ok(())
}

#[command]
pub async fn close_webview_overlay(app_handle: AppHandle, id: String) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.close();
    }
    close_overlay_control_window(&app_handle, &id, "webview");
    let _ = app_handle.emit(
        "overlay_closed",
        OverlayClosedPayload {
            id,
            overlay_type: "webview".to_string(),
        },
    );
    Ok(())
}

/// Retourne la géométrie perçue d'un overlay webview (= bar + webview
/// combinés, en pixels logiques). Utilisé pour persister la position/taille
/// que l'user a définie manuellement. Retourne x = bar.x, y = bar.y (top de
/// la bar), width = webview.width, height = webview.height + 36 (bar incluse).
#[command]
pub async fn get_webview_overlay_perceived_geometry(
    app_handle: AppHandle,
    id: String,
) -> Result<(f64, f64, f64, f64), String> {
    let webview_label = overlay_target_label(&id, "webview");
    let webview = app_handle
        .get_webview_window(&webview_label)
        .ok_or_else(|| format!("Webview overlay '{}' not found", id))?;
    let pos = webview.outer_position().map_err(|e| e.to_string())?;
    let size = webview.outer_size().map_err(|e| e.to_string())?;
    let scale = webview.scale_factor().unwrap_or(1.0);
    let logical_x = pos.x as f64 / scale;
    let logical_y = (pos.y as f64 / scale) - WEBVIEW_BAR_HEIGHT;
    let logical_w = size.width as f64 / scale;
    let logical_h = (size.height as f64 / scale) + WEBVIEW_BAR_HEIGHT;
    Ok((logical_x, logical_y, logical_w, logical_h))
}

/// Re-positionne une fenêtre overlay (iframe ou webview) à la position
/// donnée. Utilisé pour restaurer la dernière position custom de l'user
/// après ouverture (cf. Discord thread #2 — dual screen disposition).
#[command]
pub async fn set_overlay_window_position(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    let label = overlay_target_label(&id, &overlay_type);
    if let Some(win) = app_handle.get_webview_window(&label) {
        win.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn set_overlay_size(
    app_handle: AppHandle,
    id: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = overlay_target_label(&id, "iframe");
    if let Some(win) = app_handle.get_webview_window(&label) {
        win.set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Webview overlay helpers (piloter une webview depuis sa bar React)
// ─────────────────────────────────────────────────────────────────────────
// La mini-bar React qui flotte au-dessus de chaque webview overlay (route
// `/overlay-webview-bar`) appelle ces commandes pour reload / opacity /
// hide / etc. — la bar elle-même n'a pas accès à la webview parent
// directement (deux windows distinctes), donc tout transite par le backend.

fn webview_overlay_bar_label(id: &str) -> String {
    format!("wvoverlay_bar_{}", id)
}

#[command]
pub fn webview_overlay_reload(app_handle: AppHandle, id: String) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    let win = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    // WebviewWindow expose `eval` directement (combine Window + Webview).
    win.eval("window.location.reload()")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn webview_overlay_set_opacity(
    app_handle: AppHandle,
    id: String,
    opacity: f64,
) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    let win = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let clamped = opacity.clamp(0.1, 1.0);
    #[cfg(target_os = "windows")]
    unsafe {
        let hwnd_raw = win.hwnd().map_err(|e| e.to_string())?;
        let h = HWND(hwnd_raw.0 as *mut _);
        let alpha = (clamped * 255.0) as u8;
        let _ = SetLayeredWindowAttributes(h, windows::Win32::Foundation::COLORREF(0), alpha, LWA_ALPHA);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = win;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct WebviewOverlayGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[command]
pub fn get_webview_overlay_geometry(
    app_handle: AppHandle,
    id: String,
) -> Result<WebviewOverlayGeometry, String> {
    let label = overlay_target_label(&id, "webview");
    let win = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().unwrap_or(1.0);
    // Retourne la zone que la BAR doit occuper (et NON celle de la webview).
    // La bar `OverlayWebviewBar.tsx` polle cette commande toutes les 100 ms
    // et applique directement le résultat via setPosition/setSize. La bar
    // est placée 36 px au-dessus de la webview pour ne pas masquer son
    // contenu (cf. `spawn_webview_bar` / `reposition_webview_bar`).
    Ok(WebviewOverlayGeometry {
        x: pos.x as f64 / scale,
        y: (pos.y as f64 / scale) - WEBVIEW_BAR_HEIGHT,
        width: size.width as f64 / scale,
        height: WEBVIEW_BAR_HEIGHT,
    })
}

#[command]
pub fn webview_overlay_set_hidden(
    app_handle: AppHandle,
    id: String,
    hidden: bool,
) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    let win = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    if hidden {
        win.hide().map_err(|e| e.to_string())?;
    } else {
        win.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Spawn la mini-bar React au-dessus d'une webview overlay. Suit la
/// position/taille de la webview parent via les events `onMoved`/`onResized`
/// configurés au call-site (open_webview_overlay).
fn spawn_webview_bar(
    app_handle: &AppHandle,
    id: &str,
    target_win: &tauri::WebviewWindow,
) -> Result<(), String> {
    let bar_label = webview_overlay_bar_label(id);
    if app_handle.get_webview_window(&bar_label).is_some() {
        return Ok(());
    }
    let pos = target_win
        .outer_position()
        .map_err(|e| e.to_string())?;
    let size = target_win.outer_size().map_err(|e| e.to_string())?;
    let scale = target_win.scale_factor().unwrap_or(1.0);
    let bar_width_logical = size.width as f64 / scale;
    let bar_height_logical = WEBVIEW_BAR_HEIGHT;
    // La bar se place 36 px AU-DESSUS de la webview parent (et non par-dessus
    // les 36 premiers pixels du contenu). `open_webview_overlay` a déjà
    // décalé la webview de +36 en Y au moment de sa création, donc
    // `webview.y - 36` retombe sur le bord supérieur de la zone réservée.
    let bar_x_logical = pos.x as f64 / scale;
    let bar_y_logical = (pos.y as f64 / scale) - WEBVIEW_BAR_HEIGHT;

    let url = format!(
        "index.html#/overlay-webview-bar?id={}",
        urlencoding::encode(id)
    );

    let bar = WebviewWindowBuilder::new(
        app_handle,
        &bar_label,
        WebviewUrl::App(url.into()),
    )
    .title(format!("Overlay Bar - {}", id))
    .inner_size(bar_width_logical, bar_height_logical)
    .position(bar_x_logical, bar_y_logical)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    unsafe {
        if let Ok(hwnd_raw) = bar.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            let cur = GetWindowLongW(h, GWL_EXSTYLE);
            let _ = SetWindowLongW(h, GWL_EXSTYLE, cur | WS_EX_NOACTIVATE.0 as i32);
        }
    }

    // Drag synchronisé bar → webview : quand l'utilisateur drag la bar (via
    // `data-tauri-drag-region` côté React), la window-bar reçoit `Moved`
    // pour chaque pas. On déplace la webview parent en miroir, 36 px en
    // dessous, pour que l'ensemble se comporte comme une vraie title bar.
    // La symétrique (webview drag → bar suit) est déjà gérée par les
    // events Moved/Resized configurés dans `open_webview_overlay`.
    // La garde anti-boucle est dans `sync_webview_to_bar_pos` : skip si la
    // webview est déjà à la bonne position (tolérance 2 px).
    let app_handle_for_drag = app_handle.clone();
    let id_for_drag = id.to_string();
    bar.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(new_pos) = event {
            sync_webview_to_bar_pos(&app_handle_for_drag, &id_for_drag, *new_pos);
        }
    });

    Ok(())
}

/// Helper appelé quand la bar bouge (drag user) : déplace la webview
/// parent pour qu'elle reste collée 36 px en dessous. Skip si la webview
/// est déjà à la bonne position (tolérance 2 px en physical pixels)
/// pour éviter la boucle infinie avec `reposition_webview_bar`.
fn sync_webview_to_bar_pos(
    app_handle: &AppHandle,
    id: &str,
    bar_pos: tauri::PhysicalPosition<i32>,
) {
    let target_label = overlay_target_label(id, "webview");
    let target = match app_handle.get_webview_window(&target_label) {
        Some(t) => t,
        None => return,
    };
    let scale = target.scale_factor().unwrap_or(1.0);
    let bar_height_phys = (WEBVIEW_BAR_HEIGHT * scale).round() as i32;
    let desired_x = bar_pos.x;
    let desired_y = bar_pos.y + bar_height_phys;
    if let Ok(cur) = target.outer_position() {
        if (cur.x - desired_x).abs() <= 2 && (cur.y - desired_y).abs() <= 2 {
            return;
        }
    }
    let _ = target.set_position(tauri::PhysicalPosition::new(desired_x, desired_y));
}

fn reposition_webview_bar(app_handle: &AppHandle, id: &str) -> Result<(), String> {
    let bar_label = webview_overlay_bar_label(id);
    let bar = app_handle
        .get_webview_window(&bar_label)
        .ok_or_else(|| "bar not found".to_string())?;
    let target_label = overlay_target_label(id, "webview");
    let target = app_handle
        .get_webview_window(&target_label)
        .ok_or_else(|| "target not found".to_string())?;
    let pos = target.outer_position().map_err(|e| e.to_string())?;
    let size = target.outer_size().map_err(|e| e.to_string())?;
    let scale = target.scale_factor().unwrap_or(1.0);
    // Cf. spawn_webview_bar : la bar est placée 36 px au-dessus du bord
    // supérieur de la webview pour ne pas chevaucher son contenu.
    let _ = bar.set_position(tauri::LogicalPosition::new(
        pos.x as f64 / scale,
        (pos.y as f64 / scale) - WEBVIEW_BAR_HEIGHT,
    ));
    let _ = bar.set_size(tauri::LogicalSize::new(
        size.width as f64 / scale,
        WEBVIEW_BAR_HEIGHT,
    ));
    Ok(())
}

fn close_webview_bar(app_handle: &AppHandle, id: &str) {
    let bar_label = webview_overlay_bar_label(id);
    if let Some(bar) = app_handle.get_webview_window(&bar_label) {
        let _ = bar.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Toggle overlay interactive (sans toucher à la control window)
// ─────────────────────────────────────────────────────────────────────────
// Variante allégée de set_overlay_interaction utilisée par OverlayControl
// (le bouton œil système permanent). Cette commande ne fait QUE basculer
// set_ignore_cursor_events sur l'overlay parent — elle NE déplace pas
// la control window et NE la cache pas. La control window reste là où
// `ensure_overlay_control` l'a placée au mount, et gère son propre state
// visuel (gris/cyan).

#[command]
pub fn toggle_overlay_interactive(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
    interactive: bool,
) -> Result<(), String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    let target_label = overlay_target_label(&id, &overlay_type);
    let target = app_handle
        .get_webview_window(&target_label)
        .ok_or_else(|| format!("Window '{}' not found", target_label))?;
    target
        .set_ignore_cursor_events(!interactive)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Cache la mini-fenêtre œil (control) d'un overlay, sans toucher à
/// l'interactivité ni au focus. Utilisé par l'overlay cargo qui n'affiche
/// PAS d'action bar (donc pas d'ancre pour l'œil) et gère ses propres
/// boutons pin/fermeture dans sa card.
#[command]
pub fn hide_overlay_control(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
) -> Result<(), String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    let control_label = overlay_control_label(&id, &overlay_type);
    if let Some(control) = app_handle.get_webview_window(&control_label) {
        let _ = control.hide();
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Ensure overlay control window
// ─────────────────────────────────────────────────────────────────────────
// Crée la mini control-window pile sur le placeholder du bouton œil de la
// bar — SANS modifier l'état interactive de l'overlay parent. Utilisé au
// mount d'OverlayView pour avoir un bouton œil "système" persistant qui
// gère lui-même son toggle (et bénéficie de WS_EX_NOACTIVATE → 1 clic
// même quand la window n'a pas le focus).

#[command]
pub async fn ensure_overlay_control(
    app_handle: AppHandle,
    id: String,
    overlay_type: Option<String>,
    anchor_x: f64,
    anchor_y: f64,
    anchor_width: f64,
    anchor_height: f64,
) -> Result<(), String> {
    let overlay_type = overlay_type.unwrap_or_else(|| "iframe".to_string());
    let target_label = overlay_target_label(&id, &overlay_type);
    let control_label = overlay_control_label(&id, &overlay_type);

    let target = app_handle
        .get_webview_window(&target_label)
        .ok_or_else(|| format!("Window '{}' not found", target_label))?;

    // Stocke l'anchor pour que les handlers Moved/Resized du parent
    // overlay puissent re-positionner l'œil sans aller-retour IPC
    // (responsable du "drift / wanders" visible en drag rapide).
    store_control_anchor(
        &control_label,
        ControlAnchor {
            x: anchor_x,
            y: anchor_y,
            width: anchor_width,
            height: anchor_height,
        },
    );

    let (anchored_pos, control_width, control_height) = control_geometry(
        &target,
        Some(anchor_x),
        Some(anchor_y),
        Some(anchor_width),
        Some(anchor_height),
    );

    if let Some(control) = app_handle.get_webview_window(&control_label) {
        show_no_activate(&control);
        let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));
        let _ = control.set_position(anchored_pos);
        return Ok(());
    }

    let control_url = format!(
        "index.html#/overlay-control?id={}&overlayType={}",
        urlencoding::encode(&id),
        urlencoding::encode(&overlay_type)
    );

    let control = WebviewWindowBuilder::new(
        &app_handle,
        &control_label,
        WebviewUrl::App(control_url.into()),
    )
    .title("Overlay Control")
    .inner_size(control_width as f64, control_height as f64)
    .position(anchored_pos.x as f64, anchored_pos.y as f64)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    // CRÉÉE CACHÉE + non-focused (cf. set_overlay_interaction_internal) :
    // sinon build()/show() vole le focus malgré WS_EX_NOACTIVATE.
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = control.set_shadow(false);
    let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));

    #[cfg(target_os = "windows")]
    unsafe {
        if let Ok(hwnd_raw) = control.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);
            let cur = GetWindowLongW(h, GWL_EXSTYLE);
            let _ = SetWindowLongW(h, GWL_EXSTYLE, cur | WS_EX_NOACTIVATE.0 as i32);
        }
    }

    show_no_activate(&control);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Release overlay focus
// ─────────────────────────────────────────────────────────────────────────
// L'utilisateur peut activer le « mode fantôme » sur une fenêtre overlay
// (icône œil) pour que le focus système (clavier, plein écran exclusif SC)
// revienne au jeu. Windows interdit normalement à une app de céder le
// focus arbitrairement, mais on peut le faire en deux temps :
//   1. Cherche la window « Star Citizen » via EnumWindows (titre exact)
//   2. Si trouvée → SetForegroundWindow(hwnd_sc)
//   3. Sinon fallback → SetForegroundWindow sur la main window StarTrad,
//      qui retire au moins le focus de l'overlay flottant.

#[cfg(target_os = "windows")]
struct EnumState {
    sc_hwnd: HWND,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_find_sc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut buf = [0u16; 256];
    let len = GetWindowTextW(hwnd, &mut buf);
    if len <= 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&buf[..len as usize]);
    // Le titre Star Citizen contient typiquement "Star Citizen" tout court.
    if title.contains("Star Citizen") {
        state.sc_hwnd = hwnd;
        return BOOL(0); // arrête l'énumération
    }
    BOOL(1)
}

/// DEBUG : titre + hwnd de la fenêtre actuellement au premier plan.
#[cfg(target_os = "windows")]
fn foreground_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    unsafe {
        let h = GetForegroundWindow();
        if h.0.is_null() {
            return "<null>".to_string();
        }
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(h, &mut buf);
        let title = if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            "<no-title>".to_string()
        };
        format!("\"{}\" (hwnd={:?})", title, h.0)
    }
}

/// Affiche une fenêtre SANS l'activer (SW_SHOWNOACTIVATE). `win.show()` de
/// Tauri = ShowWindow(SW_SHOW) qui ACTIVE la window (la passe foreground)
/// MÊME si elle a WS_EX_NOACTIVATE — car NOACTIVATE ne bloque que
/// l'activation au CLIC, pas le show() programmatique. SW_SHOWNOACTIVATE est
/// le seul moyen d'afficher une notif/overlay sans voler le focus du jeu.
#[cfg(target_os = "windows")]
fn show_no_activate(win: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    unsafe {
        if let Ok(hwnd_raw) = win.hwnd() {
            let _ = ShowWindow(HWND(hwnd_raw.0 as *mut _), SW_SHOWNOACTIVATE);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn show_no_activate(win: &tauri::WebviewWindow) {
    let _ = win.show();
}

/// Force le passage au premier plan d'une fenêtre cible — même si elle
/// appartient à un autre process (Star Citizen). Windows interdit
/// normalement à un process de céder le foreground arbitrairement :
/// `SetForegroundWindow` échoue alors silencieusement (simple flash de la
/// taskbar) ou bien le foreground « bouge » mais le focus CLAVIER reste
/// piégé sur le HWND enfant WebView2 de l'overlay. On contourne via
/// `AttachThreadInput` : on attache la file d'input de NOTRE thread à celle
/// du thread foreground courant ET à celle du thread de la cible, ce qui
/// autorise `SetForegroundWindow` / `SetActiveWindow` / `SetFocus` à
/// réellement transférer le focus clavier vers la cible. On détache ensuite
/// pour ne pas garder les files couplées (sinon inputs gelés).
#[cfg(target_os = "windows")]
fn force_foreground(target: HWND) {
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
    };
    unsafe {
        let fg = GetForegroundWindow();
        let my_thread = GetCurrentThreadId();
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let target_thread = GetWindowThreadProcessId(target, None);

        // N'attache que des threads distincts : AttachThreadInput sur
        // soi-même échoue, et un double-attache au même thread fausserait
        // le détache symétrique en fin de fonction.
        let attach_fg = fg_thread != 0 && fg_thread != my_thread;
        let attach_target =
            target_thread != 0 && target_thread != my_thread && target_thread != fg_thread;

        if attach_fg {
            let _ = AttachThreadInput(my_thread, fg_thread, BOOL(1));
        }
        if attach_target {
            let _ = AttachThreadInput(my_thread, target_thread, BOOL(1));
        }

        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        let _ = SetActiveWindow(target);
        let _ = SetFocus(target);

        if attach_target {
            let _ = AttachThreadInput(my_thread, target_thread, BOOL(0));
        }
        if attach_fg {
            let _ = AttachThreadInput(my_thread, fg_thread, BOOL(0));
        }
    }
}

/// Rend le focus système au jeu Star Citizen si sa fenêtre est trouvée,
/// sinon à la fenêtre principale StarTrad en dernier recours. Réutilisable
/// par n'importe quel overlay (cargo, hub, sites) — c'est le cœur du
/// « mode fantôme ».
#[cfg(target_os = "windows")]
pub fn return_focus_to_game<R: tauri::Runtime>(app: &AppHandle<R>) {
    let sc_hwnd = unsafe {
        let mut state = EnumState { sc_hwnd: HWND(std::ptr::null_mut()) };
        let _ = EnumWindows(
            Some(enum_find_sc),
            LPARAM(&mut state as *mut EnumState as isize),
        );
        state.sc_hwnd
    };
    println!(
        "[cargo-focus] return_focus_to_game : SC trouvé = {} | FG actuel = {}",
        !sc_hwnd.0.is_null(),
        foreground_title()
    );
    if !sc_hwnd.0.is_null() {
        force_foreground(sc_hwnd);
        return;
    }
    // Fallback : la main window StarTrad. Au moins l'overlay flottant perd
    // le focus exclusif, ce qui peut débloquer les inputs.
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(hwnd) = main.hwnd() {
            force_foreground(HWND(hwnd.0 as *mut _));
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn return_focus_to_game<R: tauri::Runtime>(_app: &AppHandle<R>) {}

/// Commande Tauri : rend le focus au jeu. Appelée par les overlays après
/// une interaction (clic pin/close/drag) ET juste après leur apparition.
#[command]
pub fn release_overlay_focus(app_handle: AppHandle) -> Result<(), String> {
    return_focus_to_game(&app_handle);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Mini-fenêtre Tauri dédiée pour le sélecteur de position du hub overlay
// (route /overlay-hub-preset-picker). Spawnée à la demande par le bouton
// Move dans la bar du hub. Window séparée (vs dropdown inline) parce que
// la fenêtre du hub a une pill SetWindowRgn qui ne supporte pas bien
// l'agrandissement dynamique pour un dropdown — visuellement cassé.
// ─────────────────────────────────────────────────────────────────────────

const HUB_PRESET_PICKER_LABEL: &str = "overlay_hub_preset_picker";
// Dimensions : outer p-2 (16 px) + inner p-2.5 (20 px) + header POSITION
// (~28 px avec mb-2) + grid panel p-1 (8 px) + 3 rows × 28 px (h-7) +
// 2 gaps × 4 px = ~172 px. On prend 180 pour la marge anti-coupure.
const HUB_PRESET_PICKER_WIDTH: f64 = 120.0;
const HUB_PRESET_PICKER_HEIGHT: f64 = 180.0;

#[command]
pub async fn toggle_hub_preset_picker(
    app_handle: AppHandle,
    anchor_x: i32,
    anchor_y: i32,
) -> Result<(), String> {
    // Si la fenêtre est déjà ouverte, on la ferme (toggle).
    if let Some(win) = app_handle.get_webview_window(HUB_PRESET_PICKER_LABEL) {
        let _ = win.close();
        return Ok(());
    }

    // anchor_x/y sont déjà en pixels PHYSIQUES écran (calculés côté JS via
    // hub.outerPosition() + button rect * dpr). On les utilise tels quels
    // via .position() qui interprète comme logical pixels par défaut → on
    // convertit en logical ici via la scale du moniteur principal.
    let scale = app_handle
        .get_webview_window("main")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let logical_x = (anchor_x as f64) / scale;
    let logical_y = (anchor_y as f64) / scale;

    let url = "index.html#/overlay-hub-preset-picker".to_string();

    // Créé invisible (`visible(false)`) pour éviter le flash de la barre
    // de titre Windows pendant le bref instant où la window est créée
    // avec décorations par défaut puis decorations(false) est appliqué.
    // On la montre après tout setup (set_shadow, etc.).
    // transparent(false) : la picker est un rectangle plein opaque. On a
    // essayé transparent(true) + SetWindowRgn pour matcher le hub, mais
    // ça donne un rendu Windows XP-style chelou sur les windows toplevel.
    // Avec transparent: false on a un petit flash de la window OS au
    // moment de show(), mais sinon c'est propre.
    let build_result = WebviewWindowBuilder::new(
        &app_handle,
        HUB_PRESET_PICKER_LABEL,
        WebviewUrl::App(url.into()),
    )
    .title("Hub Preset Picker")
    .inner_size(HUB_PRESET_PICKER_WIDTH, HUB_PRESET_PICKER_HEIGHT)
    .position(logical_x, logical_y)
    .decorations(false)
    .shadow(false)
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build();
    let win = build_result.map_err(|e| e.to_string())?;

    // Re-set explicitement les flags qui peuvent être ignorés au build.
    let _ = win.set_decorations(false);
    let _ = win.set_shadow(false);

    // Strip TOUT le chrome Windows (title bar + bordures + shadow DWM)
    // via Win32 : Tauri `decorations(false)` + `shadow(false)` ne
    // suffisent pas sur Windows 11 pour les windows transparent +
    // always_on_top. On retire manuellement les styles WS_CAPTION,
    // WS_BORDER, WS_DLGFRAME, WS_THICKFRAME, puis on désactive le
    // round-corner DWM (DWMWCP_DONOTROUND) ET la non-client area
    // rendering qui ajoute la shadow grise visible autour. Enfin on
    // ajoute WS_EX_NOACTIVATE pour ne pas voler le focus du hub.
    // SWP_FRAMECHANGED force le repaint immédiat pour appliquer
    // tous ces styles.
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        };
        if let Ok(hwnd_raw) = win.hwnd() {
            let h = HWND(hwnd_raw.0 as *mut _);

            // Strip title bar + bordures
            let style = GetWindowLongW(h, GWL_STYLE);
            let stripped = style
                & !(WS_CAPTION.0 as i32)
                & !(WS_BORDER.0 as i32)
                & !(WS_DLGFRAME.0 as i32)
                & !(WS_THICKFRAME.0 as i32);
            let _ = SetWindowLongW(h, GWL_STYLE, stripped);

            // Ajoute WS_EX_NOACTIVATE
            let ex_style = GetWindowLongW(h, GWL_EXSTYLE);
            let _ = SetWindowLongW(
                h,
                GWL_EXSTYLE,
                ex_style | WS_EX_NOACTIVATE.0 as i32,
            );

            // Coins arrondis Windows 11 natifs (~8 px). SetWindowRgn ne
            // marche pas avec transparent: false sur Windows 11 (la window
            // garde son rectangle plein), donc on s'appuie sur DWM.
            let pref = DWMWCP_ROUND;
            let _ = DwmSetWindowAttribute(
                h,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const _ as *const _,
                std::mem::size_of_val(&pref) as u32,
            );

            // Force le repaint pour appliquer les nouveaux styles
            // (sinon la title bar et la shadow restent visibles
            // jusqu'au prochain repaint déclenché).
            let _ = SetWindowPos(
                h,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    // Maintenant que tout est configuré (styles strippés + SetWindowRgn
    // appliqué), on affiche. Aucun flash de title bar ou rectangle.
    let _ = win.show();

    Ok(())
}

#[command]
pub async fn close_hub_preset_picker(app_handle: AppHandle) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window(HUB_PRESET_PICKER_LABEL) {
        let _ = win.close();
    }
    Ok(())
}


