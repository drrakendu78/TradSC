// Coordinateur minimal pour s'assurer qu'un seul bandeau "pendouille" est
// déployé à la fois sur la titlebar. Évite le chevauchement entre Parrainage
// et Mon orga qui sont tous les deux ancrés au haut de la Home.

type BannerId = "referral" | "org" | null;

let active: BannerId = null;
const listeners = new Set<(id: BannerId) => void>();

export function setActiveBanner(id: BannerId) {
    active = id;
    listeners.forEach((l) => l(active));
}

export function getActiveBanner(): BannerId {
    return active;
}

export function subscribeActiveBanner(listener: (id: BannerId) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
