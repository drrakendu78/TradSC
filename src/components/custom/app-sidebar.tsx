"use client";
import React, { useState, useEffect } from 'react';
import { 
    Menu, 
    X, 
    Settings,
    ChevronDown
} from 'lucide-react';
import { IconHome, IconBrandDiscord, IconCloud, IconBrandGithub, IconLanguage, IconUsers, IconNews, IconKeyboard, IconCalculator, IconMap2, IconSearch } from "@tabler/icons-react";
import { BrushCleaning, Download, Power, PowerOff, Loader2, RotateCcw, Monitor, Route, BarChart3, Calendar, Languages, Trash2, Save, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ColorPicker } from "@/components/custom/color-picker";
import openExternal from "@/utils/external";
import { getBuildInfo, BuildInfo } from "@/utils/buildInfo";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useStatsStore } from "@/stores/stats-store";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { User as SupabaseUser } from "@supabase/supabase-js";
import { LogIn, LogOut, User } from "lucide-react";
import AuthDialog from "./auth-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavigationItem {
    id: string;
    name: string;
    icon: React.ReactNode;
    href: string;
    tooltip?: string;
}

// Menu principal
const menuItems: NavigationItem[] = [
    {
        id: "home",
        name: "Accueil",
        icon: <IconHome size={18} />,
        href: "/",
        tooltip: "Accueil"
    },
    {
        id: "traduction",
        name: "Traduction",
        icon: <IconLanguage size={18} />,
        href: "/traduction",
        tooltip: "Traduction"
    },
    {
        id: "cache",
        name: "Cache",
        icon: <BrushCleaning size={18} />,
        href: "/cache",
        tooltip: "Cache"
    },
    {
        id: "presets-local",
        name: "Persos locaux",
        icon: <IconUsers size={18} />,
        href: "/presets-local",
        tooltip: "Persos locaux"
    },
    {
        id: "presets-remote",
        name: "Persos en ligne",
        icon: <Download size={18} />,
        href: "/presets-remote",
        tooltip: "Persos en ligne"
    },
    {
        id: "bindings",
        name: "Bindings",
        icon: <IconKeyboard size={18} />,
        href: "/bindings",
        tooltip: "Gestion des bindings"
    },
    {
        id: "graphics-settings",
        name: "Paramètres Graphiques",
        icon: <Monitor size={18} />,
        href: "/graphics-settings",
        tooltip: "Paramètres graphiques"
    },
    {
        id: "patchnotes",
        name: "Patchnotes",
        icon: <IconBrandGithub size={18} />,
        href: "/patchnotes",
        tooltip: "Patchnotes"
    },
    {
        id: "updates",
        name: "Mises à jour",
        icon: <Download size={18} />,
        href: "/updates",
        tooltip: "Mises à jour"
    }
];

// Liens réseaux sociaux
const socialLinks: NavigationItem[] = [
    {
        id: "discord",
        name: "Discord",
        icon: <IconBrandDiscord size={18} />,
        href: "https://discord.gg/gr2Y2gQbnh",
        tooltip: "Discord"
    },
    {
        id: "site",
        name: "Site web",
        icon: <IconCloud size={18} />,
        href: "https://startrad.link/",
        tooltip: "Site web"
    },
    {
        id: "uexcorp",
        name: "Routes de trading",
        icon: <Route size={18} />,
        href: "https://uexcorp.space/",
        tooltip: "Routes de trading (UEX Corp)"
    }
];

// Services externes
const externalServices: NavigationItem[] = [
    {
        id: "sc-characters",
        name: "SC Characters",
        icon: <IconCloud size={18} />,
        href: "https://www.star-citizen-characters.com/",
        tooltip: "SC Characters (Presets)"
    }
];

