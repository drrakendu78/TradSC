"use client";

import "./globals.css";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/custom/Sidebar";
import { ControlMenu } from "@/components/custom/ControlMenu";
import { Inter as FontSans } from "next/font/google";
import { ThemeProvider } from "@/components/custom/ThemeProvider";
import { usePathname } from "next/navigation";
import { loadAndApplyTheme } from "@/utils/CustomThemeProvider";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import Image from "next/image";
import LogoW from "@/assets/svg/logo-w.svg";
import appInfos from "@/utils/appInfos.json";

const fontSans = FontSans({
    subsets: ["latin"],
    variable: "--font-sans",
});

function FloatingHeader() {
    return (
        <header className="w-full bg-background shadow-md rounded-tr-3xl">
            <div className="flex flex-col items-center gap-1 px-8 py-2">
                <span
                  className="
                    text-lg font-semibold tracking-wide
                    text-zinc-900 dark:text-yellow-200
                    opacity-95
                    select-none
                    whitespace-nowrap
                    transition-colors duration-300
                  "
                >
                    {appInfos.name}
                    <span className="mx-1 text-zinc-500 dark:text-yellow-300 font-normal opacity-80">–</span>
                    <span className="font-normal text-zinc-600 dark:text-yellow-100 opacity-90">
                      version {appInfos.version}
                    </span>
                </span>
                <div className="iridian-gradient-bar"></div>
            </div>
        </header>
    );
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = usePathname();
    const isSplashRoute = pathname === "/splash";
    const [loaded, setLoaded] = useState(false);
    const { setTheme } = useTheme();
    const [sidebarWidth, setSidebarWidth] = useState(100);

    useEffect(() => {
        if (!loaded) {
            setTheme("dark");
            loadAndApplyTheme();
            setLoaded(true);
        }
    }, [loaded, setTheme]);

    return (
        <html lang="en" suppressHydrationWarning className="static min-w-full">
            <head />
            <body
                className={cn(
                    "min-h-screen font-sans antialiased",
                    fontSans.variable,
                )}
            >
                <ThemeProvider attribute="class" defaultTheme="dark">
                    {isSplashRoute ? (
                        <div className="min-h-screen w-full flex rounded-l-3xl overflow-hidden">
                            <main className="flex flex-col justify-center items-center rounded-r-3xl overflow-hidden w-full bg-zinc-950">
                                {children}
                            </main>
                        </div>
                    ) : (
                        <Suspense fallback={<p>Loading ... </p>}>
                            <div
                                data-tauri-drag-region
                                className="absolute h-[80px] w-full z-0"
                            />
                            <ControlMenu />
                            <div className="max-h-screen w-full flex rounded-l-3xl overflow-hidden">
                                <Sidebar setSidebarWidth={setSidebarWidth} />
                                <div className="flex-1 h-full min-h-screen flex flex-col rounded-r-3xl rounded-br-3xl overflow-hidden bg-background">
                                    <FloatingHeader />
                                    <main className="flex flex-col max-h-screen w-full px-10 bg-transparent">
                                    {children}
                                </main>
                                </div>
                            </div>
                            <Toaster />
                        </Suspense>
                    )}
                </ThemeProvider>
            </body>
        </html>
    );
}
