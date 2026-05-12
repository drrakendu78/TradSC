import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/utils/tauri-helpers';
import { GamePaths, isGamePaths, TranslationsChoosen, LocalizationConfig, isLocalizationConfig } from '@/types/translation';

export type TranslationGlobalStatus =
    | 'loading'
    | 'no_game'
    | 'not_installed'
    | 'up_to_date'
    | 'update_available'
    | 'partial';

export interface VersionTranslationStatus {
    version: string;
    installedPath: string;
    translated: boolean;
    upToDate: boolean;
    selectedLink: string | null;
    releaseVersion: string | null;
    gameVersion: string | null;
    buildNumber: string | null;
    branch: string | null;
}

export interface TranslationStatusInfo {
    status: TranslationGlobalStatus;
    sourceLabel: string | null;
    versions: VersionTranslationStatus[];
    liveVersion: VersionTranslationStatus | null;
    refresh: () => Promise<void>;
}

const DEFAULT_LANG = 'fr';

function extractSourceLabel(translations: LocalizationConfig | null, link: string | null): string | null {
    if (!link) return null;
    if (link.startsWith('cache:')) {
        const src = link.replace('cache:', '');
        if (src.includes('scefra') || src.includes('scfra')) return 'SCEFRA';
        if (src.includes('circuspes')) return 'Circuspes';
        return src;
    }
    const found = translations?.fr?.links?.find((l) => l.url === link);
    if (found) {
        if (found.name.includes('SCEFRA') || found.name.includes('SCFRA')) return 'SCEFRA';
        if (found.name.toLowerCase().includes('circuspes')) return 'Circuspes';
        return found.name;
    }
    return null;
}

const TRANSLATION_STATUS_CACHE_KEY = 'startradfr_translation_status_cache';

// TTL (en ms) pour éviter de re-lancer is_translation_up_to_date (HTTP vers SCEFRA)
// si le hook a déjà compute récemment dans un autre composant.
// Le cache localStorage reste la source d'affichage instantané au mount.
const RECENT_COMPUTE_TTL_MS = 30_000;
let lastComputeAt = 0;
let inflightCompute: Promise<void> | null = null;

interface CachedStatus {
    paths: GamePaths | null;
    selected: TranslationsChoosen | null;
    translations: LocalizationConfig | null;
}

function readStatusCache(): CachedStatus | null {
    try {
        const raw = localStorage.getItem(TRANSLATION_STATUS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            paths: parsed.paths ?? null,
            selected: parsed.selected ?? null,
            translations: parsed.translations ?? null,
        };
    } catch {
        return null;
    }
}

function writeStatusCache(data: CachedStatus): void {
    try {
        localStorage.setItem(TRANSLATION_STATUS_CACHE_KEY, JSON.stringify(data));
    } catch {}
}

