use tauri::{command, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::{sleep, Duration};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
    WS_EX_LAYERED,
};

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
    if edit_mode {
        let _ = win.set_focus();
    }
    Ok(())
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

    let app_handle_for_events = app_handle.clone();
    let id_for_events = id.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_overlay_control_window(&app_handle_for_events, &id_for_events, "iframe");
            let _ = app_handle_for_events.emit(
                "overlay_closed",
                OverlayClosedPayload {
                    id: id_for_events.clone(),
                    overlay_type: "iframe".to_string(),
                },
            );
        }
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

    let init_script = format!(
        r#"
        (function() {{
            if (document.getElementById('__wv_overlay_bar')) return;

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

                var bar = document.createElement('div');
                bar.id = '__wv_overlay_bar';
                bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:24px;z-index:999999;display:flex;align-items:center;gap:4px;padding:0 6px;background:linear-gradient(to bottom,rgba(0,0,0,0.5),transparent);cursor:move;user-select:none;';

                var grip = document.createElement('span');
                grip.style.cssText = 'color:rgba(255,255,255,0.5);font-size:10px;pointer-events:none;';
                grip.textContent = '\u22EE\u22EE';
                bar.appendChild(grip);

                var slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '10';
                slider.max = '100';
                slider.value = '{opacity_pct}';
                slider.style.cssText = 'width:64px;height:4px;cursor:pointer;accent-color:rgba(255,255,255,0.7);margin-right:auto;';
                slider.title = 'Opacite';
                bar.appendChild(slider);

                var lockIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:10px !important;height:10px !important;min-width:10px !important;max-width:10px !important;min-height:10px !important;max-height:10px !important;display:block !important;flex:0 0 auto !important;transform:none !important;transition:none !important;animation:none !important;max-inline-size:none !important;"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M9 11V8a3.5 3.5 0 0 1 6-1.8"></path></svg>';
                var eyeIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:11px !important;height:11px !important;min-width:11px !important;max-width:11px !important;min-height:11px !important;max-height:11px !important;display:block !important;flex:0 0 auto !important;transform:none !important;transition:none !important;animation:none !important;max-inline-size:none !important;"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7"></path><circle cx="12" cy="12" r="3"></circle></svg>';
                var eyeOffIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:11px !important;height:11px !important;min-width:11px !important;max-width:11px !important;min-height:11px !important;max-height:11px !important;display:block !important;flex:0 0 auto !important;transform:none !important;transition:none !important;animation:none !important;max-inline-size:none !important;"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7"></path><circle cx="12" cy="12" r="3"></circle><line x1="3" y1="3" x2="21" y2="21"></line></svg>';
                var hidden = false;

                var gameBtn = document.createElement('button');
                gameBtn.style.cssText = 'box-sizing:border-box;width:20px;height:20px;min-width:20px;max-width:20px;min-height:20px;max-height:20px;flex:0 0 20px;padding:0;margin:0;line-height:1;font-size:0;border:1px solid rgba(148,197,255,0.28);border-radius:3px;background:linear-gradient(to bottom,rgba(28,52,72,0.96),rgba(18,34,49,0.96));box-shadow:inset 0 1px 0 rgba(148,197,255,0.15),0 1px 4px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(241,245,249,0.95);appearance:none;-webkit-appearance:none;outline:none;transform:none;transition:none;animation:none;overflow:hidden;';
                gameBtn.title = 'Mode edit actif - clic pour mode jeu';
                gameBtn.innerHTML = lockIconSvg;
                bar.appendChild(gameBtn);

                var hideBtn = document.createElement('button');
                hideBtn.style.cssText = 'box-sizing:border-box;width:20px;height:20px;min-width:20px;max-width:20px;min-height:20px;max-height:20px;flex:0 0 20px;padding:0;margin:0;line-height:1;font-size:0;border:1px solid rgba(252,211,77,0.28);border-radius:3px;background:linear-gradient(to bottom,rgba(72,54,25,0.95),rgba(45,35,16,0.95));box-shadow:inset 0 1px 0 rgba(252,211,77,0.14),0 1px 4px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,251,235,0.95);appearance:none;-webkit-appearance:none;outline:none;transform:none;animation:none;';
                bar.appendChild(hideBtn);

                function renderHideButton() {{
                    hideBtn.innerHTML = hidden ? eyeIconSvg : eyeOffIconSvg;
                    hideBtn.title = hidden ? 'Afficher' : 'Masquer';
                }}
                renderHideButton();

                hideBtn.addEventListener('mouseenter', function() {{
                    hideBtn.style.background = 'linear-gradient(to bottom,rgba(82,61,29,0.95),rgba(54,42,20,0.95))';
                }});
                hideBtn.addEventListener('mouseleave', function() {{
                    hideBtn.style.background = 'linear-gradient(to bottom,rgba(72,54,25,0.95),rgba(45,35,16,0.95))';
                }});

                var closeBtn = document.createElement('button');
                closeBtn.style.cssText = 'width:20px;height:20px;border:none;border-radius:3px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);font-size:12px;';
                closeBtn.title = 'Fermer';
                closeBtn.textContent = '\u2715';
                bar.appendChild(closeBtn);

                document.documentElement.appendChild(bar);

                bar.addEventListener('mousedown', function(e) {{
                    e.preventDefault();
                    if (window.__TAURI_INTERNALS__) {{
                        window.__TAURI_INTERNALS__.invoke('plugin:window|start_dragging');
                    }}
                }});

                slider.addEventListener('mousedown', function(e) {{ e.stopPropagation(); }});
                slider.addEventListener('input', function() {{
                    document.body.style.opacity = this.value / 100;
                }});

                hideBtn.addEventListener('mousedown', function(e) {{ e.stopPropagation(); }});
                hideBtn.addEventListener('click', function() {{
                    hidden = !hidden;
                    document.body.style.visibility = hidden ? 'hidden' : 'visible';
                    renderHideButton();
                }});

                gameBtn.addEventListener('pointerdown', function(e) {{ e.preventDefault(); e.stopPropagation(); }});
                gameBtn.addEventListener('mousedown', function(e) {{ e.preventDefault(); e.stopPropagation(); }});
                gameBtn.addEventListener('click', function() {{
                    if (window.__TAURI_INTERNALS__) {{
                        var rect = gameBtn.getBoundingClientRect();
                        var dpr = window.devicePixelRatio || 1;
                        window.__TAURI_INTERNALS__.invoke('set_overlay_interaction', {{
                            id: '{overlay_id}',
                            overlayType: 'webview',
                            interactive: false,
                            anchorX: Math.round(rect.left * dpr),
                            anchorY: Math.round(rect.top * dpr),
                            anchorWidth: Math.round(rect.width * dpr),
                            anchorHeight: Math.round(rect.height * dpr)
                        }});
                    }}
                }});

                closeBtn.addEventListener('mousedown', function(e) {{ e.stopPropagation(); }});
                closeBtn.addEventListener('click', function() {{
                    if (window.__TAURI_INTERNALS__) {{
                        window.__TAURI_INTERNALS__.invoke('close_webview_overlay', {{
                            id: '{overlay_id}'
                        }});
                    }}
                }});

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

    let mut last_err = None;
    let mut created_win = None;
    for _ in 0..2 {
        match WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::External(parsed_url.clone()))
            .title(format!("Overlay - {}", id))
            .inner_size(width, height)
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

    let app_handle_for_events = app_handle.clone();
    let id_for_events = id.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_overlay_control_window(&app_handle_for_events, &id_for_events, "webview");
            let _ = app_handle_for_events.emit(
                "overlay_closed",
                OverlayClosedPayload {
                    id: id_for_events.clone(),
                    overlay_type: "webview".to_string(),
                },
            );
        }
    });

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

    let (anchored_pos, control_width, control_height) = control_geometry(
        &target,
        anchor_x,
        anchor_y,
        anchor_width,
        anchor_height,
    );

    if let Some(control) = app_handle.get_webview_window(&control_label) {
        let _ = control.show();
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
        .build()
        .map_err(|e| e.to_string())?;

        let _ = control.set_shadow(false);
        let _ = control.set_size(tauri::PhysicalSize::new(control_width, control_height));
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
