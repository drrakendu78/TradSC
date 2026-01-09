import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ThemeStore } from "@/types/theme-types";

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            primaryColor: "#6463b6",
            primaryColorChoices: [
                "#6463b6",
                "#3B3B98",
                "#B33771",
                "#FC427B",
                "#FEA47B",
            ],
            setPrimaryColor: (primaryColor) => set({ primaryColor }),
        }),
        {
            name: "theme-storage",
            partialize: (state) => ({ primaryColor: state.primaryColor }), // Ne persiste que la couleur
        }
    )
);