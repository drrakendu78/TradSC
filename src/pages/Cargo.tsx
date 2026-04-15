import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Loader2, Package, PictureInPicture2 } from "lucide-react";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const CARGO_URL = "https://ratjack.net/Star-Citizen/Cargo-Grids/";

interface OverlayClosedPayload {
    id: string;
}

export default function Cargo() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isDetachedToOverlay, setIsDetachedToOverlay] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const forceHeight = () => {
            const html = document.documentElement;
            const body = document.body;
            const root = document.getElementById("root");

            if (html) {
                html.style.setProperty("height", "100vh", "important");
                html.style.setProperty("max-height", "100vh", "important");
                html.style.setProperty("overflow", "hidden", "important");
            }
            if (body) {
                body.style.setProperty("height", "100vh", "important");
                body.style.setProperty("max-height", "100vh", "important");
                body.style.setProperty("overflow", "hidden", "important");
            }
            if (root) {
                root.style.setProperty("height", "100vh", "important");
                root.style.setProperty("max-height", "100vh", "important");
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

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
        observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
        const root = document.getElementById("root");
        if (root) observer.observe(root, { attributes: true, attributeFilter: ["style"] });

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
                if (event.payload?.id !== "cargo") return;
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
            iframeRef.current.src = CARGO_URL;
        }
    };

    const handleOpenExternal = async () => {
        try {
            await openExternal(CARGO_URL);
        } catch {
            window.open(CARGO_URL, "_blank", "noopener,noreferrer");
        }
    };

    const handleOpenOverlay = async () => {
        try {
            await invoke("open_overlay", {
                id: "cargo",
                url: CARGO_URL,
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
            className="flex w-full h-full flex-col relative overflow-hidden"
            style={{
                maxHeight: "100%",
                height: "100%",
                minHeight: 0,
                flex: "1 1 0%",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between">
                <div className="flex items-center gap-2 bg-background/80 backdrop-blur-md rounded-full px-3 py-1.5 border border-border/60 shadow-sm">
                    <Package className="h-4 w-4 text-amber-500" />
                    <span className="font-medium text-[12px]">Grilles Cargo</span>
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
                        <span className="hidden sm:inline">Overlay</span>
                    </button>
                    <button
                        onClick={handleOpenExternal}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 backdrop-blur-md shadow-sm transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Ouvrir dans le navigateur"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Navigateur</span>
                    </button>
                </div>
            </div>

            {!isDetachedToOverlay && isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Chargement des grilles cargo...</p>
                    </div>
                </div>
            )}

            {!isDetachedToOverlay && hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                        <p className="text-sm text-muted-foreground text-center">
                            Impossible de charger les grilles cargo. Le site bloque peut-etre les iframes.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={handleRefresh}
                                className="flex h-8 items-center gap-1.5 rounded-full border border-border/30 bg-background/20 px-3 text-[11.5px] text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Reessayer
                            </button>
                            <button
                                onClick={handleOpenExternal}
                                className="flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11.5px] text-primary backdrop-blur-sm transition-all hover:border-primary/60 hover:bg-primary/25"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Ouvrir dans le navigateur
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isDetachedToOverlay ? (
                <div
                    className="absolute top-14 left-0 right-0 bottom-0 flex items-center justify-center p-6"
                    style={{ height: "calc(100% - 2.75rem)" }}
                >
                    <div className="max-w-md w-full rounded-lg border border-border bg-card/60 backdrop-blur-sm p-5 text-center space-y-3">
                        <p className="text-sm text-muted-foreground">Cargo est detache en overlay pour eviter le rendu en double.</p>
                        <div className="flex items-center justify-center gap-2">
                            <button
                                onClick={handleRefresh}
                                className="flex h-8 items-center gap-1.5 rounded-full border border-border/30 bg-background/20 px-3 text-[11.5px] text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary"
                            >
                                Recharger dans l'app
                            </button>
                            <button
                                onClick={handleOpenOverlay}
                                className="flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-[11.5px] text-primary backdrop-blur-sm transition-all hover:border-primary/60 hover:bg-primary/25"
                            >
                                Re-focus overlay
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <iframe
                    ref={iframeRef}
                    src={CARGO_URL}
                    className="w-full h-full border-0 flex-1 min-h-0"
                    title="Grilles Cargo Star Citizen - ratjack.net"
                    allow="fullscreen"
                    onLoad={handleLoad}
                    onError={handleError}
                    style={{
                        position: "absolute",
                        top: "2.75rem",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: "100%",
                        height: "calc(100% - 2.75rem)",
                        maxHeight: "100%",
                        maxWidth: "100%",
                        overflow: "hidden",
                        display: "block",
                        flexShrink: 0,
                    }}
                    scrolling="no"
                />
            )}
        </m.div>
    );
}
