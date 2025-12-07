import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSidebarStore } from '@/stores/sidebar-store';

export function BackgroundVideo() {
    const location = useLocation();
    const { isCollapsed } = useSidebarStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isDesktop, setIsDesktop] = useState(false);
    
    // Afficher la vidéo uniquement sur la page d'accueil
    const isHomePage = location.pathname === '/';
    
    useEffect(() => {
        const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);
    
    // Gérer les changements de volume et mute
    useEffect(() => {
        const handleVolumeChange = (e: CustomEvent) => {
            const newVolume = e.detail;
            if (videoRef.current) {
                videoRef.current.volume = newVolume;
            }
        };
        
        const handleMuteChange = (e: CustomEvent) => {
            const newMuted = e.detail;
            setIsMuted(newMuted);
            if (videoRef.current) {
                videoRef.current.muted = newMuted;
            }
        };
        
        window.addEventListener('videoVolumeChange', handleVolumeChange as EventListener);
        window.addEventListener('videoMuteChange', handleMuteChange as EventListener);
        
        return () => {
            window.removeEventListener('videoVolumeChange', handleVolumeChange as EventListener);
            window.removeEventListener('videoMuteChange', handleMuteChange as EventListener);
        };
    }, []);
    
    // Initialiser le volume de la vidéo quand elle est prête
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        
        const initializeVideo = () => {
            const savedVolume = localStorage.getItem('videoVolume');
            const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
            video.volume = vol;
            video.muted = isMuted;
        };
        
        const handleLoadedMetadata = () => {
            initializeVideo();
        };
        
        const handleCanPlay = () => {
            initializeVideo();
        };
        
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('canplay', handleCanPlay);
        
        // Si la vidéo est déjà chargée
        if (video.readyState >= 1) {
            initializeVideo();
        }
        
        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('canplay', handleCanPlay);
        };
    }, [isMuted]);
    
    // Mettre en pause la vidéo uniquement quand la fenêtre est minimisée ou dans le tray
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let appWindow: any = null;
        let checkInterval: NodeJS.Timeout | null = null;

        const checkWindowState = async () => {
            if (!video) return;
            
            try {
                if (!appWindow) {
                    appWindow = getCurrentWindow();
                }
                
                // Vérifier si la fenêtre est minimisée ou cachée
                const isVisible = await appWindow.isVisible();
                const isMinimized = await appWindow.isMinimized();
                
                if (!isVisible || isMinimized) {
                    // Fenêtre minimisée ou dans le tray : mettre en pause
                    if (!video.paused) {
                        video.pause();
                    }
                } else {
                    // Fenêtre visible et non minimisée : reprendre la lecture
                    if (video.paused) {
                        video.play().catch(err => {
                            console.error('Erreur de reprise de la vidéo:', err);
                        });
                    }
                }
            } catch (error) {
                // Si Tauri n'est pas disponible ou en cas d'erreur, ne rien faire
                // La vidéo continuera de jouer normalement
                console.log('Impossible de vérifier l\'état de la fenêtre:', error);
            }
        };

        // Vérifier l'état de la fenêtre périodiquement (toutes les 500ms)
        checkInterval = setInterval(checkWindowState, 500);
        
        // Vérifier immédiatement
        checkWindowState();

        // Écouter aussi les changements de visibilité du document (fallback)
        const handleVisibilityChange = async () => {
            if (!video) return;
            
            // Utiliser Tauri pour vérifier l'état réel de la fenêtre
            await checkWindowState();
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (checkInterval) {
                clearInterval(checkInterval);
            }
        };
    }, []);
    
    const sidebarLeft = isCollapsed ? '5rem' : '14rem'; // w-20 = 5rem, w-56 = 14rem
    const sidebarWidth = isCollapsed ? '5rem' : '14rem';
    
    // Un seul élément vidéo qui change juste sa visibilité et son positionnement
    return (
        <div 
            className={`fixed top-0 h-[70vh] z-0 pointer-events-none overflow-hidden transition-all duration-500 ${!isHomePage ? 'opacity-0 pointer-events-none' : ''}`}
            style={{
                left: isDesktop ? sidebarLeft : '0',
                width: isDesktop ? `calc(100% - ${sidebarWidth})` : '100%',
                transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                visibility: isHomePage ? 'visible' : 'hidden'
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                loop
                playsInline
                muted={isMuted}
                className="w-full h-full object-cover"
                style={{
                    maskImage: isHomePage ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 20%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0) 100%)' : 'none',
                    WebkitMaskImage: isHomePage ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 20%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0) 100%)' : 'none',
                }}
                onLoadedMetadata={() => {
                    if (videoRef.current) {
                        const savedVolume = localStorage.getItem('videoVolume');
                        const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
                        videoRef.current.volume = vol;
                        videoRef.current.muted = isMuted;
                        // Forcer la lecture
                        videoRef.current.play().catch(err => {
                            console.error('Erreur de lecture de la vidéo:', err);
                        });
                    }
                }}
                onCanPlay={() => {
                    if (videoRef.current) {
                        const savedVolume = localStorage.getItem('videoVolume');
                        const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
                        videoRef.current.volume = vol;
                        videoRef.current.muted = isMuted;
                    }
                }}
                onError={(e) => {
                    console.error('Erreur de chargement de la vidéo:', e);
                }}
            >
                <source src="/video-montage-sc.mp4" type="video/mp4" />
            </video>
        </div>
    );
}