// Composant profil utilisateur pour la sidebar
function SidebarUserProfile({ isCollapsed, onMenuOpenChange }: { isCollapsed: boolean; onMenuOpenChange?: (open: boolean) => void }) {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [authDialogOpen, setAuthDialogOpen] = useState(false);
    const [authDefaultTab, setAuthDefaultTab] = useState<string>('login');
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
    const [menuReady, setMenuReady] = useState(false);
    const { isLocked, isCollapsed: storeIsCollapsed, setCollapsed, setLocked } = useSidebarStore();
    const previousSidebarState = React.useRef<{ isLocked: boolean; isCollapsed: boolean } | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        checkSession();
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => subscription.unsubscribe();
    }, []);

    const checkSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
        } catch (error) {
            console.error('Erreur session:', error);
        }
    };

    const handleSignOut = async () => {
        try {
            await supabase.auth.signOut();
            setUser(null);
            toast({
                title: 'Déconnexion réussie',
                description: 'À bientôt !',
            });
        } catch (error) {
            console.error('Erreur déconnexion:', error);
        }
    };

    const openCloudBackup = () => {
        setAuthDefaultTab('backup');
        setAuthDialogOpen(true);
    };

    // Récupérer l'avatar Discord
    const getAvatarUrl = () => {
        if (!user) return null;
        const metadata = user.user_metadata;
        if (metadata?.avatar_url) return metadata.avatar_url;
        if (metadata?.picture) return metadata.picture;
        return null;
    };

    const getDisplayName = () => {
        if (!user) return null;
        const metadata = user.user_metadata;
        return metadata?.full_name || metadata?.name || metadata?.preferred_username || user.email?.split('@')[0] || 'Utilisateur';
    };

    const avatarUrl = getAvatarUrl();
    const displayName = getDisplayName();

    if (user) {
        // Utilisateur connecté
        return (
            <>
                <div className={`${isCollapsed ? 'px-2' : 'px-3'}`}>
                    <DropdownMenu onOpenChange={(open) => {
                        onMenuOpenChange?.(open);
                        if (open) {
                            // Sauvegarder l'état actuel avant de modifier
                            previousSidebarState.current = { isLocked, isCollapsed: storeIsCollapsed };
                            setLocked(true); // Verrouiller la sidebar
                            setCollapsed(false); // Agrandir la sidebar
                            setMenuReady(false);
                            setTimeout(() => setMenuReady(true), 150);
                        } else {
                            // Restaurer l'état précédent quand le menu se ferme
                            if (previousSidebarState.current) {
                                const savedState = previousSidebarState.current;
                                previousSidebarState.current = null;
                                setTimeout(() => {
                                    setLocked(savedState.isLocked);
                                    // Si la sidebar était en mode hover (non verrouillée), on la réduit
                                    if (!savedState.isLocked) {
                                        setCollapsed(true);
                                    }
                                }, 100);
                            }
                        }
                    }}>
                        <DropdownMenuTrigger asChild>
                            <div 
                                className={`
                                    flex items-center gap-3 rounded-lg cursor-pointer group
                                    transition-all duration-200 ease-out
                                    hover:bg-white/5
                                    ${isCollapsed ? "justify-center p-2 h-10 w-10 mx-auto" : "px-3 py-2.5 w-full"}
                                `}
                                title={isCollapsed ? displayName || 'Mon compte' : undefined}
                            >
                                {/* Avatar */}
                                <div className="relative flex-shrink-0">
                                    {avatarUrl ? (
                                        <img 
                                            src={avatarUrl} 
                                            alt="Avatar" 
                                            className="w-8 h-8 rounded-full object-cover ring-2 ring-primary/30"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30">
                                            <User className="w-4 h-4 text-primary" />
                                        </div>
                                    )}
                                    {/* Indicateur en ligne */}
                                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                                </div>
                                
                                {/* Nom et email */}
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                                    </div>
                                )}

                                {/* Chevron */}
                                {!isCollapsed && (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
                                )}

                                {/* Tooltip collapsed */}
                                {isCollapsed && (
                                    <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl pointer-events-none">
                                        {displayName}
                                    </div>
                                )}
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            side="top"
                            sideOffset={8}
                            className="w-56"
                        >
                            {user && (
                                <DropdownMenuItem
                                    onClick={openCloudBackup}
                                    disabled={!menuReady}
                                    className="cursor-pointer"
                                >
                                    <IconCloud size={18} className="mr-2 text-blue-400" />
                                    <span>Sauvegarde Cloud</span>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                onClick={() => setSettingsDialogOpen(true)}
                                disabled={!menuReady}
                                className="cursor-pointer"
                            >
                                <Settings size={18} className="mr-2" />
                                <span>Paramètres</span>
                            </DropdownMenuItem>
                            {user && (
                                <>
                                    <div className="h-px bg-border/50 mx-2 my-1" />
                                    <DropdownMenuItem
                                        onClick={() => setSignOutDialogOpen(true)}
                                        disabled={!menuReady}
                                        className="cursor-pointer text-red-400 focus:text-red-400"
                                    >
                                        <LogOut size={18} className="mr-2" />
                                        <span>Déconnexion</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} defaultTab={authDefaultTab} />
                
                {/* Dialog Paramètres */}
                <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Paramètres</DialogTitle>
                            <DialogDescription>
                                Gérez les paramètres de l'application
                            </DialogDescription>
                        </DialogHeader>
                        <SettingsContent />
                    </DialogContent>
                </Dialog>

                {/* Dialog Confirmation Déconnexion */}
                <Dialog open={signOutDialogOpen} onOpenChange={setSignOutDialogOpen}>
                    <DialogContent className="max-w-sm">
                        <DialogHeader>
                            <DialogTitle>Confirmer la déconnexion</DialogTitle>
                            <DialogDescription>
                                Êtes-vous sûr de vouloir vous déconnecter ?
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button
                                variant="outline"
                                onClick={() => setSignOutDialogOpen(false)}
                            >
                                Annuler
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    setSignOutDialogOpen(false);
                                    handleSignOut();
                                }}
                            >
                                Se déconnecter
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    // Non connecté
    return (
        <>
            <DropdownMenu onOpenChange={(open) => onMenuOpenChange?.(open)}>
                <DropdownMenuTrigger asChild>
                    <div 
                        className={`
                            flex items-center gap-3 rounded-lg cursor-pointer group
                            transition-all duration-200 ease-out
                            bg-primary/10 hover:bg-primary/20 text-primary
                            ${isCollapsed ? "justify-center p-2 h-10 w-10 mx-auto" : "px-3 py-2.5 w-full"}
                        `}
                        title={isCollapsed ? "Mon compte" : undefined}
                    >
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 flex-shrink-0">
                            <LogIn className="w-4 h-4" />
                        </div>
                        
                        {!isCollapsed && (
                            <div className="flex-1 text-left">
                                <p className="text-sm font-medium">Mon compte</p>
                                <p className="text-xs text-muted-foreground whitespace-nowrap">Connexion & Paramètres</p>
                            </div>
                        )}

                        {/* Tooltip collapsed */}
                        {isCollapsed && (
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl pointer-events-none">
                                Mon compte
                            </div>
                        )}
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                    align={isCollapsed ? "start" : "end"} 
                    side={isCollapsed ? "right" : "top"}
                    className="w-56"
                >
                    <DropdownMenuItem
                        onClick={() => { setAuthDefaultTab('login'); setAuthDialogOpen(true); }}
                        className="cursor-pointer"
                    >
                        <LogIn size={18} className="mr-2" />
                        <span>Se connecter</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => setSettingsDialogOpen(true)}
                        className="cursor-pointer"
                    >
                        <Settings size={18} className="mr-2" />
                        <span>Paramètres</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            
            <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} defaultTab={authDefaultTab} />
            
            {/* Dialog Paramètres */}
            <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Paramètres</DialogTitle>
                        <DialogDescription>
                            Gérez les paramètres de l'application
                        </DialogDescription>
                    </DialogHeader>
                    <SettingsContent />
                </DialogContent>
            </Dialog>
        </>
    );
}

