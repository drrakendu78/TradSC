import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { Move } from "lucide-react";

// Mini-fenêtre Tauri dédiée qui rend le grid 3×3 des presets de position
// du hub overlay. Spawnée par le bouton Move dans la bar du hub via la
// commande Rust `toggle_hub_preset_picker`. Communique avec OverlayHub.tsx
// via l'event `overlay_hub_preset_change` (déjà écouté pour la sync sidebar).
//
// Pourquoi une window séparée plutôt qu'un dropdown inline ? La fenêtre du
// hub a une pill SetWindowRgn ; un dropdown inline ferait grossir la pill
// d'une façon visuellement cassée (cf. screenshots). Une mini-window à part
// est rectangulaire et garde la pill du hub intacte.

const HUB_PRESET_STORAGE_KEY = "overlay_hub_preset_v1";
const HUB_PRESET_EVENT = "overlay_hub_preset_change";

type HubPreset =
    | "free"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right";

// Layout du grid : 3×3 cellules. Cellule centrale = "free" (drag à la souris).
const PRESET_GRID: { preset: HubPreset; label: string }[] = [
    { preset: "top-left", label: "Haut gauche" },
    { preset: "top", label: "Haut centre" },
    { preset: "top-right", label: "Haut droite" },
    { preset: "left", label: "Gauche (centré)" },
    { preset: "free", label: "Libre" },
    { preset: "right", label: "Droite (centré)" },
    { preset: "bottom-left", label: "Bas gauche" },
    { preset: "bottom", label: "Bas centre" },
    { preset: "bottom-right", label: "Bas droite" },
];

function isHubPreset(value: unknown): value is HubPreset {
    return (
        value === "free" ||
        value === "top" ||
        value === "bottom" ||
        value === "top-left" ||
        value === "top-right" ||
        value === "left" ||
        value === "right" ||
        value === "bottom-left" ||
        value === "bottom-right"
    );
}

const OverlayHubPresetPicker = () => {
    const [searchParams] = useSearchParams();
    const initial = searchParams.get("current");
    const [current, setCurrent] = useState<HubPreset>(
        isHubPreset(initial) ? initial : "free",
    );

    // Fond transparent (même pattern que les autres fenêtres overlay).
    useEffect(() => {
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        const root = document.getElementById("root");
        if (root) root.style.background = "transparent";
        return () => {
            document.documentElement.style.background = "";
            document.body.style.background = "";
            if (root) root.style.background = "";
        };
    }, []);

    // Auto-close si la fenêtre perd le focus (clic en dehors). Même UX
    // qu'un dropdown classique.
    useEffect(() => {
        const onBlur = () => {
            invoke("close_hub_preset_picker").catch(() => undefined);
        };
        window.addEventListener("blur", onBlur);
        return () => window.removeEventListener("blur", onBlur);
    }, []);

    const handleSelect = (preset: HubPreset) => {
        setCurrent(preset);
        try {
            window.localStorage.setItem(HUB_PRESET_STORAGE_KEY, preset);
        } catch {
            /* ignore */
        }
        emit(HUB_PRESET_EVENT, { preset }).catch(() => undefined);
        // Ferme la mini-fenêtre après sélection
        invoke("close_hub_preset_picker").catch(() => undefined);
    };

    return (
        // bg matche la couleur effective du hub (rgba(8,12,17,0.75) sur fond
        // dark ≈ #080c11) pour cohérence visuelle. La fenêtre OS est opaque
        // mais le rendu donne l'illusion qu'elle est faite de la même
        // matière que le hub.
        <div className="flex h-screen w-screen items-center justify-center bg-[#080c11] p-2">
            <div className="rounded-lg border border-white/[0.10] bg-[#080c11] p-2.5">
                {/* Petit séparateur cyan style HUD comme la categories du hub */}
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                    <span className="h-1 w-1 rounded-full bg-cyan-300/70 shadow-[0_0_4px_rgba(12,231,247,0.55)]" />
                    <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-300/80">
                        Position
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-black/40 bg-black/40 p-1">
                    {PRESET_GRID.map(({ preset, label }) => {
                        const isActive = preset === current;
                        const isFree = preset === "free";
                        return (
                            <button
                                key={preset}
                                type="button"
                                aria-label={label}
                                title={label}
                                onClick={() => handleSelect(preset)}
                                className={[
                                    "relative flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                                    isActive
                                        ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-300"
                                        : "border-white/[0.07] bg-white/[0.02] text-slate-500 hover:border-white/30 hover:bg-white/[0.06] hover:text-white",
                                ].join(" ")}
                            >
                                {isFree ? (
                                    <Move className="h-3 w-3" strokeWidth={1.5} />
                                ) : (
                                    <span
                                        className={[
                                            "absolute h-1.5 w-1.5 rounded-full",
                                            isActive
                                                ? "bg-cyan-300 shadow-[0_0_4px_rgba(12,231,247,0.55)]"
                                                : "bg-slate-400",
                                            preset.includes("top")
                                                ? "top-1"
                                                : preset.includes("bottom")
                                                    ? "bottom-1"
                                                    : "top-1/2 -translate-y-1/2",
                                            preset.includes("left")
                                                ? "left-1"
                                                : preset.includes("right")
                                                    ? "right-1"
                                                    : "left-1/2 -translate-x-1/2",
                                        ].join(" ")}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default OverlayHubPresetPicker;
