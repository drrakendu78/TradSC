import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Download,
    FileText,
    Info,
    Loader2,
    Power,
    Radar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface BlueprintEntry {
    productName: string;
    ts: number;
}

interface StoreFile {
    schemaVersion: number;
    blueprints: BlueprintEntry[];
}

interface WatcherStatus {
    watching: boolean;
    logPath: string | null;
    blueprintCount: number;
}

interface ImportResult {
    imported: number;
    total: number;
    filesScanned: number;
    matchesFound: number;
    filesWithMatches: number;
    uniqueProductsFound: number;
    filesFailed: number;
    logDirectory: string;
    gameLogPath: string;
    readErrors: string[];
}

type LogLevel = "info" | "success" | "warn" | "error";
interface LogEntry {
    level: LogLevel;
    message: string;
    ts: number;
}

const MAX_LOGS = 40;

function formatRelativeTs(tsSeconds: number): string {
    const date = new Date(tsSeconds * 1000);
    if (isNaN(date.getTime())) return "—";
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return "à l'instant";
    if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
    if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`;
    return date.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatLogTime(tsMs: number): string {
    const d = new Date(tsMs);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const LEVEL_STYLES: Record<LogLevel, { icon: React.ElementType; color: string }> = {
    info: { icon: Info, color: "text-muted-foreground" },
    success: { icon: CheckCircle2, color: "text-emerald-300" },
    warn: { icon: AlertCircle, color: "text-amber-300" },
    error: { icon: AlertCircle, color: "text-red-300" },
};

export function AutoDetectCard() {
    const { toast } = useToast();
    const [status, setStatus] = useState<WatcherStatus>({
        watching: false,
        logPath: null,
        blueprintCount: 0,
    });
    const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [busy, setBusy] = useState<null | "toggle" | "import">(null);
    const [expanded, setExpanded] = useState(true);
    const [logExpanded, setLogExpanded] = useState(false);
    const [listExpanded, setListExpanded] = useState(false);
    const logsRef = useRef<HTMLDivElement>(null);

    // Refresh status + blueprints (autoStart est géré dans le panneau Paramètres → Services)
    const refresh = useCallback(async () => {
        try {
            const [s, store] = await Promise.all([
                invoke<WatcherStatus>("gamelog_watcher_status"),
                invoke<StoreFile>("gamelog_blueprints_load"),
            ]);
            setStatus(s);
            setBlueprints(store.blueprints ?? []);
        } catch (e) {
            console.warn("[gamelog-bp] refresh failed:", e);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Listen to backend events
    useEffect(() => {
        const unlistenLog = listen<LogEntry>("gamelog-watcher:log", (event) => {
            setLogs((prev) => {
                const next = [...prev, event.payload];
                return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
            });
        });
        const unlistenBlueprint = listen<BlueprintEntry>("gamelog-watcher:blueprint", (event) => {
            setBlueprints((prev) => {
                if (prev.some((b) => b.productName === event.payload.productName)) return prev;
                const next = [event.payload, ...prev];
                return next.sort((a, b) => b.ts - a.ts);
            });
            setStatus((prev) => ({ ...prev, blueprintCount: prev.blueprintCount + 1 }));
            toast({
                title: "Nouveau schéma détecté",
                description: event.payload.productName,
            });
        });
        // Sync entre les multiples instances du composant (page Blueprints +
        // overlay détaché + sidebar Paramètres → Services). Quand n'importe
        // quelle instance déclenche start/stop, le backend émet
        // `gamelog-watcher:status_changed` et toutes les instances refresh
        // leur statut pour montrer le bon badge Actif/Arrêté et le bon
        // bouton Démarrer/Arrêter sans poll.
        const unlistenStatus = listen<boolean>("gamelog-watcher:status_changed", () => {
            refresh();
        });
        return () => {
            unlistenLog.then((f) => f());
            unlistenBlueprint.then((f) => f());
            unlistenStatus.then((f) => f());
        };
    }, [toast, refresh]);

    // Auto-scroll log feed to bottom on new entry
    useEffect(() => {
        if (logExpanded && logsRef.current) {
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
        }
    }, [logs, logExpanded]);

    const toggleWatcher = useCallback(async () => {
        setBusy("toggle");
        try {
            if (status.watching) {
                await invoke("gamelog_watcher_stop");
            } else {
                await invoke("gamelog_watcher_start");
            }
            await refresh();
        } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            toast({
                title: status.watching ? "Arrêt impossible" : "Démarrage impossible",
                description: msg,
                variant: "destructive",
            });
        } finally {
            setBusy(null);
        }
    }, [status.watching, refresh, toast]);

    const importHistory = useCallback(async () => {
        setBusy("import");
        try {
            const result = await invoke<ImportResult>("gamelog_blueprints_import_history", {
                includeCurrent: true,
            });
            await refresh();
            const desc =
                result.imported > 0
                    ? `${result.imported} schéma${result.imported > 1 ? "s" : ""} ajouté${result.imported > 1 ? "s" : ""} (${result.uniqueProductsFound} unique${result.uniqueProductsFound > 1 ? "s" : ""} trouvé${result.uniqueProductsFound > 1 ? "s" : ""} dans ${result.filesWithMatches}/${result.filesScanned} fichier${result.filesScanned > 1 ? "s" : ""})`
                    : `Aucun nouveau schéma trouvé (${result.filesScanned} fichier${result.filesScanned > 1 ? "s" : ""} scanné${result.filesScanned > 1 ? "s" : ""}). Si tu as déjà débloqué des schémas en jeu, ils sont peut-être dans des sessions plus anciennes que tes logbackups actuels.`;
            toast({
                title: "Import terminé",
                description: desc,
            });
        } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            toast({
                title: "Import échoué",
                description: msg,
                variant: "destructive",
            });
        } finally {
            setBusy(null);
        }
    }, [refresh, toast]);

    const recentBlueprints = useMemo(() => blueprints.slice(0, 50), [blueprints]);

    return (
        <section className="relative overflow-hidden rounded-xl border border-border/20 bg-background/[0.03] backdrop-blur-md">
            {/* Header compact : icône + titre + statut + actions principales sur 1 ligne */}
            <div className="relative flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Radar className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                    <h2 className="shrink-0 text-xs font-semibold tracking-tight">
                        Auto-détection
                    </h2>
                    <Badge
                        variant="outline"
                        className={`h-4 shrink-0 px-1 text-[9px] ${
                            status.watching
                                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                                : "border-border/30 bg-background/10 text-muted-foreground"
                        }`}
                    >
                        {status.watching ? "Actif" : "Arrêté"}
                    </Badge>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {status.blueprintCount} détecté{status.blueprintCount > 1 ? "s" : ""}
                    </span>
                    <span
                        className="hidden min-w-0 flex-1 truncate font-mono text-[9.5px] text-muted-foreground/60 md:inline"
                        title={status.logPath ?? "non détecté"}
                    >
                        {status.logPath ?? "Game.log non détecté"}
                    </span>
                </div>
                {/* Actions toujours visibles, contrastées */}
                <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                        size="sm"
                        variant={status.watching ? "secondary" : "default"}
                        onClick={toggleWatcher}
                        disabled={busy !== null}
                        className="h-7 gap-1 px-2 text-[11px]"
                    >
                        {busy === "toggle" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Power className="h-3 w-3" />
                        )}
                        {status.watching ? "Arrêter" : "Démarrer"}
                    </Button>
                    <Button
                        size="sm"
                        variant="default"
                        onClick={importHistory}
                        disabled={busy !== null}
                        className="h-7 gap-1 px-2 text-[11px]"
                    >
                        {busy === "import" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Download className="h-3 w-3" />
                        )}
                        Importer
                    </Button>
                    <button
                        onClick={() => setExpanded((v) => !v)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background/20 hover:text-foreground"
                        title={expanded ? "Masquer les détails" : "Afficher les détails"}
                    >
                        {expanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="relative border-t border-border/15 px-3 py-1.5">
                    {/* Compteurs collapse en ligne (autostart dans Paramètres → Services) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                        <button
                            onClick={() => setLogExpanded((v) => !v)}
                            className="flex items-center gap-1 hover:text-foreground"
                        >
                            <Activity className="h-2.5 w-2.5" />
                            Activité ({logs.length})
                            {logExpanded ? (
                                <ChevronUp className="h-2.5 w-2.5" />
                            ) : (
                                <ChevronDown className="h-2.5 w-2.5" />
                            )}
                        </button>
                        <span className="text-border/40">·</span>
                        <button
                            onClick={() => setListExpanded((v) => !v)}
                            className="flex items-center gap-1 hover:text-foreground"
                        >
                            <FileText className="h-2.5 w-2.5" />
                            Schémas ({blueprints.length})
                            {listExpanded ? (
                                <ChevronUp className="h-2.5 w-2.5" />
                            ) : (
                                <ChevronDown className="h-2.5 w-2.5" />
                            )}
                        </button>
                    </div>

                    {/* Activity feed */}
                    {logExpanded && (
                        <div
                            ref={logsRef}
                            className="mt-1.5 max-h-32 overflow-y-auto rounded-md border border-border/20 bg-background/10 px-2 py-1 font-mono text-[10px]"
                        >
                            {logs.length === 0 ? (
                                <div className="py-1.5 text-center text-muted-foreground/70">
                                    Aucune activité. Démarre la surveillance pour voir le watcher tourner.
                                </div>
                            ) : (
                                logs.map((log, i) => {
                                    const { icon: Icon, color } = LEVEL_STYLES[log.level];
                                    return (
                                        <div
                                            key={`${log.ts}-${i}`}
                                            className="flex items-start gap-1.5 py-0.5"
                                        >
                                            <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                                                {formatLogTime(log.ts)}
                                            </span>
                                            <Icon className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${color}`} />
                                            <span className={`min-w-0 break-words ${color}`}>
                                                {log.message}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}

                    {/* Detected blueprints list */}
                    {listExpanded && (
                        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border/20 bg-background/10">
                            {recentBlueprints.length === 0 ? (
                                <div className="px-2 py-2 text-center text-[10.5px] text-muted-foreground/70">
                                    Aucun schéma détecté pour l'instant. Lance la surveillance ou clique sur « Importer ».
                                </div>
                            ) : (
                                <ul className="divide-y divide-border/15">
                                    {recentBlueprints.map((b) => (
                                        <li
                                            key={`${b.productName}-${b.ts}`}
                                            className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]"
                                        >
                                            <span className="truncate">{b.productName}</span>
                                            <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                                                {formatRelativeTs(b.ts)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
