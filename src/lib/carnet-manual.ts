/**
 * Saisie manuelle du Carnet de bord (coéquipiers + morts).
 *
 * Pourquoi : depuis fin 2025, Star Citizen ne journalise plus les kills/morts
 * ni le pseudo de tous les coéquipiers (anti‑stalking CIG). La saisie manuelle
 * permet de récupérer ces infos perdues.
 *
 * Persistance : commandes Rust `carnet_manual_load` / `carnet_manual_save`
 * (fichier `carnet_manuel.json`, SÉPARÉ du scan des logs → jamais écrasé par
 * un re-scan). Même esprit que le store des blueprints.
 *
 * Les entrées manuelles sont FUSIONNÉES par-dessus les stats auto (jamais à la
 * place) via `mergeManualIntoStats` — cf. `useCarnetManual` + `Logbook.tsx`.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri-helpers";
import type { LogbookStats } from "@/lib/logbook-types";

export type ManualDeathCause = "joueur" | "pnj" | "accident" | "autre";

export interface ManualTeammate {
    id: string;
    handle: string;
    note?: string | null;
    addedTs: number; // epoch secondes
}

export interface ManualDeath {
    id: string;
    ts: number; // epoch secondes — quand la mort a eu lieu
    system?: string | null;
    killer?: string | null;
    cause: ManualDeathCause;
    ship?: string | null;
    note?: string | null;
    addedTs: number; // epoch secondes
}

export interface ManualStore {
    schemaVersion: number;
    teammates: ManualTeammate[];
    deaths: ManualDeath[];
}

export const EMPTY_MANUAL: ManualStore = { schemaVersion: 1, teammates: [], deaths: [] };

/** Libellé + icône (clé `iconByName` lowercase) par type de cause manuelle. */
export const MANUAL_CAUSE_META: Record<ManualDeathCause, { label: string; icon: string; short: string }> = {
    joueur: { label: "Tué par un joueur", icon: "crosshair", short: "Joueur" },
    pnj: { label: "Tué par un PNJ", icon: "crosshair", short: "PNJ" },
    accident: { label: "Collision / accident", icon: "alert-triangle", short: "Accident" },
    autre: { label: "Autre cause", icon: "more-horizontal", short: "Autre" },
};

// ── I/O ──────────────────────────────────────────────────────────────────────

export async function loadManual(): Promise<ManualStore> {
    if (!isTauri()) return { ...EMPTY_MANUAL, teammates: [], deaths: [] };
    try {
        const s = await invoke<ManualStore>("carnet_manual_load");
        return {
            schemaVersion: s?.schemaVersion ?? 1,
            teammates: Array.isArray(s?.teammates) ? s.teammates : [],
            deaths: Array.isArray(s?.deaths) ? s.deaths : [],
        };
    } catch {
        return { ...EMPTY_MANUAL, teammates: [], deaths: [] };
    }
}

export async function saveManual(store: ManualStore): Promise<void> {
    if (!isTauri()) return;
    try {
        await invoke("carnet_manual_save", { store });
    } catch (e) {
        // non bloquant : on garde l'état en mémoire même si l'écriture échoue.
        console.error("carnet_manual_save échoué:", e);
    }
}

// ── Merge dans les stats auto ─────────────────────────────────────────────────

/**
 * Fusionne les entrées manuelles PAR-DESSUS les stats issues du scan.
 * - coéquipiers → carte « Compagnons de vol » (taggés `manual`)
 * - morts → `combat.deaths` + ratio K/D + « Causes de mort » + le tueur
 *   éventuel devient un « Croisé en combat ».
 * Ne mute jamais l'objet d'entrée (clone superficiel des branches touchées).
 */
export function mergeManualIntoStats(stats: LogbookStats, manual: ManualStore | null): LogbookStats {
    if (!manual || (manual.teammates.length === 0 && manual.deaths.length === 0)) return stats;
    const s: LogbookStats = { ...stats };

    // ── Coéquipiers manuels → companions ──────────────────────────────────────
    if (manual.teammates.length > 0) {
        const base = stats.companions;
        const autoList = base?.list ?? [];
        const autoNames = new Set(autoList.map((p) => p.name.trim().toLowerCase()));
        const seen = new Set<string>();
        const added = manual.teammates
            .filter((t) => {
                const k = (t.handle ?? "").trim().toLowerCase();
                if (!k || autoNames.has(k) || seen.has(k)) return false; // pas de doublon
                seen.add(k);
                return true;
            })
            .map((t) => ({
                name: t.handle.trim(),
                count: 1,
                isLeader: false,
                resolved: true, // handle saisi = vrai handle RSI → enrichissable + nommé
                fought: false,
                manual: true,
                manualId: t.id,
            }));
        if (added.length > 0) {
            s.companions = {
                total: (base?.total ?? 0) + added.length,
                named: (base?.named ?? 0) + added.length,
                distinctTeammates: (base?.distinctTeammates ?? 0) + added.length,
                sharedMissions: base?.sharedMissions ?? 0,
                timesLeader: base?.timesLeader ?? 0,
                list: [...autoList, ...added],
            };
        }
    }

    // ── Morts manuelles → combat + causes + croisés ───────────────────────────
    if (manual.deaths.length > 0) {
        const n = manual.deaths.length;
        const kills = stats.combat.kills;
        const deaths = stats.combat.deaths + n;
        s.combat = {
            ...stats.combat,
            deaths,
            ratio: deaths === 0 ? null : kills / deaths,
        };

        // Causes de mort : +1 par mort, regroupées par libellé manuel.
        const causes = stats.deathCauses.map((c) => ({ ...c }));
        for (const d of manual.deaths) {
            const meta = MANUAL_CAUSE_META[d.cause] ?? MANUAL_CAUSE_META.autre;
            const found = causes.find((c) => c.cause === meta.label);
            if (found) found.count += 1;
            else causes.push({ cause: meta.label, count: 1, icon: meta.icon });
        }
        causes.sort((a, b) => b.count - a.count);
        s.deathCauses = causes;

        // Le tueur (si renseigné) devient un « Croisé en combat » (mort contre lui).
        const killers = manual.deaths.filter((d) => (d.killer ?? "").trim());
        if (killers.length > 0) {
            const enc = stats.encounteredPlayers.map((e) => ({ ...e }));
            const byName = new Map<string, (typeof enc)[number]>();
            for (const e of enc) byName.set(e.name.trim().toLowerCase(), e);
            for (const d of killers) {
                const name = d.killer!.trim();
                const key = name.toLowerCase();
                const iso = new Date(d.ts * 1000).toISOString();
                const ex = byName.get(key);
                if (ex) {
                    ex.deaths += 1;
                    if (!ex.lastSeen || iso > ex.lastSeen) ex.lastSeen = iso;
                } else {
                    const ne = { name, kills: 0, deaths: 1, lastSeen: iso, manual: true };
                    enc.push(ne);
                    byName.set(key, ne);
                }
            }
            s.encounteredPlayers = enc;
        }
    }

    return s;
}
