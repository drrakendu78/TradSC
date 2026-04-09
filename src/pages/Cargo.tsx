import { m } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Loader2, Package, PictureInPicture2 } from "lucide-react";
import openExternal from "@/utils/external";
import { invoke } from "@tauri-apps/api/core";

const CARGO_URL = "https://ratjack.net/Star-Citizen/Cargo-Grids/";

export default function Cargo() {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Empêcher l'iframe de modifier la taille du document
    useEffect(() => {
        const forceHeight = () => {
            const html = document.documentElement;
            const body = document.body;
            const root = document.getElementById('root');

            if (html) {
                html.style.setProperty('height', '100vh', 'important');
                html.style.setProperty('max-height', '100vh', 'important');
                html.style.setProperty('overflow', 'hidden', 'important');
            }
            if (body) {
                body.style.setProperty('height', '100vh', 'important');
                body.style.setProperty('max-height', '100vh', 'important');
                body.style.setProperty('overflow', 'hidden', 'important');
            }
            if (root) {
                root.style.setProperty('height', '100vh', 'important');
                root.style.setProperty('max-height', '100vh', 'important');
                root.style.setProperty('overflow', 'hidden', 'important');
            }
        };

        forceHeight();

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const target = mutation.target as HTMLElement;
                    if (target === document.documentElement || target === document.body || target === document.getElementById('root')) {
                        forceHeight();
                    }
                }
            });
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
        const root = document.getElementById('root');
        if (root) observer.observe(root, { attributes: true, attributeFilter: ['style'] });

        const interval = setInterval(forceHeight, 50);

        return () => {
            observer.disconnect();
            clearInterval(interval);
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

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex w-full h-full flex-col relative p-4 overflow-hidden"
            style={{
                maxHeight: '100%',
                height: '100%',
                minHeight: 0,
                flex: '1 1 0%',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* Header flottant */}
            <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
                <div className="flex items-center gap-3 bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-border/50 shadow-sm">
                    <Package className="h-5 w-5 text-amber-500" />
                    <span className="font-medium text-sm">Grilles Cargo</span>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRefresh}
                        className="h-8 px-3 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm"
                        title="Rafraîchir"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => invoke('open_overlay', { id: 'cargo', url: CARGO_URL, x: 100.0, y: 100.0, width: 500.0, height: 700.0, opacity: 0.9 }).catch(console.error)}
                        className="h-8 px-3 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm gap-2"
                        title="Détacher en overlay"
                    >
                        <PictureInPicture2 className="h-4 w-4" />
                        <span className="hidden sm:inline text-xs">Overlay</span>
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleOpenExternal}
                        className="h-8 px-3 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm gap-2"
                        title="Ouvrir dans le navigateur"
                    >
                        <ExternalLink className="h-4 w-4" />
                        <span className="hidden sm:inline text-xs">Navigateur</span>
                    </Button>
                </div>
            </div>

            {/* Indicateur de chargement */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Chargement des grilles cargo...</p>
                    </div>
                </div>
            )}

            {/* Message d'erreur */}
            {hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
                    <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg border border-border shadow-lg max-w-md">
                        <p className="text-sm text-muted-foreground text-center">
                            Impossible de charger les grilles cargo. Le site bloque peut-être les iframes.
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

            {/* Iframe */}
            <iframe
                ref={iframeRef}
                src={CARGO_URL}
                className="w-full h-full border-0 flex-1 min-h-0"
                title="Grilles Cargo Star Citizen - ratjack.net"
                allow="fullscreen"
                onLoad={handleLoad}
                onError={handleError}
                style={{
                    position: 'absolute',
                    top: '3.5rem',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    height: 'calc(100% - 3.5rem)',
                    maxHeight: '100%',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    display: 'block',
                    flexShrink: 0
                }}
                scrolling="no"
            />
        </m.div>
    );
}
