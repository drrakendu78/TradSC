// Types partagés entre les steps du wizard d'onboarding.

export type VersionInfo = { path: string; translated: boolean; up_to_date: boolean };
export type VersionPaths = { versions: Record<string, VersionInfo> };

export interface VersionSelection {
    selectedLink: string | null;
    installNow: boolean;
}

export interface ServicesConfig {
    backgroundEnabled: boolean;
    backgroundIntervalMin: number;
    discordEnabled: boolean;
    autoStartup: boolean;
    /** Companion LAN : démarrer le serveur HTTP/WS au démarrage de l'app
     *  pour piloter depuis un téléphone sur le même réseau Wi-Fi. */
    companionEnabled: boolean;
    /** Si vrai, on conserve le token courant entre les redémarrages
     *  (le QR code reste valide) ; sinon nouveau token à chaque démarrage. */
    companionPersistentToken: boolean;
    /** Auto-clean des caches Star Citizen obsolètes (versions plus installées).
     *  Persistance via localStorage `startradfr_auto_clear_obsolete_caches`. */
    autoCleanObsoleteCaches: boolean;
}

export interface OnboardingState {
    onboarding_done: boolean;
    attempts: number;
    was_completed: boolean;
}
