import { create } from "zustand";

interface SidebarStore {
    isLocked: boolean;
    isCollapsed: boolean;
    toggleLock: () => void;
    setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
    isLocked: false,
    isCollapsed: true,
    toggleLock: () => set((state) => ({ 
        isLocked: !state.isLocked,
        isCollapsed: state.isLocked // Si on verrouille (isLocked passe à true), on ouvre (isCollapsed=false)
    })),
    setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
}));

