import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { updateService, UpdateState } from '@/services/updateService';
import { Download, Github, Store, AlertTriangle, RefreshCw } from 'lucide-react';
import openExternal from '@/utils/external';
import { formatVersion, getAppVersionSync } from '@/utils/version';
import { detectDistribution } from '@/utils/buildInfo';

export default function UpdatesPage() {
    const [updateState, setUpdateState] = useState<UpdateState>(updateService.getState());
    const distribution = detectDistribution();

    useEffect(() => {
        const unsubscribe = updateService.subscribe((state) => {
            setUpdateState(state);
        });
        return unsubscribe;
    }, []);

    const handleCheckForUpdates = async () => {
        try {
            await updateService.checkForUpdate(false);
        } catch (error) {
            console.error('Erreur vérification mise à jour:', error);
        }
    };

    const handleInstallUpdate = async () => {
        try {
            if (updateState.downloaded) {
                await updateService.installAndRelaunch();
            } else if (updateState.available) {
                await updateService.downloadUpdate();
            }
        } catch (error) {
            console.error('Erreur installation mise à jour:', error);
        }
    };

    const currentVersion = formatVersion(getAppVersionSync());

    const handleOpenGitHub = () => {
        openExternal('https://github.com/drrakendu78/TradSC/releases');
    };

    const handleOpenStore = () => {
        openExternal('ms-windows-store://pdp/?productid=YourProductId');
    };

    const getDistributionInfo = () => {
        switch (distribution) {
            case 'microsoft-store':
                return {
                    name: 'Microsoft Store',
                    icon: <Store className="h-5 w-5 text-blue-600" />,
                    badge: 'Signé',
                    badgeVariant: 'default' as const,
                    description: 'Version officielle du Microsoft Store',
                    updateInfo: 'Les mises à jour sont gérées automatiquement par le Microsoft Store.'
                };
            case 'github':
                return {
                    name: 'GitHub Release',
                    icon: <Github className="h-5 w-5 text-orange-600" />,
                    badge: 'Non-signé',
                    badgeVariant: 'secondary' as const,
                    description: 'Version open-source depuis GitHub',
                    updateInfo: 'Mises à jour manuelles ou automatiques disponibles.'
                };
            case 'portable':
                return {
                    name: 'Version Portable',
                    icon: <Download className="h-5 w-5 text-green-600" />,
                    badge: 'Portable',
                    badgeVariant: 'outline' as const,
                    description: 'Version sans installation',
                    updateInfo: 'Téléchargez une nouvelle version pour mettre à jour.'
                };
            default:
                return {
                    name: 'Version Inconnue',
                    icon: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
                    badge: 'Inconnue',
                    badgeVariant: 'destructive' as const,
                    description: 'Distribution non reconnue',
                    updateInfo: 'Source d\'installation non identifiée.'
                };
        }
    };

    const distInfo = getDistributionInfo();

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                        <Download className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Mises à jour</h1>
                        <p className="text-sm text-muted-foreground">Gérez les mises à jour de StarTrad FR</p>
                    </div>
                </div>

            {/* Info Distribution */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        {distInfo.icon}
                        Version Actuelle - {distInfo.name}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium">StarTrad FR {currentVersion}</p>
                            <p className="text-sm text-muted-foreground">
                                {distInfo.description}
                            </p>
                        </div>
                        <Badge variant={distInfo.badgeVariant}>{distInfo.badge}</Badge>
                    </div>

                    <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-md">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            💡 {distInfo.updateInfo}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            onClick={handleCheckForUpdates}
                            disabled={updateState.checking || updateState.downloading}
                            className="flex items-center gap-2"
                        >
                            {updateState.checking ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            {updateState.checking ? 'Vérification...' : 'Vérifier les mises à jour'}
                        </Button>

                        {distribution === 'microsoft-store' ? (
                            <Button
                                variant="outline"
                                onClick={handleOpenStore}
                                className="flex items-center gap-2"
                            >
                                <Store className="h-4 w-4" />
                                Ouvrir le Store
                            </Button>
                        ) : updateState.available || updateState.downloaded ? (
                            <Button
                                variant={updateState.downloaded ? "default" : "outline"}
                                onClick={handleInstallUpdate}
                                disabled={updateState.downloading || updateState.installing}
                                className="flex items-center gap-2"
                            >
                                {updateState.downloading || updateState.installing ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                                {updateState.installing
                                    ? 'Installation...'
                                    : updateState.downloading
                                    ? 'Téléchargement...'
                                    : updateState.downloaded
                                    ? `Installer v${updateState.updateInfo?.version}`
                                    : `Télécharger v${updateState.updateInfo?.version}`}
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                onClick={handleOpenGitHub}
                                className="flex items-center gap-2"
                            >
                                <Github className="h-4 w-4" />
                                Voir sur GitHub
                            </Button>
                        )}
                    </div>

                    {/* État de la mise à jour */}
                    {updateState.available && !updateState.downloaded && (
                        <div className="p-3 bg-green-100 dark:bg-green-900 rounded-md">
                            <p className="text-sm text-green-800 dark:text-green-200">
                                🎉 Mise à jour disponible: v{updateState.updateInfo?.version}
                            </p>
                        </div>
                    )}

                    {updateState.downloaded && (
                        <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-md">
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                                ✅ Mise à jour téléchargée et prête à installer: v{updateState.updateInfo?.version}
                            </p>
                        </div>
                    )}

                    {updateState.error && (
                        <div className="p-3 bg-red-100 dark:bg-red-900 rounded-md">
                            <p className="text-sm text-red-800 dark:text-red-200">
                                Erreur: {updateState.error}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Microsoft Store - Info spécifique */}
            {distribution === 'microsoft-store' && (
                <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                            <Store className="h-5 w-5" />
                            Microsoft Store - Gestion Automatique
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-blue-700 dark:text-blue-300">
                        <div className="space-y-2">
                            <p className="text-sm">
                                ✅ <strong>Mises à jour automatiques</strong> gérées par Microsoft
                            </p>
                            <p className="text-sm">
                                ✅ <strong>Signature numérique</strong> validée par Microsoft
                            </p>
                            <p className="text-sm">
                                ✅ <strong>Aucun avertissement</strong> SmartScreen
                            </p>
                            <p className="text-sm">
                                ℹ️ Les mises à jour se font automatiquement en arrière-plan
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* GitHub/Portable - Info spécifique */}
            {(distribution === 'github' || distribution === 'portable') && (
                <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                            <AlertTriangle className="h-5 w-5" />
                            Version Open-Source
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-orange-700 dark:text-orange-300">
                        <div className="space-y-2">
                            <p className="text-sm">
                                ⚠️ <strong>Application non-signée</strong> - Avertissements SmartScreen possibles
                            </p>
                            <p className="text-sm">
                                🔍 <strong>Code source ouvert</strong> - Entièrement auditable
                            </p>
                            <p className="text-sm">
                                🛡️ <strong>Checksums SHA256</strong> - Vérification d'intégrité
                            </p>
                            {distribution === 'portable' && (
                                <p className="text-sm">
                                    📦 <strong>Version portable</strong> - Pas d'installation requise
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Debug Info (Développement uniquement) */}
            {import.meta.env.DEV && (
                <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
                            🐛 Debug Info (DEV)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-yellow-700 dark:text-yellow-300">
                        <div className="space-y-1 text-xs">
                            <p>Distribution détectée: <strong>{distribution}</strong></p>
                            <p>TAURI_ENV_MS_STORE: <strong>{process.env.TAURI_ENV_MS_STORE || 'undefined'}</strong></p>
                            <p>TAURI_ENV_PORTABLE: <strong>{process.env.TAURI_ENV_PORTABLE || 'undefined'}</strong></p>
                            <p>TAURI_ENV_DISTRIBUTION: <strong>{process.env.TAURI_ENV_DISTRIBUTION || 'undefined'}</strong></p>
                        </div>
                    </CardContent>
                </Card>
            )}
            </div>
        </motion.div>
    );
} 