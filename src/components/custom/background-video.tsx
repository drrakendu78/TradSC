import { useEffect, useState, useRef } from 'react';
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

        // Ne pas créer le player si la musique est en pause
        if (localStorage.getItem('youtubePaused') === 'true') {
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
                        const vol = savedVolume ? parseFloat(savedVolume) : 0.1;
                        const savedMuted = localStorage.getItem('videoMuted') === 'true';
                        event.target.setVolume(savedMuted ? 0 : vol * 100);
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
            // Utiliser setVolume au lieu de mute()/unMute() car plus fiable sur player caché
            if (youtubePlayerRef.current && youtubePlayerRef.current.setVolume) {
                if (newMuted) {
                    youtubePlayerRef.current.setVolume(0);
                } else {
                    const savedVolume = localStorage.getItem('videoVolume');
                    const vol = savedVolume ? parseFloat(savedVolume) : 0.1;
                    youtubePlayerRef.current.setVolume(vol * 100);
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
        
        const handlePlayPause = (e: CustomEvent) => {
            const playing = e.detail;
            if (playing) {
                // Recréer le player YouTube s'il a été détruit
                if (!youtubePlayerRef.current && youtubeIframeRef.current && window.YT && window.YT.Player) {
                    try {
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
                                    const vol = savedVolume ? parseFloat(savedVolume) : 0.1;
                                    const savedMuted = localStorage.getItem('videoMuted') === 'true';
                                    event.target.setVolume(savedMuted ? 0 : vol * 100);
                                    event.target.playVideo();
                                },
                                onStateChange: (event: any) => {
                                    if (event.data === window.YT.PlayerState.ENDED) {
                                        event.target.playVideo();
                                    }
                                },
                            },
                        });
                    } catch (error) {
                        console.error('Erreur lors de la recréation du player YouTube:', error);
                    }
                } else if (youtubePlayerRef.current && youtubePlayerRef.current.playVideo) {
                    youtubePlayerRef.current.playVideo();
                }
            } else {
                // Détruire le player YouTube pour libérer la mémoire (~700 Mo)
                if (youtubePlayerRef.current) {
                    try {
                        youtubePlayerRef.current.destroy();
                    } catch (e) {
                        console.log('Erreur lors de la destruction du player YouTube:', e);
                    }
                    youtubePlayerRef.current = null;
                }
            }
        };

        window.addEventListener('videoVolumeChange', handleVolumeChange as EventListener);
        window.addEventListener('videoMuteChange', handleMuteChange as EventListener);
        window.addEventListener('youtubePrevious', handlePrevious);
        window.addEventListener('youtubeNext', handleNext);
        window.addEventListener('youtubePlayPause', handlePlayPause as EventListener);

        return () => {
            window.removeEventListener('videoVolumeChange', handleVolumeChange as EventListener);
            window.removeEventListener('videoMuteChange', handleMuteChange as EventListener);
            window.removeEventListener('youtubePrevious', handlePrevious);
            window.removeEventListener('youtubeNext', handleNext);
            window.removeEventListener('youtubePlayPause', handlePlayPause as EventListener);
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
    
    // Mettre en pause la vidéo locale + YouTube quand la fenêtre est
    // minimisée, cachée (tray), ou que le document devient hidden.
    //
    // ⚠️ Bug fix : auparavant on early-return ait sur !videoRef.current,
    // mais comme shouldShowVideo = false l'élément <video> n'est jamais
    // rendu → videoRef.current est null → le polling ne se montait jamais
    // et YouTube continuait à jouer en mode tray/minimisé. On découple
    // maintenant la pause YouTube (toujours active) de celle de la vidéo
    // locale (conditionnelle à la présence du ref).
    useEffect(() => {
        let appWindow: any = null;
        let checkInterval: NodeJS.Timeout | null = null;

        const pauseAll = () => {
            const video = videoRef.current;
            if (video && !video.paused) {
                try { video.pause(); } catch { /* ignore */ }
            }
            const yt = youtubePlayerRef.current;
            if (yt && typeof yt.pauseVideo === 'function') {
                try { yt.pauseVideo(); } catch { /* ignore */ }
            }
        };

        const resumeAll = () => {
            const video = videoRef.current;
            if (video && video.paused) {
                video.play().catch(err => {
                    console.error('Erreur de reprise de la vidéo:', err);
                });
            }
            const yt = youtubePlayerRef.current;
            if (yt && typeof yt.playVideo === 'function') {
                try { yt.playVideo(); } catch { /* ignore */ }
            }
        };

        const checkWindowState = async () => {
            try {
                if (!appWindow) {
                    appWindow = getCurrentWindow();
                }
                // On veut UNIQUEMENT pauser quand la fenêtre est cachée (tray)
                // ou minimisée — PAS quand l'utilisateur change d'app sans
                // minimiser StarTrad. La perte de focus seule ne doit rien
                // couper, sinon la musique d'ambiance sert à rien dès que tu
                // joues à SC en deuxième écran.
                const isVisible = await appWindow.isVisible();
                const isMinimized = await appWindow.isMinimized();

                const userPaused = localStorage.getItem('youtubePaused') === 'true';

                if (!isVisible || isMinimized) {
                    pauseAll();
                } else if (!userPaused) {
                    resumeAll();
                }
            } catch (error) {
                console.log('Impossible de vérifier l\'état de la fenêtre:', error);
            }
        };

        // Polling 500 ms (Tauri n'expose pas d'event minimize/restore fiable
        // sur toutes les versions, le polling reste le moyen le plus robuste).
        checkInterval = setInterval(checkWindowState, 500);
        checkWindowState();

        return () => {
            if (checkInterval) {
                clearInterval(checkInterval);
            }
        };
    }, []);
    
    const sidebarLeft = isCollapsed ? '5rem' : '14rem'; // w-20 = 5rem, w-56 = 14rem
    const sidebarWidth = isCollapsed ? '5rem' : '14rem';
    
    // Un seul élément vidéo qui change juste sa visibilité et son positionnement
    // Ne pas rendre la vidéo si désactivée dans les paramètres
    const shouldShowVideo = false;

    return (
        <>
        {shouldShowVideo && (
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
        )}
        
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
