import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Card, CardContent } from '@/components/ui/card';
import { Server, Box, RefreshCw, AlertTriangle, CircleCheck, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { isTauri } from '@/utils/tauri-helpers';
import { useTranslationStatus } from '@/hooks/useTranslationStatus';
import openExternal from '@/utils/external';

interface RsiSystem {
    name: string;
    status: string;
    issues: { title: string; severity: string; permalink: string }[];
}

interface RsiStatusFeed {
    overall: string;
    systems: RsiSystem[];
}

const STATUS_DOT: Record<string, string> = {
    operational: 'bg-green-500',
    ok: 'bg-green-500',
    maintenance: 'bg-blue-500',
    partial: 'bg-orange-500',
    major: 'bg-red-500',
    down: 'bg-red-500',
    disrupted: 'bg-orange-500',
    degraded: 'bg-orange-500',
    notice: 'bg-yellow-500',
    unknown: 'bg-gray-500',
};

const STATUS_LABEL: Record<string, string> = {
    operational: 'Opérationnel',
    ok: 'Opérationnel',
    maintenance: 'Maintenance',
    partial: 'Partiel',
    major: 'Panne',
    down: 'Hors-service',
    disrupted: 'Dégradé',
    degraded: 'Dégradé',
    notice: 'Notice',
    unknown: 'Inconnu',
};

const STATUS_TEXT: Record<string, string> = {
    operational: 'text-green-400',
    ok: 'text-green-400',
    maintenance: 'text-blue-400',
    partial: 'text-orange-400',
    major: 'text-red-400',
    down: 'text-red-400',
    disrupted: 'text-orange-400',
    degraded: 'text-orange-400',
    notice: 'text-yellow-400',
    unknown: 'text-zinc-400',
};

const RSI_STATUS_CACHE_KEY = 'startradfr_rsi_status_cache';

function readFeedCache(): RsiStatusFeed | null {
    try {
        const raw = localStorage.getItem(RSI_STATUS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.systems)) {
            return parsed as RsiStatusFeed;
        }
    } catch {}
    return null;
}

