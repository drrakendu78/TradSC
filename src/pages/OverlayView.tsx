import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OverlayActionBar } from "@/components/custom/overlay-action-bar";
import { saveOverlayGeometry } from "@/utils/overlay-geometry-store";

const OverlayView = () => {
    const [searchParams] = useSearchParams();
    const url = searchParams.get("url") || "";
    const id = searchParams.get("id") || "";
    const initialOpacity = parseInt(searchParams.get("opacity") || "90", 10) / 100;
    const [hidden, setHidden] = useState(false);
    const [opacity, setOpacity] = useState(initialOpacity);

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

    // Persistance position/taille (Discord thread #2 — pticopate, dual screen).
    // Sauve la géométrie de la fenêtre dans localStorage à chaque move/resize,
    // pour qu'à la prochaine ouverture du même overlay id, OverlayHub.tsx
    // restaure cette géométrie (au lieu de spawn aux dimensions par défaut).
    // Debounce 400 ms pour ne pas écrire en localStorage à chaque frame de drag.
    useEffect(() => {
        if (!id) return;
        const win = getCurrentWindow();
        let unlistenMoved: (() => void) | undefined;
        let unlistenResized: (() => void) | undefined;
        let saveTimer: number | null = null;

        const persist = async () => {
            try {
                const pos = await win.outerPosition();
                const size = await win.outerSize();
                const scale = (await win.scaleFactor().catch(() => 1)) || 1;
                saveOverlayGeometry(id, {
                    x: pos.x / scale,
                    y: pos.y / scale,
                    width: size.width / scale,
                    height: size.height / scale,
                });
            } catch {
                /* ignore */
            }
        };

        const schedulePersist = () => {
            if (saveTimer !== null) window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => {
                saveTimer = null;
                persist().catch(() => undefined);
            }, 400);
        };

        win.onMoved(() => schedulePersist())
            .then((fn) => { unlistenMoved = fn; })
            .catch(() => undefined);
        win.onResized(() => schedulePersist())
            .then((fn) => { unlistenResized = fn; })
            .catch(() => undefined);

        return () => {
            if (saveTimer !== null) window.clearTimeout(saveTimer);
            if (unlistenMoved) unlistenMoved();
            if (unlistenResized) unlistenResized();
        };
    }, [id]);

    // Pilotage de l'opacité depuis l'extérieur (slider companion). On reçoit un
    // event broadcast et on filtre sur l'id de l'overlay courant. set_window_opacity
    // n'est pas utilisable ici car la window est en transparent DWM — incompatible
    // avec un override LWA_ALPHA, qui fait disparaître le contenu WebView2.
    useEffect(() => {
        if (!id) return;
        let unlisten: (() => void) | undefined;
        listen<{ id: string; opacity: number }>("overlay_opacity_set", (event) => {
            const payload = event.payload;
            if (!payload || payload.id !== id) return;
            const next = Math.min(1, Math.max(0.1, Number(payload.opacity)));
            if (Number.isFinite(next)) setOpacity(next);
        }).then((fn) => { unlisten = fn; }).catch(console.error);
        return () => { if (unlisten) unlisten(); };
    }, [id]);

    const iframeRef = useRef<HTMLIFrameElement>(null);

    const handleClose = () => {
        invoke("close_overlay", { id }).catch(console.error);
    };

    const handleRefresh = () => {
        if (iframeRef.current) iframeRef.current.src = url;
    };

    // Bouton œil = control window externe (spawnée par Rust) qui se positionne
    // PILE sur le placeholder de la bar. Comme c'est une window indépendante
    // (pas child) elle ne suit pas auto-magiquement les déplacements de
    // l'overlay parent.
    //
    // Stratégie : on appelle `ensure_overlay_control` pour STOCKER l'anchor
    // côté Rust (et créer/positionner la window initialement). Ensuite, le
    // backend hook les events Moved/Resized du parent overlay et re-positionne
    // l'œil EN LOCAL (sans IPC) pour éliminer le drift visible en drag rapide.
    //
    // On re-call ensure_overlay_control uniquement quand le PLACEHOLDER change
    // de position relative dans le parent (rare : smart collapse / resize de
    // la bar). Pas besoin d'écouter onMoved/onResized du parent côté frontend.
    useEffect(() => {
        if (!id) return;
        const reanchor = () => {
            const placeholder = document.querySelector(
                "[data-click-through-anchor]",
            ) as HTMLElement | null;
            if (!placeholder) return;
            const rect = placeholder.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const dpr = window.devicePixelRatio || 1;
            invoke("ensure_overlay_control", {
                id,
                overlayType: "iframe",
                anchorX: Math.round(rect.left * dpr),
                anchorY: Math.round(rect.top * dpr),
                anchorWidth: Math.round(rect.width * dpr),
                anchorHeight: Math.round(rect.height * dpr),
            }).catch((e) => console.warn("[OverlayView] ensure_overlay_control:", e));
        };

        // Premier spawn au mount, avec un délai pour que le layout soit stable.
        const initial = window.setTimeout(reanchor, 50);

        // Observe la taille/position du placeholder : si la bar collapse
        // ou si un autre item bouge, on met à jour l'anchor stocké.
        const placeholder = document.querySelector(
            "[data-click-through-anchor]",
        ) as HTMLElement | null;
        let observer: ResizeObserver | undefined;
        if (placeholder) {
            observer = new ResizeObserver(() => reanchor());
            observer.observe(placeholder);
        }

        return () => {
            window.clearTimeout(initial);
            observer?.disconnect();
        };
    }, [id]);

    // Tool name dérivé de l'id (ex. "scmdb" → "SCMDB"). Faute de catégorie
    // exposée via searchParams, on garde le défaut "database" pour le dot.
    const toolName = id ? id.toUpperCase() : "Overlay";

    return (
        <div className="relative h-screen w-screen overflow-hidden rounded-xl bg-slate-950/15 ring-1 ring-white/10">
            <OverlayActionBar
                toolName={toolName}
                opacity={opacity}
                onOpacityChange={setOpacity}
                /* clickThroughAsAnchor : la bar rend un placeholder
                 * invisible 26×26 au lieu d'un bouton réel. La control
                 * window externe (spawn dans le useEffect) se positionne
                 * pile dessus et devient le vrai bouton œil. */
                isClickThrough={false}
                onClickThroughToggle={() => undefined}
                clickThroughAsAnchor
                isHidden={hidden}
                onHideToggle={setHidden}
                onRefresh={handleRefresh}
                onClose={handleClose}
            />

            {!hidden && (
                <iframe
                    ref={iframeRef}
                    src={url}
                    className="m-0 w-full border-0 p-0"
                    style={{
                        background: "transparent",
                        display: "block",
                        height: "calc(100% - 36px)",
                        opacity,
                    }}
                    title={`Overlay ${id}`}
                />
            )}
        </div>
    );
};

export default OverlayView;
