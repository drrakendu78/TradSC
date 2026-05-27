import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import { useToast } from "@/hooks/use-toast";
import { isTauri } from "@/utils/tauri-helpers";

interface BlueprintEvent {
    productName: string;
    ts: number;
}

/**
 * Clé localStorage pour le toggle "Son des notifications schéma" (Paramètres
 * → Services). Default = activé.
 *
 * NB : ce toggle contrôle UNIQUEMENT le son sci-fi joué via HTML5 Audio.
 * La notification visuelle (Windows native + fallback toast) reste affichée
 * dans tous les cas — un user qui désactive le son veut juste être notifié
 * sans bruit, pas suppimer complètement la notif.
 */
export const BLUEPRINT_SOUND_ENABLED_KEY = "startradfr_blueprint_sound_enabled";
export const BLUEPRINT_SOUND_CHANGED_EVENT = "blueprintSoundEnabledChanged";

export function isBlueprintSoundEnabled(): boolean {
    try {
        const raw = localStorage.getItem(BLUEPRINT_SOUND_ENABLED_KEY);
        // Pas encore stocké → default true
        return raw === null ? true : raw === "true";
    } catch {
        return true;
    }
}

export function setBlueprintSoundEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(BLUEPRINT_SOUND_ENABLED_KEY, String(enabled));
    } catch { /* ignore */ }
    window.dispatchEvent(
        new CustomEvent(BLUEPRINT_SOUND_CHANGED_EVENT, { detail: { enabled } }),
    );
}

/**
 * Hook global : écoute `gamelog-watcher:blueprint` au niveau App et notifie
 * l'utilisateur dès qu'un blueprint est détecté en jeu.
 *
 * Architecture audio/notif :
 * - **Notification Windows native** (`sendNotification`) — visible dans le
 *   coin bas-droit même si l'app StarTrad est en arrière-plan / minimisée.
 *   Le `sound` est laissé `undefined` (notif silencieuse) car la lib Tauri
 *   `tauri-plugin-notification` n'accepte sur Windows que les sons système
 *   prédéfinis (Default, IM, Mail, etc.) — pas de fichier `.wav` custom.
 * - **HTML5 Audio** (`/sounds/blueprint-received.wav`) joué en parallèle
 *   pour le son custom sci-fi. Servi par Vite depuis `public/sounds/`.
 *   Marche tant que la webview Tauri n'est pas garbage-collected (en pratique
 *   toujours, l'app tourne en tray).
 *
 * Fallback `toast` in-app si la permission notif Windows est refusée — au
 * moins l'utilisateur a un feedback quand il revient dans l'app.
 *
 * Toggle utilisateur "Notifications schéma reçu" (Paramètres → Services) :
 * si OFF, on skip toute la notif + le son + le toast.
 *
 * Dédup 5 sec sur productName pour éviter le spam si le watcher reparse la
 * même ligne du Game.log (cleanup périodique de la map > 50 entrées).
 */
export function useGlobalBlueprintToast() {
    const { toast } = useToast();

    useEffect(() => {
        if (!isTauri()) return;

        // Pre-charge l'audio HTML5 au mount pour qu'il soit prêt à jouer
        // instantanément quand un blueprint est détecté.
        const audio = new Audio("/sounds/blueprint-received.wav");
        audio.preload = "auto";
        audio.volume = 0.7;

        // Dédup : { productName → ts du dernier toast }
        const recent = new Map<string, number>();
        const DEDUP_MS = 5000;

        let unlisten: (() => void) | undefined;
        let cancelled = false;
        // null = pas encore checké, true/false = état connu
        let nativePermissionGranted: boolean | null = null;

        // Demande la permission de notification Windows une seule fois au
        // mount. Si l'user refuse, on tombera sur le toast in-app.
        (async () => {
            try {
                nativePermissionGranted = await isPermissionGranted();
                if (!nativePermissionGranted) {
                    const next = await requestPermission();
                    nativePermissionGranted = next === "granted";
                }
            } catch (e) {
                console.warn("[blueprintToast] permission check failed:", e);
                nativePermissionGranted = false;
            }
        })();

        listen<BlueprintEvent>("gamelog-watcher:blueprint", (event) => {
            const { productName, ts } = event.payload;
            const last = recent.get(productName);
            const now = Date.now();
            if (last && now - last < DEDUP_MS) return;
            recent.set(productName, now);

            // Cleanup périodique de la map pour éviter qu'elle grossisse
            // indéfiniment pendant une longue session.
            if (recent.size > 50) {
                const cutoff = now - DEDUP_MS;
                for (const [name, t] of recent) {
                    if (t < cutoff) recent.delete(name);
                }
            }

            // Notification visuelle (Windows native ou fallback toast in-app)
            if (nativePermissionGranted) {
                try {
                    sendNotification({
                        title: "🪐 Nouveau schéma reçu",
                        body: productName,
                        // Pas de `sound` : on joue notre WAV custom en
                        // parallèle via HTML5 Audio juste après.
                    });
                } catch (e) {
                    console.warn("[blueprintToast] sendNotification failed, fallback to in-app toast:", e);
                    toast({
                        title: "🪐 Nouveau schéma reçu",
                        description: productName,
                    });
                }
            } else {
                // Permission native refusée : fallback in-app toast.
                toast({
                    title: "🪐 Nouveau schéma reçu",
                    description: productName,
                });
            }

            // Son custom HTML5 en parallèle — uniquement si le toggle "Son
            // des notifications schéma" est ON (Paramètres → Services).
            // Re-lecture du localStorage à chaque event = pas besoin de
            // remount du hook après que l'user toggle off/on.
            if (isBlueprintSoundEnabled()) {
                audio.currentTime = 0;
                audio.play().catch((e) => {
                    console.warn("[blueprintToast] audio.play failed:", e);
                });
            }

            void ts;
        }).then((fn) => {
            if (cancelled) {
                fn();
            } else {
                unlisten = fn;
            }
        });

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
            audio.pause();
            audio.src = "";
        };
    }, [toast]);
}
