import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ExternalLink, RefreshCw } from 'lucide-react';

interface RsiIssue {
    title: string;
    severity: string;
    permalink: string;
}

interface RsiSystem {
    name: string;
    status: string;
    category: string;
    issues: RsiIssue[];
}

interface RsiStatusFeed {
    overall: string;
    systems: RsiSystem[];
}

const STATUS_COLORS: Record<string, string> = {
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

const STATUS_LABELS: Record<string, string> = {
    operational: 'Opérationnel',
    ok: 'Opérationnel',
    maintenance: 'Maintenance',
    partial: 'Partiel',
    major: 'Panne majeure',
    down: 'Hors-service',
    disrupted: 'Dégradé',
    degraded: 'Dégradé',
    notice: 'Notice',
    unknown: 'Inconnu',
};

const STATUS_TEXT_TONE: Record<string, string> = {
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

export default function ServerStatus() {
    const [feed, setFeed] = useState<RsiStatusFeed | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
            const raw: string = await invoke('fetch_rsi_status_feed');
            const parsed: RsiStatusFeed = JSON.parse(raw);
            setFeed(parsed);
        } catch (err) {
            console.error('Erreur fetch statut serveurs:', err);
            setFeed({ overall: 'unknown', systems: [] });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        // Refresh toutes les 2 minutes — statut en temps réel
        intervalRef.current = setInterval(() => fetchStatus(), 2 * 60 * 1000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const overall = feed?.overall ?? 'unknown';
    const dotColor = STATUS_COLORS[overall] || STATUS_COLORS.unknown;
    const isOperational = overall === 'operational' || overall === 'ok';
    const systems = feed?.systems ?? [];

    if (loading) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-1">
                <div className="h-2.5 w-2.5 rounded-full bg-gray-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">Serveurs</span>
            </div>
        );
    }

    return (
        <TooltipProvider>
        <Popover>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <button
                            className="flex items-center gap-1.5 px-2 py-1 hover:opacity-70 transition-opacity cursor-pointer"
                        >
                            <div className={`h-2.5 w-2.5 rounded-full ${dotColor} ${!isOperational ? 'animate-pulse' : ''}`} />
                            <span className="text-xs text-muted-foreground">Serveurs</span>
                        </button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="p-2.5">
                    <p className="text-xs font-semibold mb-1.5 text-zinc-100">Statut RSI</p>
                    <div className="flex flex-col gap-1">
                        {systems.length === 0 ? (
                            <span className="text-[11px] text-zinc-400">Statut inconnu</span>
                        ) : systems.map((s) => (
                            <div key={s.name} className="flex items-center justify-between gap-4 text-[11px]">
                                <span className="text-zinc-200">{s.name}</span>
                                <div className="flex items-center gap-1.5">
                                    <div className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[s.status] || STATUS_COLORS.unknown}`} />
                                    <span className={STATUS_TEXT_TONE[s.status] || STATUS_TEXT_TONE.unknown}>
                                        {STATUS_LABELS[s.status] || s.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
            <PopoverContent side="bottom" align="end" className="w-72 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold">Statut RSI</p>
                    <button
                        onClick={() => fetchStatus(true)}
                        disabled={refreshing}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
                        title="Rafraîchir"
                        aria-label="Rafraîchir"
                    >
                        <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="flex items-center gap-1.5 mb-2">
                    <div className={`h-2 w-2 rounded-full ${dotColor}`} />
                    <span className={`text-[11px] font-medium ${STATUS_TEXT_TONE[overall] || STATUS_TEXT_TONE.unknown}`}>
                        {STATUS_LABELS[overall] || overall}
                    </span>
                </div>

                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                    {systems.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Aucun composant.</p>
                    ) : systems.map((s) => (
                        <div key={s.name} className="rounded-md border border-border/40 bg-background/30 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs truncate">{s.name}</span>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <div className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[s.status] || STATUS_COLORS.unknown}`} />
                                    <span className={`text-[10px] font-medium ${STATUS_TEXT_TONE[s.status] || STATUS_TEXT_TONE.unknown}`}>
                                        {STATUS_LABELS[s.status] || s.status}
                                    </span>
                                </div>
                            </div>
                            {s.issues.length > 0 && (
                                <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
                                    {s.issues.map((iss, idx) => (
                                        <div key={iss.permalink || idx} className="text-[10px] text-muted-foreground truncate" title={iss.title}>
                                            ↳ {iss.title}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <button
                    onClick={() => invoke('open_external', { url: 'https://status.robertsspaceindustries.com' })}
                    className="flex items-center gap-1.5 mt-3 pt-2 border-t border-border/50 text-xs text-primary hover:underline cursor-pointer w-full"
                >
                    <ExternalLink className="h-3 w-3" />
                    Voir sur RSI Status
                </button>
            </PopoverContent>
        </Popover>
        </TooltipProvider>
    );
}
