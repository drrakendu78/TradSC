import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Eye, EyeOff, GripVertical, X } from "lucide-react";

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

    const handleClose = () => {
        invoke("close_overlay", { id }).catch(console.error);
    };

    const handleGameMode = (event: MouseEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        invoke("set_overlay_interaction", {
            id,
            overlayType: "iframe",
            interactive: false,
            anchorX: Math.round(rect.left * dpr),
            anchorY: Math.round(rect.top * dpr),
            anchorWidth: Math.round(rect.width * dpr),
            anchorHeight: Math.round(rect.height * dpr),
        }).catch(console.error);
    };

    return (
        <div className="w-screen h-screen bg-slate-950/15 relative overflow-hidden rounded-xl ring-1 ring-white/10">
            <div
                onMouseDown={() => getCurrentWindow().startDragging()}
                className="absolute top-0 left-0 right-0 h-6 cursor-move flex items-center justify-end gap-0.5 pr-1 rounded-t-xl"
                style={{ zIndex: 9999, background: "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)" }}
            >
                <GripVertical size={10} className="text-white/70 pointer-events-none ml-1" />
                <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(opacity * 100)}
                    onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-16 h-1 mr-auto cursor-pointer accent-white/70"
                    title={`Opacite : ${Math.round(opacity * 100)}%`}
                />
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={handleGameMode}
                    className="h-5 w-5 min-w-5 min-h-5 flex-none rounded-full border border-sky-300/50 bg-sky-500/15 text-sky-100 backdrop-blur-md shadow-sm transition-all hover:border-sky-200/70 hover:bg-sky-500/25 flex items-center justify-center"
                    title="Mode edit actif - clic pour mode jeu"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-2.5 w-2.5"
                        aria-hidden="true"
                    >
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M9 11V8a3.5 3.5 0 0 1 6-1.8" />
                    </svg>
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setHidden(!hidden)}
                    className="h-5 w-5 rounded-full border border-amber-300/50 bg-amber-500/15 text-amber-100 backdrop-blur-md shadow-sm transition-all hover:border-amber-200/70 hover:bg-amber-500/25 flex items-center justify-center"
                    title={hidden ? "Afficher" : "Masquer"}
                >
                    {hidden ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={handleClose}
                    className="h-5 w-5 rounded-full border border-red-400/40 bg-red-500/10 text-red-100/80 backdrop-blur-md shadow-sm transition-all hover:border-red-300/70 hover:bg-red-500/30 hover:text-white flex items-center justify-center"
                    title="Fermer"
                >
                    <X size={10} />
                </button>
            </div>

            {!hidden && (
                <iframe
                    src={url}
                    className="w-full border-0 m-0 p-0"
                    style={{
                        background: "transparent",
                        display: "block",
                        height: "calc(100% - 24px)",
                        marginTop: "24px",
                        opacity,
                    }}
                    title={`Overlay ${id}`}
                />
            )}
        </div>
    );
};

export default OverlayView;
