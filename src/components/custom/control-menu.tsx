import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import QRCode from "qrcode";
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
    Smartphone,
    RefreshCw,
    Copy,
    Check,
    Wifi,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import ServerStatus from "@/components/custom/server-status";
import { useCustomLinksStore, type CustomLink } from "@/stores/custom-links-store";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";
const COMPANION_ENABLED_KEY = "companionServerEnabled";
const COMPANION_QR_OPTIONS = {
    margin: 1,
    width: 340,
    color: { dark: "#0f172a", light: "#ffffff" },
};

function setCompanionEnabledState(next: boolean) {
    localStorage.setItem(COMPANION_ENABLED_KEY, String(next));
    window.dispatchEvent(
        new CustomEvent("companion-enabled-changed", {
            detail: { enabled: next },
        })
    );
}

async function buildCompanionQrDataUrl(url: string | null) {
    if (!url) return null;
    try {
        return await QRCode.toDataURL(url, COMPANION_QR_OPTIONS);
    } catch {
        return null;
    }
}

type ControlMenuProps = {
    embedded?: boolean;
    className?: string;
};

type CompanionInfo = {
    url: string | null;
    ip: string | null;
    port: number;
    token: string;
    running: boolean;
    clients: number;
    persistentToken: boolean;
};

const DEFAULT_PORT = 47823;

