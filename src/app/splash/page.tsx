"use client";

import Image from "next/image";
import LogoW from "@/assets/svg/logo-w.svg";
import LogoB from "@/assets/svg/logo-b.svg";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function SplashPage() {
    const { theme } = useTheme();
    const [logo, setLogo] = useState<string>(LogoW);

    useEffect(() => {
        if (theme === "dark") {
            setLogo(LogoW);
        } else {
            setLogo(LogoB);
        }
    }, [theme]);

    return (
        <div className="flex flex-col items-center justify-center h-full w-full gap-6" data-tauri-drag-region>
            <Image
                src={logo}
                alt="Logo"
                width={200}
                height={200}
                priority
                className="transition-all duration-300"
            />
            <div className="flex flex-col items-center text-center">
                <h1 className="text-2xl font-bold tracking-wide mb-2 transition-all duration-300">
                    Traduction Française
                </h1>
                <p className="text-lg text-muted-foreground tracking-wider transition-all duration-300">
                    Iridian For Prosperity <span className="opacity-75">by</span> <span className="font-semibold">Drrakendu78</span>
                </p>
            </div>
        </div>
    );
}
