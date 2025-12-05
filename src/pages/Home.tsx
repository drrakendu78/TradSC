import { motion } from 'framer-motion';
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
    return (
        <div className="flex w-full h-full flex-col gap-6 p-4 overflow-y-auto">
            
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
            <div className="space-y-3">
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                
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
