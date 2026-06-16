import { invoke } from "@tauri-apps/api/core";
import openExternal from "@/utils/external";

// ─────────────────────────────────────────────────────────────────────────────
// Migration StarTrad → Stelliverse.
// StarTrad a été réécrit et rebaptisé « Stelliverse » (nouveau dépôt GitLab).
// La build finale de StarTrad pousse l'utilisateur ici : l'updater standalone
// télécharge la dernière Stelliverse depuis GitLab et l'installe. Le binaire
// `startrad-updater` de cette build finale embarque la CLÉ PUBLIQUE Stelliverse,
// donc il sait vérifier la signature des releases Stelliverse (clés différentes).
// On ne fusionne pas les apps : compte + sauvegardes sont déjà partagés (même
// Supabase) → l'utilisateur se reconnecte dans Stelliverse et tout est là.
// ─────────────────────────────────────────────────────────────────────────────

const GITLAB_PROJECT = "drrakendu78%2FStelliverse"; // path URL-encodé pour l'API
export const STELLIVERSE_RELEASES_URL = "https://gitlab.com/drrakendu78/Stelliverse/-/releases";
export const STELLIVERSE_GITLAB_URL = "https://gitlab.com/drrakendu78/Stelliverse";

export interface StelliverseRelease {
    version: string;
    downloadUrl: string;
    sigUrl: string;
    notes: string;
}

interface GitlabLink {
    name?: string;
    url?: string;
    direct_asset_url?: string;
}

/** Dernière release Stelliverse via l'API GitLab (publique, token-free). */
export async function fetchLatestStelliverse(): Promise<StelliverseRelease | null> {
    try {
        const res = await fetch(
            `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}/releases?per_page=1`,
            { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return null;
        const arr = await res.json();
        const rel = Array.isArray(arr) ? arr[0] : null;
        if (!rel) return null;
        const links: GitlabLink[] = rel.assets?.links ?? [];
        const nsis = links.find((l) => /-setup\.exe$/i.test(l.name ?? ""));
        const sig = links.find((l) => /-setup\.exe\.sig$/i.test(l.name ?? ""));
        if (!nsis) return null;
        const downloadUrl = nsis.direct_asset_url || nsis.url || "";
        if (!downloadUrl) return null;
        return {
            version: String(rel.tag_name ?? "").replace(/^v/, ""),
            downloadUrl,
            sigUrl: sig?.direct_asset_url || sig?.url || "",
            notes: rel.description ?? "",
        };
    } catch {
        return null;
    }
}

/**
 * Migration : télécharge + installe la dernière Stelliverse via l'updater standalone.
 * Réutilise exactement le flow admin/install-différée de useUpdater (layout.tsx
 * consomme `startradfr_pending_install` au boot en admin → launch_updater).
 * Fallback (release introuvable / élévation refusée) : ouvre la page de releases
 * dans le navigateur pour un téléchargement manuel.
 */
export async function migrateToStelliverse(): Promise<void> {
    const rel = await fetchLatestStelliverse();
    if (!rel) {
        await openExternal(STELLIVERSE_RELEASES_URL);
        return;
    }
    const name = rel.downloadUrl.split("/").pop() || "Stelliverse-setup.exe";

    // Un .exe nommé "updater"/"setup" déclenche l'auto-élévation Windows : si pas
    // admin, on persiste l'install et on relance en admin (layout.tsx l'exécutera).
    const isAdmin = await invoke<boolean>("is_running_as_admin").catch(() => true);
    if (!isAdmin) {
        try {
            localStorage.setItem(
                "startradfr_pending_install",
                JSON.stringify({ url: rel.downloadUrl, sigUrl: rel.sigUrl, name, version: rel.version })
            );
        } catch {
            /* ignore */
        }
        try {
            await invoke("restart_as_admin");
            return; // l'app va se fermer après cet appel
        } catch {
            try {
                localStorage.removeItem("startradfr_pending_install");
            } catch {
                /* ignore */
            }
            await openExternal(STELLIVERSE_RELEASES_URL);
            return;
        }
    }

    try {
        await invoke("launch_updater", { url: rel.downloadUrl, sigUrl: rel.sigUrl, name });
        // l'app va se fermer et l'updater prend le relais
    } catch {
        await openExternal(STELLIVERSE_RELEASES_URL);
    }
}
