/**
 * Page "Carnet de bord" — vue principale rendue dans le drawer slide-in.
 *
 * Données réelles : `useLogbookStats()` → commandes Rust `gamelog_history_scan`
 * + `gamelog_history_stats` (parser de `logbackups/`). Plus de mock. Les éléments
 * interactifs suivent la checklist UX [[UX Checklist - Carnet de bord v1]] du
 * wiki — pas de placeholder mort en prod.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import html2canvas from "html2canvas";
import { useToast } from "@/hooks/use-toast";
import { isTauri } from "@/utils/tauri-helpers";
import {
    BookOpen,
    ArrowRight,
    Calendar,
    Download,
    Clock,
    Gauge,
    MapPin,
    CalendarDays,
    Ship,
    TrendingUp,
    History,
    Crosshair,
    Book,
    Medal,
    Hourglass,
    Zap,
    Swords,
    Flame,
    Moon,
    Users,
    TrendingDown,
    Orbit,
    Lock,
    Sun,
    Route as RouteIcon,
    Skull,
    AlertTriangle,
    IdCard,
    Pickaxe,
    Package,
    Compass,
    MoreHorizontal,
    Trophy,
    Rocket,
    Globe,
    Award,
    Crown,
    Heart,
    Shield,
    Swords as SwordsIcon,
    X as XIcon,
    ExternalLink,
    Pencil,
    Check,
    Loader2,
} from "lucide-react";
import { useEncounteredPlayers } from "@/hooks/useEncounteredPlayers";
import type { LogbookStats } from "@/lib/logbook-types";
import { useLogbookStats, type LogbookPhase } from "@/hooks/useLogbookStats";

// ── helpers de formatage ──────────────────────────────────────────────────

const formatHoursMinutes = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, "0")}min`;
};

const formatDateFr = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};

const formatTimeFr = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

const formatShortDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

// ── ICÔNES dynamiques (mapping pour mock) ─────────────────────────────────
// On évite d'importer 80 icônes ; on lookup juste celles utilisées en data dynamique.
const iconByName: Record<string, React.ComponentType<{ className?: string }>> = {
    crosshair: Crosshair,
    "alert-triangle": AlertTriangle,
    "trending-down": TrendingDown,
    flame: Flame,
    zap: Zap,
    pickaxe: Pickaxe,
    package: Package,
    compass: Compass,
    "more-horizontal": MoreHorizontal,
    rocket: Rocket,
    globe: Globe,
    award: Award,
    hourglass: Hourglass,
};

const DynamicIcon = ({ name, className }: { name: string; className?: string }) => {
    const Cmp = iconByName[name];
    return Cmp ? <Cmp className={className} /> : null;
};

// ── sous-composants ───────────────────────────────────────────────────────

interface SectionProps {
    stats: LogbookStats;
}

// ── 1. Header sobre style "console de bord" Star Citizen ──────────────────
interface HeaderProps {
    onClose: () => void;
    onExport?: () => void;
}
const Header = ({ onClose, onExport }: HeaderProps) => (
    <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 border-b border-white/10 sticky top-0 z-20 bg-[hsl(var(--background)/0.55)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-zinc-400" />
            <h2 className="text-base font-semibold text-white tracking-tight">Mon carnet de bord</h2>
        </div>

        <div className="flex items-center gap-2">
            {onExport && (
                <button
                    type="button"
                    onClick={onExport}
                    title="Capture toute la page en image PNG"
                    aria-label="Exporter le carnet en image"
                    className="group flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 text-xs font-medium text-zinc-200 transition-all duration-200 hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                    <Download className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-y-px" />
                    Exporter image
                </button>
            )}
            <button
                type="button"
                onClick={onClose}
                title="Fermer (Échap)"
                aria-label="Fermer le carnet de bord"
                className="group flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-zinc-400 transition-all duration-200 hover:bg-white/10 hover:text-white"
            >
                <svg className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
                </svg>
            </button>
        </div>
    </header>
);

// ── 2. Bannière dernière session ──────────────────────────────────────────
const LastSession = ({ stats }: SectionProps) => {
    const { lastSession, streakDays, streakRecordDays } = stats;
    const { toast } = useToast();
    const handleResume = async () => {
        try {
            await invoke("launch_rsi_launcher");
            toast({
                title: "RSI Launcher lancé",
                description: "Le launcher Star Citizen a été ouvert.",
            });
        } catch (error: any) {
            toast({
                title: "Erreur",
                description: error || "Impossible de lancer le RSI Launcher",
                variant: "destructive",
            });
        }
    };
    return (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/[0.08] via-violet-500/[0.06] to-transparent backdrop-blur-md p-5">
            <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none" />
            <div className="relative flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-xl border border-cyan-500/30 bg-cyan-500/15 flex items-center justify-center text-cyan-400 flex-shrink-0">
                        <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
                                Dernière session
                            </span>
                            {/* Streak chip migré du header → ici (info perso liée à l'activité) */}
                            <span
                                className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-orange-300 font-semibold"
                                title={`${streakDays} jours consécutifs · Record : ${streakRecordDays} jours`}
                            >
                                <Flame className="w-2.5 h-2.5" /> {streakDays} jours d'affilée
                            </span>
                        </div>
                        <div className="text-sm text-zinc-200 leading-snug">
                            {lastSession ? (
                                <>
                                    Le <span className="text-white font-semibold">{formatDateFr(lastSession.date)}</span>,
                                    vous avez passé{" "}
                                    <span className="text-cyan-300 font-semibold">
                                        {formatHoursMinutes(lastSession.durationMinutes)}
                                    </span>
                                    {lastSession.vehicle && lastSession.vehicle !== "Inconnu" && (
                                        <> aux commandes d'un <span className="text-sky-300 font-semibold">{lastSession.vehicle}</span></>
                                    )}
                                    {lastSession.location && lastSession.location !== "Inconnue" && (
                                        <> autour de <span className="text-violet-300 font-semibold">{lastSession.location}</span></>
                                    )}
                                    .
                                </>
                            ) : (
                                "Pas encore de session complète enregistrée. Lance Star Citizen pour commencer ton carnet."
                            )}
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleResume}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-zinc-300 transition-colors flex-shrink-0"
                    title="Lancer le RSI Launcher"
                >
                    <ArrowRight className="w-3.5 h-3.5" /> Reprendre
                </button>
            </div>
        </div>
    );
};

// ── 3. KPI Row ────────────────────────────────────────────────────────────
const KpiRow = ({ stats }: SectionProps) => (
    <div className="grid grid-cols-4 gap-4">
        <KpiCard
            label="Temps Total"
            value={`${stats.totalHours}`}
            unit="h"
            sub={`${stats.sessionCount} sessions enregistrées`}
            icon={Clock}
            color="emerald"
            onClick={() => scrollToId("logbook-monthly")}
            title="Voir l'évolution mensuelle"
        />
        <KpiCard
            label="Vaisseaux Pilotés"
            value={`${stats.uniqueVehicleCount}`}
            sub={`Répartis sur ${stats.vehicleCategoryCount} catégories`}
            icon={Gauge}
            color="sky"
            onClick={() => scrollToId("logbook-top-vehicles")}
            title="Voir le top vaisseaux"
        />
        <KpiCard
            label="Lieux Visités"
            value={`${stats.uniqueZoneCount}`}
            sub={`${stats.systemsVisited.length} systèmes parcourus (${stats.systemsVisited.join(" · ")})`}
            icon={MapPin}
            color="violet"
            onClick={() => scrollToId("logbook-top-locations")}
            title="Voir le top lieux"
        />
        <KpiCard
            label="Patches Traversés"
            value={`${stats.patchesTraversed}`}
            sub={`Enregistré depuis SC ${stats.firstPatchSeen}`}
            icon={CalendarDays}
            color="amber"
            title={`Enregistré depuis SC ${stats.firstPatchSeen}`}
        />
    </div>
);

// Palette pré-déclarée : Tailwind ne peut pas générer les classes construites en
// runtime (ex `bg-${color}-500`), donc on met toutes les variantes en strings
// littérales pour qu'elles soient détectées par le scanner Tailwind au build.
const COLOR_MAP = {
    emerald: {
        text: "text-emerald-400", iconBg: "bg-emerald-500/10", iconBorder: "border-emerald-500/20",
        iconBorder30: "border-emerald-500/30", iconBg15: "bg-emerald-500/15",
        bar: "bg-emerald-500", bar80: "bg-emerald-500/80",
        glow: "shadow-[0_0_8px_rgba(16,185,129,0.6)]",
        unit: "text-emerald-500/80", hover: "hover:border-emerald-500/30",
    },
    sky: {
        text: "text-sky-400", iconBg: "bg-sky-500/10", iconBorder: "border-sky-500/20",
        iconBorder30: "border-sky-500/30", iconBg15: "bg-sky-500/15",
        bar: "bg-sky-500", bar80: "bg-sky-500/80",
        glow: "shadow-[0_0_8px_rgba(14,165,233,0.6)]",
        unit: "text-sky-500/80", hover: "hover:border-sky-500/30",
    },
    violet: {
        text: "text-violet-400", iconBg: "bg-violet-500/10", iconBorder: "border-violet-500/20",
        iconBorder30: "border-violet-500/30", iconBg15: "bg-violet-500/15",
        bar: "bg-violet-500", bar80: "bg-violet-500/80",
        glow: "shadow-[0_0_8px_rgba(139,92,246,0.6)]",
        unit: "text-violet-500/80", hover: "hover:border-violet-500/30",
    },
    amber: {
        text: "text-amber-400", iconBg: "bg-amber-500/10", iconBorder: "border-amber-500/20",
        iconBorder30: "border-amber-500/30", iconBg15: "bg-amber-500/15",
        bar: "bg-amber-500", bar80: "bg-amber-500/80",
        glow: "shadow-[0_0_8px_rgba(245,158,11,0.6)]",
        unit: "text-amber-500/80", hover: "hover:border-amber-500/30",
    },
    cyan: {
        text: "text-cyan-400", iconBg: "bg-cyan-500/10", iconBorder: "border-cyan-500/20",
        iconBorder30: "border-cyan-500/30", iconBg15: "bg-cyan-500/15",
        bar: "bg-cyan-500", bar80: "bg-cyan-500/80",
        glow: "shadow-[0_0_8px_rgba(34,211,238,0.6)]",
        unit: "text-cyan-500/80", hover: "hover:border-cyan-500/30",
    },
    rose: {
        text: "text-rose-400", iconBg: "bg-rose-500/10", iconBorder: "border-rose-500/20",
        iconBorder30: "border-rose-500/30", iconBg15: "bg-rose-500/15",
        bar: "bg-rose-500", bar80: "bg-rose-500/80",
        glow: "shadow-[0_0_8px_rgba(244,63,94,0.6)]",
        unit: "text-rose-500/80", hover: "hover:border-rose-500/30",
    },
    orange: {
        text: "text-orange-400", iconBg: "bg-orange-500/10", iconBorder: "border-orange-500/20",
        iconBorder30: "border-orange-500/30", iconBg15: "bg-orange-500/15",
        bar: "bg-orange-500", bar80: "bg-orange-500/80",
        glow: "shadow-[0_0_8px_rgba(249,115,22,0.6)]",
        unit: "text-orange-500/80", hover: "hover:border-orange-500/30",
    },
    indigo: {
        text: "text-indigo-400", iconBg: "bg-indigo-500/10", iconBorder: "border-indigo-500/20",
        iconBorder30: "border-indigo-500/30", iconBg15: "bg-indigo-500/15",
        bar: "bg-indigo-500", bar80: "bg-indigo-500/80",
        glow: "shadow-[0_0_8px_rgba(99,102,241,0.6)]",
        unit: "text-indigo-500/80", hover: "hover:border-indigo-500/30",
    },
    zinc: {
        text: "text-zinc-400", iconBg: "bg-zinc-500/10", iconBorder: "border-zinc-500/20",
        iconBorder30: "border-zinc-500/30", iconBg15: "bg-zinc-500/15",
        bar: "bg-zinc-500", bar80: "bg-zinc-500/80",
        glow: "",
        unit: "text-zinc-500/80", hover: "hover:border-zinc-500/30",
    },
} as const;

