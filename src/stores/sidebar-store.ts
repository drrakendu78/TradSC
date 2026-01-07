import { create } from "zustand";

interface SidebarStore {
    isLocked: boolean;
    isCollapsed: boolean;
    toggleLock: () => void;
    setLocked: (locked: boolean) => void;
    setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
    isLocked: true,
    isCollapsed: false,
    toggleLock: () => set((state) => ({
        isLocked: !state.isLocked,
        isCollapsed: state.isLocked // Si on verrouille (isLocked passe à true), on ouvre (isCollapsed=false)
    })),
    setLocked: (locked) => set({ isLocked: locked }),
    setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
}));

