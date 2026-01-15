import { invoke } from "@tauri-apps/api/core";

// Whitelist des domaines autorisés pour plus de sécurité
const ALLOWED_DOMAINS = [
    "github.com",
    "drrakendu78.github.io",
    "discord.gg",
    "discord.com",
    "star-citizen-characters.com",
    "www.star-citizen-characters.com",
    "leonick.se",
    "api.github.com",
    "api.allorigins.win",
    "multitool.onivoid.fr",
    "erkul.games",
    "www.erkul.games",
    "uexcorp.space",
    "maps.adi.sc",
    "adi.sc",
    "startrad.link",
    "finder.cstone.space",
    "survey.cstone.space",
    "cstone.space",
];

// Autorise https, http (si besoin), et schémas ms-windows-store
function isAllowedUrl(url: string): boolean {
    try {
        // Autoriser les schémas spéciaux
        if (url.startsWith("ms-windows-store://")) {
            return true;
        }

        const u = new URL(url);
        
        // Vérifier le protocole
        if (u.protocol !== "https:" && u.protocol !== "http:") {
            return false;
        }

        // Pour les URLs HTTP, être plus strict (seulement localhost en dev)
        if (u.protocol === "http:") {
            return u.hostname === "localhost" || u.hostname === "127.0.0.1";
        }

        // Pour HTTPS, vérifier le domaine
        const hostname = u.hostname.toLowerCase();
        
        // Vérifier si le domaine est dans la whitelist ou un sous-domaine autorisé
        const isAllowed = ALLOWED_DOMAINS.some(domain => {
            return hostname === domain || hostname.endsWith(`.${domain}`);
        });

        return isAllowed;
    } catch {
        return false;
    }
}

export async function openExternal(url: string): Promise<void> {
    if (!isAllowedUrl(url)) {
        console.warn(`Tentative d'ouverture d'une URL non autorisée: ${url}`);
        return;
    }
    await invoke("open_external", { url });
}

/**
 * Ouvre un lien personnalisé défini par l'utilisateur sans restrictions de domaine.
 * Uniquement pour les liens explicitement ajoutés par l'utilisateur.
 */
export async function openExternalCustom(url: string): Promise<void> {
    try {
        const u = new URL(url);
        // Seulement autoriser http et https pour la sécurité
        if (u.protocol !== "https:" && u.protocol !== "http:") {
            console.warn(`Protocole non autorisé pour lien personnalisé: ${url}`);
            return;
        }
        await invoke("open_external", { url });
    } catch {
        console.warn(`URL invalide pour lien personnalisé: ${url}`);
    }
}

export default openExternal;