type ColorKey = keyof typeof COLOR_MAP;

interface KpiCardProps {
    label: string;
    value: string;
    unit?: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    color: ColorKey;
    onClick?: () => void;
    title?: string;
}
const KpiCard = ({ label, value, unit, sub, icon: Icon, color, onClick, title }: KpiCardProps) => {
    const c = COLOR_MAP[color];
    const interactive = !!onClick;
    return (
        <div
            className={`bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 relative overflow-hidden group ${interactive ? "cursor-pointer text-left w-full hover:border-white/20 transition-colors" : ""}`}
            onClick={onClick}
            onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            title={title}
        >
            <div className={`absolute inset-x-0 bottom-0 h-0.5 ${c.bar80} w-0 group-hover:w-full transition-all duration-500`} />
            <div className="flex justify-between items-start mb-2">
                <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">{label}</div>
                <div className={`w-7 h-7 rounded-lg border ${c.iconBorder} ${c.iconBg} flex items-center justify-center ${c.text}`}>
                    <Icon className="w-4 h-4" />
                </div>
            </div>
            <div className="text-3xl font-light text-white mb-1 tracking-tight">
                {value}
                {unit && <span className={`text-lg font-normal ${c.unit}`}> {unit}</span>}
            </div>
            <div className={`w-12 h-0.5 ${c.bar} rounded-full mb-3 ${c.glow}`} />
            <div className="text-[11px] text-zinc-400 border-t border-white/5 pt-2">{sub}</div>
        </div>
    );
};

// Scroll fluide vers une section drill-down par id (utilisé par les cartes KPI).
const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ── 4. Heatmap activité ───────────────────────────────────────────────────
const Heatmap = ({ stats }: SectionProps) => {
    const cells = useMemo(() => {
        // 52 semaines × 7 jours, on rend en grid-rows-7 grid-flow-col
        return stats.heatmap.map((hours, i) => {
            const cls =
                hours === 0
                    ? "bg-white/10 border border-white/10"
                    : hours < 1
                    ? "bg-emerald-500/25 border border-emerald-500/30"
                    : hours < 3
                    ? "bg-emerald-500/55 border border-emerald-500/50"
                    : "bg-emerald-500/90 border border-emerald-500/80 shadow-[0_0_5px_rgba(16,185,129,0.45)]";
            return { hours, cls, i };
        });
    }, [stats.heatmap]);

    // Labels des 12 mois glissants finissant au mois courant : la heatmap couvre
    // les 364 derniers jours jusqu'à aujourd'hui, donc les libellés doivent rouler.
    const months = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        return Array.from({ length: 12 }, (_, idx) => {
            const offset = 11 - idx;
            return new Date(year, month - offset, 1).toLocaleDateString("fr-FR", { month: "short" });
        });
    }, []);

    return (
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 group hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                        <Calendar className="w-4 h-4" />
                    </div>
                    <h3 className="text-base font-semibold text-white tracking-tight">
                        Activité <span className="text-sm font-normal text-zinc-400 ml-1">(12 derniers mois)</span>
                    </h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>Moins</span>
                    <div className="flex gap-1">
                        <div className="w-3 h-3 rounded-[3px] bg-white/10 border border-white/10" />
                        <div className="w-3 h-3 rounded-[3px] bg-emerald-500/30 border border-emerald-500/20" />
                        <div className="w-3 h-3 rounded-[3px] bg-emerald-500/60 border border-emerald-500/40" />
                        <div className="w-3 h-3 rounded-[3px] bg-emerald-500/90 border border-emerald-500/60 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                    </div>
                    <span>Plus</span>
                </div>
            </div>

            <div className="w-full pb-2">
                <div className="flex gap-2">
                    {/* Labels jours à gauche */}
                    <div className="grid grid-rows-7 gap-[3px] pt-[18px] text-[9px] text-zinc-500 select-none">
                        {["L", "", "M", "", "V", "", ""].map((d, i) => (
                            <div key={i} className="h-3 leading-3">{d}</div>
                        ))}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="relative h-[15px] text-[9px] text-zinc-500 select-none flex justify-between px-1">
                            {months.map((m, i) => (
                                <span key={i}>{m}</span>
                            ))}
                        </div>
                        <div className="grid grid-rows-7 grid-flow-col gap-[3px]">
                            {cells.map((c) => (
                                <div
                                    key={c.i}
                                    className={`w-3 h-3 rounded-[2px] ${c.cls}`}
                                    title={c.hours === 0 ? "Aucune session" : `${c.hours.toFixed(1)}h de jeu`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                <div className="text-[11px] text-zinc-400 font-medium">
                    Pic d'activité : <span className="text-zinc-200">{formatDateFr(stats.peakDay.date)}</span>{" "}
                    <span className="mx-1">•</span>{" "}
                    <span className="text-zinc-200">{stats.peakDay.hours.toFixed(1)}h</span> en 24h
                </div>
            </div>
        </div>
    );
};

// ── 5. Top vaisseaux + Top lieux ──────────────────────────────────────────
// `metric` choisit le champ réel à afficher : on n'expose JAMAIS le `hours` du
// backend qui est fabriqué (events÷2 pour les vaisseaux, visits÷4 pour les lieux).
// "sessions" → vaisseaux (sorties), "visits" → lieux (passages).
type TopMetric = "sessions" | "visits";
interface TopListProps {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    color: ColorKey;
    metric: TopMetric;
    items: Array<{ name: string; hours: number; sessions?: number; visits?: number }>;
    id?: string;
}
const TopList = ({ title, icon: Icon, color, metric, items, id }: TopListProps) => {
    const c = COLOR_MAP[color];
    const TOP_COUNT = 5;
    const [expanded, setExpanded] = useState(false);
    const valueOf = (it: { sessions?: number; visits?: number }) =>
        (metric === "sessions" ? it.sessions : it.visits) ?? 0;
    const unitLabel = (n: number) =>
        metric === "sessions" ? `${n} ${n > 1 ? "sorties" : "sortie"}` : `${n} ${n > 1 ? "passages" : "passage"}`;
    const max = Math.max(1, ...items.map((x) => valueOf(x)));
    const visible = expanded ? items : items.slice(0, TOP_COUNT);
    const hiddenCount = items.length - TOP_COUNT;
    return (
        <div id={id} className={`bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 group ${c.hover} transition-colors`}>
            <div className="flex items-center gap-3 mb-5">
                <div className={`w-8 h-8 rounded-lg border ${c.iconBorder} ${c.iconBg} flex items-center justify-center ${c.text}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">{title}</h3>
                <span className="ml-auto text-[10px] text-zinc-500 tabular-nums">{items.length} au total</span>
            </div>
            <div className={`space-y-4 ${expanded ? "max-h-[420px] overflow-y-auto pr-1" : ""}`}>
                {visible.map((it, idx) => {
                    const value = valueOf(it);
                    const pct = Math.max(4, (value / max) * 100);
                    return (
                        <div key={idx} title={`${it.name} · ${unitLabel(value)}`}>
                            <div className="flex justify-between items-center mb-1.5">
                                <div className="text-sm font-medium text-zinc-200">{it.name}</div>
                                <div className="text-xs text-zinc-400 tabular-nums">{unitLabel(value)}</div>
                            </div>
                            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${c.bar80} rounded-full ${idx === 0 && !expanded ? c.glow : ""}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
            {hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className={`mt-4 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:${c.text.replace("text-", "text-")} transition-colors flex items-center justify-center gap-1.5`}
                >
                    {expanded ? "Masquer" : `Voir les ${hiddenCount} autres`}
                </button>
            )}
        </div>
    );
};

// ── 6. Évolution mensuelle (SVG line chart) ───────────────────────────────
const MonthlyChart = ({ stats }: SectionProps) => {
    const { monthlyEvolution } = stats;
    const w = 720;
    const h = 180;
    const padX = 20;
    const padY = 20;

    // 0 mois → état vide (évite des coordonnées SVG NaN qui crashent le rendu).
    if (monthlyEvolution.length === 0) {
        return (
            <div id="logbook-monthly" className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                        <TrendingUp className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Évolution mensuelle</h3>
                </div>
                <div className="text-zinc-500 text-sm py-4 text-center">Pas encore assez d'historique pour tracer une courbe.</div>
            </div>
        );
    }

    const max = Math.max(1, ...monthlyEvolution.map((x) => x.hours));
    const peakIdx = monthlyEvolution.findIndex((x) => x.hours === max);
    // 1 seul mois → stepX serait une division par 0 → on centre le point unique.
    const single = monthlyEvolution.length === 1;
    const stepX = single ? 0 : (w - padX * 2) / (monthlyEvolution.length - 1);
    const yScale = (v: number) => h - padY - ((h - padY * 2) * v) / max;

    const points = monthlyEvolution.map((m, i) => ({
        x: single ? w / 2 : padX + i * stepX,
        y: yScale(m.hours),
        ...m,
    }));

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const areaPath = `${path} L ${points[points.length - 1].x} ${h - padY} L ${points[0].x} ${h - padY} Z`;

    return (
        <div id="logbook-monthly" className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 group hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <TrendingUp className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Évolution mensuelle</h3>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h + 20}`} className="overflow-visible">
                <defs>
                    <linearGradient id="evol-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(34 211 238 / 0.5)" />
                        <stop offset="100%" stopColor="rgb(34 211 238 / 0)" />
                    </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#evol-grad)" />
                <path d={path} fill="none" stroke="rgb(34 211 238)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {points.map((p, i) => (
                    <g key={i}>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={i === peakIdx ? 5 : 3}
                            fill={i === peakIdx ? "rgb(34 211 238)" : "rgb(255 255 255 / 0.6)"}
                            stroke={i === peakIdx ? "rgb(34 211 238 / 0.3)" : "transparent"}
                            strokeWidth={i === peakIdx ? 4 : 0}
                        >
                            <title>{`${p.monthLabel} · ${p.hours}h`}</title>
                        </circle>
                        <text x={p.x} y={h + 15} textAnchor="middle" fontSize="10" fill="rgb(115 115 115)">
                            {p.monthLabel}
                        </text>
                        {i === peakIdx && (
                            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="10" fill="rgb(34 211 238)" fontWeight="600">
                                {p.hours}h
                            </text>
                        )}
                    </g>
                ))}
            </svg>
        </div>
    );
};

