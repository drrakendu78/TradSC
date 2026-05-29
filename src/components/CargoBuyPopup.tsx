/**
 * Popup live qui pop dès qu'un achat cargo est détecté dans Game.log.
 *
 * Position fixed bottom-right, auto-dismiss après 20s, ou clic pour fermer.
 * Affiche : commodity name, qté, prix d'achat, top 3 reventes avec profit.
 *
 * À monter une fois dans le shell de l'app (ex App.tsx ou MainLayout).
 */
import { useEffect, useState } from "react";
import { useCargoBuyDetection, type CargoBuyEntry } from "@/hooks/useCargoBuyDetection";
import { Package, TrendingUp, X as XIcon, MapPin } from "lucide-react";

const AUTO_DISMISS_MS = 20_000;

export function CargoBuyPopup() {
    const { latest, dismissLatest } = useCargoBuyDetection();
    const [visible, setVisible] = useState(false);

    // Apparition + auto-dismiss
    useEffect(() => {
        if (!latest) return;
        setVisible(true);
        const t = setTimeout(() => {
            setVisible(false);
            // Petit délai pour la transition avant de clear côté hook
            setTimeout(dismissLatest, 300);
        }, AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [latest, dismissLatest]);

    if (!latest) return null;

    return (
        <CargoBuyCard
            entry={latest}
            visible={visible}
            onClose={() => {
                setVisible(false);
                setTimeout(dismissLatest, 300);
            }}
        />
    );
}

function CargoBuyCard({
    entry,
    visible,
    onClose,
}: {
    entry: CargoBuyEntry;
    visible: boolean;
    onClose: () => void;
}) {
    const { buy, suggestion, error } = entry;
    const quantityScu = buy.quantityCsu / 100;
    const cleanShop = buy.shopName.replace(/^SCShop_/, "").replace(/_/g, " ");

    return (
        <div
            className={`fixed bottom-6 right-6 z-[2000] w-96 bg-zinc-900/95 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-500/10 overflow-hidden transition-all duration-300 ${
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
            role="alert"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-amber-500/[0.04]">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-md border border-amber-500/30 bg-amber-500/15 flex items-center justify-center text-amber-300">
                        <Package className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">Cargo acheté</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                    aria-label="Fermer"
                >
                    <XIcon className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Corps */}
            <div className="p-4 space-y-3">
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

                {/* Top 3 reventes */}
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
                        Pas de données de revente disponibles via UEX pour cette commodity.
                    </div>
                )}
            </div>
        </div>
    );
}
