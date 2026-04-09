import { m } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, RotateCcw, Loader2, Map as MapIcon, X, PictureInPicture2 } from "lucide-react";
import { IconSwords } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useToast } from "@/hooks/use-toast";

// === CONSTANTES ===

const RED_DURATION = 7200;   // 2h - Hangar Fermé
const GREEN_DURATION = 3600; // 1h - Hangar Ouvert
const BLACK_DURATION = 300;  // 5min - Réinitialisation
const TOTAL_CYCLE = RED_DURATION + GREEN_DURATION + BLACK_DURATION; // 10800s = 3h

type Phase = "red" | "green" | "black";

interface SelfTimer {
    id: string;
    label: string;
    duration: number; // en secondes
    remaining: number;
    running: boolean;
    intervalId: number | null;
    startedAt: number | null; // timestamp Unix (ms) quand le timer a été lancé
}

interface ZoneConfig {
    name: string;
    color: string;
    timers: { label: string; duration: number }[];
}

const ZONES: ZoneConfig[] = [
    {
        name: "Checkmate",
        color: "blue",
        timers: [
            { label: "Terminal 1", duration: 900 },
            { label: "Terminal 2", duration: 900 },
            { label: "Terminal 3", duration: 900 },
            { label: "Tablet 1", duration: 1800 },
            { label: "Tablet 2", duration: 1800 },
            { label: "Tablet 3", duration: 1800 },
        ],
    },
    {
        name: "Orbituary",
        color: "purple",
        timers: [
            { label: "Terminal 1", duration: 900 },
            { label: "Terminal 2", duration: 900 },
            { label: "Tablet 4", duration: 1800 },
            { label: "Tablet 7", duration: 1800 },
        ],
    },
    {
        name: "Ruin Station",
        color: "amber",
        timers: [
            { label: "The Crypt", duration: 900 },
            { label: "The Last Resort", duration: 900 },
            { label: "The Wasteland", duration: 900 },
            { label: "Tablet 5", duration: 1800 },
            { label: "Tablet 6", duration: 1800 },
        ],
    },
    {
        name: "PYAM-SUPVISR",
        color: "red",
        timers: [
            { label: "Red Keycard -3-4", duration: 1800 },
            { label: "Red Keycard -3-5", duration: 1800 },
        ],
    },
];

// === UTILS ===

