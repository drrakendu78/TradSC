import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";

const OverlayControl = () => {
    const [searchParams] = useSearchParams();
    const id = searchParams.get("id") || "";
    const overlayType = searchParams.get("overlayType") || "iframe";
    const [loading, setLoading] = useState(false);

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

    const backToEditMode = async () => {
        if (!id || loading) return;
        setLoading(true);
        try {
            await invoke("set_overlay_interaction", {
                id,
                overlayType,
                interactive: true,
            });
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-screen h-screen bg-transparent p-0">
            <button
                onClick={backToEditMode}
                title="Mode jeu actif - cliquer pour passer en mode edit"
                className="h-full w-full rounded-sm border border-sky-300/60 bg-[linear-gradient(180deg,rgba(28,52,72,0.99),rgba(18,34,49,0.99))] shadow-[inset_0_1px_0_rgba(148,197,255,0.22),inset_0_0_0_1px_rgba(56,189,248,0.24),0_0_0_1px_rgba(56,189,248,0.45),0_0_12px_rgba(56,189,248,0.42),0_0_22px_rgba(37,99,235,0.28),0_2px_6px_rgba(0,0,0,0.55)] flex items-center justify-center disabled:opacity-70"
                disabled={loading}
            >
                {loading ? (
                    <Loader2 className="h-3 w-3 text-slate-100" />
                ) : (
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3 text-slate-100"
                        aria-hidden="true"
                    >
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M9 11V8a3.5 3.5 0 0 1 6-1.8" />
                    </svg>
                )}
            </button>
        </div>
    );
};

export default OverlayControl;
