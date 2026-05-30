import { create } from "zustand";

/**
 * State global du drawer "Carnet de bord".
 *
 * Pourquoi un store et pas une URL : pour la V1 du Carnet de bord, on garde
 * la page d'arrière-plan visible (effet drawer slide-in over content), donc
 * pas de changement d'URL. Si on en a besoin plus tard (bookmark / deep
 * link), on rajoutera la sync URL via React Router.
 */
type CarnetDrawerState = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
};

export const useCarnetDrawerStore = create<CarnetDrawerState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
