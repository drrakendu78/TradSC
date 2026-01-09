import { create } from "zustand";
import { supabase, BUCKET_NAME } from "@/lib/supabase";
import { useSidebarStore } from "./sidebar-store";
import { useThemeStore } from "./theme-store";
import { useStatsStore } from "./stats-store";
import { applyTheme } from "@/utils/custom-theme-provider";

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
    };
}

interface PreferencesSyncStore {
    isSyncing: boolean;
    lastSyncDate: string | null;
    error: string | null;

    // Export toutes les préférences en JSON
    exportPreferences: () => ExportedPreferences;

    // Import des préférences depuis JSON
    importPreferences: (prefs: ExportedPreferences) => void;

    // Sauvegarde sur Supabase
    saveToCloud: (userId: string) => Promise<boolean>;

    // Charge depuis Supabase
    loadFromCloud: (userId: string) => Promise<ExportedPreferences | null>;

    // Liste les sauvegardes de préférences disponibles
    listCloudPreferences: (userId: string) => Promise<string[]>;
}

const PREFERENCES_FOLDER = "preferences";
const PREFERENCES_FILE = "user_preferences.json";
const EXPORT_VERSION = "1.0.0";

export const usePreferencesSyncStore = create<PreferencesSyncStore>((set, get) => ({
    isSyncing: false,
    lastSyncDate: null,
    error: null,

    exportPreferences: () => {
        const sidebarState = useSidebarStore.getState();
        const themeState = useThemeStore.getState();
        const statsState = useStatsStore.getState();

        // Récupérer le mode du thème depuis localStorage
        const themeMode = localStorage.getItem("vite-ui-theme") || "dark";

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
                backupCreatedCount: statsState.backupCreatedCount,
                characterDownloadCount: statsState.characterDownloadCount,
                firstUseDate: statsState.firstUseDate,
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
            const prefs = get().exportPreferences();
            const jsonContent = JSON.stringify(prefs, null, 2);
            const blob = new Blob([jsonContent], { type: "application/json" });

            const filePath = `${userId}/${PREFERENCES_FOLDER}/${PREFERENCES_FILE}`;

            const { error } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(filePath, blob, {
                    upsert: true,
                    contentType: "application/json",
                });

            if (error) {
                throw error;
            }

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
            const filePath = `${userId}/${PREFERENCES_FOLDER}/${PREFERENCES_FILE}`;

            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .download(filePath);

            if (error) {
                // Fichier non trouvé = pas de préférences sauvegardées
                if (error.message.includes("not found")) {
                    set({ isSyncing: false });
                    return null;
                }
                throw error;
            }

            const text = await data.text();
            const prefs = JSON.parse(text) as ExportedPreferences;

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

    listCloudPreferences: async (userId: string) => {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .list(`${userId}/${PREFERENCES_FOLDER}`);

            if (error) {
                return [];
            }

            return data?.map((file) => file.name) || [];
        } catch {
            return [];
        }
    },
}));
