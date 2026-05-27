import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Bouton "œil" système : c'est une window Tauri dédiée (WS_EX_NOACTIVATE)
// positionnée pile sur le placeholder du bouton click-through de la
// <OverlayActionBar>. Elle gère son propre state (interactive = gris /
// non-interactive = cyan) et invoke set_overlay_interaction au clic.
//
// Avantage vs le bouton dans la bar : WS_EX_NOACTIVATE => les clics sont
// délivrés immédiatement même si le parent overlay n'a pas le focus,
// donc plus de double-clic. Et un seul œil visible à tout moment.

const OverlayControl = () => {
    const [searchParams] = useSearchParams();
    const id = searchParams.get("id") || "";
    const overlayType = searchParams.get("overlayType") || "iframe";
    // État initial : interactive = true → overlay focusable, œil gris.
    const [interactive, setInteractive] = useState(true);
    const [loading, setLoading] = useState(false);

    const toggle = async () => {
        if (!id || loading) return;
        const next = !interactive;
        setLoading(true);
        try {
            // toggle_overlay_interactive : commande légère qui ne fait QUE
            // basculer set_ignore_cursor_events sur le parent — elle ne
            // déplace pas et ne hide pas la control window (contrairement
            // à set_overlay_interaction qui se croit responsable de la
            // control window aussi).
            await invoke("toggle_overlay_interactive", {
                id,
                overlayType,
                interactive: next,
            });
            setInteractive(next);
        } catch (error) {
            console.error("[OverlayControl] toggle failed:", error);
        } finally {
            setLoading(false);
        }
    };

    // Handlers en cascade pour fire au 1er clic même si WebView2 hésite.
    const trigger = () => {
        void toggle();
    };

    const isGhost = !interactive; // cyan quand l'overlay est en mode fantôme

    return (
        <div
            onPointerDown={trigger}
            onMouseDown={trigger}
            onClick={trigger}
            tabIndex={-1}
            role="button"
            aria-label={isGhost ? "Désactiver le mode fantôme" : "Activer le mode fantôme"}
            title={
                isGhost
                    ? "Mode fantôme actif — cliquer pour reprendre la main"
                    : "Cliquer pour passer en mode fantôme (focus jeu)"
            }
            className={`flex h-screen w-screen items-center justify-center rounded-md transition-colors ${
                loading ? "pointer-events-none opacity-70" : "cursor-pointer"
            } ${
                isGhost
                    ? "bg-black/40 text-cyan-300 drop-shadow-[0_0_4px_rgba(6,182,212,0.55)] hover:bg-black/55"
                    : "bg-black/40 text-foreground/85 hover:bg-black/55 hover:text-foreground"
            }`}
        >
            {loading ? (
                <Loader2 className="h-3 w-3 animate-spin text-cyan-300" />
            ) : isGhost ? (
                <Eye className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
                <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
        </div>
    );
};

export default OverlayControl;
