import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { OverlayActionBar } from "@/components/custom/overlay-action-bar";

interface WebviewGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Mini-window bar React qui flotte au-dessus d'une webview overlay (sites
// externes qui refusent l'iframe via X-Frame-Options, ex. AllSky, Protixit,
// SP Viewer, UEX). Le sync de position avec la webview parent est géré
// côté Rust (la fenêtre bar suit la webview à chaque move/resize).
//
// Cette page partage le composant <OverlayActionBar> avec OverlayView →
// même bar React partout, peu importe que l'overlay soit iframe ou webview.

const OverlayWebviewBar = () => {
    const [searchParams] = useSearchParams();
    const id = searchParams.get("id") || "";
    const [opacity, setOpacity] = useState(1);
    const [hidden, setHidden] = useState(false);
    const [isClickThrough, setIsClickThrough] = useState(false);

    // Window transparente pour que la bar ne masque pas la webview en dessous.
    useEffect(() => {
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        const root = document.getElementById("root");
        if (root) root.style.background = "transparent";
        const style = document.createElement("style");
        style.textContent = "#root::before { display: none !important; }";
        document.head.appendChild(style);
        return () => {
            document.documentElement.style.background = "";
            document.body.style.background = "";
            if (root) root.style.background = "";
            style.remove();
        };
    }, []);

    // Listen broadcast event pour syncer l'opacité depuis un autre canal
    // (companion mobile par exemple).
    useEffect(() => {
        if (!id) return;
        let unlisten: (() => void) | undefined;
        listen<{ id: string; opacity: number }>("overlay_opacity_set", (event) => {
            if (event.payload.id !== id) return;
            const next = Math.min(1, Math.max(0.1, Number(event.payload.opacity)));
            if (Number.isFinite(next)) setOpacity(next);
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(console.error);
        return () => {
            if (unlisten) unlisten();
        };
    }, [id]);

    // Poll la géométrie de la BAR (telle que dictée par le backend) toutes
    // les 100 ms pour suivre la webview parent. La commande Rust retourne
    // déjà la zone que la bar doit occuper (placée 36 px AU-DESSUS de la
    // webview, pas par-dessus son contenu) — on applique directement ses
    // valeurs via setPosition/setSize sans aucune correction côté JS.
    // Plus fiable que les events Tauri Moved/Resized qui peuvent être
    // manqués pendant un drag continu. Coût négligeable.
    useEffect(() => {
        if (!id) return;
        const win = getCurrentWindow();
        let cancelled = false;
        let lastX = NaN;
        let lastY = NaN;
        let lastW = NaN;
        let lastH = NaN;
        const tick = async () => {
            if (cancelled) return;
            try {
                const geo = await invoke<WebviewGeometry>("get_webview_overlay_geometry", {
                    id,
                });
                if (cancelled) return;
                if (
                    geo.x !== lastX ||
                    geo.y !== lastY ||
                    geo.width !== lastW ||
                    geo.height !== lastH
                ) {
                    lastX = geo.x;
                    lastY = geo.y;
                    lastW = geo.width;
                    lastH = geo.height;
                    await win
                        .setPosition(new LogicalPosition(Math.round(geo.x), Math.round(geo.y)))
                        .catch(() => undefined);
                    await win
                        .setSize(new LogicalSize(Math.round(geo.width), Math.round(geo.height)))
                        .catch(() => undefined);
                }
            } catch {
                // Webview parent fermée → cette bar va être fermée par le backend aussi.
            }
        };
        const interval = window.setInterval(tick, 100);
        tick();
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [id]);

    const handleClose = () => {
        invoke("close_webview_overlay", { id }).catch(console.error);
    };

    const handleRefresh = () => {
        invoke("webview_overlay_reload", { id }).catch(console.error);
    };

    const handleOpacityChange = (next: number) => {
        setOpacity(next);
        invoke("webview_overlay_set_opacity", { id, opacity: next }).catch(console.error);
    };

    const handleHideToggle = (next: boolean) => {
        setHidden(next);
        invoke("webview_overlay_set_hidden", { id, hidden: next }).catch(console.error);
    };

    const handleClickThroughToggle = (next: boolean) => {
        setIsClickThrough(next);
        if (!next) {
            invoke("set_overlay_interaction", {
                id,
                overlayType: "webview",
                interactive: true,
            }).catch(console.error);
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const btn = document.querySelector(
            '[aria-label="Basculer le mode fantôme"]',
        ) as HTMLElement | null;
        const rect = btn?.getBoundingClientRect();
        invoke("set_overlay_interaction", {
            id,
            overlayType: "webview",
            interactive: false,
            anchorX: rect ? Math.round(rect.left * dpr) : undefined,
            anchorY: rect ? Math.round(rect.top * dpr) : undefined,
            anchorWidth: rect ? Math.round(rect.width * dpr) : undefined,
            anchorHeight: rect ? Math.round(rect.height * dpr) : undefined,
        }).catch(console.error);
    };

    const toolName = id ? id.toUpperCase() : "Webview";

    return (
        <div className="h-screen w-screen">
            <OverlayActionBar
                toolName={toolName}
                opacity={opacity}
                onOpacityChange={handleOpacityChange}
                isClickThrough={isClickThrough}
                onClickThroughToggle={handleClickThroughToggle}
                isHidden={hidden}
                onHideToggle={handleHideToggle}
                onRefresh={handleRefresh}
                onClose={handleClose}
            />
        </div>
    );
};

export default OverlayWebviewBar;
