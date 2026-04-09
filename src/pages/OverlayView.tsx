import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
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
        <div className="w-screen h-screen bg-transparent relative overflow-hidden">
            <div
                onMouseDown={() => getCurrentWindow().startDragging()}
                className="absolute top-0 left-0 right-0 h-6 cursor-move flex items-center justify-end gap-0.5 pr-1"
                style={{ zIndex: 9999, background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)" }}
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
                    className="w-5 h-5 min-w-5 min-h-5 flex-none rounded-sm border border-sky-300/30 bg-[linear-gradient(180deg,rgba(28,52,72,0.96),rgba(18,34,49,0.96))] shadow-[inset_0_1px_0_rgba(148,197,255,0.18),0_1px_4px_rgba(0,0,0,0.45)] flex items-center justify-center leading-none text-[0px] transition-none"
                    title="Mode edit actif - clic pour mode jeu"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-2.5 w-2.5 text-slate-100"
                        aria-hidden="true"
                    >
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M9 11V8a3.5 3.5 0 0 1 6-1.8" />
                    </svg>
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setHidden(!hidden)}
                    className="w-5 h-5 rounded-sm border border-amber-300/30 bg-[linear-gradient(180deg,rgba(72,54,25,0.95),rgba(45,35,16,0.95))] shadow-[inset_0_1px_0_rgba(252,211,77,0.16),0_1px_4px_rgba(0,0,0,0.45)] hover:bg-[linear-gradient(180deg,rgba(82,61,29,0.95),rgba(54,42,20,0.95))] active:scale-[0.98] flex items-center justify-center transition-all"
                    title={hidden ? "Afficher" : "Masquer"}
                >
                    {hidden ? <Eye size={10} className="text-amber-100" /> : <EyeOff size={10} className="text-amber-100" />}
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={handleClose}
                    className="w-5 h-5 rounded-sm hover:bg-red-600/70 flex items-center justify-center transition-all"
                    title="Fermer"
                >
                    <X size={10} className="text-white/70" />
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
