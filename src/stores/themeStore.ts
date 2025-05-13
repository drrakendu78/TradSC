import { create } from "zustand";

export interface ThemeStore {
    primaryColor: string;
    primaryColorChoices: string[];
    setPrimaryColor: (primaryColor: string) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    primaryColor: "#d0c34c",
    primaryColorChoices: [
        "#6463b6",
        "#3B3B98",
        "#B33771",
        "#FC427B",
        "#FEA47B",
        "#d0c34c",
    ],
    setPrimaryColor: (primaryColor) => set({ primaryColor }),
}));
