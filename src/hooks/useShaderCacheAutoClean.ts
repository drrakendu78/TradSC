import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/utils/tauri-helpers';

export const AUTO_CLEAN_OBSOLETE_CACHES_KEY = 'startradfr_auto_clear_obsolete_caches';

interface RawVersionInfo {
    path?: string;
    game_version?: string | null;
    release_version?: string | null;
    build_number?: string | null;
    branch?: string | null;
}

interface CacheFolder {
    name: string;
    weight: string;
    path: string;
}

interface CacheInfoResponse {
    folders?: CacheFolder[];
}

export interface AutoCleanResult {
    cleared: string[];
    freedMb: number;
}

const SC_VERSION_RE = /sc-alpha-(\d+\.\d+\.\d+)/i;

function parseWeightMb(weight: string): number {
    const m = weight.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
}

export function isAutoCleanEnabled(): boolean {
    try {
        return localStorage.getItem(AUTO_CLEAN_OBSOLETE_CACHES_KEY) === 'true';
    } catch {
        return false;
    }
}

export async function runShaderCacheAutoClean(): Promise<AutoCleanResult> {
    if (!isTauri()) return { cleared: [], freedMb: 0 };

    const [versions, cacheInfoStr] = await Promise.all([
        invoke<Record<string, RawVersionInfo>>('get_star_citizen_versions').catch(
            () => ({} as Record<string, RawVersionInfo>),
        ),
        invoke<string>('get_cache_informations').catch(() => '{"folders":[]}'),
    ]);

    const installedVersions = new Set<string>();
    for (const v of Object.values(versions)) {
        if (v && typeof v.game_version === 'string' && v.game_version.length > 0) {
            installedVersions.add(v.game_version);
        }
    }

    let cacheInfo: CacheInfoResponse;
    try {
        cacheInfo = JSON.parse(cacheInfoStr);
    } catch {
        return { cleared: [], freedMb: 0 };
    }

    const cleared: string[] = [];
    let freedMb = 0;

    for (const folder of cacheInfo.folders ?? []) {
        const m = folder.name.match(SC_VERSION_RE);
        if (!m) continue;
        const cacheVersion = m[1];
        if (installedVersions.has(cacheVersion)) continue;

        const ok = await invoke<boolean>('delete_folder', { path: folder.path }).catch(() => false);
        if (ok) {
            cleared.push(cacheVersion);
            freedMb += parseWeightMb(folder.weight);
        }
    }

    return { cleared, freedMb };
}

export function useShaderCacheAutoCleanOnBoot() {
    const { toast } = useToast();

    useEffect(() => {
        if (!isAutoCleanEnabled()) return;
        let cancelled = false;
        runShaderCacheAutoClean()
            .then((result) => {
                if (cancelled) return;
                if (result.cleared.length > 0) {
                    toast({
                        title: 'Caches obsolètes nettoyés',
                        description: `${result.cleared.length} cache(s) supprimé(s) (versions ${result.cleared.join(', ')}) — ${result.freedMb.toFixed(0)} Mo libérés.`,
                    });
                }
            })
            .catch((error) => {
                console.error('Erreur lors du nettoyage automatique des caches:', error);
            });
        return () => {
            cancelled = true;
        };
    }, [toast]);
}
