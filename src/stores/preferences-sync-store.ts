import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useSidebarStore } from "./sidebar-store";
import { useThemeStore } from "./theme-store";
import { useStatsStore } from "./stats-store";
import { applyTheme } from "@/utils/custom-theme-provider";
import { invoke } from "@tauri-apps/api/core";

// Structure des préférences exportables
export interface ExportedPreferences {
    version: string; // Version du format d'export
    exportedAt: string;
    sidebar: {
        isLocked: boolean;
        isCollapsed: boolean;
    };
    theme: {
        primaryColor: string;
        mode: string; // dark/light
    };
    stats: {
        translationInstallDates: Record<string, string>;
        cacheCleanCount: number;
        translationInstallCount: number;
        backupCreatedCount: number;
        characterDownloadCount: number;
        firstUseDate: string | null;
        playtimeHours: number;
    };
}

interface PreferencesSyncStore {
    isSyncing: boolean;
    lastSyncDate: string | null;
    error: string | null;

    // Export toutes les préférences en JSON (async pour récupérer le vrai nombre de backups)
    exportPreferences: () => Promise<ExportedPreferences>;

    // Import des préférences depuis JSON
    importPreferences: (prefs: ExportedPreferences) => void;

    // Sauvegarde sur Supabase
    saveToCloud: (userId: string) => Promise<boolean>;

    // Charge depuis Supabase
    loadFromCloud: (userId: string) => Promise<ExportedPreferences | null>;

    // Supprime les préférences du cloud
    deleteFromCloud: (userId: string) => Promise<boolean>;

    // Vérifie si des préférences existent dans le cloud
    hasCloudPreferences: (userId: string) => Promise<boolean>;
}

const EXPORT_VERSION = "1.0.0";

export const usePreferencesSyncStore = create<PreferencesSyncStore>((set, get) => ({
    isSyncing: false,
    lastSyncDate: null,
    error: null,

    exportPreferences: async () => {
        const sidebarState = useSidebarStore.getState();
        const themeState = useThemeStore.getState();
        const statsState = useStatsStore.getState();

        // Récupérer le mode du thème depuis localStorage
        const themeMode = localStorage.getItem("vite-ui-theme") || "dark";

        // Récupérer le vrai nombre de backups locaux via get_app_stats
        let backupCount = 0;
        try {
            const appStats = await invoke<{ local_backups_count: number }>("get_app_stats");
            backupCount = appStats?.local_backups_count || 0;
        } catch {
            // Fallback sur le compteur historique si erreur
            backupCount = statsState.backupCreatedCount;
        }

        // Récupérer le playtime actuel et prendre le max avec le sauvegardé
        let playtimeHours = statsState.savedPlaytimeHours || 0;
        try {
            const playtime = await invoke<{ total_hours: number }>("get_playtime");
            playtimeHours = Math.max(playtime?.total_hours || 0, statsState.savedPlaytimeHours || 0);
        } catch {
            // Garder le playtime sauvegardé si erreur
        }

        return {
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            sidebar: {
                isLocked: sidebarState.isLocked,
                isCollapsed: sidebarState.isCollapsed,
            },
            theme: {
                primaryColor: themeState.primaryColor,
                mode: themeMode,
            },
            stats: {
                translationInstallDates: statsState.translationInstallDates,
                cacheCleanCount: statsState.cacheCleanCount,
                translationInstallCount: statsState.translationInstallCount,
                backupCreatedCount: backupCount,
                characterDownloadCount: statsState.characterDownloadCount,
                firstUseDate: statsState.firstUseDate,
                playtimeHours: playtimeHours,
            },
        };
    },

    importPreferences: (prefs: ExportedPreferences) => {
        try {
            // Import sidebar
            const sidebarStore = useSidebarStore.getState();
            sidebarStore.setLocked(prefs.sidebar.isLocked);
            sidebarStore.setCollapsed(prefs.sidebar.isCollapsed);

            // Import theme
            const themeStore = useThemeStore.getState();
            themeStore.setPrimaryColor(prefs.theme.primaryColor);
            localStorage.setItem("vite-ui-theme", prefs.theme.mode);

            // Appliquer le thème visuellement (met à jour les variables CSS)
            applyTheme(prefs.theme.primaryColor);

            // Appliquer le mode clair/sombre
            const root = document.documentElement;
            root.classList.remove("light", "dark");
            root.classList.add(prefs.theme.mode);

            // Import stats - on réécrit le localStorage directement
            const statsData = {
                state: {
                    translationInstallDates: prefs.stats.translationInstallDates,
                    cacheCleanCount: prefs.stats.cacheCleanCount,
                    translationInstallCount: prefs.stats.translationInstallCount,
                    backupCreatedCount: prefs.stats.backupCreatedCount,
                    characterDownloadCount: prefs.stats.characterDownloadCount,
                    firstUseDate: prefs.stats.firstUseDate,
                    savedPlaytimeHours: prefs.stats.playtimeHours || 0,
                },
                version: 0,
            };
            localStorage.setItem("stats-storage", JSON.stringify(statsData));

            set({ error: null });
        } catch (error) {
            set({ error: `Erreur lors de l'import: ${error}` });
        }
    },

    saveToCloud: async (userId: string) => {
        set({ isSyncing: true, error: null });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error("Session non trouvée");
            }

            const prefs = await get().exportPreferences();
            const jsonContent = JSON.stringify(prefs, null, 2);

            // Utiliser la commande Rust pour éviter le Tracking Prevention
            await invoke("save_preferences_to_cloud", {
                jsonContent,
                userId,
                accessToken: session.access_token,
            });

            set({
                isSyncing: false,
                lastSyncDate: new Date().toISOString(),
            });

            return true;
        } catch (error) {
            set({
                isSyncing: false,
                error: `Erreur sauvegarde cloud: ${error}`,
            });
            return false;
        }
    },

    loadFromCloud: async (userId: string) => {
        set({ isSyncing: true, error: null });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error("Session non trouvée");
            }

            // Utiliser la commande Rust pour éviter le Tracking Prevention
            const result = await invoke<string | null>("load_preferences_from_cloud", {
                userId,
                accessToken: session.access_token,
            });

            if (!result) {
                set({ isSyncing: false });
                return null;
            }

            const prefs = JSON.parse(result) as ExportedPreferences;

            set({
                isSyncing: false,
                lastSyncDate: prefs.exportedAt,
            });

            return prefs;
        } catch (error) {
            set({
                isSyncing: false,
                error: `Erreur chargement cloud: ${error}`,
            });
            return null;
        }
    },

    deleteFromCloud: async (userId: string) => {
        set({ isSyncing: true, error: null });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error("Session non trouvée");
            }

            // Utiliser la commande Rust pour éviter le Tracking Prevention
            await invoke("delete_preferences_from_cloud", {
                userId,
                accessToken: session.access_token,
            });

            set({
                isSyncing: false,
                lastSyncDate: null,
            });

            return true;
        } catch (error) {
            set({
                isSyncing: false,
                error: `Erreur suppression cloud: ${error}`,
            });
            return false;
        }
    },

    hasCloudPreferences: async (userId: string) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                return false;
            }

            // Utiliser loadFromCloud pour vérifier - si ça retourne quelque chose, les prefs existent
            const result = await invoke<string | null>("load_preferences_from_cloud", {
                userId,
                accessToken: session.access_token,
            });

            return result !== null;
        } catch {
            return false;
        }
    },
}));
