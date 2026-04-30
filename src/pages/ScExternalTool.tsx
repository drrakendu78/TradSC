import { m } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
    Database,
    ExternalLink,
    Hammer,
    Loader2,
    PackageCheck,
    Pickaxe,
    PictureInPicture2,
    RefreshCw,
    Route,
    Server,
    ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ScIframeTool, ScToolIcon } from "@/data/sc-tools";
import { isAllowedUrl } from "@/utils/external";

interface ScExternalToolProps {
    tool: ScIframeTool;
}

const TOOL_ICONS: Record<ScToolIcon, LucideIcon> = {
    server: Server,
    package: PackageCheck,
    database: Database,
    hammer: Hammer,
    route: Route,
    pickaxe: Pickaxe,
    shield: ShieldCheck,
};

export default function ScExternalTool({ tool }: ScExternalToolProps) {
    const { id, label, detail, url } = tool;
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const Icon = TOOL_ICONS[tool.icon];
    const hideIframeScrollbar = tool.hideIframeScrollbar === true;
    const iframeClassName = hideIframeScrollbar ? "block h-full border-0" : "block h-full w-full border-0";
    const iframeStyle = hideIframeScrollbar
        ? { width: "calc(100% + 18px)", marginRight: "-18px" }
        : undefined;

    useEffect(() => {
        const timeout = window.setTimeout(() => setIsLoading(false), 12000);
        return () => window.clearTimeout(timeout);
    }, [url]);

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        if (iframeRef.current) {
            iframeRef.current.src = url;
        }
    };

    const handleLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    const handleOpenOverlay = async () => {
        if (!isAllowedUrl(url)) {
            console.warn(`URL non autorisee: ${url}`);
            return;
        }

        try {
            await invoke("open_webview_overlay", {
                id,
                url,
                width: tool.webviewWidth ?? 1200.0,
                height: tool.webviewHeight ?? 780.0,
                opacity: tool.webviewOpacity ?? 1.0,
            });
        } catch (error) {
            console.error(`Impossible d'ouvrir ${label} en overlay:`, error);
        }
    };

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden"
        >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background/80 px-2 py-1.5 backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 shadow-sm backdrop-blur-md">
                    <Icon className={`h-4 w-4 ${tool.iconClassName}`} />
                    <span className="truncate text-[12px] font-medium">{label}</span>
                    <span className="hidden rounded-full border border-border/35 bg-background/45 px-2 py-0.5 text-[10px] uppercase text-muted-foreground sm:inline">
                        {detail}
                    </span>
                </div>

                <div className="flex shrink-0 gap-1.5">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/80 shadow-sm backdrop-blur-md transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Rafraichir"
                        aria-label={`Rafraichir ${label}`}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenOverlay}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[11.5px] text-foreground/80 shadow-sm backdrop-blur-md transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Detacher en overlay"
                    >
                        <PictureInPicture2 className="h-3.5 w-3.5" />
                        <span>Overlay</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenOverlay}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/80 shadow-sm backdrop-blur-md transition-all hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                        title="Ouvrir"
                        aria-label={`Ouvrir ${label}`}
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden">
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Chargement de {label}...</p>
                        </div>
                    </div>
                )}

                {hasError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-6 backdrop-blur-sm">
                        <div className="max-w-md rounded-lg border border-border bg-card/80 p-5 text-center shadow-lg backdrop-blur-md">
                            <p className="text-sm text-muted-foreground">
                                Impossible de charger {label} dans l'application.
                            </p>
                        </div>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    src={url}
                    className={iframeClassName}
                    style={iframeStyle}
                    title={label}
                    allow="clipboard-read; clipboard-write; fullscreen"
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={handleLoad}
                    onError={handleError}
                />
            </div>
        </m.div>
    );
}
