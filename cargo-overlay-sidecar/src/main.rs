// StarTrad — overlay cargo natif (Slint), sidecar focus-safe.
//
// Lancé par l'app Tauri (Phase 2). Reçoit un payload JSON sur stdin ; si lancé
// sans pipe (`cargo run`), affiche des données démo.
//
// Focus-safe : après show(), on retrouve la HWND par titre et on pose
// WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW → la fenêtre n'apparaît pas dans la
// taskbar/Alt-Tab et ne devient JAMAIS foreground (pas de vol de focus au jeu),
// contrairement à WebView2. (Pattern repris de record-slint.)
//
// Cache la console en release.
#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

slint::include_modules!();

use serde::Deserialize;
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

const WINDOW_TITLE: &str = "StarTrad Cargo Overlay";
const CONTROL_TITLE: &str = "StarTrad Cargo Overlay Control";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocPayload {
    rank: i32,
    terminal: String,
    price: String,
    #[serde(default)]
    eta: String,
    profit: String,
    percent: String,
    positive: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryPayload {
    commodity: String,
    #[serde(default)]
    guid: String,
    #[serde(default)]
    color_index: i32,
    #[serde(default)]
    sub: String,
    #[serde(default)]
    shop: String,
    #[serde(default)]
    locations: Vec<LocPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoldPayload {
    commodity: String,
    profit: String, // "+45 000 aUEC"
    #[serde(default)]
    positive: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    /// Manifeste : la/les marchandise(s) transportée(s).
    #[serde(default)]
    entries: Vec<EntryPayload>,
    /// Bandeau de vente (auto-vente détectée) ; null = pas de bandeau.
    #[serde(default)]
    sold: Option<SoldPayload>,
    #[serde(default)]
    pinned: bool,
    /// Auto-hide en ms (défaut 30 000 ; 0 = jamais).
    #[serde(default)]
    auto_hide_ms: Option<u64>,
    /// Coin de l'écran : "TR" (défaut), "TL", "BR", "BL".
    #[serde(default)]
    corner: Option<String>,
}

fn main() -> Result<(), slint::PlatformError> {
    // Backend winit configuré pour créer la fenêtre NON-ACTIVANTE
    // (with_active(false)). Sur Windows c'est supporté → l'overlay n'obtient
    // JAMAIS le focus à l'apparition, donc ne le vole pas au jeu. C'est LA
    // solution propre (vs rattraper le focus après coup). DOIT être appelé
    // avant la 1ère fenêtre.
    let backend = i_slint_backend_winit::Backend::builder()
        .with_window_attributes_hook(|attrs| attrs.with_active(false))
        .build()
        .expect("build winit backend");
    slint::platform::set_platform(Box::new(backend)).expect("set winit platform");

    let ui = CargoOverlay::new()?;
    let ctrl = CargoControl::new()?;

    // stdin : si pipé (lancé par Tauri), on lit ligne par ligne EN CONTINU —
    // chaque nouvelle ligne JSON = un nouvel achat → MAJ in-place (pas de
    // re-spawn). Sinon (`cargo run`) → démo, pas de thread.
    let (first, rx) = read_first_and_stream();
    apply_payload(&ui, &first);
    ctrl.set_pinned(first.pinned);
    position_overlay(&ui, &ctrl, first.corner.as_deref().unwrap_or("TR"));

    // États partagés (event loop thread → Rc OK).
    let pinned = Rc::new(Cell::new(first.pinned));
    let card_hidden = Rc::new(Cell::new(false));
    let editing = Rc::new(Cell::new(false));
    let last_update = Rc::new(Cell::new(Instant::now()));
    let hide_ms = first.auto_hide_ms.unwrap_or(30_000);

    ctrl.on_close(|| {
        // Signale à l'app de vider le manifeste (fin de tournée), puis quitte.
        use std::io::Write;
        let mut out = std::io::stdout();
        let _ = writeln!(out, "CLEAR");
        let _ = out.flush();
        let _ = slint::quit_event_loop();
    });
    ctrl.on_toggle_pin({
        let pinned = pinned.clone();
        let cw = ctrl.as_weak();
        let uw = ui.as_weak();
        move || {
            let p = !pinned.get();
            pinned.set(p);
            if let Some(c) = cw.upgrade() {
                c.set_pinned(p);
            }
            if let Some(u) = uw.upgrade() {
                u.set_pinned(p);
            }
        }
    });
    ctrl.on_toggle_hide({
        let card_hidden = card_hidden.clone();
        let cw = ctrl.as_weak();
        let uw = ui.as_weak();
        move || {
            let h = !card_hidden.get();
            card_hidden.set(h);
            if let Some(c) = cw.upgrade() {
                c.set_hidden(h);
            }
            if let Some(u) = uw.upgrade() {
                if h {
                    let _ = u.hide();
                } else {
                    let _ = u.show();
                    #[cfg(target_os = "windows")]
                    apply_window_styles(WINDOW_TITLE, true);
                }
            }
        }
    });

    // Mode édition : rend la card cliquable (toggle click-through Win32) + affiche
    // les cases "vendu". Le contrôle, lui, reste toujours cliquable (NOACTIVATE).
    ctrl.on_toggle_edit({
        let editing = editing.clone();
        let cw = ctrl.as_weak();
        let uw = ui.as_weak();
        move || {
            let e = !editing.get();
            editing.set(e);
            if let Some(c) = cw.upgrade() {
                c.set_editing(e);
            }
            if let Some(u) = uw.upgrade() {
                u.set_editing(e);
            }
            #[cfg(target_os = "windows")]
            set_card_click_through(!e); // édition → clic-traversant OFF (cliquable)
        }
    });

    // Case "vendu" cliquée → on signale l'app via stdout ("SOLD <guid>"). L'app
    // retire la marchandise du manifeste et renvoie le manifeste à jour sur stdin.
    ui.on_mark_sold(|guid| {
        use std::io::Write;
        let mut out = std::io::stdout();
        let _ = writeln!(out, "SOLD {guid}");
        let _ = out.flush();
    });

    ui.show()?;
    ctrl.show()?;

    #[cfg(target_os = "windows")]
    apply_all_window_styles();
    #[cfg(target_os = "windows")]
    let _style_timer = {
        let t = slint::Timer::default();
        t.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(150),
            apply_all_window_styles,
        );
        t
    };

    // Update IN-PLACE : draine les achats suivants reçus sur stdin, applique
    // sans re-spawn, ré-affiche la card si cachée, et reset l'auto-hide.
    let _update_timer = rx.map(|rx| {
        let uw = ui.as_weak();
        let cw = ctrl.as_weak();
        let card_hidden = card_hidden.clone();
        let last_update = last_update.clone();
        let editing = editing.clone();
        let t = slint::Timer::default();
        t.start(slint::TimerMode::Repeated, Duration::from_millis(150), move || {
            let mut got = false;
            while let Ok(p) = rx.try_recv() {
                got = true;
                if let (Some(u), Some(c)) = (uw.upgrade(), cw.upgrade()) {
                    apply_payload(&u, &p);
                    c.set_pinned(p.pinned);
                    c.set_hidden(false);
                    let _ = u.show();
                    // PAS de repositionnement sur update in-place : l'overlay ne
                    // doit pas sauter quand le contenu change. Le coin s'applique
                    // à la prochaine apparition (fresh spawn).
                }
                card_hidden.set(false);
            }
            if got {
                last_update.set(Instant::now());
                #[cfg(target_os = "windows")]
                {
                    apply_all_window_styles();
                    // En mode édition, garder la card cliquable malgré la MAJ.
                    if editing.get() {
                        set_card_click_through(false);
                    }
                }
            }
        });
        t
    });

    // Auto-hide : quitte après `hide_ms` d'INACTIVITÉ (sauf épinglé). Réarmé
    // implicitement via `last_update` (reset à chaque update in-place).
    let _auto_hide_timer = {
        let pinned = pinned.clone();
        let last_update = last_update.clone();
        let t = slint::Timer::default();
        if hide_ms > 0 {
            t.start(
                slint::TimerMode::Repeated,
                Duration::from_millis(500),
                move || {
                    if !pinned.get()
                        && last_update.get().elapsed().as_millis() as u64 >= hide_ms
                    {
                        let _ = slint::quit_event_loop();
                    }
                },
            );
        }
        t
    };

    slint::run_event_loop()?;
    Ok(())
}

fn apply_payload(ui: &CargoOverlay, p: &Payload) {
    let entries: Vec<ManiEntry> = p
        .entries
        .iter()
        .map(|e| {
            let locs: Vec<SellLoc> = e
                .locations
                .iter()
                .map(|l| SellLoc {
                    rank: l.rank,
                    terminal: l.terminal.clone().into(),
                    price: l.price.clone().into(),
                    eta: l.eta.clone().into(),
                    profit: l.profit.clone().into(),
                    percent: l.percent.clone().into(),
                    positive: l.positive,
                })
                .collect();
            ManiEntry {
                commodity: e.commodity.clone().into(),
                guid: e.guid.clone().into(),
                color_index: e.color_index,
                sub: e.sub.clone().into(),
                shop: e.shop.clone().into(),
                locations: Rc::new(slint::VecModel::from(locs)).into(),
            }
        })
        .collect();
    ui.set_entries(Rc::new(slint::VecModel::from(entries)).into());
    ui.set_pinned(p.pinned);

    // Bandeau de vente (auto-vente) : non-null → affiché ; sinon vidé (cache).
    match &p.sold {
        Some(s) => {
            ui.set_sold_commodity(s.commodity.clone().into());
            ui.set_sold_profit(s.profit.clone().into());
            ui.set_sold_positive(s.positive);
        }
        None => ui.set_sold_commodity(slint::SharedString::new()),
    }
    let banner_h: f32 = if p.sold.is_some() { 42.0 } else { 0.0 };

    // Hauteur adaptative : vide (dernier vendu) = compact ; 300 pour 1 marchandise
    // (vue riche) ; sinon la fenêtre grandit selon le nb de marchandises × leurs
    // reventes. + bandeau vente éventuel. Resize top-left fixe → grandit vers le bas.
    let h: f32 = if p.entries.is_empty() {
        66.0 + banner_h
    } else if p.entries.len() == 1 {
        300.0 + banner_h
    } else {
        let mut total = 66.0_f32 + banner_h; // header + paddings + bandeau
        for e in &p.entries {
            total += 22.0; // en-tête marchandise (1 ligne)
            total += (e.locations.len().min(3) as f32) * 21.0; // reventes (1 ligne)
            total += 10.0; // espacement section
        }
        total.clamp(300.0 + banner_h, 820.0)
    };
    ui.set_win_height(h);
}

/// Lit le 1er payload sur stdin, puis retourne un `Receiver` pour les suivants
/// (streaming ligne par ligne → update in-place). Si stdin n'est pas pipé
/// (`cargo run` à la main), retourne la démo sans thread.
fn read_first_and_stream() -> (Payload, Option<std::sync::mpsc::Receiver<Payload>>) {
    use std::io::IsTerminal;
    if std::io::stdin().is_terminal() {
        return (demo_payload(), None);
    }
    let (tx, rx) = std::sync::mpsc::channel::<Payload>();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(p) = serde_json::from_str::<Payload>(line) {
                if tx.send(p).is_err() {
                    break;
                }
            }
        }
    });
    // Attend le 1er payload (sinon démo après 2 s).
    let first = rx
        .recv_timeout(Duration::from_millis(2000))
        .unwrap_or_else(|_| demo_payload());
    (first, Some(rx))
}

