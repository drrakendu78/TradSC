import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize, type PhysicalPosition } from "@tauri-apps/api/window";
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
const HUB_SIZE_BUFFER = 4;
const HUB_CLOSE_ANIMATION_MS = 220;
const ITEM_STAGGER_MS = 18;
const GAME_UNLOCK_HOLD_MS = 1200;
const LOCK_REARM_DELAY_MS = 350;
const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";
const HUB_POSITION_STORAGE_KEY = "overlay_hub_position_v1";
const HUB_PRESET_STORAGE_KEY = "overlay_hub_preset_v1";
const HUB_PRESET_EVENT = "overlay_hub_preset_change";

type HubPreset =
    | "free"
    | "top"
    | "top-left"
    | "top-right"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right";

const HUB_EDGE_MARGIN = 10;

function isHubPreset(value: unknown): value is HubPreset {
    return (
        value === "free" ||
        value === "top" ||
        value === "top-left" ||
        value === "top-right" ||
        value === "left" ||
        value === "right" ||
        value === "bottom-left" ||
        value === "bottom-right"
    );
}

function loadHubPreset(): HubPreset {
    if (typeof window === "undefined") return "free";
    try {
        const raw = window.localStorage.getItem(HUB_PRESET_STORAGE_KEY);
        if (isHubPreset(raw)) return raw;
    } catch {
        /* ignore */
    }
    return "free";
}

interface HubPosition {
    x: number;
    y: number;
}

