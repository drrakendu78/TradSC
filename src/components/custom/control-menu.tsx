import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
    X,
    Minus,
    Volume2,
    VolumeX,
    SkipBack,
    SkipForward,
    Play,
    Pause,
    PanelsTopLeft,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import ServerStatus from "@/components/custom/server-status";
import { useCustomLinksStore, type CustomLink } from "@/stores/custom-links-store";
import { cn } from "@/lib/utils";

const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";

type ControlMenuProps = {
    embedded?: boolean;
    className?: string;
};

export default function ControlMenu({ embedded = false, className }: ControlMenuProps) {
    const appWindow = getCurrentWindow();
    const [isOverlayHubOpen, setIsOverlayHubOpen] = useState(false);
    const customLinks = useCustomLinksStore((state) => state.links);
    const customLinksRef = useRef<CustomLink[]>(customLinks);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem("videoVolume");
        return saved ? parseFloat(saved) : 0.5;
    });
    const [isMuted, setIsMuted] = useState(() => {
        return localStorage.getItem("videoMuted") === "true";
    });
    const [isPlaying, setIsPlaying] = useState(() => {
        return localStorage.getItem("youtubePaused") !== "true";
    });

    useEffect(() => {
        customLinksRef.current = customLinks;
    }, [customLinks]);

    const minimize = async () => await appWindow?.minimize();
    const close = async () => await appWindow?.close();

    useEffect(() => {
        let mounted = true;
        invoke<boolean>("is_overlay_hub_open")
            .then((isOpen) => {
                if (mounted) {
                    setIsOverlayHubOpen(Boolean(isOpen));
                }
            })
            .catch(console.error);

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent("videoVolumeChange", { detail: volume }));
        window.dispatchEvent(new CustomEvent("videoMuteChange", { detail: isMuted }));
    }, []);

    useEffect(() => {
        localStorage.setItem("videoVolume", volume.toString());
        window.dispatchEvent(new CustomEvent("videoVolumeChange", { detail: volume }));
    }, [volume]);

    const toggleMute = () => {
        const newMutedState = !isMuted;
        setIsMuted(newMutedState);
        localStorage.setItem("videoMuted", newMutedState.toString());
        window.dispatchEvent(new CustomEvent("videoMuteChange", { detail: newMutedState }));
    };

    const handlePreviousVideo = () => {
        window.dispatchEvent(new CustomEvent("youtubePrevious"));
    };

    const handleNextVideo = () => {
        window.dispatchEvent(new CustomEvent("youtubeNext"));
    };

    const togglePlayPause = () => {
        const newState = !isPlaying;
        setIsPlaying(newState);
        localStorage.setItem("youtubePaused", (!newState).toString());
        window.dispatchEvent(new CustomEvent("youtubePlayPause", { detail: newState }));
    };

    const syncCustomLinksToHub = useCallback(async () => {
        await emit(HUB_SYNC_EVENT, { links: customLinksRef.current }).catch(console.error);
    }, []);

    useEffect(() => {
        let unlistenRequest: (() => void) | undefined;

        const setup = async () => {
            unlistenRequest = await listen(HUB_REQUEST_EVENT, () => {
                syncCustomLinksToHub().catch(console.error);
            });
        };

        setup().catch(console.error);
        return () => {
            if (unlistenRequest) unlistenRequest();
        };
    }, [syncCustomLinksToHub]);

    useEffect(() => {
        if (!isOverlayHubOpen) return;
        syncCustomLinksToHub().catch(console.error);
    }, [isOverlayHubOpen, customLinks, syncCustomLinksToHub]);

    const openOverlayHub = async () => {
        const isOpen = await invoke<boolean>("toggle_overlay_hub").catch((error) => {
            console.error(error);
            return isOverlayHubOpen;
        });
        setIsOverlayHubOpen(Boolean(isOpen));

        if (isOpen) {
            syncCustomLinksToHub().catch(console.error);
            window.setTimeout(() => {
                syncCustomLinksToHub().catch(console.error);
            }, 180);
            window.setTimeout(() => {
                syncCustomLinksToHub().catch(console.error);
            }, 650);
        }
    };

    const containerClass = embedded
        ? "relative z-[120] flex items-center gap-1.5 pointer-events-auto"
        : "fixed right-6 top-4 z-[100] flex items-center gap-2 pointer-events-auto";

    const iconButtonClass =
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-all duration-200 hover:-translate-y-px hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.12)] hover:text-foreground";

    return (
        <div className={cn(containerClass, className)} data-no-drag>
            <div className="flex h-8 items-center rounded-lg border border-border/45 bg-background/45 px-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
                <ServerStatus />
            </div>

            <button
                onClick={openOverlayHub}
                className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-xl transition-all duration-200",
                    isOverlayHubOpen
                        ? "border-sky-500/70 bg-sky-500/30 text-sky-700 dark:border-sky-300/60 dark:bg-sky-500/22 dark:text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.25),0_0_14px_rgba(56,189,248,0.35)]"
                        : "border-border/45 bg-background/45 text-muted-foreground hover:-translate-y-px hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground",
                )}
                title={isOverlayHubOpen ? "Hub overlay actif" : "Hub overlay"}
                aria-label={isOverlayHubOpen ? "Hub overlay actif" : "Hub overlay"}
            >
                <PanelsTopLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1 rounded-lg border border-border/45 bg-background/45 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
                <button
                    onClick={handlePreviousVideo}
                    className={iconButtonClass}
                    title="Video precedente"
                    aria-label="Video precedente"
                >
                    <SkipBack className="h-3.5 w-3.5" />
                </button>

                <button
                    onClick={togglePlayPause}
                    className={iconButtonClass}
                    title={isPlaying ? "Pause" : "Lecture"}
                    aria-label={isPlaying ? "Pause" : "Lecture"}
                >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>

                <button
                    onClick={handleNextVideo}
                    className={iconButtonClass}
                    title="Video suivante"
                    aria-label="Video suivante"
                >
                    <SkipForward className="h-3.5 w-3.5" />
                </button>

                <div className="mx-1 h-4 w-px bg-border/50" />

                <button
                    onClick={toggleMute}
                    className={iconButtonClass}
                    title={isMuted ? "Activer le son" : "Couper le son"}
                    aria-label={isMuted ? "Activer le son" : "Couper le son"}
                >
                    {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>

                <Slider
                    value={[volume * 100]}
                    onValueChange={(value: number[]) => setVolume(value[0] / 100)}
                    max={100}
                    min={0}
                    step={1}
                    className="w-[88px]"
                    disabled={isMuted}
                />

                <span className="w-8 text-right text-[11px] font-medium text-muted-foreground">
                    {Math.round(volume * 100)}%
                </span>
            </div>

            <div className="flex items-center gap-1">
                <button
                    onClick={minimize}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/45 bg-background/45 text-muted-foreground transition-all duration-200 hover:-translate-y-px hover:border-yellow-400/55 hover:bg-yellow-500/18 hover:text-yellow-100"
                    title="Minimiser"
                    aria-label="Minimiser"
                >
                    <Minus strokeWidth={2} className="h-3.5 w-3.5" />
                </button>

                <button
                    onClick={close}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/45 bg-background/45 text-muted-foreground transition-all duration-200 hover:-translate-y-px hover:border-red-400/55 hover:bg-red-500/18 hover:text-red-100"
                    title="Fermer"
                    aria-label="Fermer"
                >
                    <X strokeWidth={2} className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
