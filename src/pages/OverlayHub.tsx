import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
    currentMonitor,
    getCurrentWindow,
    LogicalPosition,
    LogicalSize,
    type PhysicalPosition,
} from "@tauri-apps/api/window";
import { useToast } from "@/hooks/use-toast";
import { useCustomLinksStore, type CustomLink } from "@/stores/custom-links-store";
import { getOverlayHubItems } from "@/utils/overlay-hub-registry";
import type { OverlayHubItem } from "@/types/overlay-hub";
import {
    OverlayHubBar,
    type OverlayHubCategory,
    type OverlayHubTool,
} from "@/components/custom/overlay-hub-bar";

const HUB_TOP_OFFSET = 10;
// Marge périphérique entre la taille mesurée du contenu (getBoundingClientRect)
// et la taille demandée à la fenêtre Tauri. Trop élevé → on voit la fenêtre
// Tauri rectangulaire déborder du hub `rounded-full`. Trop bas (0) → risque
// de clip 1 px du contenu en cas de sub-pixel rounding. 2 px = compromis.
const HUB_SIZE_BUFFER = 2;
const HUB_REQUEST_EVENT = "overlay_hub_request_custom_links";
const HUB_SYNC_EVENT = "overlay_hub_sync_custom_links";
const HUB_POSITION_STORAGE_KEY = "overlay_hub_position_v1";
const HUB_PRESET_STORAGE_KEY = "overlay_hub_preset_v1";
const HUB_PRESET_EVENT = "overlay_hub_preset_change";
const HUB_EDGE_MARGIN = 10;

type HubPreset =
    | "free"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right";

function isHubPreset(value: unknown): value is HubPreset {
    return (
        value === "free" ||
        value === "top" ||
        value === "bottom" ||
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
        const link: CustomLink = { id, name, url };
        if (icon) link.icon = icon;
        normalized.push(link);
    });
    return normalized;
}

// Mapping id → catégorie pour l'OverlayHubBar (groupes CMB/TRD/CRF/DTA/MSC).
const ID_TO_CATEGORY: Record<string, OverlayHubCategory> = {
    erkul: "combat",
    pvp: "combat",
    uexcorp: "trading",
    cargo: "trading",
    "sc-cargo-viewer": "trading",
    schaulers: "trading",
    "allsky-mining": "trading",
    "protixit-reputation": "trading",
    crafter: "crafting",
    "sc-craft-tools": "crafting",
    "scdb-space": "crafting",
    scmdb: "database",
    verseguide: "database",
    finder: "database",
    shipmaps: "database",
    spviewer: "misc",
    "hauler-spacecoder": "misc",
};

// Mapping iconKey StarTrad → iconName Lucide pour l'OverlayHubBar.
const ICONKEY_TO_LUCIDE: Record<string, string> = {
    dps: "crosshair",
    pvp: "swords",
    shipmaps: "plane",
    finder: "search",
    cargo: "package-check",
    verseguide: "map",
    scmdb: "database",
    crafter: "hammer",
    trading: "route",
    spviewer: "eye",
    server: "server",
    package: "package-check",
    database: "database",
    hammer: "hammer",
    route: "route",
    pickaxe: "pickaxe",
    shield: "shield-check",
};

function mapToHubTools(items: OverlayHubItem[], activeIds: Set<string>): OverlayHubTool[] {
    return items.map((item) => ({
        id: item.id,
        label: item.label,
        category: ID_TO_CATEGORY[item.id] ?? "misc",
        iconName: ICONKEY_TO_LUCIDE[item.iconKey] ?? "database",
        isOpen: activeIds.has(item.id),
    }));
}

