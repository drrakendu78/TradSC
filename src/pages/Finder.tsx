import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

const FINDER_URL = "https://finder.cstone.space/";

/**
 * Finder — wrapper iframe vers Cornerstone Finder, uniformisé sous le
 * design ToolPageHeader (cohérent avec SC Trade Routes / ScExternalTool).
 */
export default function Finder() {
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
            description: "Impossible de charger le Finder. Vérifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = FINDER_URL;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(FINDER_URL);
        } catch {
            window.open(FINDER_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "finder",
                url: FINDER_URL,
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
                icon={Search}
                iconClassName="text-cyan-500"
                toolName="Finder"
                detail="Cornerstone"
                onRefresh={handleRefresh}
                onOpenOverlay={handleOpenOverlay}
                onOpenExternal={handleOpenExternal}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement du Finder...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-6 backdrop-blur-sm">
                        <div className="max-w-md rounded-lg border border-border bg-card/80 p-5 text-center shadow-lg backdrop-blur-md">
                            <p className="text-sm text-muted-foreground">
                                Impossible de charger le Finder dans l'application.
                            </p>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src={FINDER_URL}
                    className="block h-full w-full border-0"
                    title="Cornerstone Finder"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