function loadSavedHubPosition(): HubPosition | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(HUB_POSITION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<HubPosition> | null;
        if (
            parsed &&
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            Number.isFinite(parsed.x) &&
            Number.isFinite(parsed.y)
        ) {
            return { x: parsed.x, y: parsed.y };
        }
    } catch {
        /* ignore */
    }
    return null;
}

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
    const [customPos, setCustomPos] = useState<HubPosition | null>(() => loadSavedHubPosition());
    const [dockSide, setDockSide] = useState<"top" | "left" | "right">("top");
    const [preset, setPreset] = useState<HubPreset>(() => loadHubPreset());
    const [contentSize, setContentSize] = useState({
        collapsedW: HUB_COLLAPSED_WIDTH,
        collapsedH: HUB_COLLAPSED_HEIGHT,
        expandedW: HUB_COLLAPSED_WIDTH,
        expandedH: HUB_EXPANDED_HEIGHT,
    });
    const hubWindow = useMemo(() => getCurrentWindow(), []);
    const geometryRunIdRef = useRef(0);
    const unlockTimerRef = useRef<number | null>(null);
    const unlockProgressRafRef = useRef<number | null>(null);
    const unlockProgressStartRef = useRef<number | null>(null);
    const lockRearmTimerRef = useRef<number | null>(null);
    const collapseTimerRef = useRef<number | null>(null);
    const itemsScrollerRef = useRef<HTMLDivElement | null>(null);
    const togglePillRef = useRef<HTMLDivElement | null>(null);
    const dockPillRef = useRef<HTMLDivElement | null>(null);
    const suppressMoveUntilRef = useRef(0);
    const customLinks = useCustomLinksStore((state) => state.links);
    const setCustomLinks = useCustomLinksStore((state) => state.setLinks);
    const { toast } = useToast();

    const baseAppUrl = `${window.location.origin}${window.location.pathname}`;
    const items = useMemo(() => getOverlayHubItems(customLinks, baseAppUrl), [customLinks, baseAppUrl]);

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

    // Listen for preset changes from the settings UI (main window) and refresh
    // the local copy when localStorage is mutated by another webview.
    useEffect(() => {
        let unlisten: (() => void) | undefined;

        listen<{ preset?: unknown }>(HUB_PRESET_EVENT, (event) => {
            const next = event.payload?.preset;
            if (isHubPreset(next)) setPreset(next);
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(console.error);

        const onStorage = (e: StorageEvent) => {
            if (e.key !== HUB_PRESET_STORAGE_KEY) return;
            if (isHubPreset(e.newValue)) setPreset(e.newValue);
            else if (e.newValue === null) setPreset("free");
        };
        window.addEventListener("storage", onStorage);

        return () => {
            if (unlisten) unlisten();
            window.removeEventListener("storage", onStorage);
        };
    }, []);

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
        scroller.scrollTop = 0;
    }, [expanded, items.length, dockSide]);

    useEffect(() => {
        const runId = ++geometryRunIdRef.current;
        const syncWindowGeometry = async () => {
            let width = expanded ? contentSize.expandedW : contentSize.collapsedW;
            let height = expanded ? contentSize.expandedH : contentSize.collapsedH;

            setIsGeometrySyncing(true);

            // Suppress onMoved saves during the size/position burst that follows.
            suppressMoveUntilRef.current = Date.now() + 800;

            const monitor = await currentMonitor().catch(() => null);
            if (runId !== geometryRunIdRef.current) return;

            // Never size the window larger than the monitor — when the dock is
            // taller (vertical mode with many items), cap it here and let the
            // dock scroller handle overflow.
            if (monitor) {
                const s = monitor.scaleFactor || 1;
                const lw = monitor.size.width / s;
                const lh = monitor.size.height / s;
                const maxW = Math.max(40, lw - 2 * HUB_EDGE_MARGIN);
                const maxH = Math.max(40, lh - 2 * HUB_EDGE_MARGIN);
                width = Math.min(width, maxW);
                height = Math.min(height, maxH);
            }

            let targetPos: LogicalPosition | null = null;

            if (preset !== "free" && monitor) {
                // Preset-locked position: snap to the chosen corner/edge of the
                // current monitor, ignoring the custom drag position.
                const scale = monitor.scaleFactor || 1;
                const lx = monitor.position.x / scale;
                const ly = monitor.position.y / scale;
                const lw = monitor.size.width / scale;
                const lh = monitor.size.height / scale;
                const m = HUB_EDGE_MARGIN;

                let px = lx + (lw - width) / 2;
                let py = ly + HUB_TOP_OFFSET;

                switch (preset) {
                    case "top":
                        px = lx + (lw - width) / 2;
                        py = ly + m;
                        break;
                    case "top-left":
                        px = lx + m;
                        py = ly + m;
                        break;
                    case "top-right":
                        px = lx + lw - width - m;
                        py = ly + m;
                        break;
                    case "left":
                        px = lx + m;
                        py = ly + (lh - height) / 2;
                        break;
                    case "right":
                        px = lx + lw - width - m;
                        py = ly + (lh - height) / 2;
                        break;
                    case "bottom-left":
                        px = lx + m;
                        py = ly + lh - height - m;
                        break;
                    case "bottom-right":
                        px = lx + lw - width - m;
                        py = ly + lh - height - m;
                        break;
                }

                px = Math.max(lx, Math.min(px, lx + lw - width));
                py = Math.max(ly, Math.min(py, ly + lh - height));
                targetPos = new LogicalPosition(Math.round(px), Math.round(py));
            } else if (customPos) {
                // User-dragged position: honor it, clamped to the current monitor
                // so it never ends up off-screen (resolution/DPI change, monitor
                // unplug). Overlay stays on the same screen as the game — no reason
                // to let it wander to another display.
                let cx = customPos.x;
                let cy = customPos.y;
                if (monitor) {
                    const s = monitor.scaleFactor || 1;
                    const lx = monitor.position.x / s;
                    const ly = monitor.position.y / s;
                    const lw = monitor.size.width / s;
                    const lh = monitor.size.height / s;
                    cx = Math.max(lx, Math.min(cx, lx + lw - width));
                    cy = Math.max(ly, Math.min(cy, ly + lh - height));
                }
                targetPos = new LogicalPosition(Math.round(cx), Math.round(cy));
            } else if (monitor) {
                // Default: centered horizontally, glued to the top of the monitor.
                const scale = monitor.scaleFactor || 1;
                const logicalMonitorX = monitor.position.x / scale;
                const logicalMonitorY = monitor.position.y / scale;
                const logicalMonitorWidth = monitor.size.width / scale;
                targetPos = new LogicalPosition(
                    Math.round(logicalMonitorX + (logicalMonitorWidth - width) / 2),
                    Math.round(logicalMonitorY + HUB_TOP_OFFSET)
                );
            } else {
                const currentPos = await hubWindow.outerPosition().catch(() => null);
                const scale = await hubWindow.scaleFactor().catch(() => 1);
                if (runId !== geometryRunIdRef.current) return;
                if (currentPos) {
                    targetPos = new LogicalPosition(
                        currentPos.x / scale,
                        Math.max(0, currentPos.y / scale)
                    );
                }
            }

            await hubWindow.setSize(new LogicalSize(width, height));
            if (runId !== geometryRunIdRef.current) return;

            if (targetPos) {
                suppressMoveUntilRef.current = Date.now() + 800;
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
    }, [expanded, contentSize, customPos, hubWindow, preset]);

    // Measure the real rendered pills and use those dimensions for the Tauri window.
    // This keeps the hub correctly sized regardless of DPI, font rendering, or future
    // CSS tweaks — anything that changes the on-screen pill size updates the window.
    useEffect(() => {
        const verticalLayout = dockSide !== "top";
        const applyMeasurement = () => {
            const toggle = togglePillRef.current;
            const dock = dockPillRef.current;
            if (!toggle) return;

            const tRect = toggle.getBoundingClientRect();
            if (!(tRect.width > 0 && tRect.height > 0)) return;

            const tW = Math.ceil(tRect.width) + HUB_SIZE_BUFFER;
            const tH = Math.ceil(tRect.height) + HUB_SIZE_BUFFER;

            let eW = tW;
            let eH = HUB_EXPANDED_HEIGHT;
            if (dock) {
                // scrollWidth / scrollHeight capture natural content size even while the
                // scroller is currently constrained by the window — critical before expansion.
                const dockNaturalW = Math.max(dock.scrollWidth, dock.getBoundingClientRect().width);
                const dockNaturalH = Math.max(dock.scrollHeight, dock.getBoundingClientRect().height);
                if (verticalLayout) {
                    // Toggle + dock sit side by side → width is the sum, height is the max.
                    eW = Math.ceil(tRect.width + dockNaturalW + 8) + HUB_SIZE_BUFFER;
                    eH = Math.ceil(Math.max(tRect.height, dockNaturalH)) + HUB_SIZE_BUFFER;
                } else {
                    // Horizontal: toggle on top of dock → width is the max, height is the sum.
                    eW = Math.ceil(Math.max(tRect.width, dockNaturalW)) + HUB_SIZE_BUFFER;
                    eH = Math.ceil(tRect.height + dockNaturalH + 8) + HUB_SIZE_BUFFER;
                }
            }

            setContentSize((prev) => {
                if (
                    prev.collapsedW === tW &&
                    prev.collapsedH === tH &&
                    prev.expandedW === eW &&
                    prev.expandedH === eH
                ) {
                    return prev;
                }
                return { collapsedW: tW, collapsedH: tH, expandedW: eW, expandedH: eH };
            });
        };

        applyMeasurement();

        const observer = new ResizeObserver(applyMeasurement);
        if (togglePillRef.current) observer.observe(togglePillRef.current);
        if (dockPillRef.current) observer.observe(dockPillRef.current);

        const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
        if (fontsReady && typeof (fontsReady as Promise<unknown>).then === "function") {
            (fontsReady as Promise<unknown>).then(applyMeasurement).catch(() => undefined);
        }

        return () => observer.disconnect();
    }, [items.length, dockSide]);

    // Derive the hub orientation. In preset mode, the preset directly dictates
    // the dock side. In free mode, derive it from the drag position on the
    // current monitor — near the left edge → dock opens to the right, near the
    // right edge → dock opens to the left, otherwise horizontal.
    useEffect(() => {
        if (preset !== "free") {
            if (preset === "left" || preset === "top-left" || preset === "bottom-left") {
                setDockSide("left");
            } else if (preset === "right" || preset === "top-right" || preset === "bottom-right") {
                setDockSide("right");
            } else {
                setDockSide("top");
            }
            return;
        }

        if (!customPos) {
            setDockSide("top");
            return;
        }
        let cancelled = false;
        currentMonitor()
            .then((m) => {
                if (cancelled || !m) return;
                const scale = m.scaleFactor || 1;
                const lx = m.position.x / scale;
                const lw = m.size.width / scale;
                const hubCenterX = customPos.x + contentSize.collapsedW / 2;
                const pct = (hubCenterX - lx) / lw;
                let next: "top" | "left" | "right" = "top";
                if (pct < 0.15) next = "left";
                else if (pct > 0.85) next = "right";
                setDockSide(next);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [customPos, contentSize.collapsedW, preset]);

    // Track user-driven window moves and persist the position so the hub reopens
    // where the user placed it. Programmatic moves (sync effect) are ignored via
    // suppressMoveUntilRef to avoid feedback loops.
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let saveTimer: number | null = null;
        let scaleFactor = 1;

        hubWindow
            .scaleFactor()
            .then((s) => {
                if (Number.isFinite(s) && s > 0) scaleFactor = s;
            })
            .catch(() => undefined);

        hubWindow
            .onMoved((event: { payload: PhysicalPosition }) => {
                if (Date.now() < suppressMoveUntilRef.current) return;
                // In preset mode, the position is driven by the preset — never
                // save ad-hoc moves triggered by our own setPosition calls.
                if (loadHubPreset() !== "free") return;
                const pos = event.payload;
                if (saveTimer !== null) window.clearTimeout(saveTimer);
                saveTimer = window.setTimeout(() => {
                    saveTimer = null;
                    const logical = {
                        x: Math.round(pos.x / scaleFactor),
                        y: Math.round(pos.y / scaleFactor),
                    };
                    setCustomPos(logical);
                    try {
                        window.localStorage.setItem(
                            HUB_POSITION_STORAGE_KEY,
                            JSON.stringify(logical)
                        );
                    } catch {
                        /* ignore */
                    }
                }, 250);
            })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(console.error);

        return () => {
            if (saveTimer !== null) window.clearTimeout(saveTimer);
            if (unlisten) unlisten();
        };
    }, [hubWindow]);

    const handlePillPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        // When a preset is locked, the hub position is driven by the setting —
        // ignore drag attempts entirely.
        if (preset !== "free") return;
        const target = event.target as HTMLElement;
        if (target.closest("button, input, [data-no-drag]")) return;
        event.preventDefault();
        hubWindow.startDragging().catch(console.error);
    };

    const handlePillDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (preset !== "free") return;
        const target = event.target as HTMLElement;
        if (target.closest("button, input")) return;
        // Reset to the default centered-at-top position.
        setCustomPos(null);
        try {
            window.localStorage.removeItem(HUB_POSITION_STORAGE_KEY);
        } catch {
            /* ignore */
        }
    };

    const dragEnabled = preset === "free";
    const pillCursorClass = dragEnabled ? "cursor-move" : "cursor-default";
    const pillTitle = dragEnabled
        ? "Glisser pour déplacer le hub — double-clic pour recentrer"
        : "Position verrouillée — choisir « Libre » dans les réglages pour déplacer";

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

        // When stacked vertically, let the native Y scroll happen (no redirect).
        if (dockSide !== "top") return;

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

    const isVertical = dockSide !== "top";

    // Keep the visual layout simple: in vertical mode the toggle is on the left
    // and the dock extends to its right. The clamping in the geometry sync keeps
    // the whole window on the current monitor, so a hub dropped against the right
    // edge is shifted left just enough to fit — no anchor gymnastics required.
    const outerAlignClass = isVertical
        ? "items-center justify-start"
        : "items-start justify-center";
    const stackClass = isVertical
        ? "flex flex-row items-center pointer-events-none"
        : "pt-0 flex flex-col items-center pointer-events-none w-full";
    const pillInnerFlex = isVertical
        ? "flex flex-col items-center gap-1.5"
        : "flex items-center gap-1.5";
    // In vertical mode we drop the labels entirely and render compact round
    // icon buttons — a long column of wide pills (« VERSEGUIDE », « SHIPMAPS »…)
    // makes the overlay huge and unreadable next to the desktop.
    const dockInnerFlex = isVertical
        ? "flex flex-col items-center gap-1.5"
        : "flex items-center gap-1.5";
    const dockWrapperSpacing = isVertical
        ? "ml-1 flex flex-row items-center"
        : "mt-1 flex flex-col items-center";
    const dockAnimOrigin = isVertical ? "origin-left" : "origin-top";
    const dockClosedOffset = isVertical ? "-translate-x-1" : "-translate-y-1";
    const dockScrollerOverflow = isVertical ? "overflow-y-auto" : "overflow-x-auto";
    const itemClosedOffset = isVertical ? "-translate-x-1" : "-translate-y-1";
    const itemOpenOffset = isVertical ? "translate-x-0" : "translate-y-0";

    return (
        <div className={`w-full h-full bg-transparent pointer-events-none overflow-visible flex ${outerAlignClass}`}>
            <div className={stackClass}>
                <div
                    ref={togglePillRef}
                    onPointerDown={handlePillPointerDown}
                    onDoubleClick={handlePillDoubleClick}
                    title={pillTitle}
                    className={`relative pointer-events-auto w-max max-w-full overflow-hidden bg-slate-950/35 backdrop-blur-md ring-1 ring-white/5 px-2 py-1 ${pillCursorClass} select-none`}
                    style={{ borderRadius: "9999px", isolation: "isolate" }}
                >
                    <div className={`w-max mx-auto ${pillInnerFlex}`}>
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
                    className={`${dockWrapperSpacing} ${dockAnimOrigin} transition-all duration-200 ease-out ${
                        menuVisible
                            ? `opacity-100 ${isVertical ? "translate-x-0" : "translate-y-0"} scale-100 pointer-events-auto`
                            : `opacity-0 ${dockClosedOffset} scale-[0.98] pointer-events-none`
                    }`}
                >
                    <div
                        ref={(node) => {
                            itemsScrollerRef.current = node;
                            dockPillRef.current = node;
                        }}
                        onWheel={handleItemsWheel}
                        onPointerDown={handlePillPointerDown}
                        onDoubleClick={handlePillDoubleClick}
                        title={pillTitle}
                        className={`w-max max-w-full ${dockScrollerOverflow} [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-slate-950/35 backdrop-blur-md ring-1 ring-white/5 px-2 py-1 ${pillCursorClass} select-none`}
                        style={{ borderRadius: "9999px", isolation: "isolate" }}
                    >
                        <div className={`w-max mx-auto ${dockInnerFlex}`}>
                            {items.map((item, index) => {
                                const isActive = activeOverlayIds.has(item.id);
                                const tooltip = isActive
                                    ? `${item.label} actif (clic = fermer)`
                                    : `Ouvrir ${item.label} en overlay`;
                                if (isVertical) {
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => openOverlayItem(item)}
                                            className={`relative h-7 w-7 rounded-full border backdrop-blur-md shadow-sm transition-all duration-200 ease-out flex items-center justify-center ${
                                                isActive
                                                    ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-100 hover:border-emerald-200/70 hover:bg-emerald-500/25"
                                                    : "border-sky-300/40 bg-sky-500/10 text-sky-100 hover:border-sky-200/60 hover:bg-sky-500/20"
                                            } ${
                                                menuVisible ? `opacity-100 ${itemOpenOffset}` : `opacity-0 ${itemClosedOffset}`
                                            }`}
                                            style={{ transitionDelay: menuVisible ? `${index * ITEM_STAGGER_MS}ms` : "0ms" }}
                                            title={tooltip}
                                        >
                                            {renderItemIcon(item)}
                                            {isActive && (
                                                <span
                                                    aria-hidden="true"
                                                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300"
                                                />
                                            )}
                                        </button>
                                    );
                                }
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
                                        menuVisible ? `opacity-100 ${itemOpenOffset}` : `opacity-0 ${itemClosedOffset}`
                                    }`}
                                    style={{ transitionDelay: menuVisible ? `${index * ITEM_STAGGER_MS}ms` : "0ms" }}
                                    title={tooltip}
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
