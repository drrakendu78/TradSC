"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { 
    X, 
    Settings,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Pin,
    PinOff
} from 'lucide-react';
import { IconHome, IconBrandDiscord, IconCloud, IconBrandGithub, IconLanguage, IconUsers, IconNews, IconKeyboard, IconCalculator, IconMap2, IconSearch, IconSwords, IconPackage, IconHammer, IconBook, IconDatabase } from "@tabler/icons-react";
import { BrushCleaning, Download, Power, PowerOff, Loader2, RotateCcw, Monitor, Route, BarChart3, Calendar, Languages, Trash2, Save, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ColorPicker } from "@/components/custom/color-picker";
import openExternal, { openExternalCustom } from "@/utils/external";
import { useCustomLinksStore } from "@/stores/custom-links-store";
import CustomLinkDialog, { getIconByName } from "./custom-link-dialog";
import { Plus, Pencil } from "lucide-react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { supabase } from "@/lib/supabase";
import { User as SupabaseUser } from "@supabase/supabase-js";
import { LogIn, LogOut, User } from "lucide-react";
import AuthDialog from "./auth-dialog";
import { useAvatar } from "@/hooks/useAvatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompanionCard } from "@/components/custom/CompanionCard";

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
        href: "https://discord.startrad.link/",
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

// Services externes (liens personnalisés uniquement maintenant)
const externalServices: NavigationItem[] = [];

