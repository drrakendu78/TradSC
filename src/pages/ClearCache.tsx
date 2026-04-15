"use client";
import { m } from "framer-motion";
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CacheInfos, columns, Folder } from "@/components/custom/clear-cache/columns";
import { DataTable } from "@/components/custom/clear-cache/data-table";
import ActionsMenu from "@/components/custom/clear-cache/actions";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, HardDrive } from "lucide-react";

export default function ClearCache() {
    const [cacheInfos, setCacheInfos] = useState<Folder[] | null>(null);
    const { toast } = useToast();
    const [loadingDot, setLoadingDot] = useState(0);

    const ScanCache = useCallback(async () => {
        const result: CacheInfos = JSON.parse(
            await invoke("get_cache_informations"),
        );
        setCacheInfos(result.folders);
    }, [setCacheInfos]);

    const updateCacheInfos = (path: string) => {
        setCacheInfos(
            (prev) => prev?.filter((folder) => folder.path !== path) || null,
        );
    };

    useEffect(() => {
        if (!cacheInfos) {
            ScanCache();
        }
    }, [cacheInfos, ScanCache]);

    useEffect(() => {
        if (cacheInfos) return;
        const interval = setInterval(() => {
            setLoadingDot((prev) => (prev + 1) % 4);
        }, 500);

        return () => clearInterval(interval);
    }, [cacheInfos]);

    // Calcul de la taille totale du cache (weight est une string comme "142 Mo")
    const parseWeight = (weight: string): number => {
        const match = weight.match(/([\d.]+)\s*(B|Ko|Mo|Go|KB|MB|GB)/i);
        if (!match) return 0;
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        const multipliers: Record<string, number> = {
            b: 1,
            ko: 1024, kb: 1024,
            mo: 1024 * 1024, mb: 1024 * 1024,
            go: 1024 * 1024 * 1024, gb: 1024 * 1024 * 1024,
        };
        return value * (multipliers[unit] || 1);
    };

    const totalSize = cacheInfos?.reduce((acc, folder) => acc + parseWeight(folder.weight), 0) || 0;

    const formatSize = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "Ko", "Mo", "Go"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const folderCount = cacheInfos?.length ?? 0;

    return cacheInfos ? (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                {/* Header */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10">
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Gestionnaire du Cache</h1>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        {folderCount} dossier{folderCount > 1 ? "s" : ""}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Liberez de l'espace et optimisez les performances</p>
                            </div>
                        </div>
                        <ActionsMenu setCacheInfos={setCacheInfos} />
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-red-500/25 via-border/40 to-transparent" />
                </section>

                {/* Inline stats */}
                <section className="grid grid-cols-1 gap-2.5 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.12)] px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-orange-500/30 bg-orange-500/10">
                                <HardDrive className="h-4.5 w-4.5 text-orange-500" />
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Espace utilise</p>
                                <p className="text-xl font-semibold tracking-tight text-foreground">{formatSize(totalSize)}</p>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-xl border border-border/25 bg-[hsl(var(--background)/0.08)] px-3 py-2.5">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Nettoyer regulierement le cache peut ameliorer les performances et corriger certains bugs graphiques
                            (shaders corrompus).
                        </p>
                    </div>
                </section>

                {/* Table */}
                <DataTable
                    columns={columns(toast, updateCacheInfos)}
                    data={cacheInfos}
                />
            </div>
        </m.div>
    ) : (
        <div className="flex h-full w-full items-center justify-center p-4">
            <section className="w-full max-w-md rounded-xl border border-border/40 bg-[hsl(var(--background)/0.14)] p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-background/30">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                    Analyse du cache en cours
                    {Array.from({ length: loadingDot }).map((_, i) => <span key={i}>.</span>)}
                </p>
            </section>
        </div>
    );
}
