import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ExternalLink } from 'lucide-react';

interface ServiceStatus {
    name: string;
    status: 'operational' | 'maintenance' | 'partial' | 'major' | 'degraded' | 'unknown';
}

const STATUS_COLORS: Record<string, string> = {
    operational: 'bg-green-500',
    maintenance: 'bg-red-500',
    partial: 'bg-orange-500',
    major: 'bg-red-500',
    degraded: 'bg-orange-500',
    unknown: 'bg-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
    operational: 'Opérationnel',
    maintenance: 'Maintenance',
    partial: 'Partiel',
    major: 'Panne majeure',
    degraded: 'Dégradé',
    unknown: 'Inconnu',
};

function parseStatusPage(html: string): ServiceStatus[] {
    const services: ServiceStatus[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const statusEls = doc.querySelectorAll('.component-status[data-status]');
    statusEls.forEach((el) => {
        const component = el.closest('.component');
        const name = component?.querySelector('.name')?.textContent?.trim();
        const status = el.getAttribute('data-status') || 'unknown';
        if (name) {
            services.push({ name, status: status as ServiceStatus['status'] });
        }
    });

    if (services.length === 0) {
        const knownServices = ['Platform', 'Persistent Universe', 'Arena Commander'];
        for (const svc of knownServices) {
            const regex = new RegExp(`${svc}[\\s\\S]*?data-status="(\\w+)"`, 'i');
            const match = html.match(regex);
            if (match) {
                services.push({ name: svc, status: match[1] as ServiceStatus['status'] });
            } else {
                services.push({ name: svc, status: 'unknown' });
            }
        }
    }

    return services;
}

function getOverallStatus(services: ServiceStatus[]): ServiceStatus['status'] {
    if (services.some(s => s.status === 'major')) return 'major';
    if (services.some(s => s.status === 'partial')) return 'partial';
    if (services.some(s => s.status === 'degraded')) return 'degraded';
    if (services.some(s => s.status === 'maintenance')) return 'maintenance';
    if (services.every(s => s.status === 'operational')) return 'operational';
    return 'unknown';
}

export default function ServerStatus() {
    const [services, setServices] = useState<ServiceStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = async () => {
        try {
            const html: string = await invoke('fetch_server_status');
            const parsed = parseStatusPage(html);
            setServices(parsed);
        } catch (err) {
            console.error('Erreur fetch statut serveurs:', err);
            setServices([
                { name: 'Platform', status: 'unknown' },
                { name: 'Persistent Universe', status: 'unknown' },
                { name: 'Arena Commander', status: 'unknown' },
            ]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        intervalRef.current = setInterval(fetchStatus, 5 * 60 * 1000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const overall = getOverallStatus(services);
    const dotColor = STATUS_COLORS[overall] || STATUS_COLORS.unknown;

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
                            <div className={`h-2.5 w-2.5 rounded-full ${dotColor} animate-pulse`} />
                            <span className="text-xs text-muted-foreground">Serveurs</span>
                        </button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="p-3">
                    <p className="text-xs font-semibold mb-2">Statut des serveurs</p>
                    <div className="flex flex-col gap-1.5">
                        {services.map((service) => (
                            <div key={service.name} className="flex items-center justify-between gap-4">
                                <span className="text-xs">{service.name}</span>
                                <div className="flex items-center gap-1.5">
                                    <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[service.status] || STATUS_COLORS.unknown}`} />
                                    <span className="text-xs text-muted-foreground">
                                        {STATUS_LABELS[service.status] || 'Inconnu'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
            <PopoverContent side="bottom" align="end" className="w-auto p-3">
                <p className="text-xs font-semibold mb-2">Statut des serveurs</p>
                <div className="flex flex-col gap-1.5">
                    {services.map((service) => (
                        <div key={service.name} className="flex items-center justify-between gap-4">
                            <span className="text-xs">{service.name}</span>
                            <div className="flex items-center gap-1.5">
                                <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[service.status] || STATUS_COLORS.unknown}`} />
                                <span className="text-xs text-muted-foreground">
                                    {STATUS_LABELS[service.status] || 'Inconnu'}
                                </span>
                            </div>
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