// Composant profil utilisateur pour la sidebar
function SidebarUserProfile({ isCollapsed, onMenuOpenChange }: { isCollapsed: boolean; onMenuOpenChange?: (open: boolean) => void }) {
    const [user, setUser] = React.useState<SupabaseUser | null>(null);
    const [authDialogOpen, setAuthDialogOpen] = React.useState(false);
    const [authDefaultTab, setAuthDefaultTab] = React.useState('login');
    const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false);
    const [signOutDialogOpen, setSignOutDialogOpen] = React.useState(false);
    const [menuReady, setMenuReady] = React.useState(false);
    const { isCollapsed: storeIsCollapsed, setCollapsed } = useSidebarStore();
    const previousSidebarState = React.useRef<{ isCollapsed: boolean } | null>(null);
    const { toast } = useToast();
    const profileMenuContentClass =
        "w-[266px] overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.80)] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.26)] backdrop-blur-xl backdrop-saturate-150";
    const profileMenuItemClass =
        "group h-10 rounded-xl px-3 text-[13px] font-medium text-foreground/90 transition-all duration-200 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground data-[highlighted]:bg-[hsl(var(--primary)/0.12)] data-[highlighted]:text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary/85";
    const profileMenuDangerItemClass =
        "group h-10 rounded-xl px-3 text-[13px] font-medium text-red-600 dark:text-red-300 transition-all duration-200 hover:bg-red-500/14 hover:text-red-700 dark:hover:text-red-200 data-[highlighted]:bg-red-500/14 data-[highlighted]:text-red-700 dark:data-[highlighted]:text-red-200 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-red-500";

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

    const { avatarUrl } = useAvatar(user);

    const getDisplayName = () => {
        if (!user) return null;
        const metadata = user.user_metadata;
        return metadata?.full_name || metadata?.name || metadata?.preferred_username || user.email?.split('@')[0] || 'Utilisateur';
    };

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
                            previousSidebarState.current = { isCollapsed: storeIsCollapsed };
                            setCollapsed(false); // Agrandir la sidebar
                            setMenuReady(false);
                            setTimeout(() => setMenuReady(true), 150);
                        } else {
                            // Restaurer l'état précédent quand le menu se ferme
                            if (previousSidebarState.current) {
                                const savedState = previousSidebarState.current;
                                previousSidebarState.current = null;
                                setTimeout(() => {
                                    // Restaurer l'état d'origine pour éviter un collapse forcé
                                    setCollapsed(savedState.isCollapsed);
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
                            className={profileMenuContentClass}
                        >
                            {user && (
                                <DropdownMenuItem
                                    onClick={openCloudBackup}
                                    disabled={!menuReady}
                                    className={profileMenuItemClass}
                                >
                                    <IconCloud size={18} className="mr-2 text-blue-400" />
                                    <span>Sauvegarde Cloud</span>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                onClick={() => setSettingsDialogOpen(true)}
                                disabled={!menuReady}
                                className={profileMenuItemClass}
                            >
                                <Settings size={18} className="mr-2" />
                                <span>Paramètres</span>
                            </DropdownMenuItem>
                            {user && (
                                <>
                                    <div className="mx-2 my-1 h-px bg-gradient-to-r from-transparent via-border/70 to-transparent" />
                                    <DropdownMenuItem
                                        onClick={() => setSignOutDialogOpen(true)}
                                        disabled={!menuReady}
                                        className={profileMenuDangerItemClass}
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
                    <DialogContent
                        overlayClassName="bg-black/18 backdrop-blur-sm"
                        className="max-w-4xl max-h-[90vh] overflow-y-auto border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                    >
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
                                {'\u00CAtes-vous s\u00FBr de vouloir vous d\u00E9connecter ?'}
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
                    className={profileMenuContentClass}
                >
                    <DropdownMenuItem
                        onClick={() => { setAuthDefaultTab('login'); setAuthDialogOpen(true); }}
                        className={profileMenuItemClass}
                    >
                        <LogIn size={18} className="mr-2" />
                        <span>Se connecter</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => setSettingsDialogOpen(true)}
                        className={profileMenuItemClass}
                    >
                        <Settings size={18} className="mr-2" />
                        <span>Paramètres</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} defaultTab={authDefaultTab} />

            {/* Dialog Paramètres */}
            <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
                <DialogContent
                    overlayClassName="bg-black/18 backdrop-blur-sm"
                    className="max-w-4xl max-h-[90vh] overflow-y-auto border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                >
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
    const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.innerWidth >= 768);
    const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
    const [isToolsExpanded, setIsToolsExpanded] = useState(true);
    const [isToolsSubExpanded, setIsToolsSubExpanded] = useState(false);
    const [isNetworksExpanded, setIsNetworksExpanded] = useState(true);
    const [isExternalServicesExpanded, setIsExternalServicesExpanded] = useState(true);
    const [, setUserMenuOpen] = useState(false);
    const { isLocked, setLocked, isCollapsed, setCollapsed } = useSidebarStore(); // Etat depuis le store
    const location = useLocation();

    // Custom links
    const { links: customLinks } = useCustomLinksStore();
    const [customLinkDialogOpen, setCustomLinkDialogOpen] = useState(false);
    const [editingLink, setEditingLink] = useState<{ id: string; name: string; url: string; icon?: string } | null>(null);

    const activeItem = useMemo(() => {
        const currentPath = location.pathname;
        const currentItem = menuItems.find(item => item.href === currentPath);
        if (currentItem) return currentItem.id;
        if (currentPath === '/actualites') return 'actualites';
        if (currentPath === '/dps-calculator') return 'dps-calculator';
        if (currentPath === '/ship-maps') return 'ship-maps';
        if (currentPath === '/finder') return 'finder';
        if (currentPath === '/verseguide') return 'verseguide';

        if (currentPath === '/cargo') return 'cargo';
        if (currentPath === '/scmdb') return 'scmdb';
        return '';
    }, [location.pathname]);

    useEffect(() => {
        getBuildInfo()
            .then(info => setBuildInfo(info))
            .catch(() => { });
    }, []);

    // Drawer mode + mode ?pingl? desktop
    useEffect(() => {
        const handleResize = () => {
            const desktop = window.innerWidth >= 768;
            setIsDesktopViewport(desktop);
            if (!desktop) {
                setIsOpen(false);
            } else if (isLocked) {
                setIsOpen(true);
            }
        };
        
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isLocked]);

    useEffect(() => {
        if (isLocked && isCollapsed) {
            setCollapsed(false);
        }
    }, [isLocked, isCollapsed, setCollapsed]);

    const isSidebarVisible = isOpen || (isLocked && isDesktopViewport);

    const toggleSidebar = () => {
        if (isLocked && isDesktopViewport && isSidebarVisible) {
            setLocked(false);
            setIsOpen(false);
            return;
        }

        setIsOpen(prev => {
            const next = !prev;
            if (next) setCollapsed(false);
            return next;
        });
    };

    const closeSidebar = () => {
        setIsOpen(false);
        if (isLocked && isDesktopViewport) {
            setLocked(false);
        }
    };

    const handleItemClick = (_itemId: string, href: string, isExternal: boolean = false) => {
        if (!isLocked || !isDesktopViewport) {
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
    const showSidebarHandle = !(isLocked && isDesktopViewport);

    return (
        <>
            {/* Trigger drawer (mobile + desktop non epingle) */}
            <button
                onClick={toggleSidebar}
                className={`
                    fixed left-0 top-1/2 z-[70] flex h-14 w-8 -translate-y-1/2 items-center justify-center
                    rounded-r-xl border border-l-0 backdrop-blur-xl transition-all duration-350 ease-out hover:w-9 active:scale-[0.98]
                    ${isSidebarVisible
                        ? "sidebar-toggle-open border-primary/45 bg-primary/26 hover:bg-primary/34"
                        : "border-primary/45 bg-primary/30 hover:bg-primary/38"
                    }
                    ${showSidebarHandle
                        ? "translate-x-0 scale-100 opacity-100 pointer-events-auto"
                        : "-translate-x-2 scale-95 opacity-0 pointer-events-none"
                    }
                `}
                style={{
                    boxShadow: showSidebarHandle
                        ? "0 0 22px hsl(var(--primary) / 0.45)"
                        : "0 0 0 hsl(var(--primary) / 0)",
                }}
                aria-label="Toggle sidebar"
                title={isSidebarVisible ? "Fermer la navigation" : "Ouvrir la navigation"}
            >
                {isSidebarVisible ?
                    <ChevronLeft className="h-4 w-4 text-foreground" /> :
                    <ChevronRight className="h-4 w-4 text-foreground" />
                }
            </button>

            {/* Backdrop drawer */}
            <div
                className={`
                    fixed inset-0 z-30 bg-black/45 backdrop-blur-md transition-opacity duration-300
                    ${isOpen && !isLocked ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
                `}
                role="button"
                tabIndex={0}
                aria-label="Fermer la sidebar"
                onClick={closeSidebar}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') closeSidebar(); }}
            />

            {/* Sidebar */}
            <div
                className={`
                    app-sidebar-shell fixed left-4 top-4 bottom-4 z-40 flex flex-col origin-left border backdrop-blur-2xl backdrop-saturate-150 will-change-transform
                    ${isSidebarVisible ? "translate-x-0 scale-100 opacity-100" : "-translate-x-[108%] scale-[0.98] opacity-0 pointer-events-none"}
                    ${isCollapsed ? "w-[88px]" : "w-[320px]"}
                    rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.45)] transition-all duration-500
                    ${isLocked
                        ? 'border-border/50 bg-white/80 dark:bg-[hsl(var(--background)/0.55)]'
                        : 'border-border/55 bg-white/96 dark:bg-[hsl(var(--background)/0.92)]'
                    }
                `}
                style={{
                    backdropFilter: 'blur(8px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(180%)',
                    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease-out',
                }}
            >
                {/* Header */}
                <div className="app-sidebar-header flex h-12 shrink-0 items-center justify-between border-b border-border/35 px-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/85">Navigation</span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                const next = !isLocked;
                                setLocked(next);
                                if (next) {
                                    setCollapsed(false);
                                    setIsOpen(true);
                                }
                            }}
                            className="app-sidebar-icon-btn rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                            aria-label={isLocked ? "Desepingler la navigation" : "Epingler la navigation"}
                            title={isLocked ? "Desepingler la navigation" : "Epingler la navigation"}
                        >
                            {isLocked ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                        </button>
                        <button
                            onClick={closeSidebar}
                            className="app-sidebar-icon-btn rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                            aria-label="Fermer la navigation"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav 
                    className={`app-sidebar-nav flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden ${isCollapsed ? "px-2.5" : "px-3"}`}
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {/* Outils */}
                    <div className="mb-2">
                        {isCollapsed && (
                            <button
                                onClick={() => setIsToolsExpanded(prev => !prev)}
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
                            onClick={() => setIsNetworksExpanded(prev => !prev)}
                            className={`
                                w-full text-[11px] font-semibold uppercase tracking-widest rounded-md
                                transition-all duration-200 flex items-center gap-2 group
                                ${isNetworksExpanded
                                    ? "text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/5"
                                    : "text-muted-foreground bg-white/5 hover:bg-white/8 hover:text-foreground"
                                }
                                ${isCollapsed ? "px-2 py-1 justify-center" : "px-3 py-1.5 justify-between"}
                            `}
                            title={isCollapsed ? "Réseaux / actu SC" : undefined}
                        >
                            {isCollapsed ? (
                                <span className="text-[9px]">⬢⬢⬢</span>
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

                            {/* Discord + Site web */}
                            {socialLinks.filter(l => l.id !== 'uexcorp').map((link) => (
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
                                            <span className={`text-sm ${activeItem === link.id ? "font-medium" : "font-normal"}`}>{link.name}</span>
                                        )}
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                {link.tooltip || link.name}
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}

                        </ul>
                        )}
                    </div>

                    {/* Outils SC - section indépendante */}
                    <div className="mb-2">
                        {!isCollapsed && (
                            <button
                                onClick={() => setIsToolsSubExpanded(p => !p)}
                                className={`
                                    w-full text-[11px] font-semibold uppercase tracking-widest rounded-md
                                    transition-all duration-200 flex items-center gap-2 group
                                    px-3 py-1.5 justify-between
                                    ${isToolsSubExpanded
                                        ? "text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/5"
                                        : "text-muted-foreground bg-white/5 hover:bg-white/8 hover:text-foreground"
                                    }
                                `}
                            >
                                <span>Outils SC</span>
                                <ChevronDown size={12} className={`transition-transform duration-300 ${isToolsSubExpanded ? '' : '-rotate-90'}`} />
                            </button>
                        )}
                        {(isToolsSubExpanded || isCollapsed) && (
                            <ul className="space-y-0">
                                {/* DPS Calculator */}
                                <li>
                                    <Link
                                        to="/dps-calculator"
                                        onClick={() => handleItemClick('dps-calculator', '/dps-calculator')}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === 'dps-calculator' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
                                        `}
                                        title={isCollapsed ? "DPS Calculator" : undefined}
                                    >
                                        {activeItem === 'dps-calculator' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'dps-calculator' ? '' : 'group-hover:scale-110'}`}><IconCalculator size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'dps-calculator' ? "font-medium" : "font-normal"}`}>DPS Calculator</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">DPS Calculator</div>}
                                    </Link>
                                </li>
                                {/* Ship Maps */}
                                <li>
                                    <Link
                                        to="/ship-maps"
                                        onClick={() => handleItemClick('ship-maps', '/ship-maps')}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === 'ship-maps' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
                                        `}
                                        title={isCollapsed ? "Cartes de vaisseaux (ADI)" : undefined}
                                    >
                                        {activeItem === 'ship-maps' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'ship-maps' ? '' : 'group-hover:scale-110'}`}><IconMap2 size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'ship-maps' ? "font-medium" : "font-normal"}`}>Cartes vaisseaux</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Cartes de vaisseaux (ADI)</div>}
                                    </Link>
                                </li>
                                {/* Finder */}
                                <li>
                                    <Link
                                        to="/finder"
                                        onClick={() => handleItemClick('finder', '/finder')}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === 'finder' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
                                        `}
                                        title={isCollapsed ? "Finder (Cornerstone)" : undefined}
                                    >
                                        {activeItem === 'finder' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'finder' ? '' : 'group-hover:scale-110'}`}><IconSearch size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'finder' ? "font-medium" : "font-normal"}`}>Finder</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Finder (Cornerstone)</div>}
                                    </Link>
                                </li>
                                {/* Zones PVP */}
                                <li>
                                    <Link
                                        to="/pvp"
                                        onClick={() => handleItemClick('pvp', '/pvp')}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === 'pvp' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
                                        `}
                                        title={isCollapsed ? "Zones PVP" : undefined}
                                    >
                                        {activeItem === 'pvp' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'pvp' ? '' : 'group-hover:scale-110'}`}><IconSwords size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'pvp' ? "font-medium" : "font-normal"}`}>Zones PVP</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Zones PVP</div>}
                                    </Link>
                                </li>
                                {/* Cargo */}
                                <li>
                                    <Link
                                        to="/cargo"
                                        onClick={() => handleItemClick('cargo', '/cargo')}
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            ${activeItem === 'cargo' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
                                        `}
                                        title={isCollapsed ? "Grilles Cargo" : undefined}
                                    >
                                        {activeItem === 'cargo' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'cargo' ? '' : 'group-hover:scale-110'}`}><IconPackage size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'cargo' ? "font-medium" : "font-normal"}`}>Grilles Cargo</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Grilles Cargo</div>}
                                    </Link>
                                </li>
                                {/* VerseGuide */}
                                <li>
                                    <Link
                                        to="/verseguide"
                                        onClick={() => handleItemClick('verseguide', '/verseguide')}
                                        className={`flex items-center gap-3 rounded-lg group relative transition-all duration-200 ease-out ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"} ${activeItem === 'verseguide' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                                        title={isCollapsed ? "VerseGuide" : undefined}
                                    >
                                        {activeItem === 'verseguide' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'verseguide' ? '' : 'group-hover:scale-110'}`}><IconBook size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'verseguide' ? "font-medium" : "font-normal"}`}>VerseGuide</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">VerseGuide</div>}
                                    </Link>
                                </li>
                                {/* Crafter */}
                                <li>
                                    <button
                                        onClick={() => invoke('open_overlay', { id: 'crafter', url: 'https://www.sccrafter.com/', x: 100.0, y: 100.0, width: 600.0, height: 800.0, opacity: 0.9 }).catch(console.error)}
                                        className={`flex items-center gap-3 rounded-lg text-left group relative transition-all duration-200 ease-out ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"} text-muted-foreground hover:bg-white/5 hover:text-foreground`}
                                        title={isCollapsed ? "Crafter" : undefined}
                                    >
                                        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"><IconHammer size={18} /></div>
                                        {!isCollapsed && <span className="text-sm font-normal">Crafter</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Crafter</div>}
                                    </button>
                                </li>
                                {/* SCMDB */}
                                <li>
                                    <Link
                                        to="/scmdb"
                                        onClick={() => handleItemClick('scmdb', '/scmdb')}
                                        className={`flex items-center gap-3 rounded-lg group relative transition-all duration-200 ease-out ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"} ${activeItem === 'scmdb' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                                        title={isCollapsed ? "SCMDB" : undefined}
                                    >
                                        {activeItem === 'scmdb' && !isCollapsed && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                                        <div className={`flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 ${activeItem === 'scmdb' ? '' : 'group-hover:scale-110'}`}><IconDatabase size={18} /></div>
                                        {!isCollapsed && <span className={`text-sm ${activeItem === 'scmdb' ? "font-medium" : "font-normal"}`}>SCMDB</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">SCMDB</div>}
                                    </Link>
                                </li>
                                {/* Routes de trading */}
                                <li>
                                    <button
                                        onClick={() => invoke('open_webview_overlay', { id: 'uexcorp', url: 'https://uexcorp.space/', width: 600.0, height: 800.0, opacity: 0.9 }).catch(console.error)}
                                        className={`flex items-center gap-3 rounded-lg text-left group relative transition-all duration-200 ease-out ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"} text-muted-foreground hover:bg-white/5 hover:text-foreground`}
                                        title={isCollapsed ? "Routes de trading (UEX Corp)" : undefined}
                                    >
                                        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"><Route size={18} /></div>
                                        {!isCollapsed && <span className="text-sm font-normal">Routes de trading</span>}
                                        {isCollapsed && <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">Routes de trading (UEX Corp)</div>}
                                    </button>
                                </li>
                            </ul>
                        )}
                    </div>

                    {/* Séparateur */}
                    <div className={`my-3 ${isCollapsed ? 'px-2' : 'px-4'}`}>
                        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    </div>

                    {/* Services externes */}
                    <div className="mb-2">
                        <div
                            className={`
                                w-full text-[11px] font-semibold uppercase tracking-widest rounded-md
                                transition-all duration-200 flex items-center gap-2 group
                                ${isExternalServicesExpanded
                                    ? "text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/5"
                                    : "text-muted-foreground bg-white/5 hover:bg-white/8 hover:text-foreground"
                                }
                                ${isCollapsed ? "px-2 py-1 justify-center" : "px-3 py-1.5 justify-between"}
                            `}
                            title={isCollapsed ? "Services externes" : undefined}
                        >
                            {isCollapsed ? (
                                <button
                                    onClick={() => setIsExternalServicesExpanded(prev => !prev)}
                                    className="text-[9px]"
                                >
                                    ⬢⬢⬢
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setIsExternalServicesExpanded(prev => !prev)}
                                        className="flex items-center justify-between flex-1 whitespace-nowrap"
                                    >
                                        <span>Services Externes</span>
                                        <ChevronDown
                                            size={12}
                                            className={`transition-transform duration-300 ${isExternalServicesExpanded ? '' : '-rotate-90'}`}
                                        />
                                    </button>
                                    {isExternalServicesExpanded && (
                                        <button
                                            onClick={() => { setEditingLink(null); setCustomLinkDialogOpen(true); }}
                                            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                                            title="Ajouter un lien"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    )}
                                </>
                        )}
                        </div>
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

                            {/* Liens personnalisés */}
                            {customLinks.map((link) => (
                                <li key={link.id}>
                                    <button
                                        type="button"
                                        className={`
                                            flex items-center gap-3 rounded-lg text-left group relative
                                            transition-all duration-200 ease-out
                                            ${isCollapsed ? "py-2 h-10 w-10 mx-auto justify-center" : "py-2.5 w-full px-3"}
                                            text-muted-foreground hover:bg-white/5 hover:text-foreground
                                        `}
                                        title={isCollapsed ? link.name : undefined}
                                        onClick={() => openExternalCustom(link.url).catch(console.error)}
                                    >
                                        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
                                            {(() => {
                                                const IconComponent = getIconByName(link.icon);
                                                return <IconComponent size={18} />;
                                            })()}
                                        </div>
                                        {!isCollapsed && (
                                            <>
                                                <span className="text-sm font-normal flex-1 truncate">{link.name}</span>
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        setEditingLink(link); setCustomLinkDialogOpen(true);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.stopPropagation();
                                                            e.preventDefault();
                                                            setEditingLink(link); setCustomLinkDialogOpen(true);
                                                        }
                                                    }}
                                                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                                                    title="Modifier"
                                                >
                                                    <Pencil size={12} />
                                                </span>
                                            </>
                                        )}
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border/50 shadow-xl">
                                                {link.name}
                                                <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        )}

                        {/* Dialog pour ajouter/modifier un lien */}
                        <CustomLinkDialog
                            open={customLinkDialogOpen}
                            onOpenChange={(open) => setCustomLinkDialogOpen(open)}
                            editingLink={editingLink}
                        />
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
                        <SidebarUserProfile isCollapsed={isCollapsed} onMenuOpenChange={(open) => setUserMenuOpen(open)} />
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

