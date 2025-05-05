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
                <div
                    className={`${
                        fullWidth
                            ? "grid grid-cols-4 px-4 py-6"
                            : "flex justify-center items-center p-5"
                    } text-foreground`}
                >
                    {fullWidth && (
                        <div className="flex items-center justify-center col-span-3 overflow-hidden">
                            <h1 className="font-bold uppercase text-primary text-nowrap">
                            I.F.P {appInfos.version}
                            </h1>
                        </div>
                    )}
                    <div className="col-span-1 flex items-center justify-center">
                        <Image src={logo} alt="Logo" width={50} height={50} />
                    </div>
                </div>
            </DraggableRegion>
        </div>
    );
};
