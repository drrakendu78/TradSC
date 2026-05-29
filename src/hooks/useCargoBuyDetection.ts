/**
 * Helper debug : injecte une fonction sur window pour pouvoir simuler un achat
 * cargo depuis la devtools console (Tauri 2 n'expose pas `window.__TAURI__`
 * par défaut, donc on a besoin d'un point d'entrée explicite).
 *
 * Usage console :
 *   window.__startradTestCargoBuy()  // payload par défaut (Nitrogen)
 *   window.__startradTestCargoBuy({ commodityGuid: "...", ... })  // custom
 */
/** Installe le helper `window.__startradTestCargoBuy()` accessible depuis la
 *  devtools console pour simuler un achat cargo. À appeler au boot. */
export function installCargoDebugHelper() {
    // Force la réinstallation à chaque appel (utile pour Vite HMR)
    setupDebugHelper();
}

function setupDebugHelper() {
    const w = window as unknown as Record<string, unknown>;
    w.__startradTestCargoBuy = async () => {
        // Phase 2 : teste l'overlay NATIF (sidecar Slint) sans achat réel.
        console.log("[StarTrad debug] → overlay natif (cargo_overlay_test_native)");
        try {
            await invoke("cargo_overlay_test_native");
            console.log("[StarTrad debug] OK — overlay natif lancé");
        } catch (err) {
            console.error("[StarTrad debug] FAILED:", err);
        }
    };
    // Change le coin de l'overlay : "TR" (défaut), "TL", "BR", "BL".
    // Usage : await window.__startradSetCorner("BL"); window.__startradTestCargoBuy()
    w.__startradSetCorner = async (corner: string) => {
        try {
            await invoke("cargo_overlay_set_corner", { corner });
            console.log(`[StarTrad debug] coin overlay → ${corner}`);
        } catch (err) {
            console.error("[StarTrad debug] set_corner FAILED:", err);
        }
    };
    // Vitesse quantum (km/s) pour le calcul des temps de trajet (défaut 120000).
    w.__startradSetQdSpeed = async (kms: number) => {
        try {
            await invoke("cargo_overlay_set_qd_speed", { kms });
            console.log(`[StarTrad debug] vitesse QD → ${kms} km/s`);
        } catch (err) {
            console.error("[StarTrad debug] set_qd_speed FAILED:", err);
        }
    };
    console.info(
        "%c[StarTrad debug] Test cargo overlay: window.__startradTestCargoBuy()",
        "color: #fbbf24",
    );
}

/**
 * Hook qui écoute les achats de cargo détectés en live par le watcher Game.log.
 *
 * - Écoute l'event Tauri `gamelog-watcher:cargo-buy`
 * - Pour chaque achat, appelle `suggest_sell_locations` (auto-détection + UEX)
 * - Expose la liste des derniers achats enrichis pour affichage UI
 *
 * Pas de stockage persistant pour V1 — historique session uniquement.
 */
import { useEffect, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri-helpers";

export interface CargoBuyPayload {
    ts: number;
    shopName: string;
    shopId: number;
    priceTotal: number;
    pricePerCsu: number;
    commodityGuid: string;
    quantityCsu: number;
    boxSize: number;
    unitAmount: number;
}

export interface SellSuggestion {
    terminalName: string;
    sellPricePerCsu: number;
    sellPriceTotal: number;
    profitTotal: number;
    profitPerCsu: number;
    profitPercent: number;
}

export interface CommoditySuggestionResult {
    commodityName: string;
    commodityGuid: string;
    quantityScu: number;
    buyPriceTotal: number;
    buyPricePerCsu: number;
    topSellLocations: SellSuggestion[];
    note?: string;
}

export interface CargoBuyEntry {
    buy: CargoBuyPayload;
    suggestion?: CommoditySuggestionResult;
    error?: string;
    detectedAt: number; // timestamp client
}

export function useCargoBuyDetection(): {
    entries: CargoBuyEntry[];
    latest: CargoBuyEntry | null;
    dismissLatest: () => void;
    clear: () => void;
} {
    const [entries, setEntries] = useState<CargoBuyEntry[]>([]);
    const [latest, setLatest] = useState<CargoBuyEntry | null>(null);

    useEffect(() => {
        if (!isTauri()) return;
        setupDebugHelper();
        let unlisten: UnlistenFn | undefined;
        (async () => {
            unlisten = await listen<CargoBuyPayload>("gamelog-watcher:cargo-buy", async (event) => {
                const buy = event.payload;
                const entry: CargoBuyEntry = { buy, detectedAt: Date.now() };

                // Fetch les suggestions UEX
                try {
                    const suggestion = await invoke<CommoditySuggestionResult>("suggest_sell_locations", {
                        commodityGuid: buy.commodityGuid,
                        quantityCsu: buy.quantityCsu,
                        buyPriceTotal: buy.priceTotal,
                        pricePerCsu: buy.pricePerCsu,
                        shopName: buy.shopName,
                    });
                    entry.suggestion = suggestion;
                } catch (err) {
                    entry.error = String(err);
                    console.warn("[useCargoBuyDetection] suggest_sell_locations failed:", err);
                }

                setEntries((prev) => [entry, ...prev].slice(0, 30));
                setLatest(entry);
            });
        })().catch((err) => console.warn("[useCargoBuyDetection] listen failed:", err));

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const dismissLatest = useCallback(() => setLatest(null), []);
    const clear = useCallback(() => {
        setEntries([]);
        setLatest(null);
    }, []);

    return { entries, latest, dismissLatest, clear };
}
