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

const fontSans = FontSans({
    subsets: ["latin"],
    variable: "--font-sans",
});

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = usePathname();
    const isSplashRoute = pathname === "/splash";
    const [loaded, setLoaded] = useState(false);
    const { setTheme } = useTheme();

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
                                <Sidebar />
                                <main className="flex flex-col max-h-screen rounded-r-3xl overflow-hidden w-full pt-20 px-10">
                                    {children}
                                </main>
                            </div>
                            <Toaster />
                        </Suspense>
                    )}
                </ThemeProvider>
            </body>
        </html>
    );
}
