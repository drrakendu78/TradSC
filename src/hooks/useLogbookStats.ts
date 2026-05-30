/**
 * Charge les vraies stats du Carnet de bord depuis le backend Rust.
 *
 * Flux (au mount, càd à l'ouverture du drawer) :
 *   1. `gamelog_history_scan({ force:false })` — parse incrémental des Game.log
 *      (logbackups/), émet `gamelog-history:scan_progress` { current,total,percent }.
 *   2. `gamelog_history_stats()` — renvoie le `LogbookStats` agrégé complet.
 *
 * Remplace l'ancien mock `logbook-mock-data*`.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/utils/tauri-helpers";
import type { LogbookStats } from "@/lib/logbook-types";

export type LogbookPhase = "scanning" | "loading" | "ready" | "empty" | "error";

interface ScanProgress {
    current: number;
    total: number;
    percent: number;
}

export interface UseLogbookStats {
    stats: LogbookStats | null;
    phase: LogbookPhase;
    progress: number; // 0-100
    error: string | null;
    reload: () => void;
}

/** Formate la date d'un schéma débloqué : Aujourd'hui / Hier / "02 mai". */
function formatBlueprintDate(ts: number): string {
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return "Aujourd'hui";
    if (sameDay(d, yest)) return "Hier";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function useLogbookStats(): UseLogbookStats {
    const [stats, setStats] = useState<LogbookStats | null>(null);
    const [phase, setPhase] = useState<LogbookPhase>("scanning");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        (async () => {
            // Hors Tauri (preview navigateur) : pas de backend → état vide propre.
            if (!isTauri()) {
                setPhase("empty");
                return;
            }
            setStats(null);
            setError(null);
            setProgress(0);
            setPhase("scanning");
            try {
                unlisten = await listen<ScanProgress>(
                    "gamelog-history:scan_progress",
                    (e) => {
                        if (!cancelled) setProgress(e.payload?.percent ?? 0);
                    }
                );
                await invoke("gamelog_history_scan", { force: false });
                if (cancelled) return;
                setPhase("loading");
                const raw = await invoke<LogbookStats>("gamelog_history_stats");
                if (cancelled) return;
                // blueprintCount / recentBlueprints : depuis le store des schémas
                // débloqués (gamelog_blueprints.json), source de vérité existante.
                if (raw) {
                    try {
                        const bp = await invoke<{ blueprints?: Array<{ productName: string; ts: number }> }>(
                            "gamelog_blueprints_load"
                        );
                        const list = (bp?.blueprints ?? []).slice().sort((a, b) => b.ts - a.ts);
                        raw.blueprintCount = list.length;
                        raw.recentBlueprints = list
                            .slice(0, 3)
                            .map((b) => ({ name: b.productName, date: formatBlueprintDate(b.ts) }));
                    } catch {
                        // store absent → on garde les valeurs du backend (0 / []).
                    }
                    if (cancelled) return;
                }
                // Aucune session parsée → carnet vide (pas de SC / pas de logbackups).
                if (!raw || (raw.sessionCount ?? 0) === 0) {
                    setStats(raw ?? null);
                    setPhase("empty");
                } else {
                    setStats(raw);
                    setPhase("ready");
                }
            } catch (e: any) {
                if (cancelled) return;
                setError(typeof e === "string" ? e : e?.message ?? "Erreur inconnue");
                setPhase("error");
            }
        })();

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
        };
    }, [nonce]);

    return { stats, phase, progress, error, reload: () => setNonce((n) => n + 1) };
}
