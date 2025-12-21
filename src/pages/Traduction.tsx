import { motion } from "framer-motion";
import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { Loader2, XCircle, CheckCircle, AlertCircle, HelpCircle, Globe2, Languages, Settings2 } from "lucide-react";
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

    const defaultLanguage = "fr";
    const { toast } = useToast();

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

                    const upToDate: boolean = (versionSettings && versionSettings.link)
                        ? await invoke("is_translation_up_to_date", {
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

    const handleTranslationSelect = useCallback(
        async (version: string, linkUrl: string) => {
            if (!translationsSelected) return;
            
            const currentSetting = translationsSelected[version as keyof TranslationsChoosen];
            const updatedTranslations: TranslationsChoosen = {
                ...translationsSelected,
                [version]: {
                    link: linkUrl,
                    settingsEN: currentSetting?.settingsEN ?? false,
                },
            };

            setTranslationsSelected(updatedTranslations);
            await saveSelectedTranslations(updatedTranslations);
        },
        [translationsSelected, saveSelectedTranslations],
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
            if (!versionSettings || !versionSettings.link) {
                        toast({
                    title: "Traduction non sélectionnée",
                    description: "Veuillez sélectionner une traduction dans le menu déroulant avant d'installer.",
                            success: "false",
                            duration: 3000,
                        });
                        setLoadingButtonId(null);
                return;
            } else {
                try {
                    logger.log("Installation avec le lien existant:", versionSettings.link);

                    await invoke("init_translation_files", {
                        path: versionPath,
                        translationLink: versionSettings.link,
                        lang: defaultLanguage,
                    });

                    toast({
                        title: "Traduction installée",
                        description: "La traduction a été installée avec succès.",
                        variant: "success",
                        duration: 3000,
                    });

                    if (paths) CheckTranslationsState(paths);
                } catch (error) {
                    logger.error("Erreur d'installation:", error);
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
        [toast, paths, CheckTranslationsState, translationsSelected, saveSelectedTranslations, defaultLanguage, isAdmin],
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
            try {
                await invoke("update_translation", {
                    path: versionPath,
                    translationLink: translationLink,
                    lang: defaultLanguage,
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
        [toast, paths, CheckTranslationsState, isAdmin],
    );

    const handleSettingsToggle = useCallback(
        async (version: string, settingsEN: boolean) => {
            if (!translationsSelected || !translations) return;

            try {
                setLoadingButtonId(`switch-${version}`);

                // Chercher la traduction correspondante dans la liste
                const currentLink = translationsSelected[version as keyof TranslationsChoosen]?.link;
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

                // Trouver le lien actuel dans la liste
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
                let newLink = currentLink;
                const currentName = currentTranslation.name;
                
                if (settingsEN) {
                    // Chercher la version Settings EN correspondante
                    // Si c'est "SCEFRA (Settings FR)", chercher "SCEFRA (Settings EN)"
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

                    const versionPath = paths?.versions[version as keyof GamePaths["versions"]]?.path;
                    if (versionPath && paths?.versions[version as keyof GamePaths["versions"]]?.translated) {
                        const isUpToDate = await invoke("is_translation_up_to_date", {
                            path: versionPath,
                        translationLink: newLink,
                            lang: defaultLanguage,
                        });

                        if (paths) {
                            const updatedPaths = { ...paths };
                            const currentVersion = updatedPaths.versions[version as keyof GamePaths["versions"]];
                            if (currentVersion) {
                                updatedPaths.versions[version as keyof GamePaths["versions"]] = {
                                    ...currentVersion,
                                    up_to_date: isUpToDate as boolean
                                };
                                setPaths(updatedPaths);
                            }
                        }

                        if (!isUpToDate) {
                            toast({
                                title: "Traduction obsolète",
                                description: "La traduction doit être mise à jour pour correspondre à cette configuration.",
                                success: "false",
                                duration: 5000,
                            });
                        } else {
                            toast({
                                title: "Paramètres modifiés",
                                description: "Vous pouvez mettre à jour la traduction pour appliquer les nouveaux paramètres.",
                                success: "true",
                                duration: 5000,
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
        [translationsSelected, translations, paths, saveSelectedTranslations, toast, defaultLanguage],
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

    useEffect(() => {
        if (translationsSelected && paths) {
            CheckTranslationsState(paths);
        }
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
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Globe2 className="h-5 w-5 text-primary" />
                                {key}
                            </CardTitle>
                            {value.up_to_date ? (
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
                            </label>
                            {translations && translations.fr && translations.fr.links && translations.fr.links.length > 0 && (
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
                                                {link.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
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
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-4">
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