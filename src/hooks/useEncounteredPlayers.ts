/**
 * Hook qui enrichit la liste des joueurs croisés (encounteredPlayers) avec
 * leur profil RSI (avatar + org) et leur tag user (ami / org / ennemi + note).
 *
 * - Fetch lazy : ne fetch qu'au mount, en background, sans bloquer le rendu
 * - Cache côté Rust persistant (30 jours par profil)
 * - Tags 100% local (citizen_tags.json dans app_config_dir)
 *
 * Fonctions exposées :
 *   - players : liste enrichie (mêmes ordre que l'input)
 *   - loading : true pendant le 1er fetch
 *   - setTag : tagger un handle (friend/org/enemy ou null pour reset)
 *   - openProfile : ouvre la page RSI dans le navigateur externe
 *   - refresh : force refresh d'un handle
 */
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { isTauri } from "@/utils/tauri-helpers";

export type TagKind = "friend" | "org" | "enemy";

export interface CitizenTag {
    handle: string;
    tag: TagKind;
    note?: string;
    markedAt: number;
}

export type ProfileStatus = "found" | "notFound" | "private" | "error";

export interface CitizenProfile {
    handle: string;
    displayName?: string;
    avatarUrl?: string;
    orgName?: string;
    orgSid?: string;
    status: ProfileStatus;
    fetchedAt: number;
}

export interface EnrichedPlayer {
    handle: string;
    profile: CitizenProfile;
    tag?: CitizenTag;
}

export interface EncounteredPlayerInput {
    name: string;
    kills: number;
    deaths: number;
    lastSeen: string;
}

export interface EnrichedEncounteredPlayer extends EncounteredPlayerInput {
    profile?: CitizenProfile;
    tag?: CitizenTag;
}

export function useEncounteredPlayers(
    input: EncounteredPlayerInput[],
): {
    players: EnrichedEncounteredPlayer[];
    loading: boolean;
    setTag: (handle: string, tag: TagKind | null, note?: string) => Promise<void>;
    openProfile: (handle: string) => void;
    refresh: (handle: string) => Promise<void>;
    friendsCount: number;
    orgCount: number;
    enemyCount: number;
} {
    const [enriched, setEnriched] = useState<Map<string, { profile?: CitizenProfile; tag?: CitizenTag }>>(new Map());
    const [loading, setLoading] = useState(false);

    // Fetch initial : invoke 'enrich_encountered_players' avec tous les handles
    useEffect(() => {
        if (!isTauri() || input.length === 0) return;
        let cancelled = false;
        setLoading(true);
        const handles = input.map((p) => p.name);
        invoke<EnrichedPlayer[]>("enrich_encountered_players", { handles, ttlDays: 30 })
            .then((result) => {
                if (cancelled) return;
                const map = new Map<string, { profile?: CitizenProfile; tag?: CitizenTag }>();
                for (const r of result) {
                    map.set(r.handle.toLowerCase(), { profile: r.profile, tag: r.tag ?? undefined });
                }
                setEnriched(map);
            })
            .catch((err) => {
                console.warn("[useEncounteredPlayers] enrich failed:", err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.length]); // re-fetch si la liste change de taille (nouveau scan)

    const setTag = useCallback(
        async (handle: string, tag: TagKind | null, note?: string) => {
            if (!isTauri()) return;
            try {
                if (tag === null) {
                    await invoke("citizen_tag_remove", { handle });
                    setEnriched((prev) => {
                        const next = new Map(prev);
                        const cur = next.get(handle.toLowerCase());
                        if (cur) next.set(handle.toLowerCase(), { profile: cur.profile, tag: undefined });
                        return next;
                    });
                } else {
                    const newTag = await invoke<CitizenTag>("citizen_tag_set", { handle, tag, note: note ?? null });
                    setEnriched((prev) => {
                        const next = new Map(prev);
                        const cur = next.get(handle.toLowerCase()) ?? {};
                        next.set(handle.toLowerCase(), { profile: cur.profile, tag: newTag });
                        return next;
                    });
                }
            } catch (err) {
                console.warn("[useEncounteredPlayers] setTag failed:", err);
            }
        },
        [],
    );

    const refresh = useCallback(async (handle: string) => {
        if (!isTauri()) return;
        try {
            const profile = await invoke<CitizenProfile>("citizen_profile_refresh", { handle });
            setEnriched((prev) => {
                const next = new Map(prev);
                const cur = next.get(handle.toLowerCase()) ?? {};
                next.set(handle.toLowerCase(), { profile, tag: cur.tag });
                return next;
            });
        } catch (err) {
            console.warn("[useEncounteredPlayers] refresh failed:", err);
        }
    }, []);

    const openProfile = useCallback((handle: string) => {
        const url = `https://robertsspaceindustries.com/citizens/${encodeURIComponent(handle)}`;
        if (isTauri()) {
            openShell(url).catch((err) => console.warn("[useEncounteredPlayers] openProfile failed:", err));
        } else {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }, []);

    const players: EnrichedEncounteredPlayer[] = input.map((p) => {
        const data = enriched.get(p.name.toLowerCase());
        return {
            ...p,
            profile: data?.profile,
            tag: data?.tag,
        };
    });

    let friendsCount = 0;
    let orgCount = 0;
    let enemyCount = 0;
    for (const p of players) {
        if (p.tag?.tag === "friend") friendsCount++;
        else if (p.tag?.tag === "org") orgCount++;
        else if (p.tag?.tag === "enemy") enemyCount++;
    }

    return { players, loading, setTag, openProfile, refresh, friendsCount, orgCount, enemyCount };
}
