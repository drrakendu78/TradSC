import React, { useEffect, useState } from 'react';
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/custom/app-sidebar';
import { BackgroundVideo } from '@/components/custom/background-video';
import { DragRegion } from '@/components/custom/drag-region';
import { PvpFloatingTimer } from '@/components/custom/PvpFloatingTimer';
import { UpdateDialog } from '@/components/custom/UpdateDialog';
import ControlMenu from '@/components/custom/control-menu';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUpdater } from '@/hooks/useUpdater';
import { useSidebarStore } from '@/stores/sidebar-store';
import { formatVersion, getAppVersionSync } from '@/utils/version';

const OVERLAY_ROUTES = new Set([
    '/overlay-view',
    '/overlay-control',
    '/pvp-overlay',
    '/overlay-hub',
]);

const toRouteLabel = (value: string): string =>
    value
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');

const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();
    const [path, setPath] = useState<string>('');
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

    const version = formatVersion(getAppVersionSync());
    const { isLocked } = useSidebarStore();

    const updater = useUpdater({
        checkOnStartup: true,
        enableAutoUpdater: true,
        githubRepo: 'drrakendu78/TradSC',
    });

    useEffect(() => {
        if (updater.updateAvailable && updater.updateInfo) {
            setUpdateDialogOpen(true);
        }
    }, [updater.updateAvailable, updater.updateInfo]);

    useEffect(() => {
        const appWindow = getCurrentWindow();
        let unlisten: (() => void) | null = null;
        let ready = false;

        const forceRepaint = async () => {
            if (!ready) return;

            try {
                const maximized = await appWindow.isMaximized();
                if (maximized) return;

                const size = await appWindow.innerSize();
                await appWindow.setSize(new PhysicalSize(size.width + 1, size.height));
                await appWindow.setSize(new PhysicalSize(size.width, size.height));
            } catch (error) {
                console.error('Erreur resize fix:', error);
            }
        };

        const startupDelay = setTimeout(() => {
            ready = true;
        }, 2000);

        appWindow.onFocusChanged(() => {
            forceRepaint();
        }).then((fn) => {
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
        }

        setPath(location.pathname.split('/').join(''));
    }, [location]);

    if (OVERLAY_ROUTES.has(location.pathname)) {
        return <>{children}</>;
    }

    const isHomeRoute = location.pathname === '/';
    const routeLabel = path ? toRouteLabel(path) : '';
    const routeTitle = routeLabel || 'Accueil';

    return (
        <TooltipProvider>
            <DragRegion className="relative flex h-screen w-full overflow-hidden">
                <BackgroundVideo />
                <AppSidebar />

                <div
                    className={[
                        'relative z-10 flex min-w-0 flex-1 flex-col p-4 md:py-6 md:pr-6 transition-[padding] duration-300',
                        isLocked ? 'md:pl-[352px]' : 'md:pl-6',
                    ].join(' ')}
                >
                    <header
                        className={[
                            'relative z-[90] mx-auto flex h-12 w-full max-w-[1720px] shrink-0 items-center gap-3 rounded-2xl px-3.5 backdrop-blur-xl backdrop-saturate-150',
                            isHomeRoute
                                ? 'border border-border/15 bg-background/18 shadow-[0_10px_24px_rgba(0,0,0,0.2)]'
                                : 'border border-border/25 bg-background/28 shadow-[0_10px_26px_rgba(0,0,0,0.25)]',
                        ].join(' ')}
                        style={{
                            backdropFilter: 'blur(8px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(8px) saturate(180%)',
                        }}
                    >
                        <div className="min-w-0 flex items-center gap-2">
                            <p className="truncate text-sm font-semibold tracking-tight text-foreground/95">
                                StarTrad FR {version}
                            </p>
                            {!isHomeRoute && (
                                <div className="rounded-full border border-border/35 bg-background/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    {routeTitle}
                                </div>
                            )}
                        </div>
                        <ControlMenu embedded className="ml-auto mt-0.5" />
                    </header>

                    <main
                        className={[
                            'mx-auto mt-4 flex min-h-0 w-full max-w-[1720px] flex-1',
                            isHomeRoute ? 'overflow-visible' : 'overflow-hidden',
                        ].join(' ')}
                    >
                        <div
                        className={[
                            'flex h-full w-full',
                            isHomeRoute
                                ? 'overflow-visible bg-transparent'
                                : 'rounded-2xl border border-border/15 bg-background/[0.07] backdrop-blur-[1px]',
                        ].join(' ')}
                    >
                        {children}
                    </div>
                    </main>
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
    );
};

export default Layout;
