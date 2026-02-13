import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Globe2,
    Brush,
    Users,
    Download,
    FileText,
    Newspaper,
    Keyboard,
    Monitor,
    Rocket,
    ArrowRight,
    Sparkles,
    Map,
    Eye,
    EyeOff,
    ExternalLink,
    Play,
    Clock,
    FileDown,
    FileUp,
    Cloud,
    CloudUpload,
    CloudDownload,
    Loader2,
    Palette,
    PanelLeft,
    BarChart3,
    Trash2,
    AlertCircle
} from 'lucide-react';
import { usePreferencesSyncStore, ExportedPreferences } from '@/stores/preferences-sync-store';
import { useStatsStore } from '@/stores/stats-store';
import { supabase } from '@/lib/supabase';
import RecentPatchNotes from '@/components/custom/recent-patchnotes';
import RecentActualites from '@/components/custom/recent-actualites';
import { AnnouncementDialog } from '@/components/custom/announcement-dialog';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/utils/tauri-helpers';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface LauncherStatus {
    installed: boolean;
    path: string | null;
}

interface VersionPlaytime {
    version: string;
    hours: number;
    formatted: string;
    session_count: number;
}

interface PlaytimeStats {
    total_hours: number;
    formatted: string;
    session_count: number;
    by_version: VersionPlaytime[];
}

// ============================================
// CONFIGURATION DE LA POPUP D'ANNONCE
// ============================================
// Pour activer une annonce, modifie les valeurs ci-dessous
// Pour désactiver, mets showAnnouncement à false
const ANNOUNCEMENT_CONFIG = {
    showAnnouncement: true,
    storageKey: "startradfr_noel_2025",
    title: "🎄 Joyeuses Fêtes !",
    message: "Toute l'équipe de StarTrad FR vous souhaite un Joyeux Noël et une excellente année 2026 ! 🎅✨",
    secondaryMessage: "Merci de faire partie de notre communauté de Citizens francophones. À l'année prochaine dans le 'verse ! 🚀",
    buttonText: "Bonne année ! 🎉",
    delay: 500,
};
// ============================================

// Animation variants pour les cartes
const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: {
            delay: i * 0.1,
            duration: 0.5,
            ease: "easeOut"
        }
    })
};

// Bouton d'action rapide
interface QuickActionProps {
    to: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    color: string;
    index: number;
}