fn position_overlay(ui: &CargoOverlay, ctrl: &CargoControl, corner: &str) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        let sw = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let sh = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        let ((cx, cy), (tx, ty)) = corner_positions(sw, sh, corner);
        ui.window().set_position(slint::PhysicalPosition::new(cx, cy));
        ctrl.window().set_position(slint::PhysicalPosition::new(tx, ty));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (ui, ctrl, corner);
    }
}

/// Positions (card, contrôle) selon le coin écran. La card a un inset transparent
/// de 6 px (ombre) → on raisonne sur la zone VISIBLE (328×288). Le contrôle se
/// pose AU-DESSUS (coins hauts) ou EN-DESSOUS (coins bas), aligné sur le bord
/// horizontal proche de la card — jamais en overlap (pas de souci z-order).
#[cfg(target_os = "windows")]
fn corner_positions(sw: i32, sh: i32, corner: &str) -> ((i32, i32), (i32, i32)) {
    let inset = 6;
    let vis_w = 340 - 2 * inset; // 328
    let vis_h = 300 - 2 * inset; // 288
    let ctrl_w = 108; // 4 boutons : pin / cacher / éditer / fermer
    let ctrl_h = 26;
    let gap = 4;
    let margin = 20;
    let taskbar = 56; // marge basse (barre des tâches)
    let c = corner.to_uppercase();
    let is_right = c.ends_with('R');
    let is_bottom = c.starts_with('B');

    let vis_left = if is_right { sw - margin - vis_w } else { margin };
    let vis_top = if is_bottom {
        sh - taskbar - vis_h
    } else {
        margin + ctrl_h + gap // laisse la place au contrôle au-dessus
    };

    let card = ((vis_left - inset).max(0), (vis_top - inset).max(0));
    let ctrl_x = if is_right { vis_left + vis_w - ctrl_w } else { vis_left };
    // Contrôle TOUJOURS au-dessus de la card (en bas, le mettre dessous
    // chevaucherait la barre des tâches).
    let ctrl_y = vis_top - ctrl_h - gap;
    (card, (ctrl_x.max(0), ctrl_y.max(0)))
}

