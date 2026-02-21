import { useState, useEffect, useCallback } from "react";
import { useToast } from "./use-toast";
import { getBuildInfo } from "@/utils/buildInfo";
import { compareVersions, getAppVersion } from "@/utils/version";
import openExternal from "@/utils/external";
import logger from "@/utils/logger";
import { invoke } from "@tauri-apps/api/core";

interface UpdateInfo {
    version: string;
    notes: string;
    pub_date: string;
    downloadUrl?: string;
    sigUrl?: string;
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

    const { toast } = useToast();

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

    // Charger les infos de build au démarrage
    useEffect(() => {
        getBuildInfo()
            .then((info) => {
                setBuildInfo(info);
                setCurrentVersion(info.version || "");
            })
            .catch(logger.error);

        getAppVersion()
            .then((version) => {
                setCurrentVersion(version || "");
            })
            .catch((error) => {
                logger.error("Erreur lors de la récupération de la version:", error);
            });
    }, []);

    // Préférences utilisateur
    const getAutoUpdateSetting = useCallback(() => {
        return localStorage.getItem("autoUpdate") !== "false";
    }, []);

    const setAutoUpdateSetting = useCallback((enabled: boolean) => {
        localStorage.setItem("autoUpdate", enabled.toString());
    }, []);

    // URL de la page de release GitHub
    const getGitHubReleaseUrl = useCallback(
        (version?: string) => {
            if (version) {
                return `https://github.com/${githubRepo}/releases/tag/v${version}`;
            }
            return `https://github.com/${githubRepo}/releases/latest`;
        },
        [githubRepo]
    );

    // Build non-signé
    const isUnsignedBuild = useCallback(() => {
        if (!buildInfo) return true;
        return !buildInfo.isSigned;
    }, [buildInfo]);

    // Mises à jour supportées
    const canUpdate = useCallback(() => {
        if (!buildInfo) return false;
        return (
            buildInfo.distribution !== "microsoft-store" &&
            buildInfo.canAutoUpdate
        );
    }, [buildInfo]);

    // Vérifier les mises à jour via l'API GitHub
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
                const res = await fetch(
                    `https://api.github.com/repos/${githubRepo}/releases/latest`,
                    {
                        headers: { Accept: "application/vnd.github+json" },
                    }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                const tag: string = json.tag_name || "";
                const remoteVersion = tag.startsWith("v") ? tag.slice(1) : tag;
                setLatestVersion(remoteVersion || null);

                const localVersion: string = buildInfo?.version;
                if (
                    remoteVersion &&
                    localVersion &&
                    compareVersions(remoteVersion, localVersion) === 1
                ) {
                    const notes: string = json.body || "";
                    const pubDate: string = json.published_at || new Date().toISOString();

                    // Trouver le fichier NSIS (setup.exe)
                    let downloadUrl: string | undefined;
                    let sigUrl: string | undefined;

                    if (json.assets && Array.isArray(json.assets) && json.assets.length > 0) {
                        // 1. Chercher le NSIS setup
                        const nsisAsset = json.assets.find((asset: any) =>
                            asset.name && (
                                asset.name.includes('-setup.exe') ||
                                (asset.name.includes('setup') && asset.name.endsWith('.exe'))
                            )
                        );
                        if (nsisAsset && nsisAsset.browser_download_url) {
                            downloadUrl = nsisAsset.browser_download_url;

                            // Chercher le .sig correspondant
                            const sigAsset = json.assets.find((asset: any) =>
                                asset.name && asset.name === nsisAsset.name + '.sig'
                            );
                            if (sigAsset && sigAsset.browser_download_url) {
                                sigUrl = sigAsset.browser_download_url;
                            }
                        } else {
                            // 2. Si pas de NSIS, chercher un .msi
                            const msiAsset = json.assets.find((asset: any) =>
                                asset.name && asset.name.endsWith('.msi')
                            );
                            if (msiAsset && msiAsset.browser_download_url) {
                                downloadUrl = msiAsset.browser_download_url;
                            } else {
                                // 3. Chercher un autre .exe (pas les .sig)
                                const exeAsset = json.assets.find((asset: any) =>
                                    asset.name && asset.name.endsWith('.exe') && !asset.name.endsWith('.sig')
                                );
                                if (exeAsset && exeAsset.browser_download_url) {
                                    downloadUrl = exeAsset.browser_download_url;
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
                            sigUrl,
                        },
                    }));

                    if (!silent) {
                        toast({
                            title: `Mise à jour disponible: v${remoteVersion}`,
                            description: "Consultez les notes de version et installez la mise à jour.",
                            variant: "default",
                        });
                    }
                } else {
                    setState((prev) => ({
                        ...prev,
                        updateAvailable: false,
                        updateInfo: null,
                    }));
                    if (!silent) {
                        toast({
                            title: "Aucune mise à jour",
                            description: "Vous utilisez déjà la dernière version.",
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

    // Installer la mise à jour via l'updater standalone
    const installUpdate = useCallback(async () => {
        if (!state.updateInfo?.downloadUrl) {
            toast({
                title: "Erreur",
                description: "Aucune URL de téléchargement trouvée.",
                variant: "destructive",
            });
            return;
        }

        setState((prev) => ({ ...prev, isInstalling: true }));

        try {
            const fileName = state.updateInfo.downloadUrl.split('/').pop() || "update.exe";
            await invoke("launch_updater", {
                url: state.updateInfo.downloadUrl,
                sigUrl: state.updateInfo.sigUrl || "",
                name: fileName,
            });
            // L'app va se fermer, pas besoin de gérer la suite
        } catch (error) {
            setState((prev) => ({ ...prev, isInstalling: false }));
            toast({
                title: "Erreur",
                description: `Impossible de lancer la mise à jour: ${error}`,
                variant: "destructive",
            });
        }
    }, [state.updateInfo, toast]);

    // Télécharger manuellement via le navigateur
    const openGitHubReleases = useCallback(async () => {
        try {
            if (state.updateInfo?.downloadUrl) {
                await openExternal(state.updateInfo.downloadUrl);
                toast({
                    title: "Téléchargement lancé",
                    description: "Le téléchargement devrait commencer dans votre navigateur.",
                    variant: "default",
                });
            } else {
                await openExternal(getGitHubReleaseUrl(state.updateInfo?.version));
                toast({
                    title: "Page GitHub ouverte",
                    description: "Téléchargez manuellement depuis la page de release.",
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
    }, [getGitHubReleaseUrl, state.updateInfo, toast]);

    // Vérification au démarrage
    useEffect(() => {
        if (!buildInfo) return;

        if (
            checkOnStartup &&
            getAutoUpdateSetting() &&
            enableAutoUpdater &&
            canUpdate()
        ) {
            const timer = setTimeout(() => {
                checkForUpdates(true);
            }, 3000);

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
        installUpdate,
        openGitHubReleases,
        downloadUpdateDirectly: openGitHubReleases,
        downloadUpdate: installUpdate,
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
