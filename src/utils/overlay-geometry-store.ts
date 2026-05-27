// Persistance localStorage de la position/taille des overlays (iframe ET
// webview) indexée par overlay id. Permet au prochain `open_overlay` /
// `open_webview_overlay` de restaurer la dernière géométrie que l'user a
// définie en draguant/redimensionnant manuellement l'overlay.
//
// Discord backlog thread #2 (pticopate, dual screen) — chaque ouverture
// reset la position/taille → casse les dispositions custom.

export interface OverlayGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

const STORAGE_KEY = "overlay_geometry_v1";

/** Lit toutes les géométries persistées (map id → geometry). */
function readAll(): Record<string, OverlayGeometry> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, OverlayGeometry>) : {};
    } catch {
        return {};
    }
}

/** Lit la géométrie persistée pour un overlay id. Retourne null si rien
 *  n'est sauvegardé OU si la valeur stockée est invalide. */
export function loadOverlayGeometry(id: string): OverlayGeometry | null {
    if (!id) return null;
    const map = readAll();
    const entry = map[id];
    if (
        !entry ||
        typeof entry.x !== "number" ||
        typeof entry.y !== "number" ||
        typeof entry.width !== "number" ||
        typeof entry.height !== "number" ||
        !Number.isFinite(entry.x) ||
        !Number.isFinite(entry.y) ||
        !Number.isFinite(entry.width) ||
        !Number.isFinite(entry.height) ||
        entry.width < 50 ||
        entry.height < 50
    ) {
        return null;
    }
    return entry;
}

/** Sauvegarde la géométrie d'un overlay. Merge dans la map existante,
 *  donc les géométries des autres overlays sont préservées. Tolère silentieuse
 *  un quota dépassé (rare avec un payload aussi petit). */
export function saveOverlayGeometry(id: string, geo: OverlayGeometry): void {
    if (!id || typeof window === "undefined") return;
    try {
        const map = readAll();
        map[id] = {
            x: Math.round(geo.x),
            y: Math.round(geo.y),
            width: Math.round(geo.width),
            height: Math.round(geo.height),
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* ignore — quota dépassé ou storage désactivé */
    }
}

/** Efface la géométrie sauvegardée d'un overlay (ex: reset par l'user). */
export function clearOverlayGeometry(id: string): void {
    if (!id || typeof window === "undefined") return;
    try {
        const map = readAll();
        if (id in map) {
            delete map[id];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        }
    } catch {
        /* ignore */
    }
}
