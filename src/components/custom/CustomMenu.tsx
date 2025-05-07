"use client";

import { CircleUser } from "lucide-react";
import { DraggableRegion } from "@/components/custom/DraggableRegion";
import appInfos from "@/utils/appInfos.json";
import LogoW from "@/assets/svg/logo-w.svg";
import LogoB from "@/assets/svg/logo-b.svg";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export const CustomMenu = ({ fullWidth }: { fullWidth: boolean }) => {
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
        <div>
            <DraggableRegion>
                <div className={`flex items-center justify-center gap-4 px-4 py-6`}>
                    <span
                        className={`font-bold uppercase text-primary text-nowrap text-xl ${fullWidth ? '' : 'hidden'}`}
                    >
                        I.F.P {appInfos.version}
                    </span>
                    <div
                        className="flex items-center justify-center"
                    >
                        <div
                            className="rounded-full overflow-hidden transition-all duration-300"
                            style={{
                                width: fullWidth ? 90 : 100,
                                height: fullWidth ? 90 : 100,
                                animation: 'logo-glow 2.5s infinite ease-in-out',
                            }}
                        >
                            <Image
                                src={logo}
                                alt="Logo"
                                width={fullWidth ? 90 : 100}
                                height={fullWidth ? 90 : 100}
                                style={{
                                    animation: 'drop-glow 2.5s infinite ease-in-out'
                                }}
                            />
                        </div>
                    </div>
                </div>
            </DraggableRegion>
        </div>
    );
};
