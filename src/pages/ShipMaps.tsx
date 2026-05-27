import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Loader2, Map } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

const SHIPMAPS_URL = "https://maps.adi.sc/";

/**
 * ShipMaps — wrapper iframe vers maps.adi.sc (cartes de vaisseaux ADI),
 * uniformisé sous le design ToolPageHeader (cohérent avec
 * SC Trade Routes / ScExternalTool).
 */
export default function ShipMaps() {
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
            description: "Impossible de charger les cartes de vaisseaux. Vérifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = SHIPMAPS_URL;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(SHIPMAPS_URL);
        } catch {
            window.open(SHIPMAPS_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "shipmaps",
                url: SHIPMAPS_URL,
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
                icon={Map}
                iconClassName="text-indigo-500"
                toolName="Cartes Vaisseaux"
                detail="ADI"
                onRefresh={handleRefresh}
                onOpenOverlay={handleOpenOverlay}
                onOpenExternal={handleOpenExternal}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement des cartes de vaisseaux...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-6 backdrop-blur-sm">
                        <div className="max-w-md rounded-lg border border-border bg-card/80 p-5 text-center shadow-lg backdrop-blur-md">
                            <p className="text-sm text-muted-foreground">
                                Impossible de charger les cartes de vaisseaux ADI.
                            </p>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src={SHIPMAPS_URL}
                    className="block h-full w-full border-0"
                    title="ADI Ship Maps"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
