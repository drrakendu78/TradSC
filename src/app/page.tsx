"use client";
import { motion } from "framer-motion";
import LogoW from "@/assets/svg/logo-w.svg";
import LogoB from "@/assets/svg/logo-b.svg";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import appInfos from "@/utils/appInfos.json";
import RssFeed from "@/components/RssFeed";

export default function Page() {
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
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
                duration: 0.8,
                delay: 0.2,
                ease: [0, 0.71, 0.2, 1.01],
            }}
            className="flex min-h-screen flex-col"
        >
            <div className="flex items-center gap-3 mb-6">
                <Image src={logo} alt="Logo" width={50} height={50} priority />
                <p>Traduction Française Iridian For Prosperity - version {appInfos.version}</p>
            </div>
            <div className="flex-1 overflow-auto">
                <RssFeed />
            </div>
        </motion.div>
    );
}