const OverlayHub = () => {
    const [isEditMode, setIsEditMode] = useState(true);
    const [activeOverlayIds, setActiveOverlayIds] = useState<Set<string>>(new Set());
    const [customPos, setCustomPos] = useState<HubPosition | null>(() => loadSavedHubPosition());
    const [preset, setPreset] = useState<HubPreset>(() => loadHubPreset());
    const hubWindow = useMemo(() => getCurrentWindow(), []);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const customLinks = useCustomLinksStore((state) => state.links);
    const setCustomLinks = useCustomLinksStore((state) => state.setLinks);
    const { toast } = useToast();
    const suppressMoveUntilRef = useRef(0);
    // Flag true pendant que l'user est en train de drag le hub. Permet de
    // skip le geometry sync (ResizeObserver setSize/setPosition) qui rivalise
    // avec le drag natif Windows et provoque des glitchs visuels. Reset par
    // un timeout 250 ms après le dernier event Moved utilisateur.
    const isDraggingRef = useRef(false);
    // Flag true pendant la séquence snap (setPreset → re-measure → setSize →
    // animate). Bloque le geometry sync useEffect pour qu'il ne rivalise pas
    // avec notre setSize/setPosition manuel et n'introduise pas de saut visuel
    // de fin d'animation. Reset à false dès que animatePosition se termine.
    const isAnimatingSnapRef = useRef(false);
    // Timestamp de la fin du dernier snap. Sert de cooldown : si un Moved
    // event tardif (typiquement émis par Tauri en réponse au setSize qui
    // re-positionne automatiquement la fenêtre près d'un bord) déclenche
    // saveTimer dans les 3 secondes après un snap, on l'ignore. Sinon, ce
    // Moved trigger un "no snap target" et reset le preset à "free" alors
    // qu'on vient juste de snap → glitch de retour horizontal.
    const lastSnapEndAtRef = useRef(0);

    const baseAppUrl = `${window.location.origin}${window.location.pathname}`;
    const items = useMemo(
        () => getOverlayHubItems(customLinks, baseAppUrl),
        [customLinks, baseAppUrl],
    );
    const hubTools = useMemo(() => mapToHubTools(items, activeOverlayIds), [items, activeOverlayIds]);

    // ── Sync mode (édition vs jeu) ──────────────────────────────────────
    useEffect(() => {
        let mounted = true;
        invoke<boolean>("get_overlay_hub_mode")
            .then((mode) => {
                if (mounted) setIsEditMode(Boolean(mode));
            })
            .catch(console.error);
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listen<boolean>("overlay_hub_mode_changed", (event) => {
            setIsEditMode(Boolean(event.payload));
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(console.error);
        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    // ── Transparent window (pas de fond solide derrière la bar) ────────
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

    // ── Sync custom links via Tauri events (le main window les push) ──
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

    // ── Sync preset depuis les réglages ────────────────────────────────
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

    // ── Active overlays tracking ───────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        let unlistenClosed: (() => void) | undefined;
        const refresh = async () => {
            const entries = await Promise.all(
                items.map(async (item) => {
                    const isOpen = await invoke<boolean>("is_overlay_open", {
                        id: item.id,
                        overlayType: item.kind,
                    }).catch(() => false);
                    return [item.id, Boolean(isOpen)] as const;
                }),
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
                setActiveOverlayIds((prev) => {
                    if (!prev.has(closedId)) return prev;
                    const next = new Set(prev);
                    next.delete(closedId);
                    return next;
                });
            });
        };
        refresh().catch(console.error);
        setup().catch(console.error);
        return () => {
            cancelled = true;
            if (unlistenClosed) unlistenClosed();
        };
    }, [items]);

    // ── Geometry sync (resize window to fit bar) ───────────────────────
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        let raf = 0;
        const sync = async () => {
            // Skip pendant que l'user drag (évite que setSize/setPosition
            // rivalisent avec le drag natif et glitch visuellement).
            if (isDraggingRef.current) return;
            // Skip aussi pendant la séquence snap orientation : le snap pilote
            // lui-même setSize + setPosition (avec les nouvelles dimensions
            // post-orientation), inutile que le geometry sync vienne s'en
            // mêler avec la position cible recalculée brutalement.
            if (isAnimatingSnapRef.current) return;
            const rect = el.getBoundingClientRect();
            const width = Math.ceil(rect.width) + HUB_SIZE_BUFFER;
            const height = Math.ceil(rect.height) + HUB_SIZE_BUFFER;
            if (width < 40 || height < 20) return;
            // Re-check juste avant le setSize : un snap a pu kick in entre
            // le RAF schedule et l'exécution de cette fonction (le drag
            // release fait fire saveTimer qui set isAnimatingSnapRef = true).
            // Sans ce check, on appelle setSize avec les dimensions de
            // l'ANCIENNE orientation alors que le snap est déjà parti vers
            // la nouvelle.
            if (isAnimatingSnapRef.current) return;
            // Math.max : ne raccourcis JAMAIS une suppression plus longue
            // déjà active (typiquement les 2000 ms posés par animatePosition
            // pour absorber les Moved tardifs post-snap).
            suppressMoveUntilRef.current = Math.max(
                suppressMoveUntilRef.current,
                Date.now() + 400,
            );
            try {
                await hubWindow.setSize(new LogicalSize(width, height));
                // Re-check après chaque await : si le snap a kick in pendant
                // l'await, on stoppe avant de faire setPosition (qui
                // recalerait à la position du preset, écrasant l'anim snap).
                if (isAnimatingSnapRef.current) return;
                const monitor = await currentMonitor().catch(() => null);
                if (isAnimatingSnapRef.current) return;
                if (preset !== "free") {
                    if (!monitor) return;
                    const scale = monitor.scaleFactor || 1;
                    const lx = monitor.position.x / scale;
                    const ly = monitor.position.y / scale;
                    const lw = monitor.size.width / scale;
                    const lh = monitor.size.height / scale;
                    const m = HUB_EDGE_MARGIN;
                    let x = lx + (lw - width) / 2;
                    let y = ly + m;
                    if (preset === "top-left") {
                        x = lx + m;
                        y = ly + m;
                    } else if (preset === "top-right") {
                        x = lx + lw - width - m;
                        y = ly + m;
                    } else if (preset === "bottom-left") {
                        x = lx + m;
                        y = ly + lh - height - m;
                    } else if (preset === "bottom-right") {
                        x = lx + lw - width - m;
                        y = ly + lh - height - m;
                    } else if (preset === "left") {
                        x = lx + m;
                        y = ly + (lh - height) / 2;
                    } else if (preset === "right") {
                        x = lx + lw - width - m;
                        y = ly + (lh - height) / 2;
                    } else if (preset === "top") {
                        x = lx + (lw - width) / 2;
                        y = ly + m;
                    } else if (preset === "bottom") {
                        x = lx + (lw - width) / 2;
                        y = ly + lh - height - m;
                    }
                    // Math.max : ne raccourcis JAMAIS une suppression plus longue
            // déjà active (typiquement les 2000 ms posés par animatePosition
            // pour absorber les Moved tardifs post-snap).
            suppressMoveUntilRef.current = Math.max(
                suppressMoveUntilRef.current,
                Date.now() + 400,
            );
                    await hubWindow.setPosition(
                        new LogicalPosition(Math.round(x), Math.round(y)),
                    );
                } else if (customPos === null && monitor) {
                    const scale = monitor.scaleFactor || 1;
                    const lx = monitor.position.x / scale;
                    const ly = monitor.position.y / scale;
                    const lw = monitor.size.width / scale;
                    // Math.max : ne raccourcis JAMAIS une suppression plus longue
            // déjà active (typiquement les 2000 ms posés par animatePosition
            // pour absorber les Moved tardifs post-snap).
            suppressMoveUntilRef.current = Math.max(
                suppressMoveUntilRef.current,
                Date.now() + 400,
            );
                    await hubWindow.setPosition(
                        new LogicalPosition(
                            Math.round(lx + (lw - width) / 2),
                            Math.round(ly + HUB_TOP_OFFSET),
                        ),
                    );
                }
            } catch (e) {
                console.warn("[OverlayHub] geometry sync failed:", e);
            }
        };
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                sync().catch(console.error);
            });
        });
        observer.observe(el);
        // Premier sync
        raf = requestAnimationFrame(() => {
            sync().catch(console.error);
        });
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [hubWindow, preset, customPos, hubTools.length]);

    // ── Persist position on user drag (free mode only) + snap aux bords ─
    // Debounce 250 ms après le dernier Moved = considéré comme "drag end".
    // À ce moment :
    //   1. Sauvegarde la position custom (état "free" persistant)
    //   2. Détecte la proximité avec les 4 bords + 4 coins du monitor courant.
    //      Si la position du hub est dans la zone d'attraction (~SNAP_ZONE px
    //      d'un bord), bascule automatiquement vers le preset correspondant.
    // Le useEffect géométrie sync re-position la fenêtre exactement au preset
    // (re-déclenché par le changement de `preset` dans son deps).
    const SNAP_ZONE = 60;
    useEffect(() => {
        // mounted flag : protège contre la fuite de listener Tauri quand le
        // useEffect cleanup s'exécute AVANT que le promise .then() de
        // `hubWindow.onMoved()` ne soit résolu (cas React 18 strict mode
        // mount-unmount-remount, ou cleanup synchrone trop rapide). Sans
        // ça, le listener est installé après cleanup et fuite : on a 2
        // listeners actifs → chaque event traité 2x → 2 saveTimers → 2
        // animations en parallèle → bugs visuels.
        let mounted = true;
        let unlisten: (() => void) | undefined;
        let saveTimer: number | null = null;
        let scaleFactor = 1;
        hubWindow
            .scaleFactor()
            .then((s) => {
                if (Number.isFinite(s) && s > 0) scaleFactor = s;
            })
            .catch(() => undefined);
        // Helper d'animation : interpole la position de la fenêtre Tauri
        // depuis position actuelle vers target sur `duration` ms via RAF +
        // ease-out cubic. Suppresse les events Moved pendant l'anim pour
        // qu'ils ne déclenchent pas notre handler en boucle.
        const animatePosition = (
            from: { x: number; y: number },
            to: { x: number; y: number },
            duration: number,
        ): Promise<void> => {
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now: number) => {
                    const t = Math.min(1, (now - start) / duration);
                    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
                    const x = Math.round(from.x + (to.x - from.x) * eased);
                    const y = Math.round(from.y + (to.y - from.y) * eased);
                    suppressMoveUntilRef.current = Math.max(
                        suppressMoveUntilRef.current,
                        Date.now() + 100,
                    );
                    hubWindow.setPosition(new LogicalPosition(x, y)).catch(() => undefined);
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        // Garde suppress très longtemps après la fin (2 sec)
                        // pour absorber TOUS les Moved events tardifs émis
                        // par Windows en réponse à nos setPosition (jusqu'à
                        // 800-1200 ms de latence observée) ET les re-syncs
                        // déclenchés par le ResizeObserver. Sans ça, un
                        // Moved tardif déclenche notre handler qui voit
                        // currentPreset != "free" et set preset à "free" →
                        // wrapper React redevient horizontal → setSize 322x52
                        // → glitch visible de retour à l'horizontal après le
                        // snap vertical.
                        suppressMoveUntilRef.current = Math.max(
                            suppressMoveUntilRef.current,
                            Date.now() + 2000,
                        );
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        };

        hubWindow
            .onMoved((event: { payload: PhysicalPosition }) => {
                // Skip si le composant a été unmount entre temps (cleanup
                // déjà passé mais listener encore actif via .then async).
                if (!mounted) return;
                if (Date.now() < suppressMoveUntilRef.current) return;
                // User drag détecté → flag pour skip le geometry sync (qui
                // provoque des glitchs en rivalisant avec le drag natif).
                // NOTE : on NE setPreset("free") PAS ici (bien que ce soit
                // tentant pour "libérer" la position pendant le drag). Raison :
                // ce setPreset cascade en useEffect re-runs + React renders +
                // ResizeObserver fires qui rivalisent avec mon snap et créent
                // des glitchs. Le drag est déjà protégé par isDraggingRef
                // (geometry_sync skip), donc preset peut rester à sa valeur
                // courante pendant tout le drag. La bascule vers "free" ou
                // vers le nouveau preset se fait UNIQUEMENT à la fin du drag
                // (dans le saveTimer, après détection snap), garantissant un
                // changement de preset unique et atomique.
                isDraggingRef.current = true;
                const pos = event.payload;
                if (saveTimer !== null) window.clearTimeout(saveTimer);
                saveTimer = window.setTimeout(async () => {
                    saveTimer = null;
                    // Drag terminé (250 ms sans Moved) → fin du flag drag
                    isDraggingRef.current = false;
                    const logical = {
                        x: Math.round(pos.x / scaleFactor),
                        y: Math.round(pos.y / scaleFactor),
                    };
                    setCustomPos(logical);
                    try {
                        window.localStorage.setItem(
                            HUB_POSITION_STORAGE_KEY,
                            JSON.stringify(logical),
                        );
                    } catch {
                        /* ignore */
                    }

                    // ── SNAP au bord/coin le plus proche + animation ─────
                    try {
                        const monitor = await currentMonitor().catch(() => null);
                        if (!monitor) return;
                        const ms = monitor.scaleFactor || 1;
                        const screenW = monitor.size.width / ms;
                        const screenH = monitor.size.height / ms;
                        const lx = monitor.position.x / ms;
                        const ly = monitor.position.y / ms;
                        const hubSize = await hubWindow.outerSize().catch(() => null);
                        if (!hubSize) return;
                        const hubW = hubSize.width / ms;
                        const hubH = hubSize.height / ms;
                        const distTop = logical.y - ly;
                        const distLeft = logical.x - lx;
                        const distRight = lx + screenW - (logical.x + hubW);
                        const distBottom = ly + screenH - (logical.y + hubH);
                        const nearTop = distTop < SNAP_ZONE;
                        const nearBottom = distBottom < SNAP_ZONE;
                        const nearLeft = distLeft < SNAP_ZONE;
                        const nearRight = distRight < SNAP_ZONE;

                        let target: HubPreset | null = null;
                        if (nearTop && nearLeft) target = "top-left";
                        else if (nearTop && nearRight) target = "top-right";
                        else if (nearBottom && nearLeft) target = "bottom-left";
                        else if (nearBottom && nearRight) target = "bottom-right";
                        else if (nearTop) target = "top";
                        else if (nearBottom) target = "bottom";
                        else if (nearLeft) target = "left";
                        else if (nearRight) target = "right";

                        // Pas de target = drop loin de tout bord = mode libre.
                        // Bascule preset à "free" pour que le geometry_sync
                        // n'essaye pas de re-positionner vers l'ancien preset.
                        // (On a NE PAS fait ce setPreset au début du drag pour
                        // éviter les cascades free → target avec races.)
                        //
                        // EXCEPTION : si on vient juste de faire un snap
                        // (cooldown 3 sec), on ignore ce no-target event. Il
                        // est probablement un Moved synthétique émis par Tauri
                        // en réponse à notre setSize+setPosition de snap
                        // (Windows ajuste la position quand la fenêtre
                        // dépasse l'écran). Sans cette exception, le preset
                        // revient à "free" juste après un snap → glitch
                        // horizontal visible.
                        if (!target) {
                            const sinceLastSnap =
                                Date.now() - lastSnapEndAtRef.current;
                            if (sinceLastSnap < 3000) {
                                // No-op : on ignore les Moved synthétiques
                                // post-snap pour éviter le retour à "free".
                            } else {
                                const currentPresetVal = loadHubPreset();
                                if (currentPresetVal !== "free") {
                                    setPreset("free");
                                    try {
                                        window.localStorage.setItem(
                                            HUB_PRESET_STORAGE_KEY,
                                            "free",
                                        );
                                    } catch {
                                        /* ignore */
                                    }
                                    emit(HUB_PRESET_EVENT, {
                                        preset: "free",
                                    }).catch(() => undefined);
                                }
                            }
                        }

                        if (target) {
                            // ── Séquencement anti-glitch orientation ─────
                            // Le bug : si on anime AVANT setPreset, on utilise
                            // l'ancien hubW/hubH pour calculer la position
                            // cible. Après setPreset, React re-render avec la
                            // nouvelle orientation, la taille change, et le
                            // geometry sync recalcule une position différente
                            // → saut visuel en fin d'anim (hub "coupé").
                            //
                            // Fix : on inverse l'ordre.
                            //   1. setPreset (React re-render commence)
                            //   2. attendre que ResizeObserver fire (= wrapper
                            //      a effectivement changé de taille) + 1 RAF
                            //      paint
                            //   3. re-mesurer le wrapper avec la nouvelle
                            //      orientation
                            //   4. setSize manuel à la bonne taille
                            //   5. recalculer la position cible avec les
                            //      nouvelles dimensions
                            //   6. lire la position actuelle de la fenêtre
                            //   7. animatePosition vers la vraie cible
                            //
                            // Pendant tout ce flow, isAnimatingSnapRef bloque
                            // le geometry sync useEffect pour éviter qu'il
                            // pilote setSize/setPosition en parallèle.
                            const orientChanges =
                                ((preset === "left" || preset === "right") !==
                                    (target === "left" || target === "right"));
                            isAnimatingSnapRef.current = true;
                            try {
                                // 1. Apply preset
                                setPreset(target);
                                try {
                                    window.localStorage.setItem(
                                        HUB_PRESET_STORAGE_KEY,
                                        target,
                                    );
                                } catch {
                                    /* ignore */
                                }
                                emit(HUB_PRESET_EVENT, { preset: target }).catch(
                                    () => undefined,
                                );

                                // 2. Attendre que le wrapper change de taille
                                //    Si orientation change → utiliser un
                                //    ResizeObserver one-shot avec timeout fallback,
                                //    car 2 RAF basiques peuvent ne pas suffire
                                //    sur un re-render lourd.
                                const elWait = wrapperRef.current;
                                if (orientChanges && elWait) {
                                    await new Promise<void>((resolve) => {
                                        let done = false;
                                        const finish = () => {
                                            if (done) return;
                                            done = true;
                                            try {
                                                ro.disconnect();
                                            } catch {
                                                /* ignore */
                                            }
                                            resolve();
                                        };
                                        const ro = new ResizeObserver(() => finish());
                                        ro.observe(elWait);
                                        window.setTimeout(finish, 150);
                                    });
                                }
                                await new Promise<void>((r) =>
                                    requestAnimationFrame(() => r()),
                                );

                                // 3. Re-measure wrapper avec la nouvelle
                                //    orientation (vertical ↔ horizontal)
                                const el = wrapperRef.current;
                                let newW = hubW;
                                let newH = hubH;
                                if (el) {
                                    const rect = el.getBoundingClientRect();
                                    const w = Math.ceil(rect.width) + HUB_SIZE_BUFFER;
                                    const h = Math.ceil(rect.height) + HUB_SIZE_BUFFER;
                                    if (w >= 40 && h >= 20) {
                                        newW = w;
                                        newH = h;
                                    }
                                }

                                // 4. setSize manuel — suppresse les Moved events
                                //    pendant ~1s pour absorber les notifications
                                //    Tauri qui suivent un setSize.
                                suppressMoveUntilRef.current = Math.max(
                                    suppressMoveUntilRef.current,
                                    Date.now() + 1000,
                                );
                                try {
                                    await hubWindow.setSize(
                                        new LogicalSize(newW, newH),
                                    );
                                } catch {
                                    /* ignore — best-effort */
                                }

                                // 5. Recalcule la position cible avec les
                                //    nouvelles dimensions.
                                const m = HUB_EDGE_MARGIN;
                                let tx = lx + (screenW - newW) / 2;
                                let ty = ly + m;
                                if (target === "top-left") {
                                    tx = lx + m;
                                    ty = ly + m;
                                } else if (target === "top-right") {
                                    tx = lx + screenW - newW - m;
                                    ty = ly + m;
                                } else if (target === "bottom-left") {
                                    tx = lx + m;
                                    ty = ly + screenH - newH - m;
                                } else if (target === "bottom-right") {
                                    tx = lx + screenW - newW - m;
                                    ty = ly + screenH - newH - m;
                                } else if (target === "left") {
                                    tx = lx + m;
                                    ty = ly + (screenH - newH) / 2;
                                } else if (target === "right") {
                                    tx = lx + screenW - newW - m;
                                    ty = ly + (screenH - newH) / 2;
                                } else if (target === "top") {
                                    tx = lx + (screenW - newW) / 2;
                                    ty = ly + m;
                                } else if (target === "bottom") {
                                    tx = lx + (screenW - newW) / 2;
                                    ty = ly + screenH - newH - m;
                                }

                                // 6. Lit la position actuelle de la fenêtre
                                //    (peut avoir bougé légèrement avec setSize
                                //    selon l'OS) pour partir de la vraie
                                //    position de départ.
                                const winPos = await hubWindow
                                    .outerPosition()
                                    .catch(() => null);
                                const startX = winPos
                                    ? winPos.x / ms
                                    : logical.x;
                                const startY = winPos
                                    ? winPos.y / ms
                                    : logical.y;

                                // 7. Clamp + anime de la position courante
                                //    vers la nouvelle cible. Clamp avec les
                                //    NOUVELLES dimensions.
                                const clamp = (x: number, y: number) => ({
                                    x: Math.max(
                                        lx,
                                        Math.min(lx + screenW - newW, x),
                                    ),
                                    y: Math.max(
                                        ly,
                                        Math.min(ly + screenH - newH, y),
                                    ),
                                });
                                const clampedStart = clamp(startX, startY);
                                const clampedEnd = clamp(
                                    Math.round(tx),
                                    Math.round(ty),
                                );
                                await animatePosition(
                                    clampedStart,
                                    clampedEnd,
                                    220,
                                );
                            } finally {
                                // Release le flag dans tous les cas pour ne
                                // pas figer le geometry sync.
                                isAnimatingSnapRef.current = false;
                                // Marque la fin du snap pour le cooldown qui
                                // ignore les Moved synthétiques émis par
                                // Tauri/Windows en réponse au setSize.
                                lastSnapEndAtRef.current = Date.now();
                            }
                        }
                    } catch {
                        /* snap best-effort, on ne bloque pas le drag si ça rate */
                        isAnimatingSnapRef.current = false;
                    }
                }, 250);
            })
            .then((fn) => {
                // Si le cleanup a déjà passé pendant que onMoved() résolvait,
                // unsubscribe immédiatement pour ne pas fuiter le listener.
                if (!mounted) {
                    try {
                        fn();
                    } catch {
                        /* ignore */
                    }
                    return;
                }
                unlisten = fn;
            })
            .catch(console.error);
        return () => {
            mounted = false;
            if (saveTimer !== null) window.clearTimeout(saveTimer);
            if (unlisten) unlisten();
        };
    }, [hubWindow]);

    // ── Handlers ───────────────────────────────────────────────────────
    const openOverlayItem = async (item: OverlayHubItem) => {
        const isActive = activeOverlayIds.has(item.id);
        try {
            if (isActive) {
                if (item.kind === "webview") {
                    await invoke("close_webview_overlay", { id: item.id });
                } else {
                    await invoke("close_overlay", { id: item.id });
                }
                setActiveOverlayIds((prev) => {
                    if (!prev.has(item.id)) return prev;
                    const next = new Set(prev);
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
            setActiveOverlayIds((prev) => {
                if (prev.has(item.id)) return prev;
                const next = new Set(prev);
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

    const handleToolClick = (id: string) => {
        const item = items.find((i) => i.id === id);
        if (item) openOverlayItem(item);
    };

    const handleLockToggle = async (nextLocked: boolean) => {
        // nextLocked === true → mode jeu (isEditMode = false)
        // nextLocked === false → mode édition (isEditMode = true)
        const wantEdit = !nextLocked;
        try {
            const applied = await invoke<boolean>("set_overlay_hub_mode", {
                editMode: wantEdit,
            });
            setIsEditMode(Boolean(applied));
        } catch (error) {
            console.error(error);
        }
    };

    const handleOpenAllTools = () => {
        // Pour l'instant : popover géré côté <OverlayHubBar> (le bouton
        // LayoutGrid ouvre un Radix Popover, le contenu est à enrichir
        // plus tard). Ici juste un placeholder côté wrapper.
        console.log("[OverlayHub] open all tools (popover handled by bar)");
    };

    // ── Drag pour déplacer le hub (mode libre uniquement) ──────────────
    // Drag toujours actif tant que le hub n'est pas verrouillé via le cadenas.
    // Même en mode preset (top, left, etc.), l'user doit pouvoir le déplacer ;
    // au release, le snap automatique remettra au preset le plus proche (ou
    // passera en "free" si loin de tout bord).
    const dragEnabled = isEditMode;
    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if (!dragEnabled) return;
        const target = event.target as HTMLElement;
        if (target.closest("button, [data-no-drag]")) return;
        event.preventDefault();
        hubWindow.startDragging().catch(console.error);
    };

    const handleDoubleClick = async (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!dragEnabled) return;
        const target = event.target as HTMLElement;
        if (target.closest("button")) return;
        // Recenter
        setCustomPos(null);
        try {
            window.localStorage.removeItem(HUB_POSITION_STORAGE_KEY);
        } catch {
            /* ignore */
        }
    };

    return (
        <div
            ref={wrapperRef}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            className={`pointer-events-auto inline-flex bg-transparent ${
                dragEnabled ? "cursor-move" : "cursor-default"
            } select-none`}
            title={
                dragEnabled
                    ? "Glisser pour déplacer le hub — double-clic pour recentrer"
                    : "Position verrouillée — choisir « Libre » dans les réglages"
            }
        >
            <OverlayHubBar
                tools={hubTools}
                isLocked={!isEditMode}
                orientation={preset === "left" || preset === "right" ? "vertical" : "horizontal"}
                onToolClick={handleToolClick}
                onLockToggle={handleLockToggle}
                onOpenAllTools={handleOpenAllTools}
            />
        </div>
    );
};

export default OverlayHub;
