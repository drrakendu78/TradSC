import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Loader2, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

const VERSEGUIDE_URL = "https://verseguide.com/";

/**
 * VerseGuide — wrapper iframe uniformisé sous le design ToolPageHeader
 * (cohérent avec SC Trade Routes / ScExternalTool). Garde son propre
 * composant (et non un simple ScExternalTool) car référencé directement
 * dans la sidebar `/verseguide` et dans overlay-hub-registry comme
 * builtin (pas SC_EXTERNAL_TOOLS).
 */
export default function VerseGuide() {
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
            description: "Impossible de charger VerseGuide. Vérifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = VERSEGUIDE_URL;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(VERSEGUIDE_URL);
        } catch {
            window.open(VERSEGUIDE_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "verseguide",
                url: VERSEGUIDE_URL,
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

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden"
        >
            <ToolPageHeader
                icon={BookOpen}
                iconClassName="text-indigo-500"
                toolName="VerseGuide"
                detail="Guide"
                onRefresh={handleRefresh}
                onOpenOverlay={handleOpenOverlay}
                onOpenExternal={handleOpenExternal}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de VerseGuide...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-6 backdrop-blur-sm">
                        <div className="max-w-md rounded-lg border border-border bg-card/80 p-5 text-center shadow-lg backdrop-blur-md">
                            <p className="text-sm text-muted-foreground">
                                Impossible de charger VerseGuide dans l'application.
                            </p>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src={VERSEGUIDE_URL}
                    className="block h-full w-full border-0"
                    title="VerseGuide"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