export function AppSidebar() {
    const [isOpen, setIsOpen] = useState(false);
    const { isLocked, isCollapsed, setCollapsed } = useSidebarStore(); // État depuis le store
    const [activeItem, setActiveItem] = useState<string>("");
    const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
    const location = useLocation();
    const [isToolsExpanded, setIsToolsExpanded] = useState(true);
    const [isNetworksExpanded, setIsNetworksExpanded] = useState(true);
    const [isExternalServicesExpanded, setIsExternalServicesExpanded] = useState(true);
    const [userMenuOpen, setUserMenuOpen] = useState(false);

    useEffect(() => {
        getBuildInfo()
            .then(setBuildInfo)
            .catch(() => { });
    }, []);

    useEffect(() => {
        // Définir l'élément actif basé sur la route actuelle
        const currentPath = location.pathname;
        const currentItem = menuItems.find(item => item.href === currentPath);
        if (currentItem) {
            setActiveItem(currentItem.id);
        } else if (currentPath === '/actualites') {
            setActiveItem('actualites');
        } else if (currentPath === '/dps-calculator') {
            setActiveItem('dps-calculator');
        } else if (currentPath === '/ship-maps') {
            setActiveItem('ship-maps');
        } else if (currentPath === '/finder') {
            setActiveItem('finder');
        }
    }, [location.pathname]);

    // Auto-open sidebar on desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                setIsOpen(true);
            } else {
                setIsOpen(false);
            }
        };
        
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const toggleSidebar = () => setIsOpen(!isOpen);
    
    // Handlers pour le hover (seulement si non verrouillé et menu utilisateur fermé)
    const handleMouseEnter = () => {
        if (window.innerWidth >= 768 && !isLocked && !userMenuOpen) {
            setCollapsed(false);
        }
    };
    
    const handleMouseLeave = () => {
        if (window.innerWidth >= 768 && !isLocked && !userMenuOpen) {
            setCollapsed(true);
        }
    };

    const handleItemClick = (itemId: string, href: string, isExternal: boolean = false) => {
        setActiveItem(itemId);
        if (window.innerWidth < 768) {
            setIsOpen(false);
        }
        if (isExternal) {
            openExternal(href);
        }
    };

    const getFilteredMenuItems = () => {
        if (!buildInfo) return menuItems;
        return menuItems.filter(item => {
            if (item.id === "updates" && buildInfo.distribution === "microsoft-store") {
                return false;
            }
            return true;
        });
    };

    const filteredMenuItems = getFilteredMenuItems();

    return (
        <>
            {/* Mobile hamburger button */}
            <button
                onClick={toggleSidebar}
                className="fixed top-6 left-6 z-50 p-3 rounded-lg bg-background/80 backdrop-blur-sm shadow-md border border-border md:hidden hover:bg-accent transition-all duration-300 ease-out hover:scale-110 active:scale-95"
                aria-label="Toggle sidebar"
            >
                {isOpen ? 
                    <X className="h-5 w-5 text-foreground" /> : 
                    <Menu className="h-5 w-5 text-foreground" />
                }
            </button>

            {/* Mobile overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300" 
                    onClick={toggleSidebar} 
                />
            )}

            {/* Sidebar */}
            <div
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={`
                    fixed top-0 left-0 h-full bg-background/70 backdrop-blur-xl backdrop-saturate-150 border-r border-border/50 z-40 flex flex-col
                    ${isOpen ? "translate-x-0" : "-translate-x-full"}
                    ${isCollapsed ? "w-20" : "w-56"}
                    md:translate-x-0 md:static md:z-50
                    transition-all duration-500 ease-&lsqb;cubic-bezier(0.4,0,0.2,1)&rsqb;
                `}
                style={{
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    height: '100vh',
                    maxHeight: '100vh',
                    minHeight: '100vh',
                    top: 0,
                    bottom: 0,
                    alignSelf: 'stretch',
                }}
            >
                {/* Header */}
                <div className={`${isCollapsed ? 'h-0' : 'h-8'} transition-all duration-300 overflow-hidden`}>
                </div>

                {/* Navigation */}
                <nav 
                    className={`flex-1 py-0.5 overflow-y-auto [&::-webkit-scrollbar]:hidden ${isCollapsed ? "px-2.5" : "px-3"}`} 
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {/* Outils */}
                    <div className="mb-1">
                        {isCollapsed && (
                            <button
                                onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                                className="w-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors duration-200 flex items-center justify-center"
                                title="Outils"
                            >
                                <span className="text-[10px]">Outils</span>
                            </button>
                        )}
                        {isToolsExpanded && (
                            <ul className="space-y-0">
                            {filteredMenuItems.map((item) => {
                                const isActive = activeItem === item.id;
                                const isInternal = item.href.startsWith('/');

                                return (
                                    <li key={item.id}>
                                        {isInternal ? (
                                            <Link
                                                to={item.href}
                                                onClick={() => handleItemClick(item.id, item.href, false)}
                                                className={`
                                                    flex items-center gap-3 rounded-lg text-left group relative
                                                    transition-all duration-200 ease-out
                                                    ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                                    ${isActive
                                                        ? "bg-primary/15 text-primary"
                                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                                    }
                                                `}
                                                title={isCollapsed ? item.tooltip || item.name : undefined}
                                            >
                                                {/* Indicateur actif */}
                                                {isActive && !isCollapsed && (
                                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                                )}
                                            <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`}>
                                                    {item.icon}
                                            </div>
                                            
                                            {!isCollapsed && (
                                                <span className={`text-sm ${isActive ? "font-medium" : "font-normal"}`}>
                                                {item.name}
                                            </span>
                                            )}

                                                {/* Tooltip for collapsed state */}
                                                {isCollapsed && (
                                                    <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                        {item.tooltip || item.name}
                                                    </div>
                                                )}
                                            </Link>
                                        ) : (
                                            <button
                                                onClick={() => handleItemClick(item.id, item.href, true)}
                                                className={`
                                                    flex items-center gap-3 rounded-lg text-left group relative
                                                    transition-all duration-200 ease-out
                                                    ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                                    ${isActive
                                                        ? "bg-primary/15 text-primary"
                                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                                    }
                                                `}
                                                title={isCollapsed ? item.tooltip || item.name : undefined}
                                            >
                                                {isActive && !isCollapsed && (
                                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                                )}
                                                <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`}>
                                                        {item.icon}
                                                </div>
                                                
                                                {!isCollapsed && (
                                                    <span className={`text-sm ${isActive ? "font-medium" : "font-normal"}`}>
                                                    {item.name}
                                                </span>
                                                )}

                                                {/* Tooltip for collapsed state */}
                                                {isCollapsed && (
                                                    <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                        {item.tooltip || item.name}
                                                    </div>
                                                )}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        )}
                    </div>

                    {/* Séparateur */}
                    <div className={`my-3 ${isCollapsed ? 'px-2' : 'px-4'}`}>
                        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    </div>

                    {/* Réseaux / actu SC */}
                    <div className="mb-2">
                        <button
                            onClick={() => setIsNetworksExpanded(!isNetworksExpanded)}
                            className={`
                                w-full text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest 
                                hover:text-muted-foreground transition-all duration-200 flex items-center gap-2 group
                                ${isCollapsed ? "px-2 py-1 justify-center" : "px-3 py-1.5"}
                            `}
                            title={isCollapsed ? "Réseaux / actu SC" : undefined}
                        >
                            {isCollapsed ? (
                                <span className="text-[9px]">•••</span>
                            ) : (
                                <>
                                    <span>Réseaux / Actu SC</span>
                                    <ChevronDown 
                                        size={12} 
                                        className={`transition-transform duration-300 ${isNetworksExpanded ? '' : '-rotate-90'}`} 
                                    />
                                </>
                        )}
                        </button>
                        {isNetworksExpanded && (
                            <ul className="space-y-0">
                            {/* Actualités */}
                            <li>
                                <Link
                                    to="/actualites"
                                    onClick={() => handleItemClick('actualites', '/actualites')}
                                    className={`
                                        flex items-center gap-3 rounded-lg text-left group relative
                                        transition-all duration-200 ease-out
                                        ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                        ${activeItem === 'actualites'
                                            ? "bg-primary/15 text-primary"
                                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                        }
                                    `}
                                    title={isCollapsed ? "Actualités Star Citizen" : undefined}
                                >
                                    {activeItem === 'actualites' && !isCollapsed && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                    )}
                                    <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'actualites' ? '' : 'group-hover:scale-110'}`}>
                                        <IconNews size={18} />
                                    </div>
                                    {!isCollapsed && (
                                        <span className={`text-sm ${activeItem === 'actualites' ? "font-medium" : "font-normal"}`}>
                                        Actualités
                                    </span>
                                    )}
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                            Actualités Star Citizen
                                        </div>
                                    )}
                                </Link>
                            </li>

                            {/* DPS Calculator */}
                            <li>
                                <Link
                                    to="/dps-calculator"
                                    onClick={() => handleItemClick('dps-calculator', '/dps-calculator')}
                                    className={`
                                        flex items-center gap-3 rounded-lg text-left group relative
                                        transition-all duration-200 ease-out
                                        ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                        ${activeItem === 'dps-calculator'
                                            ? "bg-primary/15 text-primary"
                                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                        }
                                    `}
                                    title={isCollapsed ? "DPS Calculator" : undefined}
                                >
                                    {activeItem === 'dps-calculator' && !isCollapsed && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                    )}
                                    <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'dps-calculator' ? '' : 'group-hover:scale-110'}`}>
                                        <IconCalculator size={18} />
                                    </div>
                                    {!isCollapsed && (
                                        <span className={`text-sm ${activeItem === 'dps-calculator' ? "font-medium" : "font-normal"}`}>
                                        DPS Calculator
                                    </span>
                                    )}
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                            DPS Calculator
                                        </div>
                                    )}
                                </Link>
                            </li>

                            {/* Ship Maps (ADI) */}
                            <li>
                                <Link
                                    to="/ship-maps"
                                    onClick={() => handleItemClick('ship-maps', '/ship-maps')}
                                    className={`
                                        flex items-center gap-3 rounded-lg text-left group relative
                                        transition-all duration-200 ease-out
                                        ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                        ${activeItem === 'ship-maps'
                                            ? "bg-primary/15 text-primary"
                                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                        }
                                    `}
                                    title={isCollapsed ? "Cartes de vaisseaux (ADI)" : undefined}
                                >
                                    {activeItem === 'ship-maps' && !isCollapsed && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                    )}
                                    <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'ship-maps' ? '' : 'group-hover:scale-110'}`}>
                                        <IconMap2 size={18} />
                                    </div>
                                    {!isCollapsed && (
                                        <span className={`text-sm ${activeItem === 'ship-maps' ? "font-medium" : "font-normal"}`}>
                                            Cartes vaisseaux
                                        </span>
                                    )}
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                            Cartes de vaisseaux (ADI)
                                        </div>
                                    )}
                                </Link>
                            </li>

                            {/* Finder (Cornerstone) */}
                            <li>
                                <Link
                                    to="/finder"
                                    onClick={() => handleItemClick('finder', '/finder')}
                                    className={`
                                        flex items-center gap-3 rounded-lg text-left group relative
                                        transition-all duration-200 ease-out
                                        ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                        ${activeItem === 'finder'
                                            ? "bg-primary/15 text-primary"
                                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                        }
                                    `}
                                    title={isCollapsed ? "Finder (Cornerstone)" : undefined}
                                >
                                    {activeItem === 'finder' && !isCollapsed && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                    )}
                                    <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'finder' ? '' : 'group-hover:scale-110'}`}>
                                        <IconSearch size={18} />
                                    </div>
                                    {!isCollapsed && (
                                        <span className={`text-sm ${activeItem === 'finder' ? "font-medium" : "font-normal"}`}>
                                            Finder
                                        </span>
                                    )}
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                            Finder (Cornerstone)
                                        </div>
                                    )}
                                </Link>
                            </li>

                            {/* Social Links */}
                            {socialLinks.map((link) => (
                                <li key={link.id}>
                                    <button
                                        onClick={() => handleItemClick(link.id, link.href, true)}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === link.id
                                                ? "bg-primary/15 text-primary"
                                                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                            }
                                        `}
                                        title={isCollapsed ? link.tooltip || link.name : undefined}
                                    >
                                        {activeItem === link.id && !isCollapsed && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                        )}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === link.id ? '' : 'group-hover:scale-110'}`}>
                                                {link.icon}
                                            </div>
                                        {!isCollapsed && (
                                            <span className={`text-sm ${activeItem === link.id ? "font-medium" : "font-normal"}`}>
                                            {link.name}
                                        </span>
                                        )}
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                {link.tooltip || link.name}
                                                <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        )}
                    </div>

                    {/* Séparateur */}
                    <div className={`my-3 ${isCollapsed ? 'px-2' : 'px-4'}`}>
                        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    </div>

                    {/* Services externes */}
                    <div className="mb-2">
                        <button
                            onClick={() => setIsExternalServicesExpanded(!isExternalServicesExpanded)}
                            className={`
                                w-full text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest 
                                hover:text-muted-foreground transition-all duration-200 flex items-center gap-2 group
                                ${isCollapsed ? "px-2 py-1 justify-center" : "px-3 py-1.5"}
                            `}
                            title={isCollapsed ? "Services externes" : undefined}
                        >
                            {isCollapsed ? (
                                <span className="text-[9px]">•••</span>
                            ) : (
                                <>
                                    <span>Services Externes</span>
                                    <ChevronDown 
                                        size={12} 
                                        className={`transition-transform duration-300 ${isExternalServicesExpanded ? '' : '-rotate-90'}`} 
                                    />
                                </>
                        )}
                        </button>
                        {isExternalServicesExpanded && (
                            <ul className="space-y-0">
                            {externalServices.map((service) => (
                                <li key={service.id}>
                                    <button
                                        onClick={() => handleItemClick(service.id, service.href, true)}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === service.id
                                                ? "bg-primary/15 text-primary"
                                                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                            }
                                        `}
                                        title={isCollapsed ? service.tooltip || service.name : undefined}
                                    >
                                        {activeItem === service.id && !isCollapsed && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                                        )}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === service.id ? '' : 'group-hover:scale-110'}`}>
                                                {service.icon}
                                            </div>
                                        {!isCollapsed && (
                                            <span className={`text-sm ${activeItem === service.id ? "font-medium" : "font-normal"}`}>
                                            {service.name}
                                        </span>
                                        )}
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                {service.tooltip || service.name}
                                                <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        )}
                    </div>
                </nav>

                {/* Bottom section with user profile */}
                <div className="mt-auto">
                    {/* Séparateur */}
                    <div className={`mb-2 ${isCollapsed ? 'px-2' : 'px-4'}`}>
                        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                                    </div>
                                    
                    {/* User Profile */}
                    <div className={`${isCollapsed ? 'px-2' : 'px-3'} pb-3`}>
                        <SidebarUserProfile isCollapsed={isCollapsed} onMenuOpenChange={setUserMenuOpen} />
                    </div>
                </div>
            </div>
        </>
    );
}

