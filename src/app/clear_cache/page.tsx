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
            className="flex h-screen flex-col max-w-full"
        >
            <div className="flex items-center gap-2">
                <h1 className="text-2xl">Gestion du cache</h1>
                <ActionsMenu setCacheInfos={setCacheInfos} />
            </div>
            <Separator className="my-5" />
            <DataTable
                columns={columns(toast, updateCacheInfos)}
                data={cacheInfos}
            />
        </motion.div>
    ) : (
        <div className="flex h-screen max-w-full flex-row gap-3 items-center justify-center">
            <p>
                Récupération des données{" "}
                {Array.from({ length: loadingDot }).map(() => ".")}
            </p>
        </div>
    );
}
