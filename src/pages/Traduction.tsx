import { motion } from "framer-motion";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import logger from "@/utils/logger";
import { Loader2, XCircle, CheckCircle, AlertCircle, HelpCircle, Globe2, Languages, Settings2, WifiOff } from "lucide-react";
import { useStatsStore } from "@/stores/stats-store";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function Traduction() {
    const [paths, setPaths] = useState<GamePaths | null>();
    const [earlyChecked, setEarlyChecked] = useState<boolean>(false);
    const [translationsSelected, setTranslationsSelected] = useState<TranslationsChoosen | null>(null);
    const [translations, setTranslations] = useState<LocalizationConfig | null>(null);
    const [loadingButtonId, setLoadingButtonId] = useState<string | null>(null);
    const [dataFetched, setDataFetched] = useState<boolean>(false);
    const [isAdmin, setIsAdmin] = useState<boolean>(true); // Supposer admin par défaut pour éviter flash de toast
    const [lastUpdatedDates, setLastUpdatedDates] = useState<Record<string, string | null>>({});
    const [cachedVersions, setCachedVersions] = useState<Record<string, Record<string, { cached_at: string; original_url: string }>>>({});

    const defaultLanguage = "fr";

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

    const isProtectedPath = (p: string) => /:\\Program Files( \(x86\))?\\/i.test(p);
    const toFriendlyFsError = (err: unknown) => {
        const msg = String(err ?? "");
        if (/Accès refusé|Access is denied|os error 5|Permission denied/i.test(msg)) {
            return "Accès refusé. Essayez de lancer l'application en tant qu'administrateur ou installez le jeu en dehors de 'Program Files'.";
        }
        return msg;
    };

    const getDefaultTranslationsState = (): TranslationsChoosen => {
        if (!paths) return {};

        const defaults: TranslationsChoosen = {};

        Object.keys(paths.versions).forEach(version => {
            defaults[version] = { link: null, settingsEN: false };
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
                    setPaths(versions);
                }

                logger.log("Récupération des traductions...");
                const translationsData = await invoke("get_translations");
                logger.log("Données de traduction reçues:", translationsData);
                
                if (isLocalizationConfig(translationsData)) {
                    setTranslations(translationsData);
                }

                const savedPrefs: TranslationsChoosen = await invoke("load_translations_selected");
                if (savedPrefs && typeof savedPrefs === "object") {
                    logger.log("Préférences de traduction chargées:", savedPrefs);
                    setTranslationsSelected(savedPrefs);
                } else {
                    logger.log("Initialisation avec les préférences par défaut");
                    setTranslationsSelected(getDefaultTranslationsState());
                }

                return true;
            } catch (error) {
                console.error("Erreur lors du chargement des données:", error);
                setTranslationsSelected(getDefaultTranslationsState());
                return false;
            }
        };

        const checkAdminStatus = async () => {
            try {
                const adminStatus = await invoke<boolean>("is_running_as_admin");
                setIsAdmin(adminStatus);
            } catch (error) {
                console.error("Erreur lors de la vérification du statut admin:", error);
                setIsAdmin(false);
            }
        };

        if (!dataFetched) {
            setDataFetched(true);
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
                    setTranslations(translationsData);
                    logger.log("[Connectivité] Traductions rafraîchies avec succès");
                }
            } catch (error) {
                logger.error("[Connectivité] Erreur rafraîchissement:", error);
            }
        };

        const handleOffline = () => {
            logger.log("[Connectivité] Connexion perdue, passage en mode hors-ligne");
            // Forcer un re-render en mettant translations à null
            setTranslations(null);
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

    const CheckTranslationsState = useCallback(
        async (paths: GamePaths) => {
            if (!translationsSelected) return;

            const updatedPaths = { ...paths };
            await Promise.all(
                Object.entries(paths.versions).map(async ([key, value]) => {
                    const versionSettings = translationsSelected[key as keyof TranslationsChoosen];

                    const translated: boolean = await invoke(
                        "is_game_translated",
                        {
                            path: value.path,
                            lang: defaultLanguage,
                        },
                    );

                    // Appliquer le branding automatiquement si la traduction est installée
                    if (translated) {
                        try {
                            await invoke("apply_branding_to_local_file", {
                                path: value.path,
                                lang: defaultLanguage,
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
                            : await invoke("is_translation_up_to_date", {
                                path: value.path,
                                translationLink: versionSettings.link,
                                lang: defaultLanguage,
                            })
                        : value.up_to_date;

                    const versionInfo = {
                        path: value.path,
                        translated: translated,
                        up_to_date: upToDate,
                    };

                    updatedPaths.versions[key as keyof GamePaths["versions"]] = versionInfo;
                }),
            );

            setPaths(updatedPaths);
            setLoadingButtonId(null);
        },
        [translationsSelected, defaultLanguage],
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
                    };
                    needsUpdate = true;
                }
            }
        });

        if (needsUpdate) {
            hasConvertedToOnline.current = true;
            setTranslationsSelected(updatedPrefs);
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
    }, [translations, translationsSelected, paths, CheckTranslationsState, toast]);

    const handleTranslationSelect = useCallback(
        async (version: string, linkUrl: string) => {
            if (!translationsSelected || !paths) return;

            const currentSetting = translationsSelected[version as keyof TranslationsChoosen];
            const versionData = paths.versions[version as keyof GamePaths["versions"]];
            const previousLink = currentSetting?.link;

            const updatedTranslations: TranslationsChoosen = {
                ...translationsSelected,
                [version]: {
                    link: linkUrl,
                    settingsEN: currentSetting?.settingsEN ?? false,
                },
            };

            setTranslationsSelected(updatedTranslations);
            await saveSelectedTranslations(updatedTranslations);

            // Si une traduction est déjà installée ET qu'on change de source, on met à jour automatiquement
            if (versionData?.translated && previousLink && previousLink !== linkUrl) {
                setLoadingButtonId(`update-${version}`);
                try {
                    await invoke("update_translation", {
                        path: versionData.path,
                        translationLink: linkUrl,
                        lang: defaultLanguage,
                        gameVersion: version,
                    });
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
                        setPaths(updatedPaths);
                    }
                } catch (error) {
                    toast({
                        title: "Erreur de mise à jour",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                } finally {
                    setLoadingButtonId(null);
                }
            }
        },
        [translationsSelected, saveSelectedTranslations, paths, toast, CheckTranslationsState, defaultLanguage],
    );

    const handleInstallTranslation = useCallback(
        async (versionPath: string, version: string) => {
            logger.log("Installation de la traduction pour la version:", version);
            if (!translationsSelected) return;

            setLoadingButtonId(`install-${version}`);
            if (isProtectedPath(versionPath) && !isAdmin) {
                toast({
                    title: "Chemin protégé",
                    description: "Dossier sous Program Files: relance en admin recommandée (bouclier en bas à droite).",
                    success: "false",
                    duration: 5000,
                });
            }

            const versionSettings = translationsSelected[version as keyof TranslationsChoosen];
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
                setLoadingButtonId(null);
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
                        lang: defaultLanguage,
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
                    setLoadingButtonId(null);
                    return;
                } catch (error) {
                    logger.error("Erreur d'installation depuis cache:", error);
                    toast({
                        title: "Erreur d'installation",
                        description: `Erreur: ${toFriendlyFsError(error)}`,
                        variant: "destructive",
                        duration: 4000,
                    });
                    setLoadingButtonId(null);
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
                        lang: defaultLanguage,
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

                    if (paths) CheckTranslationsState(paths);
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
                                lang: defaultLanguage,
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
                    setLoadingButtonId(null);
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
                        lang: defaultLanguage,
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
                    setLoadingButtonId(null);
                }
            }
        },
        [toast, paths, CheckTranslationsState, translationsSelected, cachedVersions, defaultLanguage, isAdmin, recordTranslationInstall],
    );

    const handleUpdateTranslation = useCallback(
        async (
            versionPath: string,
            translationLink: string,
            buttonId: string,
        ) => {
            setLoadingButtonId(`update-${buttonId}`);
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
                        lang: defaultLanguage,
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
                    setLoadingButtonId(null);
                }
                return;
            }

            // Mise à jour en ligne normale
            try {
                await invoke("update_translation", {
                    path: versionPath,
                    translationLink: translationLink,
                    lang: defaultLanguage,
                    gameVersion: buttonId,
                });
                toast({
                    title: "Traduction mise à jour",
                    description: "La traduction a été mise à jour avec succès.",
                    variant: "success",
                    duration: 3000,
                });
                if (paths) CheckTranslationsState(paths);
            } catch (error) {
                toast({
                    title: "Erreur de mise à jour",
                    description: `Erreur: ${toFriendlyFsError(error)}`,
                    variant: "destructive",
                    duration: 4000,
                });
            } finally {
                setLoadingButtonId(null);
            }
        },
        [toast, paths, CheckTranslationsState, isAdmin, defaultLanguage],
    );

    const handleSettingsToggle = useCallback(
        async (version: string, settingsEN: boolean) => {
            if (!translationsSelected) return;

            try {
                setLoadingButtonId(`switch-${version}`);

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
                    setLoadingButtonId(null);
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
                            setLoadingButtonId(null);
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
                            setLoadingButtonId(null);
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
                        },
                    };

                    setTranslationsSelected(updatedTranslations);
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

                    setLoadingButtonId(null);
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
                    setLoadingButtonId(null);
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
                    },
                };

                setTranslationsSelected(updatedTranslations);
                await saveSelectedTranslations(updatedTranslations);

                if (versionPath && paths?.versions[version as keyof GamePaths["versions"]]?.translated && newLink !== currentLink) {
                    // Appliquer automatiquement la nouvelle traduction
                    setLoadingButtonId(`update-${version}`);
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
                                setPaths(updatedPaths);
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

                setLoadingButtonId(null);
            } catch (error) {
                logger.error("Erreur lors du changement de paramètres:", error);
                toast({
                    title: "Erreur de configuration",
                    description: `Une erreur est survenue: ${error}`,
                    success: "false",
                    duration: 3000,
                });
                setLoadingButtonId(null);
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
            // Event quand le service commence une mise à jour
            const unlistenStart = await listen<string>("translation-update-start", (event) => {
                const version = event.payload;
                logger.log(`[Background Service] Mise à jour en cours pour ${version}`);
                setLoadingButtonId(`update-${version}`);
            });

            // Event quand le service termine une mise à jour
            const unlistenDone = await listen<string>("translation-update-done", (event) => {
                const version = event.payload;
                logger.log(`[Background Service] Mise à jour terminée pour ${version}`);
                setLoadingButtonId(null);

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
                        setPaths(updatedPaths);
                    }
                }

                toast({
                    title: "Traduction mise à jour",
                    description: `La traduction ${version} a été mise à jour automatiquement.`,
                    variant: "success",
                    duration: 3000,
                });
            });

            // Event en cas d'erreur
            const unlistenError = await listen<string>("translation-update-error", (event) => {
                const version = event.payload;
                logger.error(`[Background Service] Erreur de mise à jour pour ${version}`);
                setLoadingButtonId(null);
            });

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
            <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + index * 0.1 }}
            >
                <Card className="bg-background/40 border border-border/50 shadow-sm hover:shadow-md transition-all duration-200">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Globe2 className="h-5 w-5 text-primary" />
                                    {key}
                                </CardTitle>
                                {translationsSelected[key as keyof TranslationsChoosen]?.link &&
                                 lastUpdatedDates[translationsSelected[key as keyof TranslationsChoosen]!.link!] && (
                                    <span className="text-xs text-muted-foreground">
                                        Dernière MAJ : {formatRelativeDate(lastUpdatedDates[translationsSelected[key as keyof TranslationsChoosen]!.link!])}
                                    </span>
                                )}
                            </div>
                            {loadingButtonId === `update-${key}` ? (
                                <Badge variant="default" className="gap-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Mise à jour...
                                </Badge>
                            ) : value.up_to_date ? (
                                <Badge variant="default" className="gap-1 bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    À jour
                                </Badge>
                            ) : value.translated ? (
                                <Badge variant="default" className="gap-1 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    Mise à jour dispo
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="gap-1">
                                    <XCircle className="h-3.5 w-3.5" />
                                    Non installé
                                </Badge>
                            )}
                            {cachedVersions[key.toUpperCase()] && Object.keys(cachedVersions[key.toUpperCase()]).length > 0 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-500 border-blue-500/20">
                                            <WifiOff className="h-3 w-3" />
                                            {Object.keys(cachedVersions[key.toUpperCase()]).length} en cache
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p className="text-sm font-medium">Disponible hors-ligne</p>
                                        <div className="text-xs text-muted-foreground space-y-1 mt-1">
                                            {Object.entries(cachedVersions[key.toUpperCase()]).map(([source, info]) => (
                                                <p key={source}>• {source}: {formatRelativeDate(info.cached_at)}</p>
                                            ))}
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <p className="text-xs text-muted-foreground truncate cursor-help mt-1">
                                    📁 {value.path}
                                </p>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">{value.path}</p>
                            </TooltipContent>
                        </Tooltip>
                    </CardHeader>
                    
                    <CardContent className="space-y-4">
                        {/* Sélection de traduction */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Languages className="h-4 w-4" />
                                Source de traduction
                                {/* Indicateur mode hors-ligne */}
                                {(!translations || !translations.fr?.links?.length) && cachedVersions[key.toUpperCase()] && (
                                    <Badge variant="outline" className="gap-1 text-xs bg-orange-500/10 text-orange-600 border-orange-500/20">
                                        <WifiOff className="h-3 w-3" />
                                        Mode hors-ligne
                                    </Badge>
                                )}
                            </label>
                            {/* Sélecteur en ligne (prioritaire) */}
                            {translations && translations.fr && translations.fr.links && translations.fr.links.length > 0 ? (
                                <Select
                                    value={translationsSelected[key as keyof TranslationsChoosen]?.link || ""}
                                    onValueChange={(val) => handleTranslationSelect(key, val)}
                                    disabled={loadingButtonId !== null}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Choisir une traduction" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {translations.fr.links.map((link: Link) => (
                                            <SelectItem key={link.id} value={link.url}>
                                                <div className="flex items-center justify-between w-full gap-2">
                                                    <span>{link.name}</span>
                                                    {lastUpdatedDates[link.url] && (
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
                                            },
                                        };
                                        setTranslationsSelected(updatedTranslations);
                                        await saveSelectedTranslations(updatedTranslations);

                                        // Si la traduction est déjà installée, mettre à jour automatiquement
                                        const versionData = paths?.versions[key as keyof GamePaths["versions"]];
                                        if (versionData?.translated && val !== selectValue) {
                                            const cacheSource = val.replace("cache:", "");
                                            setLoadingButtonId(`update-${key}`);
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
                                                setLoadingButtonId(null);
                                            }
                                        }
                                    }}
                                    disabled={loadingButtonId !== null}
                                >
                                    <SelectTrigger className="w-full">
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
                                <p className="text-sm text-muted-foreground italic">
                                    Aucune traduction disponible (connectez-vous ou activez le cache)
                                </p>
                            )}
                        </div>

                        {/* Toggle paramètres FR/EN */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                            <div className="flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">Langue des paramètres</span>
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
                                        disabled={loadingButtonId !== null || !translationsSelected[key as keyof TranslationsChoosen]?.link}
                                    />
                                )}
                                <span className={`text-xs ${translationsSelected[key as keyof TranslationsChoosen]?.settingsEN ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                                    EN
                                </span>
                            </div>
                        </div>

                        {/* Boutons d'action */}
                        <div className="flex flex-wrap gap-2 pt-2">
                            {!value.translated && (
                                <Button
                                    className="flex-1"
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
                                    className="flex-1"
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
                                    disabled={loadingButtonId === `uninstall-${key}`}
                                    onClick={async () => {
                                        setLoadingButtonId(`uninstall-${key}`);
                                        try {
                                            await handleUninstallTranslation(value.path);
                                        } finally {
                                            setLoadingButtonId(null);
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
            </motion.div>
        ));
    }, [
        paths,
        translationsSelected,
        translations,
        loadingButtonId,
        lastUpdatedDates,
        handleSettingsToggle,
        handleInstallTranslation,
        handleUpdateTranslation,
        handleUninstallTranslation,
        handleTranslationSelect
    ]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            {paths && Object.entries(paths?.versions)[0] ? (
                <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Languages className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Traduction Française</h1>
                            <p className="text-sm text-muted-foreground">Installez et gérez la traduction de Star Citizen</p>
                        </div>
                    </div>

                    {/* Info box */}
                    <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                        <CardContent className="py-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                🇫🇷 La traduction vous est fournie par la communauté <strong>SCEFRA</strong> et inclut la traduction de circuspes de la communauté de <strong>Hugo Lisoir</strong>.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Version cards */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {renderCard}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center w-full h-full gap-4">
                    <div className="p-4 rounded-full bg-muted">
                        <Globe2 className="h-12 w-12 text-muted-foreground" />
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-2xl font-bold">Aucune version détectée</h2>
                        <p className="text-muted-foreground max-w-md">
                            Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                            <kbd className="mx-2 px-2 py-1 text-xs bg-muted rounded border">CTRL + R</kbd>
                        </p>
                    </div>
                </div>
            )}
        </motion.div>
    );
}