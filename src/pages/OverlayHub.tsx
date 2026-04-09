import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import {
    BookOpen,
    Calculator,
    Database,
    Hammer,
    Lock,
    Link2,
    Map,
    Package,
    PanelsTopLeft,
    Route,
    Search,
    Swords,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCustomLinksStore, type CustomLink } from "@/stores/custom-links-store";
import { getOverlayHubItems } from "@/utils/overlay-hub-registry";
import type { OverlayHubItem } from "@/types/overlay-hub";

const HUB_TOP_OFFSET = 10;
const HUB_COLLAPSED_WIDTH = 74;
const HUB_COLLAPSED_HEIGHT = 34;
const HUB_EXPANDED_HEIGHT = 74;
const ITEM_STAGGER_MS = 18;
const GAME_UNLOCK_HOLD_MS = 1200;
const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";

function sanitizeCustomLinks(payload: unknown): CustomLink[] {
    if (!Array.isArray(payload)) return [];

    const normalized: CustomLink[] = [];

    payload.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;

        const raw = entry as Record<string, unknown>;
        const id = String(raw.id ?? `legacy_${index}`).trim() || `legacy_${index}`;
        const name = String(raw.name ?? "").trim();
        const url = String(raw.url ?? "").trim();
        if (!url) return;

        const iconValue = raw.icon;
        const icon = typeof iconValue === "string" ? iconValue.trim() : "";

        const link: CustomLink = {
            id,
            name,
            url,
        };

        if (icon) {
            link.icon = icon;
        }

        normalized.push(link);
    });

    return normalized;
}