function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimeShort(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getPhaseInfo(cycleStart: number): { phase: Phase; remaining: number; cycleRemaining: number; elapsed: number; phaseLabel: string; secondaryLabel: string } {
    const now = Math.floor(Date.now() / 1000);
    const elapsed = ((now - cycleStart) % TOTAL_CYCLE + TOTAL_CYCLE) % TOTAL_CYCLE;
    const cycleRemaining = TOTAL_CYCLE - elapsed;

    if (elapsed < RED_DURATION) {
        const remaining = RED_DURATION - elapsed;
        return { phase: "red", remaining, cycleRemaining, elapsed, phaseLabel: "Hangar Fermé", secondaryLabel: `Overture du Hangar dans ${formatTime(remaining)}` };
    } else if (elapsed < RED_DURATION + GREEN_DURATION) {
        const phaseElapsed = elapsed - RED_DURATION;
        const remaining = GREEN_DURATION - phaseElapsed;
        return { phase: "green", remaining, cycleRemaining, elapsed, phaseLabel: "Hangar Ouvert", secondaryLabel: `Fermeture du Hangar dans ${formatTime(remaining)}` };
    } else {
        const phaseElapsed = elapsed - RED_DURATION - GREEN_DURATION;
        const remaining = BLACK_DURATION - phaseElapsed;
        return { phase: "black", remaining, cycleRemaining, elapsed, phaseLabel: "Réinitialisation", secondaryLabel: `Prochain cycle dans ${formatTime(remaining)}` };
    }
}

function getPhaseColor(phase: Phase): string {
    switch (phase) {
        case "red": return "text-red-500";
        case "green": return "text-green-500";
        case "black": return "text-yellow-500";
    }
}

function getPhaseBg(phase: Phase): string {
    switch (phase) {
        case "red": return "bg-red-500/20 text-red-400 border-red-500/30";
        case "green": return "bg-green-500/20 text-green-400 border-green-500/30";
        case "black": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    }
}

function getProgressPercent(phase: Phase, remaining: number): number {
    switch (phase) {
        case "red": return ((RED_DURATION - remaining) / RED_DURATION) * 100;
        case "green": return ((GREEN_DURATION - remaining) / GREEN_DURATION) * 100;
        case "black": return ((BLACK_DURATION - remaining) / BLACK_DURATION) * 100;
    }
}

function getTimerColor(remaining: number, running: boolean): string {
    if (!running) return "text-muted-foreground";
    if (remaining === 0) return "text-green-500";
    if (remaining <= 180) return "text-yellow-500";
    return "text-red-400";
}

function getZoneAccent(color: string): string {
    switch (color) {
        case "blue": return "border-blue-500/30";
        case "purple": return "border-purple-500/30";
        case "amber": return "border-amber-500/30";
        case "red": return "border-red-500/30";
        default: return "border-border";
    }
}

const MAPS = [
    { name: "Checkmate", url: "https://contestedzonetimers.com/maps/Checkmate%20Map.webp" },
    { name: "Orbituary", url: "https://contestedzonetimers.com/maps/Orbituary%20Map.webp" },
    { name: "Ruin Station", url: "https://contestedzonetimers.com/maps/Ruin%20Map.webp" },
    { name: "Executive Hangar", url: "https://contestedzonetimers.com/maps/Executive%20Hangar%20Map.webp" },
    { name: "Supervisor", url: "https://contestedzonetimers.com/maps/Supervisor%20Map.webp" },
];

function getZoneBadge(color: string): string {
    switch (color) {
        case "blue": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
        case "purple": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
        case "amber": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
        case "red": return "bg-red-500/20 text-red-400 border-red-500/30";
        default: return "";
    }
}

// === PERSISTENCE ===

const STORAGE_KEY = "pvp-self-timers";
const CYCLE_START_CACHE_KEY = "pvp-cycle-start";

interface SavedTimer {
    startedAt: number | null; // timestamp ms quand lancé
    duration: number;
}

interface OverlayClosedPayload {
    id: string;
}

interface PvpProps {
    isOverlayEmbed?: boolean;
}

function saveTimersToStorage(timers: Map<string, SelfTimer>) {
    const data: Record<string, SavedTimer> = {};
    timers.forEach((t, id) => {
        if (t.running && t.startedAt) {
            data[id] = { startedAt: t.startedAt, duration: t.duration };
        }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTimersFromStorage(): Record<string, SavedTimer> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveCycleStartToCache(cycleStart: number) {
    localStorage.setItem(CYCLE_START_CACHE_KEY, String(cycleStart));
}

function loadCycleStartFromCache(): number | null {
    try {
        const raw = localStorage.getItem(CYCLE_START_CACHE_KEY);
        if (!raw) return null;
        const timestamp = parseInt(raw, 10);
        if (isNaN(timestamp)) return null;
        return timestamp;
    } catch {
        return null;
    }
}

// === COMPOSANT ===

export default function Pvp({ isOverlayEmbed = false }: PvpProps) {
    const [cycleStart, setCycleStart] = useState<number | null>(null);
    const [phaseInfo, setPhaseInfo] = useState<ReturnType<typeof getPhaseInfo> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [selfTimers, setSelfTimers] = useState<Map<string, SelfTimer>>(new Map());
    const [selectedMap, setSelectedMap] = useState<string | null>(null);
    const [isDetachedToOverlay, setIsDetachedToOverlay] = useState(false);
    const intervalsRef = useRef<Map<string, number>>(new Map());
    const { toast } = useToast();

    useEffect(() => {
        if (!isOverlayEmbed) return;

        const html = document.documentElement;
        const body = document.body;
        const root = document.getElementById("root");

        const prevHtmlBackground = html.style.background;
        const prevBodyBackground = body.style.background;
        const prevBodyBackgroundColor = body.style.backgroundColor;
        const prevRootBackground = root?.style.background ?? "";

        html.style.setProperty("background", "transparent", "important");
        body.style.setProperty("background", "transparent", "important");
        body.style.setProperty("background-color", "transparent", "important");
        if (root) {
            root.style.setProperty("background", "transparent", "important");
        }

        const style = document.createElement("style");
        style.id = "pvp-overlay-transparent-fix";
        style.textContent = `
            html, body, #root {
                background: transparent !important;
                background-color: transparent !important;
            }
            #root::before {
                display: none !important;
                background: transparent !important;
            }
        `;
        document.head.appendChild(style);

        return () => {
            style.remove();
            html.style.background = prevHtmlBackground;
            body.style.background = prevBodyBackground;
            body.style.backgroundColor = prevBodyBackgroundColor;
            if (root) {
                root.style.background = prevRootBackground;
            }
        };
    }, [isOverlayEmbed]);

    // Initialiser les self-timers avec restauration depuis localStorage
    // Se relance à chaque mount (navigation entre pages)
    useEffect(() => {
        const saved = loadTimersFromStorage();
        const now = Date.now();
        const timers = new Map<string, SelfTimer>();

        ZONES.forEach((zone) => {
            zone.timers.forEach((t) => {
                const id = `${zone.name}-${t.label}`;
                const s = saved[id];

                if (s && s.startedAt) {
                    const elapsed = Math.floor((now - s.startedAt) / 1000);
                    const remaining = s.duration - elapsed;
                    if (remaining > 0) {
                        timers.set(id, { id, label: t.label, duration: t.duration, remaining, running: true, intervalId: null, startedAt: s.startedAt });
                    } else {
                        timers.set(id, { id, label: t.label, duration: t.duration, remaining: t.duration, running: false, intervalId: null, startedAt: null });
                    }
                } else {
                    timers.set(id, { id, label: t.label, duration: t.duration, remaining: t.duration, running: false, intervalId: null, startedAt: null });
                }
            });
        });

        setSelfTimers(timers);

        // Démarrer les intervals pour les timers en cours
        const localIntervals = new Map<string, number>();
        timers.forEach((timer, id) => {
            if (timer.running) {
                const intervalId = window.setInterval(() => {
                    setSelfTimers((p) => {
                        const n = new Map(p);
                        const t = n.get(id);
                        if (!t || !t.running) return p;
                        if (t.remaining <= 1) {
                            const ref = intervalsRef.current.get(id);
                            if (ref) { clearInterval(ref); intervalsRef.current.delete(id); }
                            const updated = new Map(n);
                            updated.set(id, { ...t, remaining: t.duration, running: false, intervalId: null, startedAt: null });
                            saveTimersToStorage(updated);
                            return updated;
                        } else {
                            n.set(id, { ...t, remaining: t.remaining - 1 });
                            return n;
                        }
                    });
                }, 1000);
                intervalsRef.current.set(id, intervalId);
                localIntervals.set(id, intervalId);
            }
        });

        // Cleanup au unmount : stopper tous les intervals
        return () => {
            localIntervals.forEach((intervalId) => clearInterval(intervalId));
            localIntervals.forEach((_, id) => intervalsRef.current.delete(id));
        };
    }, []);

    useEffect(() => {
        if (isOverlayEmbed) return;

        let unlisten: (() => void) | undefined;
        const setup = async () => {
            unlisten = await listen<OverlayClosedPayload>("overlay_closed", (event) => {
                if (event.payload?.id !== "pvp") return;
                setIsDetachedToOverlay(false);
            });
        };

        setup().catch(console.error);
        return () => {
            if (unlisten) unlisten();
        };
    }, [isOverlayEmbed]);

    // Fetch cfg.dat via commande Tauri (pas de CORS, pas de proxy, pas de tracking)
    const FALLBACK_CYCLE_START = 1769821187;

    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        setHasError(false);

        const applyCycleStart = (timestamp: number) => {
            setCycleStart(timestamp);
            setPhaseInfo(getPhaseInfo(timestamp));
            setIsLoading(false);
        };

        const invokeWithTimeout = async (timeoutMs: number): Promise<string> => {
            return await new Promise<string>((resolve, reject) => {
                const timeoutId = window.setTimeout(() => {
                    reject(new Error("fetch_contested_zone_timer timeout"));
                }, timeoutMs);

                invoke<string>("fetch_contested_zone_timer")
                    .then((value) => {
                        clearTimeout(timeoutId);
                        resolve(value);
                    })
                    .catch((error) => {
                        clearTimeout(timeoutId);
                        reject(error);
                    });
            });
        };

        try {
            const canUseTauriInvoke = "__TAURI_INTERNALS__" in window;
            if (!canUseTauriInvoke) {
                const cachedCycleStart = loadCycleStartFromCache();
                if (cachedCycleStart !== null) {
                    applyCycleStart(cachedCycleStart);
                } else {
                    applyCycleStart(FALLBACK_CYCLE_START);
                }
                return;
            }

            const text = await invokeWithTimeout(6000);
            const timestamp = parseInt(text.trim(), 10);
            if (isNaN(timestamp)) throw new Error("Invalid timestamp");

            saveCycleStartToCache(timestamp);
            applyCycleStart(timestamp);
        } catch {
            const cachedCycleStart = loadCycleStartFromCache();
            if (cachedCycleStart !== null) {
                applyCycleStart(cachedCycleStart);
            } else {
                applyCycleStart(FALLBACK_CYCLE_START);
            }
        }
    }, []);

    // Fetch initial + re-fetch toutes les heures
    useEffect(() => {
        fetchConfig();
        const interval = setInterval(fetchConfig, 3600000); // 1h
        return () => clearInterval(interval);
    }, [fetchConfig]);

    // Timer principal - mise à jour chaque seconde
    useEffect(() => {
        if (cycleStart === null) return;
        setPhaseInfo(getPhaseInfo(cycleStart));
        const interval = setInterval(() => setPhaseInfo(getPhaseInfo(cycleStart)), 1000);
        return () => clearInterval(interval);
    }, [cycleStart]);

    const startTimer = useCallback((timerId: string) => {
        // D'abord stopper tout interval existant
        const existingInterval = intervalsRef.current.get(timerId);
        if (existingInterval) {
            clearInterval(existingInterval);
            intervalsRef.current.delete(timerId);
        }

        const now = Date.now();
        const intervalId = window.setInterval(() => {
            setSelfTimers((p) => {
                const n = new Map(p);
                const t = n.get(timerId);
                if (!t || !t.running) return p;
                if (t.remaining <= 1) {
                    const ref = intervalsRef.current.get(timerId);
                    if (ref) { clearInterval(ref); intervalsRef.current.delete(timerId); }
                    const updated = new Map(n);
                    updated.set(timerId, { ...t, remaining: t.duration, running: false, intervalId: null, startedAt: null });
                    saveTimersToStorage(updated);
                    return updated;
                } else {
                    n.set(timerId, { ...t, remaining: t.remaining - 1 });
                    return n;
                }
            });
        }, 1000);

        intervalsRef.current.set(timerId, intervalId);
        setSelfTimers((prev) => {
            const next = new Map(prev);
            const timer = next.get(timerId);
            if (!timer || timer.running) return prev;
            next.set(timerId, { ...timer, running: true, intervalId, startedAt: now });
            saveTimersToStorage(next);
            return next;
        });
    }, []);

    const resetTimer = useCallback((timerId: string) => {
        // Toujours utiliser la ref pour stopper l'interval
        const ref = intervalsRef.current.get(timerId);
        if (ref) {
            clearInterval(ref);
            intervalsRef.current.delete(timerId);
        }

        setSelfTimers((prev) => {
            const next = new Map(prev);
            const timer = next.get(timerId);
            if (!timer) return prev;
            next.set(timerId, { ...timer, remaining: timer.duration, running: false, intervalId: null, startedAt: null });
            saveTimersToStorage(next);
            return next;
        });
    }, []);

    const handleOpenOverlay = useCallback(async () => {
        try {
            const overlayUrl = `${window.location.origin}${window.location.pathname}#/pvp-overlay`;
            await invoke("open_overlay", {
                id: "pvp",
                url: overlayUrl,
                x: 120.0,
                y: 120.0,
                width: 900.0,
                height: 760.0,
                opacity: 1.0,
            });
            if (!isOverlayEmbed) {
                setIsDetachedToOverlay(true);
            }
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: "Impossible d'ouvrir l'overlay Zone PVP.",
                variant: "destructive",
            });
        }
    }, [isOverlayEmbed, toast]);

    const isDetachedMode = !isOverlayEmbed && isDetachedToOverlay;

    return (
        <m.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
            className={`flex w-full h-full flex-col p-4 gap-4 overflow-y-auto app-scroll-root ${isOverlayEmbed ? "bg-black/20" : ""}`}
        >
            {!isOverlayEmbed && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-500/10">
                            <IconSwords size={22} className="text-red-500" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold">Zones PVP</h1>
                            <p className="text-xs text-muted-foreground">Contested Zone Timers</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleOpenOverlay}
                            className="h-8 px-2 gap-1.5"
                            title="Detacher en overlay"
                        >
                            <PictureInPicture2 className="h-4 w-4" />
                            <span className="text-xs">Overlay</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={fetchConfig} className="h-8 px-2">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {isDetachedMode ? (
                <div className="flex-1 flex items-center justify-center p-6">
                    <Card className="max-w-md w-full border-border/60 bg-card/70 backdrop-blur-sm">
                        <CardContent className="p-5 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Zone PVP est detachee en overlay pour eviter le rendu en double.
                            </p>
                            <div className="flex items-center justify-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => setIsDetachedToOverlay(false)}>
                                    Recharger dans l'app
                                </Button>
                                <Button variant="default" size="sm" onClick={handleOpenOverlay}>
                                    Re-focus overlay
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            ) : (
                <>
            {/* Timer principal - Executive Hangar */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="p-5">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : hasError ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <p className="text-sm text-muted-foreground">Impossible de charger les données du timer.</p>
                            <Button variant="outline" size="sm" onClick={fetchConfig}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Réessayer
                            </Button>
                        </div>
                    ) : phaseInfo ? (
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-semibold">Executive Hangar</h2>
                                    <Badge variant="outline" className={getPhaseBg(phaseInfo.phase)}>
                                        {phaseInfo.phaseLabel}
                                    </Badge>
                                </div>
                                <Button variant="ghost" size="sm" onClick={fetchConfig} className="h-8 px-2">
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Grand timer - phase en cours */}
                            <div className="flex flex-col items-center justify-center py-4 gap-1">
                                <span className="text-sm text-muted-foreground">
                                    {phaseInfo.phase === "red" ? "Ouverture du Hangar dans" : phaseInfo.phase === "green" ? "Fermeture du Hangar dans" : "Prochain cycle dans"}
                                </span>
                                <span className={`text-5xl font-mono font-bold tracking-wider ${getPhaseColor(phaseInfo.phase)}`}>
                                    {formatTime(phaseInfo.remaining)}
                                </span>
                                <span className="text-xs text-muted-foreground/50 font-mono">
                                    Cycle complet : {formatTime(phaseInfo.cycleRemaining)}
                                </span>
                            </div>

                            {/* Barre de progression */}
                            <div className="w-full">
                                <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary/50">
                                    <div
                                        className={`h-full transition-all duration-1000 rounded-full ${
                                            phaseInfo.phase === "red" ? "bg-red-500" :
                                            phaseInfo.phase === "green" ? "bg-green-500" :
                                            "bg-yellow-500"
                                        }`}
                                        style={{ width: `${getProgressPercent(phaseInfo.phase, phaseInfo.remaining)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground/60">
                                    <span>Rouge: 2h</span>
                                    <span>Vert: 1h</span>
                                    <span>Reset: 5min</span>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {/* Self-Timers par zone */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {ZONES.map((zone) => (
                    <Card key={zone.name} className={`border bg-card/50 backdrop-blur-sm ${getZoneAccent(zone.color)}`}>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge variant="outline" className={`text-xs ${getZoneBadge(zone.color)}`}>
                                    {zone.name}
                                </Badge>
                            </div>

                            <div className="grid gap-1.5">
                                {zone.timers.map((t) => {
                                    const id = `${zone.name}-${t.label}`;
                                    const timer = selfTimers.get(id);
                                    if (!timer) return null;

                                    const isComplete = timer.remaining === 0 && !timer.running;
                                    const progress = timer.running || isComplete
                                        ? ((timer.duration - timer.remaining) / timer.duration) * 100
                                        : 0;

                                    return (
                                        <div
                                            key={id}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors ${
                                                timer.running ? "bg-white/5" : isComplete ? "bg-green-500/5" : "hover:bg-white/3"
                                            }`}
                                        >
                                            {/* Boutons */}
                                            <div className="flex gap-0.5">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    onClick={() => startTimer(id)}
                                                    disabled={timer.running}
                                                    title="Démarrer"
                                                >
                                                    <Play className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    onClick={() => resetTimer(id)}
                                                    title="Réinitialiser"
                                                >
                                                    <RotateCcw className="h-3 w-3" />
                                                </Button>
                                            </div>

                                            {/* Label */}
                                            <span className="text-xs text-muted-foreground flex-1 truncate">
                                                {t.label}
                                            </span>

                                            {/* Mini barre de progression */}
                                            {(timer.running || isComplete) && (
                                                <div className="w-12 h-1 rounded-full bg-secondary/50 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-1000 ${
                                                            isComplete ? "bg-green-500" :
                                                            timer.remaining <= 180 ? "bg-yellow-500" :
                                                            "bg-red-400"
                                                        }`}
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                            )}

                                            {/* Temps restant */}
                                            <span className={`text-xs font-mono w-12 text-right ${getTimerColor(timer.remaining, timer.running || isComplete)}`}>
                                                {formatTimeShort(timer.remaining)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Maps des zones */}
            <div className="flex items-center gap-2 mt-2">
                <MapIcon className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Cartes des zones</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {MAPS.map((map) => (
                    <button
                        key={map.name}
                        onClick={() => setSelectedMap(map.url)}
                        className="group relative rounded-lg overflow-hidden border border-border/50 hover:border-primary/50 transition-all duration-200 bg-card/50"
                    >
                        <img
                            src={map.url}
                            alt={`Carte ${map.name}`}
                            className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                        />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                            <span className="text-xs font-medium text-white">{map.name}</span>
                        </div>
                    </button>
                ))}
            </div>

            {/* Lightbox */}
            {selectedMap && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                    role="button"
                    tabIndex={0}
                    aria-label="Fermer la carte"
                    onClick={() => setSelectedMap(null)}
                    onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setSelectedMap(null); }}
                >
                    <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-4 right-4 h-8 w-8 p-0 text-white hover:bg-white/20"
                        onClick={() => setSelectedMap(null)}
                    >
                        <X className="h-5 w-5" />
                    </Button>
                    <img
                        src={selectedMap}
                        alt="Carte agrandie"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            {/* Crédit */}
            <p className="text-[10px] text-muted-foreground/40 text-center pb-2">
                Données & cartes : contestedzonetimers.com
            </p>
                </>
            )}
        </m.div>
    );
}
