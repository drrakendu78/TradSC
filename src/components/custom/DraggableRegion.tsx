"use client";
import React, { ReactNode, useEffect, useState } from "react";

interface DraggableRegionProps {
    children: ReactNode;
}

export const DraggableRegion: React.FC<DraggableRegionProps> = ({
    children,
}) => {
    const [appWindow, setAppWindow] = useState<any>(null);

    useEffect(() => {
        const importAppWindow = async () => {
            if (typeof window !== "undefined") {
                const { appWindow } = await import("@tauri-apps/api/window");
                setAppWindow(appWindow);
            }
        };
        importAppWindow();
    }, []);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (
            appWindow &&
            e.target instanceof Element &&
            e.target.closest("[data-tauri-drag-region]")
        ) {
            appWindow.startDragging();
        }
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            data-tauri-drag-region
            className="hover:cursor-grab"
        >
            {children}
        </div>
    );
};
