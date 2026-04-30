import { m } from "framer-motion";
import { useState, useEffect, useMemo, useCallback, useRef, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    GamePaths,
    isGamePaths,
    TranslationsChoosen,
    LocalizationConfig,
    isLocalizationConfig,
    Link,
} from "@/types/translation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import logger from "@/utils/logger";
import { Loader2, XCircle, CheckCircle, AlertCircle, HelpCircle, Globe2, Languages, Settings2, WifiOff, FolderOpen, Clock, Link2, Plus, Trash2 } from "lucide-react";
import { useStatsStore } from "@/stores/stats-store";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type TraductionState = {
    paths: GamePaths | null | undefined;
    translationsSelected: TranslationsChoosen | null;
    translations: LocalizationConfig | null;
    loadingButtonId: string | null;
    dataFetched: boolean;
    isAdmin: boolean;
};
type TraductionAction =
    | { type: 'SET_PATHS'; paths: GamePaths | null }
    | { type: 'SET_TRANSLATIONS'; translations: LocalizationConfig | null }
    | { type: 'SET_TRANSLATIONS_SELECTED'; selected: TranslationsChoosen | null }
    | { type: 'SET_LOADING_BUTTON'; id: string | null }
    | { type: 'SET_DATA_FETCHED' }
    | { type: 'SET_IS_ADMIN'; isAdmin: boolean };

type CustomTranslationSource = {
    id: string;
    name: string;
    url: string;
    language: string;
};

const CUSTOM_TRANSLATION_SOURCES_KEY = "startrad.customTranslationSources.v1";
const DEFAULT_CUSTOM_TRANSLATION_LANGUAGE = "french_(france)";
const CUSTOM_TRANSLATION_LANGUAGES = [
    { value: "chinese_(simplified)", label: "Chinese (Simplified)" },
    { value: "chinese_(traditional)", label: "Chinese (Traditional)" },
    { value: "english", label: "English" },
    { value: "french_(france)", label: "French (France)" },
    { value: "german_(germany)", label: "German (Germany)" },
    { value: "italian_(italy)", label: "Italian (Italy)" },
    { value: "japanese_(japan)", label: "Japanese (Japan)" },
    { value: "korean_(south_korea)", label: "Korean (South Korea)" },
    { value: "polish_(poland)", label: "Polish (Poland)" },
    { value: "portuguese_(brazil)", label: "Portuguese (Brazil)" },
    { value: "spanish_(latin_america)", label: "Spanish (Latin America)" },
    { value: "spanish_(spain)", label: "Spanish (Spain)" },
];

const isSupportedCustomLanguage = (language: string) => (
    CUSTOM_TRANSLATION_LANGUAGES.some((item) => item.value === language)
);

const getCustomLanguageLabel = (language: string | null | undefined) => (
    CUSTOM_TRANSLATION_LANGUAGES.find((item) => item.value === language)?.label ?? "French (France)"
);