export default function ControlMenu({ embedded = false, className }: ControlMenuProps) {
    const appWindow = getCurrentWindow();
    const { toast } = useToast();
    const [isOverlayHubOpen, setIsOverlayHubOpen] = useState(false);
    const [isCompanionDialogOpen, setIsCompanionDialogOpen] = useState(false);
    const [companionInfo, setCompanionInfo] = useState<CompanionInfo | null>(null);
    const [companionQrDataUrl, setCompanionQrDataUrl] = useState<string | null>(null);
    const [companionLoading, setCompanionLoading] = useState(false);
    const [companionCopied, setCompanionCopied] = useState(false);
    const [companionTokenBusy, setCompanionTokenBusy] = useState(false);
    const customLinks = useCustomLinksStore((state) => state.links);
    const customLinksRef = useRef<CustomLink[]>(customLinks);
    const [volume, setVolume] = useState(() => {
        // Migration one-shot v4.0.4 : on baisse le défaut historique de 50 %
        // à 10 % pour les utilisateurs existants qui n'ont jamais touché au
        // slider. Le flag empêche l'override de se rejouer aux relances.
        const MIGRATION_KEY = "videoVolumeMigrated_v404";
        if (!localStorage.getItem(MIGRATION_KEY)) {
            localStorage.setItem("videoVolume", "0.1");
            localStorage.setItem(MIGRATION_KEY, "true");
            // Notifie le BackgroundVideo player de prendre le nouveau volume.
            window.dispatchEvent(new CustomEvent("videoVolumeChange", { detail: 0.1 }));
            return 0.1;
        }
        const saved = localStorage.getItem("videoVolume");
        return saved ? parseFloat(saved) : 0.1;
    });
    const [isMuted, setIsMuted] = useState(() => {
        return localStorage.getItem("videoMuted") === "true";
    });
    const [isPlaying, setIsPlaying] = useState(() => {
        return localStorage.getItem("youtubePaused") !== "true";
    });

    const applyCompanionInfo = useCallback(async (next: CompanionInfo) => {
        setCompanionInfo(next);
        setCompanionQrDataUrl(await buildCompanionQrDataUrl(next.url));
    }, []);

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

    const refreshCompanionInfo = useCallback(async () => {
        setCompanionLoading(true);
        try {
            const next = await invoke<CompanionInfo>("get_companion_info");
            await applyCompanionInfo(next);
        } catch (error) {
            console.error(error);
            toast({
                title: "Companion indisponible",
                description: `${error}`,
                variant: "destructive",
            });
        } finally {
            setCompanionLoading(false);
        }
    }, [applyCompanionInfo, toast]);

    const openCompanionDialog = useCallback(async () => {
        setIsCompanionDialogOpen(true);
        await refreshCompanionInfo();
    }, [refreshCompanionInfo]);

    const startCompanionServer = useCallback(async () => {
        setCompanionLoading(true);
        try {
            await invoke<CompanionInfo>("start_companion_server", { port: DEFAULT_PORT });
            setCompanionEnabledState(true);
            await refreshCompanionInfo();
            toast({
                title: "Companion actif",
                description: "Scanne le QR code depuis ton telephone.",
            });
        } catch (error) {
            setCompanionEnabledState(false);
            toast({
                title: "Impossible de demarrer",
                description: `${error}`,
                variant: "destructive",
            });
        } finally {
            setCompanionLoading(false);
        }
    }, [refreshCompanionInfo, toast]);

    const copyCompanionUrl = useCallback(async () => {
        if (!companionInfo?.url) return;
        try {
            await navigator.clipboard.writeText(companionInfo.url);
            setCompanionCopied(true);
            setTimeout(() => setCompanionCopied(false), 1500);
        } catch {
            /* ignore */
        }
    }, [companionInfo?.url]);

    const togglePersistentCompanionToken = useCallback(async (next: boolean) => {
        setCompanionTokenBusy(true);
        try {
            const updated = await invoke<CompanionInfo>("set_companion_persistent_token", { enabled: next });
            await applyCompanionInfo(updated);

            toast({
                title: next ? "QR code conserve" : "QR code renouvele",
                description: next
                    ? "Le meme lien restera valide entre les redemarrages."
                    : "Un nouveau lien sera genere pour les prochains demarrages.",
            });
        } catch (error) {
            toast({
                title: "Impossible de changer le lien",
                description: `${error}`,
                variant: "destructive",
            });
        } finally {
            setCompanionTokenBusy(false);
        }
    }, [applyCompanionInfo, toast]);

    useEffect(() => {
        const syncCompanionState = async () => {
            try {
                const next = await invoke<CompanionInfo>("get_companion_info");
                await applyCompanionInfo(next);
            } catch (error) {
                console.error(error);
            }
        };

        let connectUnlisten: (() => void) | undefined;
        let disconnectUnlisten: (() => void) | undefined;

        syncCompanionState().catch(console.error);

        const setup = async () => {
            connectUnlisten = await listen("companion:client_connected", () => {
                syncCompanionState().catch(console.error);
            });
            disconnectUnlisten = await listen("companion:client_disconnected", () => {
                syncCompanionState().catch(console.error);
            });
        };

        const handleEnabledChange = () => {
            syncCompanionState().catch(console.error);
        };

        window.addEventListener("companion-enabled-changed", handleEnabledChange);
        window.addEventListener("focus", handleEnabledChange);
        setup().catch(console.error);

        return () => {
            connectUnlisten?.();
            disconnectUnlisten?.();
            window.removeEventListener("companion-enabled-changed", handleEnabledChange);
            window.removeEventListener("focus", handleEnabledChange);
        };
    }, [applyCompanionInfo]);

    const containerClass = embedded
        ? "relative z-[120] flex items-center gap-1.5 pointer-events-auto"
        : "fixed right-6 top-4 z-[100] flex items-center gap-2 pointer-events-auto";

    const iconButtonClass =
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-all duration-200 hover:-translate-y-px hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.12)] hover:text-foreground";
    const isCompanionRunning = Boolean(companionInfo?.running);

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

            <button
                onClick={openCompanionDialog}
                className={cn(
                    "relative inline-flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-xl transition-all duration-200",
                    isCompanionRunning
                        ? "border-emerald-400/55 bg-emerald-500/18 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_0_14px_rgba(16,185,129,0.28)]"
                        : "border-border/45 bg-background/45 text-muted-foreground hover:-translate-y-px hover:border-sky-400/45 hover:bg-sky-500/12 hover:text-sky-100",
                )}
                title={isCompanionRunning ? "Companion actif" : "Companion QR"}
                aria-label={isCompanionRunning ? "Companion actif" : "Companion QR"}
            >
                <span
                    className={cn(
                        "absolute right-1 top-1 h-2 w-2 rounded-full transition-all",
                        isCompanionRunning
                            ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]"
                            : "bg-white/18"
                    )}
                />
                <Smartphone className="h-4 w-4" />
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

            <Dialog open={isCompanionDialogOpen} onOpenChange={setIsCompanionDialogOpen}>
                <DialogContent
                    overlayClassName="bg-black/18 backdrop-blur-sm"
                    className="max-w-lg border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                >
                    <DialogHeader>
                        <DialogTitle>Companion LAN</DialogTitle>
                        <DialogDescription>
                            Ouvre le companion sur ton telephone avec le QR code.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3 rounded-xl border border-border/45 bg-background/45 p-4">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-foreground">Garder ce QR code</div>
                                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                        Garde le meme lien Companion entre les redemarrages pour eviter de rescanner.
                                    </p>
                                </div>
                                <Switch
                                    checked={Boolean(companionInfo?.persistentToken)}
                                    onCheckedChange={togglePersistentCompanionToken}
                                    disabled={companionTokenBusy}
                                />
                            </div>
                            {companionInfo?.running && companionInfo.url ? (
                                <>
                                    <div className="flex flex-col gap-4 items-stretch">
                                        <div className="flex-none rounded-xl bg-white p-2 self-center">
                                            {companionQrDataUrl ? (
                                                <img
                                                    src={companionQrDataUrl}
                                                    alt="QR code companion"
                                                    width={160}
                                                    height={160}
                                                    className="block rounded-md"
                                                />
                                            ) : (
                                                <div className="h-40 w-40 flex items-center justify-center text-[10px] text-slate-500">
                                                    QR...
                                                </div>
                                            )}
                                        </div>

                                        <div className="min-w-0 flex flex-col gap-2">
                                            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                                Adresse du companion
                                            </div>
                                            <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 ring-1 ring-white/5 px-3 py-2 min-w-0">
                                                <Wifi className="h-3.5 w-3.5 text-sky-400 flex-none" strokeWidth={1.5} />
                                                <code className="text-[11px] font-mono text-slate-200 truncate">
                                                    {companionInfo.url}
                                                </code>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="ml-auto h-7 px-2"
                                                    onClick={copyCompanionUrl}
                                                >
                                                    {companionCopied ? (
                                                        <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                                                    ) : (
                                                        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                                                    )}
                                                </Button>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                Scanne le QR avec l'appareil photo de ton téléphone. Les overlays et la
                                                traduction se mettent à jour en direct. Si tu ne vois pas le téléphone se
                                                connecter, vérifie que ton PC autorise le port {companionInfo.port} (pare-feu
                                                Windows).
                                            </p>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-xl border border-border/45 bg-background/45 p-4 text-sm text-muted-foreground">
                                    Le companion n est pas demarre. Lance-le pour afficher le QR code.
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-9"
                                    onClick={refreshCompanionInfo}
                                    disabled={companionLoading}
                                >
                                    <RefreshCw className={cn("mr-2 h-3.5 w-3.5", companionLoading && "animate-spin")} />
                                    Rafraichir
                            </Button>
                                {!companionInfo?.running && (
                                    <Button
                                        type="button"
                                        className="h-9"
                                        onClick={startCompanionServer}
                                        disabled={companionLoading}
                                    >
                                        Demarrer
                                    </Button>
                                )}
                            </div>
                        </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
