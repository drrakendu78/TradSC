"use client";
import React, { useState, useEffect } from 'react';
import { 
    Menu, 
    X, 
    Settings
} from 'lucide-react';
import { IconHome, IconBrandDiscord, IconCloud, IconBrandGithub, IconLanguage, IconUsers, IconNews, IconKeyboard } from "@tabler/icons-react";
import { BrushCleaning, Download } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ColorPicker } from "@/components/custom/color-picker";
import openExternal from "@/utils/external";
import { getBuildInfo, BuildInfo } from "@/utils/buildInfo";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSidebarStore } from "@/stores/sidebar-store";

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
        id: "updates",
        name: "Mises à jour",
        icon: <Download size={18} />,
        href: "/updates",
        tooltip: "Mises à jour"
    },
    {
        id: "patchnotes",
        name: "Patchnotes",
        icon: <IconBrandGithub size={18} />,
        href: "/patchnotes",
        tooltip: "Patchnotes"
    },
    {
        id: "bindings",
        name: "Bindings",
        icon: <IconKeyboard size={18} />,
        href: "/bindings",
        tooltip: "Gestion des bindings"
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
        href: "https://drrakendu78.github.io/TradSC-docs/",
        tooltip: "Site web"
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

export function AppSidebar() {
    const [isOpen, setIsOpen] = useState(false);
    const { isLocked, isCollapsed, setCollapsed } = useSidebarStore(); // État depuis le store
    const [activeItem, setActiveItem] = useState<string>("");
    const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
    const location = useLocation();

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
    
    // Handlers pour le hover (seulement si non verrouillé)
    const handleMouseEnter = () => {
        if (window.innerWidth >= 768 && !isLocked) {
            setCollapsed(false);
        }
    };
    
    const handleMouseLeave = () => {
        if (window.innerWidth >= 768 && !isLocked) {
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
                    md:translate-x-0 md:static md:z-auto
                    transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
                `}
                style={{
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {/* Header */}
                <div className={`${isCollapsed ? 'h-0' : 'h-8'} transition-all duration-300 overflow-hidden`}>
                </div>

                {/* Navigation */}
                <nav 
                    className={`flex-1 py-1 overflow-y-auto [&::-webkit-scrollbar]:hidden ${isCollapsed ? "px-2.5" : "px-3"}`} 
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {/* Outils */}
                    <div className="mb-2">
                        {!isCollapsed && (
                            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap">
                                Outils
                            </div>
                        )}
                        {isCollapsed && (
                            <div className="h-8"></div>
                        )}
                        <ul className="space-y-0.5">
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
                                                    flex items-center space-x-2.5 rounded-md text-left group relative
                                                    transition-all duration-300 ease-out
                                                    hover:scale-[1.02] active:scale-[0.98]
                                                    ${isCollapsed ? "py-1.5 h-[32px] w-auto mx-auto justify-center px-2.5" : "py-2.5 min-h-[40px] w-full px-3"}
                                                    ${isActive
                                                        ? "bg-primary/10 text-primary shadow-sm"
                                                        : "text-muted-foreground hover:bg-accent hover:text-foreground hover:shadow-md"
                                                    }
                                                `}
                                                title={isCollapsed ? item.tooltip || item.name : undefined}
                                            >
                                            <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0 group-hover:scale-110">
                                                <div className={`
                                                    flex items-center justify-center
                                                    transition-all duration-300
                                                    ${isActive 
                                                        ? "text-primary scale-110" 
                                                        : "text-muted-foreground group-hover:text-foreground"
                                                    }
                                                `}>
                                                    {item.icon}
                                                </div>
                                            </div>
                                            
                                            <span 
                                                className={`text-sm whitespace-nowrap ${isActive ? "font-medium" : "font-normal"}`}
                                                style={{
                                                    opacity: isCollapsed ? 0 : 1,
                                                    maxWidth: isCollapsed ? '0px' : '200px',
                                                    overflow: 'hidden',
                                                    transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                                    willChange: 'opacity, max-width',
                                                    display: 'inline-block',
                                                    lineHeight: '1.5',
                                                    pointerEvents: isCollapsed ? 'none' : 'auto',
                                                }}
                                            >
                                                {item.name}
                                            </span>

                                                {/* Tooltip for collapsed state */}
                                                {isCollapsed && (
                                                    <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-border shadow-lg">
                                                        {item.tooltip || item.name}
                                                        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                                    </div>
                                                )}
                                            </Link>
                                        ) : (
                                            <button
                                                onClick={() => handleItemClick(item.id, item.href, true)}
                                                className={`
                                                    flex items-center space-x-2.5 rounded-md text-left group relative
                                                    transition-all duration-300 ease-out
                                                    hover:scale-[1.02] active:scale-[0.98]
                                                    ${isCollapsed ? "py-1.5 h-[32px] w-auto mx-auto justify-center px-2.5" : "py-2.5 min-h-[40px] w-full px-3"}
                                                    ${isActive
                                                        ? "bg-primary/10 text-primary shadow-sm"
                                                        : "text-muted-foreground hover:bg-accent hover:text-foreground hover:shadow-md"
                                                    }
                                                `}
                                                title={isCollapsed ? item.tooltip || item.name : undefined}
                                            >
                                                <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0 group-hover:scale-110">
                                                    <div className={`
                                                        flex items-center justify-center
                                                        transition-all duration-300
                                                        ${isActive 
                                                            ? "text-primary scale-110" 
                                                            : "text-muted-foreground group-hover:text-foreground"
                                                        }
                                                    `}>
                                                        {item.icon}
                                                    </div>
                                                </div>
                                                
                                                <span 
                                                    className={`text-sm whitespace-nowrap ${isActive ? "font-medium" : "font-normal"}`}
                                                    style={{
                                                        opacity: isCollapsed ? 0 : 1,
                                                        maxWidth: isCollapsed ? '0px' : '200px',
                                                        overflow: 'hidden',
                                                        transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                                        willChange: 'opacity, max-width',
                                                        display: 'inline-block',
                                                        lineHeight: '1.5',
                                                        pointerEvents: isCollapsed ? 'none' : 'auto',
                                                    }}
                                                >
                                                    {item.name}
                                                </span>

                                                {/* Tooltip for collapsed state */}
                                                {isCollapsed && (
                                                    <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 ease-out whitespace-nowrap z-50 border border-border shadow-lg group-hover:scale-100 scale-95 animate-in fade-in slide-in-from-left-2">
                                                        {item.tooltip || item.name}
                                                        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                                    </div>
                                                )}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {/* Séparateur */}
                    <div className="px-3 my-2">
                        <hr className="border-border" />
                    </div>

                    {/* Réseaux / actu SC */}
                    <div className="mb-2">
                        {!isCollapsed && (
                            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap">
                                Réseaux / actu SC
                            </div>
                        )}
                        {isCollapsed && (
                            <div className="h-8"></div>
                        )}
                        <ul className="space-y-0.5">
                            {/* Actualités */}
                            <li>
                                <Link
                                    to="/actualites"
                                    onClick={() => handleItemClick('actualites', '/actualites')}
                                    className={`
                                        flex items-center space-x-2.5 rounded-md text-left group relative
                                        transition-all duration-300 ease-out
                                        hover:scale-[1.02] active:scale-[0.98]
                                        ${isCollapsed ? "py-1.5 h-[32px] w-auto mx-auto justify-center px-2.5" : "py-2.5 min-h-[40px] w-full px-3"}
                                        ${activeItem === 'actualites'
                                            ? "bg-primary/10 text-primary shadow-sm"
                                            : "text-muted-foreground hover:bg-accent hover:text-foreground hover:shadow-md"
                                        }
                                    `}
                                    title={isCollapsed ? "Actualités Star Citizen" : undefined}
                                >
                                    <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0 group-hover:scale-110">
                                        <IconNews size={18} className={`
                                            flex items-center justify-center
                                            transition-all duration-300
                                            ${activeItem === 'actualites' 
                                                ? "text-primary scale-110" 
                                                : "text-muted-foreground group-hover:text-foreground"
                                            }
                                        `} />
                                    </div>
                                    <span 
                                        className={`text-sm whitespace-nowrap ${activeItem === 'actualites' ? "font-medium" : "font-normal"}`}
                                        style={{
                                            opacity: isCollapsed ? 0 : 1,
                                            maxWidth: isCollapsed ? '0px' : '200px',
                                            overflow: 'hidden',
                                            transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                            willChange: 'opacity, max-width',
                                            display: 'inline-block',
                                            lineHeight: '1.5',
                                            pointerEvents: isCollapsed ? 'none' : 'auto',
                                        }}
                                    >
                                        Actualités
                                    </span>
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 ease-out whitespace-nowrap z-50 border border-border shadow-lg group-hover:scale-100 scale-95 animate-in fade-in slide-in-from-left-2">
                                            Actualités Star Citizen
                                            <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
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
                                            flex items-center space-x-2.5 rounded-md text-left group relative
                                            transition-all duration-300 ease-out
                                            hover:scale-[1.02] active:scale-[0.98]
                                            ${isCollapsed ? "py-1.5 h-[32px] w-auto mx-auto justify-center px-2.5" : "py-2.5 min-h-[40px] w-full px-3"}
                                            ${activeItem === link.id
                                                ? "bg-primary/10 text-primary shadow-sm"
                                                : "text-muted-foreground hover:bg-accent hover:text-foreground hover:shadow-md"
                                            }
                                        `}
                                        title={isCollapsed ? link.tooltip || link.name : undefined}
                                    >
                                        <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0 group-hover:scale-110">
                                            <div className={`
                                                flex items-center justify-center
                                                transition-all duration-300
                                                ${activeItem === link.id 
                                                    ? "text-primary scale-110" 
                                                    : "text-muted-foreground group-hover:text-foreground"
                                                }
                                            `}>
                                                {link.icon}
                                            </div>
                                        </div>
                                        <span 
                                            className={`text-sm whitespace-nowrap ${activeItem === link.id ? "font-medium" : "font-normal"}`}
                                            style={{
                                                opacity: isCollapsed ? 0 : 1,
                                                maxWidth: isCollapsed ? '0px' : '200px',
                                                overflow: 'hidden',
                                                transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                                willChange: 'opacity, max-width',
                                                display: 'inline-block',
                                                lineHeight: '1.5',
                                                pointerEvents: isCollapsed ? 'none' : 'auto',
                                            }}
                                        >
                                            {link.name}
                                        </span>
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 ease-out whitespace-nowrap z-50 border border-border shadow-lg group-hover:scale-100 scale-95 animate-in fade-in slide-in-from-left-2">
                                                {link.tooltip || link.name}
                                                <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Séparateur */}
                    <div className="px-3 my-2">
                        <hr className="border-border" />
                    </div>

                    {/* Services externes */}
                    <div className="mb-2">
                        {!isCollapsed && (
                            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap">
                                Services externes
                            </div>
                        )}
                        {isCollapsed && (
                            <div className="h-8"></div>
                        )}
                        <ul className="space-y-0.5">
                            {externalServices.map((service) => (
                                <li key={service.id}>
                                    <button
                                        onClick={() => handleItemClick(service.id, service.href, true)}
                                        className={`
                                            flex items-center space-x-2.5 rounded-md text-left group relative
                                            transition-all duration-300 ease-out
                                            hover:scale-[1.02] active:scale-[0.98]
                                            ${isCollapsed ? "py-1.5 h-[32px] w-auto mx-auto justify-center px-2.5" : "py-2.5 min-h-[40px] w-full px-3"}
                                            ${activeItem === service.id
                                                ? "bg-primary/10 text-primary shadow-sm"
                                                : "text-muted-foreground hover:bg-accent hover:text-foreground hover:shadow-md"
                                            }
                                        `}
                                        title={isCollapsed ? service.tooltip || service.name : undefined}
                                    >
                                        <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0 group-hover:scale-110">
                                            <div className={`
                                                flex items-center justify-center
                                                transition-all duration-300
                                                ${activeItem === service.id 
                                                    ? "text-primary scale-110" 
                                                    : "text-muted-foreground group-hover:text-foreground"
                                                }
                                            `}>
                                                {service.icon}
                                            </div>
                                        </div>
                                        <span 
                                            className={`text-sm whitespace-nowrap ${activeItem === service.id ? "font-medium" : "font-normal"}`}
                                            style={{
                                                opacity: isCollapsed ? 0 : 1,
                                                maxWidth: isCollapsed ? '0px' : '200px',
                                                overflow: 'hidden',
                                                transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                                willChange: 'opacity, max-width',
                                                display: 'inline-block',
                                                lineHeight: '1.5',
                                                pointerEvents: isCollapsed ? 'none' : 'auto',
                                            }}
                                        >
                                            {service.name}
                                        </span>
                                        {isCollapsed && (
                                            <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 ease-out whitespace-nowrap z-50 border border-border shadow-lg group-hover:scale-100 scale-95 animate-in fade-in slide-in-from-left-2">
                                                {service.tooltip || service.name}
                                                <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                            </div>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </nav>

                {/* Bottom section with settings */}
                <div className="mt-auto border-t border-border">
                    <div className="p-3">
                        <Dialog>
                            <DialogTrigger asChild>
                                <button
                                    className={`
                                        w-full flex items-center rounded-md text-left group
                                        transition-all duration-300 ease-out
                                        hover:scale-[1.02] active:scale-[0.98]
                                        text-muted-foreground hover:bg-accent hover:text-foreground
                                        ${isCollapsed ? "justify-center p-2.5" : "space-x-2.5 px-3 py-2.5"}
                                    `}
                                    title={isCollapsed ? "Paramètres" : undefined}
                                >
                                    <div className="flex items-center justify-center min-w-[24px] h-[24px] flex-shrink-0">
                                        <Settings className="h-4.5 w-4.5 flex items-center justify-center text-muted-foreground group-hover:text-foreground" />
                                    </div>
                                    
                                    <span 
                                        className="text-sm whitespace-nowrap"
                                        style={{
                                            opacity: isCollapsed ? 0 : 1,
                                            maxWidth: isCollapsed ? '0px' : '200px',
                                            overflow: 'hidden',
                                            transition: 'opacity 0.5s ease-out, max-width 0.5s ease-out',
                                            willChange: 'opacity, max-width',
                                            display: 'inline-block',
                                            lineHeight: '1.5',
                                            pointerEvents: isCollapsed ? 'none' : 'auto',
                                        }}
                                    >
                                        Paramètres
                                    </span>
                                    
                                    {/* Tooltip for collapsed state */}
                                    {isCollapsed && (
                                        <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 ease-out whitespace-nowrap z-50 border border-border shadow-lg group-hover:scale-100 scale-95 animate-in fade-in slide-in-from-left-2">
                                            Paramètres
                                            <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-popover border-l border-b border-border rotate-45" />
                                        </div>
                                    )}
                                </button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Paramètres</DialogTitle>
                                    <DialogDescription asChild>
                                        <div>
                                            <ul className="text-foreground flex flex-col gap-4 mt-4">
                                                <li className="flex items-center gap-5 text-foreground">
                                                    <p className="min-w-[100px]">
                                                        Color Picker :{" "}
                                                    </p>
                                                    <ColorPicker />
                                                </li>
                                                <li className="flex items-center justify-between gap-5 text-foreground border-t pt-4">
                                                    <div>
                                                        <p className="font-medium">Avertissement de sécurité</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            Réafficher le popup d'avertissement au démarrage
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            localStorage.removeItem('security-warning-seen');
                                                            window.location.reload();
                                                        }}
                                                    >
                                                        Réinitialiser
                                                    </Button>
                                                </li>
                                            </ul>
                                        </div>
                                    </DialogDescription>
                                </DialogHeader>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </div>
        </>
    );
}
