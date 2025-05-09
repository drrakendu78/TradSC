"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { invoke } from "@tauri-apps/api/tauri";
import { useState, useEffect } from "react";
import { ColorPicker } from "./ColorPicker";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CustomMenu } from "@/components/custom/CustomMenu";
import { DarkModeSelector } from "@/components/custom/DarkModeSelector";
import { DiscordIcon } from "@/components/custom/DiscordIcon";

import {
    Home,
    Settings,
    Languages,
    Maximize2,
    Minimize2,
    Github,
    DatabaseZap,
    Globe,
    FileText,
} from "lucide-react";

import appInfos from "@/utils/appInfos.json";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export const Sidebar = ({ setSidebarWidth }: { setSidebarWidth?: (w: number) => void }) => {
    const [fullWidth, setFullWidth] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        if (setSidebarWidth) setSidebarWidth(fullWidth ? 280 : 100);
    }, [fullWidth, setSidebarWidth]);

    const openExternalLink = async (url: string) => {
        await invoke("open_external", { url });
    };

    const isActive = (path: string) => {
        if (path === "/" && pathname === "/") return true;
        if (path !== "/" && pathname.startsWith(path)) return true;
        return false;
    };

    return (
        <div
            className={`border-r relative transition-size duration-150 ${
                fullWidth ? "w-[320px]" : "w-[140px]"
            } bg-[#e2e8f0] dark:bg-[#1e293b]`}
        >
            <Button
                size={fullWidth ? "icon" : "iconSm"}
                onClick={() => setFullWidth(!fullWidth)}
                className="absolute right-0 top-[50%] translate-y-[-50%] translate-x-1/2"
            >
                {fullWidth ? <Minimize2 /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <div className={`flex h-full max-h-screen flex-col ${fullWidth ? 'justify-center' : ''}`}>
                <CustomMenu fullWidth={fullWidth} />
                <Separator />
                <div className="flex flex-col justify-between h-full pb-4">
                    <nav
                        className={`${
                            !fullWidth && "gap-3"
                        } grid items-start text-sm font-medium px-4 pt-3`}
                    >
                        {fullWidth && (
                            <>
                                <p className="text-primary font-medium">
                                    Pages
                                </p>
                            </>
                        )}
                        <Link
                            href="/"
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={10}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Home className={`h-4 w-4 ${isActive("/") ? "text-primary" : ""}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Homepage</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Homepage"}
                        </Link>
                        {fullWidth && (
                            <p className="text-primary font-medium mt-6">
                                Fonctionnalités
                            </p>
                        )}
                        <Link
                            href="/traduction"
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/traduction") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/traduction") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Languages className={`h-4 w-4 ${isActive("/traduction") ? "text-primary" : ""}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Traduction</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Traduction"}
                        </Link>
                        <Link
                            href="/clear_cache"
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/clear_cache") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/clear_cache") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <DatabaseZap className={`h-4 w-4 ${isActive("/clear_cache") ? "text-primary" : ""}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Gestion du cache</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Gestion du cache"}
                        </Link>
                        {fullWidth && (
                            <p className="text-primary font-medium mt-6">
                                Liens externes
                            </p>
                        )}
                        <Link
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                openExternalLink("https://iridianforprosperity.com/index.html");
                            }}
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Globe className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-all" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Website</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Website"}
                        </Link>
                        <Link
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                openExternalLink("https://discord.gg/xeczPncUY4");
                            }}
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <DiscordIcon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-all" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Discord</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Discord"}
                        </Link>
                        <Link
                            href="/patchnotes"
                            className={`flex items-center gap-3 rounded-md py-1.5 pl-2 transition-all ${
                                fullWidth && isActive("/patchnotes") ? "bg-primary/5 text-primary" : !fullWidth && isActive("/patchnotes") ? "text-primary" : "text-muted-foreground hover:text-primary"
                            } ${!fullWidth ? "justify-center pl-0" : ""}`}
                        >
                            <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <FileText className={`h-4 w-4 ${isActive("/patchnotes") ? "text-primary" : ""}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>Patchnotes</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {fullWidth && "Patchnotes"}
                        </Link>
                    </nav>
                    <div className={`flex ${fullWidth ? "justify-between" : "justify-center"} items-center px-4`}>
                        {fullWidth && (
                            <p className="text-xs text-muted-foreground text-nowrap">
                                <span className="text-primary">Traduction Française IFP</span> - By Drrakendu78
                            </p>
                        )}
                        <Dialog>
                            <DialogTrigger className="flex items-center gap-3 rounded-lg py-2 text-muted-foreground transition-all hover:text-primary">
                                <TooltipProvider delayDuration={50}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Settings className="h-4 w-4" />
                                        </TooltipTrigger>
                                        <TooltipContent side="right">
                                            <p>Settings</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Settings</DialogTitle>
                                    <DialogDescription asChild>
                                        <div>
                                            <ul className="text-foreground flex flex-col gap-4 mt-4">
                                                <li className="flex items-center gap-5 text-foreground">
                                                    <p className="min-w-[100px]">DarkMode : </p>
                                                    <DarkModeSelector />
                                                </li>
                                                <li className="flex items-center gap-5 text-foreground">
                                                    <p className="min-w-[100px]">Color Picker : </p>
                                                    <ColorPicker />
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
        </div>
    );
};