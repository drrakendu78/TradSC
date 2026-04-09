import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Loader2, Database, PictureInPicture2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const SCMDB_URL = "https://scmdb.net/";

interface OverlayClosedPayload {
    id: string;
}

export default function ScmDb() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isDetachedToOverlay, setIsDetachedToOverlay] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        const timeout = setTimeout(() => setIsLoading(false), 8000);
        return () => clearTimeout(timeout);
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        const setup = async () => {
            unlisten = await listen<OverlayClosedPayload>("overlay_closed", (event) => {
                if (event.payload?.id !== "scmdb") return;
                setIsDetachedToOverlay(false);
                setIsLoading(true);
                setHasError(false);
            });
        };
        setup().catch(console.error);
        return () => {
            if (unlisten) unlisten();
        };
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
            description: "Impossible de charger SCMDB. Verifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        if (isDetachedToOverlay) {
            setIsDetachedToOverlay(false);
            setIsLoading(true);
            setHasError(false);
            return;
        }

        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = SCMDB_URL;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(SCMDB_URL);
        } catch {
            window.open(SCMDB_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "scmdb",
                url: SCMDB_URL,
                x: 100.0,
                y: 100.0,
                width: 500.0,
                height: 700.0,
                opacity: 1.0,
            });

            // SCMDB est lourd : on coupe l'iframe integree pour eviter le rendu en double.
            setIsDetachedToOverlay(true);
            setIsLoading(false);
            setHasError(false);
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: "Impossible d'ouvrir l'overlay SCMDB.",
                variant: "destructive",
            });
        }
    };

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full overflow-hidden"
        >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-emerald-500" />
                    <span className="font-medium text-sm">SCMDB - Base de donnees</span>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-7 px-2" title="Rafraichir">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenOverlay} className="h-7 px-2 gap-1.5" title="Detacher en overlay">
                        <PictureInPicture2 className="h-3.5 w-3.5" />
                        <span className="text-xs">Overlay</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenExternal} className="h-7 px-2 gap-1.5" title="Ouvrir dans le navigateur">
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="text-xs">Navigateur</span>
                    </Button>
                </div>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
                {!isDetachedToOverlay && isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de SCMDB...</p>
                        </div>
                    </div>
                )}

                {!isDetachedToOverlay && hasError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                            <p className="text-sm text-muted-foreground text-center">
                                Impossible de charger SCMDB. Le site ne supporte peut-etre pas l'integration iframe.
                            </p>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={handleRefresh}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Reessayer
                                </Button>
                                <Button variant="default" size="sm" onClick={handleOpenExternal}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Ouvrir dans le navigateur
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {isDetachedToOverlay ? (
                    <div className="h-full w-full flex items-center justify-center p-6">
                        <div className="max-w-md w-full rounded-lg border border-border bg-card/60 backdrop-blur-sm p-5 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">
                                SCMDB est detache en overlay pour eviter le rendu en double.
                            </p>
                            <div className="flex items-center justify-center gap-2">
                                <Button variant="outline" size="sm" onClick={handleRefresh}>
                                    Recharger dans l'app
                                </Button>
                                <Button variant="default" size="sm" onClick={handleOpenOverlay}>
                                    Re-focus overlay
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <iframe
                        ref={iframeRef}
                        src={SCMDB_URL}
                        className="w-full h-full border-0"
                        title="SCMDB - Star Citizen Database"
                        allow="fullscreen"
                        onLoad={handleLoad}
                        onError={handleError}
                    />
                )}
            </div>
        </m.div>
    );
}
