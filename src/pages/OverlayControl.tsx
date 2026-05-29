import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { Eye, EyeOff, Loader2, Pin, PinOff, X } from "lucide-react";

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

    // Safety net : si `loading` reste bloqué (ex : invoke jamais résolu),
    // on force le reset après 2 secondes. Évite l'œil "grisé non-cliquable"
    // permanent si jamais l'invoke `toggle_overlay_interactive` ne résout
    // pas pour une raison X.
    useEffect(() => {
        if (!loading) return;
        const timer = window.setTimeout(() => {
            console.warn("[OverlayControl] loading stuck > 2s, force reset");
            setLoading(false);
        }, 2000);
        return () => window.clearTimeout(timer);
    }, [loading]);

    // ── Mode cargo : ce contrôle devient un mini-bar [pin][fermer] ──────────
    // La card cargo est click-through (focus-safe) → ses boutons ne recevraient
    // aucun clic. CE contrôle est WS_EX_NOACTIVATE → cliquable SANS voler le
    // focus du jeu. Pin → émet `cargo-overlay:set-pinned` (la card coupe
    // l'auto-hide). Fermer → close_overlay.
    const [pinned, setPinned] = useState(false);
    if (id === "cargo-buy") {
        const togglePin = () => {
            const next = !pinned;
            setPinned(next);
            emit("cargo-overlay:set-pinned", { pinned: next }).catch(() => undefined);
        };
        const closeOverlay = () => {
            invoke("close_overlay", { id }).catch(() => undefined);
        };
        return (
            <div className="flex h-screen w-screen items-center justify-center gap-1 rounded-md bg-black/45">
                <button
                    type="button"
                    onPointerDown={togglePin}
                    title={pinned ? "Épinglé — clic pour libérer (réactive l'auto-fermeture)" : "Épingler (garder ouvert)"}
                    className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                        pinned ? "text-amber-300" : "text-foreground/80 hover:text-foreground"
                    }`}
                >
                    {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
                <button
                    type="button"
                    onPointerDown={closeOverlay}
                    title="Fermer"
                    className="flex h-5 w-5 items-center justify-center rounded text-foreground/80 transition-colors hover:text-rose-300"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        );
    }

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