interface BackgroundServiceConfig {
    enabled: boolean;
    check_interval_minutes: number;
    language: string;
}

function SettingsContent() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [serviceRunning, setServiceRunning] = useState(false);

    // Configuration du service de fond
    const [config, setConfig] = useState<BackgroundServiceConfig>({
        enabled: false,
        check_interval_minutes: 5,
        language: 'fr',
    });

    // État du démarrage automatique
    const [autoStartupEnabled, setAutoStartupEnabled] = useState(false);
    const [checkingAutoStartup, setCheckingAutoStartup] = useState(true);

    // État de la vidéo de fond
    const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(() => {
        const saved = localStorage.getItem('backgroundVideoEnabled');
        return saved === null ? true : saved === 'true';
    });

    // État Discord Rich Presence (activé par défaut + migration v3.1.1)
    const [discordEnabled, setDiscordEnabled] = useState(() => {
        const migrationKey = 'discordRPCMigrated_v311';
        const hasMigrated = localStorage.getItem(migrationKey);

        if (!hasMigrated) {
            // Migration v3.1.1: forcer l'activation pour tous les utilisateurs (une seule fois)
            localStorage.setItem('discordRPCEnabled', 'true');
            localStorage.setItem(migrationKey, 'true');
            return true;
        }

        // Après migration, respecter le choix de l'utilisateur
        const saved = localStorage.getItem('discordRPCEnabled');
        return saved === null ? true : saved === 'true';
    });
    const [discordConnecting, setDiscordConnecting] = useState(false);
    const [discordConnected, setDiscordConnected] = useState(false);

    // État du cache de traductions
    interface CacheInfo {
        total_files: number;
        total_size: number;
        cache_path: string;
    }
    const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
    const [loadingCache, setLoadingCache] = useState(false);

    // Charger la configuration au montage
    useEffect(() => {
        loadConfiguration();
        checkAutoStartupStatus();
    }, []);

    // Connecter Discord au démarrage et maintenir la connexion active
    useEffect(() => {
        let heartbeatInterval: NodeJS.Timeout | null = null;

        const tryConnectDiscord = async () => {
            if (!discordEnabled) return false;

            try {
                const result = await invoke<boolean>('check_and_reconnect_discord');
                setDiscordConnected(result);
                return result;
            } catch {
                // Discord pas disponible, on garde l'état activé mais pas connecté
                setDiscordConnected(false);
                return false;
            }
        };

        // Tentative initiale de connexion
        tryConnectDiscord();

        // Vérification périodique toutes les 30 secondes pour maintenir/rétablir la connexion
        if (discordEnabled) {
            heartbeatInterval = setInterval(async () => {
                await tryConnectDiscord();
            }, 30000); // 30 secondes
        }

        return () => {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
        };
    }, [discordEnabled]);

    // Charger les infos du cache
    const loadCacheInfo = async () => {
        try {
            const info = await invoke<CacheInfo>('get_translation_cache_info');
            setCacheInfo(info);
        } catch (error) {
            console.error('Erreur chargement cache info:', error);
        }
    };

    useEffect(() => {
        loadCacheInfo();
    }, []);

    const handleClearCache = async () => {
        setLoadingCache(true);
        try {
            const count = await invoke<number>('clear_translation_cache');
            toast({
                title: 'Cache vidé',
                description: `${count} fichier(s) supprimé(s)`,
            });
            await loadCacheInfo();
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `${error}`,
                variant: 'destructive',
            });
        } finally {
            setLoadingCache(false);
        }
    };

    const handleOpenCacheFolder = async () => {
        try {
            await invoke('open_translation_cache_folder');
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `${error}`,
                variant: 'destructive',
            });
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleDiscordToggle = async (checked: boolean) => {
        setDiscordConnecting(true);
        try {
            if (checked) {
                // Activer - on sauvegarde l'état même si Discord n'est pas disponible
                localStorage.setItem('discordRPCEnabled', 'true');
                setDiscordEnabled(true);

                // Tenter de se connecter maintenant
                try {
                    const connected = await invoke<boolean>('check_and_reconnect_discord');
                    setDiscordConnected(connected);
                    toast({
                        title: connected ? 'Discord connecté' : 'Discord activé',
                        description: connected
                            ? 'Votre activité est affichée sur Discord'
                            : 'La connexion sera établie dès que Discord sera ouvert',
                    });
                } catch {
                    setDiscordConnected(false);
                    toast({
                        title: 'Discord activé',
                        description: 'La connexion sera établie dès que Discord sera ouvert',
                    });
                }
            } else {
                // Désactiver
                await invoke('disconnect_discord');
                localStorage.setItem('discordRPCEnabled', 'false');
                setDiscordEnabled(false);
                setDiscordConnected(false);
                toast({
                    title: 'Discord déconnecté',
                    description: 'Votre activité ne sera plus affichée sur Discord',
                });
            }
        } catch (error) {
            toast({
                title: 'Erreur Discord',
                description: `${error}`,
                variant: 'destructive',
            });
        } finally {
            setDiscordConnecting(false);
        }
    };

    const loadConfiguration = async () => {
        try {
            const loadedConfig = await invoke<BackgroundServiceConfig>('load_background_service_config');
            setConfig(loadedConfig);
            setServiceRunning(loadedConfig.enabled);
        } catch (error) {
            console.error('Erreur lors du chargement de la configuration:', error);
        }
    };

    const checkAutoStartupStatus = async () => {
        try {
            const enabled = await invoke<boolean>('is_auto_startup_enabled');
            setAutoStartupEnabled(enabled);
        } catch (error) {
            console.error('Erreur lors de la vérification du démarrage auto:', error);
        } finally {
            setCheckingAutoStartup(false);
        }
    };

    const handleAutoStartupToggle = async (checked: boolean) => {
        setLoading(true);
        try {
            if (checked) {
                await invoke('enable_auto_startup');
                toast({
                    title: 'Démarrage automatique activé',
                    description: 'L\'application se lancera au démarrage de Windows',
                });
            } else {
                await invoke('disable_auto_startup');
                toast({
                    title: 'Démarrage automatique désactivé',
                    description: 'L\'application ne se lancera plus automatiquement',
                });
            }
            setAutoStartupEnabled(checked);
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `Impossible de ${checked ? 'activer' : 'désactiver'} le démarrage automatique: ${error}`,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleServiceToggle = async (checked: boolean) => {
        setLoading(true);
        try {
            const newConfig = { ...config, enabled: checked };

            // Sauvegarder la configuration
            await invoke('save_background_service_config', { config: newConfig });
            await invoke('set_background_service_config', { config: newConfig });

            // Démarrer ou arrêter le service
            if (checked) {
                await invoke('start_background_service');
                toast({
                    title: 'Service démarré',
                    description: 'Le service de mise à jour automatique est maintenant actif',
                });
            } else {
                await invoke('stop_background_service');
                toast({
                    title: 'Service arrêté',
                    description: 'Le service de mise à jour automatique a été arrêté',
                });
            }

            setConfig(newConfig);
            setServiceRunning(checked);
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `Impossible de ${checked ? 'démarrer' : 'arrêter'} le service: ${error}`,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleIntervalChange = async (value: number) => {
        if (value < 1) {
            toast({
                title: 'Intervalle invalide',
                description: 'L\'intervalle minimum est de 1 minute',
                variant: 'destructive',
            });
            setConfig({ ...config, check_interval_minutes: 1 });
            return;
        }

        const newConfig = { ...config, check_interval_minutes: value };
        setConfig(newConfig);

        try {
            await invoke('save_background_service_config', { config: newConfig });
            await invoke('set_background_service_config', { config: newConfig });

            // Redémarrer le service si il est actif pour appliquer le nouvel intervalle immédiatement
            if (serviceRunning) {
                try {
                    await invoke('stop_background_service');
                    // Petit délai pour s'assurer que le service est bien arrêté
                    await new Promise(resolve => setTimeout(resolve, 100));
                    await invoke('start_background_service');
                } catch (restartError) {
                    console.error('Erreur lors du redémarrage du service:', restartError);
                    toast({
                        title: 'Avertissement',
                        description: 'La configuration a été sauvegardée mais le service n\'a pas pu être redémarré. Redémarrez-le manuellement.',
                        variant: 'default',
                    });
                }
            }

            if (value < 5) {
                toast({
                    title: 'Configuration mise à jour',
                    description: `Intervalle de vérification: ${value} minute(s). 5 minutes sont recommandées pour éviter une charge excessive.`,
                    variant: 'default',
                });
            } else {
                toast({
                    title: 'Configuration mise à jour',
                    description: `Intervalle de vérification: ${value} minute(s)`,
                });
            }
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `Impossible de sauvegarder la configuration: ${error}`,
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="space-y-6 py-4">
            {/* Apparence */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold">Apparence</h3>
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Couleur du thème</span>
                    <ColorPicker />
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Vidéo de fond</span>
                        <p className="text-sm text-muted-foreground">
                            Afficher la vidéo de fond sur l'écran d'accueil
                        </p>
                    </div>
                    <Switch
                        id="background-video"
                        aria-label="Vidéo de fond"
                        checked={backgroundVideoEnabled}
                        onCheckedChange={(checked) => {
                            setBackgroundVideoEnabled(checked);
                            localStorage.setItem('backgroundVideoEnabled', String(checked));
                            window.dispatchEvent(new CustomEvent('backgroundVideoToggle', { detail: checked }));
                            toast({
                                title: checked ? 'Vidéo activée' : 'Vidéo désactivée',
                                description: checked
                                    ? 'La vidéo de fond sera affichée sur l\'accueil'
                                    : 'La vidéo de fond a été masquée',
                            });
                        }}
                    />
                </div>
            </div>

            <Separator />

            {/* Démarrage automatique */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold">Démarrage automatique</h3>
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Lancer au démarrage de Windows</span>
                        <p className="text-sm text-muted-foreground">
                            L'application se lancera minimisée dans la barre système
                        </p>
                    </div>
                    <Switch
                        id="auto-startup"
                        aria-label="Lancer au démarrage de Windows"
                        checked={autoStartupEnabled}
                        onCheckedChange={handleAutoStartupToggle}
                        disabled={loading || checkingAutoStartup}
                    />
                </div>
            </div>

            <Separator />

            {/* Service de mise à jour automatique */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold">Mises à jour automatiques</h3>

                {/* Toggle du service */}
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Service de fond</span>
                        <p className="text-sm text-muted-foreground">
                            Vérifie périodiquement les mises à jour de traduction
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {serviceRunning && (
                            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                                <Power className="w-4 h-4" />
                                Actif
                            </span>
                        )}
                        {!serviceRunning && config.enabled && (
                            <span className="flex items-center gap-1 text-sm text-yellow-600 dark:text-yellow-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Démarrage...
                            </span>
                        )}
                        {!serviceRunning && !config.enabled && (
                            <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                                <PowerOff className="w-4 h-4" />
                                Inactif
                            </span>
                        )}
                        <Switch
                            id="background-service"
                            aria-label="Service de fond"
                            checked={config.enabled}
                            onCheckedChange={handleServiceToggle}
                            disabled={loading}
                        />
                    </div>
                </div>

                {/* Configuration de l'intervalle */}
                <div className="space-y-3">
                    <Label htmlFor="check-interval">Intervalle de vérification (minutes)</Label>
                    <div className="flex items-center gap-3">
                        <Input
                            id="check-interval"
                            type="number"
                            min="1"
                            max="1440"
                            value={config.check_interval_minutes}
                            onChange={(e) => {
                                const value = parseInt(e.target.value);
                                if (!isNaN(value)) {
                                    setConfig({ ...config, check_interval_minutes: value });
                                }
                            }}
                            onBlur={(e) => {
                                const value = parseInt(e.target.value);
                                if (!isNaN(value) && value >= 1) {
                                    handleIntervalChange(value);
                                }
                            }}
                            className="w-32"
                            disabled={loading}
                        />
                        <span className="text-sm text-muted-foreground">
                            Vérification toutes les {config.check_interval_minutes} minute(s)
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Minimum: 1 minute • Recommandé: 5 minutes ou plus
                    </p>
                </div>

                {/* Informations */}
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                    <h4 className="font-medium text-sm">Comment ça fonctionne ?</h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Le service vérifie périodiquement les mises à jour de traduction sur GitHub</li>
                        <li>Si une mise à jour est disponible, elle est automatiquement installée</li>
                        <li>Seules les versions du jeu avec traduction installée sont mises à jour</li>
                        <li>Le service fonctionne en arrière-plan sans ralentir votre système</li>
                    </ul>
                </div>
            </div>

            <Separator />

            {/* Discord Rich Presence */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <IconBrandDiscord size={20} className="text-[#5865F2]" />
                    Discord Rich Presence
                </h3>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Afficher l'activité
                        </span>
                        <p className="text-sm text-muted-foreground">
                            Montre que vous utilisez StarTrad FR sur votre profil Discord
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {discordEnabled && !discordConnecting && discordConnected && (
                            <span className="flex items-center gap-1 text-sm text-[#5865F2]">
                                <IconBrandDiscord size={16} />
                                Connecté
                            </span>
                        )}
                        {discordEnabled && !discordConnecting && !discordConnected && (
                            <span className="flex items-center gap-1 text-sm text-amber-500">
                                <IconBrandDiscord size={16} />
                                En attente
                            </span>
                        )}
                        {discordConnecting && (
                            <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                            </span>
                        )}
                        <Switch
                            id="discord-rpc"
                            aria-label="Discord Rich Presence"
                            checked={discordEnabled}
                            onCheckedChange={handleDiscordToggle}
                            disabled={discordConnecting}
                        />
                    </div>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                    <h4 className="font-medium text-sm">Comment ça fonctionne ?</h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Affiche "StarTrad FR" sur votre profil Discord</li>
                        <li>Se connecte automatiquement dès que Discord est ouvert</li>
                        <li>Reconnexion automatique si Discord redémarre</li>
                        <li><span className="text-[#5865F2]">Connecté</span> = actif sur Discord • <span className="text-amber-500">En attente</span> = Discord pas détecté</li>
                    </ul>
                </div>
            </div>

            <Separator />

            {/* Cache de traductions / Mode hors-ligne */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Save className="h-5 w-5 text-green-500" />
                    Cache de traductions
                </h3>

                <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Fichiers en cache</span>
                        <span className="text-sm font-medium">{cacheInfo?.total_files || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Taille totale</span>
                        <span className="text-sm font-medium">{formatBytes(cacheInfo?.total_size || 0)}</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenCacheFolder}
                        className="flex-1"
                    >
                        Ouvrir le dossier
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleClearCache}
                        disabled={loadingCache || (cacheInfo?.total_files || 0) === 0}
                        className="flex-1"
                    >
                        {loadingCache ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Trash2 className="h-4 w-4 mr-2" />
                                Vider le cache
                            </>
                        )}
                    </Button>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                    <h4 className="font-medium text-sm">Mode hors-ligne</h4>
                    <p className="text-sm text-muted-foreground">
                        Les traductions installées sont automatiquement mises en cache.
                        Vous pouvez les réinstaller même sans connexion internet depuis la page Traduction.
                    </p>
                </div>
            </div>

            <Separator />

            {/* Réinitialisation */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold">Réinitialisation</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Popup du premier lancement</span>
                            <p className="text-sm text-muted-foreground">
                                Réafficher la popup de bienvenue et d'information de sécurité
                            </p>
                        </div>
                        <Button
                            id="reset-warning"
                            aria-label="Réinitialiser la popup du premier lancement"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                localStorage.removeItem('security-warning-seen');
                                // Supprimer aussi toutes les annonces (clés commençant par startradfr_)
                                const keysToRemove: string[] = [];
                                for (let i = 0; i < localStorage.length; i++) {
                                    const key = localStorage.key(i);
                                    if (key && key.startsWith('startradfr_')) {
                                        keysToRemove.push(key);
                                    }
                                }
                                keysToRemove.forEach(key => localStorage.removeItem(key));

                                toast({
                                    title: 'Popups réinitialisées',
                                    description: 'Redémarrage de l\'application...',
                                });
                                // Recharger l'application pour afficher immédiatement les popups
                                setTimeout(() => {
                                    window.location.reload();
                                }, 500);
                            }}
                            className="flex items-center gap-2"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Réinitialiser
                        </Button>
                    </div>
                </div>
            </div>

            <Separator />

            {/* Statistiques */}
            <StatsSection />
        </div>
    );
}

interface AppStats {
    first_install_date: string | null;
    days_since_install: number | null;
    local_backups_count: number;
    translations_installed_count: number;
    translated_versions: string[];
}

function StatsSection() {
    const { cacheCleanCount, characterDownloadCount, getAppUsageDays, firstUseDate, backupCreatedCount } = useStatsStore();
    const [appStats, setAppStats] = useState<AppStats | null>(null);
    const [cloudBackupsCount, setCloudBackupsCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    // Utiliser le store (sync cloud) en priorité, sinon le backend
    const appUsageDays = getAppUsageDays();

    useEffect(() => {
        const fetchStats = async () => {
            try {
                // Récupérer les stats depuis Rust
                const stats = await invoke<AppStats>("get_app_stats");
                setAppStats(stats);

                // Si pas de firstUseDate dans le store mais le backend en a une, l'initialiser
                if (!firstUseDate && stats.first_install_date) {
                    // On stocke directement dans localStorage pour ne pas incrémenter les compteurs
                    const currentStorage = localStorage.getItem("stats-storage");
                    if (currentStorage) {
                        const parsed = JSON.parse(currentStorage);
                        if (!parsed.state.firstUseDate) {
                            parsed.state.firstUseDate = stats.first_install_date;
                            localStorage.setItem("stats-storage", JSON.stringify(parsed));
                        }
                    }
                }

                // Récupérer le nombre de backups cloud si connecté
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const { data: backups } = await supabase.storage
                        .from("user-backups")
                        .list(`${session.user.id}/backups`);
                    setCloudBackupsCount(backups?.length || 0);
                }
            } catch (error) {
                console.error("Erreur lors du chargement des stats:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [firstUseDate]);

    // Utiliser backupCreatedCount du store (sync cloud) pour les backups locaux
    const totalBackups = backupCreatedCount + cloudBackupsCount;

    // Priorité : store (sync cloud) > backend (système)
    const daysToShow = appUsageDays !== null ? appUsageDays : appStats?.days_since_install;

    const stats = [
        {
            icon: <Calendar className="h-4 w-4 text-primary" />,
            label: "Utilisation",
            value: daysToShow !== null && daysToShow !== undefined
                ? `${daysToShow} jour${daysToShow > 1 ? 's' : ''}`
                : "Nouveau",
            description: "Depuis la première utilisation"
        },
        {
            icon: <Languages className="h-4 w-4 text-blue-500" />,
            label: "Traductions actives",
            value: appStats?.translations_installed_count?.toString() || "0",
            description: appStats?.translated_versions?.join(", ") || "Aucune"
        },
        {
            icon: <Trash2 className="h-4 w-4 text-orange-500" />,
            label: "Nettoyages cache",
            value: cacheCleanCount.toString(),
            description: "Cette session"
        },
        {
            icon: <Save className="h-4 w-4 text-green-500" />,
            label: "Backups",
            value: totalBackups.toString(),
            description: `${backupCreatedCount} local${cloudBackupsCount > 0 ? ` + ${cloudBackupsCount} cloud` : ''}`
        },
        {
            icon: <Users className="h-4 w-4 text-purple-500" />,
            label: "Presets téléchargés",
            value: characterDownloadCount.toString(),
            description: "Personnages"
        }
    ];

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Statistiques</h3>
                </div>
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Statistiques</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {stats.map((stat, index) => (
                    <div
                        key={index}
                        className="bg-muted/30 rounded-lg p-3 border border-border/30 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2 mb-1">
                            {stat.icon}
                            <span className="text-xs text-muted-foreground">{stat.label}</span>
                        </div>
                        <p className="text-xl font-bold">{stat.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate" title={stat.description}>
                            {stat.description}
                        </p>
                    </div>
                ))}
            </div>

            <p className="text-xs text-muted-foreground text-center">
                Données réelles depuis le système
            </p>
        </div>
    );
}