function QuickAction({ to, icon, title, description, color, index }: QuickActionProps) {
    return (
        <motion.div
            custom={index}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
        >
            <Link to={to} className="block group">
                <Card className="bg-background/40 border-border/50 hover:border-primary/50 hover:bg-background/60 transition-all duration-300 h-full">
                    <CardContent className="p-3 flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${color} text-white shrink-0`}>
                            {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-xs group-hover:text-primary transition-colors">
                                {title}
                            </h3>
                            <p className="text-[10px] text-muted-foreground truncate">
                                {description}
                            </p>
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </CardContent>
                </Card>
            </Link>
        </motion.div>
    );
}

function Home() {
    const [showContent, setShowContent] = useState(true);
    const [launcherStatus, setLauncherStatus] = useState<LauncherStatus>({ installed: false, path: null });
    const [launchingLauncher, setLaunchingLauncher] = useState(false);
    const [isInTauri, setIsInTauri] = useState(false);
    const [playtime, setPlaytime] = useState<PlaytimeStats | null>(null);
    const { toast } = useToast();
    const { savedPlaytimeHours } = useStatsStore();

    // Préférences app
    const {
        exportPreferences,
        importPreferences,
        saveToCloud,
        loadFromCloud,
        deleteFromCloud,
        isSyncing
    } = usePreferencesSyncStore();
    const [prefsSaving, setPrefsSaving] = useState(false);
    const [prefsDeleting, setPrefsDeleting] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showCloudPrefsDialog, setShowCloudPrefsDialog] = useState(false);
    const [showCloudPrefsManager, setShowCloudPrefsManager] = useState(false);
    const [cloudPrefsPreview, setCloudPrefsPreview] = useState<ExportedPreferences | null>(null);
    const [hasCloudPrefs, setHasCloudPrefs] = useState(false);
    const [checkingCloudPrefs, setCheckingCloudPrefs] = useState(false);

    // Vérifier si on est dans Tauri et si le RSI Launcher est installé
    useEffect(() => {
        const inTauri = isTauri();
        setIsInTauri(inTauri);

        if (inTauri) {
            const checkLauncher = async () => {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const status = await invoke<LauncherStatus>('check_rsi_launcher');
                    setLauncherStatus(status);
                } catch (error) {
                    console.error('Erreur lors de la vérification du launcher:', error);
                }
            };
            checkLauncher();

            // Récupérer le temps de jeu
            const fetchPlaytime = async () => {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');

                    // Debug: afficher les chemins détectés
                    const paths = await invoke<string[]>('debug_game_paths');
                    console.log('[Playtime] Chemins détectés:', paths);

                    const stats = await invoke<PlaytimeStats>('get_playtime');
                    console.log('[Playtime] Stats:', stats);
                    setPlaytime(stats);
                } catch (error) {
                    console.error('Erreur lors de la récupération du temps de jeu:', error);
                }
            };
            fetchPlaytime();
        }
    }, []);

    // Vérifier si l'utilisateur est connecté
    useEffect(() => {
        const checkUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUserId(session.user.id);
            }
        };
        checkUser();

        // Écouter les changements de session
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            setUserId(session?.user?.id || null);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Export local - ouvrir dialogue pour choisir où enregistrer
    const handleExportLocal = async () => {
        try {
            const prefs = await exportPreferences();
            const json = JSON.stringify(prefs, null, 2);

            if (isInTauri) {
                // Utiliser le dialogue natif Tauri
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { invoke } = await import('@tauri-apps/api/core');

                console.log('[Export] Ouverture du dialogue de sauvegarde...');
                const filePath = await save({
                    title: 'Exporter les préférences',
                    defaultPath: `startradfr_preferences_${new Date().toISOString().split('T')[0]}.json`,
                    filters: [{
                        name: 'JSON',
                        extensions: ['json']
                    }]
                });
                console.log('[Export] Chemin sélectionné:', filePath);

                if (filePath) {
                    console.log('[Export] Écriture du fichier...');
                    await invoke('write_text_file', { path: filePath, content: json });
                    console.log('[Export] Fichier écrit avec succès');
                    toast({
                        title: 'Export réussi',
                        description: 'Vos préférences ont été exportées.',
                        variant: 'success',
                    });
                } else {
                    console.log('[Export] Dialogue annulé par l\'utilisateur');
                }
            } else {
                // Fallback pour navigateur
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `startradfr_preferences_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                toast({
                    title: 'Export réussi',
                    description: 'Vos préférences ont été exportées en fichier JSON.',
                    variant: 'success',
                });
            }
        } catch (error: any) {
            console.error('[Export] Erreur:', error);
            toast({
                title: 'Erreur d\'export',
                description: error?.message || error?.toString() || 'Impossible d\'exporter les préférences',
                variant: 'destructive',
            });
        }
    };

    // Import local - ouvrir dialogue pour choisir un fichier
    const handleImportLocal = async () => {
        try {
            if (isInTauri) {
                // Utiliser le dialogue natif Tauri
                const { open } = await import('@tauri-apps/plugin-dialog');
                const { invoke } = await import('@tauri-apps/api/core');

                const filePath = await open({
                    filters: [{
                        name: 'JSON',
                        extensions: ['json']
                    }],
                    multiple: false
                });

                if (filePath && typeof filePath === 'string') {
                    const content = await invoke<string>('read_text_file', { path: filePath });
                    const prefs = JSON.parse(content) as ExportedPreferences;

                    if (!prefs.version || !prefs.sidebar || !prefs.theme || !prefs.stats) {
                        throw new Error('Format de fichier invalide');
                    }

                    importPreferences(prefs);

                    toast({
                        title: 'Import réussi',
                        description: 'Redémarrage pour appliquer les préférences...',
                        variant: 'success',
                    });

                    // Recharger la page pour que les stores se rechargent depuis localStorage
                    setTimeout(() => window.location.reload(), 1000);
                }
            } else {
                // Fallback pour navigateur - utiliser l'input file
                fileInputRef.current?.click();
            }
        } catch (error: any) {
            toast({
                title: 'Erreur d\'import',
                description: error.message || 'Fichier invalide',
                variant: 'destructive',
            });
        }
    };

    // Fallback import pour navigateur
    const handleImportLocalFallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const prefs = JSON.parse(content) as ExportedPreferences;

                if (!prefs.version || !prefs.sidebar || !prefs.theme || !prefs.stats) {
                    throw new Error('Format de fichier invalide');
                }

                importPreferences(prefs);

                toast({
                    title: 'Import réussi',
                    description: 'Redémarrage pour appliquer les préférences...',
                    variant: 'success',
                });

                // Recharger la page pour que les stores se rechargent depuis localStorage
                setTimeout(() => window.location.reload(), 1000);
            } catch (error: any) {
                toast({
                    title: 'Erreur d\'import',
                    description: error.message || 'Fichier invalide',
                    variant: 'destructive',
                });
            }
        };
        reader.readAsText(file);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Ouvrir le gestionnaire cloud
    const handleOpenCloudManager = async () => {
        if (!userId) return;
        setShowCloudPrefsManager(true);
        setCheckingCloudPrefs(true);
        setCloudPrefsPreview(null);

        try {
            // Vérifier si des préférences existent et les charger
            const prefs = await loadFromCloud(userId);
            if (prefs) {
                setCloudPrefsPreview(prefs);
                setHasCloudPrefs(true);
            } else {
                setHasCloudPrefs(false);
            }
        } catch {
            setHasCloudPrefs(false);
        } finally {
            setCheckingCloudPrefs(false);
        }
    };

    // Sauvegarder les préférences dans le cloud (depuis le manager)
    const handleSavePrefsToCloud = async () => {
        if (!userId) return;
        setPrefsSaving(true);
        try {
            const success = await saveToCloud(userId);
            if (success) {
                toast({
                    title: 'Sauvegarde cloud réussie',
                    description: 'Vos préférences ont été sauvegardées dans le cloud.',
                    variant: 'success',
                });
                // Recharger les préférences pour mettre à jour l'aperçu
                const prefs = await loadFromCloud(userId);
                if (prefs) {
                    setCloudPrefsPreview(prefs);
                    setHasCloudPrefs(true);
                }
            } else {
                throw new Error('Échec de la sauvegarde');
            }
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error.message || 'Impossible de sauvegarder dans le cloud',
                variant: 'destructive',
            });
        } finally {
            setPrefsSaving(false);
        }
    };

    // Supprimer les préférences du cloud
    const handleDeleteCloudPrefs = async () => {
        if (!userId) return;
        setPrefsDeleting(true);
        try {
            const success = await deleteFromCloud(userId);
            if (success) {
                toast({
                    title: 'Suppression réussie',
                    description: 'Vos préférences ont été supprimées du cloud.',
                    variant: 'success',
                });
                setCloudPrefsPreview(null);
                setHasCloudPrefs(false);
            } else {
                throw new Error('Échec de la suppression');
            }
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error.message || 'Impossible de supprimer du cloud',
                variant: 'destructive',
            });
        } finally {
            setPrefsDeleting(false);
        }
    };

    // Ouvrir le dialogue de confirmation pour charger les préférences cloud
    const handleOpenCloudPrefsDialog = () => {
        if (cloudPrefsPreview) {
            setShowCloudPrefsDialog(true);
        }
    };

    // Confirmer et appliquer les préférences cloud
    const handleConfirmLoadCloudPrefs = () => {
        if (!cloudPrefsPreview) return;

        importPreferences(cloudPrefsPreview);
        setShowCloudPrefsDialog(false);
        setCloudPrefsPreview(null);

        toast({
            title: 'Chargement réussi',
            description: 'Redémarrage pour appliquer les préférences...',
            variant: 'success',
        });

        // Recharger la page pour que les stores se rechargent depuis localStorage
        setTimeout(() => window.location.reload(), 1000);
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Lancer le RSI Launcher
    const handleLaunchLauncher = async () => {
        if (!isInTauri) return;
        setLaunchingLauncher(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('launch_rsi_launcher');
            toast({
                title: 'RSI Launcher lancé',
                description: 'Le launcher Star Citizen a été ouvert.',
            });
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error || 'Impossible de lancer le RSI Launcher',
                variant: 'destructive',
            });
        } finally {
            setLaunchingLauncher(false);
        }
    };

    // Ouvrir un lien externe
    const handleOpenExternal = async (url: string) => {
        if (isInTauri) {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(url);
        } else {
            window.open(url, '_blank');
        }
    };

    return (
        <div className="flex w-full h-full flex-col gap-6 p-4 overflow-y-auto relative justify-between">
            
            {/* Popup d'annonce - uniquement sur la page d'accueil */}
            {ANNOUNCEMENT_CONFIG.showAnnouncement && (
                <AnnouncementDialog
                    storageKey={ANNOUNCEMENT_CONFIG.storageKey}
                    title={ANNOUNCEMENT_CONFIG.title}
                    message={ANNOUNCEMENT_CONFIG.message}
                    secondaryMessage={ANNOUNCEMENT_CONFIG.secondaryMessage}
                    buttonText={ANNOUNCEMENT_CONFIG.buttonText}
                    delay={ANNOUNCEMENT_CONFIG.delay}
                />
            )}
            
            {/* Hero Section - Action principale */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="sticky top-0 z-20 -mx-4 px-4 pt-4 pb-2"
            >
                <Card className="bg-gradient-to-br from-primary/20 via-background/60 to-background/40 border-primary/30 overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                    <CardContent className="p-6 relative">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Rocket className="h-6 w-6 text-primary" />
                                    <h1 className="text-2xl font-bold">Bienvenue, Citizen !</h1>
                                </div>
                                <p className="text-muted-foreground max-w-md">
                                    Prêt à jouer en français ? Installez la traduction en un clic.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Link to="/traduction">
                                    <Button size="lg" className="gap-2 text-base px-6 shadow-lg hover:shadow-primary/25 transition-shadow">
                                        <Globe2 className="h-5 w-5" />
                                        Installer la traduction
                                        <Sparkles className="h-4 w-4" />
                                    </Button>
                                </Link>
                                {isInTauri && (
                                    launcherStatus.installed ? (
                                        <Button
                                            size="lg"
                                            variant="outline"
                                            className="gap-2 text-base px-6"
                                            onClick={handleLaunchLauncher}
                                            disabled={launchingLauncher}
                                        >
                                            <Play className="h-5 w-5" />
                                            {launchingLauncher ? 'Démarrage...' : 'Démarrer RSI Launcher'}
                                        </Button>
                                    ) : (
                                        <Button
                                            size="lg"
                                            variant="outline"
                                            className="gap-2 text-base px-6"
                                            onClick={() => handleOpenExternal('https://install.robertsspaceindustries.com/rel/2/RSI%20Launcher-Setup-2.11.0.exe')}
                                        >
                                            <Download className="h-5 w-5" />
                                            Télécharger le Launcher
                                            <ExternalLink className="h-4 w-4" />
                                        </Button>
                                    )
                                )}
                                {/* Temps de jeu */}
                                {isInTauri && ((playtime && playtime.session_count > 0) || savedPlaytimeHours > 0) && (() => {
                                    const calculatedHours = playtime?.total_hours || 0;
                                    const totalHours = savedPlaytimeHours + calculatedHours;
                                    const hours = Math.floor(totalHours);
                                    const minutes = Math.round((totalHours - hours) * 60);
                                    const sessionCount = playtime?.session_count || 0;

                                    return (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex items-center gap-2 px-3 py-2 bg-background/60 border border-border/50 rounded-lg cursor-help">
                                                        <Clock className="h-4 w-4 text-primary" />
                                                        <div className="flex flex-col">
                                                            <div className="flex items-baseline gap-0.5">
                                                                <span className="text-sm font-semibold">{hours}</span>
                                                                <span className="text-xs text-muted-foreground">h</span>
                                                                <span className="text-sm font-semibold ml-1">{minutes}</span>
                                                                <span className="text-xs text-muted-foreground">min</span>
                                                            </div>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {sessionCount > 0 
                                                                    ? `${sessionCount} session${sessionCount > 1 ? 's' : ''}`
                                                                    : 'Temps de jeu'
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom" className="max-w-xs">
                                                    <p className="text-sm">
                                                        Temps de jeu calculé depuis les logs Star Citizen.
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    );
                                })()}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* Actions rapides */}
            <div className="relative z-10">
                <div className="flex items-center justify-between px-1 mb-3">
                    {showContent && (
                        <motion.h2 
                            className="text-lg font-semibold flex items-center gap-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.2 }}
                        >
                            <Sparkles className="h-4 w-4 text-primary" />
                            Actions rapides
                        </motion.h2>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowContent(!showContent)}
                        className="gap-2 text-muted-foreground hover:text-foreground ml-auto"
                    >
                        {showContent ? (
                            <>
                                <EyeOff className="h-4 w-4" />
                                <span className="hidden sm:inline">Masquer le contenu</span>
                            </>
                        ) : (
                            <>
                                <Eye className="h-4 w-4" />
                                <span className="hidden sm:inline">Afficher le contenu</span>
                            </>
                        )}
                    </Button>
                </div>
                
                {showContent && (
                    <motion.div 
                        className="space-y-3"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    >
                    
                    <motion.div 
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <QuickAction
                            to="/cache"
                            icon={<Brush className="h-5 w-5" />}
                            title="Gestion du cache"
                            description="Libérer de l'espace disque"
                            color="bg-orange-500"
                            index={0}
                        />
                        <QuickAction
                            to="/presets-local"
                            icon={<Users className="h-5 w-5" />}
                            title="Mes personnages"
                            description="Gérer vos persos locaux"
                            color="bg-blue-500"
                            index={1}
                        />
                        <QuickAction
                            to="/presets-remote"
                            icon={<Download className="h-5 w-5" />}
                            title="Persos en ligne"
                            description="Télécharger des presets"
                            color="bg-green-500"
                            index={2}
                        />
                        <QuickAction
                            to="/bindings"
                            icon={<Keyboard className="h-5 w-5" />}
                            title="Bindings"
                            description="Raccourcis clavier"
                            color="bg-purple-500"
                            index={3}
                        />
                        <QuickAction
                            to="/graphics-settings"
                            icon={<Monitor className="h-5 w-5" />}
                            title="Graphismes"
                            description="Paramètres visuels"
                            color="bg-pink-500"
                            index={4}
                        />
                        <QuickAction
                            to="/ship-maps"
                            icon={<Map className="h-5 w-5" />}
                            title="Cartes vaisseaux"
                            description="Plans détaillés"
                            color="bg-cyan-500"
                            index={5}
                        />
                        <QuickAction
                            to="/updates"
                            icon={<Download className="h-5 w-5" />}
                            title="Mises à jour"
                            description="Gérer les mises à jour"
                            color="bg-blue-600"
                            index={6}
                        />
                    </motion.div>
                    </motion.div>
                )}
            </div>

            {/* Préférences app - barre compacte */}
            {showContent && (
                <div className="flex items-center gap-2 px-1 py-2 bg-muted/30 rounded-lg border border-border/30">
                    <span className="text-xs text-muted-foreground ml-2">Sauvegardez vos préférences (thème, sidebar, stats) en local ou dans le cloud</span>
                    <div className="flex-1" />
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExportLocal}>
                        <FileDown className="h-3 w-3" />
                        Exporter
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleImportLocal}>
                        <FileUp className="h-3 w-3" />
                        Importer
                    </Button>
                    <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportLocalFallback} className="hidden" />
                    <div className="w-px h-5 bg-border" />
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={handleOpenCloudManager}
                        disabled={isSyncing || !userId}
                    >
                        <Cloud className="h-3 w-3" />
                        {userId ? "Cloud" : "Connexion requise"}
                    </Button>
                </div>
            )}

            {/* Section infos */}
            {showContent && (
                <motion.div 
                    className="space-y-3 relative z-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                >
                    <motion.h2 
                        className="text-lg font-semibold flex items-center gap-2 px-1"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    >
                        <FileText className="h-4 w-4 text-primary" />
                        Informations
                    </motion.h2>
                    
                    <motion.div 
                        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        {/* Patchnotes */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                        >
                            <Card className="bg-background/40">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-primary" />
                                        Patchnotes StarTrad
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <RecentPatchNotes max={3} />
                                    <Link to="/patchnotes">
                                        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs">
                                            Voir tout
                                            <ArrowRight className="h-3 w-3 ml-1" />
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        </motion.div>

                        {/* Actualités */}
                        <motion.div
                            className="lg:col-span-2"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6 }}
                        >
                            <Card className="bg-background/40">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Newspaper className="h-4 w-4 text-primary" />
                                        Actualités Star Citizen
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <RecentActualites max={3} />
                                    <Link to="/actualites">
                                        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs">
                                            Voir tout
                                            <ArrowRight className="h-3 w-3 ml-1" />
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        </motion.div>
                    </motion.div>
                </motion.div>
            )}

            {/* Footer hint */}
            <motion.p
                className="text-center text-xs text-muted-foreground/60 pb-2 relative z-10 mt-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
            >
                💡 Astuce : Utilisez le menu à gauche pour naviguer rapidement
            </motion.p>

            {/* Dialog du gestionnaire cloud */}
            <Dialog open={showCloudPrefsManager} onOpenChange={setShowCloudPrefsManager}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Cloud className="h-5 w-5 text-primary" />
                            Préférences Cloud
                        </DialogTitle>
                        <DialogDescription>
                            Gérez vos préférences sauvegardées dans le cloud
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {checkingCloudPrefs ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <span className="ml-2 text-sm text-muted-foreground">Chargement...</span>
                            </div>
                        ) : hasCloudPrefs && cloudPrefsPreview ? (
                            <>
                                {/* Sauvegarde existante */}
                                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                                    <div className="flex items-center gap-2 mb-3">
                                        <CloudDownload className="h-4 w-4 text-primary" />
                                        <span className="font-medium text-sm">Sauvegarde trouvée</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mb-3">
                                        Sauvegardée le : <span className="font-medium text-foreground">{formatDate(cloudPrefsPreview.exportedAt)}</span>
                                    </div>

                                    {/* Aperçu compact */}
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <Palette className="h-3 w-3 text-muted-foreground" />
                                            <span>Thème : {cloudPrefsPreview.theme.primaryColor} ({cloudPrefsPreview.theme.mode})</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <BarChart3 className="h-3 w-3 text-muted-foreground" />
                                            <span>{cloudPrefsPreview.stats.translationInstallCount} installations, {cloudPrefsPreview.stats.backupCreatedCount} backups</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col gap-2">
                                    <Button
                                        variant="default"
                                        className="w-full gap-2"
                                        onClick={handleOpenCloudPrefsDialog}
                                    >
                                        <CloudDownload className="h-4 w-4" />
                                        Restaurer ces préférences
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full gap-2"
                                        onClick={handleSavePrefsToCloud}
                                        disabled={prefsSaving}
                                    >
                                        {prefsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                                        Écraser avec mes préférences actuelles
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        className="w-full gap-2"
                                        onClick={handleDeleteCloudPrefs}
                                        disabled={prefsDeleting}
                                    >
                                        {prefsDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        Supprimer du cloud
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Aucune sauvegarde */}
                                <div className="flex flex-col items-center justify-center py-6 text-center">
                                    <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Aucune sauvegarde cloud</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Sauvegardez vos préférences pour les retrouver sur un autre appareil
                                    </p>
                                </div>

                                <Button
                                    variant="default"
                                    className="w-full gap-2"
                                    onClick={handleSavePrefsToCloud}
                                    disabled={prefsSaving}
                                >
                                    {prefsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                                    Sauvegarder mes préférences
                                </Button>
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCloudPrefsManager(false)}>
                            Fermer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de chargement des préférences cloud */}
            <Dialog open={showCloudPrefsDialog} onOpenChange={setShowCloudPrefsDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CloudDownload className="h-5 w-5 text-primary" />
                            Charger les préférences cloud
                        </DialogTitle>
                        <DialogDescription>
                            Voulez-vous restaurer ces préférences ?
                        </DialogDescription>
                    </DialogHeader>

                    {cloudPrefsPreview && (
                        <div className="space-y-4 py-2">
                            {/* Date de sauvegarde */}
                            <div className="text-sm text-muted-foreground">
                                Sauvegardée le : <span className="font-medium text-foreground">{formatDate(cloudPrefsPreview.exportedAt)}</span>
                            </div>

                            {/* Aperçu des préférences */}
                            <div className="space-y-3">
                                {/* Thème */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <Palette className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Thème</div>
                                        <div className="text-xs text-muted-foreground">
                                            Couleur : {cloudPrefsPreview.theme.primaryColor} • Mode : {cloudPrefsPreview.theme.mode}
                                        </div>
                                    </div>
                                </div>

                                {/* Sidebar */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <PanelLeft className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Sidebar</div>
                                        <div className="text-xs text-muted-foreground">
                                            {cloudPrefsPreview.sidebar.isLocked ? 'Verrouillée' : 'Non verrouillée'} • {cloudPrefsPreview.sidebar.isCollapsed ? 'Réduite' : 'Étendue'}
                                        </div>
                                    </div>
                                </div>

                                {/* Statistiques */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <BarChart3 className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Statistiques</div>
                                        <div className="text-xs text-muted-foreground">
                                            {cloudPrefsPreview.stats.translationInstallCount} installations • {cloudPrefsPreview.stats.cacheCleanCount} nettoyages cache
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setShowCloudPrefsDialog(false)}>
                            Annuler
                        </Button>
                        <Button onClick={handleConfirmLoadCloudPrefs}>
                            Restaurer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            </div>
    );
}

export default Home;
