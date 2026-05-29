import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri-helpers";

const CARGO_OVERLAY_WIDTH = 420;
const CARGO_OVERLAY_HEIGHT = 360;

// Phase 2 : l'overlay cargo est désormais un sidecar NATIF Slint lancé côté
// Rust (cf. `cargo_overlay::spawn_overlay_sidecar`, déclenché par le watcher).
// On n'ouvre donc plus l'overlay WebView2 ici (sinon double overlay). Repasser
// à `false` pour réactiver l'ancien chemin WebView2.
const USE_NATIVE_SIDECAR = true;

/**
 * Ouvre l'overlay cargo via le système overlay standard (`open_overlay`,
 * route interne `#/overlay-cargo-buy`) — exactement le même path que le hub
 * utilise pour Blueprints / PvP. L'overlay hérite donc de toute la gestion
 * focus du système (contenu click-through par défaut + bar `WS_EX_NOACTIVATE`),
 * qui NE vole pas le focus du jeu. Plus de fenêtre bespoke `cargo_overlay.rs`.
 */
export async function openCargoBuyOverlay(): Promise<void> {
    const overlayUrl = `${window.location.origin}${window.location.pathname}#/overlay-cargo-buy`;
    // Bas-droite de l'écran principal (best-effort).
    const x = Math.max(20, window.screen.availWidth - CARGO_OVERLAY_WIDTH - 30);
    const y = Math.max(20, window.screen.availHeight - CARGO_OVERLAY_HEIGHT - 70);
    await invoke("open_overlay", {
        id: "cargo-buy",
        url: overlayUrl,
        x,
        y,
        width: CARGO_OVERLAY_WIDTH,
        height: CARGO_OVERLAY_HEIGHT,
        opacity: 1.0,
        focused: false, // notification overlay : ne vole PAS le focus du jeu
    });
    // Pas d'action bar : on (re)positionne le contrôle générique en mini-bar
    // [pin][fermer] au coin haut-droite de la card. WS_EX_NOACTIVATE → seul
    // élément cliquable sans voler le focus (la card reste click-through).
    // L'anchor est RELATIF au coin haut-gauche de la fenêtre overlay, en
    // pixels physiques (cf. control_geometry : pos = base + anchor).
    const dpr = window.devicePixelRatio || 1;
    const CTRL_W = 58;
    const CTRL_H = 26;
    const MARGIN = 8;
    await invoke("ensure_overlay_control", {
        id: "cargo-buy",
        overlayType: "iframe",
        anchorX: Math.round((CARGO_OVERLAY_WIDTH - CTRL_W - MARGIN) * dpr),
        anchorY: Math.round(MARGIN * dpr),
        anchorWidth: Math.round(CTRL_W * dpr),
        anchorHeight: Math.round(CTRL_H * dpr),
    }).catch(() => undefined);

    // Plus de retries release_overlay_focus : la prévention (window créée
    // cachée + WS_EX_NOACTIVATE + SW_SHOWNOACTIVATE côté Rust) suffit, et les
    // retries volaient le focus vers la main window StarTrad quand SC n'est
    // pas trouvé (bounce visible dans les logs).
}

/**
 * À monter dans la fenêtre principale : à chaque achat cargo détecté par le
 * watcher Game.log (event `gamelog-watcher:cargo-buy`), ouvre l'overlay cargo
 * via `open_overlay`. La fenêtre overlay, une fois ouverte, met à jour son
 * contenu sur les achats suivants en écoutant le même event.
 */
export function useCargoBuyOverlayLauncher(enabled: boolean) {
    useEffect(() => {
        if (!enabled || !isTauri()) return;
        let unlisten: UnlistenFn | undefined;
        listen("gamelog-watcher:cargo-buy", () => {
            // Overlay natif (sidecar Slint) géré côté Rust → ne pas ouvrir le
            // WebView2 ici (évite le doublon).
            if (USE_NATIVE_SIDECAR) return;
            openCargoBuyOverlay().catch((err) =>
                console.warn("[cargo-overlay] open_overlay failed:", err),
            );
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch((err) => console.warn("[cargo-overlay] listen failed:", err));
        return () => {
            if (unlisten) unlisten();
        };
    }, [enabled]);
}
