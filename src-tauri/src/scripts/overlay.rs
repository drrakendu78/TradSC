use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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

const CONTROL_WIDTH: i32 = 36;
const CONTROL_HEIGHT: i32 = 20;
const CONTROL_RIGHT_OFFSET: i32 = 72;

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
            .max(24.0) as i32;
        let mut h = anchor_height
            .unwrap_or(CONTROL_HEIGHT as f64)
            .round()
            .max(18.0) as i32;

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

    // Fallback (iframe / anciennes valeurs): slot visuel du bouton Game
    let mut x = base.x + size.width as i32 - CONTROL_WIDTH - CONTROL_RIGHT_OFFSET;
    let mut y = base.y + 2;

    if x < 0 {
        x = 0;
    }
    if y < 0 {
        y = 0;
    }

    (
        tauri::PhysicalPosition::new(x, y),
        CONTROL_WIDTH,
        CONTROL_HEIGHT,
    )
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

    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_shadow(false);
        close_overlay_control_window(&app_handle, &id, "iframe");
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let opacity_clamped = (opacity * 100.0).clamp(10.0, 100.0) as u32;
    let overlay_url = format!(
        "index.html#/overlay-view?url={}&id={}&opacity={}",
        urlencoding::encode(&url),
        urlencoding::encode(&id),
        opacity_clamped
    );

    let win = WebviewWindowBuilder::new(
        &app_handle,
        &label,
        WebviewUrl::App(overlay_url.into()),
    )
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
    .map_err(|e| e.to_string())?;

    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_shadow(false);
    close_overlay_control_window(&app_handle, &id, "iframe");
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

    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_shadow(false);
        close_overlay_control_window(&app_handle, &id, "webview");
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
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

                var gameBtn = document.createElement('button');
                gameBtn.style.cssText = 'height:20px;padding:0 6px;border:1px solid rgba(148,197,255,0.28);border-radius:3px;background:linear-gradient(to bottom,rgba(28,52,72,0.96),rgba(18,34,49,0.96));box-shadow:inset 0 1px 0 rgba(148,197,255,0.15),0 1px 4px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(241,245,249,0.95);font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;transition:all .12s ease;';
                gameBtn.title = 'Focus jeu';
                gameBtn.textContent = 'Focus jeu';
                bar.appendChild(gameBtn);

                var hideBtn = document.createElement('button');
                hideBtn.style.cssText = 'height:20px;padding:0 6px;border:1px solid rgba(252,211,77,0.28);border-radius:3px;background:linear-gradient(to bottom,rgba(72,54,25,0.95),rgba(45,35,16,0.95));box-shadow:inset 0 1px 0 rgba(252,211,77,0.14),0 1px 4px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;color:rgba(255,251,235,0.95);font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;transition:all .12s ease;';
                hideBtn.title = 'Masquer';
                var hideIcon = document.createElement('span');
                hideIcon.textContent = '\uD83D\uDC41';
                var hideText = document.createElement('span');
                hideText.textContent = 'Hide';
                hideBtn.appendChild(hideIcon);
                hideBtn.appendChild(hideText);
                bar.appendChild(hideBtn);

                gameBtn.addEventListener('mouseenter', function() {{
                    gameBtn.style.background = 'linear-gradient(to bottom,rgba(34,61,84,0.96),rgba(21,40,58,0.96))';
                }});
                gameBtn.addEventListener('mouseleave', function() {{
                    gameBtn.style.background = 'linear-gradient(to bottom,rgba(28,52,72,0.96),rgba(18,34,49,0.96))';
                }});

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

                var hidden = false;

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
                    hideText.textContent = hidden ? 'Show' : 'Hide';
                }});

                gameBtn.addEventListener('mousedown', function(e) {{ e.stopPropagation(); }});
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

    let win = WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::External(parsed_url))
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
        .map_err(|e| e.to_string())?;

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
            SetLayeredWindowAttributes(h, None, alpha, LWA_ALPHA).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (win, opacity);

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
    let target_label = overlay_target_label(&id, &overlay_type);
    let control_label = overlay_control_label(&id, &overlay_type);

    let target = app_handle
        .get_webview_window(&target_label)
        .ok_or_else(|| format!("Window '{}' not found", target_label))?;

    if interactive {
        target
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
        let _ = target.set_focus();
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
        let _ = control.set_size(tauri::LogicalSize::new(
            control_width as f64,
            control_height as f64,
        ));
        let _ = control.set_position(anchored_pos);
        let _ = control.set_size(tauri::LogicalSize::new(
            control_width as f64,
            control_height as f64,
        ));
        let _ = control.set_focus();
    } else {
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
        .build()
        .map_err(|e| e.to_string())?;

        let _ = control.set_shadow(false);
        let _ = control.set_size(tauri::LogicalSize::new(
            control_width as f64,
            control_height as f64,
        ));
        let _ = control.set_focus();
    }

    Ok(())
}

#[command]
pub async fn close_overlay(app_handle: AppHandle, id: String) -> Result<(), String> {
    let label = overlay_target_label(&id, "iframe");
    if let Some(win) = app_handle.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    close_overlay_control_window(&app_handle, &id, "iframe");
    Ok(())
}

#[command]
pub async fn close_webview_overlay(app_handle: AppHandle, id: String) -> Result<(), String> {
    let label = overlay_target_label(&id, "webview");
    if let Some(win) = app_handle.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    close_overlay_control_window(&app_handle, &id, "webview");
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
