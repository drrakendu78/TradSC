import React, { useEffect } from 'react';
import { AppSidebar } from "@/components/custom/app-sidebar";
import { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DragRegion } from '@/components/custom/drag-region';
import { useLocation } from 'react-router-dom';
import { getAppVersionSync, formatVersion } from '@/utils/version';
import { useUpdater } from '@/hooks/useUpdater';


const Layout = ({ children }: { children: React.ReactNode }) => {

    const location = useLocation();
    const [path, setPath] = useState<string>('');
    const version = formatVersion(getAppVersionSync());
    
    // Vérification automatique des mises à jour au démarrage
    useUpdater({
        checkOnStartup: true,
        enableAutoUpdater: true,
        githubRepo: 'drrakendu78/TradSC'
    });
    
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
                <div className='flex h-full mt-2 ml-2 flex-col flex-1 overflow-hidden md:ml-0'>
                    <div className='w-max-content flex items-center'>
                        <span className='mr-2 ml-1 text-primary font-bold'>|</span>
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