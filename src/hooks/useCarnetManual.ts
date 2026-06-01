/**
 * État + persistance des entrées manuelles du Carnet (coéquipiers + morts).
 *
 * Léger et indépendant du scan : add/remove écrivent immédiatement dans
 * `carnet_manuel.json` (commande Rust) sans relancer le parse des logs.
 * Le merge dans les stats se fait côté composant via `mergeManualIntoStats`.
 */
import { useCallback, useEffect, useState } from "react";
import {
    loadManual,
    saveManual,
    EMPTY_MANUAL,
    type ManualStore,
    type ManualDeath,
} from "@/lib/carnet-manual";

function uid(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    }
}

export interface UseCarnetManual {
    manual: ManualStore;
    addTeammate: (handle: string, note?: string) => void;
    removeTeammate: (id: string) => void;
    addDeath: (death: Omit<ManualDeath, "id" | "addedTs">) => void;
    removeDeath: (id: string) => void;
}

export function useCarnetManual(): UseCarnetManual {
    const [manual, setManual] = useState<ManualStore>(() => ({ ...EMPTY_MANUAL, teammates: [], deaths: [] }));

    useEffect(() => {
        let cancelled = false;
        loadManual().then((s) => {
            if (!cancelled) setManual(s);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Applique une transformation à l'état PUIS persiste le résultat.
    const mutate = useCallback((fn: (prev: ManualStore) => ManualStore) => {
        setManual((prev) => {
            const next = fn(prev);
            void saveManual(next);
            return next;
        });
    }, []);

    const addTeammate = useCallback(
        (handle: string, note?: string) => {
            const h = handle.trim();
            if (!h) return;
            mutate((prev) => {
                // pas de doublon manuel (insensible à la casse)
                if (prev.teammates.some((t) => t.handle.trim().toLowerCase() === h.toLowerCase())) return prev;
                return {
                    ...prev,
                    teammates: [
                        ...prev.teammates,
                        { id: uid(), handle: h, note: note?.trim() || null, addedTs: Date.now() / 1000 },
                    ],
                };
            });
        },
        [mutate],
    );

    const removeTeammate = useCallback(
        (id: string) => {
            mutate((prev) => ({ ...prev, teammates: prev.teammates.filter((t) => t.id !== id) }));
        },
        [mutate],
    );

    const addDeath = useCallback(
        (death: Omit<ManualDeath, "id" | "addedTs">) => {
            mutate((prev) => ({
                ...prev,
                deaths: [
                    ...prev.deaths,
                    {
                        ...death,
                        killer: death.killer?.trim() || null,
                        system: death.system?.trim() || null,
                        ship: death.ship?.trim() || null,
                        note: death.note?.trim() || null,
                        id: uid(),
                        addedTs: Date.now() / 1000,
                    },
                ],
            }));
        },
        [mutate],
    );

    const removeDeath = useCallback(
        (id: string) => {
            mutate((prev) => ({ ...prev, deaths: prev.deaths.filter((d) => d.id !== id) }));
        },
        [mutate],
    );

    return { manual, addTeammate, removeTeammate, addDeath, removeDeath };
}
