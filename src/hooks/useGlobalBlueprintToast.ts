import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useToast } from "@/hooks/use-toast";
import { isTauri } from "@/utils/tauri-helpers";

interface BlueprintEvent {
    productName: string;
    ts: number;
}

/**
 * Hook global : écoute `gamelog-watcher:blueprint` au niveau App et
 * affiche un toast « Nouveau schéma reçu » à chaque détection, peu
 * importe la page où se trouve l'utilisateur.
 *
 * Avant ce hook, les toasts étaient câblés dans AutoDetectCard et la
 * page Blueprints, donc ils ne s'affichaient QUE quand l'user avait
 * ouvert ces pages. Avec ce hook global, l'user voit le feedback même
 * sur Home, Paramètres, etc. — ce qui est l'usage réel (les gens
 * tournent rarement sur la page Blueprints pendant qu'ils jouent).
 *
 * Dédup naturelle : on déduplique les events identiques (même productName
 * dans une fenêtre de 5 sec) côté hook pour éviter le spam si le watcher
 * reparse la même ligne du Game.log.
 */
export function useGlobalBlueprintToast() {
    const { toast } = useToast();

    useEffect(() => {
        if (!isTauri()) return;

        // Dédup : { productName → ts du dernier toast }
        const recent = new Map<string, number>();
        const DEDUP_MS = 5000;

        let unlisten: (() => void) | undefined;
        let cancelled = false;

        listen<BlueprintEvent>("gamelog-watcher:blueprint", (event) => {
            const { productName, ts } = event.payload;
            const last = recent.get(productName);
            const now = Date.now();
            if (last && now - last < DEDUP_MS) return;
            recent.set(productName, now);

            // Cleanup périodique de la map pour éviter qu'elle grossisse
            // indéfiniment pendant une longue session.
            if (recent.size > 50) {
                const cutoff = now - DEDUP_MS;
                for (const [name, t] of recent) {
                    if (t < cutoff) recent.delete(name);
                }
            }

            toast({
                title: "🪐 Nouveau schéma reçu",
                description: productName,
            });

            // ts est utilisé uniquement pour debug si besoin
            void ts;
        }).then((fn) => {
            if (cancelled) {
                fn();
            } else {
                unlisten = fn;
            }
        });

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
        };
    }, [toast]);
}
