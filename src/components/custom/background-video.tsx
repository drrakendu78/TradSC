import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSidebarStore } from '@/stores/sidebar-store';

// Types pour l'API YouTube IFrame
declare global {
    interface Window {
        YT: any;
        onYouTubeIframeAPIReady: () => void;
    }
}

// Lire la valeur initiale de localStorage (hors du composant pour éviter les re-calculs)
const getInitialVideoEnabled = () => {
    const saved = localStorage.getItem('backgroundVideoEnabled');
    return saved === null ? true : saved === 'true';
};

export function BackgroundVideo() {
    const location = useLocation();
    const { isCollapsed } = useSidebarStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const youtubePlayerRef = useRef<any>(null);
    const youtubeIframeRef = useRef<HTMLDivElement>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isDesktop, setIsDesktop] = useState(false);
    const [youtubeReady, setYoutubeReady] = useState(false);

    // Utiliser un ref pour éviter les re-renders lors du toggle
    const isVideoEnabledRef = useRef(getInitialVideoEnabled());
    const [, forceUpdate] = useState({});

    // Écouter les changements de paramètre - mise à jour directe du DOM
    useEffect(() => {
        const handleVideoToggle = (e: CustomEvent) => {
            isVideoEnabledRef.current = e.detail;
            // Forcer une seule mise à jour
            forceUpdate({});
        };
        window.addEventListener('backgroundVideoToggle', handleVideoToggle as EventListener);
        return () => {
            window.removeEventListener('backgroundVideoToggle', handleVideoToggle as EventListener);
        };
    }, []);

    // Afficher la vidéo uniquement sur la page d'accueil
    const isHomePage = location.pathname === '/';
    
    // ID de la playlist YouTube
    const PLAYLIST_ID = 'PLLcod52t0kpdZJxdds7VF3NX-XzM3tmb8';
    
    useEffect(() => {
        const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);
    
    // Charger l'API YouTube IFrame
    useEffect(() => {
        // Vérifier si le script est déjà chargé
        if (window.YT && window.YT.Player) {
            setYoutubeReady(true);
            return;
        }
        
        // Charger le script YouTube IFrame API
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
        
        // Callback quand l'API est prête
        window.onYouTubeIframeAPIReady = () => {
            setYoutubeReady(true);
        };
        
        return () => {
            // Nettoyer si nécessaire
            if (youtubePlayerRef.current) {
                try {
                    youtubePlayerRef.current.destroy();
                } catch (e) {
                    console.log('Erreur lors de la destruction du player YouTube:', e);
                }
            }
        };
    }, []);
    
    // Initialiser le player YouTube quand l'API est prête
    useEffect(() => {
        if (!youtubeReady || !youtubeIframeRef.current) return;
        
        // Si le player existe déjà, ne pas le recréer
        if (youtubePlayerRef.current) {
            return;
        }
        
        try {
            // Créer le player avec la playlist directement
            youtubePlayerRef.current = new window.YT.Player(youtubeIframeRef.current, {
                height: '1',
                width: '1',
                playerVars: {
                    listType: 'playlist',
                    list: PLAYLIST_ID,
                    autoplay: 1,
                    loop: 1,
                    mute: 0,
                    controls: 0,
                    showinfo: 0,
                    rel: 0,
                    iv_load_policy: 3,
                    modestbranding: 1,
                    playsinline: 1,
                },
                events: {
                    onReady: (event: any) => {
                        const savedVolume = localStorage.getItem('videoVolume');
                        const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
                        event.target.setVolume(vol * 100);
                        if (isMuted) {
                            event.target.mute();
                        } else {
                            event.target.unMute();
                        }
                        event.target.playVideo();
                    },
                    onStateChange: (event: any) => {
                        // Si la playlist se termine, rejouer
                        if (event.data === window.YT.PlayerState.ENDED) {
                            event.target.playVideo();
                        }
                    },
                },
            });
        } catch (error) {
            console.error('Erreur lors de l\'initialisation du player YouTube:', error);
        }
    }, [youtubeReady, isMuted]);
    
    // Gérer les changements de volume et mute
    useEffect(() => {
        const handleVolumeChange = (e: CustomEvent) => {
            const newVolume = e.detail;
            // La vidéo locale est toujours muette, on contrôle seulement YouTube
            if (youtubePlayerRef.current && youtubePlayerRef.current.setVolume) {
                youtubePlayerRef.current.setVolume(newVolume * 100);
            }
        };
        
        const handleMuteChange = (e: CustomEvent) => {
            const newMuted = e.detail;
            setIsMuted(newMuted);
            // La vidéo locale est toujours muette, on contrôle seulement YouTube
            if (youtubePlayerRef.current) {
                if (newMuted) {
                    youtubePlayerRef.current.mute();
                } else {
                    // Quand on demute, réappliquer le volume actuel
                    const savedVolume = localStorage.getItem('videoVolume');
                    const vol = savedVolume ? parseFloat(savedVolume) : 0.5;
                    youtubePlayerRef.current.setVolume(vol * 100);
                    youtubePlayerRef.current.unMute();
                }
            }
        };

        const handlePrevious = () => {
            if (youtubePlayerRef.current && youtubePlayerRef.current.previousVideo) {
                youtubePlayerRef.current.previousVideo();
            }
        };

        const handleNext = () => {
            if (youtubePlayerRef.current && youtubePlayerRef.current.nextVideo) {
                youtubePlayerRef.current.nextVideo();
            }
        };
        
        window.addEventListener('videoVolumeChange', handleVolumeChange as EventListener);
        window.addEventListener('videoMuteChange', handleMuteChange as EventListener);
        window.addEventListener('youtubePrevious', handlePrevious);
        window.addEventListener('youtubeNext', handleNext);
        
        return () => {
            window.removeEventListener('videoVolumeChange', handleVolumeChange as EventListener);
            window.removeEventListener('videoMuteChange', handleMuteChange as EventListener);
            window.removeEventListener('youtubePrevious', handlePrevious);
            window.removeEventListener('youtubeNext', handleNext);
        };
    }, []);
    
    // Initialiser la vidéo locale (toujours muette)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        
        // La vidéo locale est toujours muette (on utilise YouTube pour le son)
        video.muted = true;
        video.volume = 0;
        
        const handleLoadedMetadata = () => {
            video.muted = true;
            video.volume = 0;
        };
        
        const handleCanPlay = () => {
            video.muted = true;
            video.volume = 0;
        };
        
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('canplay', handleCanPlay);
        
        // Si la vidéo est déjà chargée
        if (video.readyState >= 1) {
            video.muted = true;
            video.volume = 0;
        }
        
        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('canplay', handleCanPlay);
        };
    }, []);
    
    // Mettre en pause la vidéo et YouTube uniquement quand la fenêtre est minimisée ou dans le tray
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
                    // Mettre en pause YouTube aussi
                    if (youtubePlayerRef.current && youtubePlayerRef.current.pauseVideo) {
                        youtubePlayerRef.current.pauseVideo();
                    }
                } else {
                    // Fenêtre visible et non minimisée : reprendre la lecture
                    if (video.paused) {
                        video.play().catch(err => {
                            console.error('Erreur de reprise de la vidéo:', err);
                        });
                    }
                    // Reprendre YouTube aussi (sur toutes les pages)
                    if (youtubePlayerRef.current && youtubePlayerRef.current.playVideo) {
                        youtubePlayerRef.current.playVideo();
                    }
                }
            } catch (error) {
                // Si Tauri n'est pas disponible ou en cas d'erreur, ne rien faire
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
    }, [isHomePage]);
    
    const sidebarLeft = isCollapsed ? '5rem' : '14rem'; // w-20 = 5rem, w-56 = 14rem
    const sidebarWidth = isCollapsed ? '5rem' : '14rem';
    
    // Un seul élément vidéo qui change juste sa visibilité et son positionnement
    // Ne pas rendre la vidéo si désactivée dans les paramètres
    const shouldShowVideo = isHomePage && isVideoEnabledRef.current;

    return (
        <>
        <div
            className={`fixed top-0 h-[70vh] z-0 pointer-events-none overflow-hidden transition-all duration-500 ${!shouldShowVideo ? 'opacity-0 pointer-events-none' : ''}`}
            style={{
                left: isDesktop ? sidebarLeft : '0',
                width: isDesktop ? `calc(100% - ${sidebarWidth})` : '100%',
                transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                visibility: shouldShowVideo ? 'visible' : 'hidden'
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                loop
                playsInline
                muted={true}
                className="w-full h-full object-cover"
                style={{
                    maskImage: shouldShowVideo ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 20%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0) 100%)' : 'none',
                    WebkitMaskImage: shouldShowVideo ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 20%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0) 100%)' : 'none',
                }}
                onLoadedMetadata={() => {
                    if (videoRef.current) {
                        // La vidéo locale est toujours muette (son via YouTube)
                        videoRef.current.muted = true;
                        videoRef.current.volume = 0;
                        // Forcer la lecture
                        videoRef.current.play().catch(err => {
                            console.error('Erreur de lecture de la vidéo:', err);
                        });
                    }
                }}
                onCanPlay={() => {
                    if (videoRef.current) {
                        // La vidéo locale est toujours muette (son via YouTube)
                        videoRef.current.muted = true;
                        videoRef.current.volume = 0;
                    }
                }}
                onError={(e) => {
                    console.error('Erreur de chargement de la vidéo:', e);
                }}
            >
                <source src="/video-montage-sc.mp4" type="video/mp4" />
            </video>
        </div>
        
        {/* Iframe YouTube caché pour la playlist audio - toujours dans le DOM */}
        <div
            ref={youtubeIframeRef}
            className="fixed"
            style={{
                width: '1px',
                height: '1px',
                top: '0',
                left: '0',
                opacity: 0,
                pointerEvents: 'none',
                zIndex: -1,
            }}
        />
    </>
    );
}

