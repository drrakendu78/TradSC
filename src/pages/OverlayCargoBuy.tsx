/**
 * Window overlay Tauri dédiée : cargo buy detection.
 *
 * Route : /overlay-cargo-buy
 *
 * - Écoute l'event `gamelog-watcher:cargo-buy` (re-émis par Rust après show de la window)
 * - Affiche la card pleine page (la window est petite : 380x300)
 * - Auto-hide après 20s d'inactivité (call commande Rust)
 * - À chaque nouvel achat → reset le timer
 */
import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Package, TrendingUp, MapPin } from "lucide-react";
import {
    type CargoBuyPayload,
    type CommoditySuggestionResult,
} from "@/hooks/useCargoBuyDetection";

const AUTO_HIDE_MS = 60_000; // 1 min : laisse le temps de décider de pin/garder
const CARGO_OVERLAY_ID = "cargo-buy"; // doit matcher l'id passé à open_overlay

interface OverlayEntry {
    buy: CargoBuyPayload;
    suggestion?: CommoditySuggestionResult;
    error?: string;
    receivedAt: number;
}

export default function OverlayCargoBuy() {
    const [entry, setEntry] = useState<OverlayEntry | null>(null);
    const [hideTimer, setHideTimer] = useState<number | null>(null);
    const [pinned, setPinned] = useState(false);
    // Track « un achat a-t-il été reçu » via ref : le safety timer plus bas
    // a un useEffect([]) qui figerait `entry=null` au 1er render (stale
    // closure) et fermerait l'overlay à 5s à TOUS les coups. La ref donne la
    // valeur courante.
    const entryLoadedRef = useRef(false);
    useEffect(() => {
        if (entry) entryLoadedRef.current = true;
    }, [entry]);

    // Force body/html/root transparents + masque les halos lumineux
    // (#root::before a des gradients radiaux qui restent visibles sinon).
    useEffect(() => {
        const styleEl = document.createElement("style");
        styleEl.id = "overlay-cargo-buy-styles";
        styleEl.innerHTML = `
            html, body, #root {
                background: transparent !important;
            }
            #root::before {
                display: none !important;
            }
            body::before, body::after {
                display: none !important;
            }
        `;
        document.head.appendChild(styleEl);
        return () => {
            styleEl.remove();
        };
    }, []);

    // Au mount : query le payload côté Rust (plus fiable que l'event)
    useEffect(() => {
        invoke<CargoBuyPayload | null>("cargo_overlay_get_last_payload")
            .then(async (buy) => {
                if (!buy) return;
                const newEntry: OverlayEntry = { buy, receivedAt: Date.now() };
                setEntry(newEntry);
                try {
                    const suggestion = await invoke<CommoditySuggestionResult>("suggest_sell_locations", {
                        commodityGuid: buy.commodityGuid,
                        quantityCsu: buy.quantityCsu,
                        buyPriceTotal: buy.priceTotal,
                        pricePerCsu: buy.pricePerCsu,
                        shopName: buy.shopName,
                    });
                    setEntry({ ...newEntry, suggestion });
                } catch (err) {
                    setEntry({ ...newEntry, error: String(err) });
                }
            })
            .catch((err) => console.warn("[OverlayCargoBuy] get_last_payload failed:", err));
    }, []);

    // Listen aussi les events temps réel (pour les achats successifs)
    useEffect(() => {
        let unlisten: UnlistenFn | undefined;
        (async () => {
            unlisten = await listen<CargoBuyPayload>("gamelog-watcher:cargo-buy", async (event) => {
                const buy = event.payload;
                const newEntry: OverlayEntry = { buy, receivedAt: Date.now() };
                setEntry(newEntry);
                // Fetch suggestions UEX
                try {
                    const suggestion = await invoke<CommoditySuggestionResult>("suggest_sell_locations", {
                        commodityGuid: buy.commodityGuid,
                        quantityCsu: buy.quantityCsu,
                        buyPriceTotal: buy.priceTotal,
                        pricePerCsu: buy.pricePerCsu,
                        shopName: buy.shopName,
                    });
                    setEntry({ ...newEntry, suggestion });
                } catch (err) {
                    setEntry({ ...newEntry, error: String(err) });
                }
            });
        })().catch((err) => console.warn("[OverlayCargoBuy] listen failed:", err));
        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    // Pin/fermeture = mini-contrôle WS_EX_NOACTIVATE séparé (la card est
    // click-through). Il émet `cargo-overlay:set-pinned` → on (dés)active
    // l'auto-hide.
    useEffect(() => {
        let unlistenPin: UnlistenFn | undefined;
        listen<{ pinned: boolean }>("cargo-overlay:set-pinned", (event) => {
            setPinned(!!event.payload?.pinned);
        })
            .then((fn) => {
                unlistenPin = fn;
            })
            .catch((err) => console.warn("[OverlayCargoBuy] pin listen failed:", err));
        return () => {
            if (unlistenPin) unlistenPin();
        };
    }, []);

    // Safety auto-hide : 5s après mount, si aucun entry reçu → hide la window
    useEffect(() => {
        const safetyTimer = window.setTimeout(() => {
            if (!entryLoadedRef.current) {
                console.warn("[OverlayCargoBuy] No event received in 5s — closing overlay");
                dismissOverlay();
            }
        }, 5_000);
        return () => window.clearTimeout(safetyTimer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // NB : la card reste TOUJOURS click-through (focus-safe — les clics
    // passent au jeu). On ne tente PAS de la rendre interactive ici : le
    // pin/fermeture vivent dans le mini-contrôle WS_EX_NOACTIVATE (cf.
    // OverlayControl mode cargo). open_overlay met déjà la window en
    // click-through côté Rust.

    // Auto-hide timer (déclenché par l'arrivée d'un entry, désactivé si pinned)
    useEffect(() => {
        if (!entry) return;
        if (hideTimer) window.clearTimeout(hideTimer);
        if (pinned) return; // pin actif → no auto-hide
        const t = window.setTimeout(() => {
            dismissOverlay();
        }, AUTO_HIDE_MS);
        setHideTimer(t);
        return () => {
            window.clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry?.buy.ts, pinned]);

    // Ferme proprement l'overlay via le système standard : close_overlay
    // détruit la window ET son œil de contrôle. (window.hide() laissait
    // l'œil orphelin à l'écran.)
    const dismissOverlay = () => {
        invoke("close_overlay", { id: CARGO_OVERLAY_ID }).catch((err) =>
            console.warn("[OverlayCargoBuy] close_overlay failed:", err),
        );
    };

    // Drag manuel via startDragging() — backup au cas où data-tauri-drag-region
    // ne fonctionne pas (Tauri 2 peut être capricieux avec windows transparentes
    // + decorations stripped).
    const handleMouseDown = async (e: React.MouseEvent) => {
        // Si on clique sur un bouton, on ne drag pas
        if ((e.target as HTMLElement).closest("button")) return;
        try {
            await getCurrentWindow().startDragging();
        } catch (err) {
            console.warn("[OverlayCargoBuy] startDragging failed:", err);
        }
    };

    if (!entry) return null;

    const { buy, suggestion, error } = entry;
    const quantityScu = buy.quantityCsu / 100;
    const cleanShop = buy.shopName.replace(/^SCShop_/, "").replace(/_/g, " ");

    return (
        <div
            className="w-full h-screen p-2 select-none"
            data-tauri-drag-region
            onMouseDown={handleMouseDown}
        >
            <div className="w-full h-full bg-zinc-900/95 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-500/10 overflow-hidden flex flex-col">
                {/* Header — draggable pour déplacer la window + boutons pin/close */}
                <div
                    className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-amber-500/[0.04] flex-shrink-0"
                    data-tauri-drag-region
                    onMouseDown={handleMouseDown}
                >
                    <div className="flex items-center gap-2 pointer-events-none">
                        <div className="w-7 h-7 rounded-md border border-amber-500/30 bg-amber-500/15 flex items-center justify-center text-amber-300">
                            <Package className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">Cargo acheté</span>
                    </div>
                    {/* Boutons pin/fermeture déportés dans le mini-contrôle
                        WS_EX_NOACTIVATE (la card est click-through). Ici, juste
                        un indicateur visuel quand c'est épinglé. */}
                    {pinned && (
                        <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-amber-300/80 pointer-events-none">
                            épinglé
                        </div>
                    )}
                </div>

                {/* Corps */}
                <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                    <div>
                        <div className="text-sm text-white font-semibold">
                            {suggestion?.commodityName ?? "Commodity inconnue"}
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                            {quantityScu.toLocaleString("fr-FR")} SCU · {Math.round(buy.priceTotal).toLocaleString("fr-FR")} aUEC
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5 truncate" title={buy.shopName}>
                            Acheté à <span className="text-zinc-300">{cleanShop}</span> · {buy.pricePerCsu.toFixed(2)} aUEC/cSCU
                        </div>
                    </div>

                    {suggestion?.note && (
                        <div className="text-[10px] text-amber-400/70 italic">{suggestion.note}</div>
                    )}

                    {error && (
                        <div className="text-[10px] text-rose-400">Erreur : {error}</div>
                    )}

                    {suggestion && suggestion.topSellLocations.length > 0 && (
                        <div className="pt-2 border-t border-white/5">
                            <div className="flex items-center gap-1.5 mb-2">
                                <TrendingUp className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Meilleures reventes</span>
                            </div>
                            <ul className="space-y-1.5">
                                {suggestion.topSellLocations.map((loc, i) => {
                                    const profitColor = loc.profitTotal > 0 ? "text-emerald-400" : "text-rose-400";
                                    return (
                                        <li key={i} className="flex items-center gap-2 text-xs">
                                            <span className="text-amber-400 font-semibold w-3 text-right">{i + 1}</span>
                                            <MapPin className="w-3 h-3 text-violet-400/70 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-zinc-200 truncate">{loc.terminalName}</div>
                                                <div className="text-[10px] text-zinc-500">{loc.sellPricePerCsu.toFixed(2)} aUEC/cSCU</div>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <div className={`text-xs font-semibold tabular-nums ${profitColor}`}>
                                                    {loc.profitTotal > 0 ? "+" : ""}
                                                    {Math.round(loc.profitTotal).toLocaleString("fr-FR")}
                                                </div>
                                                <div className="text-[9px] text-zinc-500 tabular-nums">{loc.profitPercent.toFixed(0)}%</div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {suggestion && suggestion.topSellLocations.length === 0 && !error && (
                        <div className="pt-2 border-t border-white/5 text-[11px] text-zinc-500 italic">
                            Pas de données UEX pour cette commodity.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
