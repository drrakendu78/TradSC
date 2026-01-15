import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./use-toast";
import { getBuildInfo } from "@/utils/buildInfo";
import { compareVersions, getAppVersion } from "@/utils/version";
import openExternal from "@/utils/external";
import logger from "@/utils/logger";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { ToastAction } from "@/components/ui/toast";

interface UpdateInfo {
    version: string;
    notes: string;
    pub_date: string;
    signature?: string;
    downloadUrl?: string;
}

interface UseUpdaterState {
    isChecking: boolean;
    updateAvailable: boolean;
    updateInfo: UpdateInfo | null;
    isDownloading: boolean;
    downloadProgress: number;
    error: string | null;
    isInstalling: boolean;
}

interface UseUpdaterConfig {
    checkOnStartup?: boolean;
    enableAutoUpdater?: boolean;
    githubRepo?: string;
}

const DEFAULT_GITHUB_REPO = "drrakendu78/TradSC";

export function useUpdater(config: UseUpdaterConfig = {}) {
    const {
        checkOnStartup = false,
        enableAutoUpdater = false,
        githubRepo = DEFAULT_GITHUB_REPO,
    } = config;

    const { toast, dismiss: dismissToast } = useToast();

    const [state, setState] = useState<UseUpdaterState>({
        isChecking: false,
        updateAvailable: false,
        updateInfo: null,
        isDownloading: false,
        downloadProgress: 0,
        error: null,
        isInstalling: false,
    });

    const [buildInfo, setBuildInfo] = useState<any>(null);
    const [latestVersion, setLatestVersion] = useState<string | null>(null);
    const [currentVersion, setCurrentVersion] = useState<string>("");
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownRef = useRef<NodeJS.Timeout | null>(null);
    const toastIdRef = useRef<string | null>(null);

    // Charger les infos de build au démarrage
    useEffect(() => {
        // Charger les informations de build
        getBuildInfo()
            .then((info) => {
                setBuildInfo(info);
                setCurrentVersion(info.version || "");
            })
            .catch(logger.error);

        // Récupérer aussi la version directement via l'API Tauri
        getAppVersion()
            .then((version) => {
                setCurrentVersion(version || "");
            })
            .catch((error) => {
                logger.error(
                    "Erreur lors de la récupération de la version:",
                    error
                );
            });
    }, []);

    // Récupérer les préférences utilisateur depuis localStorage
    const getAutoUpdateSetting = useCallback(() => {
        return localStorage.getItem("autoUpdate") !== "false"; // Opt-out par défaut
    }, []);

    const setAutoUpdateSetting = useCallback((enabled: boolean) => {
        localStorage.setItem("autoUpdate", enabled.toString());
    }, []);

    // Obtenir l'URL de la page de release GitHub
    const getGitHubReleaseUrl = useCallback(
        (version?: string) => {
            if (version) {
                return `https://github.com/${githubRepo}/releases/tag/v${version}`;
            }
            return `https://github.com/${githubRepo}/releases/latest`;
        },
        [githubRepo]
    );

    // Déterminer si c'est un build non-signé
    const isUnsignedBuild = useCallback(() => {
        if (!buildInfo) return true; // Par défaut, considérer non-signé
        return !buildInfo.isSigned;
    }, [buildInfo]);

    // Vérifier si les mises à jour sont supportées
    const canUpdate = useCallback(() => {
        if (!buildInfo) return false;
        // Microsoft Store gère ses propres mises à jour
        return (
            buildInfo.distribution !== "microsoft-store" &&
            buildInfo.canAutoUpdate
        );
    }, [buildInfo]);

    // Vérifier les mises à jour
    const checkForUpdates = useCallback(
        async (silent = false) => {
            if (!canUpdate()) {
                if (!silent) {
                    const message =
                        buildInfo?.distribution === "microsoft-store"
                            ? "Les mises à jour sont gérées automatiquement par le Microsoft Store."
                            : "Les mises à jour automatiques ne sont pas supportées pour cette version.";
                    toast({
                        title: "Mises à jour non supportées",
                        description: message,
                        variant: "default",
                    });
                }
                return;
            }

            setState((prev) => ({ ...prev, isChecking: true, error: null }));

            try {
                // Utiliser directement l'API GitHub (plus simple et pratique)
                const res = await fetch(
                    `https://api.github.com/repos/${githubRepo}/releases/latest`,
                    {
                        headers: { Accept: "application/vnd.github+json" },
                    }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                const tag: string = json.tag_name || ""; // ex: v2.1.0
                const remoteVersion = tag.startsWith("v") ? tag.slice(1) : tag;
                setLatestVersion(remoteVersion || null);

                const localVersion: string = buildInfo?.version;
                if (
                    remoteVersion &&
                    localVersion &&
                    compareVersions(remoteVersion, localVersion) === 1
                ) {
                    const notes: string = json.body || "";
                    const pubDate: string =
                        json.published_at || new Date().toISOString();
                    
                    // Trouver l'URL de téléchargement direct depuis les assets
                    // Prioriser le fichier NSIS (setup.exe ou -setup.exe)
                    let downloadUrl: string | undefined;
                    if (json.assets && Array.isArray(json.assets) && json.assets.length > 0) {
                        // 1. Chercher d'abord le fichier NSIS (setup.exe ou -setup.exe)
                        const nsisAsset = json.assets.find((asset: any) => 
                            asset.name && (
                                asset.name.includes('-setup.exe') ||
                                (asset.name.includes('setup') && asset.name.endsWith('.exe'))
                            )
                        );
                        if (nsisAsset && nsisAsset.browser_download_url) {
                            downloadUrl = nsisAsset.browser_download_url;
                        } else {
                            // 2. Si pas de NSIS, chercher un .msi
                        const msiAsset = json.assets.find((asset: any) => 
                            asset.name && asset.name.endsWith('.msi')
                        );
                        if (msiAsset && msiAsset.browser_download_url) {
                            downloadUrl = msiAsset.browser_download_url;
                        } else {
                                // 3. Si pas de .msi, chercher un autre .exe
                            const exeAsset = json.assets.find((asset: any) => 
                                asset.name && asset.name.endsWith('.exe')
                            );
                            if (exeAsset && exeAsset.browser_download_url) {
                                downloadUrl = exeAsset.browser_download_url;
                                } else if (json.assets[0]?.browser_download_url) {
                                    // En dernier recours, prendre le premier asset disponible
                                    downloadUrl = json.assets[0].browser_download_url;
                                }
                            }
                        }
                    }
                    
                    setState((prev) => ({
                        ...prev,
                        updateAvailable: true,
                        updateInfo: {
                            version: remoteVersion,
                            notes,
                            pub_date: pubDate,
                            downloadUrl,
                        },
                    }));

                    // Afficher le toast seulement si ce n'est pas en mode silencieux
                    if (!silent) {
                        toast({
                            title: `Mise à jour disponible: v${remoteVersion}`,
                            description: "Le téléchargement du fichier d'installation va commencer.",
                            variant: "default",
                        });
                    }
                    
                    // Déclencher automatiquement le téléchargement et l'installation (même en mode silencieux)
                    setTimeout(async () => {
                        if (downloadUrl) {
                            logger.info("Déclenchement du téléchargement et de l'installation:", downloadUrl);
                            setState((prev) => ({ ...prev, isDownloading: true }));
                            
                            // Démarrer le décompte
                            setCountdown(30);
                            
                            // Fonction pour lancer l'installation immédiatement
                            // Crée un fichier "flag" que le script batch détecte pour installer sans attendre
                            const launchImmediate = async () => {
                                if (countdownRef.current) {
                                    clearInterval(countdownRef.current);
                                    countdownRef.current = null;
                                }
                                setCountdown(null);
                                if (toastIdRef.current) {
                                    dismissToast(toastIdRef.current);
                                }

                                try {
                                    // Crée le fichier flag pour signaler au script batch d'installer maintenant
                                    await invoke("trigger_immediate_install");
                                    logger.info("Installation immédiate déclenchée via fichier flag");
                                } catch (error) {
                                    logger.error("Erreur lors du déclenchement de l'installation:", error);
                                    toast({
                                        title: "Erreur",
                                        description: `Impossible de lancer l'installation: ${error}`,
                                        variant: "destructive",
                                    });
                                }
                            };
                            
                            try {
                                // Télécharger et lancer l'installer automatiquement via Rust
                                const filePath = await invoke<string>("download_and_install_update", {
                                    url: downloadUrl,
                                });
                                logger.info("Fichier téléchargé et installer lancé:", filePath);
                                setState((prev) => ({ ...prev, isDownloading: false, isInstalling: true }));
                                
                                // Afficher un toast persistant avec décompte et bouton
                                const toastResult = toast({
                                    title: "Mise à jour disponible",
                                    description: `Installation dans ${countdown} secondes...`,
                                    variant: "default",
                                    duration: Infinity, // Toast persistant
                                    action: React.createElement(ToastAction, {
                                        altText: "Installer maintenant",
                                        onClick: launchImmediate,
                                    }, "Installer maintenant") as any,
                                });
                                
                                toastIdRef.current = toastResult.id;
                                
                                // Mettre à jour le décompte toutes les secondes
                                countdownRef.current = setInterval(() => {
                                    setCountdown((prev) => {
                                        if (prev === null || prev <= 1) {
                                            if (countdownRef.current) {
                                                clearInterval(countdownRef.current);
                                                countdownRef.current = null;
                                            }
                                            return null;
                                        }
                                        const newCountdown = prev - 1;
                                        
                                        // Mettre à jour le toast
                                        if (toastIdRef.current) {
                                            toastResult.update({
                                                id: toastIdRef.current,
                                                description: `Installation dans ${newCountdown} secondes...`,
                                            } as any);
                                        }
                                        
                                        return newCountdown;
                                    });
                                }, 1000);
                            } catch (error) {
                                logger.error("Erreur lors du téléchargement/installation:", error);
                                setState((prev) => ({ ...prev, isDownloading: false, isInstalling: false }));
                                setCountdown(null);
                                if (countdownRef.current) {
                                    clearInterval(countdownRef.current);
                                    countdownRef.current = null;
                                }
                                
                                // Afficher l'erreur
                                toast({
                                    title: "Erreur de téléchargement",
                                    description: `Impossible de télécharger ou installer: ${error}`,
                                    variant: "destructive",
                                });
                            }
                        } else {
                            logger.warn("Aucune URL de téléchargement disponible");
                            toast({
                                title: "Erreur",
                                description: "Aucune URL de téléchargement trouvée.",
                                variant: "destructive",
                            });
                        }
                    }, 1500);
                } else {
                    setState((prev) => ({
                        ...prev,
                        updateAvailable: false,
                        updateInfo: null,
                    }));
                    if (!silent) {
                        toast({
                            title: "Aucune mise à jour",
                            description:
                                "Vous utilisez déjà la dernière version.",
                            variant: "default",
                        });
                    }
                }
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : "Erreur inconnue";
                setState((prev) => ({ ...prev, error: errorMessage }));
                if (!silent) {
                    toast({
                        title: "Erreur de vérification",
                        description: `Impossible de vérifier les mises à jour: ${errorMessage}`,
                        variant: "destructive",
                    });
                }
            } finally {
                setState((prev) => ({ ...prev, isChecking: false }));
            }
        },
        [canUpdate, buildInfo, toast, githubRepo]
    );

    // Télécharger la mise à jour
    const downloadUpdate = useCallback(async () => {
        if (!canUpdate()) {
            toast({
                title: "Téléchargement non supporté",
                description:
                    "Veuillez télécharger manuellement depuis GitHub ou le Microsoft Store.",
                variant: "destructive",
            });
            return;
        }

        setState((prev) => ({
            ...prev,
            isDownloading: true,
            downloadProgress: 0,
        }));

        try {
            // Simulation de téléchargement
            for (let i = 0; i <= 100; i += 10) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                setState((prev) => ({ ...prev, downloadProgress: i }));
            }

            setState((prev) => ({
                ...prev,
                isDownloading: false,
                isInstalling: true,
            }));

            toast({
                title: "Simulation de mise à jour",
                description: "En production, l'application redémarrerait ici.",
                variant: "default",
            });

            // Reset après simulation
            setTimeout(() => {
                setState((prev) => ({ ...prev, isInstalling: false }));
            }, 2000);
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Erreur inconnue";
            setState((prev) => ({
                ...prev,
                isDownloading: false,
                isInstalling: false,
                error: errorMessage,
            }));

            toast({
                title: "Erreur de téléchargement",
                description: `Échec du téléchargement: ${errorMessage}`,
                variant: "destructive",
            });
        }
    }, [canUpdate, toast]);

    // Télécharger directement le fichier NSIS depuis GitHub
    const openGitHubReleases = useCallback(async () => {
        try {
            // Si on a une URL de téléchargement direct (NSIS), l'utiliser
            if (state.updateInfo?.downloadUrl) {
                await openExternal(state.updateInfo.downloadUrl);
            toast({
                    title: "Téléchargement lancé",
                    description: "Le téléchargement du fichier d'installation devrait commencer dans votre navigateur.",
                    variant: "default",
            });
            } else {
                // Sinon, récupérer la release pour trouver le fichier NSIS
                try {
                    const version = state.updateInfo?.version || "latest";
                    const apiUrl = version === "latest" 
                        ? `https://api.github.com/repos/${githubRepo}/releases/latest`
                        : `https://api.github.com/repos/${githubRepo}/releases/tags/v${version}`;
                    
                    const res = await fetch(apiUrl, {
                        headers: { Accept: "application/vnd.github+json" },
                    });
                    
                    if (res.ok) {
                        const json = await res.json();
                        // Chercher le fichier NSIS
                        if (json.assets && Array.isArray(json.assets)) {
                            const nsisAsset = json.assets.find((asset: any) => 
                                asset.name && (
                                    asset.name.includes('-setup.exe') ||
                                    (asset.name.includes('setup') && asset.name.endsWith('.exe'))
                                )
                            );
                            
                            if (nsisAsset && nsisAsset.browser_download_url) {
                                await openExternal(nsisAsset.browser_download_url);
                                toast({
                                    title: "Téléchargement lancé",
                                    description: "Le téléchargement du fichier d'installation devrait commencer dans votre navigateur.",
                                    variant: "default",
                                });
            return;
                            }
                        }
                    }
                } catch (fetchError) {
                    logger.error("Erreur lors de la récupération de l'URL de téléchargement:", fetchError);
        }

                // En dernier recours, ouvrir la page GitHub
                await openExternal(getGitHubReleaseUrl(state.updateInfo?.version));
            toast({
                    title: "Page GitHub ouverte",
                    description: "Le fichier NSIS n'a pas été trouvé. Veuillez télécharger manuellement depuis la page de release.",
                variant: "default",
            });
            }
        } catch (error) {
            toast({
                title: "Erreur",
                description: "Impossible de lancer le téléchargement",
                variant: "destructive",
            });
        }
    }, [getGitHubReleaseUrl, state.updateInfo?.version, state.updateInfo?.downloadUrl, githubRepo, toast]);

    // Télécharger directement la mise à jour (même logique que openGitHubReleases)
    const downloadUpdateDirectly = useCallback(async () => {
        // Utiliser la même fonction que openGitHubReleases pour télécharger le NSIS
        await openGitHubReleases();
    }, [openGitHubReleases]);

    // Nettoyer les intervalles au démontage
    useEffect(() => {
        return () => {
            if (countdownRef.current) {
                clearInterval(countdownRef.current);
            }
        };
    }, []);

    // Vérification au démarrage
    useEffect(() => {
        // Attendre que buildInfo soit chargé avant de vérifier
        if (!buildInfo) return;

        if (
            checkOnStartup &&
            getAutoUpdateSetting() &&
            enableAutoUpdater &&
            canUpdate()
        ) {
            // Attendre un peu après le démarrage pour ne pas bloquer l'interface
            const timer = setTimeout(() => {
                checkForUpdates(true);
            }, 2000);

            return () => clearTimeout(timer);
        }
    }, [
        buildInfo,
        checkOnStartup,
        checkForUpdates,
        getAutoUpdateSetting,
        enableAutoUpdater,
        canUpdate,
    ]);

    return {
        ...state,
        checkForUpdates,
        downloadUpdate,
        openGitHubReleases,
        downloadUpdateDirectly,
        isUnsignedBuild: isUnsignedBuild(),
        autoUpdateEnabled: getAutoUpdateSetting(),
        setAutoUpdateEnabled: setAutoUpdateSetting,
        getGitHubReleaseUrl,
        canUpdate: canUpdate(),
        distribution: buildInfo?.distribution || "unknown",
        currentVersion: currentVersion || "inconnue",
        latestVersion,
    };
}
