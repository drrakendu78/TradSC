import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CustomLink {
    id: string;
    name: string;
    url: string;
    icon?: string; // Nom de l'icône (ex: "Globe", "Star", etc.)
}

interface CustomLinksStore {
    links: CustomLink[];
    addLink: (name: string, url: string, icon?: string) => void;
    updateLink: (id: string, name: string, url: string, icon?: string) => void;
    removeLink: (id: string) => void;
    setLinks: (links: CustomLink[]) => void;
}

export const useCustomLinksStore = create<CustomLinksStore>()(
    persist(
        (set) => ({
            links: [],
            addLink: (name, url, icon) =>
                set((state) => ({
                    links: [
                        ...state.links,
                        {
                            id: crypto.randomUUID(),
                            name,
                            url,
                            icon,
                        },
                    ],
                })),
            updateLink: (id, name, url, icon) =>
                set((state) => ({
                    links: state.links.map((link) =>
                        link.id === id ? { ...link, name, url, icon } : link
                    ),
                })),
            removeLink: (id) =>
                set((state) => ({
                    links: state.links.filter((link) => link.id !== id),
                })),
            setLinks: (links) => set({ links }),
        }),
        {
            name: "custom-links-storage",
        }
    )
);
