import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Loader2, PictureInPicture2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const FINDER_URL = "https://finder.cstone.space/";

interface OverlayClosedPayload {
    id: string;
}

export default function Finder() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isDetachedToOverlay, setIsDetachedToOverlay] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        const forceHeight = () => {
            const html = document.documentElement;
            const body = document.body;
            const root = document.getElementById("root");

            if (html) {
                html.style.setProperty("height", "100vh", "important");
                html.style.setProperty("max-height", "100vh", "important");
                html.style.setProperty("min-height", "100vh", "important");
                html.style.setProperty("overflow", "hidden", "important");
            }
            if (body) {
                body.style.setProperty("height", "100vh", "important");
                body.style.setProperty("max-height", "100vh", "important");
                body.style.setProperty("min-height", "100vh", "important");
                body.style.setProperty("overflow", "hidden", "important");
            }
            if (root) {
                root.style.setProperty("height", "100vh", "important");
                root.style.setProperty("max-height", "100vh", "important");
                root.style.setProperty("min-height", "100vh", "important");
                root.style.setProperty("overflow", "hidden", "important");
            }
        };

        forceHeight();

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "attributes" && mutation.attributeName === "style") {
                    const target = mutation.target as HTMLElement;
                    if (
                        target === document.documentElement ||
                        target === document.body ||
                        target === document.getElementById("root")
                    ) {
                        forceHeight();
                    }
                }
            });
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
        observer.observe(document.body, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
        const root = document.getElementById("root");
        if (root) observer.observe(root, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });

        const interval = setInterval(forceHeight, 50);

        return () => {
            observer.disconnect();
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        const setup = async () => {
            unlisten = await listen<OverlayClosedPayload>("overlay_closed", (event) => {
                if (event.payload?.id !== "finder") return;
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
            description: "Impossible de charger le Finder. Verifiez votre connexion internet.",
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
        if (iframeRef.current) {
            iframeRef.current.src = FINDER_URL;
        }
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
            setIsDetachedToOverlay(true);
            setIsLoading(false);
            setHasError(false);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <m.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
            className="flex w-full h-full flex-col relative p-2 overflow-hidden"
            style={{ maxHeight: "100%", height: "100%", minHeight: 0, flex: "1 1 0%", position: "relative", overflow: "hidden" }}
        >
            <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10 flex gap-2 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Button variant="secondary" size="sm" onClick={handleRefresh} className="h-8 px-2 bg-background/90 backdrop-blur-sm border border-border/50 shadow-sm" title="Rafraichir">
                    <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={handleOpenOverlay} className="h-8 px-3 bg-background/90 backdrop-blur-sm border border-border/50 shadow-sm gap-2" title="Detacher en overlay">
                    <PictureInPicture2 className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs">Overlay</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={handleOpenExternal} className="h-8 px-2 bg-background/90 backdrop-blur-sm border border-border/50 shadow-sm" title="Ouvrir dans le navigateur">
                    <ExternalLink className="h-4 w-4" />
                </Button>
            </div>

            {!isDetachedToOverlay && isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Chargement du Finder...</p>
                    </div>
                </div>
            )}

            {!isDetachedToOverlay && hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                        <p className="text-sm text-muted-foreground text-center">Impossible de charger le Finder.</p>
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
                <div className="absolute top-2 left-2 right-0 bottom-2 flex items-center justify-center p-6">
                    <div className="max-w-md w-full rounded-lg border border-border bg-card/60 backdrop-blur-sm p-5 text-center space-y-3">
                        <p className="text-sm text-muted-foreground">Finder est detache en overlay pour eviter le rendu en double.</p>
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
                    src={FINDER_URL}
                    className="w-full h-full border-0 flex-1 min-h-0"
                    title="Cornerstone Finder"
                    allow="fullscreen"
                    onLoad={handleLoad}
                    onError={handleError}
                    style={{
                        position: "absolute",
                        top: "0.5rem",
                        left: "0.5rem",
                        right: 0,
                        bottom: "0.5rem",
                        width: "calc(100% - 0.5rem)",
                        height: "calc(100% - 1rem)",
                        maxHeight: "100%",
                        maxWidth: "100%",
                        overflow: "auto",
                        display: "block",
                        flexShrink: 0,
                    }}
                />
            )}
        </m.div>
    );
}
