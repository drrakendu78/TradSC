import { X, Minus } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { WebviewWindow } from "@tauri-apps/api/window";

export const ControlMenu = () => {
    const [appWindow, setAppWindow] = useState<WebviewWindow>();

    async function setupAppWindow() {
        const appWindow = (await import("@tauri-apps/api/window")).appWindow;
        setAppWindow(appWindow);
    }
    useEffect(() => {
        setupAppWindow();
    }, []);

    const minimize = async () => await appWindow?.minimize();
    const close = async () => await appWindow?.close();

    return (
        <div className="absolute right-4 top-4 flex gap-3 z-100">
            <Button variant="ghost" size="menuButton" onClick={minimize}>
                <Minus />
            </Button>
            <Button variant="ghost" size="menuButton" onClick={close}>
                <X />
            </Button>
        </div>
    );
};
