import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

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
                className="h-full w-full rounded-sm border border-sky-300/30 bg-[linear-gradient(180deg,rgba(28,52,72,0.96),rgba(18,34,49,0.96))] shadow-[inset_0_1px_0_rgba(148,197,255,0.18),0_1px_4px_rgba(0,0,0,0.45)] hover:bg-[linear-gradient(180deg,rgba(34,61,84,0.96),rgba(21,40,58,0.96))] active:scale-[0.98] flex items-center justify-center transition-all disabled:opacity-70"
                disabled={loading}
            >
                <span className="text-[9px] text-slate-100 font-semibold tracking-[0.04em] uppercase">{loading ? "..." : "Edit"}</span>
            </button>
        </div>
    );
};

export default OverlayControl;
