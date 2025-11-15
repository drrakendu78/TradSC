import React, { useEffect } from 'react';
import { AppSidebar } from "@/components/custom/app-sidebar";
import { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DragRegion } from '@/components/custom/drag-region';
import { useLocation } from 'react-router-dom';
import { getAppVersionSync, formatVersion } from '@/utils/version';
import { useUpdater } from '@/hooks/useUpdater';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useTheme } from '@/components/utils/theme-provider';


const Layout = ({ children }: { children: React.ReactNode }) => {

    const location = useLocation();
    const [path, setPath] = useState<string>('');
    const version = formatVersion(getAppVersionSync());
    const { isLocked, toggleLock } = useSidebarStore();
    const { theme } = useTheme();
    const [buttonBgColor, setButtonBgColor] = useState<string>("#111f2c");
    
    // Vérification automatique des mises à jour au démarrage
    useUpdater({
        checkOnStartup: true,
        enableAutoUpdater: true,
        githubRepo: 'drrakendu78/TradSC'
    });
    
    // Met à jour la couleur du bouton quand le thème change
    useEffect(() => {
        const updateButtonColor = () => {
            const isDark = theme === "dark" || 
                          (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
            setButtonBgColor(isDark ? "#111f2c" : "#dde7f2");
        };
        
        updateButtonColor();
        
        // Écoute les changements du thème système si le mode est "system"
        if (theme === "system") {
            const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
            mediaQuery.addEventListener("change", updateButtonColor);
            return () => mediaQuery.removeEventListener("change", updateButtonColor);
        }
    }, [theme]);
    
    useEffect(() => {
        if (location.pathname === '/') {
            setPath('');
            return;
        } else {
            setPath(location.pathname.split('/').join(''));
        }
    }, [location]);

    return (
        <TooltipProvider>
            <DragRegion className="w-full h-screen max-h-screen max-w-full overflow-hidden flex">
                <AppSidebar />
                <div className='flex h-full mt-2 flex-col flex-1 overflow-hidden md:ml-0'>
                    <div className='w-max-content flex items-center gap-2.5 -ml-3'>
                        <button
                            onClick={toggleLock}
                            className={`
                                relative overflow-hidden
                                p-2 rounded-lg
                                transition-all duration-300 ease-out
                                backdrop-blur-md backdrop-saturate-150
                                ${isLocked 
                                    ? 'bg-primary/15 text-primary border border-primary/30 shadow-md shadow-primary/10 hover:bg-primary/20' 
                                    : 'text-muted-foreground border border-border/60 shadow-md hover:text-foreground'
                                }
                                hover:scale-105 active:scale-95
                                flex items-center justify-center
                                group
                            `}
                            style={{
                                backdropFilter: 'blur(12px) saturate(150%)',
                                WebkitBackdropFilter: 'blur(12px) saturate(150%)',
                                backgroundColor: isLocked ? undefined : buttonBgColor,
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
                    <div className="flex w-full h-full">
                        {children}
                    </div>
                </div>
                <Toaster />
        </DragRegion>
        </TooltipProvider>
    )
};

export default Layout;