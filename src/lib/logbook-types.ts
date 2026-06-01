/**
 * Types du Carnet de bord.
 *
 * Forme produite par la commande Rust `gamelog_history_stats`
 * (cf. `build_logbook_stats` dans `gamelog_history_parser.rs`).
 * Auparavant définie dans `logbook-mock-data.ts` (mock retiré au branchement live).
 */

export type ScSystemKey = "Stanton" | "Pyro" | "Nyx" | "Castra" | "Terra";

export interface LogbookStats {
    // Header
    streakDays: number;
    streakRecordDays: number;

    // Dernière session
    lastSession: {
        date: string; // ISO
        durationMinutes: number;
        vehicle: string;
        location: string;
    } | null;

    // KPIs
    totalHours: number;
    sessionCount: number;
    uniqueVehicleCount: number;
    vehicleCategoryCount: number;
    uniqueZoneCount: number;
    systemsVisited: ScSystemKey[];

    // Survie : épisodes d'asphyxie (manque d'O2). Absent si aucun épisode.
    survival?: {
        suffocationEpisodes: number;
        longestSuffocationSeconds: number;
        totalSuffocationSeconds: number;
    } | null;

    // Morts en vaisseau (éjecté d'un véhicule détruit). Absent si aucune.
    vehicleDeaths?: {
        count: number;
        deadliestVehicle: { name: string; count: number } | null;
    } | null;

    // Commerce cargo (P&L achat/revente). Absent si aucun trade cargo.
    // `net` = revente − achat sur la période (le cargo non encore revendu
    // n'est pas une perte). Les récompenses de mission ne sont PAS incluses
    // (non loggées de façon exploitable) → ce n'est pas un bilan global.
    cargoTrade?: {
        bought: number;
        sold: number;
        net: number;
        buyCount: number;
        sellCount: number;
        topCommodities: Array<{ name: string; bought: number; sold: number }>;
    } | null;

    // Dépenses boutique (items/équipement, SendStandardItemBuyRequest).
    // Absent si aucun achat. Données réelles (≠ revenus mission, non loggés).
    shopSpending?: {
        totalUec: number;
        count: number;
        topShops: Array<{ name: string; spent: number }>;
    } | null;

    // Compagnons de vol (party). Absent si aucun. Chefs nommés en clair ;
    // membres résolus via dico combat/login, sinon "Joueur #id".
    companions?: {
        total: number;
        named: number;
        distinctTeammates: number; // coéquipiers distincts (PlayerJoined)
        sharedMissions: number;    // missions partagées en groupe (MissionShared)
        timesLeader: number;       // fois chef de groupe (Transfer leadership depuis soi)
        list: Array<{ name: string; count: number; isLeader: boolean; resolved: boolean; fought: boolean }>;
    } | null;

    patchesTraversed: number;
    firstPatchSeen: string;

    // Heatmap : tableau de 52 semaines × 7 jours = 364 entrées (heures par jour)
    // Index 0 = il y a 52 semaines (lundi), 363 = aujourd'hui (dimanche)
    heatmap: number[];
    peakDay: { date: string; hours: number };

    // Top vaisseaux (jusqu'à 5)
    topVehicles: Array<{ name: string; hours: number; sessions: number }>;

    // Top locations (jusqu'à 5)
    topLocations: Array<{ name: string; hours: number; visits: number }>;

    // Évolution mensuelle : 12 mois (du plus ancien au plus récent)
    monthlyEvolution: Array<{ monthLabel: string; hours: number }>;

    // Dernières sessions (jusqu'à 30 ; l'UI en montre 5 puis « expand »)
    recentSessions: Array<{
        startedAt: string; // ISO
        durationMinutes: number;
        vehicles: string[];
        zones: string[];
        kills: number;
        deaths: number;
    }>;

    // Combat
    combat: {
        kills: number;
        deaths: number;
        // Ratio K/D. `null` si 0 mort (ratio non défini) — l'UI affiche alors
        // « ∞ » (kills > 0) ou « — » (0 kill) en se basant sur `deaths === 0`.
        ratio: number | null;
        favoriteWeapon: { name: string; kills: number };
        lastKill?: { weapon: string; victim: string; date: string };
    };

    // Blueprints (lien vers store existant)
    blueprintCount: number;
    recentBlueprints: Array<{ name: string; date: string }>;

    // Records personnels
    records: {
        longestSessionMinutes: number;
        fastestQuantumSeconds: number | null; // approx, dérivé ; null si non calculable
        longestStreakDays: number;
        latestNightHour: string | null; // ex "04h27" ; null si non calculable
        mostKillsInSession: number;
    };

    // Croisés en combat (jusqu'à 10)
    encounteredPlayers: Array<{
        name: string;
        kills: number; // kills sur ce joueur
        deaths: number; // morts contre ce joueur
        lastSeen: string; // ISO
    }>;

    // Cartographie : heures par système (que les visités)
    systemTime: Partial<Record<ScSystemKey, number>>;
    totalQuantumJumps: number;

    // Heure préférée : 24 valeurs (0h à 23h, heures cumulées)
    hourlyDistribution: number[];

    // Top jour de la semaine : 7 valeurs (Lun → Dim)
    weekdayDistribution: number[];

    // Top routes quantum (jusqu'à 5)
    topQuantumRoutes: Array<{ from: string; to: string; jumps: number }>;

    // Causes de mort
    deathCauses: Array<{ cause: string; count: number; icon: string }>;

    // Statistiques de missions.
    // Compteurs de complétion (réussies/échouées/abandonnées) : agrégés depuis
    // les `<EndMission>` réels, ancrés sur l'ownership GEID du joueur local.
    // La SPÉCIALITÉ vient des objectifs `<Create…ObjectiveHandler>` (type
    // dominant). ⚠️ Le `missionId` de ces objectifs étant à 0, on ne peut PAS
    // lier un objectif à une mission → pas de breakdown fiable « X missions
    // cargo complétées » par type. Les champs mining/cargo/salvage/bounty
    // MissionsComplete restent là pour compat mais ne sont plus affichés.
    missionStats?: {
        miningMissionsComplete: number;
        salvageMissionsComplete: number;
        bountyMissionsComplete: number;
        cargoMissionsComplete: number;
        totalMissionsComplete: number;
        totalMissionsFailed: number;
        totalMissionsAbandoned: number;
        // Spécialité dominante en label FR (ex "Cargo / Hauling"), ou null si
        // aucun objectif `<Create…ObjectiveHandler>` connu dans les logs.
        missionSpecialty: string | null;
        // Répartition brute des objectifs par type (ex { Hauling: 72961 }).
        objectiveTypeBreakdown?: Record<string, number>;
        hasMined: boolean;
        recentMissions?: Array<{
            completedAt: string; // ISO date
            type: "mining" | "salvage" | "bounty" | "cargo" | "fps" | "medical" | "refuel" | "investigation" | "race" | "touring" | "tutorial" | "other";
            text: string;
        }>;
    };

    // Profil de joueur : % par activité
    playerProfile: {
        dominantLabel: string; // ex "Mineur · Hauler"
        breakdown: Array<{ category: string; percent: number; icon: string; color: string }>;
    };

    // Achievements
    achievements: {
        unlockedCount: number;
        totalCount: number;
        items: Array<{
            id: string;
            label: string;
            unlocked: boolean;
            unlockedDate?: string;
            description?: string;
            progress?: { current: number; target: number };
            color: "emerald" | "cyan" | "violet" | "rose" | "amber" | "orange";
            icon: string; // lucide icon name
        }>;
    };
}
