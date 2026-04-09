import { m } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Loader2, Database, PictureInPicture2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";

export default function ScmDb() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        const timeout = setTimeout(() => setIsLoading(false), 8000);
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
            description: "Impossible de charger SCMDB. Vérifiez votre connexion internet.",
            variant: "destructive",
        });
    };

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) iframeRef.current.src = iframeRef.current.src;
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal("https://scmdb.net/");
        } catch {
            window.open("https://scmdb.net/", "_blank", "noopener,noreferrer");
        }
    };

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full overflow-hidden"
        >
            {/* Header fixe */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-emerald-500" />
                    <span className="font-medium text-sm">SCMDB - Base de données</span>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-7 px-2" title="Rafraîchir">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => invoke('open_overlay', { id: 'scmdb', url: 'https://scmdb.net/', x: 100.0, y: 100.0, width: 500.0, height: 700.0, opacity: 0.9 }).catch(console.error)} className="h-7 px-2 gap-1.5" title="Détacher en overlay">
                        <PictureInPicture2 className="h-3.5 w-3.5" />
                        <span className="text-xs">Overlay</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenExternal} className="h-7 px-2 gap-1.5" title="Ouvrir dans le navigateur">
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="text-xs">Navigateur</span>
                    </Button>
                </div>
            </div>

            {/* Zone iframe */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de SCMDB...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                            <p className="text-sm text-muted-foreground text-center">
                                Impossible de charger SCMDB. Le site ne supporte peut-être pas l'intégration iframe.
                            </p>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={handleRefresh}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Réessayer
                                </Button>
                                <Button variant="default" size="sm" onClick={handleOpenExternal}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Ouvrir dans le navigateur
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src="https://scmdb.net/"
                    className="w-full h-full border-0"
                    title="SCMDB - Star Citizen Database"
                    allow="fullscreen"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
