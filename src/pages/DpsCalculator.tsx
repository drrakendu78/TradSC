import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

const DPS_URL = "https://www.erkul.games/live/calculator";
const SPVIEWER_URL = "https://www.spviewer.eu/";

/**
 * DpsCalculator — wrapper iframe vers Erkul, uniformisé sous le design
 * ToolPageHeader (cohérent avec SC Trade Routes / ScExternalTool). Garde
 * un bouton "SP Viewer" custom dans customActions pour ouvrir spviewer.eu
 * en webview overlay (alternative à Erkul).
 */
export default function DpsCalculator() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        const timeout = setTimeout(() => setIsLoading(false), 12000);
        return () => clearTimeout(timeout);
    }, []);

    const handleLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
        toast({
            title: "Erreur de chargement",
            description: "Impossible de charger le calculateur DPS. Vérifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = DPS_URL;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(DPS_URL);
        } catch {
            window.open(DPS_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "erkul",
                url: DPS_URL,
                x: 100.0,
                y: 100.0,
                width: 500.0,
                height: 700.0,
                opacity: 1.0,
            });
        } catch (error) {
            console.error(error);
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

    // Bouton custom "SP Viewer" qui apparaîtra à gauche du Refresh dans le
    // ToolPageHeader (séparé du reste par une fine barre verticale).
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
                onRefresh={handleRefresh}
                onOpenOverlay={handleOpenOverlay}
                onOpenExternal={handleOpenExternal}
                customActions={spViewerButton}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement du calculateur DPS...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-6 backdrop-blur-sm">
                        <div className="max-w-md rounded-lg border border-border bg-card/80 p-5 text-center shadow-lg backdrop-blur-md">
                            <p className="text-sm text-muted-foreground">
                                Impossible de charger le calculateur DPS dans l'application.
                            </p>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src={DPS_URL}
                    className="block h-full w-full border-0"
                    title="Erkul Games DPS Calculator"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
