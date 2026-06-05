import { m } from "framer-motion";
import { ExternalLink, Calculator } from "lucide-react";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

const DPS_URL = "https://www.erkul.games/live/calculator";
const SPVIEWER_URL = "https://www.spviewer.eu/";

/**
 * DpsCalculator — page de redirection vers Erkul Games (calculateur DPS).
 * On n'intègre plus le site en iframe : un simple bouton l'ouvre dans le
 * navigateur (on n'embarque pas le frontend d'Erkul dans l'app). Garde le
 * bouton « SP Viewer » comme alternative.
 */
export default function DpsCalculator() {
    const handleOpenExternal = async () => {
        try {
            await openExternal(DPS_URL);
        } catch {
            window.open(DPS_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenSpViewer = async () => {
        try {
            await invoke("open_webview_overlay", {
                id: "spviewer",
                url: SPVIEWER_URL,
                width: 900.0,
                height: 700.0,
                opacity: 1.0,
            });
        } catch {
            await openExternal(SPVIEWER_URL);
        }
    };

    // Bouton custom "SP Viewer" à gauche dans le ToolPageHeader.
    const spViewerButton = (
        <button
            type="button"
            onClick={handleOpenSpViewer}
            className="flex h-[26px] items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-primary transition-colors hover:border-primary/60 hover:bg-primary/20"
            title="Ouvrir SP Viewer en overlay"
        >
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            <span>SP Viewer</span>
        </button>
    );

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden"
        >
            <ToolPageHeader
                icon={Calculator}
                iconClassName="text-emerald-500"
                toolName="DPS Calculator"
                detail="Erkul"
                onOpenExternal={handleOpenExternal}
                customActions={spViewerButton}
            />

            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <div className="max-w-md rounded-2xl border border-border/60 bg-card/60 p-8 text-center shadow-lg backdrop-blur-md">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
                        <Calculator className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">Calculateur DPS — Erkul Games</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Le calculateur DPS et les builds de vaisseaux sont fournis par Erkul Games.
                        Clique pour l'ouvrir dans ton navigateur.
                    </p>
                    <button
                        type="button"
                        onClick={handleOpenExternal}
                        className="mx-auto mt-6 flex items-center gap-2 rounded-lg bg-emerald-500/15 px-5 py-2.5 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/40 transition-colors hover:bg-emerald-500/25"
                    >
                        <ExternalLink className="h-4 w-4" strokeWidth={2} />
                        Ouvrir Erkul
                    </button>
                </div>
            </div>
        </m.div>
    );
}
