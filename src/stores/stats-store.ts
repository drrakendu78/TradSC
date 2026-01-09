import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StatsStore {
    // Dates d'installation des traductions par version
    translationInstallDates: Record<string, string>; // { "LIVE": "2026-01-07T12:00:00Z", ... }

    // Compteurs d'actions
    cacheCleanCount: number;
    translationInstallCount: number;
    backupCreatedCount: number;
    characterDownloadCount: number;

    // Première utilisation de l'app
    firstUseDate: string | null;

    // Actions
    recordTranslationInstall: (version: string) => void;
    recordCacheClean: () => void;
    recordBackupCreated: () => void;
    recordCharacterDownload: () => void;
    getTranslationInstalledDays: (version: string) => number | null;
    getAppUsageDays: () => number | null;
}

export const useStatsStore = create<StatsStore>()(
    persist(
        (set, get) => ({
            translationInstallDates: {},
            cacheCleanCount: 0,
            translationInstallCount: 0,
            backupCreatedCount: 0,
            characterDownloadCount: 0,
            firstUseDate: null,

            recordTranslationInstall: (version: string) => set((state) => ({
                translationInstallDates: {
                    ...state.translationInstallDates,
                    [version]: new Date().toISOString(),
                },
                translationInstallCount: state.translationInstallCount + 1,
                firstUseDate: state.firstUseDate || new Date().toISOString(),
            })),

            recordCacheClean: () => set((state) => ({
                cacheCleanCount: state.cacheCleanCount + 1,
                firstUseDate: state.firstUseDate || new Date().toISOString(),
            })),

            recordBackupCreated: () => set((state) => ({
                backupCreatedCount: state.backupCreatedCount + 1,
                firstUseDate: state.firstUseDate || new Date().toISOString(),
            })),

            recordCharacterDownload: () => set((state) => ({
                characterDownloadCount: state.characterDownloadCount + 1,
                firstUseDate: state.firstUseDate || new Date().toISOString(),
            })),

            getTranslationInstalledDays: (version: string) => {
                const date = get().translationInstallDates[version];
                if (!date) return null;
                const installDate = new Date(date);
                const now = new Date();
                const diffTime = Math.abs(now.getTime() - installDate.getTime());
                return Math.floor(diffTime / (1000 * 60 * 60 * 24));
            },

            getAppUsageDays: () => {
                const date = get().firstUseDate;
                if (!date) return null;
                const firstDate = new Date(date);
                const now = new Date();
                const diffTime = Math.abs(now.getTime() - firstDate.getTime());
                return Math.floor(diffTime / (1000 * 60 * 60 * 24));
            },
        }),
        {
            name: "stats-storage",
        }
    )
);
