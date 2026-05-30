/**
 * Bouton compact "Mon carnet" intégré dans la hero card "Bienvenue, Citizen !"
 * à côté du bouton "Traduction à jour". Pas de stats redondantes (les heures
 * sont déjà affichées dans la KPI card "TEMPS DE JEU").
 */
import { BookOpen, ArrowRight } from "lucide-react";
import { useCarnetDrawerStore } from "@/stores/carnet-drawer-store";

export function CarnetHomeButton() {
    const open = useCarnetDrawerStore((s) => s.open);
    return (
        <button
            type="button"
            onClick={open}
            title="Ouvrir mon carnet de bord"
            aria-label="Ouvrir mon carnet de bord"
            className="group inline-flex h-9 items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-4 text-sm font-medium text-cyan-300 backdrop-blur-md transition-all hover:border-cyan-400/65 hover:bg-cyan-500/25 hover:text-cyan-100 hover:shadow-[0_4px_14px_rgba(34,211,238,0.22)]"
        >
            <BookOpen className="h-4 w-4" />
            Mon carnet
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
    );
}