// ── 7. Dernières sessions ─────────────────────────────────────────────────
const RecentSessions = ({ stats }: SectionProps) => {
    const TOP_COUNT = 5;
    const [expanded, setExpanded] = useState(false);
    const sessions = stats.recentSessions;
    const visible = expanded ? sessions : sessions.slice(0, TOP_COUNT);
    const hiddenCount = sessions.length - TOP_COUNT;
    return (
    <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 group hover:border-amber-500/30 transition-colors">
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <History className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Dernières sessions</h3>
            </div>
            <span className="text-[10px] text-zinc-500 tabular-nums">{sessions.length} dernières</span>
        </div>
        <div className={expanded ? "max-h-[520px] overflow-y-auto pr-1 -mr-1" : ""}>
            {visible.map((s, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] -mx-4 px-4 rounded-lg transition-colors"
                    title={`${formatDateFr(s.startedAt)} ${formatTimeFr(s.startedAt)} · ${formatHoursMinutes(s.durationMinutes)}`}
                >
                    <div className="text-xs text-zinc-400 w-28 flex-shrink-0">
                        <div className="text-zinc-300 font-medium">{formatShortDate(s.startedAt)}</div>
                        <div>{formatTimeFr(s.startedAt)}</div>
                    </div>
                    <div className="text-xs text-zinc-300 rounded-full border border-white/10 px-2 py-0.5 flex-shrink-0">
                        {formatHoursMinutes(s.durationMinutes)}
                    </div>
                    <div className="flex gap-2 flex-1 flex-wrap">
                        {s.vehicles.map((v, vi) => (
                            <span
                                key={vi}
                                className="border border-sky-500/25 bg-sky-500/10 text-sky-400 text-[10px] px-2 py-0.5 rounded font-medium flex items-center gap-1"
                            >
                                <Rocket className="w-3 h-3" /> {v}
                            </span>
                        ))}
                        {s.zones.map((z, zi) => (
                            <span
                                key={zi}
                                className="border border-violet-500/25 bg-violet-500/10 text-violet-400 text-[10px] px-2 py-0.5 rounded font-medium"
                            >
                                {z}
                            </span>
                        ))}
                    </div>
                    {(s.kills > 0 || s.deaths > 0) && (
                        <div className="text-[10px] text-rose-400 border border-rose-500/25 bg-rose-500/10 rounded px-2 py-0.5 flex-shrink-0">
                            {s.kills}K / {s.deaths}D
                        </div>
                    )}
                </div>
            ))}
        </div>
        {hiddenCount > 0 && (
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-4 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-amber-300 transition-colors flex items-center justify-center gap-1.5"
            >
                {expanded ? "Masquer" : `Voir les ${hiddenCount} précédentes`}
            </button>
        )}
    </div>
    );
};

