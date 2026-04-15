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
                className="h-full w-full rounded-full border border-sky-300/50 bg-sky-500/15 text-sky-100 backdrop-blur-md shadow-sm transition-all hover:border-sky-200/70 hover:bg-sky-500/25 flex items-center justify-center disabled:opacity-70"
                disabled={loading}
            >
                {loading ? (
                    <Loader2 className="h-2.5 w-2.5" />
                ) : (
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
                )}
            </button>
        </div>
    );
};

export default OverlayControl;