const normalizeGlobalIniUrl = (rawUrl: string): string | null => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        if (!["http:", "https:"].includes(url.protocol)) return null;

        if (url.hostname.toLowerCase() === "github.com") {
            const parts = url.pathname.split("/").filter(Boolean);
            const blobIndex = parts.indexOf("blob");
            if (blobIndex === 2 && parts.length > 4) {
                const [owner, repo] = parts;
                const branch = parts[3];
                const filePath = parts.slice(4).join("/");
                return normalizeGlobalIniUrl(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`);
            }
        }

        const cleanPath = url.pathname.replace(/\/+$/, "").toLowerCase();
        if (!cleanPath.endsWith("global.ini")) return null;

        url.hash = "";
        return url.toString();
    } catch {
        return null;
    }
};

const createCustomSourceId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const loadCustomTranslationSources = (): CustomTranslationSource[] => {
    if (typeof window === "undefined") return [];

    try {
        const raw = window.localStorage.getItem(CUSTOM_TRANSLATION_SOURCES_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((source): CustomTranslationSource | null => {
                if (!source || typeof source !== "object") return null;
                const url = normalizeGlobalIniUrl(String(source.url ?? ""));
                if (!url) return null;

                const name = String(source.name ?? "").trim() || "Traduction perso";
                const id = String(source.id ?? "").trim() || createCustomSourceId();
                const rawLanguage = String(source.language ?? "").trim();
                const language = isSupportedCustomLanguage(rawLanguage)
                    ? rawLanguage
                    : DEFAULT_CUSTOM_TRANSLATION_LANGUAGE;
                return { id, name, url, language };
            })
            .filter((source): source is CustomTranslationSource => Boolean(source));
    } catch {
        return [];
    }
};

function traductionReducer(state: TraductionState, action: TraductionAction): TraductionState {
    switch (action.type) {
        case 'SET_PATHS': return { ...state, paths: action.paths };
        case 'SET_TRANSLATIONS': return { ...state, translations: action.translations };
        case 'SET_TRANSLATIONS_SELECTED': return { ...state, translationsSelected: action.selected };
        case 'SET_LOADING_BUTTON': return { ...state, loadingButtonId: action.id };
        case 'SET_DATA_FETCHED': return { ...state, dataFetched: true };
        case 'SET_IS_ADMIN': return { ...state, isAdmin: action.isAdmin };
    }
}

export default function Traduction() {
    const [{ paths, translationsSelected, translations, loadingButtonId, dataFetched, isAdmin }, dispatch] = useReducer(traductionReducer, {
        paths: undefined,
        translationsSelected: null,
        translations: null,
        loadingButtonId: null,
        dataFetched: false,
        isAdmin: true,
    });
    const [earlyChecked, setEarlyChecked] = useState<boolean>(false);
    const [lastUpdatedDates, setLastUpdatedDates] = useState<Record<string, string | null>>({});
    const [cachedVersions, setCachedVersions] = useState<Record<string, Record<string, { cached_at: string; original_url: string }>>>({});
    const [customSourceDialogOpen, setCustomSourceDialogOpen] = useState(false);
    const [customSourceName, setCustomSourceName] = useState("");
    const [customSourceUrl, setCustomSourceUrl] = useState("");
    const [customSourceLanguage, setCustomSourceLanguage] = useState(DEFAULT_CUSTOM_TRANSLATION_LANGUAGE);
    const [customTranslationSources, setCustomTranslationSources] = useState<CustomTranslationSource[]>(() => loadCustomTranslationSources());

    const defaultLanguage = "fr";

    const officialTranslationLinks = translations?.fr?.links ?? [];
    const customTranslationLinks = useMemo<Link[]>(() => (
        customTranslationSources.map((source, index) => ({
            id: -1 - index,
            name: `Perso - ${source.name}`,
            url: source.url,
        }))
    ), [customTranslationSources]);
    const availableTranslationLinks = useMemo<Link[]>(() => (
        [...officialTranslationLinks, ...customTranslationLinks]
    ), [officialTranslationLinks, customTranslationLinks]);
    const customSourceByUrl = useMemo(() => (
        customTranslationSources.reduce<Record<string, CustomTranslationSource>>((acc, source) => {
            acc[source.url] = source;
            return acc;
        }, {})
    ), [customTranslationSources]);

    // Fonction pour formater la date en "il y a X jours"
    const formatRelativeDate = (isoDate: string | null): string | null => {
        if (!isoDate) return null;
        try {
            const date = new Date(isoDate);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) return "aujourd'hui";
            if (diffDays === 1) return "hier";
            if (diffDays < 7) return `il y a ${diffDays}j`;
            if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} sem.`;
            if (diffDays < 365) return `il y a ${Math.floor(diffDays / 30)} mois`;
            return `il y a ${Math.floor(diffDays / 365)} an(s)`;
        } catch {
            return null;
        }
    };
    const { toast } = useToast();

    // Stats
    const { recordTranslationInstall } = useStatsStore();

    useEffect(() => {
        try {
            window.localStorage.setItem(CUSTOM_TRANSLATION_SOURCES_KEY, JSON.stringify(customTranslationSources));
        } catch (error) {
            logger.error("Erreur sauvegarde sources personnalisÃ©es:", error);
        }
    }, [customTranslationSources]);

    const isProtectedPath = (p: string) => /:\\Program Files( \(x86\))?\\/i.test(p);
    const toFriendlyFsError = (err: unknown) => {
        const msg = String(err ?? "");
        if (/Accès refusé|Access is denied|os error 5|Permission denied/i.test(msg)) {
            return "Accès refusé. Essayez de lancer l'application en tant qu'administrateur ou installez le jeu en dehors de 'Program Files'.";
        }
        return msg;
    };

    const markVersionAsReady = useCallback((version: string) => {
        if (!paths?.versions[version]) return;

        dispatch({
            type: 'SET_PATHS',
            paths: {
                ...paths,
                versions: {
                    ...paths.versions,
                    [version]: {
                        ...paths.versions[version],
                        translated: true,
                        up_to_date: true,
                    },
                },
            },
        });
    }, [paths]);

    const getDefaultTranslationsState = (): TranslationsChoosen => {
        if (!paths) return {};

        const defaults: TranslationsChoosen = {};

        Object.keys(paths.versions).forEach(version => {
            defaults[version] = { link: null, settingsEN: false, lang: defaultLanguage, custom: false };
        });

        return defaults;
    };

    useEffect(() => {
        const fetchData = async () => {
            if (dataFetched) return;
            try {
                const versions = await invoke("get_star_citizen_versions");
                if (isGamePaths(versions)) {
                    logger.log("Versions du jeu reçues:", versions);
                    dispatch({ type: 'SET_PATHS', paths: versions });
                }

                logger.log("Récupération des traductions...");
                const translationsData = await invoke("get_translations");
                logger.log("Données de traduction reçues:", translationsData);
                
                if (isLocalizationConfig(translationsData)) {
                    dispatch({ type: 'SET_TRANSLATIONS', translations: translationsData });
                }

                const savedPrefs: TranslationsChoosen = await invoke("load_translations_selected");
                if (savedPrefs && typeof savedPrefs === "object") {
                    logger.log("Préférences de traduction chargées:", savedPrefs);
                    dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: savedPrefs });
                } else {
                    logger.log("Initialisation avec les préférences par défaut");
                    dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: getDefaultTranslationsState() });
                }

                return true;
            } catch (error) {
                console.error("Erreur lors du chargement des données:", error);
                dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: getDefaultTranslationsState() });
                return false;
            }
        };

        const checkAdminStatus = async () => {
            try {
                const adminStatus = await invoke<boolean>("is_running_as_admin");
                dispatch({ type: 'SET_IS_ADMIN', isAdmin: adminStatus });
            } catch (error) {
                console.error("Erreur lors de la vérification du statut admin:", error);
                dispatch({ type: 'SET_IS_ADMIN', isAdmin: false });
            }
        };

        if (!dataFetched) {
            dispatch({ type: 'SET_DATA_FETCHED' });
            Promise.all([fetchData(), checkAdminStatus()]).then(([dataStatus]) => {
                dataStatus
                    ? toast({
                        title: "Données chargées",
                        description: "Les données de traduction ont été chargées avec succès.",
                        success: "true",
                        duration: 3000,
                    })
                    : toast({
                        title: "Erreur lors du chargement des données",
                        description: `Une erreur est survenue lors du chargement des données.`,
                        success: "false",
                        duration: 3000,
                    });
            });
        }

        // Vérification périodique du statut admin (toutes les 5 secondes)
        const adminCheckInterval = setInterval(checkAdminStatus, 5000);
        return () => clearInterval(adminCheckInterval);
    }, []);

    // Écouter les changements de connectivité pour rafraîchir les données
    useEffect(() => {
        const handleOnline = async () => {
            logger.log("[Connectivité] Internet détecté, rafraîchissement des traductions...");
            try {
                const translationsData = await invoke("get_translations");
                if (isLocalizationConfig(translationsData)) {
                    dispatch({ type: 'SET_TRANSLATIONS', translations: translationsData });
                    logger.log("[Connectivité] Traductions rafraîchies avec succès");
                }
            } catch (error) {
                logger.error("[Connectivité] Erreur rafraîchissement:", error);
            }
        };

        const handleOffline = () => {
            logger.log("[Connectivité] Connexion perdue, passage en mode hors-ligne");
            // Forcer un re-render en mettant translations à null
            dispatch({ type: 'SET_TRANSLATIONS', translations: null });
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Cacher les traductions installées (backup) et charger la liste du cache
    useEffect(() => {
        const initAndLoadCache = async () => {
            try {
                // D'abord, cacher les traductions déjà installées dans le jeu (backup automatique)
                const newlyCached = await invoke<number>('cache_all_installed_translations');
                if (newlyCached > 0) {
                    logger.log(`${newlyCached} traduction(s) mise(s) en cache automatiquement`);
                }

                // Ensuite, charger la liste des traductions en cache
                interface CachedTranslation {
                    game_version: string;
                    source: string;
                    original_url: string;
                    cached_at: string;
                }
                const cached = await invoke<CachedTranslation[]>('list_cached_translations');
                const cacheMap: Record<string, Record<string, { cached_at: string; original_url: string }>> = {};
                cached.forEach(c => {
                    const versionKey = c.game_version.toUpperCase();
                    if (!cacheMap[versionKey]) {
                        cacheMap[versionKey] = {};
                    }
                    cacheMap[versionKey][c.source] = { cached_at: c.cached_at, original_url: c.original_url };
                });
                setCachedVersions(cacheMap);
                logger.log("Traductions en cache:", cacheMap);
            } catch (error) {
                logger.error("Erreur initialisation cache:", error);
            }
        };
        initAndLoadCache();
    }, []);

    // Ref pour tracker si la conversion online a été faite
    const hasConvertedToOnline = useRef(false);

    const saveSelectedTranslations = useCallback(
        async (newTranslationsSelected: TranslationsChoosen) => {
            try {
                await invoke("save_translations_selected", {
                    data: newTranslationsSelected,
                });
                toast({
                    title: "Préférences de traduction sauvegardées",
                    description: `Les préférences de traduction ont été sauvegardées avec succès.`,
                    success: "true",
                    duration: 3000,
                });
            } catch (error) {
                toast({
                    title: "Erreur lors de la sauvegarde des données",
                    description: `Une erreur est survenue lors de la sauvegarde des données : ${error}`,
                    success: "false",
                    duration: 3000,
                });
            }
        },
        [toast],
    );

    const addCustomTranslationSource = useCallback(() => {
        const url = normalizeGlobalIniUrl(customSourceUrl);
        if (!url) {
            toast({
                title: "Lien invalide",
                description: "La source personnalisÃ©e doit Ãªtre un lien http(s) qui pointe vers un fichier global.ini.",
                variant: "destructive",
                duration: 4000,
            });
            return;
        }

        if (customTranslationSources.some((source) => source.url === url) || officialTranslationLinks.some((link) => link.url === url)) {
            toast({
                title: "Source dÃ©jÃ  prÃ©sente",
                description: "Ce lien global.ini est dÃ©jÃ  disponible dans la liste.",
                duration: 3000,
            });
            return;
        }

        const urlParts = new URL(url);
        const fallbackName = urlParts.hostname.replace(/^www\./, "");
        const name = customSourceName.trim() || fallbackName || "Traduction perso";
        const language = isSupportedCustomLanguage(customSourceLanguage)
            ? customSourceLanguage
            : DEFAULT_CUSTOM_TRANSLATION_LANGUAGE;

        setCustomTranslationSources((sources) => [
            ...sources,
            { id: createCustomSourceId(), name, url, language },
        ]);
        setCustomSourceName("");
        setCustomSourceUrl("");
        setCustomSourceLanguage(DEFAULT_CUSTOM_TRANSLATION_LANGUAGE);

        toast({
            title: "Source personnalisÃ©e ajoutÃ©e",
            description: `Elle est maintenant disponible pour ${getCustomLanguageLabel(language)}.`,
            variant: "success",
            duration: 3000,
        });
    }, [customSourceLanguage, customSourceName, customSourceUrl, customTranslationSources, officialTranslationLinks, toast]);

    const removeCustomTranslationSource = useCallback(
        async (sourceId: string) => {
            const sourceToRemove = customTranslationSources.find((source) => source.id === sourceId);
            if (!sourceToRemove) return;

            setCustomTranslationSources((sources) => sources.filter((source) => source.id !== sourceId));

            if (!translationsSelected) return;

            let hasChanged = false;
            const updatedTranslations: TranslationsChoosen = { ...translationsSelected };
            Object.entries(translationsSelected).forEach(([version, settings]) => {
                if (settings?.link === sourceToRemove.url) {
                    updatedTranslations[version] = {
                        ...settings,
                        link: null,
                        lang: defaultLanguage,
                        custom: false,
                    };
                    hasChanged = true;
                }
            });

            if (hasChanged) {
                dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedTranslations });
                await saveSelectedTranslations(updatedTranslations);
            }
        },
        [customTranslationSources, translationsSelected, saveSelectedTranslations, defaultLanguage],
    );

    const CheckTranslationsState = useCallback(
        async (paths: GamePaths) => {
            if (!translationsSelected) return;

            const updatedPaths = { ...paths };
            await Promise.all(
                Object.entries(paths.versions).map(async ([key, value]) => {
                    const versionSettings = translationsSelected[key as keyof TranslationsChoosen];
                    const isCustomSource = Boolean(versionSettings?.link && customSourceByUrl[versionSettings.link]);
                    const selectedLanguage = versionSettings?.lang
                        || (versionSettings?.link ? customSourceByUrl[versionSettings.link]?.language : undefined)
                        || defaultLanguage;

                    const translated: boolean = await invoke(
                        "is_game_translated",
                        {
                            path: value.path,
                            lang: selectedLanguage,
                        },
                    );

                    // Appliquer le branding automatiquement si la traduction est installée
                    if (translated && !isCustomSource) {
                        try {
                            await invoke("apply_branding_to_local_file", {
                                path: value.path,
                                lang: selectedLanguage,
                            });
                        } catch (e) {
                            console.error("Erreur branding:", e);
                        }
                    }

                    // Si le lien est un lien cache (hors-ligne), considérer comme à jour si traduit
                    // car on ne peut pas vérifier la version en ligne
                    const upToDate: boolean = (versionSettings && versionSettings.link)
                        ? versionSettings.link.startsWith("cache:")
                            ? translated // Si cache et traduit = à jour
                            : isCustomSource
                                ? translated
                                : await invoke("is_translation_up_to_date", {
                                path: value.path,
                                translationLink: versionSettings.link,
                                lang: selectedLanguage,
                            })
                        : value.up_to_date;

                    const versionInfo = {
                        ...value,
                        path: value.path,
                        translated: translated,
                        up_to_date: upToDate,
                    };

                    updatedPaths.versions[key as keyof GamePaths["versions"]] = versionInfo;
                }),
            );

            dispatch({ type: 'SET_PATHS', paths: updatedPaths });
            dispatch({ type: 'SET_LOADING_BUTTON', id: null });
        },
        [translationsSelected, customSourceByUrl, defaultLanguage],
    );

    // Quand internet revient (translations disponible), convertir les liens cache: vers les vraies URLs
    useEffect(() => {
        if (!translations?.fr?.links?.length || !translationsSelected) {
            // Reset le flag si on perd la connexion
            if (!translations?.fr?.links?.length) {
                hasConvertedToOnline.current = false;
            }
            return;
        }

        // Vérifier s'il y a des liens cache: à convertir
        const hasCacheLinks = Object.values(translationsSelected).some(
            (settings) => settings?.link?.startsWith("cache:")
        );

        // Si pas de liens cache ou déjà converti, ne rien faire
        if (!hasCacheLinks || hasConvertedToOnline.current) return;

        // Mapping des sources cache vers les URLs
        const cacheToUrlMap: Record<string, string> = {};
        translations.fr.links.forEach((link: Link) => {
            if (link.name.includes("SCEFRA") || link.name.includes("SCFRA")) {
                if (link.name.includes("Settings EN") || link.name.includes("EN")) {
                    cacheToUrlMap["scefra_en"] = link.url;
                } else {
                    cacheToUrlMap["scefra_fr"] = link.url;
                }
            } else if (link.name.toLowerCase().includes("circuspes")) {
                cacheToUrlMap["circuspes"] = link.url;
            }
        });

        // Convertir les liens cache: vers les vraies URLs
        const updatedPrefs = { ...translationsSelected };
        let needsUpdate = false;

        Object.entries(translationsSelected).forEach(([version, settings]) => {
            if (settings?.link?.startsWith("cache:")) {
                const cacheSource = settings.link.replace("cache:", "");
                const realUrl = cacheToUrlMap[cacheSource];
                if (realUrl) {
                    logger.log(`[Mode en ligne] Conversion ${version}: cache:${cacheSource} → ${realUrl}`);
                    updatedPrefs[version as keyof TranslationsChoosen] = {
                        ...settings,
                        link: realUrl,
                        lang: defaultLanguage,
                        custom: false,
                    };
                    needsUpdate = true;
                }
            }
        });

        if (needsUpdate) {
            hasConvertedToOnline.current = true;
            dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedPrefs });
            invoke("save_translations_selected", { data: updatedPrefs }).then(async () => {
                toast({
                    title: "Mode en ligne restauré",
                    description: "Les préférences ont été mises à jour avec les URLs en ligne.",
                    variant: "success",
                    duration: 3000,
                });
                // Forcer un refresh de l'état des traductions
                if (paths) {
                    await CheckTranslationsState(paths);
                }
            }).catch((e) => logger.error("Erreur sauvegarde prefs online:", e));
        }
    }, [translations, translationsSelected, paths, CheckTranslationsState, toast, defaultLanguage]);

    const handleTranslationSelect = useCallback(
        async (version: string, linkUrl: string) => {
            if (!translationsSelected || !paths) return;

            const currentSetting = translationsSelected[version as keyof TranslationsChoosen];
            const versionData = paths.versions[version as keyof GamePaths["versions"]];
            const previousLink = currentSetting?.link;
            const customSource = customSourceByUrl[linkUrl];
            const selectedLanguage = customSource?.language || defaultLanguage;

            const updatedTranslations: TranslationsChoosen = {
                ...translationsSelected,
                [version]: {
                    link: linkUrl,
                    settingsEN: customSource ? false : currentSetting?.settingsEN ?? false,
                    lang: selectedLanguage,
                    custom: Boolean(customSource),
                },
            };

            dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedTranslations });
            await saveSelectedTranslations(updatedTranslations);

            // Si une traduction est déjà installée ET qu'on change de source, on met à jour automatiquement
            if (!versionData || (versionData.translated && previousLink === linkUrl)) return;

            const isUpdate = versionData.translated;
            dispatch({ type: 'SET_LOADING_BUTTON', id: `${isUpdate ? "update" : "install"}-${version}` });
            if (isProtectedPath(versionData.path) && !isAdmin) {
                toast({
                    title: "Chemin protÃ©gÃ©",
                    description: "Dossier sous Program Files: relance en admin recommandÃ©e (bouclier en bas Ã  droite).",
                    success: "false",
                    duration: 5000,
                });
            }

            {
                try {
                    await invoke(isUpdate ? "update_translation" : "init_translation_files", {
                        path: versionData.path,
                        translationLink: linkUrl,
                        lang: selectedLanguage,
                        gameVersion: version,
                    });
                    if (!isUpdate) {
                        recordTranslationInstall(version);
                    }
                    toast({
                        title: "Traduction mise à jour",
                        description: "La nouvelle traduction a été installée automatiquement.",
                        variant: "success",
                        duration: 3000,
                    });
                    // Mettre à jour immédiatement le statut pour afficher "À jour"
                    const updatedPaths = { ...paths };
                    const currentVersion = updatedPaths.versions[version as keyof GamePaths["versions"]];
                    if (currentVersion) {
                        updatedPaths.versions[version as keyof GamePaths["versions"]] = {
                            ...currentVersion,
                            translated: true,
                            up_to_date: true
                        };
                        dispatch({ type: 'SET_PATHS', paths: updatedPaths });
                    }
                } catch (error) {
                    toast({
                        title: "Erreur de mise à jour",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                } finally {
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                }
            }
        },
        [translationsSelected, saveSelectedTranslations, paths, toast, CheckTranslationsState, customSourceByUrl, defaultLanguage, isAdmin, recordTranslationInstall],
    );

    const handleInstallTranslation = useCallback(
        async (versionPath: string, version: string) => {
            logger.log("Installation de la traduction pour la version:", version);
            if (!translationsSelected) return;

            dispatch({ type: 'SET_LOADING_BUTTON', id: `install-${version}` });
            if (isProtectedPath(versionPath) && !isAdmin) {
                toast({
                    title: "Chemin protégé",
                    description: "Dossier sous Program Files: relance en admin recommandée (bouclier en bas à droite).",
                    success: "false",
                    duration: 5000,
                });
            }

            const versionSettings = translationsSelected[version as keyof TranslationsChoosen];
            const selectedLanguage = versionSettings?.lang
                || (versionSettings?.link ? customSourceByUrl[versionSettings.link]?.language : undefined)
                || defaultLanguage;
            const isCustomVersionSource = Boolean(versionSettings?.link && customSourceByUrl[versionSettings.link]);
            const versionCaches = cachedVersions[version.toUpperCase()];
            const hasCached = versionCaches && Object.keys(versionCaches).length > 0;

            // Vérifier si c'est une sélection directe depuis le cache (préfixe "cache:")
            const isCacheSelection = versionSettings?.link?.startsWith("cache:");
            const cacheSource = isCacheSelection ? versionSettings!.link!.replace("cache:", "") : null;

            // Trouver le cache correspondant à l'URL sélectionnée
            const findMatchingCache = (): string | null => {
                if (!versionCaches || !versionSettings?.link) return null;
                for (const [source, info] of Object.entries(versionCaches)) {
                    if (info.original_url === versionSettings.link) {
                        return source;
                    }
                }
                return null;
            };

            // Si pas de lien sélectionné et pas de cache, erreur
            if (!versionSettings?.link && !hasCached) {
                toast({
                    title: "Traduction non sélectionnée",
                    description: "Veuillez sélectionner une traduction dans le menu déroulant avant d'installer.",
                    success: "false",
                    duration: 3000,
                });
                dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                return;
            }

            // Installation directe depuis le cache (sélection hors-ligne)
            if (isCacheSelection && cacheSource) {
                try {
                    logger.log("Installation directe depuis le cache, source:", cacheSource);
                    const cachedContent = await invoke<string>('get_cached_translation', {
                        gameVersion: version,
                        source: cacheSource,
                    });

                    await invoke("install_translation_from_cache", {
                        path: versionPath,
                        lang: selectedLanguage,
                        cachedContent: cachedContent,
                    });

                    recordTranslationInstall(version);

                    // Nom lisible pour le toast
                    const displayName = cacheSource === "scefra_fr" ? "SCEFRA (Settings FR)"
                        : cacheSource === "scefra_en" ? "SCEFRA (Settings EN)"
                        : cacheSource === "circuspes" ? "Circuspes"
                        : cacheSource;

                    toast({
                        title: "Traduction installée (hors-ligne)",
                        description: `Installée depuis le cache (${displayName}).`,
                        variant: "success",
                        duration: 3000,
                    });

                    if (paths) CheckTranslationsState(paths);
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    return;
                } catch (error) {
                    logger.error("Erreur d'installation depuis cache:", error);
                    toast({
                        title: "Erreur d'installation",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    return;
                }
            }

            // Essayer d'abord l'installation en ligne
            if (versionSettings?.link) {
                try {
                    logger.log("Installation avec le lien existant:", versionSettings.link);

                    await invoke("init_translation_files", {
                        path: versionPath,
                        translationLink: versionSettings.link,
                        lang: selectedLanguage,
                        gameVersion: version,
                    });

                    // Enregistrer les stats
                    recordTranslationInstall(version);

                    toast({
                        title: "Traduction installée",
                        description: "La traduction a été installée avec succès.",
                        variant: "success",
                        duration: 3000,
                    });

                    if (isCustomVersionSource) {
                        markVersionAsReady(version);
                        dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    } else if (paths) {
                        CheckTranslationsState(paths);
                    }
                    return;
                } catch (error) {
                    logger.error("Erreur d'installation en ligne:", error);
                    const errorMsg = String(error ?? "");

                    // Si erreur réseau et cache disponible, fallback sur le cache
                    const matchingSource = findMatchingCache();
                    const fallbackSource = matchingSource || (hasCached ? Object.keys(versionCaches!)[0] : null);

                    if (fallbackSource && (errorMsg.includes("network") || errorMsg.includes("connection") || errorMsg.includes("timeout") || errorMsg.includes("dns") || errorMsg.includes("fetch"))) {
                        logger.log("Tentative d'installation depuis le cache, source:", fallbackSource);
                        try {
                            const cachedContent = await invoke<string>('get_cached_translation', {
                                gameVersion: version,
                                source: fallbackSource,
                            });

                            await invoke("install_translation_from_cache", {
                                path: versionPath,
                                lang: selectedLanguage,
                                cachedContent: cachedContent,
                            });

                            recordTranslationInstall(version);

                            toast({
                                title: "Traduction installée (hors-ligne)",
                                description: `Installée depuis le cache (${fallbackSource}).`,
                                variant: "success",
                                duration: 3000,
                            });

                            if (paths) CheckTranslationsState(paths);
                            return;
                        } catch (cacheError) {
                            logger.error("Erreur installation depuis cache:", cacheError);
                        }
                    }

                    toast({
                        title: "Erreur d'installation",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                }
            } else if (hasCached) {
                // Pas de lien mais cache disponible - installer depuis le cache (premier disponible)
                const firstSource = Object.keys(versionCaches!)[0];
                try {
                    logger.log("Installation depuis le cache (mode hors-ligne), source:", firstSource);
                    const cachedContent = await invoke<string>('get_cached_translation', {
                        gameVersion: version,
                        source: firstSource,
                    });

                    await invoke("install_translation_from_cache", {
                        path: versionPath,
                        lang: selectedLanguage,
                        cachedContent: cachedContent,
                    });

                    recordTranslationInstall(version);

                    toast({
                        title: "Traduction installée (hors-ligne)",
                        description: `Installée depuis le cache (${firstSource}).`,
                        variant: "success",
                        duration: 3000,
                    });

                    if (paths) CheckTranslationsState(paths);
                } catch (error) {
                    logger.error("Erreur d'installation depuis cache:", error);
                    toast({
                        title: "Erreur d'installation",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                }
            }
        },
        [toast, paths, CheckTranslationsState, translationsSelected, cachedVersions, customSourceByUrl, defaultLanguage, isAdmin, markVersionAsReady, recordTranslationInstall],
    );

    const handleUpdateTranslation = useCallback(
        async (
            versionPath: string,
            translationLink: string,
            buttonId: string,
        ) => {
            dispatch({ type: 'SET_LOADING_BUTTON', id: `update-${buttonId}` });
            const versionSettings = translationsSelected?.[buttonId as keyof TranslationsChoosen];
            const selectedLanguage = versionSettings?.lang
                || (versionSettings?.link ? customSourceByUrl[versionSettings.link]?.language : undefined)
                || defaultLanguage;
            const isCustomVersionSource = Boolean(versionSettings?.link && customSourceByUrl[versionSettings.link]);
            if (isProtectedPath(versionPath) && !isAdmin) {
                toast({
                    title: "Chemin protégé",
                    description: "Dossier sous Program Files: relance en admin recommandée (bouclier en bas à droite).",
                    success: "false",
                    duration: 5000,
                });
            }

            // Si c'est une sélection cache (hors-ligne), installer depuis le cache
            if (translationLink.startsWith("cache:")) {
                const cacheSource = translationLink.replace("cache:", "");
                try {
                    logger.log("Mise à jour depuis le cache, source:", cacheSource);
                    const cachedContent = await invoke<string>('get_cached_translation', {
                        gameVersion: buttonId,
                        source: cacheSource,
                    });

                    await invoke("install_translation_from_cache", {
                        path: versionPath,
                        lang: selectedLanguage,
                        cachedContent: cachedContent,
                    });

                    // Nom lisible pour le toast
                    const displayName = cacheSource === "scefra_fr" ? "SCEFRA (Settings FR)"
                        : cacheSource === "scefra_en" ? "SCEFRA (Settings EN)"
                        : cacheSource === "circuspes" ? "Circuspes"
                        : cacheSource;

                    toast({
                        title: "Traduction mise à jour (hors-ligne)",
                        description: `Mise à jour depuis le cache (${displayName}).`,
                        variant: "success",
                        duration: 3000,
                    });
                    if (paths) CheckTranslationsState(paths);
                } catch (error) {
                    logger.error("Erreur mise à jour depuis cache:", error);
                    toast({
                        title: "Erreur de mise à jour",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                } finally {
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                }
                return;
            }

            // Mise à jour en ligne normale
            try {
                await invoke("update_translation", {
                    path: versionPath,
                    translationLink: translationLink,
                    lang: selectedLanguage,
                    gameVersion: buttonId,
                });
                toast({
                    title: "Traduction mise à jour",
                    description: "La traduction a été mise à jour avec succès.",
                    variant: "success",
                    duration: 3000,
                });
                if (isCustomVersionSource) {
                    markVersionAsReady(buttonId);
                } else if (paths) {
                    CheckTranslationsState(paths);
                }
            } catch (error) {
                toast({
                    title: "Erreur de mise à jour",
                    description: `Erreur: ${toFriendlyFsError(error)}`,
                    variant: "destructive",
                    duration: 4000,
                });
            } finally {
                dispatch({ type: 'SET_LOADING_BUTTON', id: null });
            }
        },
        [toast, paths, CheckTranslationsState, isAdmin, translationsSelected, customSourceByUrl, defaultLanguage, markVersionAsReady],
    );

    const handleSettingsToggle = useCallback(
        async (version: string, settingsEN: boolean) => {
            if (!translationsSelected) return;

            try {
                dispatch({ type: 'SET_LOADING_BUTTON', id: `switch-${version}` });

                const currentLink = translationsSelected[version as keyof TranslationsChoosen]?.link;
                const versionPath = paths?.versions[version as keyof GamePaths["versions"]]?.path;
                const versionCaches = cachedVersions[version.toUpperCase()];
                const isOffline = !translations || !translations.fr?.links?.length;

                if (!currentLink) {
                    toast({
                        title: "Traduction non sélectionnée",
                        description: "Veuillez d'abord sélectionner une traduction.",
                        success: "false",
                        duration: 3000,
                    });
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    return;
                }

                let newLink = currentLink;

                // Mode hors-ligne: utiliser le cache
                if (isOffline) {
                    // Vérifier si on a les deux sources SCEFRA en cache
                    const hasScefraFr = versionCaches?.["scefra_fr"];
                    const hasScefraEn = versionCaches?.["scefra_en"];

                    if (settingsEN) {
                        if (hasScefraEn) {
                            newLink = "cache:scefra_en";
                        } else {
                            toast({
                                title: "Cache non disponible",
                                description: "La version Settings EN n'est pas disponible dans le cache.",
                                success: "false",
                                duration: 3000,
                            });
                            dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                            return;
                        }
                    } else {
                        if (hasScefraFr) {
                            newLink = "cache:scefra_fr";
                        } else {
                            toast({
                                title: "Cache non disponible",
                                description: "La version Settings FR n'est pas disponible dans le cache.",
                                success: "false",
                                duration: 3000,
                            });
                            dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                            return;
                        }
                    }

                    logger.log("Mode hors-ligne - Nouveau lien cache:", newLink);

                    const updatedTranslations = {
                        ...translationsSelected,
                        [version]: {
                            ...translationsSelected[version as keyof TranslationsChoosen],
                            link: newLink,
                            settingsEN: settingsEN,
                            lang: defaultLanguage,
                            custom: false,
                        },
                    };

                    dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedTranslations });
                    await saveSelectedTranslations(updatedTranslations);

                    // Appliquer depuis le cache si traduit
                    if (versionPath && paths?.versions[version as keyof GamePaths["versions"]]?.translated && newLink !== currentLink) {
                        const cacheSource = newLink.replace("cache:", "");
                        try {
                            const cachedContent = await invoke<string>('get_cached_translation', {
                                gameVersion: version,
                                source: cacheSource,
                            });
                            await invoke("install_translation_from_cache", {
                                path: versionPath,
                                lang: defaultLanguage,
                                cachedContent: cachedContent,
                            });

                            if (paths) CheckTranslationsState(paths);

                            toast({
                                title: "Paramètres appliqués (hors-ligne)",
                                description: `La traduction a été mise à jour avec les paramètres ${settingsEN ? "EN" : "FR"}.`,
                                variant: "success",
                                duration: 3000,
                            });
                        } catch (error) {
                            logger.error("Erreur application cache:", error);
                            toast({
                                title: "Erreur",
                                description: `Erreur: ${toFriendlyFsError(error)}`,
                                variant: "destructive",
                                duration: 4000,
                            });
                        }
                    }

                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    return;
                }

                // Mode en ligne: chercher dans la liste des traductions
                const currentTranslation = translations.fr.links.find((link: Link) => link.url === currentLink);
                if (!currentTranslation) {
                    toast({
                        title: "Traduction introuvable",
                        description: "Impossible de trouver la traduction correspondante.",
                        success: "false",
                        duration: 3000,
                    });
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                    return;
                }

                // Chercher la version avec le setting opposé
                const currentName = currentTranslation.name;

                if (settingsEN) {
                    // Chercher la version Settings EN correspondante
                    const baseName = currentName.replace(/\(Settings FR\)/i, "").replace(/\(Settings EN\)/i, "").trim();
                    const enVersion = translations.fr.links.find((link: Link) =>
                        link.name.includes(baseName) && (link.name.includes("Settings EN") || link.name.includes("EN"))
                    );
                    if (enVersion) {
                        newLink = enVersion.url;
                    } else {
                        // Fallback : chercher n'importe quelle version EN
                        const anyEnVersion = translations.fr.links.find((link: Link) =>
                            link.name.includes("Settings EN") || (link.name.includes("EN") && !link.name.includes("FR"))
                        );
                        if (anyEnVersion) {
                            newLink = anyEnVersion.url;
                        }
                    }
                } else {
                    // Chercher la version Settings FR correspondante
                    const baseName = currentName.replace(/\(Settings FR\)/i, "").replace(/\(Settings EN\)/i, "").trim();
                    const frVersion = translations.fr.links.find((link: Link) =>
                        link.name.includes(baseName) && (link.name.includes("Settings FR") || (link.name.includes("FR") && !link.name.includes("EN")))
                    );
                    if (frVersion) {
                        newLink = frVersion.url;
                    } else {
                        // Fallback : chercher n'importe quelle version FR
                        const anyFrVersion = translations.fr.links.find((link: Link) =>
                            link.name.includes("Settings FR") || (link.name.includes("FR") && !link.name.includes("EN"))
                        );
                        if (anyFrVersion) {
                            newLink = anyFrVersion.url;
                        }
                    }
                }

                logger.log("Nouveau lien sélectionné:", newLink);

                const updatedTranslations = {
                    ...translationsSelected,
                    [version]: {
                        ...translationsSelected[version as keyof TranslationsChoosen],
                        link: newLink,
                        settingsEN: settingsEN,
                        lang: defaultLanguage,
                        custom: false,
                    },
                };

                dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedTranslations });
                await saveSelectedTranslations(updatedTranslations);

                if (versionPath && paths?.versions[version as keyof GamePaths["versions"]]?.translated && newLink !== currentLink) {
                    // Appliquer automatiquement la nouvelle traduction
                    dispatch({ type: 'SET_LOADING_BUTTON', id: `update-${version}` });
                    try {
                        await invoke("update_translation", {
                            path: versionPath,
                            translationLink: newLink,
                            lang: defaultLanguage,
                            gameVersion: version,
                        });

                        // Mettre à jour le statut
                        if (paths) {
                            const updatedPaths = { ...paths };
                            const currentVersion = updatedPaths.versions[version as keyof GamePaths["versions"]];
                            if (currentVersion) {
                                updatedPaths.versions[version as keyof GamePaths["versions"]] = {
                                    ...currentVersion,
                                    translated: true,
                                    up_to_date: true
                                };
                                dispatch({ type: 'SET_PATHS', paths: updatedPaths });
                            }
                        }

                        toast({
                            title: "Paramètres appliqués",
                            description: `La traduction a été mise à jour avec les paramètres ${settingsEN ? "EN" : "FR"}.`,
                            variant: "success",
                            duration: 3000,
                        });
                        } catch (error) {
                            toast({
                                title: "Erreur de mise à jour",
                                description: `Erreur: ${toFriendlyFsError(error)}`,
                                variant: "destructive",
                                duration: 4000,
                            });
                        }
                }

                dispatch({ type: 'SET_LOADING_BUTTON', id: null });
            } catch (error) {
                logger.error("Erreur lors du changement de paramètres:", error);
                toast({
                    title: "Erreur de configuration",
                    description: `Une erreur est survenue: ${error}`,
                    success: "false",
                    duration: 3000,
                });
                dispatch({ type: 'SET_LOADING_BUTTON', id: null });
            }
        },
        [translationsSelected, translations, paths, saveSelectedTranslations, toast, defaultLanguage, cachedVersions, CheckTranslationsState],
    );

    useEffect(() => {
        const checkState = async () => {
            if (!paths) return;
            await CheckTranslationsState(paths);
            setEarlyChecked(true);
        };

        if (!earlyChecked) checkState();

        const interval = setInterval(() => {
            if (paths) {
                CheckTranslationsState(paths);
            }
        }, 60000);

        return () => clearInterval(interval);
    }, [paths]);

    // Récupérer les dates de dernière mise à jour pour toutes les traductions
    useEffect(() => {
        const fetchLastUpdatedDates = async () => {
            if (!translations?.fr?.links) return;

            const dates: Record<string, string | null> = {};
            await Promise.all(
                translations.fr.links.map(async (link: Link) => {
                    try {
                        const date = await invoke<string | null>("get_translation_last_updated", { url: link.url });
                        dates[link.url] = date;
                    } catch {
                        dates[link.url] = null;
                    }
                })
            );
            setLastUpdatedDates(dates);
        };

        fetchLastUpdatedDates();
    }, [translations]);

    useEffect(() => {
        if (translationsSelected && paths) {
            CheckTranslationsState(paths);
        }
    }, [translationsSelected]);

    // Écouter les events du service de fond pour le feedback
    useEffect(() => {
        const setupListeners = async () => {
            const [unlistenStart, unlistenDone, unlistenError] = await Promise.all([
                // Event quand le service commence une mise à jour
                listen<string>("translation-update-start", (event) => {
                    const version = event.payload;
                    logger.log(`[Background Service] Mise à jour en cours pour ${version}`);
                    dispatch({ type: 'SET_LOADING_BUTTON', id: `update-${version}` });
                }),

                // Event quand le service termine une mise à jour
                listen<string>("translation-update-done", (event) => {
                    const version = event.payload;
                    logger.log(`[Background Service] Mise à jour terminée pour ${version}`);
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });

                    // Mettre à jour immédiatement le statut
                    if (paths) {
                        const updatedPaths = { ...paths };
                        const currentVersion = updatedPaths.versions[version as keyof GamePaths["versions"]];
                        if (currentVersion) {
                            updatedPaths.versions[version as keyof GamePaths["versions"]] = {
                                ...currentVersion,
                                translated: true,
                                up_to_date: true
                            };
                            dispatch({ type: 'SET_PATHS', paths: updatedPaths });
                        }
                    }

                    toast({
                        title: "Traduction mise à jour",
                        description: `La traduction ${version} a été mise à jour automatiquement.`,
                        variant: "success",
                        duration: 3000,
                    });
                }),

                // Event en cas d'erreur
                listen<string>("translation-update-error", (event) => {
                    const version = event.payload;
                    logger.error(`[Background Service] Erreur de mise à jour pour ${version}`);
                    dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                }),
            ]);

            return () => {
                unlistenStart();
                unlistenDone();
                unlistenError();
            };
        };

        const cleanup = setupListeners();
        return () => {
            cleanup.then(fn => fn());
        };
    }, [translationsSelected]);


    const handleUninstallTranslation = useCallback(
        async (versionPath: string) => {
            try {
                await invoke("uninstall_translation", { path: versionPath });
                toast({
                    title: "Traduction désinstallée",
                    description: "La traduction a été désinstallée avec succès.",
                    variant: "success",
                    duration: 3000,
                });
                if (paths) CheckTranslationsState(paths);
            } catch (error) {
                toast({
                    title: "Erreur de désinstallation",
                    description: `Erreur: ${toFriendlyFsError(error)}`,
                    success: "false",
                    duration: 4000,
                });
            }
        },
        [toast, paths, CheckTranslationsState],
    );

    const renderCard = useMemo(() => {
        if (!paths || !translationsSelected) return null;

        return Object.entries(paths.versions).map(([key, value], index) => (
            <m.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + index * 0.1 }}
            >
                <Card className="group relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] transition-all duration-200 hover:border-primary/25 hover:bg-[hsl(var(--background)/0.18)]">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                    <CardHeader className="relative space-y-2 pb-1.5 pt-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <CardTitle className="flex flex-wrap items-center gap-2 text-base tracking-tight">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Globe2 className="h-5 w-5 text-primary" />
                                        {key}
                                    </span>
                                    {(value.release_version || value.game_version) && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Badge variant="outline" className="h-5 rounded-md border-cyan-500/25 bg-cyan-500/10 px-1.5 text-[10px] font-medium text-cyan-500">
                                                    {value.release_version || value.game_version}
                                                </Badge>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className="space-y-1 text-xs">
                                                    {value.release_version && <p>Version launcher : {value.release_version}</p>}
                                                    {value.game_version && <p>Version : {value.game_version}</p>}
                                                    {value.build_number && <p>Build P4 : {value.build_number}</p>}
                                                    {value.branch && <p>Branche : {value.branch}</p>}
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                </CardTitle>
                                {translationsSelected[key as keyof TranslationsChoosen]?.link &&
                                 lastUpdatedDates[translationsSelected[key as keyof TranslationsChoosen]!.link!] && (
                                    <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-background/30 px-2 text-[11px] text-muted-foreground">
                                        Dernière MAJ : {formatRelativeDate(lastUpdatedDates[translationsSelected[key as keyof TranslationsChoosen]!.link!])}
                                    </span>
                                )}
                            </div>
                            {loadingButtonId === `update-${key}` ? (
                                <Badge variant="default" className="h-6 gap-1 rounded-md border border-blue-500/30 bg-blue-500/20 text-[11px] text-blue-600 dark:text-blue-400">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Mise à jour...
                                </Badge>
                            ) : value.up_to_date ? (
                                <Badge variant="default" className="h-6 gap-1 rounded-md border border-green-500/30 bg-green-500/20 text-[11px] text-green-600 dark:text-green-400">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    À jour
                                </Badge>
                            ) : value.translated ? (
                                <Badge variant="default" className="h-6 gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/20 text-[11px] text-yellow-600 dark:text-yellow-400">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    Mise à jour dispo
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="h-6 gap-1 rounded-md border-border/60 bg-background/30 text-[11px]">
                                    <XCircle className="h-3.5 w-3.5" />
                                    Non installé
                                </Badge>
                            )}
                            {cachedVersions[key.toUpperCase()] && Object.keys(cachedVersions[key.toUpperCase()]).length > 0 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge variant="secondary" className="h-6 gap-1 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 text-[11px] text-blue-500">
                                            <WifiOff className="h-3 w-3" />
                                            {Object.keys(cachedVersions[key.toUpperCase()]).length} en cache
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[220px] p-3">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <WifiOff className="h-3 w-3 text-blue-400 shrink-0" />
                                            <span className="text-[12px] font-semibold text-zinc-100">Disponible hors-ligne</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {Object.entries(cachedVersions[key.toUpperCase()]).map(([source, info]) => (
                                                <div key={source} className="flex items-center justify-between gap-3">
                                                    <span className="text-[11px] text-zinc-200/90 truncate">{source}</span>
                                                    <span className="flex items-center gap-1 shrink-0 text-[10px] text-zinc-400">
                                                        <Clock className="h-2.5 w-2.5" />
                                                        {formatRelativeDate(info.cached_at)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground/90 cursor-help">
                                    <FolderOpen className="h-3.5 w-3.5 shrink-0" /> {value.path}
                                </p>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">{value.path}</p>
                            </TooltipContent>
                        </Tooltip>
                    </CardHeader>
                    
                    <CardContent className="relative space-y-3 border-t border-border/30 pt-3">
                        {/* Sélection de traduction */}
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 text-[13px] font-medium">
                                <Languages className="h-4 w-4 text-primary/90" />
                                Source de traduction
                                {/* Indicateur mode hors-ligne */}
                                {(!translations || !translations.fr?.links?.length) && cachedVersions[key.toUpperCase()] && (
                                    <Badge variant="outline" className="h-5 gap-1 border-orange-500/20 bg-orange-500/10 text-[10px] text-orange-600">
                                        <WifiOff className="h-3 w-3" />
                                        Mode hors-ligne
                                    </Badge>
                                )}
                            </label>
                            {/* Sélecteur en ligne (prioritaire) */}
                            {availableTranslationLinks.length > 0 ? (
                                <Select
                                    value={translationsSelected[key as keyof TranslationsChoosen]?.link || ""}
                                    onValueChange={(val) => handleTranslationSelect(key, val)}
                                    disabled={loadingButtonId !== null}
                                >
                                    <SelectTrigger className="h-10 w-full rounded-lg border-border/60 bg-background/40">
                                        <SelectValue placeholder="Choisir une traduction" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableTranslationLinks.map((link: Link) => (
                                            <SelectItem key={link.id} value={link.url}>
                                                <div className="flex items-center justify-between w-full gap-2">
                                                    <span>{link.name}</span>
                                                    {customSourceByUrl[link.url] && (
                                                        <span className="text-xs text-primary">
                                                            {getCustomLanguageLabel(customSourceByUrl[link.url].language)}
                                                        </span>
                                                    )}
                                                    {!customSourceByUrl[link.url] && lastUpdatedDates[link.url] && (
                                                        <span className="text-xs text-muted-foreground">
                                                            • {formatRelativeDate(lastUpdatedDates[link.url])}
                                                        </span>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : cachedVersions[key.toUpperCase()] && Object.keys(cachedVersions[key.toUpperCase()]).length > 0 ? (
                                /* Sélecteur hors-ligne basé sur le cache */
                                (() => {
                                    // Déterminer la valeur à afficher dans le sélecteur
                                    const savedLink = translationsSelected[key as keyof TranslationsChoosen]?.link;
                                    let selectValue: string = `cache:${Object.keys(cachedVersions[key.toUpperCase()])[0]}`;

                                    // Si le lien sauvegardé est une vraie URL (pas cache:), mapper vers la source cache correspondante
                                    if (savedLink && !savedLink.startsWith("cache:")) {
                                        const matchingSource = Object.entries(cachedVersions[key.toUpperCase()]).find(
                                            ([, info]) => info.original_url === savedLink
                                        );
                                        if (matchingSource) {
                                            selectValue = `cache:${matchingSource[0]}`;
                                        }
                                        // Sinon garde la valeur par défaut (premier cache)
                                    } else if (savedLink) {
                                        // C'est déjà un lien cache:
                                        selectValue = savedLink;
                                    }

                                    return (
                                <Select
                                    value={selectValue}
                                    onValueChange={async (val) => {
                                        // Stocker la source cache sélectionnée
                                        const updatedTranslations: TranslationsChoosen = {
                                            ...translationsSelected,
                                            [key]: {
                                                link: val,
                                                settingsEN: translationsSelected[key as keyof TranslationsChoosen]?.settingsEN ?? false,
                                                lang: defaultLanguage,
                                                custom: false,
                                            },
                                        };
                                        dispatch({ type: 'SET_TRANSLATIONS_SELECTED', selected: updatedTranslations });
                                        await saveSelectedTranslations(updatedTranslations);

                                        // Si la traduction est déjà installée, mettre à jour automatiquement
                                        const versionData = paths?.versions[key as keyof GamePaths["versions"]];
                                        if (versionData?.translated && val !== selectValue) {
                                            const cacheSource = val.replace("cache:", "");
                                            dispatch({ type: 'SET_LOADING_BUTTON', id: `update-${key}` });
                                            try {
                                                const cachedContent = await invoke<string>('get_cached_translation', {
                                                    gameVersion: key,
                                                    source: cacheSource,
                                                });
                                                await invoke("install_translation_from_cache", {
                                                    path: versionData.path,
                                                    lang: defaultLanguage,
                                                    cachedContent: cachedContent,
                                                });
                                                const displayName = cacheSource === "scefra_fr" ? "SCEFRA (Settings FR)"
                                                    : cacheSource === "scefra_en" ? "SCEFRA (Settings EN)"
                                                    : cacheSource === "circuspes" ? "Circuspes"
                                                    : cacheSource;
                                                toast({
                                                    title: "Traduction mise à jour (hors-ligne)",
                                                    description: `Mise à jour vers ${displayName}.`,
                                                    variant: "success",
                                                    duration: 3000,
                                                });
                                                if (paths) CheckTranslationsState(paths);
                                            } catch (error) {
                                                logger.error("Erreur mise à jour cache:", error);
                                                toast({
                                                    title: "Erreur de mise à jour",
                                                    description: `Erreur: ${toFriendlyFsError(error)}`,
                                                    variant: "destructive",
                                                    duration: 4000,
                                                });
                                            } finally {
                                                dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                                            }
                                        }
                                    }}
                                    disabled={loadingButtonId !== null}
                                >
                                    <SelectTrigger className="h-10 w-full rounded-lg border-border/60 bg-background/40">
                                        <SelectValue placeholder="Choisir depuis le cache" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(cachedVersions[key.toUpperCase()]).map(([source, info]) => {
                                            // Mapper les noms de source vers des noms lisibles
                                            const displayName = source === "scefra_fr" ? "SCEFRA (Settings FR)"
                                                : source === "scefra_en" ? "SCEFRA (Settings EN)"
                                                : source === "circuspes" ? "Circuspes"
                                                : source;
                                            return (
                                                <SelectItem key={source} value={`cache:${source}`}>
                                                    <div className="flex items-center justify-between w-full gap-2">
                                                        <span>{displayName}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            • Caché {formatRelativeDate(info.cached_at)}
                                                        </span>
                                                    </div>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                    );
                                })()
                            ) : (
                                <p className="text-xs text-muted-foreground italic">
                                    Aucune traduction disponible (connectez-vous ou activez le cache)
                                </p>
                            )}
                        </div>

                        {/* Toggle paramètres FR/EN */}
                        <div className="flex items-center justify-between rounded-lg bg-[hsl(var(--background)/0.20)] px-2.5 py-2">
                            <div className="flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-muted-foreground" />
                                <span className="text-[13px] font-medium">Langue des paramètres</span>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Langue des menus et paramètres du jeu</p>
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-xs ${!translationsSelected[key as keyof TranslationsChoosen]?.settingsEN ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                                    FR
                                </span>
                                {loadingButtonId === `switch-${key}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Switch
                                        checked={translationsSelected[key as keyof TranslationsChoosen]?.settingsEN === true}
                                        onCheckedChange={(checked) => handleSettingsToggle(key, checked)}
                                        disabled={
                                            loadingButtonId !== null ||
                                            !translationsSelected[key as keyof TranslationsChoosen]?.link ||
                                            Boolean(customSourceByUrl[translationsSelected[key as keyof TranslationsChoosen]?.link || ""])
                                        }
                                    />
                                )}
                                <span className={`text-xs ${translationsSelected[key as keyof TranslationsChoosen]?.settingsEN ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                                    EN
                                </span>
                            </div>
                        </div>

                        {/* Boutons d'action */}
                        <div className="flex flex-wrap gap-2 pt-1">
                            {!value.translated && (
                                <Button
                                    className="h-9 rounded-lg px-4"
                                    disabled={loadingButtonId === `install-${key}`}
                                    onClick={() => handleInstallTranslation(value.path, key)}
                                >
                                    {loadingButtonId === `install-${key}` ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Installation...
                                        </>
                                    ) : (
                                        "Installer la traduction"
                                    )}
                                </Button>
                            )}
                            {value.translated && !value.up_to_date && translationsSelected[key as keyof TranslationsChoosen]?.link && (
                                <Button
                                    variant="secondary"
                                    className="h-9 rounded-lg border border-border/50 bg-[hsl(var(--background)/0.26)] px-4"
                                    disabled={loadingButtonId === `update-${key}`}
                                    onClick={() =>
                                        handleUpdateTranslation(
                                            value.path,
                                            translationsSelected[key as keyof TranslationsChoosen]!.link!,
                                            key
                                        )
                                    }
                                >
                                    {loadingButtonId === `update-${key}` ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Mise à jour...
                                        </>
                                    ) : (
                                        "Mettre à jour"
                                    )}
                                </Button>
                            )}
                            {value.translated && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-9 rounded-lg px-4"
                                    disabled={loadingButtonId === `uninstall-${key}`}
                                    onClick={async () => {
                                        dispatch({ type: 'SET_LOADING_BUTTON', id: `uninstall-${key}` });
                                        try {
                                            await handleUninstallTranslation(value.path);
                                        } finally {
                                            dispatch({ type: 'SET_LOADING_BUTTON', id: null });
                                        }
                                    }}
                                >
                                    {loadingButtonId === `uninstall-${key}` ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        "Désinstaller"
                                    )}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </m.div>
        ));
    }, [
        paths,
        translationsSelected,
        translations,
        availableTranslationLinks,
        customSourceByUrl,
        loadingButtonId,
        lastUpdatedDates,
        handleSettingsToggle,
        handleInstallTranslation,
        handleUpdateTranslation,
        handleUninstallTranslation,
        handleTranslationSelect
    ]);

    const versionEntries = paths ? Object.entries(paths.versions) : [];
    const totalVersions = versionEntries.length;

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <Dialog open={customSourceDialogOpen} onOpenChange={setCustomSourceDialogOpen}>
                <DialogContent className="max-h-[86vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-hidden p-0">
                    <DialogHeader className="border-b border-border/25 px-5 pb-4 pt-5">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                                <Link2 className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                                <DialogTitle>Source de traduction personnalisÃ©e</DialogTitle>
                                <DialogDescription className="mt-1">
                                    Ajoute un lien direct vers un fichier global.ini. Les sources officielles restent intactes.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs leading-relaxed text-muted-foreground">
                            Le lien doit pointer vers un fichier <span className="font-semibold text-foreground">global.ini</span>.
                            Une fois sÃ©lectionnÃ© dans une version, il utilise les mÃªmes boutons installer / mettre Ã  jour et le mÃªme service de mise Ã  jour automatique.
                        </div>

                        <div className="grid min-w-0 gap-3 lg:grid-cols-[0.75fr_0.85fr_1.4fr]">
                            <div className="min-w-0 space-y-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Nom affichÃ©
                                </label>
                                <Input
                                    value={customSourceName}
                                    onChange={(event) => setCustomSourceName(event.target.value)}
                                    placeholder="Ex: Projet perso"
                                    className="h-10 rounded-lg border-border/60 bg-background/40"
                                />
                            </div>
                            <div className="min-w-0 space-y-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Langue cible
                                </label>
                                <Select value={customSourceLanguage} onValueChange={setCustomSourceLanguage}>
                                    <SelectTrigger className="h-10 w-full rounded-lg border-border/60 bg-background/40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CUSTOM_TRANSLATION_LANGUAGES.map((language) => (
                                            <SelectItem key={language.value} value={language.value}>
                                                {language.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="min-w-0 space-y-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Lien global.ini
                                </label>
                                <Input
                                    value={customSourceUrl}
                                    onChange={(event) => setCustomSourceUrl(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            addCustomTranslationSource();
                                        }
                                    }}
                                    placeholder="https://.../global.ini"
                                    className="h-10 rounded-lg border-border/60 bg-background/40"
                                />
                            </div>
                        </div>

                        <div className="min-w-0 space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Sources personnalisÃ©es
                            </p>
                            {customTranslationSources.length > 0 ? (
                                <div className="max-h-52 min-w-0 space-y-2 overflow-y-auto pr-1">
                                    {customTranslationSources.map((source) => (
                                        <div key={source.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/35 bg-background/25 p-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold">{source.name}</p>
                                                <p className="text-xs font-medium text-primary/90">{getCustomLanguageLabel(source.language)}</p>
                                                <p className="min-w-0 truncate break-all text-xs text-muted-foreground">{source.url}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8 w-full shrink-0 gap-1 rounded-lg border-red-500/20 bg-red-500/10 px-2 text-[11px] text-red-500 hover:bg-red-500/15 sm:w-auto"
                                                onClick={() => removeCustomTranslationSource(source.id)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Retirer
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-border/45 bg-background/15 p-4 text-sm text-muted-foreground">
                                    Aucune source perso pour le moment.
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="gap-2 border-t border-border/25 bg-background/20 px-5 py-4 sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 w-full rounded-lg sm:w-auto"
                            onClick={() => setCustomSourceDialogOpen(false)}
                        >
                            Fermer
                        </Button>
                        <Button
                            type="button"
                            className="h-9 w-full gap-2 rounded-lg sm:w-auto"
                            onClick={addCustomTranslationSource}
                        >
                            <Plus className="h-4 w-4" />
                            Ajouter la source
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {paths && totalVersions > 0 ? (
                <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                    {/* Header */}
                    <section className="relative px-1 pt-1.5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                                    <Languages className="h-4 w-4 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Traduction Française</h1>
                                        <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                            {totalVersions} version{totalVersions > 1 ? "s" : ""}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground/90">Installez et gérez la traduction de Star Citizen</p>
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1.5 rounded-md border-primary/25 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/15"
                                    onClick={() => setCustomSourceDialogOpen(true)}
                                >
                                    <Link2 className="h-3.5 w-3.5" />
                                    Source perso
                                </Button>
                                {translations?.fr?.links?.length ? (
                                    <Badge variant="outline" className="h-6 rounded-md border-emerald-500/25 bg-emerald-500/10 px-2 text-[11px] text-emerald-500">
                                        Serveurs actifs
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="h-6 gap-1 rounded-md border-orange-500/25 bg-orange-500/10 px-2 text-[11px] text-orange-500">
                                        <WifiOff className="h-3 w-3" />
                                        Hors-ligne
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" />
                    </section>
                    {/* Info box */}
                    <Card className="overflow-hidden rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardContent className="space-y-2 p-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sources disponibles</p>
                            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                                <div className="rounded-lg border border-border/30 bg-background/20 p-2.5">
                                    <p className="text-sm font-semibold tracking-tight text-primary">SCEFRA</p>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        Traduction assistée par IA et corrigée par les retours de la communauté. Mises à jour très fréquentes.
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/30 bg-background/20 p-2.5">
                                    <p className="text-sm font-semibold tracking-tight text-primary">Circuspes</p>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        Traduction par des équipes de traducteurs et relecteurs (communauté Hugo Lisoir). Mises à jour moins fréquentes.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Version cards */}
                    <div className={totalVersions > 1 ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "mx-auto grid w-full max-w-[860px] grid-cols-1 gap-3"}>
                        {renderCard}
                    </div>
                </div>
            ) : (
                <div className="flex h-full w-full items-center justify-center p-4">
                    <section className="w-full max-w-xl rounded-2xl border border-border/60 bg-[hsl(var(--background)/0.28)] p-7 text-center shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border/55 bg-background/45">
                        <Globe2 className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-1.5">
                        <h2 className="text-xl font-bold tracking-tight">Aucune version détectée</h2>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                            <kbd className="mx-2 rounded border border-border/55 bg-background/60 px-2 py-1 text-xs">CTRL + R</kbd>
                        </p>
                    </div>
                    </section>
                </div>
            )}
        </m.div>
    );
}
