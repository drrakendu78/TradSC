import { motion } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
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
    Map
} from 'lucide-react';
import RecentPatchNotes from '@/components/custom/recent-patchnotes';
import RecentActualites from '@/components/custom/recent-actualites';
import { AnnouncementDialog } from '@/components/custom/announcement-dialog';
import { useSidebarStore } from '@/stores/sidebar-store';

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
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${color} text-white shrink-0`}>
                            {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
                                {title}
                            </h3>
                            <p className="text-xs text-muted-foreground truncate">
                                {description}
                            </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </CardContent>
                </Card>
                            </Link>
        </motion.div>
    );
}

function Home() {
    const { isCollapsed } = useSidebarStore();
    const [isDesktop, setIsDesktop] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(false);
    
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
    
    // Mettre en pause la vidéo quand la fenêtre est minimisée ou en arrière-plan
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Fenêtre cachée/minimisée : mettre en pause
                video.pause();
            } else {
                // Fenêtre visible : reprendre la lecture
                video.play().catch(err => {
                    console.error('Erreur de reprise de la vidéo:', err);
                });
            }
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Détecter aussi quand la fenêtre perd le focus (blur)
        const handleBlur = () => {
            video.pause();
        };
        
        const handleFocus = () => {
            if (!document.hidden) {
                video.play().catch(err => {
                    console.error('Erreur de reprise de la vidéo:', err);
                });
            }
        };
        
        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);
        
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);
    
    const sidebarLeft = isCollapsed ? '5rem' : '14rem'; // w-20 = 5rem, w-56 = 14rem
    const sidebarWidth = isCollapsed ? '5rem' : '14rem';
    
    return (
        <div className="flex w-full h-full flex-col gap-6 p-4 overflow-y-auto relative">
            
            {/* Vidéo de fond avec fondu progressif */}
            <div 
                className="fixed top-0 h-[70vh] z-0 pointer-events-none overflow-hidden transition-all duration-500"
                style={{
                    left: isDesktop ? sidebarLeft : '0',
                    width: isDesktop ? `calc(100% - ${sidebarWidth})` : '100%',
                    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
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
                        maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 35%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0) 70%)',
                        WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 35%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0) 70%)',
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
                className="relative z-10"
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
                            <Link to="/traduction">
                                <Button size="lg" className="gap-2 text-base px-6 shadow-lg hover:shadow-primary/25 transition-shadow">
                                    <Globe2 className="h-5 w-5" />
                                    Installer la traduction
                                    <Sparkles className="h-4 w-4" />
                                </Button>
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* Actions rapides */}
            <div className="space-y-3 relative z-10">
                <motion.h2 
                    className="text-lg font-semibold flex items-center gap-2 px-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                >
                    <Sparkles className="h-4 w-4 text-primary" />
                    Actions rapides
                </motion.h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                </div>
            </div>

            {/* Section infos */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 relative z-10">
                
                {/* Patchnotes */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <Card className="bg-background/40 h-full">
                        <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                                <FileText className="h-4 w-4 text-primary" />
                                Patchnotes StarTrad
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <RecentPatchNotes max={3} />
                            <Link to="/patchnotes">
                                <Button variant="ghost" size="sm" className="w-full mt-3 text-xs">
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
                    <Card className="bg-background/40 h-full">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Newspaper className="h-4 w-4 text-primary" />
                                Actualités Star Citizen
                            </CardTitle>
                    </CardHeader>
                        <CardContent>
                        <RecentActualites max={3} />
                            <Link to="/actualites">
                                <Button variant="ghost" size="sm" className="w-full mt-3 text-xs">
                                    Voir toutes les actualités
                                    <ArrowRight className="h-3 w-3 ml-1" />
                                </Button>
                            </Link>
                    </CardContent>
                </Card>
                </motion.div>

            </div>

            {/* Footer hint */}
            <motion.p 
                className="text-center text-xs text-muted-foreground/60 pb-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
            >
                💡 Astuce : Utilisez le menu à gauche pour naviguer rapidement
            </motion.p>

        </div>
    );
}

export default Home;
