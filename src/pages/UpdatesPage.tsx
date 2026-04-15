import { m } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUpdater } from '@/hooks/useUpdater';
import { Download, Github, Store, AlertTriangle, RefreshCw, CheckCircle2, ShieldCheck, Package, Sparkles, Info } from 'lucide-react';
import openExternal from '@/utils/external';
import { formatVersion, getAppVersionSync } from '@/utils/version';
import { detectDistribution } from '@/utils/buildInfo';

type DistInfo = {
    name: string;
    icon: JSX.Element;
    badge: string;
    badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
    description: string;
    updateInfo: string;
};

export default function UpdatesPage() {
    const {
        isChecking,
        updateAvailable,
        updateInfo,
        isInstalling,
        error,
        checkForUpdates,
        installUpdate,
        openGitHubReleases,
    } = useUpdater({
        checkOnStartup: false,
        enableAutoUpdater: false,
        githubRepo: 'drrakendu78/TradSC'
    });

    const distribution = detectDistribution();
    const currentVersion = formatVersion(getAppVersionSync());

    const handleOpenStore = () => {
        openExternal('ms-windows-store://pdp/?productid=9P29DL68WBZ');
    };

    const getDistributionInfo = (): DistInfo => {
        switch (distribution) {
            case 'microsoft-store':
                return {
                    name: 'Microsoft Store',
                    icon: <Store className="h-5 w-5 text-blue-500" />,
                    badge: 'Signé',
                    badgeVariant: 'default',
                    description: 'Version officielle du Microsoft Store',
                    updateInfo: 'Les mises à jour sont gérées automatiquement par le Microsoft Store.',
                };
            case 'github':
                return {
                    name: 'GitHub Release',
                    icon: <Github className="h-5 w-5 text-orange-500" />,
                    badge: 'Open-source',
                    badgeVariant: 'secondary',
                    description: 'Version open-source depuis GitHub',
                    updateInfo: 'Mises à jour manuelles ou automatiques disponibles.',
                };
            case 'portable':
                return {
                    name: 'Version Portable',
                    icon: <Package className="h-5 w-5 text-green-500" />,
                    badge: 'Portable',
                    badgeVariant: 'outline',
                    description: 'Version sans installation',
                    updateInfo: 'Téléchargez une nouvelle version pour mettre à jour.',
                };
            default:
                return {
                    name: 'Version Inconnue',
                    icon: <AlertTriangle className="h-5 w-5 text-destructive" />,
                    badge: 'Inconnue',
                    badgeVariant: 'destructive',
                    description: 'Distribution non reconnue',
                    updateInfo: "Source d'installation non identifiée.",
                };
        }
    };

    const distInfo = getDistributionInfo();

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                {/* Header */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                                <Download className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Mises à jour</h1>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px] font-mono">
                                        {currentVersion}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Gérez les mises à jour de StarTrad FR</p>
                            </div>
                        </div>
                        {updateAvailable && (
                            <Badge className="h-6 gap-1 rounded-md bg-primary/15 px-2 text-[10px] font-medium text-primary hover:bg-primary/15">
                                <Sparkles className="h-3 w-3" />
                                v{updateInfo?.version} disponible
                            </Badge>
                        )}
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" />
                </section>

                {/* Grid principale */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Carte Version actuelle */}
                    <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                {distInfo.icon}
                                Version actuelle
                            </CardTitle>
                            <CardDescription>
                                {distInfo.description}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">StarTrad FR {currentVersion}</p>
                                    <p className="text-xs text-muted-foreground">{distInfo.name}</p>
                                </div>
                                <Badge variant={distInfo.badgeVariant}>{distInfo.badge}</Badge>
                            </div>

                            <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <p className="text-xs leading-relaxed text-foreground/85">{distInfo.updateInfo}</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Carte Actions mise à jour */}
                    <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <RefreshCw className="h-5 w-5 text-primary" />
                                Actions
                            </CardTitle>
                            <CardDescription>
                                Vérifiez et installez les mises à jour
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Button
                                onClick={() => checkForUpdates(false)}
                                disabled={isChecking || isInstalling}
                                className="w-full gap-2"
                            >
                                {isChecking ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                                {isChecking ? 'Vérification...' : 'Vérifier les mises à jour'}
                            </Button>

                            {distribution === 'microsoft-store' ? (
                                <Button
                                    variant="outline"
                                    onClick={handleOpenStore}
                                    className="w-full gap-2"
                                >
                                    <Store className="h-4 w-4" />
                                    Ouvrir le Microsoft Store
                                </Button>
                            ) : updateAvailable ? (
                                <Button
                                    onClick={installUpdate}
                                    disabled={isInstalling}
                                    variant="default"
                                    className="w-full gap-2"
                                >
                                    {isInstalling ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                    {isInstalling ? 'Lancement...' : `Installer v${updateInfo?.version}`}
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    onClick={openGitHubReleases}
                                    className="w-full gap-2"
                                >
                                    <Github className="h-4 w-4" />
                                    Voir sur GitHub
                                </Button>
                            )}

                            {updateAvailable && (
                                <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/10 p-3">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-foreground">
                                            Mise à jour disponible : v{updateInfo?.version}
                                        </p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            Installez-la pour profiter des dernières nouveautés.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {error && (
                                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-destructive">Erreur</p>
                                        <p className="mt-0.5 break-all text-xs text-muted-foreground">{error}</p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Carte infos distribution */}
                {distribution === 'microsoft-store' && (
                    <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <ShieldCheck className="h-5 w-5 text-blue-500" />
                                Gestion automatique Microsoft Store
                            </CardTitle>
                            <CardDescription>
                                Les mises à jour sont gérées de manière transparente
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {[
                                    'Mises à jour automatiques gérées par Microsoft',
                                    'Signature numérique validée par Microsoft',
                                    'Aucun avertissement SmartScreen',
                                    'Installation silencieuse en arrière-plan',
                                ].map((item) => (
                                    <div key={item} className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                                        <span className="text-xs leading-relaxed text-foreground/85">{item}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {(distribution === 'github' || distribution === 'portable') && (
                    <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <AlertTriangle className="h-5 w-5 text-orange-500" />
                                Version open-source
                            </CardTitle>
                            <CardDescription>
                                Particularités et garanties de sécurité
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                                    <span className="text-xs leading-relaxed text-foreground/85">
                                        Application non-signée — avertissements SmartScreen possibles
                                    </span>
                                </div>
                                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                    <Github className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                    <span className="text-xs leading-relaxed text-foreground/85">
                                        Code source ouvert — entièrement auditable
                                    </span>
                                </div>
                                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                    <span className="text-xs leading-relaxed text-foreground/85">
                                        Signature ed25519 — vérification d'intégrité automatique
                                    </span>
                                </div>
                                {distribution === 'portable' && (
                                    <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                        <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                        <span className="text-xs leading-relaxed text-foreground/85">
                                            Version portable — pas d'installation requise
                                        </span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Debug dev only */}
                {import.meta.env.DEV && (
                    <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">DEV</Badge>
                                Debug info
                            </CardTitle>
                            <CardDescription>
                                Variables d'environnement Tauri
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1.5 rounded-lg border border-border/30 bg-background/20 p-3 font-mono text-xs text-muted-foreground">
                                <p>distribution: <span className="text-foreground/90">{distribution}</span></p>
                                <p>TAURI_ENV_MS_STORE: <span className="text-foreground/90">{process.env.TAURI_ENV_MS_STORE || 'undefined'}</span></p>
                                <p>TAURI_ENV_PORTABLE: <span className="text-foreground/90">{process.env.TAURI_ENV_PORTABLE || 'undefined'}</span></p>
                                <p>TAURI_ENV_DISTRIBUTION: <span className="text-foreground/90">{process.env.TAURI_ENV_DISTRIBUTION || 'undefined'}</span></p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </m.div>
    );
}
