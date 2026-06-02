import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { ShieldAlert, Ban } from "lucide-react";

const DELETE_ACCOUNT_FN = "https://rronicslgyoubiofbinu.supabase.co/functions/v1/delete-account";

interface RawBanStatus {
    banned: boolean;
    reason: string | null;
    severity?: string | null;
}

async function getHwid(): Promise<string> {
    try {
        return await invoke<string>("get_machine_id");
    } catch {
        return "";
    }
}

/**
 * Suppression IRRÉVERSIBLE pour un ban SÉVÈRE : compte Supabase + sauvegardes
 * cloud (via l'edge function delete-account, avec le token de la victime) +
 * données locales. Déclenchée une seule fois (garde ref côté appelant).
 */
async function performSevereWipe(token: string) {
    try {
        await fetch(DELETE_ACCOUNT_FN, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
    } catch {
        // l'edge function gère la suppression serveur ; en cas d'échec réseau on
        // efface quand même le local + on déconnecte (le compte reste banni).
    }
    try {
        window.localStorage.clear();
    } catch {
        /* ignore */
    }
    try {
        await supabase.auth.signOut();
    } catch {
        /* ignore */
    }
}

/**
 * Garde de ban. Overlay plein écran qui verrouille l'app si :
 *  - le COMPTE connecté est banni (soft = lock réversible ; severe = lock + suppression
 *    compte/cloud/local), OU
 *  - la MACHINE (HWID) est bannie (anti-évasion ; marche même déconnecté ; gaté par
 *    le switch machine_ban_enabled côté edge function).
 *
 * Vérifie à CHAQUE démarrage de l'app (session persistée relue) + à chaque
 * (dé)connexion + en Realtime. 🔑 FAIL-OPEN partout : toute erreur => on ne bloque pas.
 */
export function BanGate() {
    const [banned, setBanned] = useState(false);
    const [reason, setReason] = useState<string | null>(null);
    const [severe, setSevere] = useState(false);
    const severeWipedRef = useRef(false);
    const userRef = useRef<User | null>(null);

    useEffect(() => {
        let cancelled = false;
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const clearChannel = () => {
            if (channel) {
                supabase.removeChannel(channel);
                channel = null;
            }
        };

        const maybeSevereWipe = async (token: string | undefined | null) => {
            if (severeWipedRef.current || !token) return;
            severeWipedRef.current = true;
            await performSevereWipe(token);
        };

        const watch = (userId: string) => {
            clearChannel();
            channel = supabase
                .channel(`ban-watch-${userId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "banned_users", filter: `user_id=eq.${userId}` },
                    async (payload) => {
                        if (cancelled) return;
                        if (payload.eventType === "DELETE") {
                            // Déban (soft) : on relâche. Un compte wipé en sévère reste lock.
                            if (!severeWipedRef.current) {
                                setBanned(false);
                                setReason(null);
                                setSevere(false);
                            }
                            return;
                        }
                        const row = payload.new as { reason?: string | null; severity?: string | null } | null;
                        const isSevere = row?.severity === "severe";
                        setBanned(true);
                        setReason(row?.reason ?? null);
                        if (isSevere) {
                            setSevere(true);
                            const { data: { session } } = await supabase.auth.getSession();
                            await maybeSevereWipe(session?.access_token);
                        }
                    }
                )
                .subscribe();
        };

        const evaluate = async (user: User | null) => {
            userRef.current = user;
            try {
                let isLocked = false;
                let lockReason: string | null = null;
                let lockSevere = false;
                let token: string | undefined;

                // 1) Ban MACHINE (HWID) — marche même déconnecté. Gaté par le switch.
                const hwid = await getHwid();
                if (hwid) {
                    const m = await invoke<RawBanStatus>("check_hwid_banned", { hwid });
                    if (m?.banned) {
                        isLocked = true;
                        lockReason = m.reason ?? lockReason;
                    }
                }

                // 2) Ban COMPTE (si connecté).
                if (user) {
                    const { data: { session } } = await supabase.auth.getSession();
                    token = session?.access_token;
                    if (token) {
                        if (hwid) {
                            const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
                            const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
                            void invoke("link_user_device", {
                                accessToken: token,
                                userId: user.id,
                                hwid,
                                email: user.email ?? null,
                                discordId: str(meta.provider_id) ?? str(meta.sub),
                                discordUsername: str(meta.preferred_username) ?? str(meta.user_name),
                                discordGlobalName: str(meta.full_name) ?? str(meta.name),
                            }).catch(() => undefined);
                        }
                        const a = await invoke<RawBanStatus>("check_user_banned", {
                            userId: user.id,
                            accessToken: token,
                        });
                        if (a?.banned) {
                            isLocked = true;
                            lockReason = a.reason ?? lockReason;
                            if (a.severity === "severe") lockSevere = true;
                        }
                    }
                }

                if (cancelled) return;

                if (lockSevere) await maybeSevereWipe(token);

                // Un compte wipé en sévère reste verrouillé pour le reste de la session.
                if (severeWipedRef.current) {
                    setBanned(true);
                    setSevere(true);
                    return;
                }

                setBanned(isLocked);
                setReason(isLocked ? lockReason : null);
                setSevere(lockSevere);

                clearChannel();
                if (user) watch(user.id);
            } catch {
                // 🔑 fail-open : on ne verrouille jamais un innocent sur erreur.
            }
        };

        supabase.auth
            .getSession()
            .then(({ data: { session } }) => evaluate(session?.user ?? null))
            .catch(() => undefined);

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            void evaluate(session?.user ?? null);
        });

        // Re-check au focus de la fenêtre : si un ban a été levé, l'app se
        // déverrouille sans redémarrage (filet si le Realtime DELETE ne passe
        // pas dans la WebView2).
        const onFocus = () => {
            void evaluate(userRef.current);
        };
        window.addEventListener("focus", onFocus);

        return () => {
            cancelled = true;
            subscription.unsubscribe();
            clearChannel();
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    if (!banned) return null;

    // Portal vers <body> + fond 100% opaque : couvre TOUTE la fenêtre (y compris
    // la barre de titre z-[90]) et masque entièrement l'app — le banni ne voit rien.
    return createPortal(
        <div
            className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#0a0a0c] select-none"
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="mx-4 max-w-md rounded-2xl border border-destructive/40 bg-[#15151a] p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/15 ring-1 ring-destructive/40">
                    {severe ? <Ban className="h-8 w-8 text-destructive" /> : <ShieldAlert className="h-8 w-8 text-destructive" />}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    {severe ? "Accès définitivement bloqué" : "Accès suspendu"}
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {severe
                        ? "Ce compte a été banni et ses données ont été supprimées. L'accès à StarTrad FR est révoqué."
                        : "Ce compte a été suspendu et ne peut plus utiliser StarTrad FR."}
                </p>
                {reason && (
                    <p className="mt-4 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm text-foreground/90">
                        {reason}
                    </p>
                )}
                <p className="mt-6 text-xs text-muted-foreground/70">
                    Si tu penses qu'il s'agit d'une erreur, contacte le support StarTrad sur Discord.
                </p>
            </div>
        </div>,
        document.body
    );
}

export default BanGate;