export default function HomeStatusCard() {
    const cached = readFeedCache();
    const [feed, setFeed] = useState<RsiStatusFeed | null>(cached);
    const [loading, setLoading] = useState(!cached);
    const [refreshing, setRefreshing] = useState(false);
    const translation = useTranslationStatus();

    const fetchStatus = async (showSpinner = false) => {
        if (!isTauri()) {
            setLoading(false);
            return;
        }
        if (showSpinner) setRefreshing(true);
        try {
            const raw: string = await invoke('fetch_rsi_status_feed');
            const parsed: RsiStatusFeed = JSON.parse(raw);
            setFeed(parsed);
            try { localStorage.setItem(RSI_STATUS_CACHE_KEY, JSON.stringify(parsed)); } catch {}
        } catch (err) {
            console.error('Erreur fetch statut RSI:', err);
            if (!cached) setFeed({ overall: 'unknown', systems: [] });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const id = setInterval(() => fetchStatus(), 2 * 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const overall = feed?.overall ?? 'unknown';
    const isOperational = overall === 'operational' || overall === 'ok';
    const systems = feed?.systems ?? [];

    const versions = translation.versions;

    return (
        <Card className="border-border/40 bg-background/45 backdrop-blur-md">
            <CardContent className="p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Statut serveurs RSI — bloc entier cliquable */}
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openExternal('https://status.robertsspaceindustries.com')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExternal('https://status.robertsspaceindustries.com'); } }}
                        className="group rounded-lg border border-border/30 bg-background/30 p-2.5 transition-colors hover:border-cyan-500/40 hover:bg-background/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        title="Ouvrir RSI Status (externe)"
                    >
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                                    <Server className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold leading-tight flex items-center gap-1 group-hover:text-cyan-300 transition-colors">
                                        Serveurs RSI
                                        <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/60 group-hover:text-cyan-300/80" />
                                    </p>
                                    <p className={`text-[10px] ${STATUS_TEXT[overall] || STATUS_TEXT.unknown}`}>
                                        {loading ? 'Chargement...' : (STATUS_LABEL[overall] || overall)}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); fetchStatus(true); }}
                                disabled={refreshing || loading}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
                                title="Rafraîchir"
                                aria-label="Rafraîchir"
                            >
                                <RefreshCw className={`h-3 w-3 ${refreshing || loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        {systems.length === 0 && !loading ? (
                            <p className="text-[11px] text-muted-foreground">Aucun composant.</p>
                        ) : (
                            <div className="flex flex-col gap-1">
                                {systems.map((s) => (
                                    <div key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                                        <span className="truncate">{s.name}</span>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <div className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] || STATUS_DOT.unknown} ${s.status !== 'operational' && s.status !== 'ok' ? 'animate-pulse' : ''}`} />
                                            <span className={`text-[10px] ${STATUS_TEXT[s.status] || STATUS_TEXT.unknown}`}>
                                                {STATUS_LABEL[s.status] || s.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!loading && !isOperational && systems.some((s) => s.issues.length > 0) && (
                            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/5 p-1.5">
                                <AlertTriangle className="h-3 w-3 flex-shrink-0 text-orange-400 mt-0.5" />
                                <span className="text-[10px] text-orange-300 truncate">
                                    {systems.flatMap((s) => s.issues).slice(0, 1).map((i) => i.title).join('')}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Versions Star Citizen détectées */}
                    <Link to="/traduction" className="block">
                    <div className="rounded-lg border border-border/30 bg-background/30 p-2.5 transition-colors hover:border-violet-500/40 cursor-pointer h-full">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400">
                                <Box className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold leading-tight">Versions Star Citizen</p>
                                <p className="text-[10px] text-muted-foreground">
                                    {versions.length === 0 ? 'Aucune version détectée' : `${versions.length} version${versions.length > 1 ? 's' : ''} installée${versions.length > 1 ? 's' : ''}`}
                                </p>
                            </div>
                        </div>

                        {versions.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">Lancez le RSI Launcher pour installer Star Citizen.</p>
                        ) : (
                            <TooltipProvider>
                                <div className="flex flex-col gap-1">
                                    {versions.map((v) => {
                                        const tone = !v.translated ? 'text-rose-400'
                                            : !v.upToDate ? 'text-amber-400'
                                            : 'text-emerald-400';
                                        const label = !v.translated ? 'Non traduit'
                                            : !v.upToDate ? 'Maj dispo'
                                            : 'À jour';
                                        const versionLabel = v.releaseVersion || v.gameVersion;
                                        const hasMeta = v.releaseVersion || v.gameVersion || v.buildNumber || v.branch;
                                        return (
                                            <div key={v.version} className="flex items-center justify-between gap-2 text-[11px]">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="font-medium flex-shrink-0">{v.version}</span>
                                                    {versionLabel && hasMeta && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="inline-flex items-center rounded-md border border-cyan-500/25 bg-cyan-500/10 px-1 py-0 text-[9px] font-medium text-cyan-400 cursor-help truncate">
                                                                    {versionLabel}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="bottom" sideOffset={6} align="start" className="text-xs !overflow-visible max-w-[280px]">
                                                                <div className="space-y-0.5 whitespace-nowrap">
                                                                    {v.releaseVersion && <p>Version launcher : {v.releaseVersion}</p>}
                                                                    {v.gameVersion && <p>Version : {v.gameVersion}</p>}
                                                                    {v.buildNumber && <p>Build P4 : {v.buildNumber}</p>}
                                                                    {v.branch && <p>Branche : {v.branch}</p>}
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    <CircleCheck className={`h-3 w-3 ${v.translated && v.upToDate ? 'text-emerald-400' : 'text-muted-foreground/40'}`} />
                                                    <span className={`text-[10px] ${tone}`}>{label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </TooltipProvider>
                        )}
                    </div>
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}
