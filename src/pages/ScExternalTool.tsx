import { m } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";
import {
    Database,
    Hammer,
    Loader2,
    PackageCheck,
    Pickaxe,
    Route,
    Server,
    ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ScIframeTool, ScToolIcon } from "@/data/sc-tools";
import { isAllowedUrl } from "@/utils/external";
import { ToolPageHeader } from "@/components/custom/tool-page-header";

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

    const handleOpenExternal = async () => {
        if (!isAllowedUrl(url)) {
            console.warn(`URL non autorisee: ${url}`);
            return;
        }
        try {
            await openExternal(url);
        } catch (error) {
            console.error(`Impossible d'ouvrir ${label} dans le navigateur:`, error);
            window.open(url, "_blank", "noopener,noreferrer");
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
                icon={Icon}
                iconClassName={tool.iconClassName}
                toolName={label}
                detail={detail}
                onRefresh={handleRefresh}
                onOpenOverlay={handleOpenOverlay}
                onOpenExternal={handleOpenExternal}
            />

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
