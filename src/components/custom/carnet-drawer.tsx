/**
 * Wrapper drawer "Carnet de bord" — panneau qui glisse depuis le bord droit
 * et couvre la zone content (laisse la sidebar visible et cliquable).
 *
 * Mécanique :
 * - Triggered par `useCarnetDrawerStore.open()` (depuis la pill du Home par ex.)
 * - Escape ferme
 * - Clic sur backdrop ferme
 * - Bouton X dans le header de Logbook ferme (via prop onClose)
 * - Sidebar reste accessible (le backdrop ne couvre que la zone content)
 *
 * Style : reprend EXACTEMENT les valeurs transparentes du modal Paramètres
 * existant (cf. `app-sidebar.tsx` > `<Dialog>` Paramètres) :
 *   - overlay   : bg-black/18 backdrop-blur-sm
 *   - container : bg-[hsl(var(--background)/0.46)] backdrop-blur-2xl backdrop-saturate-150
 *
 * Voir spec : [[UX Checklist - Carnet de bord v1]] dans le wiki.
 */
import { useEffect } from "react";
import { AnimatePresence, m } from "framer-motion";
import { useCarnetDrawerStore } from "@/stores/carnet-drawer-store";
import Logbook from "@/pages/Logbook";

export function CarnetDrawer() {
    const isOpen = useCarnetDrawerStore((s) => s.isOpen);
    const close = useCarnetDrawerStore((s) => s.close);

    // Escape ferme
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, close]);

    // z-index strategy : drawer passe PAR DESSUS TOUT (sidebar + titlebar).
    // Les boutons window (min/max/close de l'app) sont cachés tant que le
    // drawer est ouvert — l'user ferme avec X / Escape / clic backdrop.
    //   sidebar shell     = z-40
    //   sidebar trigger   = z-[70]
    //   titlebar (header) = z-[90]
    //   carnet-backdrop   = z-[99]
    //   carnet-drawer     = z-[100]  ← devant tout
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <m.div
                        key="carnet-backdrop"
                        className="absolute inset-0 z-[99] bg-black/18 backdrop-blur-sm cursor-pointer"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        onClick={close}
                        aria-hidden
                    />
                    {/* Drawer pleine fenêtre, slide-in depuis la droite */}
                    <m.aside
                        key="carnet-drawer"
                        className="dark absolute inset-0 z-[100] bg-[hsl(var(--background)/0.96)] backdrop-blur-2xl backdrop-saturate-150 border-l border-white/10 shadow-[0_18px_46px_rgba(0,0,0,0.32)] flex flex-col overflow-hidden text-foreground"
                        initial={{ x: "100%", opacity: 0.5 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0.5 }}
                        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Mon carnet de bord"
                    >
                        <Logbook onClose={close} />
                    </m.aside>
                </>
            )}
        </AnimatePresence>
    );
}
