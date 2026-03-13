import { m } from "framer-motion";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Loader2, Pickaxe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";

export default function Regolith() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    const handleLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
        toast({
            title: "Erreur de chargement",
            description: "Impossible de charger Regolith. Vérifiez votre connexion internet.",
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
            await openExternal("https://regolith.rocks/");
        } catch {
            window.open("https://regolith.rocks/", "_blank", "noopener,noreferrer");
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
                    <Pickaxe className="h-4 w-4 text-amber-500" />
                    <span className="font-medium text-sm">Regolith - Mining</span>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-7 px-2" title="Rafraîchir">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenExternal} className="h-7 px-2 gap-1.5" title="Ouvrir dans le navigateur">
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="text-xs">Navigateur</span>
                    </Button>
                </div>
            </div>

            {/* Zone iframe */}
            <div className="relative flex-1 min-h-0">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de Regolith...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                            <p className="text-sm text-muted-foreground text-center">
                                Impossible de charger Regolith. Le site ne supporte peut-être pas l'intégration iframe.
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
                    src="https://regolith.rocks/"
                    className="w-full h-full border-0"
                    title="Regolith - Mining Star Citizen"
                    allow="fullscreen"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