/// Applique les ex-styles aux DEUX fenêtres : card (click-through) + contrôle (cliquable).
#[cfg(target_os = "windows")]
fn apply_all_window_styles() {
    apply_window_styles(WINDOW_TITLE, true);
    apply_window_styles(CONTROL_TITLE, false);
}

/// Pose les ex-styles Win32 sur la fenêtre `title`.
/// - `click_through = true`  → card : + TRANSPARENT | LAYERED (les clics traversent).
/// - `click_through = false` → contrôle : cliquable, et remonté topmost pour rester
///   AU-DESSUS de la card.
/// Dans les deux cas : NOACTIVATE (ne vole pas le focus) + TOOLWINDOW (pas de taskbar).
#[cfg(target_os = "windows")]
fn apply_window_styles(title: &str, click_through: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT,
    };
    if let Some(hwnd) = find_hwnd_by_title(title) {
        set_window_icon_startrad(hwnd);
        unsafe {
            let cur = GetWindowLongW(hwnd, GWL_EXSTYLE);
            let mut next = cur | WS_EX_NOACTIVATE.0 as i32 | WS_EX_TOOLWINDOW.0 as i32;
            if click_through {
                // TRANSPARENT | LAYERED ENSEMBLE = clic-traversant. C'est ce que
                // winit pose pour set_cursor_hittest(false) ; TRANSPARENT seul ne
                // suffit pas.
                next |= WS_EX_TRANSPARENT.0 as i32 | WS_EX_LAYERED.0 as i32;
            }
            let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, next);
            if !click_through {
                // Le contrôle doit rester au-dessus de la card.
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

/// Charge l'icône StarTrad embarquée dans le .exe (resource ID 1, cf. build.rs).
/// Chargée une seule fois puis mise en cache. Renvoie une HICON nulle si absente
/// (ex. icône non embarquée) → on ne fait rien dans ce cas (pas de crash).
#[cfg(target_os = "windows")]
fn startrad_hicon() -> windows::Win32::UI::WindowsAndMessaging::HICON {
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HINSTANCE;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{LoadIconW, HICON};
    static ICON: OnceLock<isize> = OnceLock::new();
    let raw = *ICON.get_or_init(|| unsafe {
        let Ok(hmod) = GetModuleHandleW(PCWSTR::null()) else {
            return 0;
        };
        // MAKEINTRESOURCE(1) = l'icône de resource ID 1.
        match LoadIconW(Some(HINSTANCE(hmod.0)), PCWSTR(1 as *const u16)) {
            Ok(ic) => ic.0 as isize,
            Err(_) => 0,
        }
    });
    HICON(raw as *mut core::ffi::c_void)
}

/// Pose l'icône StarTrad sur la fenêtre via WM_SETICON. winit enregistre la
/// classe avec hIcon=0 → sans ça, la barre des tâches montre un carré blanc
/// générique le temps que TOOLWINDOW retire la fenêtre. Là c'est l'icône StarTrad.
#[cfg(target_os = "windows")]
fn set_window_icon_startrad(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, ICON_BIG, ICON_SMALL, WM_SETICON};
    let hicon = startrad_hicon();
    if hicon.0.is_null() {
        return;
    }
    let lp = LPARAM(hicon.0 as isize);
    unsafe {
        let _ = SendMessageW(hwnd, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(lp));
        let _ = SendMessageW(hwnd, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(lp));
    }
}

/// Active/désactive le clic-traversant de la CARD (mode édition). `false` = la
/// card reçoit les clics (cases "vendu" cliquables) ; `true` = clic-traversant
/// (passif). Garde NOACTIVATE|TOOLWINDOW (jamais de vol de focus).
#[cfg(target_os = "windows")]
fn set_card_click_through(enable: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    if let Some(hwnd) = find_hwnd_by_title(WINDOW_TITLE) {
        unsafe {
            let cur = GetWindowLongW(hwnd, GWL_EXSTYLE);
            let next = if enable {
                cur | WS_EX_TRANSPARENT.0 as i32 | WS_EX_LAYERED.0 as i32
            } else {
                cur & !(WS_EX_TRANSPARENT.0 as i32) // vire TRANSPARENT → cliquable
            };
            let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

/// Retrouve la HWND par titre exact (EnumWindows). Repris de record-slint.
#[cfg(target_os = "windows")]
fn find_hwnd_by_title(target: &str) -> Option<windows::Win32::Foundation::HWND> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW,
    };
    struct Ctx<'a> {
        target: &'a str,
        result: HWND,
    }
    unsafe extern "system" fn proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len == 0 {
            return TRUE;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n == 0 {
            return TRUE;
        }
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        if title == ctx.target {
            ctx.result = hwnd;
            return BOOL(0);
        }
        TRUE
    }
    let mut ctx = Ctx {
        target,
        result: HWND(std::ptr::null_mut()),
    };
    unsafe {
        let _ = EnumWindows(Some(proc), LPARAM(&mut ctx as *mut _ as isize));
    }
    if ctx.result.0.is_null() {
        None
    } else {
        Some(ctx.result)
    }
}

fn demo_payload() -> Payload {
    Payload {
        pinned: false,
        auto_hide_ms: None,
        corner: None,
        sold: None,
        entries: vec![
            EntryPayload {
                commodity: "Nitrogen".into(),
                guid: "demo-nitrogen".into(),
                color_index: 1,
                sub: "200 SCU · 445 896 aUEC".into(),
                shop: "Acheté à Admin lt base g · 22.29 aUEC/cSCU".into(),
                locations: vec![
                    LocPayload { rank: 1, terminal: "MIC-L5".into(), price: "35.00 aUEC/cSCU".into(), eta: "~5 min".into(), profit: "+254 200".into(), percent: "57%".into(), positive: true },
                    LocPayload { rank: 2, terminal: "ARC-L1".into(), price: "35.00 aUEC/cSCU".into(), eta: "~9 min".into(), profit: "+254 200".into(), percent: "57%".into(), positive: true },
                    LocPayload { rank: 3, terminal: "HUR-L2".into(), price: "35.00 aUEC/cSCU".into(), eta: "~8 min".into(), profit: "+254 200".into(), percent: "57%".into(), positive: true },
                ],
            },
            EntryPayload {
                commodity: "Titanium".into(),
                guid: "demo-titanium".into(),
                color_index: 2,
                sub: "120 SCU · 198 000 aUEC".into(),
                shop: "Acheté à Admin lt base g · 16.50 aUEC/cSCU".into(),
                locations: vec![
                    LocPayload { rank: 1, terminal: "ARC-L1".into(), price: "22.00 aUEC/cSCU".into(), eta: "~9 min".into(), profit: "+66 000".into(), percent: "33%".into(), positive: true },
                ],
            },
        ],
    }
}