export function useTranslationStatus(): TranslationStatusInfo {
    const cached = readStatusCache();
    const [paths, setPaths] = useState<GamePaths | null>(cached?.paths ?? null);
    const [selected, setSelected] = useState<TranslationsChoosen | null>(cached?.selected ?? null);
    const [translations, setTranslations] = useState<LocalizationConfig | null>(cached?.translations ?? null);
    const [loading, setLoading] = useState(!cached);
    const mountedRef = useRef(true);

    const computeState = useCallback(async (force = false) => {
        if (!isTauri()) {
            setLoading(false);
            return;
        }

        // Dédupe inter-composants : si un autre call est en cours, attendre celui-là
        // au lieu d'en relancer un nouveau (qui ferait les mêmes invokes / HTTP en double).
        if (inflightCompute) {
            await inflightCompute;
            if (mountedRef.current) setLoading(false);
            return;
        }

        // TTL : si on a compute il y a moins de RECENT_COMPUTE_TTL_MS, skip (sauf force).
        // Ça évite que le mount de plusieurs composants en cascade (Home, Sidebar,
        // HomeStatusCard, navigation vers Traduction) ne relance plusieurs fois la
        // chaîne d'invokes (qui inclut is_translation_up_to_date = HTTP SCEFRA).
        if (!force && Date.now() - lastComputeAt < RECENT_COMPUTE_TTL_MS) {
            setLoading(false);
            return;
        }

        inflightCompute = (async () => {
        try {
            const [versionsRaw, savedPrefs, translationsData] = await Promise.all([
                invoke('get_star_citizen_versions').catch(() => null),
                invoke('load_translations_selected').catch(() => null),
                invoke('get_translations').catch(() => null),
            ]);

            const versionsParsed = isGamePaths(versionsRaw) ? versionsRaw : null;
            const prefs = (savedPrefs && typeof savedPrefs === 'object') ? (savedPrefs as TranslationsChoosen) : null;
            const localization = isLocalizationConfig(translationsData) ? translationsData : null;

            if (!versionsParsed) {
                if (mountedRef.current) {
                    setPaths(null);
                    setSelected(prefs);
                    setTranslations(localization);
                    setLoading(false);
                    writeStatusCache({ paths: null, selected: prefs, translations: localization });
                }
                return;
            }

            // Pour chaque version installée, vérifier translated + up_to_date
            const updatedVersions: GamePaths['versions'] = {};
            await Promise.all(
                Object.entries(versionsParsed.versions).map(async ([key, value]) => {
                    const versionSettings = prefs?.[key];
                    const selectedLanguage = versionSettings?.lang || DEFAULT_LANG;

                    let translated = false;
                    let upToDate = value.up_to_date ?? false;

                    try {
                        translated = await invoke<boolean>('is_game_translated', {
                            path: value.path,
                            lang: selectedLanguage,
                        });
                    } catch {
                        translated = false;
                    }

                    if (translated && versionSettings?.link) {
                        if (versionSettings.link.startsWith('cache:')) {
                            upToDate = true;
                        } else {
                            try {
                                upToDate = await invoke<boolean>('is_translation_up_to_date', {
                                    path: value.path,
                                    translationLink: versionSettings.link,
                                    lang: selectedLanguage,
                                });
                            } catch {
                                upToDate = translated;
                            }
                        }
                    } else if (!translated) {
                        upToDate = false;
                    }

                    updatedVersions[key] = {
                        ...value,
                        translated,
                        up_to_date: upToDate,
                    };
                }),
            );

            if (mountedRef.current) {
                const newPaths = { versions: updatedVersions };
                setPaths(newPaths);
                setSelected(prefs);
                setTranslations(localization);
                setLoading(false);
                writeStatusCache({ paths: newPaths, selected: prefs, translations: localization });
            }
        } catch {
            if (mountedRef.current) setLoading(false);
        } finally {
            lastComputeAt = Date.now();
        }
        })();
        try { await inflightCompute; } finally { inflightCompute = null; }
    }, []);


    useEffect(() => {
        mountedRef.current = true;
        computeState();

        // Re-check quand on revient online
        const handleOnline = () => computeState();
        window.addEventListener('online', handleOnline);

        // Re-check sur événement personnalisé après install/update depuis la page Traduction
        // -> force = true pour ignorer le TTL (un install vient juste de changer l'état réel).
        const refreshHandler = () => computeState(true);
        window.addEventListener('translationStatusChanged', refreshHandler as EventListener);

        // Écouter les events émis par le service background (background_service.rs)
        // qui check & update les traductions toutes les N minutes en arrière-plan.
        const tauriListeners: Array<Promise<() => void>> = [];
        if (isTauri()) {
            tauriListeners.push(listen('translation-update-done', () => computeState(true)));
            tauriListeners.push(listen('translation-update-error', () => computeState(true)));
        }

        return () => {
            mountedRef.current = false;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('translationStatusChanged', refreshHandler as EventListener);
            tauriListeners.forEach((p) => p.then((u) => u()).catch(() => {}));
        };
    }, [computeState]);

    const versionsArray: VersionTranslationStatus[] = paths
        ? Object.entries(paths.versions).map(([version, info]) => ({
            version,
            installedPath: info.path,
            translated: info.translated,
            upToDate: info.up_to_date,
            selectedLink: selected?.[version]?.link ?? null,
            releaseVersion: info.release_version ?? null,
            gameVersion: info.game_version ?? null,
            buildNumber: info.build_number ?? null,
            branch: info.branch ?? null,
        }))
        : [];

    const liveVersion = versionsArray.find((v) => v.version === 'LIVE') ?? null;

    let status: TranslationGlobalStatus;
    if (loading) {
        status = 'loading';
    } else if (versionsArray.length === 0) {
        status = 'no_game';
    } else {
        const translatedVersions = versionsArray.filter((v) => v.translated);
        if (translatedVersions.length === 0) {
            status = 'not_installed';
        } else {
            const allUpToDate = translatedVersions.every((v) => v.upToDate);
            const allVersionsTranslated = versionsArray.every((v) => v.translated);
            if (allUpToDate && allVersionsTranslated) {
                status = 'up_to_date';
            } else if (!allUpToDate) {
                status = 'update_available';
            } else {
                status = 'partial';
            }
        }
    }

    const liveLink = selected?.LIVE?.link ?? versionsArray[0]?.selectedLink ?? null;
    const sourceLabel = extractSourceLabel(translations, liveLink);

    return {
        status,
        sourceLabel,
        versions: versionsArray,
        liveVersion,
        refresh: computeState,
    };
}

export function notifyTranslationStatusChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('translationStatusChanged'));
    }
}
