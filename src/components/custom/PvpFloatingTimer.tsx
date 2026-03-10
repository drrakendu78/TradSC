import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { m, AnimatePresence } from "framer-motion";
import { IconSwords } from "@tabler/icons-react";

const STORAGE_KEY = "pvp-self-timers";

interface SavedTimer {
    startedAt: number;
    duration: number;
}

interface ActiveTimer {
    id: string;
    label: string;
    remaining: number;
}

function formatTimeShort(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function extractLabel(id: string): string {
    // id format: "ZoneName-TimerLabel" → on prend juste le label
    const dash = id.indexOf("-");
    return dash >= 0 ? id.substring(dash + 1) : id;
}

function getTimerColor(remaining: number): string {
    if (remaining <= 180) return "text-yellow-400";
    return "text-red-400";
}

export function PvpFloatingTimer() {
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);

    const isOnPvp = location.pathname === "/pvp";

    useEffect(() => {
        const update = () => {
            let timers: ActiveTimer[] = [];
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const data: Record<string, SavedTimer> = JSON.parse(raw);
                    const now = Date.now();
                    for (const [id, timer] of Object.entries(data)) {
                        if (!timer.startedAt) continue;
                        const elapsed = Math.floor((now - timer.startedAt) / 1000);
                        const remaining = timer.duration - elapsed;
                        if (remaining > 0) {
                            timers.push({ id, label: extractLabel(id), remaining });
                        }
                    }
                    timers.sort((a, b) => a.remaining - b.remaining);
                }
            } catch {
                timers = [];
            }
            setActiveTimers(timers);
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, []);

    const visible = !isOnPvp && activeTimers.length > 0;

    return (
        <AnimatePresence>
            {visible && (
                <m.button
                    initial={{ opacity: 0, x: 80 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 80 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    onClick={() => navigate("/pvp")}
                    className="fixed bottom-20 right-4 z-[95] flex items-center gap-3 px-5 py-3 rounded-xl cursor-pointer
                        bg-background/70 backdrop-blur-xl border border-red-500/30 shadow-lg
                        hover:bg-background/90 hover:border-red-500/50 hover:scale-105
                        active:scale-95 transition-all duration-200 pointer-events-auto"
                    style={{
                        backdropFilter: "blur(8px) saturate(180%)",
                        WebkitBackdropFilter: "blur(8px) saturate(180%)",
                    }}
                    title="Retourner aux Zones PVP"
                >
                    <IconSwords size={22} className="text-red-500 flex-shrink-0" />
                    <div className="flex flex-col items-start gap-1">
                        <span className="text-xs text-muted-foreground leading-tight">
                            {activeTimers.length} timer{activeTimers.length > 1 ? "s" : ""} actif{activeTimers.length > 1 ? "s" : ""}
                        </span>
                        <div className="flex flex-col gap-0.5">
                            {activeTimers.map((t) => (
                                <div key={t.id} className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted-foreground/70 w-20 truncate">{t.label}</span>
                                    <span className={`text-sm font-mono font-bold leading-tight ${getTimerColor(t.remaining)}`}>
                                        {formatTimeShort(t.remaining)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </m.button>
            )}
        </AnimatePresence>
    );
}
