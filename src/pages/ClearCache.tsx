"use client";
import { motion } from "framer-motion";
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CacheInfos, columns, Folder } from "@/components/custom/clear-cache/columns";
import { DataTable } from "@/components/custom/clear-cache/data-table";
import ActionsMenu from "@/components/custom/clear-cache/actions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
            if (loadingDot === 3) {
                setLoadingDot(0);
            }
            setLoadingDot((prev) => prev + 1);
        }, 500);

        return () => clearInterval(interval);
    }, [cacheInfos, loadingDot]);

    // Calcul de la taille totale du cache (weight est une string comme "142 Mo")
    const parseWeight = (weight: string): number => {
        const match = weight.match(/([\d.]+)\s*(B|Ko|Mo|Go|KB|MB|GB)/i);
        if (!match) return 0;
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        const multipliers: Record<string, number> = {
            'b': 1,
            'ko': 1024, 'kb': 1024,
            'mo': 1024 * 1024, 'mb': 1024 * 1024,
            'go': 1024 * 1024 * 1024, 'gb': 1024 * 1024 * 1024,
        };
        return value * (multipliers[unit] || 1);
    };
    
    const totalSize = cacheInfos?.reduce((acc, folder) => acc + parseWeight(folder.weight), 0) || 0;
    
    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return cacheInfos ? (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/10">
                            <Trash2 className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Gestionnaire du Cache</h1>
                            <p className="text-sm text-muted-foreground">Libérez de l'espace et optimisez les performances</p>
                        </div>
                    </div>
                    <ActionsMenu setCacheInfos={setCacheInfos} />
                </div>

                {/* Stats Card */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20">
                        <CardContent className="py-4 flex items-center gap-4">
                            <div className="p-3 rounded-full bg-orange-500/20">
                                <HardDrive className="h-6 w-6 text-orange-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Espace utilisé</p>
                                <p className="text-2xl font-bold text-orange-500">{formatSize(totalSize)}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-muted/30 border-muted">
                        <CardContent className="py-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                💡 Nettoyer régulièrement le cache peut améliorer les performances et résoudre certains bugs graphiques (shaders corrompus).
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Table */}
                <Card className="flex-1 overflow-hidden">
                    <CardContent className="p-0">
                        <DataTable
                            columns={columns(toast, updateCacheInfos)}
                            data={cacheInfos}
                        />
                    </CardContent>
                </Card>
            </div>
        </motion.div>
    ) : (
        <div className="flex h-full w-full flex-col gap-4 items-center justify-center">
            <div className="p-4 rounded-full bg-muted animate-pulse">
                <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
            </div>
            <p className="text-muted-foreground">
                Analyse du cache en cours{Array.from({ length: loadingDot }).map((_, i) => <span key={i}>.</span>)}
            </p>
        </div>
    );
}
