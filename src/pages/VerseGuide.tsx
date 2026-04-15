import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Loader2, BookOpen, PictureInPicture2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const VERSEGUIDE_URL = "https://verseguide.com/";

interface OverlayClosedPayload {
    id: string;
}

export default function VerseGuide() {
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
                if (event.payload?.id !== "verseguide") return;
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
            description: "Impossible de charger VerseGuide. Verifiez votre connexion internet.",
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
            setIsDetachedToOverlay(true);
            setIsLoading(false);
            setHasError(false);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full overflow-hidden"
        >
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50 bg-background/80 backdrop-blur-md flex-shrink-0">
                <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 backdrop-blur-md shadow-sm">
                    <BookOpen className="h-4 w-4 text-indigo-500" />
                    <span className="font-medium text-[12px]">VerseGuide</span>
                </div>
                <div className="flex gap-1.5">
                    <button
                        onClick={handleRefresh}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Rafraichir"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={handleOpenOverlay}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Detacher en overlay"
                    >
                        <PictureInPicture2 className="h-3.5 w-3.5" />
                        <span>Overlay</span>
                    </button>
                    <button
                        onClick={handleOpenExternal}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Ouvrir dans le navigateur"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Navigateur</span>
                    </button>
                </div>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
                {!isDetachedToOverlay && isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de VerseGuide...</p>
                        </div>
                    </div>
                )}

                {!isDetachedToOverlay && hasError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                            <p className="text-sm text-muted-foreground text-center">
                                Impossible de charger VerseGuide. Le site ne supporte peut-etre pas l'integration iframe.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleRefresh}
                                    className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Reessayer
                                </button>
                                <button
                                    onClick={handleOpenExternal}
                                    className="flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11.5px] text-primary backdrop-blur-md shadow-sm transition-all hover:border-primary/60 hover:bg-primary/25"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Ouvrir dans le navigateur
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {isDetachedToOverlay ? (
                    <div className="h-full w-full flex items-center justify-center p-6">
                        <div className="max-w-md w-full rounded-lg border border-border bg-card/60 backdrop-blur-sm p-5 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">VerseGuide est detache en overlay pour eviter le rendu en double.</p>
                            <div className="flex items-center justify-center gap-2">
                                <button
                                    onClick={handleRefresh}
                                    className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                                >
                                    Recharger dans l'app
                                </button>
                                <button
                                    onClick={handleOpenOverlay}
                                    className="flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11.5px] text-primary backdrop-blur-md shadow-sm transition-all hover:border-primary/60 hover:bg-primary/25"
                                >
                                    Re-focus overlay
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <iframe
                        ref={iframeRef}
                        src={VERSEGUIDE_URL}
                        className="w-full h-full border-0"
                        title="VerseGuide"
                        allow="fullscreen"
                        onLoad={handleLoad}
                        onError={handleError}
                    />
                )}
            </div>
        </m.div>
    );
}
