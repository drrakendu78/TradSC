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
const HUB_COLLAPSED_WIDTH = 90;
const HUB_COLLAPSED_HEIGHT = 42;
const HUB_EXPANDED_HEIGHT = 88;
const HUB_CLOSE_ANIMATION_MS = 220;
const ITEM_STAGGER_MS = 18;
const GAME_UNLOCK_HOLD_MS = 1200;
const LOCK_REARM_DELAY_MS = 350;
const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";

interface OverlayClosedPayload {
    id: string;
    overlayType?: string;
    overlay_type?: string;
}

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
    const [menuVisible, setMenuVisible] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const [isGeometrySyncing, setIsGeometrySyncing] = useState(false);
    const [isUnlockHolding, setIsUnlockHolding] = useState(false);
    const [isLockRearming, setIsLockRearming] = useState(false);
    const [unlockHoldProgress, setUnlockHoldProgress] = useState(0);
    const [activeOverlayIds, setActiveOverlayIds] = useState<Set<string>>(new Set());
    const hubWindow = useMemo(() => getCurrentWindow(), []);
    const geometryRunIdRef = useRef(0);
    const unlockTimerRef = useRef<number | null>(null);
    const unlockProgressRafRef = useRef<number | null>(null);
    const unlockProgressStartRef = useRef<number | null>(null);
    const lockRearmTimerRef = useRef<number | null>(null);
    const collapseTimerRef = useRef<number | null>(null);
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
            if (lockRearmTimerRef.current !== null) {
                window.clearTimeout(lockRearmTimerRef.current);
                lockRearmTimerRef.current = null;
            }
            if (collapseTimerRef.current !== null) {
                window.clearTimeout(collapseTimerRef.current);
                collapseTimerRef.current = null;
            }
        };
    }, []);

    const clearCollapseTimer = () => {
        if (collapseTimerRef.current !== null) {
            window.clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = null;
        }
    };

    const openIntentRef = useRef(false);
    const openHub = () => {
        clearCollapseTimer();
        openIntentRef.current = true;
        if (!expanded) {
            setExpanded(true);
            return;
        }
        setMenuVisible(true);
    };

    useEffect(() => {
        if (expanded && !isGeometrySyncing && !menuVisible && openIntentRef.current) {
            openIntentRef.current = false;
            setMenuVisible(true);
        }
    }, [expanded, isGeometrySyncing, menuVisible]);

    const closeHub = () => {
        openIntentRef.current = false;
        setMenuVisible(false);
        clearCollapseTimer();
        collapseTimerRef.current = window.setTimeout(() => {
            collapseTimerRef.current = null;
            setExpanded(false);
        }, HUB_CLOSE_ANIMATION_MS);
    };

    const startLockRearmDelay = () => {
        if (lockRearmTimerRef.current !== null) {
            window.clearTimeout(lockRearmTimerRef.current);
            lockRearmTimerRef.current = null;
        }
        setIsLockRearming(true);
        lockRearmTimerRef.current = window.setTimeout(() => {
            lockRearmTimerRef.current = null;
            setIsLockRearming(false);
        }, LOCK_REARM_DELAY_MS);
    };

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
        let cancelled = false;
        let unlistenClosed: (() => void) | undefined;

        const refreshActiveOverlays = async () => {
            const entries = await Promise.all(
                items.map(async (item) => {
                    const isOpen = await invoke<boolean>("is_overlay_open", {
                        id: item.id,
                        overlayType: item.kind,
                    }).catch(() => false);
                    return [item.id, Boolean(isOpen)] as const;
                })
            );

            if (cancelled) return;
            const next = new Set<string>();
            entries.forEach(([id, isOpen]) => {
                if (isOpen) next.add(id);
            });
            setActiveOverlayIds(next);
        };

        const setup = async () => {
            unlistenClosed = await listen<OverlayClosedPayload>("overlay_closed", (event) => {
                const closedId = event.payload?.id;
                if (!closedId) return;
                setActiveOverlayIds((previous) => {
                    if (!previous.has(closedId)) return previous;
                    const next = new Set(previous);
                    next.delete(closedId);
                    return next;
                });
            });
        };

        refreshActiveOverlays().catch(console.error);
        setup().catch(console.error);

        return () => {
            cancelled = true;
            if (unlistenClosed) unlistenClosed();
        };
    }, [items]);

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
        const isActive = activeOverlayIds.has(item.id);
        try {
            if (isActive) {
                if (item.kind === "webview") {
                    await invoke("close_webview_overlay", { id: item.id });
                } else {
                    await invoke("close_overlay", { id: item.id });
                }

                setActiveOverlayIds((previous) => {
                    if (!previous.has(item.id)) return previous;
                    const next = new Set(previous);
                    next.delete(item.id);
                    return next;
                });
                return;
            }

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

            setActiveOverlayIds((previous) => {
                if (previous.has(item.id)) return previous;
                const next = new Set(previous);
                next.add(item.id);
                return next;
            });
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: isActive
                    ? `Impossible de fermer ${item.label}.`
                    : `Impossible d'ouvrir ${item.label} en overlay.`,
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
            closeHub();
        }
        if (Boolean(appliedMode) !== previousMode) {
            startLockRearmDelay();
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
                openHub();
            }
        }, GAME_UNLOCK_HOLD_MS);
    };

    const handleHubButtonClick = async () => {
        if (!isEditMode) {
            return;
        }

        if (menuVisible) {
            closeHub();
            return;
        }
        openHub();
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

    const unlockRingRadius = 10;
    const unlockRingCircumference = 2 * Math.PI * unlockRingRadius;
    const unlockRingOffset = unlockRingCircumference * (1 - unlockHoldProgress);
    const unlockRemainingSeconds = Math.max(0, (GAME_UNLOCK_HOLD_MS * (1 - unlockHoldProgress)) / 1000);
    const lockButtonDisabled = isLockRearming;

    return (
        <div className="w-full h-full bg-transparent pointer-events-none overflow-visible flex items-start justify-center">
            <div className="pt-0 flex flex-col items-center pointer-events-none w-full">
                <div
                    className="relative pointer-events-auto w-max max-w-full overflow-hidden bg-slate-950/35 backdrop-blur-md ring-1 ring-white/5 px-2 py-1"
                    style={{ borderRadius: "9999px", isolation: "isolate" }}
                >
                    <div className="w-max mx-auto flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={handleHubButtonClick}
                        disabled={!isEditMode || isGeometrySyncing}
                        title={
                            isGeometrySyncing
                                ? "Synchronisation du hub..."
                                : !isEditMode
                                ? "Mode jeu actif - bouton hub desactive"
                                : menuVisible
                                  ? "Replier hub overlay"
                                  : "Ouvrir hub overlay"
                        }
                        className={`relative overflow-visible h-7 w-7 rounded-full border border-sky-300/50 bg-sky-500/15 text-sky-100 backdrop-blur-md shadow-sm transition-all flex items-center justify-center disabled:pointer-events-none ${
                            isEditMode ? "opacity-100 hover:border-sky-200/70 hover:bg-sky-500/25" : "opacity-55"
                        }`}
                    >
                        <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute -inset-1 rounded-full blur-[5px] transition-opacity ${
                                isEditMode ? "bg-sky-400/35 opacity-90" : "bg-sky-300/20 opacity-70"
                            }`}
                        />
                        <PanelsTopLeft className="relative z-10 h-3.5 w-3.5" />
                    </button>

                    <button
                        type="button"
                        disabled={lockButtonDisabled}
                        onClick={() => {
                            if (lockButtonDisabled) return;
                            if (isEditMode) {
                                setHubMode(false).catch(console.error);
                            }
                        }}
                        onMouseDown={(event) => {
                            if (lockButtonDisabled) return;
                            event.preventDefault();
                            startUnlockHold();
                        }}
                        onMouseUp={clearUnlockHold}
                        onMouseLeave={clearUnlockHold}
                        onTouchStart={(event) => {
                            if (lockButtonDisabled) return;
                            event.preventDefault();
                            startUnlockHold();
                        }}
                        onTouchEnd={clearUnlockHold}
                        onTouchCancel={clearUnlockHold}
                        className={`relative overflow-visible h-7 w-7 rounded-full border backdrop-blur-md shadow-sm transition-all flex items-center justify-center ${
                            isEditMode
                                ? "border-sky-300/50 bg-sky-500/15 text-sky-100 hover:border-sky-200/70 hover:bg-sky-500/25"
                                : "border-amber-300/50 bg-amber-500/15 text-amber-100 hover:border-amber-200/70 hover:bg-amber-500/25"
                        } ${lockButtonDisabled ? "opacity-75 cursor-default" : ""}`}
                        title={
                            lockButtonDisabled
                                ? "Reactivation du cadenas..."
                                : isEditMode
                                  ? "Passer en mode jeu"
                                  : "Mode jeu actif - maintenir 1.2s pour mode edit"
                        }
                    >
                        <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute -inset-1 rounded-full blur-[5px] transition-opacity ${
                                isEditMode ? "bg-sky-400/35 opacity-90" : "bg-amber-300/35 opacity-90"
                            }`}
                        />
                        {!isEditMode && (
                            <svg
                                viewBox="0 0 24 24"
                                className="pointer-events-none absolute inset-0 z-[1] h-full w-full -rotate-90"
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
                                className="relative z-10 h-3.5 w-3.5"
                                aria-hidden="true"
                            >
                                <rect x="5" y="11" width="14" height="10" rx="2" />
                                <path d="M9 11V8a3.5 3.5 0 0 1 6-1.8" />
                            </svg>
                        ) : (
                            <Lock className="relative z-10 h-3.5 w-3.5" />
                        )}
                    </button>
                    </div>

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
                        menuVisible
                            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
                            : "opacity-0 -translate-y-1 scale-[0.98] pointer-events-none"
                    }`}
                >
                    <div
                        ref={itemsScrollerRef}
                        onWheel={handleItemsWheel}
                        className="w-full max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-slate-950/35 backdrop-blur-md ring-1 ring-white/5 px-2 py-1"
                        style={{ borderRadius: "9999px", isolation: "isolate" }}
                    >
                        <div className="w-max mx-auto flex items-center gap-1.5">
                            {items.map((item, index) => {
                                const isActive = activeOverlayIds.has(item.id);
                                return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => openOverlayItem(item)}
                                    className={`h-7 px-2.5 rounded-full border backdrop-blur-md shadow-sm transition-all duration-200 ease-out flex items-center gap-1.5 whitespace-nowrap ${
                                        isActive
                                            ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-100 hover:border-emerald-200/70 hover:bg-emerald-500/25"
                                            : "border-sky-300/40 bg-sky-500/10 text-sky-100 hover:border-sky-200/60 hover:bg-sky-500/20"
                                    } ${
                                        menuVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                                    }`}
                                    style={{ transitionDelay: menuVisible ? `${index * ITEM_STAGGER_MS}ms` : "0ms" }}
                                    title={isActive ? `${item.label} actif (clic = fermer)` : `Ouvrir ${item.label} en overlay`}
                                >
                                    <span className={`h-4 w-4 rounded-full flex items-center justify-center ${isActive ? "bg-emerald-400/25 text-emerald-100" : "bg-sky-400/20 text-sky-100"}`}>
                                        {renderItemIcon(item)}
                                    </span>
                                    <span className="text-[10px] font-semibold tracking-[0.03em] uppercase">{getItemLabel(item)}</span>
                                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />}
                                </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverlayHub;