const OverlayHub = () => {
    const [expanded, setExpanded] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const [isGeometrySyncing, setIsGeometrySyncing] = useState(false);
    const [isUnlockHolding, setIsUnlockHolding] = useState(false);
    const [unlockHoldProgress, setUnlockHoldProgress] = useState(0);
    const hubWindow = useMemo(() => getCurrentWindow(), []);
    const geometryRunIdRef = useRef(0);
    const unlockTimerRef = useRef<number | null>(null);
    const unlockProgressRafRef = useRef<number | null>(null);
    const unlockProgressStartRef = useRef<number | null>(null);
    const itemsScrollerRef = useRef<HTMLDivElement | null>(null);
    const customLinks = useCustomLinksStore((state) => state.links);
    const setCustomLinks = useCustomLinksStore((state) => state.setLinks);
    const { toast } = useToast();

    const baseAppUrl = `${window.location.origin}${window.location.pathname}`;
    const items = useMemo(() => getOverlayHubItems(customLinks, baseAppUrl), [customLinks, baseAppUrl]);
    const slots = items.length;
    const maxExpandedWidth = useMemo(() => {
        if (typeof window === "undefined") return 1120;
        const screenWidth = window.screen?.availWidth ?? window.innerWidth ?? 1120;
        return Math.max(360, screenWidth - 40);
    }, []);
    const expandedWidth = useMemo(
        () => Math.min(maxExpandedWidth, Math.max(360, slots * 92 + 20)),
        [slots, maxExpandedWidth]
    );
    const expandedHeight = HUB_EXPANDED_HEIGHT;

    useEffect(() => {
        let mounted = true;
        invoke<boolean>("get_overlay_hub_mode")
            .then((mode) => {
                if (mounted) {
                    setIsEditMode(Boolean(mode));
                }
            })
            .catch(console.error);

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        const root = document.getElementById("root");
        if (root) root.style.background = "transparent";

        const style = document.createElement("style");
        style.id = "overlay-hub-transparent-style";
        style.textContent = "#root::before { display: none !important; }";
        document.head.appendChild(style);

        return () => {
            document.documentElement.style.background = "";
            document.body.style.background = "";
            if (root) root.style.background = "";
            style.remove();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (unlockTimerRef.current !== null) {
                window.clearTimeout(unlockTimerRef.current);
                unlockTimerRef.current = null;
            }
            if (unlockProgressRafRef.current !== null) {
                window.cancelAnimationFrame(unlockProgressRafRef.current);
                unlockProgressRafRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        let unlistenSync: (() => void) | undefined;

        const setupSync = async () => {
            unlistenSync = await listen<{ links?: unknown }>(HUB_SYNC_EVENT, (event) => {
                const incoming = sanitizeCustomLinks(event.payload?.links);
                setCustomLinks(incoming);
            });

            await emit(HUB_REQUEST_EVENT).catch(console.error);
            window.setTimeout(() => {
                emit(HUB_REQUEST_EVENT).catch(console.error);
            }, 220);
        };

        setupSync().catch(console.error);
        return () => {
            if (unlistenSync) unlistenSync();
        };
    }, [setCustomLinks]);

    useEffect(() => {
        if (!expanded) return;
        const scroller = itemsScrollerRef.current;
        if (!scroller) return;
        scroller.scrollLeft = 0;
    }, [expanded, items.length]);

    useEffect(() => {
        const runId = ++geometryRunIdRef.current;
        const syncWindowGeometry = async () => {
            const width = expanded ? expandedWidth : HUB_COLLAPSED_WIDTH;
            const height = expanded ? expandedHeight : HUB_COLLAPSED_HEIGHT;

            setIsGeometrySyncing(true);

            const monitor = await currentMonitor().catch(() => null);
            if (runId !== geometryRunIdRef.current) return;

            let targetPos: PhysicalPosition | null = null;
            if (monitor) {
                targetPos = new PhysicalPosition(
                    Math.round(monitor.position.x + (monitor.size.width - width) / 2),
                    Math.round(monitor.position.y + HUB_TOP_OFFSET)
                );
            } else {
                const currentPos = await hubWindow.outerPosition().catch(() => null);
                if (runId !== geometryRunIdRef.current) return;
                if (currentPos) {
                    targetPos = new PhysicalPosition(currentPos.x, Math.max(0, currentPos.y));
                }
            }

            await hubWindow.setSize(new PhysicalSize(width, height));
            if (runId !== geometryRunIdRef.current) return;

            if (targetPos) {
                await hubWindow.setPosition(targetPos);
            }
        };

        syncWindowGeometry()
            .catch(console.error)
            .finally(() => {
                if (runId === geometryRunIdRef.current) {
                    setIsGeometrySyncing(false);
                }
            });
    }, [expanded, expandedWidth, expandedHeight, hubWindow]);

    const openOverlayItem = async (item: OverlayHubItem) => {
        try {
            if (item.kind === "webview") {
                await invoke("open_webview_overlay", {
                    id: item.id,
                    url: item.url,
                    width: item.width,
                    height: item.height,
                    opacity: item.opacity,
                });
            } else {
                await invoke("open_overlay", {
                    id: item.id,
                    url: item.url,
                    x: 100.0,
                    y: 100.0,
                    width: item.width,
                    height: item.height,
                    opacity: item.opacity,
                });
            }

            setExpanded(false);
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: `Impossible d'ouvrir ${item.label} en overlay.`,
                variant: "destructive",
            });
        }
    };

    const setHubMode = async (nextEditMode: boolean) => {
        const previousMode = isEditMode;
        const appliedMode = await invoke<boolean>("set_overlay_hub_mode", {
            editMode: nextEditMode,
        }).catch((error) => {
            console.error(error);
            return previousMode;
        });

        setIsEditMode(Boolean(appliedMode));
        if (!appliedMode) {
            setExpanded(false);
        }
        return Boolean(appliedMode);
    };

    const clearUnlockHold = () => {
        if (unlockTimerRef.current !== null) {
            window.clearTimeout(unlockTimerRef.current);
            unlockTimerRef.current = null;
        }
        if (unlockProgressRafRef.current !== null) {
            window.cancelAnimationFrame(unlockProgressRafRef.current);
            unlockProgressRafRef.current = null;
        }
        unlockProgressStartRef.current = null;
        setUnlockHoldProgress(0);
        setIsUnlockHolding(false);
    };

    const startUnlockHold = () => {
        if (isEditMode) return;
        clearUnlockHold();
        setIsUnlockHolding(true);

        unlockProgressStartRef.current = performance.now();
        const animateProgress = () => {
            if (unlockProgressStartRef.current === null) return;

            const elapsed = performance.now() - unlockProgressStartRef.current;
            const progress = Math.min(1, elapsed / GAME_UNLOCK_HOLD_MS);
            setUnlockHoldProgress(progress);

            if (progress < 1) {
                unlockProgressRafRef.current = window.requestAnimationFrame(animateProgress);
            } else {
                unlockProgressRafRef.current = null;
            }
        };
        unlockProgressRafRef.current = window.requestAnimationFrame(animateProgress);

        unlockTimerRef.current = window.setTimeout(async () => {
            unlockTimerRef.current = null;
            setIsUnlockHolding(false);
            if (unlockProgressRafRef.current !== null) {
                window.cancelAnimationFrame(unlockProgressRafRef.current);
                unlockProgressRafRef.current = null;
            }
            unlockProgressStartRef.current = null;
            setUnlockHoldProgress(0);
            const restored = await setHubMode(true);
            if (restored) {
                setExpanded(true);
            }
        }, GAME_UNLOCK_HOLD_MS);
    };

    const handleHubButtonClick = async () => {
        if (!isEditMode) {
            return;
        }

        setExpanded((previous) => !previous);
    };

    const handleItemsWheel = (event: WheelEvent<HTMLDivElement>) => {
        const scroller = itemsScrollerRef.current;
        if (!scroller) return;

        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            scroller.scrollLeft += event.deltaY;
            event.preventDefault();
        }
    };

    const renderItemIcon = (item: OverlayHubItem) => {
        if (item.source === "custom") {
            return (
                <span className="text-[10px] font-bold leading-none">
                    {item.label.slice(0, 1).toUpperCase()}
                </span>
            );
        }

        switch (item.iconKey) {
            case "dps":
                return <Calculator className="h-3.5 w-3.5" />;
            case "shipmaps":
                return <Map className="h-3.5 w-3.5" />;
            case "finder":
                return <Search className="h-3.5 w-3.5" />;
            case "pvp":
                return <Swords className="h-3.5 w-3.5" />;
            case "cargo":
                return <Package className="h-3.5 w-3.5" />;
            case "verseguide":
                return <BookOpen className="h-3.5 w-3.5" />;
            case "scmdb":
                return <Database className="h-3.5 w-3.5" />;
            case "crafter":
                return <Hammer className="h-3.5 w-3.5" />;
            case "trading":
                return <Route className="h-3.5 w-3.5" />;
            default:
                return <Link2 className="h-3.5 w-3.5" />;
        }
    };

    const getItemLabel = (item: OverlayHubItem) => {
        switch (item.id) {
            case "erkul":
                return "DPS";
            case "finder":
                return "Finder";
            case "pvp":
                return "PVP";
            case "uexcorp":
                return "Routes";
            default:
                return item.label;
        }
    };

    const unlockRingRadius = 9;
    const unlockRingCircumference = 2 * Math.PI * unlockRingRadius;
    const unlockRingOffset = unlockRingCircumference * (1 - unlockHoldProgress);
    const unlockRemainingSeconds = Math.max(0, (GAME_UNLOCK_HOLD_MS * (1 - unlockHoldProgress)) / 1000);

    return (
        <div className="w-full h-full bg-transparent pointer-events-none overflow-visible flex items-start justify-center">
            <div className="pt-1 flex flex-col items-center pointer-events-none w-full">
                <div
                    className={`relative pointer-events-auto flex items-center gap-1 transition-opacity ${
                        isGeometrySyncing ? "opacity-0" : "opacity-100"
                    }`}
                >
                    <button
                        type="button"
                        onClick={handleHubButtonClick}
                        disabled={!isEditMode}
                        title={
                            !isEditMode
                                ? "Mode jeu actif - bouton hub desactive"
                                : expanded
                                  ? "Replier hub overlay"
                                  : "Ouvrir hub overlay"
                        }
                        className={`h-6 w-6 rounded-full border border-sky-300/45 bg-[linear-gradient(180deg,rgba(22,38,56,0.84),rgba(13,24,36,0.84))] text-sky-100 shadow-[inset_0_1px_0_rgba(148,197,255,0.18),0_0_6px_rgba(56,189,248,0.2),0_1px_3px_rgba(0,0,0,0.4)] transition-all flex items-center justify-center disabled:pointer-events-none ${
                            isEditMode ? "opacity-100 hover:bg-[linear-gradient(180deg,rgba(29,49,71,0.9),rgba(18,31,46,0.9))]" : "opacity-30"
                        }`}
                    >
                        <PanelsTopLeft className="h-3 w-3" />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            if (isEditMode) {
                                setHubMode(false).catch(console.error);
                            }
                        }}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            startUnlockHold();
                        }}
                        onMouseUp={clearUnlockHold}
                        onMouseLeave={clearUnlockHold}
                        onTouchStart={(event) => {
                            event.preventDefault();
                            startUnlockHold();
                        }}
                        onTouchEnd={clearUnlockHold}
                        onTouchCancel={clearUnlockHold}
                        className={`relative h-6 w-6 rounded-full border flex items-center justify-center ${
                            isEditMode
                                ? "border-sky-300/45 bg-[linear-gradient(180deg,rgba(22,38,56,0.84),rgba(13,24,36,0.84))] text-sky-100"
                                : "border-amber-300/50 bg-[linear-gradient(180deg,rgba(72,54,25,0.9),rgba(45,35,16,0.9))] text-amber-100"
                        } ${
                            isUnlockHolding
                                ? "shadow-[inset_0_1px_0_rgba(148,197,255,0.16),0_0_6px_rgba(14,165,233,0.16),0_1px_3px_rgba(0,0,0,0.35)]"
                                : "shadow-[inset_0_1px_0_rgba(148,197,255,0.16),0_0_6px_rgba(14,165,233,0.16),0_1px_3px_rgba(0,0,0,0.35)]"
                        }`}
                        title={isEditMode ? "Passer en mode jeu" : "Mode jeu actif - maintenir 1.2s pour mode edit"}
                    >
                        {!isEditMode && (
                            <svg
                                viewBox="0 0 24 24"
                                className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
                                aria-hidden="true"
                            >
                                <circle
                                    cx="12"
                                    cy="12"
                                    r={unlockRingRadius}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeOpacity="0.2"
                                    strokeWidth="1.6"
                                />
                                <circle
                                    cx="12"
                                    cy="12"
                                    r={unlockRingRadius}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeDasharray={unlockRingCircumference}
                                    strokeDashoffset={unlockRingOffset}
                                    className="transition-[stroke-dashoffset] duration-75 ease-linear"
                                />
                            </svg>
                        )}

                        {isEditMode ? (
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3"
                                aria-hidden="true"
                            >
                                <rect x="5" y="11" width="14" height="10" rx="2" />
                                <path d="M9 11V8a3.5 3.5 0 0 1 6-1.8" />
                            </svg>
                        ) : (
                            <Lock className="h-3 w-3" />
                        )}
                    </button>

                    {!isEditMode && (
                        <div
                            className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full border border-amber-300/40 bg-black/60 px-2 py-0.5 text-[9px] font-medium tracking-[0.02em] text-amber-100 backdrop-blur transition-opacity ${
                                isUnlockHolding ? "opacity-100" : "opacity-0"
                            }`}
                        >
                            Maintenir {unlockRemainingSeconds.toFixed(1)}s
                        </div>
                    )}
                </div>

                <div
                    className={`mt-1 flex flex-col items-center origin-top transition-all duration-200 ease-out ${
                        expanded
                            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
                            : "opacity-0 -translate-y-1 scale-[0.98] pointer-events-none"
                    }`}
                >
                    <div
                        ref={itemsScrollerRef}
                        onWheel={handleItemsWheel}
                        className="w-full max-w-full overflow-x-auto px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    >
                        <div className="w-max mx-auto flex items-center gap-1.5">
                            {items.map((item, index) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => openOverlayItem(item)}
                                    className={`h-7 px-2.5 rounded-full border border-sky-300/35 bg-black/50 text-slate-100 transition-all duration-200 ease-out flex items-center gap-1.5 whitespace-nowrap backdrop-blur-md shadow-[inset_0_1px_0_rgba(148,197,255,0.2),0_0_8px_rgba(14,165,233,0.2)] hover:border-sky-200/55 hover:bg-black/62 hover:shadow-[inset_0_1px_0_rgba(186,230,253,0.25),0_0_12px_rgba(56,189,248,0.28)] ${
                                        expanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                                    }`}
                                    style={{ transitionDelay: expanded ? `${index * ITEM_STAGGER_MS}ms` : "0ms" }}
                                    title={`Ouvrir ${item.label} en overlay`}
                                >
                                    <span className="h-4 w-4 rounded-full bg-sky-300/18 text-sky-100 flex items-center justify-center">
                                        {renderItemIcon(item)}
                                    </span>
                                    <span className="text-[10px] font-semibold tracking-[0.03em] uppercase">{getItemLabel(item)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverlayHub;
