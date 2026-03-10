import { Shield } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useReducer } from "react";

type AdminState = { hover: boolean; isAdmin: boolean };
type AdminAction = { type: 'SET_HOVER'; value: boolean } | { type: 'SET_ADMIN'; value: boolean };

function adminReducer(state: AdminState, action: AdminAction): AdminState {
    switch (action.type) {
        case 'SET_HOVER': return { ...state, hover: action.value };
        case 'SET_ADMIN': return { ...state, isAdmin: action.value };
    }
}

export default function AdminElevateButton() {
    const visibleOverride = useAdminStore((s) => s.visible);
    const { toast } = useToast();
    const [{ hover, isAdmin }, dispatch] = useReducer(adminReducer, { hover: false, isAdmin: false });

    useEffect(() => {
        const check = async () => {
            try {
                const res = await invoke<boolean>("is_running_as_admin");
                console.log('[AdminButton] is_running_as_admin:', res);
                dispatch({ type: 'SET_ADMIN', value: res });
            } catch (error) {
                console.error('[AdminButton] Erreur vérification admin:', error);
                dispatch({ type: 'SET_ADMIN', value: true });
            }
        };
        check();
        const id = setInterval(check, 5000);
        return () => clearInterval(id);
    }, []);

    const shouldShow = !isAdmin || visibleOverride;
    console.log('[AdminButton] shouldShow:', shouldShow, '(isAdmin:', isAdmin, ', visibleOverride:', visibleOverride, ')');
    if (!shouldShow) return null;

    return (
        <div
            className="fixed bottom-4 right-4 z-[9999] w-[200px] h-10 flex items-center justify-end"
            onMouseEnter={() => dispatch({ type: 'SET_HOVER', value: true })}
            onMouseLeave={() => dispatch({ type: 'SET_HOVER', value: false })}
        >
            <button
                aria-label="Relancer en admin"
                title="Relancer en administrateur"
                onClick={async () => {
                    try {
                        await invoke("restart_as_admin");
                    } catch (e) {
                        toast({
                            title: "Impossible de relancer en admin",
                            description: String(e),
                            success: "false",
                        });
                    }
                }}
                className={`group relative flex items-center rounded-full bg-yellow-500 text-black hover:bg-yellow-400 transition-all duration-200 h-10
                ${hover ? "w-[200px] px-3 gap-2 justify-start" : "w-10 gap-0 justify-center"}
                ${(!isAdmin && !hover) ? "admin-pulse" : "shadow-lg"}`}
            >
                <Shield className="h-5 w-5" />
                <span
                    className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${hover ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
                        }`}
                >
                    Relancer en admin
                </span>
            </button>
        </div>
    );
}