// ── 7bis. Missions exécutées (carte dédiée) ───────────────────────────────
const MissionsCard = ({ stats }: SectionProps) => {
    const ms = stats.missionStats;
    if (!ms) return null;
    const total = ms.totalMissionsComplete;
    const failed = ms.totalMissionsFailed;
    const abandoned = ms.totalMissionsAbandoned ?? 0;
    // Le taux compare réussites vs (échecs + abandons) : un abandon n'est pas une
    // réussite, le compter ici reflète mieux la fiabilité du joueur.
    const terminated = total + failed + abandoned;
    const hasMissions = terminated > 0;
    const successRate = hasMissions ? Math.round((total / terminated) * 100) : 0;
    const specialty = ms.missionSpecialty;

    return (
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 group hover:border-amber-500/30 transition-colors relative overflow-hidden">
            <div className="absolute right-[-10%] top-[-30%] w-48 h-48 bg-gradient-to-br from-amber-500/[0.06] to-violet-500/[0.06] blur-3xl rounded-full pointer-events-none" />
            <div className="relative">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl border border-amber-500/30 bg-amber-500/15 flex items-center justify-center text-amber-300">
                            <Trophy className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Missions exécutées</h3>
                            <p className="text-[11px] text-zinc-400">
                                Complétion via <span className="text-amber-300">EndMission</span> · spécialité via les objectifs <span className="text-amber-300">ObjectiveHandler</span>
                            </p>
                        </div>
                    </div>
                    {/* Stats principales : réussies / échouées / abandonnées + taux */}
                    <div className="flex items-end gap-6">
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Réussies</div>
                            <div className="text-3xl text-amber-300 font-bold tabular-nums leading-none">{total.toLocaleString("fr-FR")}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Échouées</div>
                            <div className="text-xl text-rose-400 font-semibold tabular-nums leading-none">{failed.toLocaleString("fr-FR")}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Abandonnées</div>
                            <div className="text-xl text-zinc-300 font-semibold tabular-nums leading-none">{abandoned.toLocaleString("fr-FR")}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Taux</div>
                            <div className={`text-xl font-semibold tabular-nums leading-none ${
                                !hasMissions ? "text-zinc-500" : successRate >= 95 ? "text-emerald-400" : successRate >= 80 ? "text-amber-400" : "text-rose-400"
                            }`}>{hasMissions ? `${successRate}%` : "—"}</div>
                        </div>
                    </div>
                </div>

                {/* Spécialité dominante (dérivée des objectifs ObjectiveHandler).
                    Remplace l'ancien breakdown par-type complété : non calculable
                    de façon fiable (objectifs non liés à une mission précise). */}
                {specialty && (
                    <div className="flex items-center gap-3 bg-[hsl(var(--background)/0.4)] border border-amber-500/20 rounded-xl px-4 py-3">
                        <div className="w-9 h-9 rounded-lg border border-amber-500/30 bg-amber-500/15 flex items-center justify-center text-amber-300 flex-shrink-0">
                            <Award className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Spécialité</div>
                            <div className="text-lg font-semibold text-white leading-tight truncate">{specialty}</div>
                        </div>
                        <div className="ml-auto text-[10px] text-zinc-500 text-right hidden sm:block">
                            d'après tes objectifs<br />de mission les plus fréquents
                        </div>
                    </div>
                )}

                {/* Mini liste des dernières missions complétées */}
                {ms.recentMissions && ms.recentMissions.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold">Derniers objectifs terminés</h4>
                            <span className="text-[10px] text-zinc-500">{ms.recentMissions.length} affichés</span>
                        </div>
                        <ul className="space-y-1.5">
                            {ms.recentMissions.map((m, i) => {
                                const typeMeta: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: ColorKey }> = {
                                    mining: { label: "Minage", icon: Pickaxe, color: "amber" },
                                    salvage: { label: "Sauvetage", icon: Package, color: "emerald" },
                                    bounty: { label: "Prime", icon: Crosshair, color: "rose" },
                                    cargo: { label: "Cargaison", icon: Package, color: "sky" },
                                    fps: { label: "FPS", icon: Crosshair, color: "rose" },
                                    medical: { label: "Médical", icon: Heart, color: "rose" },
                                    refuel: { label: "Ravitaill.", icon: Zap, color: "cyan" },
                                    investigation: { label: "Recon", icon: Compass, color: "violet" },
                                    race: { label: "Course", icon: Zap, color: "amber" },
                                    touring: { label: "Transport", icon: Package, color: "sky" },
                                    tutorial: { label: "Tutoriel", icon: Book, color: "zinc" },
                                    other: { label: "Autre", icon: MoreHorizontal, color: "zinc" },
                                };
                                const meta = typeMeta[m.type] ?? typeMeta.other;
                                const c = COLOR_MAP[meta.color];
                                const Icon = meta.icon;
                                return (
                                    <li
                                        key={i}
                                        className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                                        title={`${meta.label} · ${formatDateFr(m.completedAt)} ${formatTimeFr(m.completedAt)}`}
                                    >
                                        <div className={`w-6 h-6 rounded-md border ${c.iconBorder} ${c.iconBg} flex items-center justify-center ${c.text} flex-shrink-0`}>
                                            <Icon className="w-3 h-3" />
                                        </div>
                                        <span className={`text-[10px] font-semibold uppercase tracking-widest ${c.text} w-20 flex-shrink-0`}>{meta.label}</span>
                                        <span className="text-xs text-zinc-200 flex-1 truncate">{m.text}</span>
                                        <span className="text-[10px] text-zinc-500 flex-shrink-0">{formatShortDate(m.completedAt)}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

            </div>
        </div>
    );
};

// ── 8. Combat + Schémas (2 col) ───────────────────────────────────────────
const CombatAndBlueprints = ({ stats }: SectionProps) => {
    const navigate = useNavigate();
    return (
        <div className="grid grid-cols-2 gap-4">
            {/* Combat */}
            <div className="bg-[hsl(var(--background)/0.4)] backdrop-blur-sm border border-white/10 rounded-xl p-5 group hover:border-rose-500/30 transition-colors flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-7 h-7 rounded border border-rose-500/20 bg-rose-500/10 flex items-center justify-center text-rose-400">
                        <Crosshair className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Combat</h3>
                </div>
                <div className="flex items-center gap-3 mb-4">
                    <div className="text-3xl font-light text-white">
                        {stats.combat.kills} <span className="text-zinc-500">/</span> {stats.combat.deaths}
                    </div>
                    <div className="text-xs text-rose-400 border border-rose-500/25 bg-rose-500/10 rounded-md px-2 py-0.5">
                        Ratio {stats.combat.ratio == null
                            ? stats.combat.kills > 0 ? "∞" : "—"
                            : stats.combat.ratio.toFixed(1)}
                    </div>
                </div>
                <div className="space-y-2 mt-auto">
                    <div className="text-xs text-zinc-300 flex items-center justify-between gap-2">
                        <span>Arme préférée</span>
                        <span className="text-white font-medium">
                            {stats.combat.favoriteWeapon.name ? (
                                <>
                                    {stats.combat.favoriteWeapon.name}
                                    <span className="text-zinc-500 ml-1.5">({stats.combat.favoriteWeapon.kills} kills)</span>
                                </>
                            ) : (
                                <span className="text-zinc-500">Aucune</span>
                            )}
                        </span>
                    </div>
                    {stats.combat.lastKill && (
                        <div className="text-xs text-zinc-400 flex items-center justify-between">
                            <span>Dernier kill</span>
                            <span className="text-zinc-300">
                                {stats.combat.lastKill.victim}{" "}
                                <span className="text-zinc-500">· {formatShortDate(stats.combat.lastKill.date)}</span>
                            </span>
                        </div>
                    )}
                    {stats.vehicleDeaths && stats.vehicleDeaths.count > 0 && (
                        <div className="text-xs text-zinc-400 flex items-center justify-between">
                            <span>Morts en vaisseau</span>
                            <span className="text-zinc-300">
                                {stats.vehicleDeaths.count}
                                {stats.vehicleDeaths.deadliestVehicle && (
                                    <span className="text-zinc-500 ml-1.5">· {stats.vehicleDeaths.deadliestVehicle.name}</span>
                                )}
                            </span>
                        </div>
                    )}
                    {stats.survival && stats.survival.suffocationEpisodes > 0 && (
                        <div className="text-xs text-zinc-400 flex items-center justify-between">
                            <span>Apnées (asphyxie)</span>
                            <span className="text-zinc-300">
                                {stats.survival.suffocationEpisodes}
                                <span className="text-zinc-500 ml-1.5">
                                    · max {stats.survival.longestSuffocationSeconds < 60
                                        ? `${stats.survival.longestSuffocationSeconds}s`
                                        : `${Math.floor(stats.survival.longestSuffocationSeconds / 60)}m`}
                                </span>
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Blueprints */}
            <div className="bg-[hsl(var(--background)/0.4)] backdrop-blur-sm border border-white/10 rounded-xl p-5 group hover:border-violet-500/30 transition-colors flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-7 h-7 rounded border border-violet-500/20 bg-violet-500/10 flex items-center justify-center text-violet-400">
                        <Book className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Schémas Débloqués</h3>
                </div>
                <div className="flex flex-col mb-4">
                    <div className="text-3xl font-light tracking-tight text-white leading-none">{stats.blueprintCount}</div>
                    <div className="w-12 h-1 bg-violet-500/80 rounded mt-2 mb-1" />
                    <div className="text-[11px] text-zinc-400 font-medium">schémas catalogués via la DB locale</div>
                </div>
                <div className="border-t border-white/5 pt-3 mt-auto">
                    {stats.recentBlueprints.length === 0 ? (
                        <div className="text-zinc-500 text-sm py-4 text-center">Aucun schéma encore débloqué</div>
                    ) : (
                        <ul className="space-y-1.5 mb-2">
                            {stats.recentBlueprints.map((b, i) => (
                                <li key={i} className="text-[11px] text-zinc-300 flex justify-between">
                                    <span className="truncate pr-2">{b.name}</span>
                                    <span className="text-zinc-600">{b.date}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button
                        type="button"
                        onClick={() => navigate("/blueprints")}
                        className="text-xs text-violet-400 hover:text-white transition-colors mt-2"
                    >
                        Voir tous les schémas →
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── 8b. Économie : commerce cargo (P&L) + dépenses boutique ────────────────
const EconomySection = ({ stats }: SectionProps) => {
    const ct = stats.cargoTrade;
    const ss = stats.shopSpending;
    const hasCargo = !!ct && (ct.buyCount > 0 || ct.sellCount > 0);
    const hasShop = !!ss && ss.count > 0;
    if (!hasCargo && !hasShop) return null;
    const fmt = (n: number) => n.toLocaleString("fr-FR");
    return (
        <div className="bg-[hsl(var(--background)/0.4)] backdrop-blur-sm border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-7 h-7 rounded border border-amber-500/20 bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <Package className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Économie</h3>
            </div>

            {hasCargo && ct && (
                <div className="mb-4">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Commerce cargo</div>
                    <div className="grid grid-cols-3 gap-4 mb-3">
                        <div>
                            <div className="text-[11px] text-zinc-500 mb-1">Acheté</div>
                            <div className="text-xl font-light text-white tabular-nums">{fmt(ct.bought)}</div>
                            <div className="text-[11px] text-zinc-500">{ct.buyCount} achat{ct.buyCount > 1 ? "s" : ""}</div>
                        </div>
                        <div>
                            <div className="text-[11px] text-zinc-500 mb-1">Revendu</div>
                            <div className="text-xl font-light text-white tabular-nums">{fmt(ct.sold)}</div>
                            <div className="text-[11px] text-zinc-500">{ct.sellCount} vente{ct.sellCount > 1 ? "s" : ""}</div>
                        </div>
                        <div>
                            <div className="text-[11px] text-zinc-500 mb-1">Solde</div>
                            <div className={`text-xl font-semibold tabular-nums ${ct.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {ct.net >= 0 ? "+" : ""}{fmt(ct.net)}
                            </div>
                            <div className="text-[11px] text-zinc-500">revente − achat</div>
                        </div>
                    </div>
                    {ct.topCommodities.length > 0 && (
                        <ul className="space-y-1.5">
                            {ct.topCommodities.map((c, i) => {
                                const cnet = c.sold - c.bought;
                                return (
                                    <li key={i} className="text-xs flex items-center justify-between gap-2">
                                        <span className="text-zinc-300 truncate pr-2">{c.name}</span>
                                        <span className="text-zinc-500 tabular-nums shrink-0">
                                            {fmt(c.bought)} → {fmt(c.sold)}
                                            <span className={`ml-2 ${cnet >= 0 ? "text-emerald-400/80" : "text-rose-400/80"}`}>
                                                {cnet >= 0 ? "+" : ""}{fmt(cnet)}
                                            </span>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {hasShop && ss && (
                <div className={hasCargo ? "border-t border-white/5 pt-3" : ""}>
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Dépenses boutique</div>
                    <div className="flex items-baseline gap-2 mb-2">
                        <div className="text-xl font-light text-rose-300 tabular-nums">{fmt(ss.totalUec)}</div>
                        <div className="text-[11px] text-zinc-500">aUEC · {ss.count} achat{ss.count > 1 ? "s" : ""}</div>
                    </div>
                    {ss.topShops.length > 0 && (
                        <ul className="space-y-1.5">
                            {ss.topShops.map((s, i) => (
                                <li key={i} className="text-xs flex items-center justify-between gap-2">
                                    <span className="text-zinc-300 truncate pr-2">{s.name}</span>
                                    <span className="text-zinc-500 tabular-nums shrink-0">{fmt(s.spent)} aUEC</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div className="text-[10px] text-zinc-600 mt-3">
                Commerce cargo traçable bout-à-bout. Hors récompenses de mission (non journalisées par le jeu).
            </div>
        </div>
    );
};

// ── 8c. Compagnons de vol (social / party) ─────────────────────────────────
const Companions = ({ stats }: SectionProps) => {
    const c = stats.companions;
    const gradients = [
        "from-sky-500/40 to-violet-500/40",
        "from-emerald-500/40 to-cyan-500/40",
        "from-amber-500/40 to-rose-500/40",
        "from-violet-500/40 to-sky-500/40",
    ];
    // Enrichit les compagnons NOMMÉS (les GEID nus ne sont pas des handles RSI)
    // avec leur profil RSI — exactement comme "Croisés en combat".
    const namedInput = useMemo(
        () => (c?.list ?? []).filter((p) => p.resolved).map((p) => ({ name: p.name, kills: 0, deaths: 0, lastSeen: "" })),
        [c],
    );
    const { players: enriched, openProfile, setTag, loading: enrichLoading } = useEncounteredPlayers(namedInput);
    const profileByName = useMemo(() => {
        const m = new Map<string, { avatarUrl?: string; displayName?: string; orgName?: string }>();
        for (const e of enriched) if (e.profile) m.set(e.name.toLowerCase(), e.profile);
        return m;
    }, [enriched]);
    // Auto-marque les compagnons nommés comme "ami" (tu voles avec eux = potes).
    // 1×/session via le ref, et UNIQUEMENT ceux sans tag → respecte tes choix
    // manuels (si tu mets quelqu'un en "rival", il n'est pas re-passé ami).
    const autoTaggedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const e of enriched) {
            const k = e.name.toLowerCase();
            if (!e.tag && !autoTaggedRef.current.has(k)) {
                autoTaggedRef.current.add(k);
                setTag(e.name, "friend");
            }
        }
    }, [enriched, setTag]);
    const [expanded, setExpanded] = useState(false);
    if (!c || c.total === 0) return null;
    const TOP_COUNT = 4;
    const visible = expanded ? c.list : c.list.slice(0, TOP_COUNT);
    const hidden = Math.max(0, c.list.length - TOP_COUNT);
    return (
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-sky-500/30 transition-colors relative overflow-hidden">
            <div className="absolute right-[-15%] top-[-30%] w-40 h-40 bg-sky-500/[0.06] blur-3xl rounded-full pointer-events-none" />
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-sky-500/20 bg-sky-500/10 flex items-center justify-center text-sky-400">
                    <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Compagnons de vol</h3>
                {enrichLoading ? (
                    <span className="ml-auto text-[10px] text-sky-400 flex items-center gap-1.5" title="Récupération des profils RSI en cours…">
                        <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                    </span>
                ) : (
                    <span className="ml-auto text-[10px] text-zinc-500 tabular-nums">{c.named}/{c.total} identifiés</span>
                )}
            </div>
            {/* Stats de groupe */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                    { v: c.distinctTeammates, l: "coéquipiers" },
                    { v: c.sharedMissions, l: "missions groupe" },
                    { v: c.timesLeader, l: "fois chef" },
                ].map((s, i) => (
                    <div key={i} className="text-center rounded-lg border border-white/5 bg-white/[0.02] py-2">
                        <div className="text-lg font-light text-white tabular-nums leading-none">{s.v.toLocaleString("fr-FR")}</div>
                        <div className="text-[9px] text-zinc-500 uppercase tracking-wide mt-1">{s.l}</div>
                    </div>
                ))}
            </div>
            <ul className={`space-y-2 ${expanded ? "max-h-[420px] overflow-y-auto pr-1" : ""}`}>
                {visible.map((p, i) => {
                    const initials = p.resolved ? p.name.slice(0, 2).toUpperCase() : "?";
                    const grad = p.resolved ? gradients[i % gradients.length] : "from-zinc-600/40 to-zinc-700/40";
                    const prof = p.resolved ? profileByName.get(p.name.toLowerCase()) : undefined;
                    return (
                        <li
                            key={i}
                            className="relative flex items-center gap-3 p-2 rounded-lg border border-transparent hover:bg-white/5 transition-colors"
                        >
                            {/* Avatar */}
                            {prof?.avatarUrl ? (
                                <img
                                    src={prof.avatarUrl}
                                    alt={p.name}
                                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-white/10"
                                    loading="lazy"
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                />
                            ) : p.resolved && enrichLoading ? (
                                <div className="w-8 h-8 rounded-full bg-zinc-700/40 animate-pulse flex-shrink-0 border border-white/5" />
                            ) : (
                                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-xs font-semibold text-white flex-shrink-0`}>
                                    {initials}
                                </div>
                            )}
                            {/* Nom + meta */}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    {p.resolved ? (
                                        <button
                                            type="button"
                                            onClick={() => openProfile(p.name)}
                                            className="text-xs text-white font-medium truncate hover:text-sky-300 transition-colors flex items-center gap-1"
                                            title="Ouvrir le profil RSI"
                                        >
                                            {prof?.displayName ?? p.name}
                                            <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                                        </button>
                                    ) : (
                                        <span className="text-xs text-zinc-500 italic truncate">{p.name}</span>
                                    )}
                                    {p.isLeader && <Crown className="w-3 h-3 text-amber-400" />}
                                    {p.fought && <SwordsIcon className="w-3 h-3 text-rose-400" />}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">
                                    {prof?.orgName && (
                                        <>
                                            <span className="text-sky-400/80">{prof.orgName}</span> ·{" "}
                                        </>
                                    )}
                                    {p.isLeader ? "Chef de groupe" : "Coéquipier"}{p.fought ? " · croisé en combat" : ""}
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {hidden > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-3 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-sky-300 transition-colors flex items-center justify-center gap-1.5"
                >
                    {expanded ? "Masquer" : `Voir les ${hidden} autres`}
                </button>
            )}
            <div className="text-[10px] text-zinc-600 mt-3 pt-3 border-t border-white/5">
                Compagnons nommés <span className="text-emerald-400/80">auto‑marqués amis</span> ❤
                {c.total - c.named > 0
                    ? ` · + ${c.total - c.named} coéquipiers anonymes (GEID seul, pseudo non récupérable).`
                    : "."}
            </div>
        </div>
    );
};

// ── 9. Records + Joueurs croisés (2 col) ──────────────────────────────────
const RecordsAndEncounters = ({ stats }: SectionProps) => {
    const TOP_COUNT = 4;
    const [encExpanded, setEncExpanded] = useState(false);
    const [filter, setFilter] = useState<"all" | "friend" | "org" | "enemy">("all");
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [noteEditFor, setNoteEditFor] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    const { players, setTag, openProfile, friendsCount, orgCount, enemyCount, loading: enrichLoading } =
        useEncounteredPlayers(stats.encounteredPlayers);
    const filteredEncounters = filter === "all" ? players : players.filter((p) => p.tag?.tag === filter);
    const encounters = filteredEncounters;
    const visibleEncounters = encExpanded ? encounters : encounters.slice(0, TOP_COUNT);
    const hiddenEnc = Math.max(0, encounters.length - TOP_COUNT);
    return (
    <div className="grid grid-cols-2 gap-4 items-start">
        {/* Records personnels */}
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-amber-500/30 transition-colors relative overflow-hidden">
            <div className="absolute right-[-15%] top-[-30%] w-40 h-40 bg-amber-500/[0.06] blur-3xl rounded-full pointer-events-none" />
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <Medal className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Records personnels</h3>
            </div>
            <ul className="space-y-3">
                <RecordRow
                    icon={Hourglass}
                    label="Plus longue session"
                    value={stats.records.longestSessionMinutes === 0 ? "—" : formatHoursMinutes(stats.records.longestSessionMinutes)}
                />
                <RecordRow
                    icon={Zap}
                    label={<>Quantum le plus rapide <span className="text-zinc-500">(approx.)</span></>}
                    value={stats.records.fastestQuantumSeconds == null ? "—" : `~${stats.records.fastestQuantumSeconds}s`}
                    title="Estimation : Game.log ne logue pas la durée exacte des sauts quantum"
                />
                <RecordRow icon={Flame} label="Plus longue série de jeu" value={`${stats.records.longestStreakDays} jours`} />
                <RecordRow icon={Moon} label="Nuit la plus tardive" value={stats.records.latestNightHour == null ? "—" : stats.records.latestNightHour} />
                <RecordRow icon={Swords} label="Plus de kills en session" value={`${stats.records.mostKillsInSession} kills`} />
            </ul>
        </div>

        {/* Croisés en combat */}
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-sky-500/30 transition-colors relative z-10">
            <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                <div className="absolute right-[-15%] top-[-30%] w-40 h-40 bg-sky-500/[0.06] blur-3xl rounded-full" />
            </div>
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-sky-500/20 bg-sky-500/10 flex items-center justify-center text-sky-400">
                    <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Croisés en combat</h3>
                {enrichLoading && (
                    <span
                        className="ml-auto text-[10px] text-sky-400 flex items-center gap-1.5"
                        title="Récupération des profils RSI en cours…"
                    >
                        <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                        Chargement RSI…
                    </span>
                )}
                {!enrichLoading && (
                    <span className="ml-auto text-[10px] text-zinc-500 tabular-nums">{players.length} joueurs</span>
                )}
            </div>
            {friendsCount + orgCount + enemyCount > 0 && (
                <div className="mb-3 -mt-1 text-[10px] text-zinc-400 flex items-center gap-3">
                    {friendsCount > 0 && (
                        <span className="flex items-center gap-1">
                            <Heart className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                            <span className="text-emerald-300 font-semibold tabular-nums">{friendsCount}</span> amis
                            {friendsCount >= 5 && <span className="ml-1 text-amber-400" title="Trophée Cercle d'amis débloqué">🏆</span>}
                        </span>
                    )}
                    {orgCount > 0 && (
                        <span className="flex items-center gap-1">
                            <Shield className="w-3 h-3 text-sky-400 fill-sky-400/40" />
                            <span className="text-sky-300 font-semibold tabular-nums">{orgCount}</span> org
                        </span>
                    )}
                    {enemyCount > 0 && (
                        <span className="flex items-center gap-1">
                            <SwordsIcon className="w-3 h-3 text-rose-400" />
                            <span className="text-rose-300 font-semibold tabular-nums">{enemyCount}</span> rivaux
                        </span>
                    )}
                </div>
            )}
            {/* Filtres tags */}
            <div className="flex items-center gap-1 mb-3 text-[10px]">
                {([
                    { id: "all", label: "Tous", count: players.length, icon: Users, color: "zinc" },
                    { id: "friend", label: "Amis", count: friendsCount, icon: Heart, color: "emerald" },
                    { id: "org", label: "Org", count: orgCount, icon: Shield, color: "sky" },
                    { id: "enemy", label: "Rivaux", count: enemyCount, icon: SwordsIcon, color: "rose" },
                ] as const).map((f) => {
                    const Icon = f.icon;
                    const active = filter === f.id;
                    const colorClass = active
                        ? f.id === "friend"
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : f.id === "org"
                            ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                            : f.id === "enemy"
                            ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                            : "border-white/20 bg-white/10 text-white"
                        : "border-white/5 bg-white/[0.02] text-zinc-400 hover:text-zinc-200";
                    return (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${colorClass}`}
                        >
                            <Icon className="w-3 h-3" />
                            {f.label}
                            <span className="opacity-60">{f.count}</span>
                        </button>
                    );
                })}
            </div>
            <ul className={`space-y-2 ${encExpanded ? "max-h-[420px] overflow-y-auto pr-1" : ""}`}>
                {players.length === 0 && (
                    <li className="text-zinc-500 text-sm py-4 text-center">Aucun joueur croisé en combat</li>
                )}
                {visibleEncounters.map((p, i) => {
                    const diff = p.kills - p.deaths;
                    const initials = p.name.slice(0, 2).toUpperCase();
                    const gradients = [
                        "from-rose-500/40 to-amber-500/40",
                        "from-sky-500/40 to-violet-500/40",
                        "from-amber-500/40 to-rose-500/40",
                        "from-emerald-500/40 to-cyan-500/40",
                    ];
                    const tagKind = p.tag?.tag;
                    const tagBorder =
                        tagKind === "friend" ? "border-emerald-500/40"
                        : tagKind === "org" ? "border-sky-500/40"
                        : tagKind === "enemy" ? "border-rose-500/40"
                        : "border-transparent";
                    const tagBg =
                        tagKind === "friend" ? "bg-emerald-500/[0.04]"
                        : tagKind === "org" ? "bg-sky-500/[0.04]"
                        : tagKind === "enemy" ? "bg-rose-500/[0.04]"
                        : "";
                    const handleKey = p.name.toLowerCase();
                    const menuOpen = openMenu === handleKey;
                    const noteEditing = noteEditFor === handleKey;
                    return (
                        <li
                            key={i}
                            className={`relative flex items-center gap-3 p-2 rounded-lg border ${tagBorder} ${tagBg} hover:bg-white/5 transition-colors`}
                            title={`Dernière interaction : ${formatDateFr(p.lastSeen)}`}
                        >
                            {/* Avatar */}
                            {p.profile?.avatarUrl ? (
                                <img
                                    src={p.profile.avatarUrl}
                                    alt={p.name}
                                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-white/10"
                                    loading="lazy"
                                    onError={(e) => {
                                        // Fallback initiales si image casse
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                            ) : enrichLoading && !p.profile ? (
                                // Skeleton shimmer pendant le 1er fetch
                                <div className="w-8 h-8 rounded-full bg-zinc-700/40 animate-pulse flex-shrink-0 border border-white/5" />
                            ) : (
                                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradients[i % gradients.length]} flex items-center justify-center text-xs font-semibold text-white flex-shrink-0`}>
                                    {initials}
                                </div>
                            )}
                            {/* Nom + meta */}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => openProfile(p.name)}
                                        className="text-xs text-white font-medium truncate hover:text-sky-300 transition-colors flex items-center gap-1"
                                        title="Ouvrir le profil RSI"
                                    >
                                        {p.profile?.displayName ?? p.name}
                                        <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                                    </button>
                                    {tagKind === "friend" && <Heart className="w-3 h-3 text-emerald-400 fill-emerald-400" />}
                                    {tagKind === "org" && <Shield className="w-3 h-3 text-sky-400 fill-sky-400/50" />}
                                    {tagKind === "enemy" && <SwordsIcon className="w-3 h-3 text-rose-400" />}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">
                                    {p.profile?.orgName && (
                                        <>
                                            <span className="text-sky-400/80">{p.profile.orgName}</span> ·{" "}
                                        </>
                                    )}
                                    {p.kills} kill{p.kills > 1 ? "s" : ""} · {p.deaths} mort{p.deaths > 1 ? "s" : ""} · {formatShortDate(p.lastSeen)}
                                </div>
                                {p.tag?.note && !noteEditing && (
                                    <div className="text-[10px] text-zinc-400 italic mt-0.5 truncate">
                                        "{p.tag.note}"
                                    </div>
                                )}
                                {noteEditing && (
                                    <div className="mt-1 flex items-center gap-1">
                                        <input
                                            type="text"
                                            value={noteDraft}
                                            onChange={(e) => setNoteDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    setTag(p.name, p.tag?.tag ?? "friend", noteDraft);
                                                    setNoteEditFor(null);
                                                }
                                                if (e.key === "Escape") setNoteEditFor(null);
                                            }}
                                            placeholder="Note libre…"
                                            className="text-[10px] bg-black/30 border border-white/10 rounded px-1.5 py-0.5 text-zinc-200 flex-1 outline-none focus:border-sky-500/40"
                                            autoFocus
                                            maxLength={120}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTag(p.name, p.tag?.tag ?? "friend", noteDraft);
                                                setNoteEditFor(null);
                                            }}
                                            className="text-emerald-400 hover:text-emerald-300"
                                            title="Enregistrer"
                                        >
                                            <Check className="w-3 h-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNoteEditFor(null)}
                                            className="text-zinc-400 hover:text-zinc-200"
                                            title="Annuler"
                                        >
                                            <XIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            {/* K/D diff */}
                            <span
                                className={`text-[10px] font-semibold flex items-center gap-1 ${
                                    diff > 0 ? "text-emerald-400" : diff < 0 ? "text-rose-400" : "text-zinc-400"
                                }`}
                            >
                                {diff > 0 ? <TrendingUp className="w-3 h-3" /> : diff < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                                {diff > 0 ? `+${diff}` : diff < 0 ? diff : "±0"}
                            </span>
                            {/* Menu tag */}
                            <button
                                type="button"
                                onClick={() => setOpenMenu(menuOpen ? null : handleKey)}
                                className="w-6 h-6 rounded-md border border-white/5 bg-white/[0.02] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                                title="Tagger ce joueur"
                            >
                                <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {menuOpen && (
                                <div className="absolute right-2 top-full mt-1 z-20 w-44 rounded-lg border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-xl py-1.5 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => { setTag(p.name, "friend", p.tag?.note); setOpenMenu(null); }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-200 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors text-left"
                                    >
                                        <Heart className="w-3.5 h-3.5" /> Marquer ami
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setTag(p.name, "org", p.tag?.note); setOpenMenu(null); }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-200 hover:bg-sky-500/10 hover:text-sky-300 transition-colors text-left"
                                    >
                                        <Shield className="w-3.5 h-3.5" /> Marquer org
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setTag(p.name, "enemy", p.tag?.note); setOpenMenu(null); }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-200 hover:bg-rose-500/10 hover:text-rose-300 transition-colors text-left"
                                    >
                                        <SwordsIcon className="w-3.5 h-3.5" /> Marquer rival
                                    </button>
                                    <div className="my-1 border-t border-white/5" />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNoteDraft(p.tag?.note ?? "");
                                            setNoteEditFor(handleKey);
                                            setOpenMenu(null);
                                        }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                    >
                                        <Pencil className="w-3.5 h-3.5" /> {p.tag?.note ? "Modifier la note" : "Ajouter une note"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { openProfile(p.name); setOpenMenu(null); }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" /> Profil RSI
                                    </button>
                                    {p.tag && (
                                        <>
                                            <div className="my-1 border-t border-white/5" />
                                            <button
                                                type="button"
                                                onClick={() => { setTag(p.name, null); setOpenMenu(null); }}
                                                className="w-full px-3 py-1.5 flex items-center gap-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-200 transition-colors text-left"
                                            >
                                                <XIcon className="w-3.5 h-3.5" /> Retirer le tag
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
                {filter !== "all" && visibleEncounters.length === 0 && (
                    <li className="text-center text-[11px] text-zinc-500 py-6">
                        Aucun joueur dans ce filtre.
                    </li>
                )}
            </ul>
            {hiddenEnc > 0 && (
                <button
                    type="button"
                    onClick={() => setEncExpanded((v) => !v)}
                    className="mt-3 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-sky-300 transition-colors flex items-center justify-center gap-1.5"
                >
                    {encExpanded ? "Masquer" : `Voir les ${hiddenEnc} autres joueurs`}
                </button>
            )}
        </div>
    </div>
    );
};

const RecordRow = ({
    icon: Icon,
    label,
    value,
    title,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: React.ReactNode;
    value: string;
    title?: string;
}) => (
    <li className="flex items-center justify-between gap-3" title={title}>
        <div className="flex items-center gap-2.5 min-w-0">
            <Icon className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
            <span className="text-xs text-zinc-300">{label}</span>
        </div>
        <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
    </li>
);

// ── 10. Cartographie galaxie ──────────────────────────────────────────────
const GalaxyMap = ({ stats }: SectionProps) => {
    // Taille des cercles proportionnelle aux heures jouées dans le système.
    // Échelle sqrt pour pas qu'un système peu visité (genre 4h vs 203h) soit
    // ridiculement minuscule — on garde un min visible et un max raisonnable.
    const MIN_SIZE = 52;
    const MAX_SIZE = 104;
    const LOCKED_SIZE = 44;
    const systemsData = [
        { key: "Stanton" as const, color: "emerald", text: "text-emerald-300", subtext: "text-emerald-400/80", border: "border-emerald-500/60", bg: "bg-emerald-500/15", glow: "shadow-[0_0_20px_rgba(16,185,129,0.3)]", blur: "bg-emerald-500/20", badge: "Home" },
        { key: "Pyro" as const, color: "amber", text: "text-amber-300", subtext: "text-amber-400/80", border: "border-amber-500/50", bg: "bg-amber-500/10", glow: "", blur: "bg-amber-500/15", badge: null },
        { key: "Nyx" as const, color: "violet", text: "text-violet-300", subtext: "text-violet-400/80", border: "border-violet-500/50", bg: "bg-violet-500/10", glow: "", blur: "bg-violet-500/15", badge: null },
    ];
    const maxHours = Math.max(1, ...systemsData.map((s) => stats.systemTime[s.key] ?? 0));
    const computeSize = (hours: number) => {
        const ratio = Math.sqrt(Math.max(0, hours) / maxHours);
        return Math.round(MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE));
    };
    const systems = systemsData.map((s) => ({
        ...s,
        sizePx: computeSize(stats.systemTime[s.key] ?? 0),
    }));
    // Systèmes pas encore dans le jeu (futures versions).
    const lockedSystems = [
        { key: "Castra", sizePx: LOCKED_SIZE, badge: "SC 5+" },
        { key: "Terra", sizePx: LOCKED_SIZE - 4, badge: "SQ42" },
    ];

    return (
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 relative overflow-hidden">
            {/* Étoiles fond */}
            <div className="absolute inset-0 pointer-events-none opacity-30">
                {[
                    [20, 15], [60, 8], [35, 88], [75, 70], [15, 55], [85, 40], [45, 25],
                ].map(([top, left], i) => (
                    <div
                        key={i}
                        className={`absolute rounded-full bg-white ${i % 3 === 0 ? "w-1 h-1" : "w-0.5 h-0.5"}`}
                        style={{ top: `${top}%`, left: `${left}%` }}
                    />
                ))}
            </div>

            <div className="flex items-center justify-between mb-5 relative">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                        <Orbit className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Cartographie personnelle</h3>
                        <p className="text-[11px] text-zinc-400">
                            {stats.systemsVisited.length} systèmes parcourus sur {systemsData.length} disponibles
                        </p>
                    </div>
                </div>
            </div>

            <div className="relative w-full h-[200px] flex items-center justify-around">
                {/* Trajectoires SVG entre systèmes (lignes pointillées en arrière-plan).
                    Stanton→Pyro et Pyro→Nyx = colorées (parcourus). Le reste = grisé (à venir). */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 200" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="trail-stanton-pyro" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="rgb(16 185 129 / 0.5)" />
                            <stop offset="1" stopColor="rgb(245 158 11 / 0.5)" />
                        </linearGradient>
                        <linearGradient id="trail-pyro-nyx" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="rgb(245 158 11 / 0.45)" />
                            <stop offset="1" stopColor="rgb(139 92 246 / 0.45)" />
                        </linearGradient>
                    </defs>
                    <path className="carnet-dash-flow" d="M 140 100 Q 280 70 380 100" stroke="url(#trail-stanton-pyro)" strokeWidth="1.5" strokeDasharray="3 4" fill="none" />
                    <path className="carnet-dash-flow" d="M 410 100 Q 510 130 590 100" stroke="url(#trail-pyro-nyx)" strokeWidth="1.5" strokeDasharray="3 4" fill="none" />
                    <path d="M 610 100 Q 700 75 770 100" stroke="rgb(115 115 115 / 0.18)" strokeWidth="1" strokeDasharray="2 6" fill="none" />
                    <path d="M 790 100 Q 860 130 920 100" stroke="rgb(115 115 115 / 0.18)" strokeWidth="1" strokeDasharray="2 6" fill="none" />
                </svg>

                {systems.map((s) => {
                    const hours = stats.systemTime[s.key] ?? 0;
                    const isHome = s.badge === "Home";
                    const visited = stats.systemsVisited.includes(s.key);
                    // Système accessible en jeu mais jamais visité par le joueur :
                    // on le grise (comme Castra/Terra) au lieu d'afficher un faux "0h".
                    if (!visited) {
                        // Système ACCESSIBLE mais pas encore visité par le joueur :
                        // on le montre dans sa couleur (pointillés + dimmé), PAS de
                        // cadenas (le cadenas est réservé aux systèmes hors-jeu).
                        return (
                            <div
                                key={s.key}
                                className="relative group cursor-pointer opacity-60 transition-all duration-200 hover:opacity-90 hover:scale-105"
                                title={`${s.key} · accessible, pas encore visité`}
                            >
                                <div
                                    className={`relative rounded-full border-2 border-dashed ${s.border} ${s.bg} backdrop-blur-sm flex items-center justify-center`}
                                    style={{ width: MIN_SIZE, height: MIN_SIZE }}
                                >
                                    <div className="text-center px-1">
                                        <div className={`text-[10px] uppercase tracking-widest ${s.text} font-semibold leading-none`}>{s.key}</div>
                                        <div className="text-[8px] text-zinc-500 mt-0.5 leading-none">non visité</div>
                                    </div>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div
                            key={s.key}
                            className="relative group cursor-pointer transition-transform duration-200 hover:scale-105"
                            title={`${s.key} · ${hours > 0 ? `${hours}h` : "visité"}`}
                        >
                            <div className={`absolute inset-0 rounded-full ${s.blur} blur-lg`} />
                            <div
                                className={`relative rounded-full border-2 ${s.border} ${s.bg} backdrop-blur-sm flex items-center justify-center ${isHome ? "carnet-home-pulse" : s.glow}`}
                                style={{ width: s.sizePx, height: s.sizePx }}
                            >
                                <div className="text-center px-1">
                                    <div className={`text-[10px] uppercase tracking-widest ${s.text} font-semibold leading-none`}>{s.key}</div>
                                    <div className={`text-[9px] ${s.subtext} mt-0.5 leading-none`}>{hours > 0 ? `${hours}h` : "visité"}</div>
                                </div>
                            </div>
                            {s.badge && (
                                <span className="absolute -top-2 -right-2 px-1.5 py-0 rounded-full bg-emerald-500 text-[8px] text-emerald-950 font-bold uppercase tracking-wider">
                                    {s.badge}
                                </span>
                            )}
                        </div>
                    );
                })}
                {lockedSystems.map((s) => (
                    <div
                        key={s.key}
                        className="relative group cursor-pointer opacity-40 transition-all duration-200 hover:opacity-60 hover:scale-105"
                        title={`${s.key} · À venir dans une future version de Star Citizen`}
                    >
                        <div
                            className="relative rounded-full border border-dashed border-zinc-600 bg-zinc-900/40 flex items-center justify-center"
                            style={{ width: s.sizePx, height: s.sizePx }}
                        >
                            <div className="text-center">
                                <div className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold leading-none">{s.key}</div>
                                <Lock className="w-2.5 h-2.5 text-zinc-600 mx-auto mt-0.5" />
                            </div>
                        </div>
                        <span className="absolute -top-1 -right-1 px-1 py-0 rounded-full bg-zinc-700/80 text-[7px] text-zinc-300 font-bold uppercase tracking-wider">
                            {s.badge}
                        </span>
                    </div>
                ))}
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-400">
                <span>
                    {stats.totalQuantumJumps.toLocaleString("fr-FR")} quantum jumps effectués
                </span>
            </div>
        </div>
    );
};

// ── 11. Heure préférée + Top jour semaine (2 col) ─────────────────────────
const HourlyAndWeekday = ({ stats }: SectionProps) => {
    const peakHour = stats.hourlyDistribution.indexOf(Math.max(...stats.hourlyDistribution));
    const peakWeekday = stats.weekdayDistribution.indexOf(Math.max(...stats.weekdayDistribution));
    const weekdayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const weekdayMax = Math.max(1, ...stats.weekdayDistribution);
    const totalWeekday = stats.weekdayDistribution.reduce((a, b) => a + b, 0);
    const hourMax = Math.max(1, ...stats.hourlyDistribution);

    return (
        <div className="grid grid-cols-2 gap-4">
            {/* Heure préférée */}
            <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-cyan-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                        <Sun className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Heure préférée</h3>
                        <p className="text-[11px] text-zinc-400">
                            Tu joues surtout <span className="text-cyan-400 font-semibold">vers {peakHour}h</span>
                        </p>
                    </div>
                </div>
                <div className="flex items-end justify-between gap-[2px] h-20 mt-2">
                    {stats.hourlyDistribution.map((v, i) => {
                        const pct = Math.max(4, (v / hourMax) * 100);
                        const isPeak = v >= hourMax * 0.85;
                        const cls =
                            v === 0
                                ? "bg-white/5"
                                : isPeak
                                ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.45)]"
                                : v >= hourMax * 0.4
                                ? "bg-cyan-500/70"
                                : "bg-cyan-500/35";
                        return (
                            <div key={i} className="flex flex-col items-center flex-1 gap-0.5" title={`${i}h · ${v} session${v > 1 ? "s" : ""}`}>
                                <div className={`w-full rounded-sm ${cls}`} style={{ height: `${pct}%` }} />
                                {i % 6 === 0 && <div className="text-[8px] text-zinc-600 mt-0.5">{i}h</div>}
                            </div>
                        );
                    })}
                </div>
                <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-zinc-400 flex justify-between">
                    <span>🌙 {peakHour >= 22 || peakHour < 5 ? "Couche-tard détecté" : peakHour < 12 ? "Lève-tôt" : "Joueur de l'après-midi"}</span>
                    <span className="text-zinc-500">Pic : <span className="text-cyan-400 font-semibold">{peakHour}h</span></span>
                </div>
            </div>

            {/* Top jour de la semaine */}
            <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <CalendarDays className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Top jour de la semaine</h3>
                        <p className="text-[11px] text-zinc-400">
                            Ta routine, c'est <span className="text-emerald-400 font-semibold">{weekdayLabels[peakWeekday]}.</span>
                        </p>
                    </div>
                </div>
                <div className="space-y-2 mt-2">
                    {stats.weekdayDistribution.map((v, i) => {
                        const pct = (v / weekdayMax) * 100;
                        const isPeak = i === peakWeekday;
                        return (
                            <div key={i} className="flex items-center gap-3" title={`${weekdayLabels[i]} · ${v}h cumulées`}>
                                <span className={`text-[10px] w-7 ${isPeak ? "text-emerald-400 font-semibold" : "text-zinc-400"}`}>
                                    {weekdayLabels[i]}
                                </span>
                                <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${
                                            isPeak
                                                ? "bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.45)]"
                                                : "bg-emerald-500/45"
                                        }`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <span className={`text-[10px] tabular-nums w-10 text-right ${isPeak ? "text-white font-semibold" : "text-zinc-500"}`}>
                                    {v}h
                                </span>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-400 flex justify-between">
                    <span>Total : <span className="text-white font-semibold">{totalWeekday}h</span></span>
                    <span className="text-emerald-400">Top : <span className="font-semibold">{weekdayLabels[peakWeekday]}.</span></span>
                </div>
            </div>
        </div>
    );
};

// ── 12. Routes quantum + Causes de mort (2 col) ───────────────────────────
const QuantumAndDeaths = ({ stats }: SectionProps) => {
    const [expandedRoutes, setExpandedRoutes] = useState(false);
    const [expandedDeaths, setExpandedDeaths] = useState(false);
    const TOP_COUNT = 5;
    const routes = stats.topQuantumRoutes;
    const visibleRoutes = expandedRoutes ? routes : routes.slice(0, TOP_COUNT);
    const hiddenCount = routes.length - TOP_COUNT;
    const totalRouteJumps = routes.reduce((acc, r) => acc + r.jumps, 0);
    const causes = stats.deathCauses;
    const visibleCauses = expandedDeaths ? causes : causes.slice(0, TOP_COUNT);
    const hiddenCauses = causes.length - TOP_COUNT;
    const totalDeathsAll = causes.reduce((a, c) => a + c.count, 0);

    return (
    <div className="grid grid-cols-2 gap-4 items-start">
        {/* Top routes quantum */}
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-violet-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-violet-500/20 bg-violet-500/10 flex items-center justify-center text-violet-400">
                    <RouteIcon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Routes quantum favorites</h3>
                <span
                    className="ml-auto text-[10px] text-zinc-500"
                    title={`${totalRouteJumps} sauts répétés sur ${stats.totalQuantumJumps} sauts au total — le reste est composé de routes uniques (1 saut) non agrégeables`}
                >
                    {stats.totalQuantumJumps} sauts
                </span>
            </div>
            <ul className={`space-y-2.5 ${expandedRoutes ? "max-h-72 overflow-y-auto pr-1" : ""}`}>
                {routes.length === 0 ? (
                    <li className="text-zinc-500 text-sm py-4 text-center">Pas encore de route récurrente</li>
                ) : (
                    visibleRoutes.map((r, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs" title={`${r.from} → ${r.to} · ${r.jumps} sauts`}>
                            <span className="text-violet-400 font-semibold tabular-nums w-6 text-right">{r.jumps}</span>
                            <span className="text-white truncate flex-1 flex items-center gap-1.5">
                                <span className="text-zinc-400">{r.from}</span>
                                <ArrowRight className="w-3 h-3 text-violet-400/60" />
                                <span className="text-zinc-200">{r.to}</span>
                            </span>
                        </li>
                    ))
                )}
            </ul>
            {hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpandedRoutes((v) => !v)}
                    className="mt-3 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-violet-300 transition-colors flex items-center justify-center gap-1.5"
                >
                    {expandedRoutes
                        ? "Masquer"
                        : `Voir les ${hiddenCount} autres routes`}
                </button>
            )}
        </div>

        {/* Causes de mort */}
        <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-5 group hover:border-rose-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg border border-rose-500/20 bg-rose-500/10 flex items-center justify-center text-rose-400">
                    <Skull className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Causes de mort</h3>
                <span className="ml-auto text-[10px] text-zinc-500 tabular-nums">{totalDeathsAll} décès</span>
            </div>
            <ul className={`space-y-2.5 ${expandedDeaths ? "max-h-72 overflow-y-auto pr-1" : ""}`}>
                {causes.length === 0 ? (
                    <li className="text-zinc-500 text-sm py-4 text-center">Aucune mort enregistrée</li>
                ) : (
                    visibleCauses.map((c, i) => {
                        const colorKey = (["rose", "amber", "zinc", "orange", "violet"][i % 5] || "zinc") as ColorKey;
                        const dc = COLOR_MAP[colorKey];
                        return (
                            <li key={i} className="flex items-center gap-2 text-xs" title={`${c.cause} · ${c.count} morts`}>
                                <div className={`w-7 h-7 rounded-md border ${dc.iconBorder} ${dc.iconBg} flex items-center justify-center ${dc.text} flex-shrink-0`}>
                                    <DynamicIcon name={c.icon} className="w-3.5 h-3.5" />
                                </div>
                                <span className="text-zinc-200 flex-1">{c.cause}</span>
                                <span className={`${dc.text} font-semibold tabular-nums`}>{c.count}</span>
                            </li>
                        );
                    })
                )}
            </ul>
            {hiddenCauses > 0 && (
                <button
                    type="button"
                    onClick={() => setExpandedDeaths((v) => !v)}
                    className="mt-3 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-rose-300 transition-colors flex items-center justify-center gap-1.5"
                >
                    {expandedDeaths ? "Masquer" : `Voir les ${hiddenCauses} autres causes`}
                </button>
            )}
        </div>
    </div>
    );
};

// ── 13. Profil de Citizen ─────────────────────────────────────────────────
const ProfileCard = ({ stats }: SectionProps) => (
    <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute right-[-10%] top-[-30%] w-64 h-64 bg-gradient-to-br from-cyan-500/[0.06] to-violet-500/[0.06] blur-3xl rounded-full pointer-events-none" />
        <div className="flex items-start justify-between mb-5 relative">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 to-violet-500/15 flex items-center justify-center text-cyan-300">
                    <IdCard className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Ton profil de Citizen</h3>
                    <p className="text-[11px] text-zinc-400">Classification automatique basée sur ton activité</p>
                </div>
            </div>
            <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Profil dominant</div>
                <div className="text-lg font-semibold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                    {stats.playerProfile.dominantLabel}
                </div>
            </div>
        </div>

        <div className="space-y-3 relative">
            {stats.playerProfile.breakdown.length === 0 && (
                <div className="py-6 text-center text-sm text-zinc-400">
                    Pas encore assez d'activité pour te classer.
                    <span className="block text-xs text-zinc-500 mt-1">
                        Vole, mine, combats — ton profil se précisera avec le temps.
                    </span>
                </div>
            )}
            {stats.playerProfile.breakdown.map((b, i) => {
                const color = b.color as ColorKey;
                const c = COLOR_MAP[color] ?? COLOR_MAP.emerald;
                return (
                    <div key={i}>
                        <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                                <DynamicIcon name={b.icon} className={`w-3.5 h-3.5 ${c.text}`} />
                                <span className="text-xs text-white font-medium">{b.category}</span>
                            </div>
                            <span className={`text-xs ${c.text} font-semibold tabular-nums`}>{b.percent}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                            <div
                                className={`h-full rounded-full ${c.bar80}`}
                                style={{ width: `${b.percent}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>

        <div className="mt-5 pt-4 border-t border-white/5 text-[11px] text-zinc-400 flex justify-between items-center">
            <span>Basé sur les vaisseaux pilotés × temps × zones visitées</span>
        </div>
    </div>
);

// ── 14. Achievements ──────────────────────────────────────────────────────
const Achievements = ({ stats }: SectionProps) => {
    const VISIBLE_COUNT = 8; // 2 lignes de 4 par défaut
    const [expanded, setExpanded] = useState(false);
    const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
    const items = stats.achievements.items;
    const filteredItems = filter === "unlocked"
        ? items.filter((a) => a.unlocked)
        : filter === "locked"
        ? items.filter((a) => !a.unlocked)
        : items;
    // Tri : débloqués en haut quand "all"
    const sortedItems = filter === "all"
        ? [...filteredItems].sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1))
        : filteredItems;
    const visibleItems = expanded ? sortedItems : sortedItems.slice(0, VISIBLE_COUNT);
    const hiddenCount = sortedItems.length - VISIBLE_COUNT;
    return (
    <div className="bg-[hsl(var(--background)/0.55)] backdrop-blur-md border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <Trophy className="w-4 h-4" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Faits d'armes</h3>
                    <p className="text-[11px] text-zinc-400">
                        {stats.achievements.unlockedCount} trophées débloqués sur {stats.achievements.totalCount}
                    </p>
                </div>
            </div>
            {/* Filtres */}
            <div className="flex items-center gap-1 text-[10px]">
                {([
                    { id: "all", label: "Tous", count: items.length },
                    { id: "unlocked", label: "Débloqués", count: stats.achievements.unlockedCount },
                    { id: "locked", label: "À débloquer", count: items.length - stats.achievements.unlockedCount },
                ] as const).map((f) => {
                    const active = filter === f.id;
                    return (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => { setFilter(f.id); setExpanded(false); }}
                            className={`px-2 py-1 rounded-md border transition-colors ${
                                active
                                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                                    : "border-white/5 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                            }`}
                        >
                            {f.label} <span className="opacity-60">{f.count}</span>
                        </button>
                    );
                })}
            </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {visibleItems.map((a) => {
                const c = COLOR_MAP[a.color];
                if (!a.unlocked) {
                    return (
                        <div
                            key={a.id}
                            className="group relative bg-[hsl(var(--background)/0.4)] border border-white/5 rounded-xl p-3 opacity-50 hover:opacity-70 transition-opacity"
                            title={a.description}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-zinc-500">
                                    <Lock className="w-4 h-4" />
                                </div>
                                <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">Verrouillé</span>
                            </div>
                            <div className="text-xs text-zinc-400 font-semibold leading-tight">{a.label}</div>
                            <div className="text-[10px] text-zinc-600 mt-0.5">{a.description}</div>
                        </div>
                    );
                }
                return (
                    <div
                        key={a.id}
                        className={`group relative bg-[hsl(var(--background)/0.4)] border border-white/10 rounded-xl p-3 ${c.hover} transition-colors`}
                        title={a.unlockedDate ? `Débloqué le ${formatDateFr(a.unlockedDate)}` : a.description}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <div className={`w-8 h-8 rounded-lg border ${c.iconBorder30} ${c.iconBg15} flex items-center justify-center ${c.text}`}>
                                <DynamicIcon name={a.icon} className="w-4 h-4" />
                            </div>
                            <span className={`text-[9px] uppercase tracking-widest ${c.text} font-semibold`}>Débloqué</span>
                        </div>
                        <div className="text-xs text-white font-semibold leading-tight">{a.label}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                            {a.unlockedDate ? formatShortDate(a.unlockedDate) : a.description}
                        </div>
                    </div>
                );
            })}
        </div>
        {hiddenCount > 0 && (
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-4 pt-3 border-t border-white/5 w-full text-[11px] text-zinc-400 hover:text-amber-300 transition-colors flex items-center justify-center gap-1.5"
            >
                {expanded ? "Masquer" : `Voir les ${hiddenCount} autres trophées`}
            </button>
        )}
    </div>
    );
};

// ── État chargement / vide / erreur (avant l'arrivée des vraies stats) ──────
function LogbookPlaceholder({
    phase,
    progress,
    error,
}: {
    phase: LogbookPhase;
    progress: number;
    error: string | null;
}) {
    return (
        <div className="w-full max-w-[640px] mx-auto px-6 py-24 flex flex-col items-center text-center gap-5">
            {(phase === "scanning" || phase === "loading") && (
                <>
                    <Loader2 className="w-9 h-9 text-emerald-400 animate-spin" />
                    <div className="space-y-1.5">
                        <p className="text-base font-semibold text-zinc-100">
                            {phase === "scanning"
                                ? "Analyse de ton historique de vol…"
                                : "Agrégation de tes stats…"}
                        </p>
                        <p className="text-sm text-zinc-400 max-w-md">
                            {phase === "scanning"
                                ? "Lecture de tes archives Game.log (logbackups). Le premier scan peut prendre quelques secondes."
                                : "Presque prêt."}
                        </p>
                    </div>
                    {phase === "scanning" && (
                        <div className="w-full max-w-sm">
                            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="mt-1.5 text-xs text-zinc-500 tabular-nums">{progress}%</p>
                        </div>
                    )}
                </>
            )}
            {phase === "empty" && (
                <>
                    <BookOpen className="w-9 h-9 text-zinc-500" />
                    <div className="space-y-1.5">
                        <p className="text-base font-semibold text-zinc-100">Ton carnet est encore vide</p>
                        <p className="text-sm text-zinc-400 max-w-md">
                            Aucune session trouvée dans tes Game.log. Lance Star Citizen et joue un peu —
                            ton historique se construira tout seul (lecture 100% locale).
                        </p>
                    </div>
                </>
            )}
            {phase === "error" && (
                <>
                    <AlertTriangle className="w-9 h-9 text-rose-400" />
                    <div className="space-y-1.5">
                        <p className="text-base font-semibold text-zinc-100">
                            Impossible de lire ton historique
                        </p>
                        <p className="text-sm text-zinc-400 max-w-md break-words">
                            {error ?? "Erreur inconnue."}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Composant principal exporté ───────────────────────────────────────────
interface LogbookProps {
    onClose: () => void;
}
export default function Logbook({ onClose }: LogbookProps) {
    const { stats, phase, progress, error } = useLogbookStats();
    const contentRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    /**
     * Exporte le carnet complet en PNG.
     * - html2canvas capture l'élément (scrollable) en entier
     * - Dialog Tauri pour choisir où enregistrer
     * - Commande Rust `write_binary_file` écrit le buffer
     */
    const handleExport = async () => {
        const node = contentRef.current;
        if (!node) return;

        try {
            toast({
                title: "Capture en cours...",
                description: "Génération de l'image du carnet.",
            });

            const canvas = await html2canvas(node, {
                backgroundColor: "#0a0a0a",
                scale: 2,
                useCORS: true,
                logging: false,
                windowWidth: node.scrollWidth,
                windowHeight: node.scrollHeight,
                scrollY: -node.scrollTop,
            });

            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, "image/png")
            );
            if (!blob) throw new Error("Échec de la capture");

            const filename = `carnet-de-bord-${new Date().toISOString().split("T")[0]}.png`;

            if (isTauri()) {
                const { save } = await import("@tauri-apps/plugin-dialog");
                const filePath = await save({
                    title: "Enregistrer mon carnet de bord",
                    defaultPath: filename,
                    filters: [{ name: "Image PNG", extensions: ["png"] }],
                });
                if (!filePath) return; // user a annulé le dialog
                const buffer = await blob.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buffer));
                await invoke("write_binary_file", { path: filePath, content: bytes });
                toast({
                    title: "Carnet enregistré",
                    description: `Image sauvegardée : ${filename}`,
                    variant: "success",
                });
            } else {
                // Fallback navigateur (dev sans Tauri) : download via anchor
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast({ title: "Carnet téléchargé", description: filename });
            }
        } catch (e: any) {
            console.error("Export carnet échoué:", e);
            toast({
                title: "Échec de l'export",
                description: e?.message || "Impossible de générer l'image.",
                variant: "destructive",
            });
        }
    };

    return (
        <>
            <Header onClose={onClose} onExport={handleExport} />
            <div ref={contentRef} className="flex-1 overflow-y-auto w-full relative">
                {stats ? (
                    <div className="w-full max-w-[1100px] mx-auto p-6 md:p-8 space-y-4">
                        <LastSession stats={stats} />
                        <KpiRow stats={stats} />
                        <Heatmap stats={stats} />
                        <div className="grid grid-cols-2 gap-4">
                            <TopList id="logbook-top-vehicles" title="Vaisseaux pilotés" icon={Ship} color="sky" metric="sessions" items={stats.topVehicles} />
                            <TopList id="logbook-top-locations" title="Lieux visités" icon={MapPin} color="violet" metric="visits" items={stats.topLocations} />
                        </div>
                        <MonthlyChart stats={stats} />
                        <RecentSessions stats={stats} />
                        <MissionsCard stats={stats} />
                        <EconomySection stats={stats} />
                        <CombatAndBlueprints stats={stats} />
                        <RecordsAndEncounters stats={stats} />
                        <Companions stats={stats} />
                        <GalaxyMap stats={stats} />
                        <HourlyAndWeekday stats={stats} />
                        <QuantumAndDeaths stats={stats} />
                        <ProfileCard stats={stats} />
                        <Achievements stats={stats} />
                    </div>
                ) : (
                    <LogbookPlaceholder phase={phase} progress={progress} error={error} />
                )}
            </div>
        </>
    );
}
