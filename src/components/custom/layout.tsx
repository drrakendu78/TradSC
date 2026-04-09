import React, { useEffect } from 'react';
import { AppSidebar } from "@/components/custom/app-sidebar";
import { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DragRegion } from '@/components/custom/drag-region';
import { useLocation } from 'react-router-dom';
import { getAppVersionSync, formatVersion } from '@/utils/version';
import { useUpdater } from '@/hooks/useUpdater';
import { UpdateDialog } from '@/components/custom/UpdateDialog';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebarStore } from '@/stores/sidebar-store';
import { BackgroundVideo } from '@/components/custom/background-video';
import { PvpFloatingTimer } from '@/components/custom/PvpFloatingTimer';
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';


const Layout = ({ children }: { children: React.ReactNode }) => {

    const location = useLocation();
    const [path, setPath] = useState<string>('');
    const version = formatVersion(getAppVersionSync());
    const { isLocked, toggleLock } = useSidebarStore();

    // Vérification automatique des mises à jour au démarrage via l'API GitHub
    const updater = useUpdater({
        checkOnStartup: true,
        enableAutoUpdater: true,
        githubRepo: 'drrakendu78/TradSC'
    });

    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

    // Afficher le modal automatiquement quand une mise à jour est détectée
    useEffect(() => {
        if (updater.updateAvailable && updater.updateInfo) {
            setUpdateDialogOpen(true);
        }
    }, [updater.updateAvailable, updater.updateInfo]);

    // Fix pour le bug de rendu WebView2 sur focus/blur de fenêtre
    // Délai au démarrage pour éviter le freeze initial sur certaines machines
    useEffect(() => {
        const appWindow = getCurrentWindow();
        let unlisten: (() => void) | null = null;
        let ready = false;

        const forceRepaint = async () => {
            if (!ready) return;
            try {
                // Ne pas resize si la fenêtre est maximisée (casse le snap plein écran)
                const maximized = await appWindow.isMaximized();
                if (maximized) return;
                const size = await appWindow.innerSize();
                // Micro-resize instantané +1px puis retour
                await appWindow.setSize(new PhysicalSize(size.width + 1, size.height));
                await appWindow.setSize(new PhysicalSize(size.width, size.height));
            } catch (e) {
                console.error('Erreur resize fix:', e);
            }
        };

        // Attendre 2s avant d'activer le fix pour ne pas freeze au lancement
        const startupDelay = setTimeout(() => {
            ready = true;
        }, 2000);

        appWindow.onFocusChanged(() => {
            forceRepaint();
        }).then(fn => {
            unlisten = fn;
        });

        return () => {
            clearTimeout(startupDelay);
            if (unlisten) unlisten();
        };
    }, []);

    useEffect(() => {
        if (location.pathname === '/') {
            setPath('');
            return;
        } else {
            setPath(location.pathname.split('/').join(''));
        }
    }, [location]);

    // Fenêtre overlay : aucun layout, juste le contenu brut
    if (
        location.pathname === '/overlay-view' ||
        location.pathname === '/overlay-control' ||
        location.pathname === '/pvp-overlay' ||
        location.pathname === '/overlay-hub'
    ) {
        return <>{children}</>;
    }

    return (
        <TooltipProvider>
            <DragRegion className="w-full h-screen max-h-screen max-w-full overflow-hidden flex" style={{ height: '100vh', maxHeight: '100vh', minHeight: '100vh', alignItems: 'stretch' }}>
                <BackgroundVideo />
                <AppSidebar />
                <div className='flex h-full mt-2 flex-col flex-1 overflow-hidden md:ml-0' style={{ maxHeight: '100vh', height: '100%', minHeight: 0, flexShrink: 0 }}>
                    <div className='w-max-content flex items-center gap-2.5 -ml-3 relative z-50'>
                        <button
                            onClick={toggleLock}
                            className={`
                                relative overflow-hidden z-50
                                p-2 rounded-lg
                                transition-all duration-300 ease-out
                                bg-background/70 backdrop-blur-xl backdrop-saturate-150
                                ${isLocked
                                    ? 'text-primary border border-primary/30 shadow-md shadow-primary/10 hover:bg-primary/20'
                                    : 'text-muted-foreground border border-border/50 shadow-md hover:text-foreground hover:bg-background/80'
                                }
                                hover:scale-105 active:scale-95
                                flex items-center justify-center
                                group
                            `}
                            style={{
                                backdropFilter: 'blur(8px) saturate(180%)',
                                WebkitBackdropFilter: 'blur(8px) saturate(180%)',
                            }}
                            title={isLocked ? "Déverrouiller la sidebar" : "Verrouiller la sidebar"}
                        >
                            {isLocked ? (
                                <PanelLeftClose className="h-4.5 w-4.5 transition-all duration-300 group-hover:scale-110" />
                            ) : (
                                <PanelLeftOpen className="h-4.5 w-4.5 transition-all duration-300 group-hover:scale-110" />
                            )}
                        </button>
                        <span className='text-primary font-bold'>|</span>
                        <p className='font-bold'>StarTrad FR {version} {path ? `- ${path[0].toUpperCase() + path.slice(1)}` : null}</p>
                    </div>
                    <div className="flex flex-1 w-full min-h-0" style={{ overflow: 'hidden' }}>
                        {children}
                    </div>
                </div>
                <Toaster />
                <PvpFloatingTimer />
                <UpdateDialog
                    open={updateDialogOpen}
                    onOpenChange={setUpdateDialogOpen}
                    updateInfo={updater.updateInfo}
                    onDownload={updater.installUpdate}
                    onOpenGitHub={updater.openGitHubReleases}
                />
        </DragRegion>
        </TooltipProvider>
    )
};

export default Layout;