interface CacheInfo {
    total_files: number;
    total_size: number;
    cache_path: string;
}

type AmbilightPreset = 'soft' | 'cinema' | 'intense';

function isAmbilightPreset(value: string | null): value is AmbilightPreset {
    return value === 'soft' || value === 'cinema' || value === 'intense';
}

type OverlayHubPreset =
    | 'free'
    | 'top'
    | 'top-left'
    | 'top-right'
    | 'left'
    | 'right'
    | 'bottom-left'
    | 'bottom-right';

const OVERLAY_HUB_PRESET_STORAGE_KEY = 'overlay_hub_preset_v1';
const OVERLAY_HUB_PRESET_EVENT = 'overlay_hub_preset_change';

function isOverlayHubPreset(value: string | null): value is OverlayHubPreset {
    return (
        value === 'free' ||
        value === 'top' ||
        value === 'top-left' ||
        value === 'top-right' ||
        value === 'left' ||
        value === 'right' ||
        value === 'bottom-left' ||
        value === 'bottom-right'
    );
}

function SettingsContent() {
    const { toast } = useToast();
    const [{ loading, serviceRunning, config, autoStartupEnabled, checkingAutoStartup }, setServiceState] = useState<{ loading: boolean; serviceRunning: boolean; config: BackgroundServiceConfig; autoStartupEnabled: boolean; checkingAutoStartup: boolean }>({
        loading: false,
        serviceRunning: false,
        config: { enabled: false, check_interval_minutes: 5, language: 'fr' },
        autoStartupEnabled: false,
        checkingAutoStartup: true,
    });
    // Etat Discord Rich Presence (activé par défaut + migration v3.1.1)
    const [{ discordEnabled, discordConnecting }, setDiscordState] = useState<{ discordEnabled: boolean; discordConnecting: boolean }>(() => {
        const migrationKey = 'discordRPCMigrated_v311';
        const hasMigrated = localStorage.getItem(migrationKey);
        let initDiscordEnabled: boolean;
        if (!hasMigrated) {
            // Migration v3.1.1: forcer l'activation pour tous les utilisateurs (une seule fois)
            localStorage.setItem('discordRPCEnabled', 'true');
            localStorage.setItem(migrationKey, 'true');
            initDiscordEnabled = true;
        } else {
            // Après migration, respecter le choix de l'utilisateur
            const saved = localStorage.getItem('discordRPCEnabled');
            initDiscordEnabled = saved === null ? true : saved === 'true';
        }
        return { discordEnabled: initDiscordEnabled, discordConnecting: false };
    });
    const [discordConnected, setDiscordConnected] = useState(false);
    // Etat du cache de traductions + vidéo de fond + preset ambilight
    const [{ cacheInfo, loadingCache, backgroundVideoEnabled, ambilightPreset }, setCacheState] = useState<{
        cacheInfo: CacheInfo | null;
        loadingCache: boolean;
        backgroundVideoEnabled: boolean;
        ambilightPreset: AmbilightPreset;
    }>(() => {
        const saved = localStorage.getItem('backgroundVideoEnabled');
        const savedPreset = localStorage.getItem('ambilightPreset');
        return {
            cacheInfo: null,
            loadingCache: false,
            backgroundVideoEnabled: saved === null ? true : saved === 'true',
            ambilightPreset: isAmbilightPreset(savedPreset) ? savedPreset : 'soft',
        };
    });
    const [overlayHubPreset, setOverlayHubPreset] = useState<OverlayHubPreset>(() => {
        const saved = localStorage.getItem(OVERLAY_HUB_PRESET_STORAGE_KEY);
        return isOverlayHubPreset(saved) ? saved : 'free';
    });

    // Charger la configuration au montage
    useEffect(() => {
        loadConfiguration();
        checkAutoStartupStatus();
    }, []);

    // Connecter Discord au démarrage et maintenir la connexion active
    useEffect(() => {
        let heartbeatInterval: NodeJS.Timeout | null = null;

        const getDiscordStatus = async (): Promise<boolean> => {
            if (!discordEnabled) return false;
            try {
                return await invoke<boolean>('check_and_reconnect_discord');
            } catch {
                return false;
            }
        };

        // Tentative initiale de connexion
        getDiscordStatus().then(setDiscordConnected);

        // Vérification périodique toutes les 30 secondes pour maintenir/rétablir la connexion
        if (discordEnabled) {
            heartbeatInterval = setInterval(() => {
                getDiscordStatus().then(setDiscordConnected);
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
            setCacheState(s => ({ ...s, cacheInfo: info }));
        } catch (error) {
            console.error('Erreur chargement cache info:', error);
        }
    };

    useEffect(() => {
        loadCacheInfo();
    }, []);

    const handleClearCache = async () => {
        setCacheState(s => ({ ...s, loadingCache: true }));
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
            setCacheState(s => ({ ...s, loadingCache: false }));
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
        setDiscordState(s => ({ ...s, discordConnecting: true }));
        try {
            if (checked) {
                // Activer - on sauvegarde l'état même si Discord n'est pas disponible
                localStorage.setItem('discordRPCEnabled', 'true');
                setDiscordState(s => ({ ...s, discordEnabled: true }));
                invoke('update_tray_service', { service: 'discord', enabled: true }).catch(() => {});

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
                setDiscordState(s => ({ ...s, discordEnabled: false }));
                invoke('update_tray_service', { service: 'discord', enabled: false }).catch(() => {});
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
            setDiscordState(s => ({ ...s, discordConnecting: false }));
        }
    };

    const loadConfiguration = async () => {
        try {
            const loadedConfig = await invoke<BackgroundServiceConfig>('load_background_service_config');
            setServiceState(s => ({ ...s, config: loadedConfig, serviceRunning: loadedConfig.enabled }));
        } catch (error) {
            console.error('Erreur lors du chargement de la configuration:', error);
        }
    };

    const checkAutoStartupStatus = async () => {
        try {
            const enabled = await invoke<boolean>('is_auto_startup_enabled');
            setServiceState(s => ({ ...s, autoStartupEnabled: enabled }));
        } catch (error) {
            console.error('Erreur lors de la vérification du démarrage auto:', error);
        } finally {
            setServiceState(s => ({ ...s, checkingAutoStartup: false }));
        }
    };

    const handleAutoStartupToggle = async (checked: boolean) => {
        setServiceState(s => ({ ...s, loading: true }));
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
            setServiceState(s => ({ ...s, autoStartupEnabled: checked }));
            invoke('update_tray_service', { service: 'auto_startup', enabled: checked }).catch(() => {});
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `Impossible de ${checked ? 'activer' : 'désactiver'} le démarrage automatique: ${error}`,
                variant: 'destructive',
            });
        } finally {
            setServiceState(s => ({ ...s, loading: false }));
        }
    };

    const handleServiceToggle = async (checked: boolean) => {
        setServiceState(s => ({ ...s, loading: true }));
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

            setServiceState(s => ({ ...s, config: newConfig, serviceRunning: checked }));
            invoke('update_tray_service', { service: 'bg_service', enabled: checked }).catch(() => {});
        } catch (error) {
            toast({
                title: 'Erreur',
                description: `Impossible de ${checked ? 'démarrer' : 'arrêter'} le service: ${error}`,
                variant: 'destructive',
            });
        } finally {
            setServiceState(s => ({ ...s, loading: false }));
        }
    };

    const handleIntervalChange = async (value: number) => {
        if (value < 1) {
            toast({
                title: 'Intervalle invalide',
                description: 'L\'intervalle minimum est de 1 minute',
                variant: 'destructive',
            });
            setServiceState(s => ({ ...s, config: { ...s.config, check_interval_minutes: 1 } }));
            return;
        }

        const newConfig = { ...config, check_interval_minutes: value };
        setServiceState(s => ({ ...s, config: newConfig }));

        try {
            await Promise.all([
                invoke('save_background_service_config', { config: newConfig }),
                invoke('set_background_service_config', { config: newConfig }),
            ]);

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

    const settingsPanelClass = "space-y-4 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.34)] p-4 sm:p-5 shadow-[0_14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl";
    const settingsHeaderClass = "flex items-center gap-2 text-base font-semibold tracking-tight text-foreground";
    const settingRowClass = "flex items-start justify-between gap-4 rounded-xl border border-border/40 bg-[hsl(var(--background)/0.26)] px-3 py-3";
    const settingInfoClass = "space-y-1 pr-2";
    const settingsHintBoxClass = "rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] p-3 space-y-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]";
    const tabTriggerClass = "group flex h-auto min-h-[52px] items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 data-[state=active]:-translate-y-[1px] data-[state=active]:border-primary/45 data-[state=active]:bg-[linear-gradient(140deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.36))] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_0_1px_hsl(var(--primary)/0.30),0_10px_24px_hsl(var(--primary)/0.16)] data-[state=active]:animate-[tab-activate_260ms_ease-out]";
    const cacheFilesCount = cacheInfo?.total_files || 0;
    const serviceStatusLabel = serviceRunning ? "Actif" : config.enabled ? "Boot" : "Off";
    const discordStatusLabel = !discordEnabled ? "Off" : discordConnected ? "On" : "Wait";

    return (
        <div className="space-y-4 py-1">
            <section className="relative overflow-hidden rounded-2xl border border-border/50 bg-[hsl(var(--background)/0.30)] p-4 sm:p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%),radial-gradient(100%_80%_at_0%_100%,hsl(var(--primary)/0.08),transparent_58%)]" />
                <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">Parametres systeme</p>
                        <h3 className="text-lg font-semibold tracking-tight">Control center StarTrad</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[430px]">
                        <div className="rounded-xl border border-border/40 bg-background/45 px-3 py-2.5">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Service</p>
                            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                                {serviceRunning ? <Power className="h-4 w-4 text-emerald-400" /> : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                                {serviceRunning ? "Actif" : "Inactif"}
                            </p>
                        </div>
                        <div className="rounded-xl border border-border/40 bg-background/45 px-3 py-2.5">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Discord</p>
                            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                                <IconBrandDiscord size={14} className={discordEnabled ? "text-[#8f97ff]" : "text-muted-foreground"} />
                                {discordEnabled ? "Actif" : "Off"}
                            </p>
                        </div>
                        <div className="rounded-xl border border-border/40 bg-background/45 px-3 py-2.5">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Video</p>
                            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                                <Monitor className={`h-4 w-4 ${backgroundVideoEnabled ? "text-primary" : "text-muted-foreground"}`} />
                                {backgroundVideoEnabled ? "Visible" : "Masquee"}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <Tabs defaultValue="general" className="space-y-3">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.26)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:grid-cols-4">
                    <TabsTrigger value="general" className={tabTriggerClass}>
                        <span className="flex items-center gap-2">
                            <Monitor className="h-4 w-4 text-primary" />
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">General</span>
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${backgroundVideoEnabled ? "border-primary/45 text-primary" : "border-border/60 text-muted-foreground"}`}>
                            {backgroundVideoEnabled ? "Video" : "Off"}
                        </span>
                    </TabsTrigger>

                    <TabsTrigger value="services" className={tabTriggerClass}>
                        <span className="flex items-center gap-2">
                            <Settings className="h-4 w-4 text-primary" />
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">Services</span>
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${serviceRunning ? "border-emerald-500/55 text-emerald-300" : config.enabled ? "border-amber-500/55 text-amber-300" : "border-border/60 text-muted-foreground"}`}>
                            {serviceStatusLabel}
                        </span>
                    </TabsTrigger>

                    <TabsTrigger value="cache" className={tabTriggerClass}>
                        <span className="flex items-center gap-2">
                            <Save className="h-4 w-4 text-green-400" />
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">Cache</span>
                        </span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-foreground/90">
                            {cacheFilesCount}
                        </span>
                    </TabsTrigger>

                    <TabsTrigger value="stats" className={tabTriggerClass}>
                        <span className="flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">Stats</span>
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${discordStatusLabel === "On" ? "border-[#5865F2]/55 text-[#9aa0ff]" : "border-border/60 text-muted-foreground"}`}>
                            {discordStatusLabel}
                        </span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4">
                    <section className={settingsPanelClass}>
                        <h4 className={settingsHeaderClass}>
                            <Monitor className="h-5 w-5 text-primary" />
                            Experience visuelle
                        </h4>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Couleur du theme</span>
                                <p className="text-sm text-muted-foreground">Adapte instantanement la DA de l'application.</p>
                            </div>
                            <ColorPicker />
                        </div>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Video de fond</span>
                                <p className="text-sm text-muted-foreground">Afficher la video sur l'ecran d'accueil.</p>
                            </div>
                            <Switch
                                id="background-video"
                                aria-label="Video de fond"
                                checked={backgroundVideoEnabled}
                                onCheckedChange={(checked) => {
                                    setCacheState(s => ({ ...s, backgroundVideoEnabled: checked }));
                                    localStorage.setItem('backgroundVideoEnabled', String(checked));
                                    window.dispatchEvent(new CustomEvent('backgroundVideoToggle', { detail: checked }));
                                    invoke('update_tray_service', { service: 'video', enabled: checked }).catch(() => { });
                                    toast({
                                        title: checked ? 'Video activee' : 'Video desactivee',
                                        description: checked
                                            ? 'La video de fond sera affichee sur l\'accueil'
                                            : 'La video de fond a ete masquee',
                                    });
                                }}
                            />
                        </div>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Preset Ambilight</span>
                                <p className="text-sm text-muted-foreground">Regle la diffusion lumineuse autour de la video.</p>
                            </div>
                            <Select
                                value={ambilightPreset}
                                onValueChange={(value) => {
                                    if (!isAmbilightPreset(value)) return;
                                    setCacheState((s) => ({ ...s, ambilightPreset: value }));
                                    localStorage.setItem('ambilightPreset', value);
                                    window.dispatchEvent(new CustomEvent('ambilightPresetChange', { detail: value }));
                                    toast({
                                        title: 'Preset Ambilight applique',
                                        description: value === 'soft' ? 'Mode doux active' : value === 'cinema' ? 'Mode cinema active' : 'Mode intense active',
                                    });
                                }}
                            >
                                <SelectTrigger className="w-[180px]" aria-label="Preset Ambilight">
                                    <SelectValue placeholder="Choisir un preset" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="soft">Doux</SelectItem>
                                    <SelectItem value="cinema">Cinema</SelectItem>
                                    <SelectItem value="intense">Intense</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Position du hub overlay</span>
                                <p className="text-sm text-muted-foreground">Choisissez une position fixe ou laissez « Libre » pour déplacer le hub à la souris.</p>
                            </div>
                            <Select
                                value={overlayHubPreset}
                                onValueChange={(value) => {
                                    if (!isOverlayHubPreset(value)) return;
                                    setOverlayHubPreset(value);
                                    localStorage.setItem(OVERLAY_HUB_PRESET_STORAGE_KEY, value);
                                    emit(OVERLAY_HUB_PRESET_EVENT, { preset: value }).catch(() => {});
                                }}
                            >
                                <SelectTrigger className="w-[200px]" aria-label="Position du hub overlay">
                                    <SelectValue placeholder="Choisir une position" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="free">Libre (glisser à la souris)</SelectItem>
                                    <SelectItem value="top">Haut centre</SelectItem>
                                    <SelectItem value="top-left">Haut gauche</SelectItem>
                                    <SelectItem value="top-right">Haut droite</SelectItem>
                                    <SelectItem value="left">Gauche (centré)</SelectItem>
                                    <SelectItem value="right">Droite (centré)</SelectItem>
                                    <SelectItem value="bottom-left">Bas gauche</SelectItem>
                                    <SelectItem value="bottom-right">Bas droite</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Lancer au demarrage de Windows</span>
                                <p className="text-sm text-muted-foreground">L'application se lancera minimisee dans la barre systeme.</p>
                            </div>
                            <Switch id="auto-startup" aria-label="Lancer au demarrage de Windows" checked={autoStartupEnabled} onCheckedChange={handleAutoStartupToggle} disabled={loading || checkingAutoStartup} />
                        </div>
                    </section>
                </TabsContent>

                <TabsContent value="services" className="space-y-4">
                    <section className={settingsPanelClass}>
                        <h4 className={settingsHeaderClass}>
                            <Settings className="h-5 w-5 text-primary" />
                            Services & presence
                        </h4>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Service de fond</span>
                                <p className="text-sm text-muted-foreground">Verifie periodiquement les mises a jour de traduction.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {serviceRunning && <span className="text-xs font-medium text-emerald-400">Actif</span>}
                                {!serviceRunning && config.enabled && <span className="text-xs font-medium text-amber-400">Demarrage...</span>}
                                {!serviceRunning && !config.enabled && <span className="text-xs font-medium text-muted-foreground">Inactif</span>}
                                <Switch id="background-service" aria-label="Service de fond" checked={config.enabled} onCheckedChange={handleServiceToggle} disabled={loading} />
                            </div>
                        </div>

                        <div className={settingsHintBoxClass}>
                            <Label htmlFor="check-interval">Intervalle de verification (minutes)</Label>
                            <div className="flex items-center gap-3">
                                <Input
                                    id="check-interval"
                                    type="number"
                                    min="1"
                                    max="1440"
                                    value={config.check_interval_minutes}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        if (!isNaN(value)) setServiceState(s => ({ ...s, config: { ...s.config, check_interval_minutes: value } }));
                                    }}
                                    onBlur={(e) => {
                                        const value = parseInt(e.target.value);
                                        if (!isNaN(value) && value >= 1) handleIntervalChange(value);
                                    }}
                                    className="w-32"
                                    disabled={loading}
                                />
                                <span className="text-sm text-muted-foreground">Toutes les {config.check_interval_minutes} minute(s)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Minimum 1 minute, recommande 5 minutes.</p>
                        </div>

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Activite Discord</span>
                                <p className="text-sm text-muted-foreground">Montre que vous utilisez StarTrad FR sur votre profil Discord.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {discordEnabled && !discordConnecting && discordConnected && (
                                    <span className="flex items-center gap-1 text-sm text-[#5865F2]">
                                        <IconBrandDiscord size={16} />
                                        Connecte
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

                        <div className={settingRowClass}>
                            <div className={settingInfoClass}>
                                <span className="text-sm font-medium">Popup du premier lancement</span>
                                <p className="text-sm text-muted-foreground">Reafficher la popup de bienvenue et d'information de securite.</p>
                            </div>
                            <Button
                                id="reset-warning"
                                aria-label="Reinitialiser la popup du premier lancement"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    localStorage.removeItem('security-warning-seen');
                                    const keysToRemove: string[] = [];
                                    for (let i = 0; i < localStorage.length; i++) {
                                        const key = localStorage.key(i);
                                        if (key && key.startsWith('startradfr_')) {
                                            keysToRemove.push(key);
                                        }
                                    }
                                    keysToRemove.forEach(key => localStorage.removeItem(key));
                                    toast({
                                        title: 'Popups reinitialisees',
                                        description: 'Redemarrage de l\'application...',
                                    });
                                    setTimeout(() => {
                                        window.location.reload();
                                    }, 500);
                                }}
                                className="flex items-center gap-2"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Reinitialiser
                            </Button>
                        </div>
                    </section>

                    <CompanionCard />
                </TabsContent>

                <TabsContent value="cache" className="space-y-4">
                    <section className={settingsPanelClass}>
                        <h4 className={settingsHeaderClass}>
                            <Save className="h-5 w-5 text-green-500" />
                            Cache de traductions
                        </h4>

                        <div className={settingsHintBoxClass}>
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
                            <Button variant="outline" size="sm" onClick={handleOpenCacheFolder} className="flex-1">
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

                        <div className={settingsHintBoxClass}>
                            <h4 className="font-medium text-sm">Mode hors-ligne</h4>
                            <p className="text-sm text-muted-foreground">
                                Les traductions installees sont automatiquement mises en cache.
                                Vous pouvez les reinstaller meme sans connexion internet depuis la page Traduction.
                            </p>
                        </div>
                    </section>
                </TabsContent>

                <TabsContent value="stats" className="space-y-4">
                    <StatsSection />
                </TabsContent>
            </Tabs>
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

type StatsSectionState = { appStats: AppStats | null; cloudBackupsCount: number; loading: boolean };

function StatsSection() {
    const { cacheCleanCount, characterDownloadCount, getAppUsageDays, firstUseDate, backupCreatedCount, setFirstUseDate } = useStatsStore();
    const [{ appStats, cloudBackupsCount, loading }, setStatsState] = useState<StatsSectionState>({ appStats: null, cloudBackupsCount: 0, loading: true });

    // Utiliser le store (sync cloud) en priorité, sinon le backend
    const appUsageDays = getAppUsageDays();

    useEffect(() => {
        const fetchStats = async () => {
            try {
                // Récupérer les stats depuis Rust
                const stats = await invoke<AppStats>("get_app_stats");

                // Si pas de firstUseDate dans le store mais le backend en a une, l'initialiser
                if (!firstUseDate && stats.first_install_date) {
                    setFirstUseDate(stats.first_install_date);
                }

                // Récupérer le nombre de backups cloud si connecté
                const { data: { session } } = await supabase.auth.getSession();
                let count = 0;
                if (session?.user) {
                    const { data: backups } = await supabase.storage
                        .from("user-backups")
                        .list(`${session.user.id}/backups`);
                    count = backups?.length || 0;
                }
                setStatsState({ appStats: stats, cloudBackupsCount: count, loading: false });
            } catch (error) {
                console.error("Erreur lors du chargement des stats:", error);
                setStatsState((s) => ({ ...s, loading: false }));
            }
        };

        fetchStats();
    }, [firstUseDate, setFirstUseDate]);

    const localBackups = appStats?.local_backups_count ?? backupCreatedCount;
    const totalBackups = localBackups + cloudBackupsCount;

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
            description: `${localBackups} local${cloudBackupsCount > 0 ? ` + ${cloudBackupsCount} cloud` : ''}`
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
            <section className="space-y-4 rounded-xl border border-border/55 bg-background/55 p-4 sm:p-5 shadow-[0_16px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <h3 className="text-base font-semibold tracking-tight">Statistiques</h3>
                </div>
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            </section>
        );
    }

    return (
        <section className="space-y-4 rounded-xl border border-border/55 bg-background/55 p-4 sm:p-5 shadow-[0_16px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold tracking-tight">Statistiques</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {stats.map((stat) => (
                    <div
                        key={stat.label}
                        className="rounded-lg border border-border/35 bg-background/35 p-3 transition-all duration-200 hover:border-primary/30 hover:bg-background/55"
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
        </section>
    );
}

