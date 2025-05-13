"use client";
import { motion } from "framer-motion";
import { Separator } from "@/components/ui/separator";
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { CacheInfos, columns, Folder } from "./columns";
import { DataTable } from "./data-table";
import { useToast } from "@/hooks/use-toast";
import ActionsMenu from "./actions";

export default function ClearCachePage() {
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

    return cacheInfos ? (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
                duration: 0.8,
                delay: 0.2,
                ease: [0, 0.71, 0.2, 1.01],
            }}
            className="flex h-full max-h-screen flex-col max-w-full p-6"
        >
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-primary">Gestion du cache</h1>
                    <p className="text-muted-foreground mt-2">
                        Gérez et nettoyez les fichiers de cache de Star Citizen.
                    </p>
            </div>
                <Separator />
                <div className="h-[calc(100vh-12rem)]">
            <DataTable
                columns={columns(toast, updateCacheInfos)}
                data={cacheInfos}
            />
                </div>
            </div>
        </motion.div>
    ) : (
        <div className="flex h-[calc(100vh-12rem)] max-w-full flex-col items-center justify-center">
            <div className="text-center space-y-4">
                <h2 className="text-3xl font-bold text-primary">
                    Récupération des données
                </h2>
                <p className="text-muted-foreground">
                    Chargement en cours{Array.from({ length: loadingDot }).map(() => ".")}
            </p>
            </div>
        </div>
    );
}
