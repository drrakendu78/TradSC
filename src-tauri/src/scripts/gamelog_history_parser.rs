// Parser exhaustif des Game.log Star Citizen pour reconstituer l'historique
// complet de jeu (Carnet de bord SC).
//
// Architecture inspirée de Picologs (MIT) :
// - Pre-filter substrings sur chaque ligne avant les regex (perf énorme)
// - Cache JSON dans app_config_dir, parsing incrémental par mtime
// - Modèle d'events typés (GameEvent enum) sérialisable pour le frontend
//
// Patterns supportés (Tier-1 SC 4.x, cf. wiki Research patterns EXTENDED) :
//   - Actor Death (kills/morts + classification PVE/PVP/Suicide)
//   - Vehicle Destruction (destroy_level 1=soft, 2=hard)
//   - Quantum 4-stage pipeline SC 4.5+ (Selected → Fuel → Spool → Arrived)
//   - Changing Solar System (Stanton ↔ Pyro)
//   - OnClientSpawned → session start
//   - EndSession / SystemQuit → session end
//   - AccountLoginCharacterStatus_Character → identité joueur (geid + name)
//   - Legacy login response → RSI handle
//   - MissionEnded / EndMission → missions complétées
//   - FatalCollision → crash vaisseau (avec entité percutée)
//   - Spawn Flow → respawn hôpital (avec bed name)
//   - SendStandardItemBuyRequest → achats (item, price, shop)
//   - Branch + Changelist → version SC du fichier
//
// PAS supportés pour V1 (skip volontaire) :
//   - <CEntityComponentInstancedInterior::OnEntity(Enter|Leave)Zone> (917k events spam)
//   - Loading screens / CET tasks
//   - Elevator / Docking tube
//   - EquipItem / AttachmentReceived
//   - Suffocation / Depressurization
//   - Actor Stall

use chrono::DateTime;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::path::PathResolver;
use tauri::{command, AppHandle, Emitter, Manager, Runtime};

use crate::scripts::gamepath::get_star_citizen_versions;

const SCHEMA_VERSION: u32 = 1;
const HISTORY_CACHE_FILENAME: &str = "gamelog_history.json";

/// Pre-filter substrings (stratégie Picologs) : si aucun de ces marqueurs
/// n'est dans la ligne, on skip immédiatement sans tenter les regex.
/// Sur 991 MB de logs R-om, ça divise le temps de parsing par ~50.
const EVENT_MARKERS: &[&str] = &[
    "AccountLoginCharacterStatus_Character",
    "<Legacy login response>",
    "<Actor Death>",
    "Destruction>", // matche <Vehicle Destruction>
    "<SystemQuit>",
    "<MissionEnded>",
    "<EndMission>",
    "<FatalCollision>",
    "<Quantum Drive Arrived",
    "<Player Selected Quantum Target",
    "<Player Requested Fuel to Quantum Target",
    "<Changing Solar System>",
    "RequestLocationInventory", // inventaire de lieu → présence système (cartographie sans saut)
    "OnClientSpawned",
    "Ending session",
    "<Spawn Flow>",
    "SendStandardItemBuyRequest",
    "SHUDEvent_OnNotification",
    "SendCommodityBuyRequest",
    "SendCommoditySellRequest", // ventes cargo (P&L commerce)
    "Vehicle Control Flow", // SetDriver/ClearDriver = vaisseaux pilotés (sorties réelles)
    "suffocating",          // [STAMINA] Player started/stopped suffocating (survie)
    "destroyed vehicle",    // [ActorState] Dead … destroyed vehicle (morts en vaisseau)
    "party-launch",         // chef de groupe en clair (compagnons de vol)
    "CPartyMarkerComponent",// membres de groupe (GEID)
    "PlayerJoined",         // coéquipier rejoint une mission partagée
    "MissionShared",        // mission partagée en groupe
    "Transfer group leadership", // fois chef de groupe
];

// ── Types persistés ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum GameEvent {
    SessionStart { ts: f64 },
    SessionEnd { ts: f64, reason: SessionEndReason },

    CharacterIdentified { ts: f64, name: String, geid: u64 },
    LoginHandle { ts: f64, handle: String },

    ActorDeath {
        ts: f64,
        victim: String,
        victim_geid: u64,
        zone: String,
        killer: String,
        killer_geid: u64,
        weapon: String,
        weapon_class: String,
        damage_type: String,
        victim_is_npc: bool,
        killer_is_npc: bool,
        is_suicide: bool,
    },

    VehicleDestruction {
        ts: f64,
        vehicle: String,
        zone: String,
        driver: String,
        /// GEID entité du driver (`driven by '...' [GEID]`). `0` si inconnu
        /// (log `unknown`/NPC). Ancre l'appartenance du vaisseau au joueur local.
        driver_geid: u64,
        destroy_level_from: u8,
        destroy_level_to: u8,
        caused_by: String,
        damage_type: String,
    },

    /// Player a confirmé une destination QT (stage 1 du pipeline SC 4.5+).
    /// `vehicle_geid` = GEID entité **ItemNavigation** du vaisseau (entre `[...]`).
    /// ⚠️ C'est la MÊME famille d'ID que les `QuantumArrived` (et DIFFÉRENTE du
    /// GEID contrôle/Vehicle capturé par le SetDriver) → c'est l'ancre correcte
    /// pour décider si une arrivée QT (sans marqueur `- Local`) est à nous.
    QuantumSelected { ts: f64, vehicle: String, vehicle_geid: u64, destination: String },
    /// Server a calculé le fuel pour le QT (stage 2).
    QuantumFuelRequested { ts: f64, vehicle: String, destination: String },
    /// QT arrivé à destination (stage 4, = QT réussi). `vehicle_geid` = GEID
    /// entité **ItemNavigation** du vaisseau. L'event n'a PAS de marqueur `- Local`,
    /// on filtre donc l'appartenance en testant ce GEID contre l'ensemble des
    /// ship-GEID des `QuantumSelected` locaux (même famille ItemNavigation).
    QuantumArrived { ts: f64, vehicle: String, vehicle_geid: u64 },

    /// Le joueur local prend les commandes d'un véhicule (`Vehicle Control Flow`
    /// `SetDriver`). Compté comme une **sortie** réelle (≠ estimation QT÷2).
    /// `geid` = entity GEID du joueur local (`Local client node [GEID]`) :
    /// ancre canonique d'identité (même famille d'ID que killer/victim_geid).
    VehicleControl { ts: f64, vehicle: String, geid: u64 },

    SolarSystemChange { ts: f64, entity: String, from: String, to: String },

    /// Système solaire détecté via le chargement de ses zones (object containers
    /// `loc/mod/<système>/…`). Signal de PRÉSENCE complémentaire au saut
    /// (`SolarSystemChange`) : certains systèmes (Nyx) sont atteints sans event
    /// de changement de système loggé. Émis dédupliqué (1× par système/fichier).
    SystemSeen { ts: f64, system: String },

    /// Le joueur local consulte un inventaire de lieu (`<RequestLocationInventory>
    /// Player[<nom>] requested inventory for Location[<lieu>]`). Signal de PRÉSENCE
    /// fiable, player-anchored, RÉPARTI sur la session : le nom de Location porte
    /// le système en préfixe (Nyx_Levski, Stanton3_Area18, Pyro4_…). Sert à
    /// attribuer le temps par système quand AUCUN `SolarSystemChange` n'est loggé
    /// (fréquent : Nyx, ou client qui ne loggue pas les sauts — cas Artics).
    LocationInventory { ts: f64, player: String, location: String },

    /// Épisode d'asphyxie (manque d'O2) — `[STAMINA] Player started/stopped
    /// suffocating`. `started=false` = fin d'épisode (permet de mesurer la durée).
    Suffocation { ts: f64, player: String, started: bool },

    /// Le joueur local meurt éjecté d'un véhicule détruit (`[ActorState] Dead`
    /// … `destroyed vehicle`). `vehicle` = zone d'éjection (canonicalisée ensuite).
    /// `actor_geid` = GEID de l'acteur éjecté (ancrage identité local).
    VehicleDeath { ts: f64, actor: String, actor_geid: u64, vehicle: String },

    /// Chef de groupe (`party-launch from leader[Handle]`) — nom EN CLAIR.
    PartyLeader { ts: f64, leader: String },
    /// Membre de groupe vu via `CPartyMarkerComponent` — identifié par GEID
    /// (résolu en pseudo via le dico combat/login quand c'est possible).
    PartyMember { ts: f64, geid: u64 },

    /// Un joueur a rejoint une mission partagée du groupe — `PlayerJoined`.
    MissionPlayerJoined { ts: f64, player_geid: u64 },
    /// Mission partagée dans le groupe — `MissionShared` (missionId pour distinct).
    MissionShared { ts: f64, mission_id: String },
    /// Transfert de leadership de groupe — `Transfer group leadership`
    /// (Client = l'ancien chef ; si == soi → on a été chef de groupe).
    GroupLeadershipTransfer { ts: f64, leader_geid: u64 },

    MissionEnded {
        ts: f64,
        mission_id: String,
        /// Nom du joueur attribué (`Player[...]` ancien format) — AFFICHAGE only.
        /// Vide pour le format v2 (SC 4.6+) qui ne logue plus le joueur.
        player: String,
        /// GEID du joueur attribué (`PlayerId[...]` ancien format) — ANCRE
        /// d'ownership (même famille que `resolved_local_geid`). `0` = inconnu
        /// (format v2 sans champ joueur exploitable) → mission d'INSTANCE, non
        /// attribuable au joueur local.
        player_geid: u64,
        completion_type: String, // Complete / Abort / Fail
        reason: String,
    },

    FatalCollision {
        ts: f64,
        vehicle: String,
        zone: String,
        hit_entity: String,
        part: String,
    },

    /// Crime commis par le joueur local, NOMMANT la victime (`<SHUDEvent_OnNotification>
    /// "Crime Committed: <type>` puis ligne suivante `against <victime>:`). Depuis que
    /// CIG a retiré `<Actor Death>`/`<Vehicle Destruction>` des logs (~nov 2025,
    /// anti-exploit/anti-stalking), c'est la SEULE source NOMINATIVE de combat :
    /// `Homicide` = kill joueur, `Destruction of Vehicle` = kill vaisseau, `Aggravated
    /// Assault`/`Grievous Bodily Harm` = engagement. ⚠️ zone surveillée only (Pyro
    /// lawless non capté) et joueur en AGRESSEUR (pas les kills subis).
    CrimeCommitted { ts: f64, crime_type: String, victim: String },

    /// Un coéquipier NOMMÉ rejoint le groupe/le canal du vaisseau (notif
    /// `<SHUDEvent_OnNotification> "New Member Joined` puis `<X> has joined the
    /// party/channel …`). Source la plus riche pour NOMMER les compagnons : les
    /// `PartyMember` (CPartyMarkerComponent) ne portent qu'un GEID souvent anonyme.
    PartyJoin { ts: f64, member: String },

    SpawnFlow {
        ts: f64,
        player: String,
        bed: String,
        location: String,
    },

    Purchase {
        ts: f64,
        item: String,
        client_price: f64,        // prix DÉCIMAL complet (LOW#4 : plus tronqué à l'unité)
        shop: String,
        player_id: u64,           // playerId du log → filtre joueur local
        // Devise de la transaction (`currencyType` du log). `UEC` = aUEC standard,
        // `REC` = Rec (Arena Commander, ≠ aUEC). Vide si le build ne logue pas le
        // champ → traité comme UEC. Sert à NE PAS mélanger UEC et REC dans l'éco.
        currency: String,
    },

    /// Notification de mission ("New Objective: …" / "Objective Complete: …").
    /// Permet de détecter mining/bounty/salvage missions sans parser le code
    /// scénario complet.
    MissionObjective {
        ts: f64,
        kind: String, // "new" | "complete"
        text: String,
    },

    /// Achat de commodity au terminal de cargo (SendCommodityBuyRequest).
    /// Permet le tracking cargo trade + suggestions de revente via UEX API.
    CommodityBuy {
        ts: f64,
        player_id: u64,           // playerId du log → filtre joueur local
        shop_name: String,
        shop_id: u64,
        price_total: f64,         // prix total en aUEC
        price_per_csu: f64,       // prix par cSCU (centième de SCU)
        commodity_guid: String,   // UUID interne de la commodity
        quantity_csu: f64,        // quantité en cSCU (1 SCU = 100 cSCU)
        box_size: f64,            // taille des caisses (1, 8, 16, 32 SCU)
        unit_amount: u64,         // nombre de caisses
    },

    /// Vente de commodity au terminal de cargo (SendCommoditySellRequest).
    /// ⚠️ `amount` = aUEC reçus (≠ buy `price`), `quantity_scu` en SCU (≠ cSCU).
    CommoditySell {
        ts: f64,
        player_id: u64,           // playerId du log → filtre joueur local
        shop_name: String,
        amount: f64,              // aUEC reçus (total)
        commodity_guid: String,   // UUID interne de la commodity
        quantity_scu: f64,        // quantité en SCU (1 SCU = 100 cSCU)
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionEndReason {
    Quit,          // <SystemQuit> CSystem::Quit invoked
    EndSession,    // <CDisciplineServiceExternal::EndSession>
    LogEnded,      // EOF sans event clean (= probably crash)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileMetadata {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ts: u64,
    pub sc_version: Option<String>,
    pub build_id: Option<u64>,
    pub parsed_at: u64,
    pub event_count: usize,
    /// Comptes d'objectifs de mission par TYPE pour ce fichier, dérivés des
    /// lignes `<Create(\w+)ObjectiveHandler>` (ex. `Hauling`, `Bounty`).
    /// Stocké en agrégat PAR FICHIER (et non 1 GameEvent/objectif) car le jeu
    /// loggue des dizaines de milliers d'objectifs → un event chacun ferait
    /// exploser le cache. Le `missionId` de ces lignes étant à 0, ces comptes
    /// ne servent QU'À dériver la spécialité dominante du joueur, JAMAIS à lier
    /// un objectif à une mission précise. `#[serde(default)]` → les caches déjà
    /// écrits (sans ce champ) se rechargent sans re-scan forcé ; le champ se
    /// remplit au prochain re-parse du fichier.
    #[serde(default)]
    pub objective_kinds: std::collections::HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCache {
    pub schema_version: u32,
    /// Handle RSI (login de compte, ex `Skjorn_Vaal`). Vient de
    /// `<AccountLoginCharacterStatus_Character>` ET `<Legacy login response>`.
    pub player_handle: Option<String>,
    /// Moniker (display name in-game, ex `Rom`). Capturé via Actor Death où
    /// le GEID matche le GEID du compte (les events gameplay utilisent le
    /// moniker, pas le handle). Peut changer au fil du temps.
    pub player_moniker: Option<String>,
    /// GEID stable du joueur (entity ID interne, ne change jamais).
    /// C'est l'ancre canonique pour matcher killer/victim contre le joueur.
    pub player_geid: Option<u64>,
    pub files: Vec<LogFileMetadata>,
    pub events: Vec<GameEvent>,
    pub last_scan_ts: u64,
}

impl Default for HistoryCache {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            player_handle: None,
            player_moniker: None,
            player_geid: None,
            files: Vec::new(),
            events: Vec::new(),
            last_scan_ts: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub total_files: usize,
    pub new_files_parsed: usize,
    /// Fichiers skippés car déjà parsés avec un mtime identique ou plus récent.
    /// C'est l'incremental scan : à la 2e exécution, ~342 fichiers sont skip
    /// et on parse juste les 1-2 nouveaux de la session courante.
    pub files_skipped: usize,
    pub total_events: usize,
    pub elapsed_ms: u128,
    pub player_handle: Option<String>,
    pub player_moniker: Option<String>,
}

// ── Regex (compiled once via OnceLock) ────────────────────────────────────

fn re_timestamp() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})Z>").unwrap()
    })
}

fn re_actor_death() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Capture les GEIDs (entity IDs stables) pour pouvoir matcher
        // killer/victim contre le joueur même si son moniker change entre
        // versions SC (ex Skjorn_Vaal handle ≠ "R-om" → "Rom" moniker).
        Regex::new(
            r"<Actor Death> CActor::Kill: '([^']+)' \[(\d+)\] in zone '([^']+)' killed by '([^']+)' \[(\d+)\] using '([^']+)' \[Class ([^\]]+)\] with damage type '([^']+)'"
        ).unwrap()
    })
}

fn re_vehicle_destruction() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Capture le GEID du driver (`driven by '...' [GEID]`) pour ancrer
        // l'appartenance du vaisseau sur l'identité (≠ collision de pseudo).
        Regex::new(
            r"<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle '([^']+)' \[\d+\] in zone '([^']+)' \[pos.*?\] driven by '([^']+)' \[(\d+)\] advanced from destroy level (\d+) to (\d+) caused by '([^']+)' \[\d+\] with '([^']+)'"
        ).unwrap()
    })
}

fn re_vehicle_control() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <Vehicle Control Flow> CVehicleMovementBase::SetDriver: Local client node [GEID] requesting control token for 'DRAK_Clipper_346349172816' [346349172816] [Team_CGP4][Vehicle]
        // Le `[GEID]` du "Local client node" = l'entity GEID du joueur LOCAL.
        // C'est la même famille d'ID que killer/victim_geid des Actor Death
        // (≠ geid du CharacterIdentified) → ancre canonique pour l'identité.
        Regex::new(
            r"SetDriver: Local client node \[(\d+)\] requesting control token for '([A-Za-z0-9_]+)'"
        ).unwrap()
    })
}

fn re_suffocation() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <[STAMINA] Player started suffocating> Player[R-om] Details:
        Regex::new(r"\[STAMINA\] Player (?:started|stopped) suffocating>\s*Player\[([^\]]+)\]").unwrap()
    })
}

fn re_vehicle_death() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <[ActorState] Dead> … Actor 'R-om' [202028776990] ejected from zone 'ANVL_Paladin_6791493947914' [..] to zone '..' … destroyed vehicle …
        // Capture le GEID de l'acteur ([202028776990]) → ancrage identité local.
        Regex::new(r"Actor '([^']+)' \[(\d+)\] ejected from zone '([^']+)'").unwrap()
    })
}

fn re_party_leader() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <party-launch> [notification] party-launch from leader[Mikechikeen] : ...
        Regex::new(r"party-launch from leader\[([^\]]+)\]").unwrap()
    })
}

fn re_party_member() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <CPartyMarkerComponent RWES> Streamed in party marker id NNN. TrackedEntityId: 3226505704116
        Regex::new(r"Streamed in party marker.*?TrackedEntityId:\s*(\d+)").unwrap()
    })
}

fn re_player_joined() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <PlayerJoined> … for: mission_id <UUID> - player_id 3226505704116
        Regex::new(r"PlayerJoined push message for: mission_id [a-f0-9\-]+ - player_id (\d+)").unwrap()
    })
}

fn re_mission_shared() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <MissionShared> Received share push message: ownerId[NNN] - missionId[<UUID>]
        Regex::new(r"MissionShared> Received share push message: ownerId\[\d+\] - missionId\[([a-f0-9\-]+)\]").unwrap()
    })
}

fn re_group_leadership() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <Transfer group leadership> Client 202028776990 transfer leadership to member …
        Regex::new(r"Transfer group leadership> Client (\d+) transfer leadership").unwrap()
    })
}

fn re_quantum_selected() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <Player Selected Quantum Target - Local> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point ObjectContainer_Lorville_City as their destination
        // ⚠️ Exige le littéral `- Local` : SC logue ce même event pour TOUS les
        // vaisseaux du bubble, mais seul le marqueur `- Local` = NOTRE vaisseau.
        // Sans ça, on importait les QT (et donc les vaisseaux) des autres joueurs.
        // On capture AUSSI le GEID entité ItemNavigation (entre `[...]`) : c'est la
        // même famille d'ID que `QuantumArrived` → il sert à reconnaître nos arrivées.
        Regex::new(
            r"<Player Selected Quantum Target - Local[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[(\d+)\].*?selected point (\w+) as their destination"
        ).unwrap()
    })
}

fn re_quantum_fuel() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Idem Selected : exige `- Local` pour ne garder que notre propre vaisseau.
        Regex::new(
            r"<Player Requested Fuel to Quantum Target - Local[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[\d+\].*?requested fuel calculation to destination (\w+)"
        ).unwrap()
    })
}

fn re_quantum_arrived() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // `Quantum Drive Arrived` n'a PAS de marqueur `- Local` (CIG ne le logue
        // pas par client) → on capture le GEID entité du vaisseau (entre `[...]`)
        // pour ne garder, au moment de l'agrégation, que les arrivées des
        // vaisseaux que le joueur a réellement pilotés (SetDriver local).
        Regex::new(
            r"<Quantum Drive Arrived[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[(\d+)\].*?has arrived at final destination"
        ).unwrap()
    })
}

fn re_solar_system() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Le pseudo peut contenir des tirets (R-om, space-man-rob), donc [\w-]+
        Regex::new(
            r"<Changing Solar System>.*?Client entity ([\w-]+) was found in tunnel zone [\w-]+, changing system from (\w+) to (\w+)"
        ).unwrap()
    })
}

fn re_on_client_spawned() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[CSessionManager::OnClientSpawned\] Spawned!").unwrap())
}

fn re_end_session() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"<CDisciplineServiceExternal::EndSession> Ending session").unwrap()
    })
}

fn re_system_quit() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<SystemQuit> CSystem::Quit invoked").unwrap())
}

fn re_character() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"<AccountLoginCharacterStatus_Character>.*?geid (\d+).*?name ([\w-]+) - state STATE_CURRENT"
        ).unwrap()
    })
}

fn re_login_handle() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"<Legacy login response>.*?Handle\[([A-Za-z0-9_-]+)\]").unwrap()
    })
}

fn re_mission_ended() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Ancien format SC 3.x / 4.0-4.5 :
        // <EndMission> Ending mission for player. MissionId[abc-123] Player[X] PlayerId[123] CompletionType[Complete] Reason[ObjectiveCompleted]
        // NB : `PlayerId[123]` (GEID, ancre d'ownership) est extrait à part via
        // `re_mission_ended_player_geid()` — un lazy `.*?` + groupe optionnel ici
        // ne le capturerait pas de façon fiable (le moteur préfère le vide).
        Regex::new(
            r"<EndMission>.*?MissionId\[([a-f0-9\-]+)\].*?Player\[([^\]]+)\].*?CompletionType\[([^\]]+)\].*?Reason\[([^\]]+)\]"
        ).unwrap()
    })
}

/// Extrait le `PlayerId[123]` (GEID) d'une ligne `<EndMission>` ancien format.
/// Séparé du regex principal car un capture optionnel lazy ne serait pas fiable.
/// Absent sur certains builds → l'ownership retombe alors sur le nom du joueur.
fn re_mission_ended_player_geid() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"PlayerId\[(\d+)\]").unwrap())
}

/// Nouveau format SC 4.6+ : `<MissionEnded> Received MissionEnded push message for:
/// mission_id <UUID> - mission_state MISSION_STATE_COMPLETED`.
/// On n'a plus le nom du joueur ni le type/reason, juste l'état.
fn re_mission_ended_v2() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"<MissionEnded>\s+Received MissionEnded push message for:\s+mission_id\s+([a-f0-9\-]+)\s+-\s+mission_state\s+MISSION_STATE_(\w+)"
        ).unwrap()
    })
}

/// Type d'objectif de mission instancié par le jeu :
/// `<CreateHaulingObjectiveHandler>` → capture `Hauling`. Le `\w+` entre
/// `Create` et `ObjectiveHandler` est le type d'activité (Hauling, Bounty,
/// Mining, Salvage…). Sert UNIQUEMENT à dériver la spécialité dominante.
fn re_objective_handler() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<Create(\w+)ObjectiveHandler>").unwrap())
}

fn re_fatal_collision() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <FatalCollision> Fatal Collision occured for vehicle X [Part: Wing, Pos: ..., Zone: Crusader, PlayerPilot: 1] after hitting entity: Asteroid [123].
        Regex::new(
            r"<FatalCollision>.*?for vehicle\s+([A-Za-z_0-9]+)\s+\[Part:\s*([^,]+),.*?Zone:\s*([^,\]]+).*?after hitting entity:\s*([^\[]+?)\s*\["
        ).unwrap()
    })
}

fn re_spawn_flow() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <Spawn Flow> Player 'X' lost reservation for spawnpoint bed_hospital_1_a-007 [123] at location 456
        Regex::new(
            r"<Spawn Flow>.*?Player\s+'([^']+)'.*?spawnpoint\s+(\S+)\s+\[\d+\]\s+at\s+location\s+(\d+)"
        ).unwrap()
    })
}

fn re_purchase() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Capture playerId (filtre joueur local) + shop + prix DÉCIMAL complet +
        // item + currencyType (LOW#4). Le prix est capturé entier (`[\d.]+`, pas
        // tronqué à l'unité) et la devise est optionnelle (anciens builds sans le
        // champ) — UEC (aUEC standard) vs REC (Rec, monnaie Arena Commander) :
        // on ne doit PAS additionner les deux dans l'éco aUEC.
        Regex::new(
            r"SendStandardItemBuyRequest>.*?playerId\[(\d+)\].*?shopName\[([^\]]+)\].*?client_price\[([\d.]+)\].*?itemName\[([^\]]+)\](?:.*?currencyType\[([A-Za-z]+)\])?"
        ).unwrap()
    })
}

/// Match SendCommodityBuyRequest. Capture playerId (filtre joueur local), shop,
/// prix, GUID commodity, quantité. ⚠️ L'unité `cSCU` est OPTIONNELLE : selon le
/// build SC, `quantity[700 cSCU]` ou `quantity[700]` → sinon l'achat est droppé
/// et le P&L cargo devient un profit pur (vente sans coût).
fn re_commodity_buy() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"SendCommodityBuyRequest>.*?playerId\[(\d+)\].*?shopId\[(\d+)\].*?shopName\[([^\]]+)\].*?price\[([\d.]+)\].*?shopPricePerCentiSCU\[([\d.]+)\].*?resourceGUID\[([a-f0-9\-]+)\].*?quantity\[([\d.]+)(?:\s*cSCU)?\].*?boxSize\[([\d.]+)\].*?unitAmount\[(\d+)\]"
        ).unwrap()
    })
}

/// Match SendCommoditySellRequest. Capture playerId (filtre joueur local).
/// ⚠️ `amount` (≠ buy `price`), `quantity` en SCU nu.
fn re_commodity_sell() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"SendCommoditySellRequest>.*?playerId\[(\d+)\].*?shopName\[([^\]]+)\].*?amount\[([\d.]+)\].*?resourceGUID\[([a-f0-9\-]+)\].*?quantity\[(\d+)\]"
        ).unwrap()
    })
}

/// Match les notifications de mission ("New Objective: X" / "Objective Complete: X").
/// Capture le texte de l'objectif. Supporte EN / FR / DE / ES / IT.
/// Le guillemet OUVRANT est parfois absent (certaines notifications CIG ne
/// l'émettent pas) → rendu optionnel (`"?`) sinon l'objectif est perdu (LOW#9).
/// Le guillemet FERMANT est lui aussi parfois absent (texte tronqué) → on accepte
/// soit la quote, soit un saut de ligne, soit la fin de string.
fn re_mission_objective() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"notification\s*"?(?:New Objective:|Objective Complete:|Nouvel objectif\s*:|Objectif accompli\s*:|Objectif complété\s*:|Objectif terminé\s*:|Neues Ziel:|Ziel abgeschlossen:|Nuevo objetivo:|Objetivo completado:|Nuovo obiettivo:|Obiettivo completato:)\s*([^"\r\n]+?)\s*(?:"|$|\r|\n)"#
        ).unwrap()
    })
}

fn re_branch() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Branch:\s*(sc-alpha-[\d.\-a-z]+)").unwrap())
}

fn re_changelist() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Changelist:\s*(\d+)").unwrap())
}

/// Suffixe d'instance `_DIGITS` (≥6 chiffres) en fin de nom interne SC. Partagé
/// par `canonicalize_vehicle` et `clean_zone_name`, deux fonctions appelées dans
/// des boucles chaudes (une fois par event) → compilé UNE fois via OnceLock au
/// lieu de recompiler à chaque appel (MED#13 perf).
fn re_instance_suffix() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"_\d{6,}$").unwrap())
}

/// Tag `_PU_AI_*` (vaisseaux PNJ pilotés par l'IA). Idem : hot path, compilé une
/// seule fois (MED#13).
fn re_pu_ai_tag() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"_PU_AI_\w+").unwrap())
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn parse_ts(line: &str) -> Option<f64> {
    let caps = re_timestamp().captures(line)?;
    let raw = format!("{}+00:00", caps.get(1)?.as_str());
    DateTime::parse_from_rfc3339(&raw).ok().map(|dt| {
        dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0
    })
}

/// Parse un montant monétaire d'un log SC. SC logue TOUJOURS en notation EN
/// (point décimal) — on garde donc le parsing `.` (pas de locale FR). LOW#10 :
/// au lieu de masquer un échec en zérotant l'éco en SILENCE (`unwrap_or(0.0)`),
/// on TRACE le champ fautif sur stderr et on retombe sur un fallback explicite.
/// `field` n'est utilisé que pour le diagnostic.
fn parse_money(raw: &str, field: &str, fallback: f64) -> f64 {
    match raw.parse::<f64>() {
        Ok(v) => v,
        Err(_) => {
            eprintln!(
                "[gamelog_history_parser] montant '{field}' illisible: {raw:?} → fallback {fallback}"
            );
            fallback
        }
    }
}

/// `true` si la devise d'un achat compte comme aUEC (monnaie standard de l'univers
/// persistant). LOW#4 : `REC` (Rec, Arena Commander) ne DOIT pas être additionné à
/// l'éco aUEC. Devise vide = build SC sans le champ `currencyType` → traité comme UEC
/// (les anciens logs n'émettaient que des achats aUEC). Tout le reste (REC, …) est exclu.
fn is_uec_currency(currency: &str) -> bool {
    currency.is_empty() || currency.eq_ignore_ascii_case("UEC")
}

// ── Conversion calendaire en heure LOCALE ────────────────────────────────────
// Les logs SC sont horodatés en UTC. TOUTES les stats CALENDAIRES / horloge-murale
// (heure préférée, jour de semaine, night-owl, frontières de jour des
// streaks/heatmap/« aujourd'hui ») doivent être calculées dans le fuseau LOCAL du
// joueur, sinon un Français (UTC+1/+2) voit ses heures décalées et ses streaks
// coupés/fusionnés près de minuit. `chrono::Local` gère l'heure d'été
// automatiquement. ⚠️ Les DURÉES (end - start) restent en secondes brutes — elles
// sont indépendantes du fuseau et ne passent PAS par ces helpers.

/// Convertit un timestamp Unix (UTC) en `DateTime<Local>` (fuseau machine).
/// `None` si le timestamp est hors plage représentable.
fn local_dt(ts: i64) -> Option<chrono::DateTime<chrono::Local>> {
    DateTime::<chrono::Utc>::from_timestamp(ts, 0).map(|dt| dt.with_timezone(&chrono::Local))
}

/// Index de jour CALENDAIRE en heure locale (numéro de jour proleptique grégorien
/// de la DATE locale). Contrairement à `ts / 86400` (frontières à minuit UTC), ce
/// numéro suit les minuits LOCAUX et reste correct au passage heure d'hiver/été
/// (chaque date locale = exactement un index, sans trou ni doublon). Utilisé pour
/// les streaks et la heatmap. Fallback `ts / 86400` si le ts est hors plage.
fn local_day_index(ts: i64) -> i64 {
    use chrono::Datelike;
    match local_dt(ts) {
        Some(dt) => dt.date_naive().num_days_from_ce() as i64,
        None => ts.div_euclid(86_400),
    }
}

/// Index de jour local d'AUJOURD'HUI (maintenant, fuseau machine). Même échelle
/// que `local_day_index` → comparable directement pour la heatmap / « aujourd'hui ».
fn local_today_index() -> i64 {
    use chrono::Datelike;
    chrono::Local::now().date_naive().num_days_from_ce() as i64
}

/// Classification NPC vs joueur. Reprise des heuristiques de Picologs + StarLogs.
fn is_npc(name: &str) -> bool {
    if name.is_empty() || name == "unknown" {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    // ── Prefixes/Substrings techniques (CIG codes) ───────────────────────────
    if name.starts_with("PU_")
        || name.contains("_NPC_")
        || name.starts_with("AIModule")
        || name.contains("AI_CRIM")
        || name.starts_with("NPC_Archetypes-")
    { return true; }
    // ── NPCs missions / scénarios (Shipjacker, Hazard, RotationSimple, etc.) ─
    if name.starts_with("Shipjacker_")
        || name.starts_with("Hazard-")
        || name.starts_with("Hazard_")
        || lower.starts_with("hazardzone_")
        || name.starts_with("RotationSimple-")
        || name.starts_with("RotationSimple_")
        || lower.starts_with("rotationcomplex")
        || lower.starts_with("scenario_")
        || lower.starts_with("scen_")
        || lower.starts_with("streamingsoc_")
        || lower.contains("_streaming")
    { return true; }
    // ── Vaisseaux AI (un vaisseau ne devrait jamais être un "joueur croisé") ──
    // Pattern : MANUFACTURER_Model_<id long>  ex: ANVL_Lightning_F8C_3321032172352
    let manufacturers = ["aegs_","anvl_","argo_","banu_","cnou_","crus_","drak_","espr_","gama_","grin_","krig_","misc_","mrai_","orig_","rsi_","tmbl_","vncl_","xian_"];
    if manufacturers.iter().any(|m| lower.starts_with(m)) {
        return true;
    }
    // ── Vanduul / Aliens (vlk_juvenile_sentry, vlk_*, vanduul_*) ────────────
    if lower.starts_with("vlk_")
        || lower.starts_with("vanduul_")
        || lower.contains("_juvenile_")
        || lower.contains("_sentry_")
    { return true; }
    // ── Faune (Kopion, Stalker, Marok) ──────────────────────────────────────
    if name.contains("Kopion_")
        || lower.starts_with("kopion_")
        || lower.starts_with("stalker_")
        || lower.starts_with("marok_")
        || lower.starts_with("crab_")
    { return true; }
    // ── Pilotes NPC (Criminal, Pirate, Mercenary, Outlaw, Security, etc.) ──
    if name.contains("Criminal-Pilot")
        || name.contains("-Pilot_Light_")
        || name.contains("-Pilot_Medium_")
        || name.contains("-Pilot_Heavy_")
        || name.starts_with("Security-")
        || name.starts_with("Pirate-")
        || name.starts_with("Pirate_")
        || name.starts_with("Outlaw-")
        || name.starts_with("Outlaw_")
        || name.starts_with("Mercenary-")
        || name.starts_with("Mercenary_")
        || lower.starts_with("soldier_")
        || lower.starts_with("guard_")
        || lower.starts_with("mob_")
    { return true; }
    // ── Entité AI à GEID numérique long en suffixe ──────────────────────────
    // Les entités IA/monde sont nommées `Archetype_..._<id long>` où l'id est le
    // GEID (≥ 10 chiffres, comme dans les Actor Death). Un VRAI handle joueur ne
    // se termine JAMAIS par `_<10+ chiffres>`. On NE se base PLUS sur la longueur
    // du nom ni sur le nombre de tirets : un pseudo comme `xX-Dark-Sniper-Pro`
    // (4 tirets) ou un handle long sont de VRAIS joueurs, pas des NPC.
    if let Some((prefix, suffix)) = name.rsplit_once('_') {
        if !prefix.is_empty()
            && suffix.len() >= 10
            && suffix.bytes().all(|b| b.is_ascii_digit())
        {
            return true;
        }
    }
    false
}

/// Extrait l'event d'une ligne (None si pas un event reconnu).
pub fn parse_line(line: &str) -> Option<GameEvent> {
    // 1) Strip timestamp d'abord
    let ts = parse_ts(line)?;

    // 2) Pre-filter Picologs
    if !EVENT_MARKERS.iter().any(|m| line.contains(m)) {
        return None;
    }

    // 3) Patterns (ordre par fréquence approximative pour perf)

    // Actor Death (le plus fréquent souvent)
    if line.contains("<Actor Death>") {
        if let Some(caps) = re_actor_death().captures(line) {
            let victim = caps[1].to_string();
            let victim_geid: u64 = caps[2].parse().unwrap_or(0);
            let killer = caps[4].to_string();
            let killer_geid: u64 = caps[5].parse().unwrap_or(0);
            let is_suicide = victim_geid == killer_geid && victim_geid != 0;
            return Some(GameEvent::ActorDeath {
                ts,
                victim: victim.clone(),
                victim_geid,
                zone: caps[3].to_string(),
                killer: killer.clone(),
                killer_geid,
                weapon: caps[6].to_string(),
                weapon_class: caps[7].to_string(),
                damage_type: caps[8].to_string(),
                victim_is_npc: is_npc(&victim),
                killer_is_npc: is_npc(&killer),
                is_suicide,
            });
        }
    }

    // Vehicle Destruction
    if line.contains("Destruction>") {
        if let Some(caps) = re_vehicle_destruction().captures(line) {
            return Some(GameEvent::VehicleDestruction {
                ts,
                vehicle: caps[1].to_string(),
                zone: caps[2].to_string(),
                driver: caps[3].to_string(),
                driver_geid: caps[4].parse().unwrap_or(0),
                destroy_level_from: caps[5].parse().unwrap_or(0),
                destroy_level_to: caps[6].parse().unwrap_or(0),
                caused_by: caps[7].to_string(),
                damage_type: caps[8].to_string(),
            });
        }
    }

    // Vehicle Control Flow — prise de commandes (SetDriver) = sortie réelle.
    if line.contains("Vehicle Control Flow") && line.contains("SetDriver") {
        if let Some(caps) = re_vehicle_control().captures(line) {
            return Some(GameEvent::VehicleControl {
                ts,
                geid: caps[1].parse().unwrap_or(0),
                vehicle: caps[2].to_string(),
            });
        }
    }

    // Suffocation (asphyxie / manque d'O2) — survie.
    if line.contains("suffocating") {
        if let Some(caps) = re_suffocation().captures(line) {
            return Some(GameEvent::Suffocation {
                ts,
                player: caps[1].to_string(),
                started: line.contains("started suffocating"),
            });
        }
    }

    // Inventaire de lieu — signal de présence système (le lieu porte le système
    // en préfixe). Player-anchored ; le client ne loggue QUE les requêtes du
    // joueur local. Ex : `Player[Artics001] requested inventory for Location[Nyx_Levski]`.
    if line.contains("<RequestLocationInventory>") {
        static RE_LOC_INV: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let re = RE_LOC_INV.get_or_init(|| {
            Regex::new(r"Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]").unwrap()
        });
        if let Some(caps) = re.captures(line) {
            return Some(GameEvent::LocationInventory {
                ts,
                player: caps[1].to_string(),
                location: caps[2].to_string(),
            });
        }
    }

    // Mort en vaisseau — éjecté d'un véhicule détruit.
    if line.contains("destroyed vehicle") && line.contains("[ActorState] Dead") {
        if let Some(caps) = re_vehicle_death().captures(line) {
            return Some(GameEvent::VehicleDeath {
                ts,
                actor: caps[1].to_string(),
                actor_geid: caps[2].parse().unwrap_or(0),
                vehicle: caps[3].to_string(),
            });
        }
    }

    // Chef de groupe (party-launch) — compagnons de vol (nom en clair).
    if line.contains("party-launch from leader") {
        if let Some(caps) = re_party_leader().captures(line) {
            return Some(GameEvent::PartyLeader { ts, leader: caps[1].to_string() });
        }
    }

    // Membre de groupe (CPartyMarkerComponent, streamed in) — GEID.
    if line.contains("CPartyMarkerComponent") && line.contains("Streamed in") {
        if let Some(caps) = re_party_member().captures(line) {
            return Some(GameEvent::PartyMember { ts, geid: caps[1].parse().unwrap_or(0) });
        }
    }

    // Stats de groupe (social).
    if line.contains("PlayerJoined") {
        if let Some(caps) = re_player_joined().captures(line) {
            return Some(GameEvent::MissionPlayerJoined { ts, player_geid: caps[1].parse().unwrap_or(0) });
        }
    }
    if line.contains("MissionShared>") {
        if let Some(caps) = re_mission_shared().captures(line) {
            return Some(GameEvent::MissionShared { ts, mission_id: caps[1].to_string() });
        }
    }
    if line.contains("Transfer group leadership") {
        if let Some(caps) = re_group_leadership().captures(line) {
            return Some(GameEvent::GroupLeadershipTransfer { ts, leader_geid: caps[1].parse().unwrap_or(0) });
        }
    }

    // Quantum Selected (stage 1)
    if line.contains("<Player Selected Quantum Target") {
        if let Some(caps) = re_quantum_selected().captures(line) {
            return Some(GameEvent::QuantumSelected {
                ts,
                vehicle: caps[1].to_string(),
                vehicle_geid: caps[2].parse().unwrap_or(0),
                destination: caps[3].to_string(),
            });
        }
    }

    // Quantum Fuel (stage 2)
    if line.contains("<Player Requested Fuel to Quantum Target") {
        if let Some(caps) = re_quantum_fuel().captures(line) {
            return Some(GameEvent::QuantumFuelRequested {
                ts,
                vehicle: caps[1].to_string(),
                destination: caps[2].to_string(),
            });
        }
    }

    // Quantum Arrived (stage 4 = QT réussi)
    if line.contains("<Quantum Drive Arrived") {
        if let Some(caps) = re_quantum_arrived().captures(line) {
            return Some(GameEvent::QuantumArrived {
                ts,
                vehicle: caps[1].to_string(),
                vehicle_geid: caps[2].parse().unwrap_or(0),
            });
        }
    }

    // Changing Solar System
    if line.contains("<Changing Solar System>") {
        if let Some(caps) = re_solar_system().captures(line) {
            return Some(GameEvent::SolarSystemChange {
                ts,
                entity: caps[1].to_string(),
                from: caps[2].to_string(),
                to: caps[3].to_string(),
            });
        }
    }

    // OnClientSpawned (session start)
    if line.contains("OnClientSpawned") && re_on_client_spawned().is_match(line) {
        return Some(GameEvent::SessionStart { ts });
    }

    // SessionEnd via EndSession
    if line.contains("Ending session") && re_end_session().is_match(line) {
        return Some(GameEvent::SessionEnd { ts, reason: SessionEndReason::EndSession });
    }

    // SessionEnd via SystemQuit
    if line.contains("<SystemQuit>") && re_system_quit().is_match(line) {
        return Some(GameEvent::SessionEnd { ts, reason: SessionEndReason::Quit });
    }

    // Character identified
    if line.contains("AccountLoginCharacterStatus_Character") {
        if let Some(caps) = re_character().captures(line) {
            let geid: u64 = caps[1].parse().unwrap_or(0);
            return Some(GameEvent::CharacterIdentified {
                ts,
                name: caps[2].to_string(),
                geid,
            });
        }
    }

    // Login handle (RSI)
    if line.contains("<Legacy login response>") {
        if let Some(caps) = re_login_handle().captures(line) {
            return Some(GameEvent::LoginHandle { ts, handle: caps[1].to_string() });
        }
    }

    // Mission ended — ancien format (SC 3.x / 4.0-4.5)
    if line.contains("<EndMission>") {
        if let Some(caps) = re_mission_ended().captures(line) {
            // GEID joueur (`PlayerId[...]`) extrait à part — ancre d'ownership.
            // Absent sur certains builds → 0 (fallback nominal sur `Player[...]`).
            let player_geid = re_mission_ended_player_geid()
                .captures(line)
                .and_then(|c| c[1].parse::<u64>().ok())
                .unwrap_or(0);
            return Some(GameEvent::MissionEnded {
                ts,
                mission_id: caps[1].to_string(),
                player: caps[2].to_string(),
                player_geid,
                completion_type: caps[3].to_string(),
                reason: caps[4].to_string(),
            });
        }
    }

    // Mission ended — nouveau format (SC 4.6+)
    if line.contains("<MissionEnded>") {
        if let Some(caps) = re_mission_ended_v2().captures(line) {
            let state = caps[2].to_string();
            // Mappe l'état vers completion_type pour rester compatible
            // avec l'ancien format (Complete / Failed / Abandoned).
            let completion_type = match state.as_str() {
                "COMPLETED" => "Complete",
                "FAILED" => "Failed",
                "ABANDONED" => "Abandoned",
                _ => "Other",
            }.to_string();
            return Some(GameEvent::MissionEnded {
                ts,
                mission_id: caps[1].to_string(),
                player: String::new(),  // v2 ne logue plus le nom du joueur…
                player_geid: 0,         // …ni son GEID → mission d'INSTANCE, non perso
                completion_type,
                reason: state,
            });
        }
    }

    // Fatal collision
    if line.contains("<FatalCollision>") {
        if let Some(caps) = re_fatal_collision().captures(line) {
            return Some(GameEvent::FatalCollision {
                ts,
                vehicle: caps[1].to_string(),
                part: caps[2].trim().to_string(),
                zone: caps[3].trim().to_string(),
                hit_entity: caps[4].trim().to_string(),
            });
        }
    }

    // Spawn Flow (respawn)
    if line.contains("<Spawn Flow>") {
        if let Some(caps) = re_spawn_flow().captures(line) {
            return Some(GameEvent::SpawnFlow {
                ts,
                player: caps[1].to_string(),
                bed: caps[2].to_string(),
                location: caps[3].to_string(),
            });
        }
    }

    // Purchase
    if line.contains("SendStandardItemBuyRequest") {
        if let Some(caps) = re_purchase().captures(line) {
            return Some(GameEvent::Purchase {
                ts,
                // Ordre réel du log : playerId … shopName … client_price … itemName … currencyType.
                player_id: caps[1].parse().unwrap_or(0),
                shop: caps[2].to_string(),
                // Prix décimal complet + fallback traçable (LOW#4 / LOW#10).
                client_price: parse_money(&caps[3], "client_price", 0.0),
                item: caps[4].to_string(),
                // currencyType optionnel ; vide = build sans le champ (= UEC).
                currency: caps.get(5).map(|m| m.as_str().to_string()).unwrap_or_default(),
            });
        }
    }

    // Achat de commodity (cargo terminal)
    if line.contains("SendCommodityBuyRequest") {
        if let Some(caps) = re_commodity_buy().captures(line) {
            return Some(GameEvent::CommodityBuy {
                ts,
                player_id: caps[1].parse().unwrap_or(0),
                shop_id: caps[2].parse().unwrap_or(0),
                shop_name: caps[3].to_string(),
                // Montants aUEC : fallback traçable plutôt que 0 silencieux (LOW#10).
                price_total: parse_money(&caps[4], "commodity_buy.price", 0.0),
                price_per_csu: parse_money(&caps[5], "commodity_buy.pricePerCentiSCU", 0.0),
                commodity_guid: caps[6].to_string(),
                quantity_csu: caps[7].parse().unwrap_or(0.0),
                box_size: caps[8].parse().unwrap_or(0.0),
                unit_amount: caps[9].parse().unwrap_or(0),
            });
        }
    }

    // Vente de commodity (cargo terminal) — pour le P&L commerce cargo.
    if line.contains("SendCommoditySellRequest") {
        if let Some(caps) = re_commodity_sell().captures(line) {
            return Some(GameEvent::CommoditySell {
                ts,
                player_id: caps[1].parse().unwrap_or(0),
                shop_name: caps[2].to_string(),
                // aUEC reçus : fallback traçable plutôt que 0 silencieux (LOW#10).
                amount: parse_money(&caps[3], "commodity_sell.amount", 0.0),
                commodity_guid: caps[4].to_string(),
                quantity_scu: caps[5].parse().unwrap_or(0.0),
            });
        }
    }

    // Mission Objective notification — language-aware (EN / FR / DE / ES / IT)
    // Format : <SHUDEvent_OnNotification> Added notification "<intitulé>: <détail>"
    if line.contains("SHUDEvent_OnNotification") {
        // Marqueurs "nouvel objectif" en EN/FR/DE/ES/IT
        let new_markers = [
            "New Objective:",       // EN (vanilla)
            "Nouvel objectif:",     // FR
            "Nouvel objectif :",    // FR (espace insécable)
            "Neues Ziel:",          // DE
            "Nuevo objetivo:",      // ES
            "Nuovo obiettivo:",     // IT
        ];
        let complete_markers = [
            "Objective Complete:",  // EN
            "Objectif accompli:",   // FR variante
            "Objectif accompli :",  // FR variante
            "Objectif complété:",   // FR variante
            "Objectif terminé:",    // FR (le vrai utilisé par CIG)
            "Objectif terminé :",   // FR (espace insécable)
            "Ziel abgeschlossen:",  // DE
            "Objetivo completado:", // ES
            "Obiettivo completato:",// IT
        ];
        let is_new = new_markers.iter().any(|m| line.contains(m));
        let is_complete = complete_markers.iter().any(|m| line.contains(m));
        if is_new || is_complete {
            if let Some(caps) = re_mission_objective().captures(line) {
                let kind = if is_new { "new" } else { "complete" };
                return Some(GameEvent::MissionObjective {
                    ts,
                    kind: kind.to_string(),
                    text: caps[1].trim().to_string(),
                });
            }
        }
    }

    None
}

// ── File-level scan ────────────────────────────────────────────────────────

pub struct FileScanResult {
    pub events: Vec<GameEvent>,
    pub version: Option<String>,
    pub build_id: Option<u64>,
    /// Comptes d'objectifs par type pour ce fichier (cf. `LogFileMetadata`).
    /// Agrégat léger (pas 1 event/objectif) → zéro bloat du cache d'events.
    pub objective_kinds: std::collections::HashMap<String, u64>,
}

/// Parse un fichier .log complet.
/// Note : utilise read_to_string + lines() ; pour V1 acceptable car ~3 MB/fichier.
/// Si la perf devient un souci sur de très gros fichiers, switcher en BufReader.
/// Détecte le système solaire depuis un chemin d'object container chargé
/// (`data/objectcontainers/pu/loc/mod/<système>/…`). Signal de présence : le
/// jeu charge les zones du système où le joueur se trouve / vient d'arriver.
fn system_from_location_path(line: &str) -> Option<&'static str> {
    if !line.contains("loc/mod/") {
        return None;
    }
    if line.contains("loc/mod/nyx/") { Some("Nyx") }
    else if line.contains("loc/mod/pyro/") { Some("Pyro") }
    else if line.contains("loc/mod/stanton/") { Some("Stanton") }
    else if line.contains("loc/mod/castra/") { Some("Castra") }
    else if line.contains("loc/mod/terra/") { Some("Terra") }
    else { None }
}

/// Déduit le système solaire depuis un token de LIEU (`Location[...]` de
/// `RequestLocationInventory`, zone d'éjection, destination QT, etc.). Renvoie
/// `None` sur token inconnu → l'appelant NE déplace PAS le système courant (jamais
/// de faux positif sur du bruit). Vocabulaire validé sur les logs réels d'Artics
/// (Nyx_Levski, Stanton3_Area18, Pyro4_Outpost…, RR_JP_…, éjections pyro1/P3_L3…).
fn system_from_zone_token(tok: &str) -> Option<&'static str> {
    let l = tok.to_ascii_lowercase();
    // Points de saut `RR_JP_<Origine><Dest>` → attribués à l'ORIGINE (1er système).
    if let Some(rest) = l.strip_prefix("rr_jp_") {
        if rest.starts_with("nyx") { return Some("Nyx"); }
        if rest.starts_with("pyro") { return Some("Pyro"); }
        if rest.starts_with("stanton") { return Some("Stanton"); }
    }
    // Nyx (Levski, Keeger, Delamar…)
    if l.contains("nyx") || l.contains("levski") || l.contains("keeger") || l.contains("delamar") {
        return Some("Nyx");
    }
    // Pyro : `pyro…`, `rr_p<chiffre>…`, éjections `p<chiffre>_l<chiffre>`.
    let is_pyro_pl = l.len() >= 4
        && l.as_bytes()[0] == b'p'
        && l.as_bytes()[1].is_ascii_digit()
        && l[2..].starts_with("_l");
    if l.starts_with("pyro") || l.starts_with("rr_p") || is_pyro_pl {
        return Some("Pyro");
    }
    // Stanton (préfixes + lieux connus).
    if l.starts_with("stanton") || l.starts_with("ooc_stanton")
        || l.starts_with("rr_arc") || l.starts_with("rr_hur")
        || l.starts_with("rr_cru") || l.starts_with("rr_mic")
        || l.contains("area18") || l.contains("arccorp") || l.contains("orison")
        || l.contains("newbabbage") || l.contains("new_babbage") || l.contains("grimhex")
        || l.contains("lorville") || l.contains("hurston") || l.contains("crusader")
        || l.contains("microtech") || l.contains("babbage")
        || l.contains("hurdyn") || l.contains("shubin") || l.contains("terramills")
        || l.contains("daymar") || l.contains("aberdeen")
        || (l.contains("outpost") && l.contains("stanton"))
    {
        return Some("Stanton");
    }
    None
}

pub fn scan_file(path: &Path) -> Result<FileScanResult, String> {
    let bytes = fs::read(path).map_err(|e| format!("Lecture {}: {e}", path.display()))?;
    let content = String::from_utf8_lossy(&bytes);

    let mut events = Vec::new();
    let mut version: Option<String> = None;
    let mut build_id: Option<u64> = None;
    // Systèmes déjà émis pour ce fichier (dédup → 1 event SystemSeen/système).
    let mut systems_seen: std::collections::HashSet<&'static str> = std::collections::HashSet::new();
    // Comptes d'objectifs par type (Hauling, Bounty…) pour CE fichier. Agrégé
    // ici plutôt qu'en events car le jeu en loggue des dizaines de milliers.
    let mut objective_kinds: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    // État pour le parsing multi-ligne des "Crime Committed" (type sur la ligne N,
    // "against <victime>" sur la ligne N+1, même timestamp).
    let mut pending_crime: Option<(f64, String)> = None;

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }

        // Objectif de mission instancié (`<Create(\w+)ObjectiveHandler>`). On
        // compte le type sans émettre d'event (anti-bloat). Pré-filtre substring
        // avant la regex pour ne payer le coût que sur les lignes concernées.
        if line.contains("ObjectiveHandler>") {
            if let Some(caps) = re_objective_handler().captures(line) {
                *objective_kinds.entry(caps[1].to_string()).or_insert(0) += 1;
            }
        }

        // Présence système via chargement de zones (Nyx atteint sans event de saut).
        if let Some(sys) = system_from_location_path(line) {
            if systems_seen.insert(sys) {
                events.push(GameEvent::SystemSeen { ts: parse_ts(line).unwrap_or(0.0), system: sys.to_string() });
            }
        }

        // Crime commis (multi-ligne) : "...Crime Committed: <type>" (ligne N) puis
        // "against <victime>:" (ligne N+1). Seule source NOMINATIVE de kills PVP
        // depuis le retrait de <Actor Death>/<Vehicle Destruction> par CIG.
        if let Some((cts, ctype)) = pending_crime.take() {
            let vstart = line.find("against ").map(|i| i + "against ".len())
                .or_else(|| line.find("contre ").map(|i| i + "contre ".len()));
            if let Some(vs) = vstart {
                let victim = line[vs..].split(':').next().unwrap_or("").trim().to_string();
                if !victim.is_empty() {
                    events.push(GameEvent::CrimeCommitted { ts: cts, crime_type: ctype, victim });
                }
            }
        }
        if let Some(after_idx) = ["Crime Committed: ", "Crime commis : ", "Crime commis: "]
            .iter().find_map(|p| line.find(p).map(|i| i + p.len()))
        {
            let after = line[after_idx..].trim().trim_end_matches('"').trim();
            if !after.is_empty() {
                pending_crime = Some((parse_ts(line).unwrap_or(0.0), after.to_string()));
            }
        }

        // Compagnon NOMMÉ qui rejoint : "<X> has joined the party/channel …" (3ᵉ
        // personne → autre joueur ; "You have joined" = soi, exclu car "have"). Le
        // pseudo est récupérable ici alors que les PartyMember sont des GEID anonymes.
        if line.contains(" has joined the channel ") || line.contains(" has joined the party") {
            if let Some(jidx) = line.find(" has joined the ") {
                let before = &line[..jidx];
                // Retire le préfixe timestamp "<...> " pour ne garder que le pseudo.
                let member = before.rfind("> ").map(|i| &before[i + 2..]).unwrap_or(before).trim();
                if !member.is_empty() && member.len() <= 32 && !member.contains(' ') {
                    events.push(GameEvent::PartyJoin { ts: parse_ts(line).unwrap_or(0.0), member: member.to_string() });
                }
            }
        }

        // Metadata header (premières lignes du fichier)
        if version.is_none() && line.contains("Branch: sc-alpha-") {
            if let Some(caps) = re_branch().captures(line) {
                version = Some(caps[1].to_string());
            }
        }
        if build_id.is_none() && line.contains("Changelist:") {
            if let Some(caps) = re_changelist().captures(line) {
                build_id = caps[1].parse().ok();
            }
        }

        if let Some(event) = parse_line(line) {
            events.push(event);
        }
    }

    Ok(FileScanResult { events, version, build_id, objective_kinds })
}

// ── Paths ──────────────────────────────────────────────────────────────────

fn ensure_config_dir<R: Runtime>(path: &PathResolver<R>) -> Result<PathBuf, String> {
    let dir = path
        .app_config_dir()
        .map_err(|_| "Impossible d'obtenir app_config_dir".to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn cache_path<R: Runtime>(path: &PathResolver<R>) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(path)?.join(HISTORY_CACHE_FILENAME))
}

fn get_live_game_log_path() -> Result<PathBuf, String> {
    let versions = get_star_citizen_versions();
    if versions.versions.is_empty() {
        return Err("Aucune installation Star Citizen détectée".to_string());
    }
    let install_path = versions
        .versions
        .get("LIVE")
        .or_else(|| versions.versions.values().next())
        .ok_or_else(|| "Aucune version SC trouvée".to_string())?
        .path
        .clone();
    Ok(PathBuf::from(install_path).join("Game.log"))
}

// ── Cache I/O ──────────────────────────────────────────────────────────────

pub fn load_cache(app: &AppHandle) -> Result<HistoryCache, String> {
    let p = cache_path(app.path())?;
    if !p.exists() {
        return Ok(HistoryCache::default());
    }
    let json = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn save_cache(app: &AppHandle, cache: &HistoryCache) -> Result<(), String> {
    let p = cache_path(app.path())?;
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

// ── Scan exhaustif logbackups/ ─────────────────────────────────────────────

fn event_ts(e: &GameEvent) -> f64 {
    match e {
        GameEvent::SessionStart { ts } => *ts,
        GameEvent::SessionEnd { ts, .. } => *ts,
        GameEvent::CharacterIdentified { ts, .. } => *ts,
        GameEvent::LoginHandle { ts, .. } => *ts,
        GameEvent::ActorDeath { ts, .. } => *ts,
        GameEvent::VehicleDestruction { ts, .. } => *ts,
        GameEvent::QuantumSelected { ts, .. } => *ts,
        GameEvent::QuantumFuelRequested { ts, .. } => *ts,
        GameEvent::QuantumArrived { ts, .. } => *ts,
        GameEvent::VehicleControl { ts, .. } => *ts,
        GameEvent::SolarSystemChange { ts, .. } => *ts,
        GameEvent::SystemSeen { ts, .. } => *ts,
        GameEvent::LocationInventory { ts, .. } => *ts,
        GameEvent::Suffocation { ts, .. } => *ts,
        GameEvent::VehicleDeath { ts, .. } => *ts,
        GameEvent::PartyLeader { ts, .. } => *ts,
        GameEvent::PartyMember { ts, .. } => *ts,
        GameEvent::MissionPlayerJoined { ts, .. } => *ts,
        GameEvent::MissionShared { ts, .. } => *ts,
        GameEvent::GroupLeadershipTransfer { ts, .. } => *ts,
        GameEvent::MissionEnded { ts, .. } => *ts,
        GameEvent::FatalCollision { ts, .. } => *ts,
        GameEvent::CrimeCommitted { ts, .. } => *ts,
        GameEvent::PartyJoin { ts, .. } => *ts,
        GameEvent::SpawnFlow { ts, .. } => *ts,
        GameEvent::Purchase { ts, .. } => *ts,
        GameEvent::MissionObjective { ts, .. } => *ts,
        GameEvent::CommodityBuy { ts, .. } => *ts,
        GameEvent::CommoditySell { ts, .. } => *ts,
    }
}

/// Déduplique le cache d'events APRÈS le tri global, en gardant la **première**
/// occurrence de chaque event (l'ordre trié est donc préservé).
///
/// Nécessaire car le cache stocke les events à plat (`cache.events`), sans
/// attribution par fichier : quand un fichier modifié est re-parsé — en
/// particulier le `Game.log` LIVE dont le mtime bouge à chaque scan, donc jamais
/// skippé — ses events sont ré-append au cache, ce qui les double-compterait
/// (achats, kills, sessions, QT, heures…).
///
/// La clé de dédup est le **contenu complet** de l'event (`{:?}` couvre le type
/// ET tous les champs, `GameEvent` dérivant `Debug`). Conséquences voulues :
/// - les doublons d'un re-parse sont identiques bit-à-bit → fusionnés ;
/// - deux events légitimement distincts au même `ts` (p.ex. 2 kills de victimes
///   différentes à la même seconde) ont une clé différente → tous deux conservés ;
/// - la rotation du `Game.log` est gérée : les events de l'ancien `Game.log`
///   sont identiques à ceux du logbackup archivé → fusionnés.
fn dedup_events(events: &mut Vec<GameEvent>) {
    let mut seen = std::collections::HashSet::new();
    events.retain(|e| seen.insert(format!("{e:?}")));
}

/// Scanne tous les fichiers de logbackups + Game.log courant et alimente le
/// cache. Si `force` = false, skip les fichiers déjà parsés (mtime-based).
pub fn scan_logbackups(app: &AppHandle, force: bool, override_dir: Option<PathBuf>) -> Result<ScanResult, String> {
    let start = Instant::now();

    let mut cache = if force {
        HistoryCache::default()
    } else {
        load_cache(app).unwrap_or_default()
    };

    // Source : soit chemin SC live, soit override (pour dev/tests fixtures)
    let (game_log_path, logbackups_dir): (Option<PathBuf>, PathBuf) = match override_dir {
        Some(dir) => {
            let game_log = dir.join("Game.log");
            let backups = dir.join("logbackups");
            (if game_log.is_file() { Some(game_log) } else { None }, backups)
        }
        None => {
            let game_log = get_live_game_log_path()?;
            let backups = game_log.parent().unwrap().join("logbackups");
            (Some(game_log), backups)
        }
    };

    // Liste des .log
    let mut files: Vec<PathBuf> = if logbackups_dir.is_dir() {
        fs::read_dir(&logbackups_dir)
            .map_err(|e| format!("Read logbackups : {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("log"))
                        .unwrap_or(false)
            })
            .collect()
    } else {
        Vec::new()
    };
    files.sort();

    if let Some(gl) = &game_log_path {
        if gl.is_file() && !files.iter().any(|p| p == gl) {
            files.push(gl.clone());
        }
    }

    if files.is_empty() {
        return Err(format!(
            "Aucun .log dans logbackups ({}) ni Game.log courant",
            logbackups_dir.display()
        ));
    }

    let total = files.len();
    let mut new_files_parsed: usize = 0;
    let mut files_skipped: usize = 0;

    // Set des paths déjà parsés (mtime-based pour incremental).
    // Au 2e scan, on skip immédiatement les fichiers dont le mtime n'a pas
    // changé depuis le dernier parsing → coût quasi nul.
    let parsed_by_mtime: std::collections::HashMap<String, u64> = cache
        .files
        .iter()
        .map(|f| (f.path.clone(), f.modified_ts))
        .collect();

    for (i, path) in files.iter().enumerate() {
        let path_str = path.display().to_string();
        let metadata = fs::metadata(path).ok();
        let modified_ts = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

        // Skip si déjà parsé et même mtime
        if let Some(&prev_mtime) = parsed_by_mtime.get(&path_str) {
            if prev_mtime >= modified_ts {
                files_skipped += 1;
                continue;
            }
            // Le fichier a été modifié depuis dernier scan : on le re-parse.
            // On supprime son entrée de `cache.files` (re-poussée plus bas avec
            // les métadonnées à jour). Ses anciens events restent provisoirement
            // dans `cache.events` mais seront éliminés par `dedup_events` après
            // le tri global (les events re-parsés étant identiques au contenu).
            cache.files.retain(|f| f.path != path_str);
        }

        match scan_file(path) {
            Ok(result) => {
                let event_count = result.events.len();
                cache.files.push(LogFileMetadata {
                    path: path_str,
                    size_bytes,
                    modified_ts,
                    sc_version: result.version,
                    build_id: result.build_id,
                    parsed_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0),
                    event_count,
                    objective_kinds: result.objective_kinds,
                });
                cache.events.extend(result.events);
                new_files_parsed += 1;
            }
            Err(e) => {
                eprintln!("[gamelog_history_parser] Skip {} : {e}", path.display());
            }
        }

        // Progress tous les 10 fichiers
        if i % 10 == 0 || i + 1 == total {
            let _ = app.emit(
                "gamelog-history:scan_progress",
                serde_json::json!({
                    "current": i + 1,
                    "total": total,
                    "percent": ((i + 1) as f64 * 100.0 / total as f64) as u8,
                }),
            );
        }
    }

    // Sort events globalement par ts
    cache.events.sort_by(|a, b| event_ts(a).partial_cmp(&event_ts(b)).unwrap_or(std::cmp::Ordering::Equal));

    // Déduplique APRÈS le tri : élimine les events re-comptés lors d'un re-parse
    // (Game.log LIVE re-scanné à chaque fois, rotation Game.log → logbackup…).
    // Voir `dedup_events` pour la justification (clé = contenu complet de l'event).
    dedup_events(&mut cache.events);

    // 1) Identifie le handle RSI + GEID stable depuis CharacterIdentified.
    //    Un compte = un seul GEID (entity ID interne ne change jamais),
    //    même si le moniker (display name in-game) change avec le temps.
    for ev in &cache.events {
        if let GameEvent::CharacterIdentified { name, geid, .. } = ev {
            cache.player_handle = Some(name.clone());
            cache.player_geid = Some(*geid);
            break;
        }
    }
    // Fallback : `<Legacy login response>` capture aussi le handle.
    if cache.player_handle.is_none() {
        for ev in &cache.events {
            if let GameEvent::LoginHandle { handle, .. } = ev {
                cache.player_handle = Some(handle.clone());
                break;
            }
        }
    }

    // 2) Détermine le MONIKER actif via heuristique fréquence :
    //    le NON-NPC qui apparaît le plus souvent dans les Actor Death.
    //    NOTE : le GEID du Character event ne matche PAS celui des Actor Death
    //    (CIG utilise 2 IDs différents : geid character record vs entity GEID
    //    in-game). Du coup le match nominal par fréquence est plus fiable.
    let mut name_freq: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for ev in &cache.events {
        if let GameEvent::ActorDeath {
            killer, victim, killer_is_npc, victim_is_npc, ..
        } = ev
        {
            if !killer_is_npc {
                *name_freq.entry(killer.clone()).or_insert(0) += 1;
            }
            if !victim_is_npc {
                *name_freq.entry(victim.clone()).or_insert(0) += 1;
            }
        }
    }
    cache.player_moniker = name_freq
        .iter()
        .max_by_key(|&(_, c)| c)
        .map(|(n, _)| n.clone());

    cache.last_scan_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    save_cache(app, &cache)?;

    let elapsed = start.elapsed();
    let result = ScanResult {
        total_files: total,
        new_files_parsed,
        files_skipped,
        total_events: cache.events.len(),
        elapsed_ms: elapsed.as_millis(),
        player_handle: cache.player_handle.clone(),
        player_moniker: cache.player_moniker.clone(),
    };

    let _ = app.emit("gamelog-history:scan_complete", &result);
    Ok(result)
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Scan complet (ou incrémental si force=false). Retourne un résumé.
#[command]
pub async fn gamelog_history_scan(
    app: AppHandle,
    force: Option<bool>,
    override_dir: Option<String>,
) -> Result<ScanResult, String> {
    let force = force.unwrap_or(false);
    let override_dir = override_dir.map(PathBuf::from);
    tokio::task::spawn_blocking(move || scan_logbackups(&app, force, override_dir))
        .await
        .map_err(|e| e.to_string())?
}

/// Charge le cache sans rescanner.
#[command]
pub async fn gamelog_history_load(app: AppHandle) -> Result<HistoryCache, String> {
    load_cache(&app)
}

/// Stats agrégées pour le frontend (compact, pas tous les events).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummary {
    pub player_handle: Option<String>,
    pub player_moniker: Option<String>,
    pub player_geid: Option<u64>,
    pub total_events: usize,
    pub session_count: usize,
    pub kill_count_pvp: usize,
    pub kill_count_pve: usize,
    pub death_count_pvp: usize,
    pub death_count_pve: usize,
    pub suicide_count: usize,
    pub vehicle_destruction_count: usize,
    pub quantum_selected_count: usize,
    pub quantum_arrived_count: usize,
    pub solar_system_changes: usize,
    pub mission_completed: usize,
    pub mission_failed: usize,
    pub fatal_collision_count: usize,
    pub spawn_flow_count: usize,
    pub purchase_count: usize,
    pub purchase_total_uec: f64, // aUEC seulement (REC exclu) ; prix décimal complet (LOW#4)
    pub versions_traversed: Vec<String>,
    pub files_scanned: usize,
    pub last_scan_ts: u64,
}

#[command]
pub async fn gamelog_history_summary(app: AppHandle) -> Result<HistorySummary, String> {
    let cache = load_cache(&app)?;
    // Attribution combat ancrée sur le GEID entité du joueur local (résolu via le
    // SetDriver `Local client node` le plus fréquent) — même famille d'ID que
    // killer/victim_geid des Actor Death (≠ CharacterIdentified.geid). Fallback
    // nominal sur le moniker si aucun SetDriver (vieux log) → jamais zéroté.
    let moniker = cache.player_moniker.as_deref();
    let resolved_local_geid: Option<u64> = {
        use std::collections::HashMap;
        let mut geid_freq: HashMap<u64, usize> = HashMap::new();
        for ev in &cache.events {
            if let GameEvent::VehicleControl { geid, .. } = ev {
                if *geid != 0 { *geid_freq.entry(*geid).or_insert(0) += 1; }
            }
        }
        geid_freq.into_iter().max_by_key(|&(_, c)| c).map(|(g, _)| g)
    };
    let is_local = |actor_geid: u64, actor_name: &str| -> bool {
        match resolved_local_geid {
            Some(g) if actor_geid != 0 => actor_geid == g,
            _ => moniker.map(|n| actor_name == n).unwrap_or(false),
        }
    };

    let mut s = HistorySummary {
        player_handle: cache.player_handle.clone(),
        player_moniker: cache.player_moniker.clone(),
        player_geid: cache.player_geid,
        total_events: cache.events.len(),
        session_count: 0,
        kill_count_pvp: 0,
        kill_count_pve: 0,
        death_count_pvp: 0,
        death_count_pve: 0,
        suicide_count: 0,
        vehicle_destruction_count: 0,
        quantum_selected_count: 0,
        quantum_arrived_count: 0,
        solar_system_changes: 0,
        mission_completed: 0,
        mission_failed: 0,
        fatal_collision_count: 0,
        spawn_flow_count: 0,
        purchase_count: 0,
        purchase_total_uec: 0.0,
        versions_traversed: cache.files.iter().filter_map(|f| f.sc_version.clone()).collect::<HashSet<_>>().into_iter().collect(),
        files_scanned: cache.files.len(),
        last_scan_ts: cache.last_scan_ts,
    };

    for ev in &cache.events {
        match ev {
            GameEvent::SessionStart { .. } => s.session_count += 1,
            GameEvent::ActorDeath { killer, killer_geid, victim, victim_geid, is_suicide, killer_is_npc, victim_is_npc, .. } => {
                let i_am_killer = is_local(*killer_geid, killer);
                let i_am_victim = is_local(*victim_geid, victim);
                if *is_suicide && i_am_victim {
                    s.suicide_count += 1;
                } else if i_am_killer {
                    if *victim_is_npc { s.kill_count_pve += 1; }
                    else { s.kill_count_pvp += 1; }
                } else if i_am_victim {
                    if *killer_is_npc { s.death_count_pve += 1; }
                    else { s.death_count_pvp += 1; }
                }
            }
            GameEvent::VehicleDestruction { .. } => s.vehicle_destruction_count += 1,
            GameEvent::QuantumSelected { .. } => s.quantum_selected_count += 1,
            GameEvent::QuantumArrived { .. } => s.quantum_arrived_count += 1,
            GameEvent::SolarSystemChange { .. } => s.solar_system_changes += 1,
            GameEvent::MissionEnded { completion_type, player, player_geid, .. } => {
                // Ownership (MED#9) : un MissionEnded est loggé pour CHAQUE mission
                // finissant dans l'instance (coéquipiers inclus). On ne compte que
                // celles attribuables au joueur local (ancre GEID, fallback nominal).
                // Sans aucune ancre (pas de SetDriver ET moniker absent) → legacy.
                let loc_anchor = resolved_local_geid.is_some()
                    || moniker.map(|m| !m.is_empty()).unwrap_or(false);
                let mine = !loc_anchor || is_local(*player_geid, player);
                if mine {
                    if completion_type == "Complete" { s.mission_completed += 1; }
                    else { s.mission_failed += 1; }
                }
            }
            GameEvent::FatalCollision { .. } => s.fatal_collision_count += 1,
            GameEvent::SpawnFlow { .. } => s.spawn_flow_count += 1,
            GameEvent::Purchase { client_price, currency, .. } => {
                s.purchase_count += 1;
                // N'additionne que l'aUEC (REC exclu) pour ne pas polluer l'éco (LOW#4).
                if is_uec_currency(currency) {
                    s.purchase_total_uec += *client_price;
                }
            }
            _ => {}
        }
    }

    s.versions_traversed.sort();
    Ok(s)
}

// ── Agrégation Logbook (carnet de bord) ─────────────────────────────────
// Construit le JSON de stats exhaustives consommé par le frontend
// (interface LogbookStats). Logique partagée entre la commande
// `gamelog_history_stats` (prod) et le générateur de mock-data (tests).
pub fn build_logbook_stats(
    all_events: &[GameEvent],
    moniker: &str,
    handle: Option<&str>,
    versions: &[String],
    first_version: Option<&str>,
    // GEID entité du joueur local (résolu via le SetDriver `Local client node`
    // le plus fréquent). Ancre canonique des attributions combat/survie/éco :
    // `None` → on retombe sur le matching nominal par `moniker` (legacy).
    local_geid: Option<u64>,
    // Comptes d'objectifs par type, déjà agrégés sur TOUS les fichiers du cache
    // (`LogFileMetadata::objective_kinds`). Sert à dériver la spécialité dominante
    // du joueur (le type majoritaire). Vide → `missionSpecialty` = null.
    objective_kinds: &std::collections::HashMap<String, u64>,
) -> serde_json::Value {
    use std::collections::HashMap;
    use chrono::{DateTime, Datelike, Timelike, Utc};

    // ─── Identité locale : GEID canonique + set des vaisseaux réellement pilotés ─
    // On (re)résout le GEID local depuis les SetDriver locaux (le plus fréquent)
    // si l'appelant n'en fournit pas — c'est la source la plus fiable, présente
    // dans chaque ligne `Vehicle Control Flow`.
    let resolved_local_geid: Option<u64> = local_geid.or_else(|| {
        let mut geid_freq: HashMap<u64, usize> = HashMap::new();
        for ev in all_events {
            if let GameEvent::VehicleControl { geid, .. } = ev {
                if *geid != 0 { *geid_freq.entry(*geid).or_insert(0) += 1; }
            }
        }
        geid_freq.into_iter().max_by_key(|&(_, c)| c).map(|(g, _)| g)
    });
    // GEID PERSONNAGE (CharacterIdentified = AccountLoginCharacterStatus). C'est une
    // famille d'ID DIFFÉRENTE du geid entité SetDriver (`resolved_local_geid`). Les
    // lignes `[ActorState] Dead` (morts en vaisseau) loggent le geid PERSONNAGE → si
    // on les ancrait sur `resolved_local_geid` (entité), elles ne matchaient jamais
    // et les morts en vaisseau étaient zérotées (bug Artics : mort PvP sur Pyro non
    // comptée). On résout donc le geid personnage à part pour ancrer ces morts.
    // ENSEMBLE des geids personnage (le joueur peut RECRÉER son perso → plusieurs
    // geids pour la même personne, ex Artics : 204269890159 puis 204502563322). On
    // les collecte TOUS pour ne filtrer aucune mort en vaisseau (sinon on en rate la
    // moitié — bug : 5 comptées sur 8). CharacterIdentified n'est loggé que pour le
    // joueur LOCAL (son propre AccountLoginCharacterStatus) → aucun risque d'inclure
    // un autre joueur.
    let character_geids: std::collections::HashSet<u64> = all_events.iter()
        .filter_map(|ev| match ev {
            GameEvent::CharacterIdentified { geid, .. } if *geid != 0 => Some(*geid),
            _ => None,
        })
        .collect();
    // ── Ancrage des arrivées QT (le `Quantum Drive Arrived` n'a PAS de `- Local`) ──
    // Le PROBLÈME historique : on filtrait les arrivées sur le GEID extrait du nom
    // du SetDriver (`local_vehicle_geids`). Mais le SetDriver capture le GEID de
    // l'entité **contrôle/Vehicle** du vaisseau, alors que les events Quantum
    // (Selected/Arrived) portent le GEID de l'entité **ItemNavigation** — DEUX
    // GEID DIFFÉRENTS pour le même vaisseau → ils ne matchaient JAMAIS → toutes
    // les arrivées étaient filtrées (totalQuantumJumps = 0 sur de vrais logs).
    //
    // Le BON ancrage = les `QuantumSelected` *locaux* (marqueur `- Local` garanti
    // joueur local) : ils portent le ship-GEID de la MÊME famille ItemNavigation
    // que les arrivées. On construit donc l'ensemble de ces GEID ItemNavigation.
    let local_qt_ship_geids: std::collections::HashSet<u64> = all_events.iter()
        .filter_map(|ev| match ev {
            GameEvent::QuantumSelected { vehicle_geid, .. } if *vehicle_geid != 0 => Some(*vehicle_geid),
            _ => None,
        })
        .collect();
    // GEIDs entité **contrôle/Vehicle** des vaisseaux réellement pilotés (SetDriver
    // local). Famille DIFFÉRENTE des arrivées QT → ne matche pas un `Arrived` en
    // pratique, MAIS reste un signal "présence locale" (évite la régression du
    // fallback legacy sur les vieux logs sans QuantumSelected mais avec SetDriver).
    let local_vehicle_geids: std::collections::HashSet<u64> = all_events.iter()
        .filter_map(|ev| match ev {
            GameEvent::VehicleControl { vehicle, .. } => vehicle_geid_from_name(vehicle),
            _ => None,
        })
        .collect();
    // Y a-t-il un signal d'identité locale exploitable ? (QuantumSelected local,
    // SetDriver exploitable, ou GEID joueur résolu). Si NON → vieux log sans
    // aucun ancrage : on retombe sur le comportement legacy (tout autoriser pour
    // ne pas régresser à une liste vide).
    let has_local_signal =
        !local_qt_ship_geids.is_empty() || !local_vehicle_geids.is_empty() || resolved_local_geid.is_some();
    // Un `QuantumArrived` est-il à nous ? (l'event n'a pas de marqueur `- Local`)
    //  1. Si son ship-GEID ItemNavigation est dans l'ensemble des QuantumSelected
    //     locaux → OUI (ancre correcte, même famille d'ID).
    //  2. (Compat) si jamais il matche un GEID SetDriver → OUI aussi (inoffensif).
    //  3. Sinon, fallback legacy UNIQUEMENT quand on n'a AUCUN signal local du
    //     tout → on laisse passer pour ne pas régresser sur les vieux logs.
    //  4. Si on A un signal local mais que ce GEID n'y est pas → CONSERVATEUR :
    //     on n'attribue PAS (= arrivée d'un autre joueur du bubble).
    let qt_arrived_is_local = |vehicle_geid: u64| -> bool {
        if local_qt_ship_geids.contains(&vehicle_geid) || local_vehicle_geids.contains(&vehicle_geid) {
            return true;
        }
        !has_local_signal
    };
    // Combat/survie : un acteur (par GEID + nom) est-il le joueur local ?
    // Priorité au GEID ; fallback nominal sur `moniker` si pas de GEID résolu
    // (ou si l'event n'a pas de GEID exploitable).
    let is_local_actor = |actor_geid: u64, actor_name: &str| -> bool {
        match resolved_local_geid {
            Some(g) if actor_geid != 0 => actor_geid == g,
            _ => actor_name == moniker,
        }
    };
    // Morts en vaisseau (`[ActorState] Dead`) : le geid loggé est le geid PERSONNAGE
    // → on le matche en priorité, puis fallback sur l'ancrage entité/moniker normal.
    let is_local_vehicle_death = |actor_geid: u64, actor_name: &str| -> bool {
        if actor_geid != 0 && character_geids.contains(&actor_geid) { return true; }
        is_local_actor(actor_geid, actor_name)
    };
    // Éco : un `playerId` de transaction est-il le joueur local ? Le playerId
    // loggé EST de la famille du SetDriver GEID → comparaison directe. Si on n'a
    // pas de GEID résolu (vieux log sans SetDriver), on ne filtre pas (legacy).
    let is_local_player_id = |player_id: u64| -> bool {
        match resolved_local_geid {
            Some(g) => player_id == g,
            None => true,
        }
    };
    // ── Lieux & systèmes : a-t-on une identité locale exploitable pour ANCRER
    //    les zones (ActorDeath) et les changements de système (SolarSystemChange) ?
    //    OUI si on a un GEID résolu OU un moniker non vide. Si NON (très vieux log
    //    sans SetDriver ET sans moniker capturé), on retombe sur le comportement
    //    legacy (compter TOUS les signaux) pour ne pas régresser à une liste vide.
    let loc_anchor_active = resolved_local_geid.is_some() || !moniker.is_empty();
    // Un `SolarSystemChange` est-il le saut du joueur LOCAL ? Le champ `entity`
    // est un NOM (`Client entity <handle>`) — un pseudo joueur en clair, ou un
    // identifiant d'entité NPC suffixé d'un GEID. On extrait donc un éventuel
    // GEID de suffixe puis on ancre via `is_local_actor` (GEID prioritaire,
    // fallback nominal sur le moniker). Sans aucune ancre locale → legacy (true).
    let ssc_is_local = |entity: &str| -> bool {
        if !loc_anchor_active {
            return true;
        }
        let entity_geid = vehicle_geid_from_name(entity).unwrap_or(0);
        is_local_actor(entity_geid, entity)
    };

    // ─── KPIs ─────────────────────────────────────────────────────────
    // Sessions pairées SessionStart→SessionEnd. PROBLÈME : Star Citizen crashe
    // très souvent → la session n'a alors PAS de `SessionEnd` (stockée `None`),
    // et toutes les heures de cette session étaient perdues (un joueur qui crash
    // souvent voyait son total fondre = bug "heures manquantes").
    // FIX : pour une session crashée (sans SessionEnd), on estime la fin au
    // timestamp du DERNIER event observé pendant cette session (les events sont
    // triés par ts en amont, cf. `cache.events.sort_by(event_ts)`). On suit donc
    // `last_ts` (ts du dernier event vu) et on l'utilise comme fin effective au
    // moment de fermer la session (prochain SessionStart ou fin du flux), si et
    // seulement si `last_ts > start`. La fin estimée est stockée DANS `sessions`
    // pour que TOUT ce qui en dérive (total_hours, recentSessions, heatmap,
    // streaks, kills/session…) en bénéficie.
    let mut sessions: Vec<(f64, Option<f64>)> = Vec::new();
    let mut current_start: Option<f64> = None;
    let mut last_ts: f64 = f64::NEG_INFINITY;
    // Ferme une session crashée : fin estimée = dernier event vu (`last_ts`) si
    // postérieur au start, sinon on laisse `None` (aucun event exploitable).
    let estimate_crashed_end = |start: f64, last_ts: f64| -> Option<f64> {
        if last_ts > start { Some(last_ts) } else { None }
    };
    for ev in all_events {
        match ev {
            GameEvent::SessionStart { ts } => {
                if let Some(s) = current_start.take() {
                    // Session précédente sans SessionEnd = crash → fin estimée au
                    // dernier event vu AVANT ce SessionStart (d'où la mise à jour
                    // de `last_ts` APRÈS le match : le ts du SessionStart lui-même
                    // ne doit pas être attribué à la session précédente).
                    sessions.push((s, estimate_crashed_end(s, last_ts)));
                }
                current_start = Some(*ts);
            }
            GameEvent::SessionEnd { ts, .. } => {
                if let Some(s) = current_start.take() { sessions.push((s, Some(*ts))); }
            }
            _ => {}
        }
        // Met à jour le dernier ts vu sur N'IMPORTE quel event (flux trié par ts).
        last_ts = last_ts.max(event_ts(ev));
    }
    // Dernière session encore ouverte à la fin du flux = crash (ou session en
    // cours) → fin estimée au dernier event observé.
    if let Some(s) = current_start { sessions.push((s, estimate_crashed_end(s, last_ts))); }

    let total_seconds: f64 = sessions.iter()
        .filter_map(|(s, e)| e.map(|end| end - s))
        .filter(|d| *d > 0.0 && *d < 86400.0 * 2.0) // filter weird sessions > 2 jours
        .sum();
    let total_hours = (total_seconds / 3600.0).round() as u64;

    // ─── Top vaisseaux : VRAIES sorties via `Vehicle Control Flow` (SetDriver) ─
    // Chaque prise de commandes du joueur local = 1 sortie réelle. Bien plus
    // fidèle que l'ancien comptage d'events QT (3+ par saut). Fallback sur
    // QT/destruction si un log n'a aucune ligne Vehicle Control Flow (vieux
    // builds / fixtures) — pour ne jamais régresser à une liste vide.
    let mut vehicle_hits: HashMap<String, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::VehicleControl { vehicle, .. } = ev {
            *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
        }
    }
    if vehicle_hits.is_empty() {
        for ev in all_events {
            match ev {
                // Selected/Fuel sont déjà filtrés `- Local` au parse → à nous.
                GameEvent::QuantumSelected { vehicle, .. }
                | GameEvent::QuantumFuelRequested { vehicle, .. } => {
                    *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                }
                // Arrived n'a pas de marqueur Local → on n'attribue que les
                // vaisseaux réellement pilotés (corrélation GEID au SetDriver).
                GameEvent::QuantumArrived { vehicle, vehicle_geid, .. } if qt_arrived_is_local(*vehicle_geid) => {
                    *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                }
                GameEvent::VehicleDestruction { vehicle, driver, driver_geid, .. } if is_local_actor(*driver_geid, driver) => {
                    *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                }
                GameEvent::FatalCollision { vehicle, .. } => {
                    *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                }
                _ => {}
            }
        }
    }
    // Garde la map complète pour le compte distinct
    let unique_vehicle_count = vehicle_hits.len();
    // Nombre réel de catégories distinctes parmi les vaisseaux pilotés.
    let vehicle_category_count = vehicle_hits.keys()
        .map(|name| vehicle_category(name))
        .collect::<std::collections::HashSet<_>>()
        .len();

    let mut top_vehicles: Vec<_> = vehicle_hits.clone().into_iter().collect();
    top_vehicles.sort_by(|a, b| b.1.cmp(&a.1));
    // Pas de truncate — on garde TOUS les vaisseaux pilotés (carnet exhaustif).
    // L'UI affiche les 5 premiers par défaut puis expand pour le reste.
    // `sessions` (3e champ) = VRAI nombre de sorties (l'UI l'affiche, pas `hours`).
    // `hours` reste une estimation héritée (÷2) ignorée par le frontend.
    // Nom commercial via catalog Fleetyards (`MISC_Hull_B` → "Hull B").
    let top_vehicles_hours: Vec<(String, u32, usize)> = top_vehicles.iter()
        .map(|(v, n)| (vehicle_display_name(v), (*n as u32 / 2).max(1), *n))
        .collect();

    // ─── Top lieux ────────────────────────────────────────────────────
    // Corrélation : pour chaque ActorDeath, on cherche le dernier
    // QuantumArrived.vehicle ou SolarSystemChange.to dans la fenêtre des
    // 10 min précédentes pour enrichir une zone générique (Intérieur
    // vaisseau / Espace ouvert) avec le vaisseau ou le système contextuel.
    let mut zone_hits: HashMap<String, usize> = HashMap::new();
    let mut last_vehicle: Option<(f64, String)> = None;
    for ev in all_events {
        match ev {
            // Contexte vaisseau LOCAL uniquement pour l'enrichissement "Intérieur
            // <Ship>" : l'`Arrived` est filtré par le set de vaisseaux locaux du QT
            // (`qt_arrived_is_local` → local_qt_ship_geids / local_vehicle_geids),
            // sinon un vaisseau QT d'un autre joueur du bubble fuitait dans le nom
            // de NOTRE zone (« Intérieur Polaris » alors qu'on est à pied).
            GameEvent::QuantumArrived { ts, vehicle, vehicle_geid } if qt_arrived_is_local(*vehicle_geid) => {
                last_vehicle = Some((*ts, canonicalize_vehicle(vehicle)));
            }
            // `QuantumSelected` est garanti local au parsing (marqueur `- Local`).
            GameEvent::QuantumSelected { ts, vehicle, destination, .. } => {
                last_vehicle = Some((*ts, canonicalize_vehicle(vehicle)));
                // La destination d'un saut QT est un lieu (re)joint par le joueur →
                // compte comme « lieu visité ». Avant, les lieux ne venaient QUE des
                // morts (`ActorDeath`) → un joueur qui meurt peu (mineur/hauler)
                // affichait « 0 lieu visité » (bug Artics).
                let qz = prettify_zone_sc(destination);
                if !qz.is_empty() { *zone_hits.entry(qz).or_insert(0) += 1; }
            }
            // ⚠️ On ne dérive la zone QUE des morts du joueur LOCAL : une zone où
            // un INCONNU est mort n'est PAS une zone que NOUS avons visitée
            // (fallback legacy non-régressif si aucune ancre locale).
            GameEvent::ActorDeath { ts, zone, victim, victim_geid, .. }
                if !loc_anchor_active || is_local_actor(*victim_geid, victim) =>
            {
                let mut name = clean_zone_name(zone);
                if name.is_empty() { continue; }

                // Enrichissement : si zone générique + vehicle récent (< 10 min) → suffix
                let generic = name == "Intérieur vaisseau" || name == "Espace ouvert";
                if generic {
                    if let Some((vts, vname)) = &last_vehicle {
                        if ts - vts < 600.0 && !vname.is_empty() {
                            // Format compact "Intérieur Polaris" / "Espace ouvert · Polaris"
                            let pretty_v = pretty_vehicle_short(vname);
                            if !pretty_v.is_empty() {
                                name = if name == "Intérieur vaisseau" {
                                    format!("Intérieur {}", pretty_v)
                                } else {
                                    format!("Espace ouvert · {}", pretty_v)
                                };
                            }
                        }
                    }
                }
                *zone_hits.entry(name).or_insert(0) += 1;
            }
            _ => {}
        }
    }
    let mut top_locations: Vec<_> = zone_hits.into_iter().collect();
    top_locations.sort_by(|a, b| b.1.cmp(&a.1));
    top_locations.truncate(5);

    // ─── Stats mining (hand-mining + ship-mining + missions) ──────────
    let mut mining_purchases: usize = 0; // achats Greycat multitool ou mining laser
    let mut mining_missions_new: usize = 0;
    let mut mining_missions_complete: usize = 0;
    let mut salvage_missions_complete: usize = 0;
    let mut bounty_missions_complete: usize = 0;
    let mut cargo_missions_complete: usize = 0;
    for ev in all_events {
        match ev {
            GameEvent::Purchase { item, player_id, .. } if is_local_player_id(*player_id) => {
                let i = item.to_lowercase();
                if i.contains("multitool") && i.contains("mining") { mining_purchases += 1; }
                else if i.contains("mining_") || i.contains("_mining") { mining_purchases += 1; }
            }
            GameEvent::MissionObjective { kind, text, .. } => {
                let t = text.to_lowercase();
                let is_complete = kind == "complete";

                // 1. Essai via global.ini PolyTool (la plus précise)
                let classifier_cat = crate::scripts::mission_classifier::get_index()
                    .and_then(|idx| idx.classify(text));

                // 2. Fallback heuristique mots-clés multi-langue (EN/FR/DE/ES/IT)
                // ⚠️ Mots-clés d'ACTIVITÉ minière uniquement — PAS de mots de LIEU.
                // « asteroid »/« astéroïde » désignent un ENDROIT, pas une activité :
                // une mission d'élimination DANS une zone d'astéroïdes n'est PAS du
                // minage (bug Zero : tagué « Mineur » car il fait du combat en zone
                // de minage). On retire donc ces mots-lieu de la détection minière.
                let is_mining_kw = t.contains("mining") || t.contains("minage")
                    || t.contains("mineur") || t.contains("bergbau")
                    || t.contains("minería") || t.contains("estrazione");
                let is_salvage_kw = t.contains("salvage") || t.contains("salvaging")
                    || t.contains("sauvetage") || t.contains("récupération") || t.contains("récupérer")
                    || t.contains("épave") || t.contains("epave") || t.contains("wreck")
                    || t.contains("bergung") || t.contains("salvamento") || t.contains("recupero");
                let is_bounty_kw = t.contains("bounty") || t.contains("eliminate")
                    || t.contains("prime") || t.contains("élimine") || t.contains("éliminer")
                    || t.contains("kopfgeld") || t.contains("recompensa") || t.contains("taglia");
                let is_cargo_kw = t.contains("cargo") || t.contains("delivery") || t.contains("haul")
                    || t.contains("cargaison") || t.contains("livraison") || t.contains("livrer")
                    || t.contains("fracht") || t.contains("carga") || t.contains("consegna");

                // ── Classification MUTUELLEMENT EXCLUSIVE (MED#10) ───────────
                // Avant, chaque signal (mining/salvage/bounty/cargo) incrémentait
                // SON compteur indépendamment → une mission aux mots-clés mixtes
                // (ex "livrer le minerai" = mining + cargo) était double-comptée.
                // FIX : on choisit UNE catégorie dominante. Le classifieur PolyTool
                // (déjà exclusif) prime ; sinon argmax mots-clés par ordre de
                // priorité : bounty (action de combat, sans ambiguïté) > mining >
                // salvage > cargo (« cargo/livraison/haul » = terme le plus
                // générique → dernier recours). Voir le bloc `None` plus bas.
                use crate::scripts::mission_classifier::MissionCategory;
                #[derive(PartialEq)]
                enum DomCat { Mining, Salvage, Bounty, Cargo, None }
                let dominant = match classifier_cat {
                    Some(MissionCategory::Mining)  => DomCat::Mining,
                    Some(MissionCategory::Salvage) => DomCat::Salvage,
                    Some(MissionCategory::Bounty)  => DomCat::Bounty,
                    Some(MissionCategory::Cargo)   => DomCat::Cargo,
                    // Catégorie connue mais hors périmètre mining/salvage/bounty/cargo
                    // (fps, medical, race…) → on n'utilise PAS le fallback mots-clés
                    // (le classifieur est autoritaire) → aucune des 4 catégories.
                    Some(_) => DomCat::None,
                    // Pas de classifieur (offline / mission inconnue) → mots-clés,
                    // 1ʳᵉ correspondance dans l'ordre de priorité = catégorie unique.
                    None => {
                        // Priorité à l'ACTION de combat : « eliminate/bounty/prime »
                        // est un signal fort et sans ambiguïté → une mission
                        // d'élimination reste du COMBAT même si elle se déroule en
                        // zone de minage/astéroïdes (bug Zero). Ensuite
                        // mining > salvage > cargo (du plus spécifique au plus large).
                        if is_bounty_kw { DomCat::Bounty }
                        else if is_mining_kw { DomCat::Mining }
                        else if is_salvage_kw { DomCat::Salvage }
                        else if is_cargo_kw { DomCat::Cargo }
                        else { DomCat::None }
                    }
                };
                if dominant == DomCat::Mining {
                    if is_complete { mining_missions_complete += 1; }
                    else { mining_missions_new += 1; }
                }
                if is_complete {
                    if dominant == DomCat::Salvage { salvage_missions_complete += 1; }
                    if dominant == DomCat::Bounty  { bounty_missions_complete += 1; }
                    if dominant == DomCat::Cargo   { cargo_missions_complete += 1; }
                }
            }
            _ => {}
        }
    }
    // Compte des vaisseaux mining hits (Mole/Prospector/Orion/ROC)
    let mut mining_ship_hits = 0usize;
    {
        let mut count_if_mining = |vehicle: &str| {
            let v = vehicle.to_lowercase();
            if v.contains("prospector") || v.contains("mole") || v.contains("orion") || v.contains("roc") {
                mining_ship_hits += 1;
            }
        };
        for ev in all_events {
            match ev {
                // Selected = déjà local (`- Local`).
                GameEvent::QuantumSelected { vehicle, .. } => count_if_mining(vehicle),
                // Arrived = filtré sur les vaisseaux réellement pilotés.
                GameEvent::QuantumArrived { vehicle, vehicle_geid, .. } if qt_arrived_is_local(*vehicle_geid) => count_if_mining(vehicle),
                _ => {}
            }
        }
    }
    // Score global mining (hand + ship + missions)
    let mining_score = mining_purchases + mining_missions_complete * 2 + mining_ship_hits;
    let has_mined = mining_score > 0;

    // Compte total des MissionEnded complétées (ancien + nouveau format).
    // ── OWNERSHIP (MED#9) ─────────────────────────────────────────────────
    // Un `MissionEnded` est loggé pour CHAQUE mission qui se termine dans TON
    // instance — y compris celles de tes coéquipiers. Avant, on les comptait
    // TOUTES → le compteur perso était gonflé (×N joueurs dans le bubble).
    // FIX : ne compter une mission comme PERSONNELLE que si elle est
    // attribuable au joueur local (ancre GEID `PlayerId[...]`, fallback nominal
    // `Player[...]`). Le format v2 (SC 4.6+) ne logue NI le nom NI le GEID
    // (player="", player_geid=0) → mission d'INSTANCE, JAMAIS comptée comme
    // perso quand une ancre locale existe. Sans aucune ancre (`!loc_anchor_active`
    // : très vieux log, pas de SetDriver ET moniker vide) → comportement legacy
    // (on compte tout, pour ne pas régresser à 0).
    let mission_is_local = |player_geid: u64, player: &str| -> bool {
        if !loc_anchor_active { return true; } // legacy : aucune ancre → tout compter
        is_local_actor(player_geid, player)
    };
    // `completion_type` réel : ancien format `<EndMission>` = "Complete" /
    // "Abandon" / "Fail" ; format v2 `<MissionEnded>` mappé en "Complete" /
    // "Failed" / "Abandoned" (mais v2 a player_geid=0 → exclu par l'ownership
    // dès qu'une ancre locale existe). On accepte donc les DEUX orthographes.
    let total_missions_complete = all_events.iter().filter(|e| matches!(e,
        GameEvent::MissionEnded { completion_type, player, player_geid, .. }
            if completion_type == "Complete" && mission_is_local(*player_geid, player)
    )).count() as u32;
    // BUG historique : ne testait que "Failed" → ne matchait JAMAIS le "Fail"
    // de l'ancien format `<EndMission>` (le seul fiable). FIX : {"Fail","Failed"}.
    let total_missions_failed = all_events.iter().filter(|e| matches!(e,
        GameEvent::MissionEnded { completion_type, player, player_geid, .. }
            if matches!(completion_type.as_str(), "Fail" | "Failed") && mission_is_local(*player_geid, player)
    )).count() as u32;
    // NOUVEAU : missions abandonnées ({"Abandon","Abandoned"}), exposées à part.
    let total_missions_abandoned = all_events.iter().filter(|e| matches!(e,
        GameEvent::MissionEnded { completion_type, player, player_geid, .. }
            if matches!(completion_type.as_str(), "Abandon" | "Abandoned") && mission_is_local(*player_geid, player)
    )).count() as u32;

    // ─── Spécialité du joueur (depuis les objectifs `<Create…ObjectiveHandler>`) ─
    // Le `missionId` de ces objectifs est à ZÉRO dans les logs → impossible de
    // lier un objectif à une mission précise. On ne calcule donc PAS un breakdown
    // « X missions cargo complétées » par type (ce serait inventé). À la place,
    // on dérive la SPÉCIALITÉ = type d'objectif DOMINANT, et on expose la
    // répartition brute (`objectiveTypeBreakdown`) pour info dans l'UI.
    // `objective_kinds` est déjà agrégé sur tous les fichiers du cache par
    // l'appelant (chaque `LogFileMetadata::objective_kinds`).
    let specialty_label = |kind: &str| -> String {
        match kind {
            "Hauling" => "Cargo / Hauling".to_string(),
            "Bounty" => "Chasse de primes".to_string(),
            "Mining" => "Minage".to_string(),
            "Salvage" => "Récupération".to_string(),
            "Combat" => "Combat".to_string(),
            "Delivery" => "Livraison".to_string(),
            other => other.to_string(), // fallback : type brut
        }
    };
    // Type dominant = le plus fréquent (départage stable par nom pour un résultat
    // déterministe quand deux types sont à égalité).
    let mission_specialty: Option<String> = objective_kinds
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(kind, _)| specialty_label(kind));
    // Répartition brute exposée à l'UI (type → count).
    let objective_type_breakdown: serde_json::Map<String, serde_json::Value> = objective_kinds
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::json!(v)))
        .collect();

    // ─── Derniers objectifs terminés (avec type + date) ──────────────────
    // On garde les 10 plus récents pour affichage dans la carte Missions.
    let mut recent_completed_objectives: Vec<(f64, String, String)> = Vec::new();
    for ev in all_events {
        if let GameEvent::MissionObjective { ts, kind, text } = ev {
            if kind != "complete" { continue; }
            let t = text.to_lowercase();
            let classifier_cat = crate::scripts::mission_classifier::get_index()
                .and_then(|idx| idx.classify(text));
            use crate::scripts::mission_classifier::MissionCategory;
            let mission_type = match classifier_cat {
                Some(MissionCategory::Mining) => "mining",
                Some(MissionCategory::Salvage) => "salvage",
                Some(MissionCategory::Bounty) => "bounty",
                Some(MissionCategory::Cargo) => "cargo",
                Some(MissionCategory::Fps) => "fps",
                Some(MissionCategory::Medical) => "medical",
                Some(MissionCategory::Refuel) => "refuel",
                Some(MissionCategory::Investigation) => "investigation",
                Some(MissionCategory::Race) => "race",
                Some(MissionCategory::Touring) => "touring",
                Some(MissionCategory::Tutorial) => "tutorial",
                _ => {
                    // bounty (action de combat) AVANT mining ; « asteroid »/
                    // « astéroïde » = LIEU, pas activité → retirés du minage
                    // (bug Zero : combat en zone de minage classé « mining »).
                    if t.contains("bounty") || t.contains("eliminate") || t.contains("prime") || t.contains("élimine") || t.contains("éliminer") { "bounty" }
                    else if t.contains("mining") || t.contains("minage") || t.contains("mineur") { "mining" }
                    else if t.contains("salvage") || t.contains("sauvetage") || t.contains("épave") || t.contains("wreck") || t.contains("debris") || t.contains("débris") { "salvage" }
                    else if t.contains("cargo") || t.contains("delivery") || t.contains("haul") || t.contains("cargaison") || t.contains("livraison") { "cargo" }
                    else if t.contains("refuel") || t.contains("ravitaill") { "refuel" }
                    else if t.contains("collect") || t.contains("récolter") || t.contains("récupére") || t.contains("probe") || t.contains("sonde") { "investigation" }
                    else { "other" }
                }
            };
            recent_completed_objectives.push((*ts, mission_type.to_string(), text.clone()));
        }
    }
    recent_completed_objectives.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut seen_texts: std::collections::HashSet<String> = std::collections::HashSet::new();
    let recent_missions_list: Vec<(f64, String, String)> = recent_completed_objectives.into_iter()
        .filter(|(_, _, text)| {
            let key = text.to_lowercase();
            if seen_texts.contains(&key) { false } else { seen_texts.insert(key); true }
        })
        .take(10)
        .collect();

    // ─── Évolution mensuelle ──────────────────────────────────────────
    let mut monthly_hours: HashMap<(i32, u32), f64> = HashMap::new();
    for (s, e) in &sessions {
        if let Some(end) = e {
            let dur = end - s;
            if dur <= 0.0 || dur > 86400.0 { continue; }
            // Mois calendaire en heure LOCALE (sinon une session du 31 à 23h locale
            // bascule sur le mois suivant en UTC).
            let dt = match local_dt(*s as i64) { Some(d) => d, None => continue };
            let key = (dt.year(), dt.month());
            *monthly_hours.entry(key).or_insert(0.0) += dur / 3600.0;
        }
    }
    // Garde les 12 derniers mois
    let mut monthly_sorted: Vec<_> = monthly_hours.into_iter().collect();
    monthly_sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let monthly_12 = monthly_sorted.iter().rev().take(12).rev().cloned().collect::<Vec<_>>();
    let month_labels = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Aoû","Sep","Oct","Nov","Déc"];

    // ─── Heatmap 364 jours (52 sem × 7) ────────────────────────────────
    let mut daily_hours: HashMap<i64, f64> = HashMap::new(); // day_index → hours
    for (s, e) in &sessions {
        if let Some(end) = e {
            let dur = end - s;
            if dur <= 0.0 || dur > 86400.0 { continue; }
            // Bucket par jour LOCAL (frontières à minuit local, DST-safe) — sinon
            // une session de 22h-1h locale se scinde sur 2 cases UTC décalées.
            let day_idx = local_day_index(*s as i64);
            *daily_hours.entry(day_idx).or_insert(0.0) += dur / 3600.0;
        }
    }
    // « Aujourd'hui » = jour local courant (même échelle que `local_day_index`).
    let now_day = local_today_index();
    let mut heatmap = Vec::with_capacity(364);
    for i in 0..364 {
        let day = now_day - (363 - i);
        heatmap.push(daily_hours.get(&day).copied().unwrap_or(0.0));
    }

    // Peak day
    let peak_day_idx = heatmap.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).map(|(i, _)| i).unwrap_or(0);
    // `now_day` est un numéro de jour CE local → on remappe la date locale du pic
    // via NaiveDate (pas `* 86400`, qui supposerait des frontières UTC).
    let peak_day_ce = now_day - (363 - peak_day_idx as i64);
    let peak_day_iso = chrono::NaiveDate::from_num_days_from_ce_opt(peak_day_ce as i32)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default();
    let peak_hours = heatmap[peak_day_idx];

    // ─── Heure préférée (24 bins) ─────────────────────────────────────
    // Heure d'horloge LOCALE (l'« heure préférée » d'un joueur FR doit être son
    // heure murale, pas UTC).
    let mut hourly = [0u32; 24];
    for (s, _) in &sessions {
        if let Some(dt) = local_dt(*s as i64) {
            hourly[dt.hour() as usize] += 1;
        }
    }

    // ─── Top jour de la semaine ───────────────────────────────────────
    let mut weekday = [0u32; 7]; // Lun=0..Dim=6
    for (s, e) in &sessions {
        if let Some(end) = e {
            let dur = end - s;
            if dur <= 0.0 || dur > 86400.0 { continue; }
            // Jour de semaine en heure LOCALE (une session du dimanche soir FR ne
            // doit pas compter pour lundi à cause d'UTC).
            let dt = match local_dt(*s as i64) { Some(d) => d, None => continue };
            let dow = dt.weekday().num_days_from_monday() as usize;
            weekday[dow] += (dur / 3600.0) as u32;
        }
    }

    // ─── Dernières sessions (fenêtre récente) ─────────────────────────
    let mut recent_sessions = sessions.iter()
        .filter(|(s, e)| e.is_some() && e.unwrap() - s < 86400.0 && e.unwrap() - s > 0.0)
        .cloned()
        .collect::<Vec<_>>();
    recent_sessions.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    // 30 dernières sessions (~1 mois de recul actif). L'UI (RecentSessions)
    // affiche les 5 premières puis « expand » pour révéler le reste de la
    // fenêtre → le front en attend donc « jusqu'à 30 » (LOW#7 : nom + type +
    // réalité alignés sur 30, l'ancien `recent_5` était trompeur).
    const RECENT_SESSIONS_WINDOW: usize = 30;
    let recent_window: Vec<_> = recent_sessions.iter().take(RECENT_SESSIONS_WINDOW).cloned().collect();

    // ─── Combat ──────────────────────────────────────────────────────
    let mut kills_pve = 0usize;
    let mut kills_pvp = 0usize;
    let mut deaths = 0usize;
    let mut last_kill: Option<(f64, String, String)> = None; // ts, weapon, victim
    let mut weapon_freq: HashMap<String, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::ActorDeath { killer, killer_geid, victim, victim_geid, victim_is_npc, weapon_class, ts, is_suicide, .. } = ev {
            // Ancrage GEID (fallback moniker) : le combat est à MOI seulement si
            // le tueur/la victime EST le joueur local (plus de collision de noms).
            if is_local_actor(*killer_geid, killer) && !is_suicide {
                if *victim_is_npc { kills_pve += 1; } else { kills_pvp += 1; }
                *weapon_freq.entry(weapon_class.clone()).or_insert(0) += 1;
                if last_kill.is_none() || ts > &last_kill.as_ref().unwrap().0 {
                    last_kill = Some((*ts, weapon_class.clone(), clean_combat_target(victim, *victim_is_npc)));
                }
            } else if is_local_actor(*victim_geid, victim) && !is_suicide {
                deaths += 1;
            }
        }
    }
    // ─── Combat via "Crime Committed" (builds récents : SC ne loggue plus
    //     <Actor Death>). Homicide = kill joueur, Destruction of Vehicle = kill
    //     vaisseau, le reste (assauts) = engagement. Dédup sur (ts,type,victime)
    //     car la notif est re-loggée. ⚠️ zone surveillée only / joueur agresseur. ──
    // La notif "Crime Committed" est re-loggée en BOUCLE pour un même affrontement
    // (ex Reaktron : 2 Homicide + N assauts, tous au même instant). On collecte, on
    // trie par ts, puis dédup FENÊTRÉ : un même (catégorie, victime) à < 120 s = le
    // même affrontement → compté une seule fois (un 2ᵉ kill de la même cible 10 min
    // plus tard recompte). is_kill regroupe Homicide + Destruction of Vehicle (kill
    // joueur OU vaisseau de la même cible dans le même affrontement = 1 kill).
    let mut crimes: Vec<(f64, String, String)> = all_events.iter().filter_map(|ev| match ev {
        GameEvent::CrimeCommitted { ts, crime_type, victim } if !victim.is_empty() =>
            Some((*ts, crime_type.to_lowercase(), victim.clone())),
        _ => None,
    }).collect();
    crimes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut crime_kills = 0usize;
    let mut crime_victims: Vec<(String, f64, bool)> = Vec::new(); // (victime, ts, is_kill)
    let mut crime_last: HashMap<(&'static str, String), f64> = HashMap::new();
    for (ts, t, victim) in &crimes {
        let is_kill = t.contains("homicide")
            || t.contains("destruction of vehicle") || t.contains("destruction de véhicule");
        let is_combat = is_kill
            || t.contains("assault") || t.contains("bodily harm")
            || t.contains("voies de fait") || t.contains("coups et blessures") || t.contains("agression");
        if !is_combat { continue; }
        let cat = if is_kill { "kill" } else { "engage" };
        let key = (cat, victim.clone());
        if let Some(&last) = crime_last.get(&key) {
            if ts - last < 120.0 { continue; } // même affrontement re-loggé → skip
        }
        crime_last.insert(key, *ts);
        if is_kill { crime_kills += 1; }
        crime_victims.push((victim.clone(), *ts, is_kill));
    }
    // Les kills de crime (contre des joueurs) s'ajoutent aux kills PVP.
    kills_pvp += crime_kills;
    // lastKill : victime de crime-kill la plus récente (arme inconnue → champ vide).
    if let Some((vts, vname)) = crime_victims.iter().filter(|(_, _, k)| *k)
        .map(|(n, ts, _)| (*ts, n.clone()))
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
    {
        if last_kill.as_ref().map(|lk| vts > lk.0).unwrap_or(true) {
            last_kill = Some((vts, String::new(), vname));
        }
    }
    // Morts en vaisseau comptées comme morts (combat.deaths + K/D) : sur les builds
    // récents c'est la seule mort journalisée (le détail par cause est calculé plus bas).
    deaths += all_events.iter().filter(|e| match e {
        GameEvent::VehicleDeath { actor, actor_geid, .. } => is_local_vehicle_death(*actor_geid, actor),
        _ => false,
    }).count();

    let fav_weapon = weapon_freq.iter().max_by_key(|&(_, c)| c).map(|(w, n)| (w.clone(), *n)).unwrap_or_default();

    // ─── Ratio K/D (source de vérité UNIQUE) ──────────────────────────
    // `deaths` est déjà ancré GEID (uniquement les VRAIES morts du joueur local,
    // peu importe le tueur — NPC/env inclus car ce sont quand même MES morts ;
    // les morts d'AUTRES entités ne sont jamais comptées ici). Ratio non défini
    // (0 mort) = `None` → sérialise en `null` (PAS de sentinelle 999). Ce même
    // Option alimente l'affichage ET l'achievement « Iron Will » (plus de calcul
    // divergent avec `.max(1)`).
    let total_kills = kills_pvp + kills_pve;
    let kd_ratio: Option<f64> = if deaths > 0 {
        Some(total_kills as f64 / deaths as f64)
    } else {
        None
    };

    // ─── Routes quantum ──────────────────────────────────────────────
    let mut quantum_routes: HashMap<(String, String), usize> = HashMap::new();
    let mut last_dest: Option<(f64, String)> = None;
    for ev in all_events {
        if let GameEvent::QuantumSelected { ts, destination, .. } = ev {
            if let Some((prev_ts, prev_dest)) = &last_dest {
                if ts - prev_ts < 7200.0 && prev_dest != destination {
                    let key = (clean_destination(prev_dest), clean_destination(destination));
                    *quantum_routes.entry(key).or_insert(0) += 1;
                }
            }
            last_dest = Some((*ts, destination.clone()));
        }
    }
    let mut top_routes: Vec<_> = quantum_routes.into_iter().collect();
    top_routes.sort_by(|a, b| b.1.cmp(&a.1));
    // Pas de truncate ici — on garde toutes les routes pour le bouton "Voir plus".
    // L'UI affiche les 5 premières par défaut et toggle le reste.

    // ─── Causes de mort ──────────────────────────────────────────────
    let mut death_causes: HashMap<String, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::ActorDeath { victim, victim_geid, damage_type, .. } = ev {
            if is_local_actor(*victim_geid, victim) {
                *death_causes.entry(damage_type.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut top_causes: Vec<_> = death_causes.into_iter().collect();
    top_causes.sort_by(|a, b| b.1.cmp(&a.1));
    // Pas de truncate — liste courte (max ~15 types), on garde tout

    // ─── Dico GEID→pseudo (combat + login) ────────────────────────────────
    // Construit AVANT les rencontres : sert à la fois à NOMMER les joueurs
    // croisés (clé = GEID) et à résoudre les coéquipiers logués en GEID nu.
    // `party-launch leader[Handle]` = chef NOMMÉ en clair ; `CPartyMarkerComponent
    // TrackedEntityId` = membre (GEID → résolu si connu).
    let mut geid_name: HashMap<u64, String> = HashMap::new();
    for ev in all_events {
        match ev {
            GameEvent::CharacterIdentified { name, geid, .. } => {
                if *geid != 0 && !name.is_empty() {
                    geid_name.insert(*geid, name.clone());
                }
            }
            GameEvent::ActorDeath { victim, victim_geid, killer, killer_geid, victim_is_npc, killer_is_npc, .. } => {
                if !*victim_is_npc && *victim_geid != 0 && !victim.is_empty() {
                    geid_name.entry(*victim_geid).or_insert_with(|| victim.clone());
                }
                if !*killer_is_npc && *killer_geid != 0 && !killer.is_empty() {
                    geid_name.entry(*killer_geid).or_insert_with(|| killer.clone());
                }
            }
            _ => {}
        }
    }

    // ─── Croisés en combat ───────────────────────────────────────────
    // Clé = GEID de l'AUTRE joueur (chaque joueur distinct = un GEID distinct ;
    // le pseudo n'est QU'un affichage → deux homonymes de GEID différents ne sont
    // plus fusionnés). Valeur : (pseudo affiché, kills, deaths, max_ts) — max_ts
    // est le ts du dernier ActorDeath impliquant ce joueur (lastSeen réel).
    // Fallback non-régressif : si l'autre n'a pas de GEID exploitable (== 0, vieux
    // log), on retombe sur une clé dérivée du pseudo (préfixe 0 réservé au GEID).
    enum EncKey { Geid(u64), Name(String) }
    let other_key = |geid: u64, name: &str| -> Option<(EncKey, String)> {
        let display = geid_name.get(&geid).cloned().unwrap_or_else(|| name.to_string());
        if geid != 0 {
            Some((EncKey::Geid(geid), display))
        } else if !name.is_empty() {
            Some((EncKey::Name(name.to_string()), display))
        } else {
            None
        }
    };
    // (kills, deaths, max_ts, display_name) indexés par clé d'encodage stringifiée
    // ("g:<geid>" ou "n:<pseudo>") pour unifier les deux variantes dans une map.
    let mut encounters: HashMap<String, (usize, usize, f64, String)> = HashMap::new();
    let key_str = |k: &EncKey| match k {
        EncKey::Geid(g) => format!("g:{}", g),
        EncKey::Name(n) => format!("n:{}", n),
    };
    for ev in all_events {
        if let GameEvent::ActorDeath { ts, killer, killer_geid, victim, victim_geid, killer_is_npc, victim_is_npc, .. } = ev {
            // Ancrage GEID des deux côtés : « moi » via GEID, « l'autre » ≠ moi
            // (par GEID si dispo) pour ne pas se compter soi-même en rencontre.
            let i_am_killer = is_local_actor(*killer_geid, killer);
            let i_am_victim = is_local_actor(*victim_geid, victim);
            if i_am_killer && !victim_is_npc && !i_am_victim {
                if let Some((k, display)) = other_key(*victim_geid, victim) {
                    let e = encounters.entry(key_str(&k)).or_insert((0, 0, 0.0, display));
                    e.0 += 1;
                    if *ts > e.2 { e.2 = *ts; }
                }
            } else if i_am_victim && !killer_is_npc && !i_am_killer {
                if let Some((k, display)) = other_key(*killer_geid, killer) {
                    let e = encounters.entry(key_str(&k)).or_insert((0, 0, 0.0, display));
                    e.1 += 1;
                    if *ts > e.2 { e.2 = *ts; }
                }
            }
        }
    }
    // Croisés en combat via les "Crime Committed" (source PVP des builds récents,
    // sans GEID → clé par nom). Homicide/Destruction = kill compté pour ce joueur.
    for (victim, ts, is_kill) in &crime_victims {
        let e = encounters.entry(format!("n:{}", victim)).or_insert((0, 0, 0.0, victim.clone()));
        if *is_kill { e.0 += 1; }
        if *ts > e.2 { e.2 = *ts; }
    }
    // Re-projette en (pseudo affiché, (kills, deaths, max_ts)) pour le reste du
    // pipeline (sort/JSON inchangés). Le pseudo vient du dico GEID→nom (résolu).
    let mut top_encounters: Vec<(String, (usize, usize, f64))> = encounters
        .into_values()
        .map(|(k, d, ts, name)| (name, (k, d, ts)))
        .collect();
    top_encounters.sort_by(|a, b| (b.1.0 + b.1.1).cmp(&(a.1.0 + a.1.1)));
    // Pas de truncate — chaque rencontre PVP a une histoire

    // ─── Compagnons de vol (social) ───────────────────────────────────────
    let fought_names: std::collections::HashSet<String> =
        top_encounters.iter().map(|(n, _)| n.clone()).collect();
    // clé = pseudo affiché (résolu) ou "Joueur #<id>" → (count, is_leader, resolved)
    let mut companions: HashMap<String, (u32, bool, bool)> = HashMap::new();
    for ev in all_events {
        match ev {
            GameEvent::PartyLeader { leader, .. } => {
                if leader.as_str() != moniker && Some(leader.as_str()) != handle && !leader.is_empty() {
                    let e = companions.entry(leader.clone()).or_insert((0, true, true));
                    e.0 += 1;
                    e.1 = true;
                }
            }
            GameEvent::PartyMember { geid, .. } => {
                // `TrackedEntityId` = entity-GEID (même famille que resolved_local_geid).
                if *geid == 0 || Some(*geid) == resolved_local_geid { continue; }
                let (label, resolved) = match geid_name.get(geid) {
                    Some(n) if n.as_str() != moniker => (n.clone(), true),
                    _ => (format!("Joueur #{}", geid % 1_000_000), false),
                };
                companions.entry(label).or_insert((0, false, resolved)).0 += 1;
            }
            _ => {}
        }
    }
    // Compagnons NOMMÉS via les notifs "<X> has joined the party/channel" — la
    // source la plus riche (les PartyMember GEID restent souvent anonymes). Dédup
    // fenêtré (même membre < 300 s = même join re-loggé par le HUD).
    let mut joins_sorted: Vec<(f64, String)> = all_events.iter().filter_map(|ev| match ev {
        GameEvent::PartyJoin { ts, member }
            if !member.is_empty() && member.as_str() != moniker && Some(member.as_str()) != handle =>
            Some((*ts, member.clone())),
        _ => None,
    }).collect();
    joins_sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut join_last: HashMap<String, f64> = HashMap::new();
    for (ts, member) in &joins_sorted {
        if let Some(&last) = join_last.get(member) {
            if ts - last < 300.0 { continue; }
        }
        join_last.insert(member.clone(), *ts);
        let e = companions.entry(member.clone()).or_insert((0, false, true));
        e.0 += 1;
        e.2 = true; // pseudo récupéré → compagnon NOMMÉ
    }

    // Exclut le joueur lui-même (peut s'auto-lister via un PartyMember portant son
    // propre geid personnage, ≠ resolved_local_geid entité → non filtré plus haut).
    companions.remove(moniker);
    if let Some(h) = handle { companions.remove(h); }
    let companions_total = companions.len();
    let companions_named = companions.values().filter(|(_, _, r)| *r).count();
    let mut companions_vec: Vec<(String, u32, bool, bool)> = companions.into_iter()
        .map(|(name, (count, is_leader, resolved))| (name, count, is_leader, resolved))
        .collect();
    // On n'affiche QUE les coéquipiers NOMMÉS (pseudo récupérable) : les GEID nus
    // ("Joueur #id") sont du bruit → résumés en compteur (total − named) côté UI.
    companions_vec.retain(|c| c.3);
    companions_vec.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1))); // chef d'abord, puis fréquence
    companions_vec.truncate(50); // garde-fou liste

    // ─── Stats de groupe (social) : coéquipiers distincts (PlayerJoined),
    // missions partagées (MissionShared), fois chef de groupe (transfert de
    // leadership DEPUIS soi).
    let mut distinct_teammates: std::collections::HashSet<u64> = std::collections::HashSet::new();
    let mut shared_missions: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut times_leader: u32 = 0;
    for ev in all_events {
        match ev {
            // player_geid/leader_geid sont des ENTITY-GEID (même famille que
            // resolved_local_geid, ≠ CharacterIdentified.geid) → ancrage GEID local.
            GameEvent::MissionPlayerJoined { player_geid, .. } => {
                if *player_geid != 0 && Some(*player_geid) != resolved_local_geid {
                    distinct_teammates.insert(*player_geid);
                }
            }
            GameEvent::MissionShared { mission_id, .. } => { shared_missions.insert(mission_id.clone()); }
            GameEvent::GroupLeadershipTransfer { leader_geid, .. } => {
                if Some(*leader_geid) == resolved_local_geid { times_leader += 1; }
            }
            _ => {}
        }
    }

    let companions_json = if companions_total > 0 {
        serde_json::json!({
            "total": companions_total,
            "named": companions_named,
            "distinctTeammates": distinct_teammates.len(),
            "sharedMissions": shared_missions.len(),
            "timesLeader": times_leader,
            "list": companions_vec.iter().map(|(name, count, is_leader, resolved)| serde_json::json!({
                "name": name,
                "count": count,
                "isLeader": is_leader,
                "resolved": resolved,
                "fought": fought_names.contains(name),
            })).collect::<Vec<_>>(),
        })
    } else {
        serde_json::Value::Null
    };

    // ─── Records ──────────────────────────────────────────────────────
    let longest_session_secs = sessions.iter()
        .filter_map(|(s, e)| e.map(|end| end - s))
        .filter(|d| *d > 0.0 && *d < 86400.0)
        .fold(0f64, f64::max);
    let mut latest_night_hour = 0u32;
    let mut latest_night_min = 0u32;
    let mut has_night_session = false;
    for (s, _) in &sessions {
        // Heure d'horloge LOCALE : le « night-owl » (0h-6h) est relatif au fuseau
        // du joueur, pas à UTC.
        let dt = match local_dt(*s as i64) { Some(d) => d, None => continue };
        let h = dt.hour();
        if h < 6 {
            if !has_night_session
                || h > latest_night_hour
                || (h == latest_night_hour && dt.minute() > latest_night_min)
            {
                latest_night_hour = h;
                latest_night_min = dt.minute();
            }
            has_night_session = true;
        }
    }
    let max_kills_per_session = compute_max_kills_per_session(&sessions, &all_events, &moniker, resolved_local_geid);

    // Last session details — itère sur les sessions récentes jusqu'à trouver
    // une session qui peut être enrichie (vehicle/zone détectés + durée > 1min).
    // Évite l'affichage "0h aux commandes d'un Inconnu autour de Inconnue".
    let last_session = recent_window.iter().find_map(|(s, e)| {
        let end = e.unwrap();
        let dur_min = ((end - s) / 60.0) as u32;
        if dur_min < 1 { return None; }
        let date_iso = DateTime::<Utc>::from_timestamp(*s as i64, 0).map(|d| d.to_rfc3339()).unwrap_or_default();
        let mut vehicle = "Inconnu".to_string();
        let mut zone = "Inconnue".to_string();
        for ev in all_events {
            let ts = event_ts(ev);
            if ts < *s || ts > end { continue; }
            match ev {
                GameEvent::QuantumSelected { vehicle: v, destination: d, .. } => {
                    vehicle = canonicalize_vehicle(v);
                    zone = clean_destination(d);
                }
                GameEvent::ActorDeath { zone: z, .. } if vehicle == "Inconnu" => {
                    zone = clean_zone_name(z);
                }
                _ => {}
            }
        }
        // Skip si on n'a rien enrichi
        if vehicle == "Inconnu" && zone == "Inconnue" { return None; }
        Some((date_iso, dur_min, vehicle, zone))
    }).or_else(|| {
        // Fallback : prend la 1ère session avec durée >= 1min, même non enrichie
        recent_window.iter().find_map(|(s, e)| {
            let end = e.unwrap();
            let dur_min = ((end - s) / 60.0) as u32;
            if dur_min < 1 { return None; }
            let date_iso = DateTime::<Utc>::from_timestamp(*s as i64, 0).map(|d| d.to_rfc3339()).unwrap_or_default();
            Some((date_iso, dur_min, "Inconnu".to_string(), "Inconnue".to_string()))
        })
    });

    // ─── Sessions distinct ────────────────────────────────────────────
    let session_count = sessions.len();

    // ─── systemsVisited réel ──────────────────────────────────────────
    // Pris depuis les SolarSystemChange events (from + to). Stanton est
    // implicite si on n'a aucun event (cas d'un joueur jamais sorti).
    let mut systems_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    systems_set.insert("Stanton".to_string()); // par défaut, tout SC joueur a été dans Stanton
    for ev in all_events {
        match ev {
            // ⚠️ Le champ `entity` du saut était capturé mais IGNORÉ : un inconnu
            // qui saute Stanton→Pyro à côté de nous ajoutait Pyro à NOS systèmes.
            // On n'attribue le saut qu'à NOTRE entité (ancrage GEID/moniker).
            GameEvent::SolarSystemChange { entity, from, to, .. } if ssc_is_local(entity) => {
                let f = prettify_zone_sc(from);
                let t = prettify_zone_sc(to);
                if !f.is_empty() { systems_set.insert(f); }
                if !t.is_empty() { systems_set.insert(t); }
            }
            // Présence détectée via chargement de zones (ex Nyx atteint sans
            // event de saut loggé) — signal LOCAL légitime (c'est NOTRE client
            // qui charge la zone) → compte comme visité (même 2 sec).
            GameEvent::SystemSeen { system, .. } => { systems_set.insert(system.clone()); }
            _ => {}
        }
    }
    // Filtre les noms qui sont vraiment des systèmes SC connus
    let known_systems = ["Stanton", "Pyro", "Nyx", "Castra", "Terra"];
    let systems_visited: Vec<String> = known_systems.iter()
        .filter(|s| systems_set.iter().any(|v| v.eq_ignore_ascii_case(s)))
        .map(|s| s.to_string())
        .collect();

    // ─── fastestQuantumSeconds (diff Selected → Arrived) ──────────────
    // Pour chaque vaisseau, on garde la trace du dernier QuantumSelected
    // puis on calcule le delta au moment du QuantumArrived correspondant.
    let mut last_qt_selected: HashMap<String, f64> = HashMap::new();
    let mut fastest_qt = f64::MAX;
    for ev in all_events {
        match ev {
            GameEvent::QuantumSelected { ts, vehicle, .. } => {
                last_qt_selected.insert(canonicalize_vehicle(vehicle), *ts);
            }
            // Arrived filtré local : on n'apparie un Selected qu'avec l'arrivée
            // de NOTRE vaisseau (plus de paire Selected-moi / Arrived-autre).
            GameEvent::QuantumArrived { ts, vehicle, vehicle_geid } if qt_arrived_is_local(*vehicle_geid) => {
                let key = canonicalize_vehicle(vehicle);
                if let Some(start_ts) = last_qt_selected.remove(&key) {
                    let delta = ts - start_ts;
                    // Filtre les jumps absurdes (< 5s = bug, > 30min = AFK)
                    if delta >= 5.0 && delta < 1800.0 && delta < fastest_qt {
                        fastest_qt = delta;
                    }
                }
            }
            _ => {}
        }
    }
    // Option pour le JSON (null quand aucune paire QT exploitable → l'UI affiche "—").
    let fastest_quantum_seconds_opt: Option<u32> =
        if fastest_qt == f64::MAX { None } else { Some(fastest_qt as u32) };
    // Version u32 pour les achievements (0 = condition non remplie, comportement inchangé).
    let fastest_quantum_seconds = fastest_quantum_seconds_opt.unwrap_or(0);

    // ─── streakDays "courant" (run consécutif jusqu'au DERNIER jour joué) ──
    // On compte la streak qui se termine au dernier jour où le joueur a
    // été actif — pas forcément aujourd'hui. Si le joueur ne joue plus
    // depuis 3 jours mais qu'il avait enchainé 5 jours avant, on affiche 5.
    // Si le joueur joue aujourd'hui, le compte continue jusqu'à aujourd'hui.
    // Index de jour LOCAL (frontières à minuit local, DST-safe) : une session à
    // 0h30 locale et une à 23h locale la veille = 2 jours consécutifs corrects,
    // alors qu'en UTC la frontière décalée pouvait couper/fusionner la streak.
    let mut days_played: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (s, _) in &sessions {
        days_played.insert(local_day_index(*s as i64));
    }
    let mut current_streak = 0u32;
    if let Some(&last_day_played) = days_played.iter().max() {
        let mut day = last_day_played;
        while days_played.contains(&day) {
            current_streak += 1;
            day -= 1;
        }
    }
    let longest_streak = compute_longest_streak(&sessions);

    // ─── recentSessions enrichies (vehicles/zones/kills par session) ──
    let recent_window_enriched: Vec<(f64, f64, Vec<String>, Vec<String>, u32, u32)> = recent_window.iter()
        .map(|(s, e)| {
            let end = e.unwrap();
            let mut vset: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut zset: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut k = 0u32;
            let mut d = 0u32;
            for ev in all_events {
                let ts = event_ts(ev);
                if ts < *s || ts > end { continue; }
                match ev {
                    GameEvent::QuantumSelected { vehicle, destination, .. } => {
                        vset.insert(canonicalize_vehicle(vehicle));
                        let z = prettify_zone_sc(destination);
                        if !z.is_empty() { zset.insert(z); }
                    }
                    GameEvent::QuantumArrived { vehicle, vehicle_geid, .. } if qt_arrived_is_local(*vehicle_geid) => {
                        vset.insert(canonicalize_vehicle(vehicle));
                    }
                    GameEvent::ActorDeath { killer, killer_geid, victim, victim_geid, zone, is_suicide, .. } => {
                        let z = prettify_zone_sc(zone);
                        if !z.is_empty() { zset.insert(z); }
                        if is_local_actor(*killer_geid, killer) && !is_suicide { k += 1; }
                        if is_local_actor(*victim_geid, victim) && !is_suicide { d += 1; }
                    }
                    GameEvent::VehicleDestruction { vehicle, driver, driver_geid, .. } if is_local_actor(*driver_geid, driver) => {
                        vset.insert(canonicalize_vehicle(vehicle));
                    }
                    _ => {}
                }
            }
            let mut vehicles: Vec<String> = vset.into_iter().collect();
            vehicles.sort();
            vehicles.truncate(3);
            let mut zones: Vec<String> = zset.into_iter().collect();
            zones.sort();
            zones.truncate(3);
            (*s, end, vehicles, zones, k, d)
        })
        .collect();

    // ─── playerProfile auto (breakdown réel) ──────────────────────────
    let profile_breakdown = compute_profile_breakdown(
        &vehicle_hits,
        mining_missions_complete as u32,
        salvage_missions_complete as u32,
        bounty_missions_complete as u32,
        cargo_missions_complete as u32,
    );
    let dominant_label = infer_dominant_profile_from_breakdown(&profile_breakdown);

    // ─── Achievements (vraies conditions) ─────────────────────────────
    // Jumps QT du JOUEUR : Arrived dont le vaisseau a été piloté localement.
    // Réutilisé pour les achievements ET `totalQuantumJumps` (cohérence).
    let qt_local_jumps = all_events.iter().filter(|e| match e {
        GameEvent::QuantumArrived { vehicle_geid, .. } => qt_arrived_is_local(*vehicle_geid),
        _ => false,
    }).count();
    let qt_count = qt_local_jumps as u32;
    let unique_zone_count_total = zone_count_total(&all_events, resolved_local_geid, moniker) as u32;
    // Compte les arcs électriques (mort par ElectricArc en Pyro)
    let electric_deaths = all_events.iter().filter(|e| matches!(e, GameEvent::ActorDeath { victim, victim_geid, damage_type, .. } if is_local_actor(*victim_geid, victim) && damage_type == "ElectricArc")).count() as u32;
    // Compte les latest night hour (heure la plus tardive)
    let latest_night_h = latest_night_hour;
    // Compte la version la plus ancienne (firstPatchSeen)
    let first_version_num = first_version.as_deref()
        .map(|v| v.trim_start_matches("sc-alpha-").to_string())
        .and_then(|v| v.split('.').next().map(|s| s.to_string()))
        .and_then(|major| major.parse::<u32>().ok())
        .unwrap_or(99);
    let achievement_items = build_achievements(
        total_hours,
        kills_pvp,
        kills_pve as u32,
        qt_count,
        versions.len() as u32,
        systems_visited.iter().any(|s| s == "Pyro"),
        systems_visited.len() as u32,
        sessions.first().map(|(s, _)| *s),
        total_kills,
        (longest_session_secs / 60.0) as u32,
        unique_vehicle_count as u32,
        unique_zone_count_total,
        fastest_quantum_seconds,
        longest_streak,
        electric_deaths,
        latest_night_h,
        first_version_num,
        session_count as u32,
        max_kills_per_session,
        mining_missions_complete as u32,
        salvage_missions_complete as u32,
        bounty_missions_complete as u32,
        cargo_missions_complete as u32,
        total_missions_complete,
        // Source de vérité UNIQUE pour le K/D (cf. combat.ratio) : `None` si 0 mort.
        kd_ratio,
    );
    let unlocked_count = achievement_items.iter().filter(|v| v.get("unlocked").and_then(|u| u.as_bool()).unwrap_or(false)).count();
    let total_count = achievement_items.len();

    // ─── systemTime réel ──────────────────────────────────────────────
    // Pour chaque session CLÔTURÉE (durée valide), on attribue ses heures au
    // système solaire ACTIF au début de la session. Le système courant est
    // suivi en running-state, mis à jour AU FIL des events par les seuls
    // signaux de présence LOCAUX :
    //   • `SolarSystemChange` du joueur local (`ssc_is_local`) → `to`
    // (`SystemSeen` n'est PLUS pris en compte pour le TEMPS : trop de faux
    //  positifs via le préchargement d'assets `StatObjLoad … File exists in P4K`
    //  — cf. note dans la boucle ci-dessous. Reste utilisé pour le badge « visité ».)
    // Anciennement : O(n²) (re-scan complet de tous les events par session) ET
    // le système était choisi par le DERNIER changement GLOBAL (n'importe quelle
    // entité) avant la session → une session pouvait être attribuée à un système
    // où le joueur n'était pas (saut d'un inconnu à côté). Défaut "Stanton".
    let mut system_hours: HashMap<String, f64> = HashMap::new();
    // Sessions valides (clôturées, durée plausible), triées par début pour le
    // balayage à deux pointeurs avec le flux d'events (lui-même trié par ts).
    let mut valid_sessions: Vec<(f64, f64)> = sessions.iter()
        .filter_map(|(start, end_opt)| {
            let end = (*end_opt)?;
            let dur = end - start;
            if dur <= 0.0 || dur >= 86400.0 { return None; }
            Some((*start, dur))
        })
        .collect();
    valid_sessions.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut current_system = "Stanton".to_string();
    let mut si = 0usize; // index session courante à attribuer
    for ev in all_events {
        let ts = event_ts(ev);
        // Avant de consommer cet event, fige le système des sessions dont le
        // début est <= ts de l'event (running-state au moment du start).
        while si < valid_sessions.len() && valid_sessions[si].0 < ts {
            *system_hours.entry(current_system.clone()).or_insert(0.0)
                += valid_sessions[si].1 / 3600.0;
            si += 1;
        }
        match ev {
            GameEvent::SolarSystemChange { entity, to, .. } if ssc_is_local(entity) => {
                let pretty = prettify_zone_sc(to);
                if !pretty.is_empty() { current_system = pretty; }
            }
            // Inventaire de lieu (`RequestLocationInventory`) : signal de présence
            // FIABLE, réparti sur la session, player-anchored (le client ne loggue
            // que les requêtes du joueur local). C'est la source PRINCIPALE du temps
            // par système quand AUCUN `SolarSystemChange` n'est loggé (cas Artics : 0
            // saut → sans ça tout tombait à tort sur Stanton). `system_from_zone_token`
            // renvoie None sur token inconnu → ne déplace jamais le système sur du bruit.
            GameEvent::LocationInventory { location, .. } => {
                if let Some(sys) = system_from_zone_token(location) {
                    current_system = sys.to_string();
                }
            }
            // `SystemSeen` (chargement de zone `loc/mod/<sys>/`) volontairement
            // IGNORÉ pour le temps : massivement du préchargement d'assets
            // (`<StatObjLoad> … 'File exists in P4K'`), PAS de la présence réelle —
            // un seul faux "Nyx" rendait `current_system` collant (bug 216h Nyx). Il
            // ne sert qu'au badge « systèmes visités ».
            _ => {}
        }
    }
    // Sessions restantes (début postérieur ou égal au dernier event) → système courant.
    while si < valid_sessions.len() {
        *system_hours.entry(current_system.clone()).or_insert(0.0)
            += valid_sessions[si].1 / 3600.0;
        si += 1;
    }
    let mut system_time_map = serde_json::Map::new();
    for (sys, hours) in &system_hours {
        let h = hours.round() as u64;
        if h > 0 {
            system_time_map.insert(sys.clone(), serde_json::json!(h));
        }
    }
    let system_time = serde_json::Value::Object(system_time_map);

    // ─── Survie : épisodes d'asphyxie (manque d'O2) ───────────────────────
    // Paire started→stopped (1 seul joueur local → état séquentiel). Reset à
    // chaque SessionStart pour ne pas franchir les sessions. Durées plafonnées.
    let mut suffocation_episodes: u32 = 0;
    let mut suffocation_total_s: f64 = 0.0;
    let mut suffocation_longest_s: f64 = 0.0;
    let mut pending_suffocation: Option<f64> = None;
    for ev in all_events {
        match ev {
            GameEvent::SessionStart { .. } => pending_suffocation = None,
            // La ligne [STAMINA] suffocating ne logue PAS de GEID → on ne peut
            // ancrer que sur le moniker (is_local_actor avec geid=0 = fallback
            // nominal). Le pairing started→stopped reste séquentiel & reset/session.
            GameEvent::Suffocation { ts, player, started } if is_local_actor(0, player) => {
                if *started {
                    suffocation_episodes += 1;
                    pending_suffocation = Some(*ts);
                } else if let Some(start) = pending_suffocation.take() {
                    let d = ts - start;
                    if d > 0.0 && d < 3600.0 {
                        suffocation_total_s += d;
                        if d > suffocation_longest_s { suffocation_longest_s = d; }
                    }
                }
            }
            _ => {}
        }
    }

    // ─── Morts en vaisseau (éjecté d'un véhicule détruit) ─────────────────
    // Corrélé à <FatalCollision> (même id véhicule, |Δt|<10s) pour distinguer une
    // mort par COLLISION/accident (PvE) d'une destruction au COMBAT — la seule cause
    // récupérable depuis le retrait de <Vehicle Destruction> des logs.
    let fatal_collisions: Vec<(f64, u64)> = all_events.iter().filter_map(|e| match e {
        GameEvent::FatalCollision { ts, vehicle, .. } => vehicle_geid_from_name(vehicle).map(|g| (*ts, g)),
        _ => None,
    }).collect();
    let mut vehicle_death_count: u32 = 0;
    let mut vehicle_death_hits: HashMap<String, usize> = HashMap::new();
    let mut vehicle_death_causes: HashMap<&'static str, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::VehicleDeath { actor, actor_geid, vehicle, ts } = ev {
            if is_local_vehicle_death(*actor_geid, actor) {
                vehicle_death_count += 1;
                *vehicle_death_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                let vid = vehicle_geid_from_name(vehicle);
                let is_collision = vid.is_some()
                    && fatal_collisions.iter().any(|(cts, cg)| Some(*cg) == vid && (cts - ts).abs() < 10.0);
                *vehicle_death_causes
                    .entry(if is_collision { "Collision / accident" } else { "Détruit au combat" })
                    .or_insert(0) += 1;
            }
        }
    }
    let deadliest_vehicle = vehicle_death_hits.iter()
        .max_by_key(|(_, n)| **n)
        .map(|(v, n)| (vehicle_display_name(v), *n));

    let survival_json = if suffocation_episodes > 0 {
        serde_json::json!({
            "suffocationEpisodes": suffocation_episodes,
            "longestSuffocationSeconds": suffocation_longest_s.round() as u64,
            "totalSuffocationSeconds": suffocation_total_s.round() as u64,
        })
    } else {
        serde_json::Value::Null
    };
    let vehicle_deaths_json = if vehicle_death_count > 0 {
        let mut causes: Vec<(String, usize)> = vehicle_death_causes.iter().map(|(c, n)| (c.to_string(), *n)).collect();
        causes.sort_by(|a, b| b.1.cmp(&a.1));
        serde_json::json!({
            "count": vehicle_death_count,
            "deadliestVehicle": deadliest_vehicle.as_ref()
                .map(|(name, n)| serde_json::json!({ "name": name, "count": *n })),
            "byCause": causes.iter().map(|(c, n)| serde_json::json!({ "cause": c, "count": n })).collect::<Vec<_>>(),
        })
    } else {
        serde_json::Value::Null
    };

    // ─── Commerce cargo (P&L) : achats (price) vs reventes (amount) ────────
    // Données 100% fiables (les récompenses de mission ne sont PAS loggées de
    // façon exploitable → pas de "bilan global", on s'en tient au commerce cargo
    // traçable bout-à-bout). `net` = revente − achat sur la période (le cargo
    // acheté mais pas encore revendu n'est donc pas une "perte").
    let mut cargo_bought: f64 = 0.0;
    let mut cargo_sold: f64 = 0.0;
    let mut cargo_buy_count: u32 = 0;
    let mut cargo_sell_count: u32 = 0;
    let mut cargo_by_guid: HashMap<String, (f64, f64)> = HashMap::new(); // guid -> (acheté, revendu) aUEC
    for ev in all_events {
        match ev {
            // Filtre joueur local : ne pas compter les transactions des autres
            // joueurs présents dans l'instance (le P&L cargo doit être le NÔTRE).
            GameEvent::CommodityBuy { player_id, price_total, commodity_guid, .. } if is_local_player_id(*player_id) => {
                cargo_bought += price_total;
                cargo_buy_count += 1;
                cargo_by_guid.entry(commodity_guid.clone()).or_insert((0.0, 0.0)).0 += price_total;
            }
            GameEvent::CommoditySell { player_id, amount, commodity_guid, .. } if is_local_player_id(*player_id) => {
                cargo_sold += amount;
                cargo_sell_count += 1;
                cargo_by_guid.entry(commodity_guid.clone()).or_insert((0.0, 0.0)).1 += amount;
            }
            _ => {}
        }
    }
    let mut cargo_top: Vec<(String, f64, f64)> = cargo_by_guid.iter()
        .map(|(guid, (b, s))| {
            let name = crate::scripts::uex_commodity_api::guid_to_commodity_name(guid)
                .unwrap_or_else(|| format!("Marchandise #{}", &guid[..8.min(guid.len())]));
            (name, *b, *s)
        })
        .collect();
    cargo_top.sort_by(|a, b| (b.1 + b.2).partial_cmp(&(a.1 + a.2)).unwrap_or(std::cmp::Ordering::Equal));
    cargo_top.truncate(5);
    let cargo_trade_json = if cargo_buy_count > 0 || cargo_sell_count > 0 {
        serde_json::json!({
            "bought": cargo_bought.round() as i64,
            "sold": cargo_sold.round() as i64,
            "net": (cargo_sold - cargo_bought).round() as i64,
            "buyCount": cargo_buy_count,
            "sellCount": cargo_sell_count,
            "topCommodities": cargo_top.iter().map(|(name, b, s)| serde_json::json!({
                "name": name,
                "bought": b.round() as i64,
                "sold": s.round() as i64,
            })).collect::<Vec<_>>(),
        })
    } else {
        serde_json::Value::Null
    };

    // ─── Dépenses boutique (items/équipement) ─────────────────────────────
    // `SendStandardItemBuyRequest` (client_price). Données réelles (≠ revenus
    // mission, non loggés). Total + nb + top boutiques par dépense.
    // Total/agrégats en f64 : prix décimal complet (LOW#4) et aUEC seulement —
    // les achats en REC (Arena Commander) sont EXCLUS pour ne pas gonfler l'éco.
    let mut shop_total: f64 = 0.0;
    let mut shop_count: u32 = 0;
    let mut shop_by_name: HashMap<String, f64> = HashMap::new();
    for ev in all_events {
        if let GameEvent::Purchase { player_id, client_price, shop, currency, .. } = ev {
            if !is_local_player_id(*player_id) { continue; } // dépenses du joueur local only
            if !is_uec_currency(currency) { continue; }      // aUEC only (REC exclu)
            shop_total += *client_price;
            shop_count += 1;
            *shop_by_name.entry(clean_shop_label(shop)).or_insert(0.0) += *client_price;
        }
    }
    let mut shop_top: Vec<(String, f64)> = shop_by_name.into_iter().collect();
    shop_top.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    shop_top.truncate(4);
    let shop_spending_json = if shop_count > 0 {
        serde_json::json!({
            "totalUec": shop_total,
            "count": shop_count,
            "topShops": shop_top.iter().map(|(name, spent)| serde_json::json!({
                "name": name,
                "spent": spent,
            })).collect::<Vec<_>>(),
        })
    } else {
        serde_json::Value::Null
    };

    serde_json::json!({
        "handle": handle,
        "moniker": moniker,
        "totalHours": total_hours,
        "sessionCount": session_count,
        "uniqueVehicleCount": unique_vehicle_count,
        "vehicleCategoryCount": vehicle_category_count,
        "uniqueZoneCount": zone_count_total(&all_events, resolved_local_geid, moniker),
        "systemsVisited": systems_visited,
        "survival": survival_json,
        "vehicleDeaths": vehicle_deaths_json,
        "cargoTrade": cargo_trade_json,
        "shopSpending": shop_spending_json,
        "companions": companions_json,
        "patchesTraversed": versions.len(),
        "firstPatchSeen": first_version.as_deref().unwrap_or("4.0").trim_start_matches("sc-alpha-").to_string(),
        "lastSession": last_session.map(|(d, dur, v, z)| {
            serde_json::json!({
                "date": d,
                "durationMinutes": dur,
                "vehicle": v,
                "location": z,
            })
        }),
        "heatmap": heatmap,
        "peakDay": { "date": peak_day_iso, "hours": peak_hours },
        "topVehicles": top_vehicles_hours.iter().map(|(n, h, s)| serde_json::json!({ "name": n, "hours": h, "sessions": s })).collect::<Vec<_>>(),
        "topLocations": top_locations.iter().map(|(n, v)| serde_json::json!({ "name": n, "hours": v / 4, "visits": v })).collect::<Vec<_>>(),
        "monthlyEvolution": monthly_12.iter().map(|((_y, m), h)| serde_json::json!({
            "monthLabel": month_labels[(*m as usize) - 1],
            "hours": h.round() as u32,
        })).collect::<Vec<_>>(),
        "recentSessions": recent_window_enriched.iter().map(|(s, end, vehicles, zones, k, d)| {
            serde_json::json!({
                "startedAt": DateTime::<Utc>::from_timestamp(*s as i64, 0).map(|d| d.to_rfc3339()).unwrap_or_default(),
                "durationMinutes": ((end - s) / 60.0) as u32,
                "vehicles": vehicles,
                "zones": zones,
                "kills": k,
                "deaths": d,
            })
        }).collect::<Vec<_>>(),
        "combat": {
            "kills": kills_pvp + kills_pve,
            "deaths": deaths,
            // Ratio non défini (0 mort) = null (PAS 999). Le front affiche « — »
            // (0 kill) ou « ∞ » (kills > 0) en se basant sur `deaths === 0`.
            "ratio": kd_ratio,
            "favoriteWeapon": { "name": weapon_class_to_name(&fav_weapon.0).unwrap_or_else(|| fav_weapon.0.clone()), "kills": fav_weapon.1 },
            "lastKill": last_kill.map(|(ts, w, v)| serde_json::json!({
                "weapon": weapon_class_to_name(&w).unwrap_or(w),
                "victim": v,
                // Date calendaire LOCALE (cohérence avec les autres dates murales).
                "date": local_dt(ts as i64).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
            })),
        },
        "blueprintCount": 0,
        "recentBlueprints": [],
        "records": {
            "longestSessionMinutes": (longest_session_secs / 60.0) as u32,
            "fastestQuantumSeconds": fastest_quantum_seconds_opt,
            "longestStreakDays": longest_streak,
            "latestNightHour": if has_night_session {
                serde_json::json!(format!("{:02}h{:02}", latest_night_hour, latest_night_min))
            } else {
                serde_json::Value::Null
            },
            "mostKillsInSession": max_kills_per_session,
        },
        "encounteredPlayers": top_encounters.iter().map(|(n, (k, d, max_ts))| {
            let last_seen = DateTime::<Utc>::from_timestamp(*max_ts as i64, 0).map(|dt| dt.to_rfc3339());
            serde_json::json!({ "name": n, "kills": k, "deaths": d, "lastSeen": last_seen })
        }).collect::<Vec<_>>(),
        "systemTime": system_time,
        "totalQuantumJumps": qt_local_jumps,
        "hourlyDistribution": hourly,
        "weekdayDistribution": weekday,
        "topQuantumRoutes": top_routes.iter().map(|((f, t), n)| serde_json::json!({ "from": f, "to": t, "jumps": n })).collect::<Vec<_>>(),
        "deathCauses": top_causes.iter().map(|(c, n)| serde_json::json!({
            "cause": friendly_cause(c),
            "count": n,
            "icon": cause_icon(c),
        })).collect::<Vec<_>>(),
        "missionStats": {
            "miningPurchases": mining_purchases,
            "miningMissionsNew": mining_missions_new,
            "miningMissionsComplete": mining_missions_complete,
            "miningShipHits": mining_ship_hits,
            "miningScore": mining_score,
            "hasMined": has_mined,
            "salvageMissionsComplete": salvage_missions_complete,
            "bountyMissionsComplete": bounty_missions_complete,
            "cargoMissionsComplete": cargo_missions_complete,
            "totalMissionsComplete": total_missions_complete,
            "totalMissionsFailed": total_missions_failed,
            "totalMissionsAbandoned": total_missions_abandoned,
            // Spécialité dominante (objectifs `<Create…ObjectiveHandler>`) + sa
            // répartition brute. `missionSpecialty` = null si aucun objectif connu.
            "missionSpecialty": mission_specialty,
            "objectiveTypeBreakdown": serde_json::Value::Object(objective_type_breakdown),
            "recentMissions": recent_missions_list.iter().map(|(ts, mt, text)| {
                serde_json::json!({
                    "completedAt": DateTime::<Utc>::from_timestamp(*ts as i64, 0).map(|d| d.to_rfc3339()).unwrap_or_default(),
                    "type": mt,
                    "text": prettify_objective_text(text),
                })
            }).collect::<Vec<_>>(),
        },
        "playerProfile": {
            "dominantLabel": dominant_label,
            "breakdown": profile_breakdown,
        },
        "achievements": {
            "unlockedCount": unlocked_count,
            "totalCount": total_count,
            "items": achievement_items,
        },
        "streakDays": current_streak,
        "streakRecordDays": longest_streak,
    })
}

// ── Helpers pour generate_rom_mock_data ──

/// Extrait le GEID entité d'un nom de vaisseau loggé (`RSI_Polaris_5535611394782`
/// → `5535611394782`). Le SetDriver capture le nom AVEC ce suffixe ; on s'en sert
/// pour corréler un `QuantumArrived` (qui logue le même GEID) au vaisseau piloté.
/// Retourne `None` si pas de suffixe numérique ≥ 12 chiffres (= déjà canonique
/// ou modèle générique). Seuil aligné sur la regex QT (`\d{12,}`) pour que les
/// deux côtés de la corrélation reposent sur la même force d'identité.
fn vehicle_geid_from_name(raw: &str) -> Option<u64> {
    let tail: String = raw.chars().rev().take_while(|c| c.is_ascii_digit()).collect();
    if tail.len() < 12 { return None; }
    tail.chars().rev().collect::<String>().parse::<u64>().ok()
}

fn canonicalize_vehicle(raw: &str) -> String {
    // Strip suffix _DIGITS, keep MANUFACTURER_Model. Regex compilées une fois
    // (OnceLock) car appelé en boucle chaude — voir MED#13.
    let cleaned = re_instance_suffix().replace(raw, "");
    // Strip "PU_AI_*"
    re_pu_ai_tag().replace(&cleaned, "").into_owned()
}

/// Sort le nom court d'un vaisseau pour l'affichage en contexte zone.
/// Strip le manufacturer code et garde juste le modèle.
/// Ex: "RSI_Polaris" → "Polaris" ; "MISC_Hull_B" → "Hull B"
fn pretty_vehicle_short(canonical: &str) -> String {
    // Strip code manufacturer 3-5 lettres en début + underscore
    let manufacturers = ["AEGS_","ANVL_","ARGO_","BANU_","CNOU_","CRUS_","DRAK_","ESPR_","GAMA_","GRIN_","KRIG_","MISC_","MRAI_","ORIG_","RSI_","TMBL_","VNCL_","XIAN_","XNAA_"];
    let mut s = canonical.to_string();
    for m in &manufacturers {
        if let Some(stripped) = s.strip_prefix(m) {
            s = stripped.to_string();
            break;
        }
    }
    s.replace('_', " ")
}

/// Nettoie un shopName SC interne pour l'affichage. Les boutiques ne sont PAS
/// dans le global.ini (marques non traduites), donc heuristique : on enlève le
/// bruit d'instance (`001`…) + les mots redondants, on traduit les mots
/// génériques en FR, et on GARDE les marques + lieux (Area18, Lorville, Pyro…).
/// Ex `SCShop_Pyro_RStop_ShipWeapons_001` → "Pyro Rest Stop Armes vaisseau".
fn clean_shop_label(raw: &str) -> String {
    let stripped = raw
        .trim_start_matches("SCShop_")
        .trim_start_matches("SCshop_")
        .trim_start_matches("scshop_");
    let mut out: Vec<String> = Vec::new();
    for tok in stripped.split(|c| c == '_' || c == '-') {
        if tok.is_empty() || tok.chars().all(|c| c.is_ascii_digit()) {
            continue; // vide ou pur numéro d'instance
        }
        match tok.to_lowercase().as_str() {
            // mots redondants / bruit → on supprime
            "store" | "shop" | "salesperson" | "mrecart" | "cart" | "vendor" => continue,
            // traductions FR des mots génériques
            "food" => out.push("Resto".into()),
            "reststop" | "rstop" => out.push("Rest Stop".into()),
            "shipweapons" => out.push("Armes vaisseau".into()),
            "weapons" | "weapon" => out.push("Armes".into()),
            "interior" => out.push("Intérieur".into()),
            "showroom" => out.push("Concession".into()),
            "pharmacy" => out.push("Pharmacie".into()),
            "clothing" | "apparel" => out.push("Vêtements".into()),
            "armor" | "armour" => out.push("Armure".into()),
            "refinery" => out.push("Raffinerie".into()),
            "weaponsshop" => out.push("Armurerie".into()),
            // sinon : garder tel quel (marque / lieu)
            _ => out.push(tok.to_string()),
        }
    }
    let s = out.join(" ");
    let s = s.trim();
    if s.is_empty() { raw.to_string() } else { s.to_string() }
}

/// Affichage propre d'une cible de combat. Les PNJ ont des noms internes
/// illisibles (`NPC_Archetypes-Male-Human-distributioncentre_sniper_714…`) → on
/// extrait le rôle si possible, sinon "PNJ". Les joueurs gardent leur pseudo.
/// Table datamine SC Wiki (class_name d'arme → nom commercial), embarquée.
fn bundled_weapon_names() -> &'static std::collections::HashMap<String, String> {
    static MAP: std::sync::OnceLock<std::collections::HashMap<String, String>> = std::sync::OnceLock::new();
    MAP.get_or_init(|| {
        const RAW: &str = include_str!("weapon_names.json");
        serde_json::from_str::<std::collections::HashMap<String, String>>(RAW)
            .unwrap_or_default()
            .into_iter()
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect()
    })
}

/// Nom commercial d'une arme depuis son class_name de log
/// (`volt_lmg_energy_01_tint02` → "Fresnel Energy LMG"). Essaie l'exact, puis
/// retire les suffixes de skin (`_tint02`, `_gold01`, `_store01`…) un par un.
fn weapon_class_to_name(class_name: &str) -> Option<String> {
    if class_name.is_empty() || class_name == "unknown" { return None; }
    let table = bundled_weapon_names();
    let mut key = class_name.to_lowercase();
    loop {
        if let Some(name) = table.get(&key) {
            return Some(name.clone());
        }
        match key.rfind('_') {
            // garde au moins 2 segments (mfg_type) avant d'abandonner
            Some(idx) if key[..idx].contains('_') => key.truncate(idx),
            _ => return None,
        }
    }
}

fn clean_combat_target(name: &str, is_npc: bool) -> String {
    if !is_npc {
        return name.to_string();
    }
    let lower = name.to_lowercase();
    let roles: &[(&str, &str)] = &[
        ("sniper", "Sniper"), ("gunner", "Mitrailleur"), ("soldier", "Soldat"),
        ("guard", "Garde"), ("pirate", "Pirate"), ("grunt", "Sbire"),
        ("lieutenant", "Lieutenant"), ("commander", "Commandant"),
        ("officer", "Officier"), ("engineer", "Ingénieur"), ("medic", "Médic"),
        ("juggernaut", "Juggernaut"), ("heavy", "Lourd"), ("boss", "Boss"),
        ("technician", "Technicien"), ("hostage", "Otage"), ("civilian", "Civil"),
    ];
    for (k, label) in roles {
        if lower.contains(k) {
            return format!("PNJ · {label}");
        }
    }
    "PNJ".to_string()
}

/// Nom commercial d'affichage d'un vaisseau depuis le canonical interne.
/// Catalog Fleetyards si dispo (ex `MISC_Hull_B` → "Hull B"), sinon fallback sur
/// le strip manufacturer (`pretty_vehicle_short`).
fn vehicle_display_name(canonical: &str) -> String {
    if let Some(cat) = crate::scripts::ship_catalog_cache::get_catalog() {
        if let Some(info) = cat.lookup(canonical) {
            if !info.name.trim().is_empty() {
                return info.name.clone();
            }
        }
    }
    pretty_vehicle_short(canonical)
}

fn clean_zone_name(raw: &str) -> String {
    // Pipeline : strip _DIGITS, strip prefixes connus, mapper vers nom SC propre.
    // Regex compilée une fois (OnceLock), hot path — voir MED#13.
    let cleaned = re_instance_suffix().replace(raw, "");
    prettify_zone_sc(&cleaned)
}

fn clean_destination(raw: &str) -> String {
    prettify_zone_sc(raw)
}

/// Mapping exhaustif des ObjectContainer / InteriorPlace / Zone SC vers
/// des noms lisibles humains. Reconnait les patterns Stanton + Pyro + Nyx
/// (et tout system SC futur, fallback générique propre).
///
/// Couvre :
///   - Stanton : 4 planètes (Hurston I, Crusader II, ArcCorp III, microTech IV)
///     + 12 lunes + stations majeures (Lorville, Area18, Orison, New Babbage)
///     + Lagrange Rest Stops HUR/CRU/ARC/MIC L1-L5
///     + ceintures (Aaron Halo, Checkmate)
///     + Comm Arrays ST1-ST4
///     + Distribution Centers (Goldenrod, S4DC, S4LD)
///     + Onyx Facilities (layout_int_lab/science)
///     + UGF Bunkers (α / β)
///     + Derelict outposts / abandoned facilities
///   - Pyro : 6 planètes (Pyro I, Monox II, Bloom III, Pyro IV, Pyro V, Terminus VI)
///     + 6 lunes Pyro V (Ignis 5a, Vatra 5b, Adir 5c, Fairo 5d, Fuego 5e, Vuur 5f)
///     + stations (Ruin, Gaslight, Endgame, Starlight, Patch City, Rod's, Rat's)
///     + contested zones (pXlN_contestedzone)
///     + Rest Stops Pyro
///   - Nyx : Nyx I/II/III + Delamar + Levski
///   - Vaisseaux d'AI capturés (890Jump Hijacked, Valkyrie NPC)
///   - Fallback : split _, Title Case
fn prettify_zone_sc(raw: &str) -> String {
    let r = raw.trim();
    if r.is_empty() { return String::new(); }

    // 1. Strip prefixes connus
    let r = r.trim_start_matches("ObjectContainer_")
        .trim_start_matches("ObjectContainer-")
        .trim_start_matches("OOC_Stanton_")
        .trim_start_matches("OOC_Pyro_")
        .trim_start_matches("OOC_Nyx_")
        .trim_start_matches("InteriorPlace_")
        .trim_start_matches("Stanton_")
        .trim_start_matches("Pyro_")
        .trim_start_matches("Nyx_");

    let lower = r.to_ascii_lowercase();

    // ═══════════════════════════════════════════════════════════════
    // 2. PATTERNS TECHNIQUES (capital ship interiors, surface, vehicules NPC)
    // ═══════════════════════════════════════════════════════════════
    if lower.contains("rastarinteriorgridhost")
        || lower.contains("rastarflex")
        || lower.contains("rastarroad")
        || lower.starts_with("rastar")
    {
        return "Intérieur vaisseau".to_string();
    }
    if lower == "planet" || lower == "space" {
        return "Espace ouvert".to_string();
    }
    // Vaisseaux NPC capturés/piratés (890Jump_Hijacked, Valkyrie_AI_PU_AI_HeadHunters)
    if lower.contains("890jump_hijacked") || lower.contains("890_jump_hijacked") {
        return "890 Jump (piraté)".to_string();
    }
    // Vaisseaux d'AI HeadHunters / Pirates / Cutlass groups
    if lower.contains("_ai_pu_ai_") || lower.contains("_pu_ai_") {
        let manufacturers = [("aegs","Aegis"),("anvl","Anvil"),("argo","ARGO"),("banu","Banu"),
            ("cnou","Consolidated"),("crus","Crusader"),("drak","Drake"),("espr","Esperia"),
            ("gama","Gama"),("grin","Greycat"),("krig","Kruger"),("misc","MISC"),("mrai","Mirai"),
            ("orig","Origin"),("rsi","RSI"),("tmbl","Tumbril"),("vncl","Vanduul"),("xian","Xian")];
        for (code, full) in &manufacturers {
            if let Some(stripped) = lower.strip_prefix(&format!("{}_", code)) {
                // Extrait le nom du modèle jusqu'à _ai ou _pu
                let model: String = stripped.chars()
                    .take_while(|c| *c != '_' || !stripped[stripped.find(|x: char| x == *c).unwrap_or(0)..].starts_with("_ai"))
                    .take(40)
                    .collect();
                let model_clean = model.split("_ai").next().unwrap_or(&model)
                    .split("_pu").next().unwrap_or(&model)
                    .replace('_', " ");
                let model_title = title_case(&model_clean);
                return format!("{} {} (NPC)", full, model_title);
            }
        }
        return "Vaisseau NPC".to_string();
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. UGF — Underground Facility (bunkers)
    // ═══════════════════════════════════════════════════════════════
    if let Some(idx) = lower.find("ugf_lta_a_") {
        let rest = &lower[idx + "ugf_lta_a_".len()..];
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return if num.is_empty() { "Bunker UGF α".to_string() }
            else { format!("Bunker UGF α-{}", num.trim_start_matches('0')) };
    }
    if let Some(idx) = lower.find("ugf_lta_b_") {
        let rest = &lower[idx + "ugf_lta_b_".len()..];
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return if num.is_empty() { "Bunker UGF β".to_string() }
            else { format!("Bunker UGF β-{}", num.trim_start_matches('0')) };
    }
    if lower.contains("ugf_") || lower.starts_with("ugf") {
        return "Bunker UGF".to_string();
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. DISTRIBUTION CENTERS Stanton IV (microTech) — int_s4_dc_*
    // ═══════════════════════════════════════════════════════════════
    if lower.contains("int_s4_dc_sasu_goldenrod") { return "Sakura Sun Goldenrod Workcenter".to_string(); }
    if lower.contains("int_s4_dc_sasu") { return "Sakura Sun Workcenter".to_string(); }
    if lower.contains("int_s4_dc_cvlx") {
        // Covalex DC : extract S4DC-XX number
        if let Some(num) = extract_code_after(&lower, "_cvlx_s4dc") {
            return format!("Covalex S4DC-{}", num);
        }
        return "Covalex Distribution Centre".to_string();
    }
    if lower.contains("int_s4_dc_mite") || lower.contains("int_s4_ld_mite") {
        // microTech Logistics Depot S4LD-XX
        if let Some(num) = extract_code_after(&lower, "_mite_s4ld") {
            return format!("microTech Logistics Depot S4LD-{}", num);
        }
        return "microTech Logistics Depot".to_string();
    }
    if lower.starts_with("int_s4_dc_") || lower.starts_with("int_s4_ld_") {
        return "Distribution Center (microTech)".to_string();
    }
    // DC autres planètes
    if lower.contains("int_s1_dc_") || lower.contains("int_s1_ld_") { return "Distribution Center (Hurston)".to_string(); }
    if lower.contains("int_s2_dc_") || lower.contains("int_s2_ld_") { return "Distribution Center (Crusader)".to_string(); }
    if lower.contains("int_s3_dc_") || lower.contains("int_s3_ld_") { return "Distribution Center (ArcCorp)".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 5. ONYX FACILITIES (derelict abandoned research)
    // ═══════════════════════════════════════════════════════════════
    if lower.starts_with("layout_int_lab") || lower.contains("_int_lab_") {
        return "Onyx Facility (Lab)".to_string();
    }
    if lower.starts_with("layout_int_science") || lower.contains("_int_science_") {
        return "Onyx Facility (Science)".to_string();
    }
    if lower.starts_with("layout_int_") {
        return "Onyx Facility".to_string();
    }
    if lower.contains("derelict") || lower.contains("derlict") {
        return "Derelict (abandonné)".to_string();
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. COMM ARRAYS (util_dish_*)
    // ═══════════════════════════════════════════════════════════════
    if lower.starts_with("util_dish_") || lower.contains("commarray") || lower.contains("comm_array") {
        return "Comm Array".to_string();
    }
    if lower.starts_with("util_a_orbital_") {
        return "Station orbitale".to_string();
    }
    if lower.starts_with("util_") {
        return "Installation utilitaire".to_string();
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. PYRO — Contested Zones + Stations + Rest Stops
    // ═══════════════════════════════════════════════════════════════
    // Contested zones : pXlY_contestedzone
    if let Some(idx) = lower.find("contestedzone") {
        // Cherche le prefix pXlY juste avant
        let prefix = &lower[..idx];
        if let Some(p_idx) = prefix.rfind('p') {
            let after_p: String = prefix[p_idx + 1..].chars().take(3).collect();
            if !after_p.is_empty() {
                // p5l2 → "Pyro V-L2"
                let parsed = parse_pyro_lagrange(&after_p);
                if !parsed.is_empty() {
                    // Mappe vers le nom de la station si connu
                    let station = match parsed.as_str() {
                        "Pyro V-L1" => "Ruin Station",
                        "Pyro V-L2" => "Gaslight",
                        "Pyro V-L3" => "Endgame",
                        _ => "",
                    };
                    if !station.is_empty() {
                        return format!("Contested Zone · {} ({})", station, parsed);
                    }
                    return format!("Contested Zone ({})", parsed);
                }
            }
        }
        return "Contested Zone".to_string();
    }
    // Pyro Rest Stops : rs_int_pXlY
    if lower.starts_with("rs_int_p") {
        let after = &lower["rs_int_p".len()..];
        // Format pXleY ou pXlY
        let mut planet = String::new();
        let mut moon = String::new();
        let mut chars = after.chars();
        if let Some(c) = chars.next() { planet.push(c); }
        for c in chars {
            if c == 'l' { continue; }
            if c.is_ascii_alphanumeric() { moon.push(c); break; }
        }
        if !planet.is_empty() && !moon.is_empty() {
            let planet_roman = to_roman(planet.parse().unwrap_or(0));
            return format!("Rest Stop (Pyro {}-L{})", planet_roman, moon.to_uppercase());
        }
        return "Rest Stop (Pyro)".to_string();
    }
    // Stations Pyro nommées
    if lower.contains("ruin_station") || lower.contains("ruinstation") { return "Ruin Station".to_string(); }
    if lower.contains("gaslight") { return "Gaslight".to_string(); }
    if lower.contains("endgame") { return "Endgame".to_string(); }
    if lower.contains("starlight") { return "Starlight Service Station".to_string(); }
    if lower.contains("patch_city") || lower.contains("patchcity") { return "Patch City".to_string(); }
    if lower.contains("orbituary") { return "Orbituary".to_string(); }
    if lower.contains("megumi") { return "Megumi Refueling".to_string(); }
    if lower.contains("dudley") { return "Dudley & Daughters".to_string(); }
    if lower.contains("checkmate") { return "Checkmate Station".to_string(); }
    if lower.contains("shepherd") { return "Shepherd's Rest".to_string(); }
    if lower.contains("rod_thresh") || lower.contains("rods_thresh") || lower.contains("rod_fuel") { return "Rod's Fuel 'N Supplies".to_string(); }
    if lower.contains("rat_hole") || lower.contains("rathole") || lower.contains("rats_nest") { return "Rat's Nest".to_string(); }
    if lower.contains("bountiful_harvest") || lower.contains("bountiful") { return "Bountiful Harvest Hydroponics".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 8. PYRO planètes / lunes (avec index numérique pyro1..pyro6 + pyro5a..f)
    // ═══════════════════════════════════════════════════════════════
    // Lunes Pyro V : pyro5a, pyro5b, pyro5c, pyro5d, pyro5e, pyro5f
    if lower.starts_with("pyro5a") || lower == "pyro5a" { return "Ignis (Pyro V-a)".to_string(); }
    if lower.starts_with("pyro5b") || lower == "pyro5b" { return "Vatra (Pyro V-b)".to_string(); }
    if lower.starts_with("pyro5c") || lower == "pyro5c" { return "Adir (Pyro V-c)".to_string(); }
    if lower.starts_with("pyro5d") || lower == "pyro5d" { return "Fairo (Pyro V-d)".to_string(); }
    if lower.starts_with("pyro5e") || lower == "pyro5e" { return "Fuego (Pyro V-e)".to_string(); }
    if lower.starts_with("pyro5f") || lower == "pyro5f" { return "Vuur (Pyro V-f)".to_string(); }
    // Planètes Pyro
    if lower == "pyro1" || lower.starts_with("pyro1_") || lower.starts_with("pyro_i_") || lower == "pyro_i" { return "Pyro I".to_string(); }
    if lower == "pyro2" || lower.starts_with("pyro2_") || lower.starts_with("pyro_ii_") || lower == "pyro_ii" { return "Monox (Pyro II)".to_string(); }
    if lower == "pyro3" || lower.starts_with("pyro3_") || lower.starts_with("pyro_iii_") || lower == "pyro_iii" { return "Bloom (Pyro III)".to_string(); }
    if lower == "pyro4" || lower.starts_with("pyro4_") || lower.starts_with("pyro_iv_") || lower == "pyro_iv" { return "Pyro IV".to_string(); }
    if lower == "pyro5" || lower.starts_with("pyro5_") || lower.starts_with("pyro_v_") || lower == "pyro_v" { return "Pyro V".to_string(); }
    if lower == "pyro6" || lower.starts_with("pyro6_") || lower.starts_with("pyro_vi_") || lower == "pyro_vi" { return "Terminus (Pyro VI)".to_string(); }
    if lower.contains("pyro_belt") || lower.contains("pyrobelt") || lower.contains("pyro_asteroid") { return "Ceinture d'astéroïdes Pyro".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 9. STANTON planètes (index numérique stantonN + N_PlanetName)
    // ═══════════════════════════════════════════════════════════════
    if lower == "stanton1" || lower.starts_with("stanton1_") { return "Hurston".to_string(); }
    if lower == "stanton2" || lower.starts_with("stanton2_") { return "Crusader".to_string(); }
    if lower == "stanton3" || lower.starts_with("stanton3_") { return "ArcCorp".to_string(); }
    if lower == "stanton4" || lower.starts_with("stanton4_") { return "microTech".to_string(); }
    // Orbites : "4_Microtech", "3_Hurston", etc. (avec ou sans Aaron Halo)
    if lower.starts_with("4_microtech") || lower == "4 microtech" { return "Orbite microTech".to_string(); }
    if lower.starts_with("3_hurston") || lower == "3 hurston" { return "Orbite Hurston".to_string(); }
    if lower.starts_with("2_crusader") || lower == "2 crusader" { return "Orbite Crusader".to_string(); }
    if lower.starts_with("1_arccorp") || lower == "1 arccorp" || lower.starts_with("1_arcorp") { return "Orbite ArcCorp".to_string(); }
    // Lunes avec index (2a_yela, 2b_daymar, 2c_cellin, etc.)
    if lower.starts_with("2b_daymar") || lower.contains("2b_daymar") { return "Daymar".to_string(); }
    if lower.starts_with("2a_yela") || lower.contains("2a_yela") { return "Yela".to_string(); }
    if lower.starts_with("2c_cellin") || lower.contains("2c_cellin") { return "Cellin".to_string(); }
    if lower.starts_with("1a_aberdeen") { return "Aberdeen".to_string(); }
    if lower.starts_with("1b_arial") { return "Arial".to_string(); }
    if lower.starts_with("1c_magda") { return "Magda".to_string(); }
    if lower.starts_with("1d_ita") { return "Ita".to_string(); }
    if lower.starts_with("3a_lyria") { return "Lyria".to_string(); }
    if lower.starts_with("3b_wala") { return "Wala".to_string(); }
    if lower.starts_with("4a_calliope") { return "Calliope".to_string(); }
    if lower.starts_with("4b_clio") { return "Clio".to_string(); }
    if lower.starts_with("4c_euterpe") { return "Euterpe".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 10. STANTON — Rest Stops (LOC_RR / RS_Ext / RestStop / Lagrange)
    // ═══════════════════════════════════════════════════════════════
    if lower.starts_with("loc_rr_") || lower.starts_with("rs_ext_") || lower == "reststop" || lower.starts_with("reststop_") {
        return "Rest Stop".to_string();
    }
    // Lagrange Rest Stops (HUR-L1..L5, CRU-L1..L5, ARC-L1..L5, MIC-L1..L5)
    if lower.contains("hur_l1") || lower.contains("hur-l1") { return "HUR-L1 Green Glade".to_string(); }
    if lower.contains("hur_l2") || lower.contains("hur-l2") { return "HUR-L2 Faithful Dream".to_string(); }
    if lower.contains("hur_l3") || lower.contains("hur-l3") { return "HUR-L3 Thundering Express".to_string(); }
    if lower.contains("hur_l4") || lower.contains("hur-l4") { return "HUR-L4 Melodic Fields".to_string(); }
    if lower.contains("hur_l5") || lower.contains("hur-l5") { return "HUR-L5 High Course".to_string(); }
    if lower.contains("cru_l1") || lower.contains("cru-l1") || lower.contains("crl1") { return "CRU-L1 Ambitious Dream".to_string(); }
    if lower.contains("cru_l4") || lower.contains("cru-l4") { return "CRU-L4 Shallow Frontier".to_string(); }
    if lower.contains("cru_l5") || lower.contains("cru-l5") { return "CRU-L5 Beautiful Glen".to_string(); }
    if lower.contains("arc_l1") || lower.contains("arc-l1") { return "ARC-L1 Wide Forest".to_string(); }
    if lower.contains("arc_l2") || lower.contains("arc-l2") { return "ARC-L2 Lively Pathway".to_string(); }
    if lower.contains("arc_l3") || lower.contains("arc-l3") { return "ARC-L3 Modern Express".to_string(); }
    if lower.contains("arc_l4") || lower.contains("arc-l4") { return "ARC-L4 Faint Glen".to_string(); }
    if lower.contains("arc_l5") || lower.contains("arc-l5") { return "ARC-L5 Yellow Core".to_string(); }
    if lower.contains("mic_l1") || lower.contains("mic-l1") { return "MIC-L1 Shallow Fields".to_string(); }
    if lower.contains("mic_l2") || lower.contains("mic-l2") { return "MIC-L2 Long Forest".to_string(); }
    if lower.contains("mic_l3") || lower.contains("mic-l3") { return "MIC-L3 Endless Odyssey".to_string(); }
    if lower.contains("mic_l4") || lower.contains("mic-l4") { return "MIC-L4 Red Crossroads".to_string(); }
    if lower.contains("mic_l5") || lower.contains("mic-l5") { return "MIC-L5 Modern Icarus".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 11. STANTON — Stations / Hubs / Ceintures (par nom)
    // ═══════════════════════════════════════════════════════════════
    if lower.contains("lorville") { return "Lorville".to_string(); }
    if lower.contains("area18") || lower.contains("area_18") { return "Area18".to_string(); }
    if lower.contains("orison") { return "Orison".to_string(); }
    if lower.contains("new_babbage") || lower.contains("newbabbage") { return "New Babbage".to_string(); }
    if lower.contains("grimhex") || lower.contains("grim_hex") { return "GrimHEX".to_string(); }
    if lower.contains("port_olisar") || lower.contains("olisar") { return "Port Olisar".to_string(); }
    if lower.contains("everus") { return "Everus Harbor".to_string(); }
    if lower.contains("baijini") { return "Baijini Point".to_string(); }
    if lower.contains("port_tressler") || lower.contains("tressler") { return "Port Tressler".to_string(); }
    if lower.contains("seraphim") { return "Seraphim Station".to_string(); }
    if lower.contains("aaron_halo") || lower.contains("aaronhalo") { return "Aaron Halo".to_string(); }
    if lower.contains("checkmate") { return "Checkmate".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 12. STANTON — Lunes (par nom direct)
    // ═══════════════════════════════════════════════════════════════
    if lower.starts_with("hurston") { return "Hurston".to_string(); }
    if lower.starts_with("arccorp") || lower.starts_with("arcorp") { return "ArcCorp".to_string(); }
    if lower.starts_with("microtech") { return "microTech".to_string(); }
    if lower.starts_with("crusader") { return "Crusader".to_string(); }
    if lower.starts_with("daymar") { return "Daymar".to_string(); }
    if lower.starts_with("yela") { return "Yela".to_string(); }
    if lower.starts_with("cellin") { return "Cellin".to_string(); }
    if lower.starts_with("wala") { return "Wala".to_string(); }
    if lower.starts_with("lyria") { return "Lyria".to_string(); }
    if lower.starts_with("aberdeen") { return "Aberdeen".to_string(); }
    if lower.starts_with("arial") { return "Arial".to_string(); }
    if lower.starts_with("magda") { return "Magda".to_string(); }
    if lower.starts_with("ita") { return "Ita".to_string(); }
    if lower.starts_with("calliope") { return "Calliope".to_string(); }
    if lower.starts_with("clio") { return "Clio".to_string(); }
    if lower.starts_with("euterpe") { return "Euterpe".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 13. NYX — Planètes / Delamar / Levski
    // ═══════════════════════════════════════════════════════════════
    if lower.contains("levski") { return "Levski".to_string(); }
    if lower.contains("delamar") { return "Delamar".to_string(); }
    if lower.contains("glaciem") { return "Ceinture Glaciem".to_string(); }
    if lower.contains("keeger") { return "Ceinture Keeger".to_string(); }
    if lower == "nyx1" || lower.starts_with("nyx1_") || lower == "nyx_i" { return "Nyx I".to_string(); }
    if lower == "nyx2" || lower.starts_with("nyx2_") || lower == "nyx_ii" { return "Nyx II".to_string(); }
    if lower == "nyx3" || lower.starts_with("nyx3_") || lower == "nyx_iii" { return "Nyx III".to_string(); }

    // ═══════════════════════════════════════════════════════════════
    // 14. SYSTÈMES (nom solo = nom système)
    // ═══════════════════════════════════════════════════════════════
    match lower.as_str() {
        "stanton" => return "Stanton".to_string(),
        "pyro" => return "Pyro".to_string(),
        "nyx" => return "Nyx".to_string(),
        "castra" => return "Castra".to_string(),
        "terra" => return "Terra".to_string(),
        _ => {}
    }

    // ═══════════════════════════════════════════════════════════════
    // 15. FALLBACK — vaisseau ou nom générique
    // ═══════════════════════════════════════════════════════════════
    // Si manufacturer code en début (AEGS_, ANVL_, etc.) → garde tel quel
    let manufacturers = ["AEGS_","ANVL_","ARGO_","BANU_","CNOU_","CRUS_","DRAK_","ESPR_","GAMA_","GRIN_","KRIG_","MISC_","MRAI_","ORIG_","RSI_","TMBL_","VNCL_","XIAN_","XNAA_"];
    if manufacturers.iter().any(|m| r.starts_with(m)) {
        return r.to_string();
    }

    // Fallback : split _, Title Case
    title_case(r)
}

/// Title case un string en splittant sur '_' et '-'.
/// Ex: "foo_bar-baz" → "Foo Bar Baz"
fn title_case(s: &str) -> String {
    s.split(|c: char| c == '_' || c == '-')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let mut chars = p.chars();
            match chars.next() {
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extrait le code numérique/alphanumérique après un pattern donné.
/// Ex: extract_code_after("foo_mite_s4ld13_xxx", "_mite_s4ld") → "13"
fn extract_code_after(s: &str, pattern: &str) -> Option<String> {
    let idx = s.find(pattern)?;
    let rest = &s[idx + pattern.len()..];
    let code: String = rest.chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if code.is_empty() { None } else { Some(code) }
}

/// Parse "5l2" → "Pyro V-L2", "3l1" → "Pyro III-L1"
fn parse_pyro_lagrange(s: &str) -> String {
    let mut chars = s.chars();
    let planet_num = chars.next().and_then(|c| c.to_digit(10));
    let _l = chars.next(); // 'l'
    let lagrange_num = chars.next().and_then(|c| c.to_digit(10));
    match (planet_num, lagrange_num) {
        (Some(p), Some(l)) => format!("Pyro {}-L{}", to_roman(p), l),
        _ => String::new(),
    }
}

/// Convertit un nombre 1-9 en chiffres romains.
fn to_roman(n: u32) -> &'static str {
    match n {
        1 => "I", 2 => "II", 3 => "III", 4 => "IV", 5 => "V",
        6 => "VI", 7 => "VII", 8 => "VIII", 9 => "IX",
        _ => "?"
    }
}

fn friendly_cause(raw: &str) -> &str {
    match raw {
        // Combat
        "Bullet" => "Tué par balle",
        "Combat" => "Combat",
        "Explosion" => "Explosion",
        "Fire" | "Burn" => "Brûlure",
        // Vaisseau
        "VehicleDestruction" => "Vaisseau détruit",
        "Crash" => "Crash vaisseau",
        "Collision" => "Collision",
        "SelfDestruct" => "Autodestruction",
        // Environnement
        "ElectricArc" | "Electricity" => "Arc électrique",
        "Hazard" => "Environnement",
        "Acid" => "Acide (Pyro)",
        "Suffocation" | "Asphyxiation" => "Suffocation",
        "Fall" => "Chute libre",
        "Stamina" => "Épuisement",
        "Drowning" => "Noyade",
        "Radiation" => "Radiation",
        "Temperature" => "Choc thermique",
        // Sortie de zone
        "BoundaryViolation" => "Hors-zone",
        // Bleed
        "BleedOut" => "Hémorragie",
        // Suicide
        "Suicide" => "Suicide",
        // Inconnu
        _ => "Autre",
    }
}

fn cause_icon(raw: &str) -> &str {
    match raw {
        "Bullet" | "Combat" => "crosshair",
        "Explosion" => "alert-triangle",
        "Fire" | "Burn" => "flame",
        "VehicleDestruction" | "Crash" | "Collision" => "alert-triangle",
        "Suicide" | "SelfDestruct" => "zap",
        "ElectricArc" | "Electricity" => "zap",
        "Hazard" => "flame",
        "Acid" => "flame",
        "Suffocation" | "Asphyxiation" => "trending-down",
        "Fall" => "trending-down",
        "Stamina" => "trending-down",
        "Drowning" => "trending-down",
        "Radiation" => "flame",
        "Temperature" => "flame",
        "BoundaryViolation" => "alert-triangle",
        "BleedOut" => "trending-down",
        _ => "skull",
    }
}

fn compute_longest_streak(sessions: &[(f64, Option<f64>)]) -> u32 {
    // Jours en index LOCAL (DST-safe) — même logique de frontières que la streak
    // courante / la heatmap, sinon le record diverge des jours affichés.
    let mut days: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (s, _) in sessions {
        days.insert(local_day_index(*s as i64));
    }
    let mut sorted: Vec<_> = days.into_iter().collect();
    sorted.sort();
    let mut max_streak = 1u32;
    let mut cur = 1u32;
    for w in sorted.windows(2) {
        if w[1] - w[0] == 1 { cur += 1; max_streak = max_streak.max(cur); }
        else { cur = 1; }
    }
    max_streak
}

fn compute_max_kills_per_session(
    sessions: &[(f64, Option<f64>)],
    events: &[GameEvent],
    moniker: &str,
    // GEID entité local résolu (SetDriver). Ancre les kills sur le GEID du tueur
    // (≠ collision de pseudo). Fallback nominal sur `moniker` si None ou GEID nul.
    local_geid: Option<u64>,
) -> u32 {
    let is_local_killer = |killer_geid: u64, killer: &str| -> bool {
        match local_geid {
            Some(g) if killer_geid != 0 => killer_geid == g,
            _ => killer == moniker,
        }
    };
    let mut max_k = 0u32;
    for (s, e) in sessions {
        let end = e.unwrap_or(s + 86400.0);
        let mut k = 0u32;
        for ev in events {
            let ts = event_ts(ev);
            if ts < *s || ts > end { continue; }
            if let GameEvent::ActorDeath { killer, killer_geid, is_suicide, .. } = ev {
                if is_local_killer(*killer_geid, killer) && !is_suicide { k += 1; }
            }
        }
        max_k = max_k.max(k);
    }
    max_k
}

/// Dérive le label dominant depuis le breakdown calculé (% par catégorie).
/// On regarde quelles catégories dépassent 25% pour générer un label
/// composé (ex "Combat · Explorateur" si 40% combat + 30% explo).
fn infer_dominant_profile_from_breakdown(breakdown: &[serde_json::Value]) -> &'static str {
    if breakdown.is_empty() {
        return "—";
    }
    let mut percents: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for b in breakdown {
        let cat = b.get("category").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let pct = b.get("percent").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        percents.insert(cat, pct);
    }
    let combat = percents.get("Combat").copied().unwrap_or(0);
    let cargo = percents.get("Cargo / Trade").copied().unwrap_or(0);
    let mining = percents.get("Mining").copied().unwrap_or(0);
    let explo = percents.get("Exploration").copied().unwrap_or(0);

    // Identifie la catégorie dominante puis nuance avec une 2e si elle est forte
    let mut sorted = vec![
        ("Combat", combat),
        ("Cargo", cargo),
        ("Mining", mining),
        ("Explo", explo),
    ];
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    let (top, top_pct) = sorted[0];
    let (snd, snd_pct) = sorted[1];

    if top_pct < 20 { return "Polyvalent"; }

    // Combo : si la 2e catégorie est ≥ 20% on fait un label composé
    let combo = snd_pct >= 20;
    match (top, combo, snd) {
        ("Combat", true, "Cargo") => "Combat · Hauler",
        ("Combat", true, "Explo") => "Combat · Explorateur",
        ("Combat", true, "Mining") => "Combat · Mineur",
        ("Combat", _, _) => "Combattant · PVP",
        ("Cargo", true, "Combat") => "Hauler · PVP",
        ("Cargo", true, "Mining") => "Hauler · Mineur",
        ("Cargo", _, _) => "Cargo · Hauler",
        ("Mining", true, "Cargo") => "Mineur · Hauler",
        ("Mining", _, _) => "Mineur · Industriel",
        ("Explo", true, "Combat") => "Explorateur · PVP",
        ("Explo", _, _) => "Explorateur",
        _ => "Polyvalent",
    }
}

/// Nettoie un texte d'objectif pour affichage UI.
/// - Strip ponctuation finale (": ", "...", "…")
/// - Capitalise la 1ère lettre
fn prettify_objective_text(raw: &str) -> String {
    let trimmed = raw.trim()
        .trim_end_matches(|c: char| matches!(c, ':' | '.' | '!' | ' ' | '…'))
        .to_string();
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Nombre de zones DISTINCTES où le joueur LOCAL est mort (= zones visitées
/// inférées des morts). Ancré sur l'identité locale : on ne compte la zone d'un
/// `ActorDeath` que si la VICTIME est le joueur local (GEID prioritaire, fallback
/// nominal sur `moniker`). Sans aucune ancre exploitable (pas de GEID résolu ET
/// `moniker` vide → très vieux log), on retombe sur le comportement legacy
/// (toutes les morts comptent) pour ne pas régresser à 0.
fn zone_count_total(events: &[GameEvent], local_geid: Option<u64>, moniker: &str) -> usize {
    let anchor_active = local_geid.is_some() || !moniker.is_empty();
    let mut set = std::collections::HashSet::new();
    for ev in events {
        match ev {
            GameEvent::ActorDeath { zone, victim, victim_geid, .. } => {
                let is_local = match local_geid {
                    Some(g) if *victim_geid != 0 => *victim_geid == g,
                    _ => victim == moniker,
                };
                if anchor_active && !is_local { continue; }
                let z = clean_zone_name(zone);
                if !z.is_empty() { set.insert(z); }
            }
            // Destinations de saut QT (event LOCAL garanti via `- Local`) : lieux
            // (re)joints par le joueur. Avant, le compte ne venait QUE des morts →
            // « 0 lieu visité » pour qui meurt peu (bug Artics mineur/hauler).
            GameEvent::QuantumSelected { destination, .. } => {
                let z = prettify_zone_sc(destination);
                if !z.is_empty() { set.insert(z); }
            }
            _ => {}
        }
    }
    set.len()
}

/// Catégorise un vaisseau (canonical name) en activité dominante.
/// Stratégie : 1) lookup catalog Fleetyards (universel, à jour) ;
/// 2) fallback heuristique hardcoded (utile offline / vaisseaux récents).
fn vehicle_category(name: &str) -> &'static str {
    // 1. Lookup via Fleetyards catalog
    if let Some(catalog) = crate::scripts::ship_catalog_cache::get_catalog() {
        if let Some(role) = catalog.role(name) {
            use crate::scripts::ship_catalog_cache::ShipRole;
            return match role {
                ShipRole::Combat | ShipRole::Ground => "Combat",
                ShipRole::Mining => "Mining",
                ShipRole::Salvage => "Cargo / Trade", // pas de catégorie dédiée actuellement
                ShipRole::Cargo | ShipRole::Industrial => "Cargo / Trade",
                ShipRole::Exploration => "Exploration",
                ShipRole::Medical | ShipRole::Refuel
                | ShipRole::Racing | ShipRole::Touring
                | ShipRole::Multi | ShipRole::Other => "Autre",
            };
        }
    }
    // 2. Fallback heuristique hardcoded
    vehicle_category_fallback(name)
}

fn vehicle_category_fallback(name: &str) -> &'static str {
    let n = name.to_lowercase();
    // Mining
    if n.contains("mole") || n.contains("prospector") || n.contains("roc")
        || n.contains("orion") || n.contains("argo_mole") {
        return "Mining";
    }
    // Cargo / Trade (incl. capital cargo / hauler)
    if n.contains("hull") || n.contains("hercules") || n.contains("caterpillar")
        || n.contains("freelancer") || n.contains("c2") || n.contains("a2") || n.contains("m2")
        || n.contains("starlancer") || n.contains("starrunner") || n.contains("cutlass_black")
        || n.contains("nomad") || n.contains("expanse") || n.contains("mercury")
        || n.contains("ironclad") && !n.contains("ironclad_assault") {
        return "Cargo / Trade";
    }
    // Combat / PVP — fighters + gunships + capital combat
    if n.contains("gladius") || n.contains("hornet") || n.contains("sabre") || n.contains("arrow")
        || n.contains("vanguard") || n.contains("eclipse") || n.contains("ares")
        || n.contains("scorpius") || n.contains("retaliator") || n.contains("gladiator")
        || n.contains("buccaneer") || n.contains("mustang_delta") || n.contains("blade")
        || n.contains("hurricane") || n.contains("talon") || n.contains("f7c") || n.contains("f8")
        || n.contains("perseus") || n.contains("polaris") || n.contains("idris")
        || n.contains("javelin") || n.contains("ironclad_assault") || n.contains("redeemer")
        || n.contains("tana") || n.contains("guardian") {
        return "Combat";
    }
    // Exploration (incl. capital explo)
    if n.contains("carrack") || n.contains("600i") || n.contains("constellation_andromeda")
        || n.contains("terrapin") || n.contains("aurora_es") || n.contains("dur")
        || n.contains("asgard") || n.contains("pioneer") || n.contains("odyssey")
        || n.contains("rambler") {
        return "Exploration";
    }
    // Medical / Recovery / Reclaimer / Misc utility → Autre
    if n.contains("cutlass_red") || n.contains("apollo") || n.contains("medivac")
        || n.contains("reclaimer") || n.contains("vulcan") || n.contains("crucible") {
        return "Autre";
    }
    // Reste : polyvalent
    "Autre"
}

/// Calcule le breakdown du profil joueur (% par catégorie d'activité) à
/// partir des vehicle_hits ET des missions complétées (mining/salvage/
/// bounty/cargo). Retourne un Vec de JSON pour serde.
///
/// Pondération : 1 vehicle_hit = 1 point. 1 mission_complete = 8 points
/// (équivaut grosso modo à 4h de pilotage du vaisseau correspondant).
fn compute_profile_breakdown(
    vehicle_hits: &std::collections::HashMap<String, usize>,
    mining_missions: u32,
    salvage_missions: u32,
    bounty_missions: u32,
    cargo_missions: u32,
) -> Vec<serde_json::Value> {
    use std::collections::HashMap as Map;
    let mut by_cat: Map<&'static str, usize> = Map::new();
    for (name, hits) in vehicle_hits {
        *by_cat.entry(vehicle_category(name)).or_insert(0) += hits;
    }
    // Inject mission weights
    const MISSION_WEIGHT: usize = 8;
    *by_cat.entry("Mining").or_insert(0) += (mining_missions as usize) * MISSION_WEIGHT;
    *by_cat.entry("Cargo / Trade").or_insert(0) += (salvage_missions as usize) * MISSION_WEIGHT;
    *by_cat.entry("Cargo / Trade").or_insert(0) += (cargo_missions as usize) * MISSION_WEIGHT;
    *by_cat.entry("Combat").or_insert(0) += (bounty_missions as usize) * MISSION_WEIGHT;
    let total: usize = by_cat.values().sum();
    if total == 0 {
        // Pas assez d'activité classable → liste vide (l'UI affiche un état
        // honnête au lieu de barres 25/25/25/25 bidon).
        return Vec::new();
    }
    let categories = [
        ("Mining", "pickaxe", "amber"),
        ("Cargo / Trade", "package", "sky"),
        ("Combat", "crosshair", "rose"),
        ("Exploration", "compass", "emerald"),
        ("Autre", "more-horizontal", "zinc"),
    ];
    let mut out = Vec::new();
    let mut acc = 0u32;
    let last = categories.len() - 1;
    for (i, (cat, icon, color)) in categories.iter().enumerate() {
        let raw = by_cat.get(cat).copied().unwrap_or(0);
        let mut pct = ((raw as f64 / total as f64) * 100.0).round() as u32;
        if i == last { pct = 100u32.saturating_sub(acc); } // force somme = 100
        else { acc += pct; }
        out.push(serde_json::json!({
            "category": cat,
            "percent": pct,
            "icon": icon,
            "color": color,
        }));
    }
    out
}

/// Calcule les achievements en fonction des stats parsées. Les conditions
/// sont volontairement réalistes (alignées avec ce qu'on peut détecter
/// dans les Game.log SC 4.x). 20+ trophées variés (temps, exploration,
/// combat, style de vie, vaisseaux).
#[allow(clippy::too_many_arguments)]
fn build_achievements(
    total_hours: u64,
    kills_pvp: usize,
    kills_pve: u32,
    qt_jumps: u32,
    patches_count: u32,
    has_pyro: bool,
    systems_visited_count: u32,
    first_session_ts: Option<f64>,
    total_kills: usize,
    longest_session_min: u32,
    unique_vehicles: u32,
    unique_zones: u32,
    fastest_qt_sec: u32,
    longest_streak_days: u32,
    electric_arc_deaths: u32,
    latest_night_hour: u32,
    first_patch_major: u32,
    session_count: u32,
    max_kills_session: u32,
    mining_missions_complete: u32,
    salvage_missions_complete: u32,
    bounty_missions_complete: u32,
    cargo_missions_complete: u32,
    total_missions_complete: u32,
    // Ratio K/D pré-calculé (source de vérité UNIQUE, partagée avec combat.ratio).
    // `None` ⇒ 0 mort enregistrée → « Iron Will » ne peut pas être validé ni
    // afficher de ratio (plus de recalcul divergent avec `.max(1)`).
    kd_ratio: Option<f64>,
) -> Vec<serde_json::Value> {
    // Date calendaire LOCALE (« premier vol le … » en heure murale du joueur).
    let first_flight_date = first_session_ts
        .and_then(|ts| local_dt(ts as i64))
        .map(|d| d.format("%Y-%m-%d").to_string());

    let mut items = Vec::new();

    // ═══ TEMPS DE JEU ═══════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "first-flight",
        "label": "Premier vol",
        "unlocked": first_flight_date.is_some(),
        "unlockedDate": first_flight_date,
        "description": "Décolle pour ta toute première session SC",
        "color": "emerald",
        "icon": "rocket",
    }));
    items.push(serde_json::json!({
        "id": "100h-citizen",
        "label": "100h Citizen",
        "unlocked": total_hours >= 100,
        "progress": if total_hours < 100 { Some(serde_json::json!({ "current": total_hours, "target": 100 })) } else { None },
        "description": format!("{}h / 100h cumulées", total_hours),
        "color": "cyan",
        "icon": "globe",
    }));
    items.push(serde_json::json!({
        "id": "500h-veteran",
        "label": "Vétéran 500h",
        "unlocked": total_hours >= 500,
        "progress": if total_hours < 500 { Some(serde_json::json!({ "current": total_hours, "target": 500 })) } else { None },
        "description": format!("{}h / 500h cumulées", total_hours),
        "color": "cyan",
        "icon": "globe",
    }));
    items.push(serde_json::json!({
        "id": "1000h-legend",
        "label": "Légende 1000h",
        "unlocked": total_hours >= 1000,
        "progress": if total_hours < 1000 { Some(serde_json::json!({ "current": total_hours, "target": 1000 })) } else { None },
        "description": format!("{}h / 1000h cumulées", total_hours),
        "color": "violet",
        "icon": "award",
    }));

    // ═══ QUANTUM ════════════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "100-quantum-jumps",
        "label": "100 quantum jumps",
        "unlocked": qt_jumps >= 100,
        "progress": if qt_jumps < 100 { Some(serde_json::json!({ "current": qt_jumps, "target": 100 })) } else { None },
        "description": format!("{} / 100 sauts effectués", qt_jumps),
        "color": "violet",
        "icon": "zap",
    }));
    items.push(serde_json::json!({
        "id": "500-quantum-jumps",
        "label": "Maître Quantum",
        "unlocked": qt_jumps >= 500,
        "progress": if qt_jumps < 500 { Some(serde_json::json!({ "current": qt_jumps, "target": 500 })) } else { None },
        "description": format!("{} / 500 quantum jumps", qt_jumps),
        "color": "violet",
        "icon": "zap",
    }));
    items.push(serde_json::json!({
        "id": "speed-demon-qt",
        "label": "Speed Demon",
        "unlocked": fastest_qt_sec > 0 && fastest_qt_sec < 30,
        "description": if fastest_qt_sec > 0 { format!("Record : {}s (objectif < 30s)", fastest_qt_sec) } else { "Aucun jump enregistré".to_string() },
        "color": "violet",
        "icon": "zap",
    }));

    // ═══ EXPLORATION ════════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "pyro-walker",
        "label": "Marcheur de Pyro",
        "unlocked": has_pyro,
        "description": if has_pyro { "Premier voyage hors Stanton".to_string() } else { "Voyage hors Stanton requis".to_string() },
        "color": "orange",
        "icon": "flame",
    }));
    items.push(serde_json::json!({
        "id": "multi-system",
        "label": "Multi-systèmes",
        "unlocked": systems_visited_count >= 2,
        "description": format!("{} système{} visité{}", systems_visited_count, if systems_visited_count > 1 { "s" } else { "" }, if systems_visited_count > 1 { "s" } else { "" }),
        "color": "emerald",
        "icon": "compass",
    }));
    items.push(serde_json::json!({
        "id": "cartographer-50",
        "label": "Cartographe",
        "unlocked": unique_zones >= 50,
        "progress": if unique_zones < 50 { Some(serde_json::json!({ "current": unique_zones, "target": 50 })) } else { None },
        "description": format!("{} / 50 zones distinctes visitées", unique_zones),
        "color": "emerald",
        "icon": "compass",
    }));
    items.push(serde_json::json!({
        "id": "globe-trotter-150",
        "label": "Globe-trotter",
        "unlocked": unique_zones >= 150,
        "progress": if unique_zones < 150 { Some(serde_json::json!({ "current": unique_zones, "target": 150 })) } else { None },
        "description": format!("{} / 150 zones cumulées", unique_zones),
        "color": "emerald",
        "icon": "compass",
    }));

    // ═══ VAISSEAUX ══════════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "pilot-multi-class",
        "label": "Pilote multi-classe",
        "unlocked": unique_vehicles >= 10,
        "progress": if unique_vehicles < 10 { Some(serde_json::json!({ "current": unique_vehicles, "target": 10 })) } else { None },
        "description": format!("{} / 10 vaisseaux différents pilotés", unique_vehicles),
        "color": "cyan",
        "icon": "rocket",
    }));
    items.push(serde_json::json!({
        "id": "collector-25-ships",
        "label": "Collectionneur",
        "unlocked": unique_vehicles >= 25,
        "progress": if unique_vehicles < 25 { Some(serde_json::json!({ "current": unique_vehicles, "target": 25 })) } else { None },
        "description": format!("{} / 25 vaisseaux différents", unique_vehicles),
        "color": "amber",
        "icon": "rocket",
    }));

    // ═══ COMBAT ═════════════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "first-pvp-kill",
        "label": "Premier kill PVP",
        "unlocked": kills_pvp >= 1,
        "description": if kills_pvp >= 1 { format!("{} kills PVP cumulés", kills_pvp) } else { "Aucun kill PVP".to_string() },
        "color": "rose",
        "icon": "crosshair",
    }));
    items.push(serde_json::json!({
        "id": "centurion",
        "label": "Centurion",
        "unlocked": total_kills >= 100,
        "progress": if total_kills < 100 { Some(serde_json::json!({ "current": total_kills, "target": 100 })) } else { None },
        "description": format!("{} / 100 éliminations totales", total_kills),
        "color": "rose",
        "icon": "crosshair",
    }));
    items.push(serde_json::json!({
        "id": "exterminator",
        "label": "Exterminateur",
        "unlocked": kills_pve >= 1000,
        "progress": if kills_pve < 1000 { Some(serde_json::json!({ "current": kills_pve, "target": 1000 })) } else { None },
        "description": format!("{} / 1000 kills PVE", kills_pve),
        "color": "rose",
        "icon": "crosshair",
    }));
    items.push(serde_json::json!({
        "id": "pvp-legend",
        "label": "Légende PVP",
        "unlocked": kills_pvp >= 500,
        "progress": if kills_pvp < 500 { Some(serde_json::json!({ "current": kills_pvp, "target": 500 })) } else { None },
        "description": format!("{} / 500 kills PVP cumulés", kills_pvp),
        "color": "rose",
        "icon": "crosshair",
    }));
    items.push(serde_json::json!({
        "id": "carnage-session",
        "label": "Carnage",
        "unlocked": max_kills_session >= 20,
        "progress": if max_kills_session < 20 { Some(serde_json::json!({ "current": max_kills_session, "target": 20 })) } else { None },
        "description": format!("Record : {} kills en une session (obj. 20)", max_kills_session),
        "color": "rose",
        "icon": "swords",
    }));

    // ═══ STYLE DE VIE ═══════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "marathon",
        "label": "Marathon",
        "unlocked": longest_session_min >= 480,
        "progress": if longest_session_min < 480 { Some(serde_json::json!({ "current": longest_session_min, "target": 480 })) } else { None },
        "description": format!("Record {}h{:02} / Objectif 8h+", longest_session_min / 60, longest_session_min % 60),
        "color": "amber",
        "icon": "hourglass",
    }));
    items.push(serde_json::json!({
        "id": "iron-man",
        "label": "Iron Man",
        "unlocked": longest_session_min >= 720,
        "progress": if longest_session_min < 720 { Some(serde_json::json!({ "current": longest_session_min, "target": 720 })) } else { None },
        "description": format!("Record {}h{:02} / Objectif 12h+", longest_session_min / 60, longest_session_min % 60),
        "color": "amber",
        "icon": "hourglass",
    }));
    items.push(serde_json::json!({
        "id": "night-owl",
        "label": "Couche-tard",
        "unlocked": latest_night_hour >= 4 && latest_night_hour < 6,
        "description": if latest_night_hour > 0 { format!("Heure tardive : {:02}h", latest_night_hour) } else { "Jamais joué entre 4h et 6h".to_string() },
        "color": "violet",
        "icon": "moon",
    }));
    items.push(serde_json::json!({
        "id": "streak-week",
        "label": "Régulier",
        "unlocked": longest_streak_days >= 7,
        "progress": if longest_streak_days < 7 { Some(serde_json::json!({ "current": longest_streak_days, "target": 7 })) } else { None },
        "description": format!("{} jours d'affilée record (obj. 7)", longest_streak_days),
        "color": "amber",
        "icon": "flame",
    }));
    items.push(serde_json::json!({
        "id": "streak-month",
        "label": "Acharné",
        "unlocked": longest_streak_days >= 30,
        "progress": if longest_streak_days < 30 { Some(serde_json::json!({ "current": longest_streak_days, "target": 30 })) } else { None },
        "description": format!("{} jours d'affilée record (obj. 30)", longest_streak_days),
        "color": "orange",
        "icon": "flame",
    }));
    items.push(serde_json::json!({
        "id": "regular-100-sessions",
        "label": "Habitué",
        "unlocked": session_count >= 100,
        "progress": if session_count < 100 { Some(serde_json::json!({ "current": session_count, "target": 100 })) } else { None },
        "description": format!("{} / 100 sessions de jeu", session_count),
        "color": "cyan",
        "icon": "calendar-days",
    }));

    // ═══ PATCHES (historique) ═══════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "veteran-patches",
        "label": format!("Vétéran de {} patches", patches_count.max(1)),
        "unlocked": patches_count >= 3,
        "description": format!("{} versions SC traversées", patches_count),
        "color": "amber",
        "icon": "award",
    }));
    items.push(serde_json::json!({
        "id": "pioneer",
        "label": "Pionnier",
        "unlocked": first_patch_major <= 3,
        "description": if first_patch_major <= 3 { format!("Joue depuis SC {}.x", first_patch_major) } else { "Réservé aux joueurs SC 3.x ou avant".to_string() },
        "color": "amber",
        "icon": "trophy",
    }));

    // ═══ MÉTIERS / PROFESSIONS (missions) ═══════════════════════════════
    items.push(serde_json::json!({
        "id": "first-mining-mission",
        "label": "Premier coup de pioche",
        "unlocked": mining_missions_complete >= 1,
        "description": if mining_missions_complete >= 1 {
            format!("{} mission(s) mining complétée(s)", mining_missions_complete)
        } else {
            "Aucune mission mining détectée".to_string()
        },
        "color": "amber",
        "icon": "pickaxe",
    }));
    items.push(serde_json::json!({
        "id": "miner-confirmed",
        "label": "Mineur confirmé",
        "unlocked": mining_missions_complete >= 25,
        "progress": if mining_missions_complete < 25 { Some(serde_json::json!({ "current": mining_missions_complete, "target": 25 })) } else { None },
        "description": format!("{} / 25 missions mining complétées", mining_missions_complete),
        "color": "amber",
        "icon": "pickaxe",
    }));
    items.push(serde_json::json!({
        "id": "master-miner",
        "label": "Maître mineur",
        "unlocked": mining_missions_complete >= 100,
        "progress": if mining_missions_complete < 100 { Some(serde_json::json!({ "current": mining_missions_complete, "target": 100 })) } else { None },
        "description": format!("{} / 100 missions mining complétées", mining_missions_complete),
        "color": "violet",
        "icon": "pickaxe",
    }));
    items.push(serde_json::json!({
        "id": "salvager",
        "label": "Charognard",
        "unlocked": salvage_missions_complete >= 5,
        "progress": if salvage_missions_complete < 5 { Some(serde_json::json!({ "current": salvage_missions_complete, "target": 5 })) } else { None },
        "description": format!("{} / 5 missions salvage", salvage_missions_complete),
        "color": "emerald",
        "icon": "package",
    }));
    items.push(serde_json::json!({
        "id": "bounty-hunter",
        "label": "Chasseur de prime",
        "unlocked": bounty_missions_complete >= 10,
        "progress": if bounty_missions_complete < 10 { Some(serde_json::json!({ "current": bounty_missions_complete, "target": 10 })) } else { None },
        "description": format!("{} / 10 contrats bounty exécutés", bounty_missions_complete),
        "color": "rose",
        "icon": "crosshair",
    }));
    items.push(serde_json::json!({
        "id": "trader-cargo",
        "label": "Convoyeur",
        "unlocked": cargo_missions_complete >= 10,
        "progress": if cargo_missions_complete < 10 { Some(serde_json::json!({ "current": cargo_missions_complete, "target": 10 })) } else { None },
        "description": format!("{} / 10 livraisons cargo", cargo_missions_complete),
        "color": "cyan",
        "icon": "package",
    }));
    // Paliers totaux (toutes missions confondues, langue-agnostique)
    items.push(serde_json::json!({
        "id": "mission-50",
        "label": "Contractuel",
        "unlocked": total_missions_complete >= 50,
        "progress": if total_missions_complete < 50 { Some(serde_json::json!({ "current": total_missions_complete, "target": 50 })) } else { None },
        "description": format!("{} / 50 missions complétées (tous types)", total_missions_complete),
        "color": "cyan",
        "icon": "award",
    }));
    items.push(serde_json::json!({
        "id": "mission-250",
        "label": "Pro du contrat",
        "unlocked": total_missions_complete >= 250,
        "progress": if total_missions_complete < 250 { Some(serde_json::json!({ "current": total_missions_complete, "target": 250 })) } else { None },
        "description": format!("{} / 250 missions complétées (tous types)", total_missions_complete),
        "color": "violet",
        "icon": "trophy",
    }));

    // ═══ MORTS (humour) ═════════════════════════════════════════════════
    items.push(serde_json::json!({
        "id": "pyro-pilgrim",
        "label": "Pèlerin de Pyro",
        "unlocked": electric_arc_deaths >= 5,
        "progress": if electric_arc_deaths < 5 { Some(serde_json::json!({ "current": electric_arc_deaths, "target": 5 })) } else { None },
        "description": format!("{} / 5 morts par arc électrique", electric_arc_deaths),
        "color": "violet",
        "icon": "zap",
    }));
    // « Iron Will » : MÊME source de vérité que combat.ratio (`kd_ratio`). 0 mort
    // ⇒ `None` ⇒ achievement non débloqué (pas de ratio « infini » qui validerait
    // à tort). Plus de recalcul divergent avec `.max(1)`.
    items.push(serde_json::json!({
        "id": "ironman-survival",
        "label": "Iron Will",
        "unlocked": kd_ratio.map(|r| r >= 5.0).unwrap_or(false),
        "description": match kd_ratio {
            Some(r) => format!("Ratio K/D : {:.1} (obj. ≥ 5.0)", r),
            None => "Aucune mort enregistrée".to_string(),
        },
        "color": "emerald",
        "icon": "award",
    }));

    items
}

/// Stats agrégées exhaustives (carnet de bord) pour le frontend.
/// Reconstruit le même JSON que le générateur de mock-data mais depuis
/// le cache live (gamelog_history.json).
#[command]
pub async fn gamelog_history_stats(app: AppHandle) -> Result<serde_json::Value, String> {
    let cache = load_cache(&app)?;
    let moniker = cache.player_moniker.clone().unwrap_or_default();
    let mut versions: Vec<String> = cache
        .files
        .iter()
        .filter_map(|f| f.sc_version.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    versions.sort();
    let first_version = versions.first().cloned();
    // Nomme les marchandises historiques (best-effort UEX) → évite "Marchandise
    // #guid" dans Économie. Mappings globaux cachés pour les fois suivantes.
    let buys: Vec<(String, f64, String)> = cache.events.iter().filter_map(|e| match e {
        GameEvent::CommodityBuy { commodity_guid, price_per_csu, shop_name, .. } =>
            Some((commodity_guid.clone(), *price_per_csu, shop_name.clone())),
        _ => None,
    }).collect();
    crate::scripts::uex_commodity_api::resolve_unknown_commodities(&buys).await;
    // Agrège les comptes d'objectifs sur TOUS les fichiers (chaque
    // `LogFileMetadata::objective_kinds` est un agrégat par-fichier ; le re-scan
    // remplace l'entrée fichier → pas de double-compte). Sert à la spécialité.
    let mut objective_kinds: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for f in &cache.files {
        for (kind, count) in &f.objective_kinds {
            *objective_kinds.entry(kind.clone()).or_insert(0) += *count;
        }
    }
    // local_geid = None : on laisse build_logbook_stats résoudre le GEID entité
    // canonique depuis les SetDriver locaux (`Vehicle Control Flow`). ⚠️ Ne PAS
    // passer `cache.player_geid` ici : c'est le geid du CharacterIdentified
    // (record de compte), d'une AUTRE famille d'ID que les killer/victim_geid
    // des Actor Death — il ne matcherait jamais les events gameplay.
    Ok(build_logbook_stats(
        &cache.events,
        &moniker,
        cache.player_handle.as_deref(),
        &versions,
        first_version.as_deref(),
        None,
        &objective_kinds,
    ))
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_actor_death_pve() {
        let line = "<2025-08-02T09:19:50.693Z> [Notice] <Actor Death> CActor::Kill: 'PU_Pilots-Human-Criminal-Pilot_Light_5274749111518' [5274749111518] in zone 'MISC_Reliant_PU_AI_CRIM_5274749111206' killed by 'R-om' [202028776990] using 'unknown' [Class unknown] with damage type 'Crash' from direction x: 0.000000, y: 0.000000, z: 0.000000 [Team_ActorTech][Actor]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::ActorDeath { victim, victim_geid, killer, killer_geid, damage_type, victim_is_npc, killer_is_npc, is_suicide, .. } => {
                assert_eq!(killer, "R-om");
                assert_eq!(killer_geid, 202028776990);
                assert!(victim.starts_with("PU_Pilots-Human-Criminal"));
                assert_eq!(victim_geid, 5274749111518);
                assert_eq!(damage_type, "Crash");
                assert!(victim_is_npc);
                assert!(!killer_is_npc);
                assert!(!is_suicide);
            }
            _ => panic!("wrong event type"),
        }
    }

    // ── Dédup au re-scan (Lot 2, HIGH#9 + MED#1) ────────────────────────────
    /// `dedup_events` doit :
    /// 1. fusionner les doublons EXACTS d'un re-parse (même contenu complet) →
    ///    1 seule occurrence gardée (ordre préservé) ;
    /// 2. CONSERVER deux events légitimement distincts au même `ts` (champs ≠).
    #[test]
    fn dedup_events_collapses_exact_duplicates_but_keeps_distinct() {
        // Helper local : un ActorDeath complet, paramétré par la victime.
        let kill = |ts: f64, victim: &str, victim_geid: u64| GameEvent::ActorDeath {
            ts,
            victim: victim.to_string(),
            victim_geid,
            zone: "RSI_Polaris_5535611394782".to_string(),
            killer: "R-om".to_string(),
            killer_geid: 202028776990,
            weapon: "behr_rifle_ballistic_01".to_string(),
            weapon_class: "Class Player".to_string(),
            damage_type: "Ballistic".to_string(),
            victim_is_npc: false,
            killer_is_npc: false,
            is_suicide: false,
        };

        // Scénario : un re-parse a ré-append à l'identique 1 session + 1 kill, et
        // deux kills DISTINCTS partagent le même ts (2 victimes différentes).
        let mut events = vec![
            GameEvent::SessionStart { ts: 100.0 }, // doublon exact ↓
            GameEvent::SessionStart { ts: 100.0 },
            kill(200.0, "Victim_A", 111), // doublon exact ↓
            kill(200.0, "Victim_A", 111),
            // Même ts (200.0) mais victime différente → event DISTINCT à garder.
            kill(200.0, "Victim_B", 222),
        ];

        dedup_events(&mut events);

        // 5 events en entrée → 3 distincts attendus.
        assert_eq!(events.len(), 3, "doublons exacts fusionnés, distincts gardés");

        // 1× SessionStart (le doublon exact a disparu).
        let session_starts = events
            .iter()
            .filter(|e| matches!(e, GameEvent::SessionStart { .. }))
            .count();
        assert_eq!(session_starts, 1, "le SessionStart dupliqué est fusionné");

        // Les DEUX victimes distinctes sont conservées (même ts, champs différents).
        let victims: std::collections::HashSet<String> = events
            .iter()
            .filter_map(|e| match e {
                GameEvent::ActorDeath { victim, .. } => Some(victim.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(victims.len(), 2, "2 kills distincts au même ts → 2 conservés");
        assert!(victims.contains("Victim_A"));
        assert!(victims.contains("Victim_B"));

        // L'ordre (trié) est préservé : 1ʳᵉ occurrence de chaque event gardée.
        assert!(matches!(events[0], GameEvent::SessionStart { .. }));
        assert!(matches!(events[1], GameEvent::ActorDeath { ref victim, .. } if victim == "Victim_A"));
        assert!(matches!(events[2], GameEvent::ActorDeath { ref victim, .. } if victim == "Victim_B"));

        // Idempotence : ré-appliquer dedup ne change plus rien.
        let before = events.len();
        dedup_events(&mut events);
        assert_eq!(events.len(), before, "dedup est idempotent");
    }

    // ── Fuseau horaire (Lot 1) : les stats calendaires sont en heure LOCALE ──
    #[test]
    fn local_day_index_uses_local_midnight_not_utc() {
        use chrono::{Datelike, FixedOffset, TimeZone, Utc};

        // 2025-11-25T23:30:00Z. À UTC+1 (heure d'hiver FR), il est déjà 00:30 le
        // 2025-11-26 en local → la DATE locale (et donc l'index de jour) DOIT être
        // celle du 26, pas du 25. C'est exactement le décalage qui coupait les
        // streaks / décalait la heatmap près de minuit.
        let ts = Utc.with_ymd_and_hms(2025, 11, 25, 23, 30, 0).unwrap().timestamp();

        // Référence indépendante du fuseau machine : conversion à un offset connu
        // (+1h) — prouve la logique « date locale ≠ date UTC » de façon déterministe.
        let plus_one = FixedOffset::east_opt(3600).unwrap();
        let local_date_plus1 = ts_to_offset_date(ts, plus_one);
        let utc_date = DateTime::<Utc>::from_timestamp(ts, 0).unwrap().date_naive();
        assert_eq!(utc_date.day(), 25, "la date UTC reste le 25");
        assert_eq!(local_date_plus1.day(), 26, "à UTC+1 la date locale passe au 26");
        // Les deux index de jour diffèrent → un bucketing UTC fusionnerait à tort
        // ces 30 minutes avec la veille.
        assert_eq!(
            local_date_plus1.num_days_from_ce() as i64 - utc_date.num_days_from_ce() as i64,
            1,
            "l'index de jour local est +1 vs UTC à cet instant",
        );

        // Et le helper de prod (`local_day_index`, fuseau machine via chrono::Local)
        // doit être cohérent avec une conversion chrono::Local directe du même ts.
        let expected_local_ce = DateTime::<Utc>::from_timestamp(ts, 0)
            .unwrap()
            .with_timezone(&chrono::Local)
            .date_naive()
            .num_days_from_ce() as i64;
        assert_eq!(super::local_day_index(ts), expected_local_ce);
    }

    /// LOW#11 : aucun ts aberrant (corrompu / hors plage représentable) ne doit
    /// faire paniquer la conversion calendaire ni les sites d'affichage. Les
    /// helpers de prod (`local_dt`/`local_day_index`) et le pattern d'affichage
    /// (`from_timestamp(...).map(...).unwrap_or_default()`) retombent proprement.
    #[test]
    fn corrupt_timestamp_never_panics() {
        for &ts in &[i64::MAX, i64::MIN, -62_135_596_801, 253_402_300_800, 0, -1] {
            // Helpers de prod : pas de panic, fallback déterministe.
            let _ = super::local_dt(ts);            // None hors plage, jamais de panic
            let _ = super::local_day_index(ts);     // fallback ts/86400 hors plage
            // Pattern exact des sites d'affichage (startedAt/completedAt/…).
            let iso = DateTime::<chrono::Utc>::from_timestamp(ts, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            // Soit une date valide, soit la chaîne vide — jamais un panic.
            assert!(iso.is_empty() || iso.contains('T'), "ISO inattendu: {iso:?}");
        }
    }

    /// MED#13 : `canonicalize_vehicle` produit toujours le même résultat après le
    /// passage des regex en OnceLock (compilées une seule fois). Vérifie le strip
    /// du suffixe d'instance `_DIGITS` et du tag IA `_PU_AI_*`, et l'idempotence.
    #[test]
    fn canonicalize_vehicle_stable_after_oncelock() {
        assert_eq!(super::canonicalize_vehicle("RSI_Polaris_5084560782383"), "RSI_Polaris");
        assert_eq!(super::canonicalize_vehicle("ANVL_Paladin"), "ANVL_Paladin");
        assert_eq!(
            super::canonicalize_vehicle("DRAK_Cutlass_PU_AI_NineTails_346349172816"),
            "DRAK_Cutlass"
        );
        // Idempotent : recanonicaliser ne change plus rien.
        let once = super::canonicalize_vehicle("RSI_Polaris_5084560782383");
        assert_eq!(super::canonicalize_vehicle(&once), once);
        // Stable sur appels répétés (le OnceLock ne mute pas la sortie).
        for _ in 0..1000 {
            assert_eq!(super::canonicalize_vehicle("MISC_Hull_C_999999"), "MISC_Hull_C");
        }
    }

    /// Helper de test : date calendaire d'un ts Unix vu depuis un offset FIXE.
    fn ts_to_offset_date(ts: i64, offset: chrono::FixedOffset) -> chrono::NaiveDate {
        use chrono::TimeZone;
        offset.timestamp_opt(ts, 0).unwrap().date_naive()
    }

    #[test]
    fn parses_actor_death_suicide() {
        let line = "<2025-08-15T20:54:35.321Z> [Notice] <Actor Death> CActor::Kill: 'R-om' [202028776990] in zone 'RSI_Polaris_5535611394782' killed by 'R-om' [202028776990] using 'R-om' [Class Player] with damage type 'Suicide' from direction x: 0.000000, y: 0.000000, z: 0.000000 [Team_ActorTech][Actor]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::ActorDeath { is_suicide, damage_type, killer_geid, victim_geid, .. } => {
                assert!(is_suicide);
                assert_eq!(killer_geid, victim_geid);
                assert_eq!(damage_type, "Suicide");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_vehicle_destruction() {
        let line = "<2025-08-02T09:19:08.524Z> [Notice] <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ESPR_Talon_Shrike_PU_AI_CRIM_5274749089723' [5274749089723] in zone 'ab_mine_stanton4_med_005' [pos x: 52513.516342, y: 52073.451367, z: -58622.054100 vel x: -206.381439, y: -49.756046, z: 61.757759] driven by 'unknown' [0] advanced from destroy level 0 to 1 caused by 'AIModule_Unmanned_PU_PDC_5207664716273' [5207664716273] with 'Combat' [Team_CGP4][Vehicle]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::VehicleDestruction { vehicle, driver, driver_geid, destroy_level_from, destroy_level_to, damage_type, .. } => {
                assert!(vehicle.starts_with("ESPR_Talon_Shrike"));
                assert_eq!(destroy_level_from, 0);
                assert_eq!(destroy_level_to, 1);
                assert_eq!(damage_type, "Combat");
                // `driven by 'unknown' [0]` → GEID driver capturé = 0 (NPC/inconnu).
                assert_eq!(driver, "unknown");
                assert_eq!(driver_geid, 0);
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_vehicle_destruction_driver_geid() {
        // Vaisseau piloté par un joueur nommé → le GEID du driver est capturé
        // (`driven by 'R-om' [202028776990]`), pas seulement le pseudo.
        let line = "<2025-08-02T09:19:08.524Z> [Notice] <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'RSI_Polaris_5535611394782' [5535611394782] in zone 'space' [pos x: 1.0, y: 2.0, z: 3.0 vel x: 0.0, y: 0.0, z: 0.0] driven by 'R-om' [202028776990] advanced from destroy level 1 to 2 caused by 'Sniper' [8000] with 'Ballistic' [Team_CGP4][Vehicle]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::VehicleDestruction { driver, driver_geid, destroy_level_from, destroy_level_to, damage_type, .. } => {
                assert_eq!(driver, "R-om");
                assert_eq!(driver_geid, 202028776990);
                assert_eq!(destroy_level_from, 1);
                assert_eq!(destroy_level_to, 2);
                assert_eq!(damage_type, "Ballistic");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_quantum_arrived() {
        let line = "<2025-11-25T17:30:28.146Z> [Notice] <Quantum Drive Arrived - Arrived at Final Destination> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnQuantumDriveArrived|Quantum Drive has arrived at final destination [Team_CGP4][QuantumTravel]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::QuantumArrived { vehicle, vehicle_geid, .. } => {
                assert_eq!(vehicle, "RSI_Perseus");
                // GEID entité du vaisseau capturé (corrélation au SetDriver local).
                assert_eq!(vehicle_geid, 7758557945986);
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn quantum_selected_requires_local_marker() {
        // Même ligne mais SANS le `- Local` (= QT d'un AUTRE joueur du bubble) :
        // ne doit PAS produire d'event (sinon on importe ses vaisseaux/routes).
        let line = "<2025-11-25T17:24:53.673Z> [Notice] <Player Selected Quantum Target> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point ObjectContainer_Lorville_City as their destination [Team_CGP4][QuantumTravel]";
        assert!(parse_line(line).is_none(), "QT Selected sans `- Local` doit être ignoré");
    }

    #[test]
    fn parses_quantum_selected() {
        let line = "<2025-11-25T17:24:53.673Z> [Notice] <Player Selected Quantum Target - Local> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point ObjectContainer_Lorville_City as their destination, routing locally [Team_CGP4][QuantumTravel]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::QuantumSelected { vehicle, vehicle_geid, destination, .. } => {
                assert_eq!(vehicle, "RSI_Perseus");
                // GEID entité ItemNavigation (entre `[...]`) — même famille que
                // les `QuantumArrived`, sert d'ancre pour reconnaître nos arrivées.
                assert_eq!(vehicle_geid, 7758557945986);
                assert_eq!(destination, "ObjectContainer_Lorville_City");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_vehicle_control_setdriver() {
        let line = "<2026-05-27T12:45:46.039Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::SetDriver: Local client node [224761968469] requesting control token for 'RSI_Constellation_Phoenix_5084560782383' [5084560782383] [Team_CGP4][Vehicle]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::VehicleControl { vehicle, geid, .. } => {
                assert_eq!(vehicle, "RSI_Constellation_Phoenix_5084560782383");
                // GEID du `Local client node` = entity GEID du joueur local
                // (ancre canonique d'identité, même famille que killer/victim_geid).
                assert_eq!(geid, 224761968469);
                // canonicalisé dans build_logbook_stats → code sans l'id d'instance.
                assert_eq!(canonicalize_vehicle(&vehicle), "RSI_Constellation_Phoenix");
                // GEID entité du vaisseau extrait du suffixe (corrélation QT).
                assert_eq!(vehicle_geid_from_name(&vehicle), Some(5084560782383));
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn ignores_vehicle_control_cleardriver() {
        // ClearDriver (relâche) ne doit PAS produire d'event : on compte les
        // prises de commandes (SetDriver) comme sorties, pas les sorties d'habitacle.
        let line = "<2026-05-29T22:03:58.140Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [204772149424] releasing control token for 'ORIG_m80_236839498732' [236839498732] [Team_CGP4][Vehicle]";
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn parses_suffocation_started_and_stopped() {
        let started = "<2025-08-15T20:13:17.039Z> [Notice] <[STAMINA] Player started suffocating> Player[R-om] Details:";
        match parse_line(started).expect("should parse") {
            GameEvent::Suffocation { player, started, .. } => {
                assert_eq!(player, "R-om");
                assert!(started);
            }
            _ => panic!("wrong event type"),
        }
        let stopped = "<2025-08-15T20:13:31.535Z> [Notice] <[STAMINA] Player stopped suffocating> Player[R-om] Details:";
        match parse_line(stopped).expect("should parse") {
            GameEvent::Suffocation { started, .. } => assert!(!started),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_vehicle_death() {
        let line = "<2025-10-20T18:15:04.412Z> [Notice] <[ActorState] Dead> [ACTOR STATE][CSCActorControlStateDead::PrePhysicsUpdate] Actor 'R-om' [202028776990] ejected from zone 'ANVL_Paladin_6791493947914' [6791493947914] to zone 'OOC_Stanton_2c_Yela' [6741374087647] due to previous zone being in a destroyed vehicle with detached interior. [Team_ActorFeatures][Actor]";
        match parse_line(line).expect("should parse") {
            GameEvent::VehicleDeath { actor, vehicle, .. } => {
                assert_eq!(actor, "R-om");
                assert_eq!(canonicalize_vehicle(&vehicle), "ANVL_Paladin");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_commodity_sell() {
        let line = "<2025-04-12T22:52:14.457Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommoditySellRequest> Sending SShopCommoditySellRequest - playerId[224761968469] shopId[2470749907445] shopName[TDD_SCShop-001] kioskId[2470749907430] amount[62850.000000] resourceGUID[06cafea0-49fe-4dce-b0f0-dc583316c66d] autoLoading[0] quantity[7] transactionMode[Location] Cargo Box Data:  [boxSize[1] | unitAmount[1]] [Team_NAPU][Shops][UI]";
        match parse_line(line).expect("should parse") {
            GameEvent::CommoditySell { player_id, shop_name, amount, quantity_scu, .. } => {
                assert_eq!(player_id, 224761968469); // filtre joueur local
                assert_eq!(shop_name, "TDD_SCShop-001");
                assert_eq!(amount, 62850.0);
                assert_eq!(quantity_scu, 7.0);
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_commodity_buy_with_and_without_unit() {
        // `cSCU` présent (format historique).
        let with_unit = "<2025-05-01T10:00:00.000Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommodityBuyRequest> Sending SShopCommodityBuyRequest - playerId[224761968469] shopId[111] shopName[CRU_L5_SCShop-001] price[12000.000000] shopPricePerCentiSCU[120.000000] resourceGUID[06cafea0-49fe-4dce-b0f0-dc583316c66d] quantity[100 cSCU] boxSize[1] unitAmount[1] [Team_NAPU][Shops][UI]";
        match parse_line(with_unit).expect("buy with cSCU") {
            GameEvent::CommodityBuy { player_id, price_total, quantity_csu, .. } => {
                assert_eq!(player_id, 224761968469);
                assert_eq!(price_total, 12000.0);
                assert_eq!(quantity_csu, 100.0);
            }
            _ => panic!("wrong event type"),
        }
        // `cSCU` ABSENT : doit quand même parser (sinon achat droppé → P&L faux).
        let no_unit = "<2025-05-01T10:00:00.000Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommodityBuyRequest> Sending SShopCommodityBuyRequest - playerId[224761968469] shopId[111] shopName[CRU_L5_SCShop-001] price[12000.000000] shopPricePerCentiSCU[120.000000] resourceGUID[06cafea0-49fe-4dce-b0f0-dc583316c66d] quantity[100] boxSize[1] unitAmount[1] [Team_NAPU][Shops][UI]";
        match parse_line(no_unit).expect("buy without cSCU") {
            GameEvent::CommodityBuy { quantity_csu, .. } => assert_eq!(quantity_csu, 100.0),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_party_leader() {
        let line = "<2025-10-21T15:52:12.142Z> [Notice] <party-launch> [notification] party-launch from leader[Mikechikeen] : pendingId[0] gameModeId[-2] [Team_BackendServices][GIM][Matchmaking]";
        match parse_line(line).expect("should parse") {
            GameEvent::PartyLeader { leader, .. } => assert_eq!(leader, "Mikechikeen"),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_party_member_geid() {
        let line = "<2025-08-15T15:04:42.589Z> [Notice] <CPartyMarkerComponent RWES> Streamed in party marker id 4950353524213. TrackedEntityId: 3226505704116 [Team_GameServices][EntitySubscription]";
        match parse_line(line).expect("should parse") {
            GameEvent::PartyMember { geid, .. } => assert_eq!(geid, 3226505704116),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_player_joined() {
        let line = "<2025-09-26T16:52:45.593Z> [Notice] <PlayerJoined> Received PlayerJoined push message for: mission_id 9cdd1655-c2fc-4bf2-82fe-7759d8e17228 - player_id 3226505704116 [Team_GameServices][Missions]";
        match parse_line(line).expect("should parse") {
            GameEvent::MissionPlayerJoined { player_geid, .. } => assert_eq!(player_geid, 3226505704116),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_mission_shared() {
        let line = "<2025-09-26T16:39:46.387Z> [Notice] <MissionShared> Received share push message: ownerId[606622654057] - missionId[9cdd1655-c2fc-4bf2-82fe-7759d8e17228] [Team_GameServices][Missions]";
        match parse_line(line).expect("should parse") {
            GameEvent::MissionShared { mission_id, .. } => assert_eq!(mission_id, "9cdd1655-c2fc-4bf2-82fe-7759d8e17228"),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_mission_ended_old_format_captures_player_geid() {
        // Ancien format : `Player[Nom] PlayerId[GEID]` → on capture le GEID
        // (ancre d'ownership) ET le nom (affichage).
        let line = "<2025-06-01T10:00:00.000Z> [Notice] <EndMission> Ending mission for player. MissionId[abc-123-def] Player[Rom] PlayerId[1000] CompletionType[Complete] Reason[ObjectiveCompleted] [Team_GameServices][Missions]";
        match parse_line(line).expect("should parse") {
            GameEvent::MissionEnded { mission_id, player, player_geid, completion_type, .. } => {
                assert_eq!(mission_id, "abc-123-def");
                assert_eq!(player, "Rom");
                assert_eq!(player_geid, 1000);
                assert_eq!(completion_type, "Complete");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_mission_ended_v2_has_no_owner() {
        // Format v2 (SC 4.6+) : aucun champ joueur → player vide, GEID 0
        // (mission d'instance, non attribuable au joueur local).
        let line = "<2025-06-01T10:00:00.000Z> [Notice] <MissionEnded> Received MissionEnded push message for: mission_id 9cdd1655-c2fc-4bf2-82fe-7759d8e17228 - mission_state MISSION_STATE_COMPLETED [Team_GameServices][Missions]";
        match parse_line(line).expect("should parse") {
            GameEvent::MissionEnded { player, player_geid, completion_type, .. } => {
                assert!(player.is_empty());
                assert_eq!(player_geid, 0);
                assert_eq!(completion_type, "Complete");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_mission_objective_without_opening_quote() {
        // LOW#9 : le guillemet ouvrant après `notification` est parfois absent.
        // Avec quote (cas nominal) :
        let with_q = "<2025-06-01T10:00:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification \"New Objective: Extract minerals\" [Team_UI]";
        match parse_line(with_q).expect("should parse") {
            GameEvent::MissionObjective { text, kind, .. } => {
                assert_eq!(text, "Extract minerals");
                assert_eq!(kind, "new");
            }
            _ => panic!("wrong event type (with quote)"),
        }
        // SANS quote OUVRANTE (le bug LOW#9) mais quote fermante présente → la
        // capture doit s'arrêter au guillemet fermant et l'objectif être récupéré.
        let no_q = "<2025-06-01T10:00:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification New Objective: Extract minerals\" [Team_UI]";
        match parse_line(no_q).expect("should parse (no opening quote)") {
            GameEvent::MissionObjective { text, kind, .. } => {
                assert_eq!(text, "Extract minerals");
                assert_eq!(kind, "new");
            }
            _ => panic!("wrong event type (no quote)"),
        }
    }

    #[test]
    fn parses_group_leadership_transfer() {
        let line = "<2025-10-25T12:32:29.467Z> [Notice] <Transfer group leadership> Client 202028776990 transfer leadership to member urn:sc:global:player:geid:3226505704116 in group 57ba2477-1c3d-46a0-b325-b1e790425ec1 [Team_GameServices][Social]";
        match parse_line(line).expect("should parse") {
            GameEvent::GroupLeadershipTransfer { leader_geid, .. } => assert_eq!(leader_geid, 202028776990),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_standard_item_purchase() {
        // ⚠️ Ordre réel : shopName … client_price[float] … itemName (la regex
        // historique avait l'ordre inversé + n'acceptait pas les décimales →
        // AUCUN achat n'était parsé).
        let line = "<2025-03-09T14:51:09.516Z> [Notice] <CEntityComponentShoppingProvider::SendStandardItemBuyRequest> Sending SShopBuyRequest - playerId[202028776990] shopId[1851785712015] shopName[SCShop_Refinery_Store] kioskId[0] client_price[1000.000000] itemClassGUID[b8bad4f1-faa8-4e9a-b7ba-55a0418026cb] itemName[rsi_deckcrew_undersuit_01_01_01] quantity[1] currencyType[UEC] [Team_NAPU][Shops][UI]";
        match parse_line(line).expect("should parse") {
            GameEvent::Purchase { player_id, shop, client_price, item, currency, .. } => {
                assert_eq!(player_id, 202028776990); // filtre joueur local
                assert_eq!(shop, "SCShop_Refinery_Store");
                assert_eq!(client_price, 1000.0);
                assert_eq!(item, "rsi_deckcrew_undersuit_01_01_01");
                assert_eq!(currency, "UEC"); // LOW#4 : currencyType capturé
            }
            _ => panic!("wrong event type"),
        }
    }

    /// LOW#4 : le prix d'achat est capturé en DÉCIMAL complet (plus tronqué à
    /// l'entier par la regex `(\d+)`) et la devise `REC` est distinguée de `UEC`.
    #[test]
    fn purchase_captures_decimal_price_and_rec_currency() {
        let line = "<2025-03-09T14:51:09.516Z> [Notice] <CEntityComponentShoppingProvider::SendStandardItemBuyRequest> Sending SShopBuyRequest - playerId[202028776990] shopId[1] shopName[AC_Shop] kioskId[0] client_price[1234.56] itemClassGUID[g] itemName[rec_item] quantity[1] currencyType[REC] [Team_NAPU][Shops][UI]";
        match parse_line(line).expect("should parse") {
            GameEvent::Purchase { client_price, currency, .. } => {
                // Décimales conservées (l'ancienne regex aurait donné 1234).
                assert!((client_price - 1234.56).abs() < 1e-9, "prix décimal complet attendu, eu {client_price}");
                assert_eq!(currency, "REC");
                assert!(!super::is_uec_currency(&currency), "REC ≠ aUEC");
            }
            _ => panic!("wrong event type"),
        }
    }

    /// Test d'intégration de la cause racine : avec un GEID local résolu (via
    /// SetDriver), seuls les kills/morts/transactions du JOUEUR sont comptés,
    /// même si un INCONNU partage le même pseudo OU pilote un autre vaisseau.
    #[test]
    fn build_stats_anchors_on_geid_not_moniker() {
        // Joueur local : GEID 1000, pilote le vaisseau 5084560782383 (SetDriver).
        // Un imposteur porte le MÊME pseudo "Rom" mais GEID 9999. Les GEID de
        // vaisseau font ≥ 10 chiffres (comme en vrai) → extraction du suffixe OK.
        let evs = vec![
            // Session délimitée pour que mostKillsInSession ait une fenêtre.
            GameEvent::SessionStart { ts: 50.0 },
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            // MON kill (killer_geid == 1000) → compté.
            GameEvent::ActorDeath {
                ts: 110.0, victim: "BadGuy".into(), victim_geid: 7001, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 1000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            // Kill d'un IMPOSTEUR homonyme (killer_geid == 9999) → IGNORÉ.
            GameEvent::ActorDeath {
                ts: 120.0, victim: "OtherVictim".into(), victim_geid: 7002, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 9999, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            // MA mort (victim_geid == 1000) → compté.
            GameEvent::ActorDeath {
                ts: 130.0, victim: "Rom".into(), victim_geid: 1000, zone: "z".into(),
                killer: "Sniper".into(), killer_geid: 8000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            // Arrivée QT de MON vaisseau (5084560782383) → comptée.
            GameEvent::QuantumArrived { ts: 140.0, vehicle: "RSI_Polaris".into(), vehicle_geid: 5084560782383 },
            // Arrivée QT du vaisseau d'un AUTRE (le "Perseus") → IGNORÉE.
            GameEvent::QuantumArrived { ts: 150.0, vehicle: "RSI_Perseus".into(), vehicle_geid: 7758557945986 },
            // Mes dépenses (playerId == 1000) → comptées.
            GameEvent::Purchase { ts: 160.0, item: "x".into(), client_price: 500.0, shop: "Shop".into(), player_id: 1000, currency: "UEC".into() },
            // Dépense d'un autre joueur (playerId == 9999) → IGNORÉE.
            GameEvent::Purchase { ts: 170.0, item: "y".into(), client_price: 999.0, shop: "Shop".into(), player_id: 9999, currency: "UEC".into() },
            GameEvent::SessionEnd { ts: 200.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, None, &Default::default());

        // Combat ancré sur GEID : 1 kill (pas 2), 1 mort.
        assert_eq!(json["combat"]["kills"], 1);
        assert_eq!(json["combat"]["deaths"], 1);
        // QT : seul mon vaisseau piloté compte (Perseus exclu).
        assert_eq!(json["totalQuantumJumps"], 1);
        // Éco : seules mes dépenses (500), pas les 999 de l'autre.
        assert_eq!(json["shopSpending"]["totalUec"].as_f64(), Some(500.0));
        // mostKillsInSession ancré GEID : le kill de l'imposteur (GEID 9999) ne
        // compte pas, même s'il partage le pseudo "Rom". Pas de session délimitée
        // ici → fenêtre unique [first..+24h], donc 1 (mon seul kill réel).
        assert_eq!(json["records"]["mostKillsInSession"], 1);
    }

    /// MED#11 — « Croisés en combat » keyé sur le GEID (pas le pseudo) : deux
    /// joueurs DISTINCTS portant le MÊME pseudo (GEID différents) donnent DEUX
    /// rencontres séparées, et ne sont plus fusionnés en une seule ligne gonflée.
    #[test]
    fn encounters_keyed_on_geid_not_pseudo() {
        // Joueur local : GEID 1000. Deux ennemis homonymes "Ghost" : GEID 2001 et
        // 2002 (deux personnes réelles différentes au même handle).
        let evs = vec![
            GameEvent::SessionStart { ts: 50.0 },
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            // Je tue "Ghost" #2001.
            GameEvent::ActorDeath {
                ts: 110.0, victim: "Ghost".into(), victim_geid: 2001, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 1000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            // Je tue "Ghost" #2002 (HOMONYME, autre personne).
            GameEvent::ActorDeath {
                ts: 120.0, victim: "Ghost".into(), victim_geid: 2002, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 1000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            GameEvent::SessionEnd { ts: 200.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());

        let encs = json["encounteredPlayers"].as_array().unwrap();
        // DEUX rencontres distinctes (une par GEID), pas une seule fusionnée.
        assert_eq!(encs.len(), 2, "deux GEID homonymes → deux rencontres : {:?}", encs);
        // Les deux s'affichent bien sous le pseudo "Ghost" (affichage only).
        assert!(encs.iter().all(|e| e["name"] == "Ghost"));
        // Chacune compte exactement 1 kill (pas 2 cumulés sur un seul "Ghost").
        assert!(encs.iter().all(|e| e["kills"] == 1), "kills non fusionnés : {:?}", encs);
    }

    /// MED#8 — ratio K/D : 0 mort ⇒ `combat.ratio` == null (PAS la sentinelle
    /// 999.0), et « Iron Will » NON débloqué (même source de vérité, pas de
    /// recalcul « infini » divergent). Avec des morts, le ratio est un nombre.
    #[test]
    fn kd_ratio_is_null_when_zero_deaths() {
        // Joueur local GEID 1000 : 2 kills, 0 mort (jamais victime).
        let evs = vec![
            GameEvent::SessionStart { ts: 50.0 },
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            GameEvent::ActorDeath {
                ts: 110.0, victim: "Foe".into(), victim_geid: 2001, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 1000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            GameEvent::ActorDeath {
                ts: 120.0, victim: "Foe2".into(), victim_geid: 2002, zone: "z".into(),
                killer: "Rom".into(), killer_geid: 1000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            GameEvent::SessionEnd { ts: 200.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());
        // 0 mort → ratio null (et surtout PAS 999).
        assert!(json["combat"]["ratio"].is_null(), "0 mort → ratio null : {:?}", json["combat"]["ratio"]);
        assert_eq!(json["combat"]["deaths"], 0);
        assert_eq!(json["combat"]["kills"], 2);
        // « Iron Will » : 0 mort → NON débloqué (pas de ratio « infini ») + libellé
        // « Aucune mort enregistrée ». UNE seule source de vérité avec le ratio.
        let iron = json["achievements"]["items"].as_array().unwrap().iter()
            .find(|it| it["id"] == "ironman-survival").expect("Iron Will présent");
        assert_eq!(iron["unlocked"], false, "0 mort ne doit PAS débloquer Iron Will");
        assert_eq!(iron["description"], "Aucune mort enregistrée");

        // Contrôle : avec 1 mort, le ratio devient un nombre fini (2 kills / 1 mort).
        let mut evs2 = evs.clone();
        evs2.insert(evs2.len() - 1, GameEvent::ActorDeath {
            ts: 130.0, victim: "Rom".into(), victim_geid: 1000, zone: "z".into(),
            killer: "Sniper".into(), killer_geid: 8000, weapon: "w".into(), weapon_class: "wc".into(),
            damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
        });
        let json2 = build_logbook_stats(&evs2, "Rom", None, &[], None, Some(1000), &Default::default());
        assert_eq!(json2["combat"]["deaths"], 1);
        assert_eq!(json2["combat"]["ratio"].as_f64().unwrap(), 2.0, "2 kills / 1 mort = 2.0");
    }

    /// Fix LIEUX & SYSTÈMES (MED#4/#6) : les zones (`ActorDeath`) et les systèmes
    /// (`SolarSystemChange`) sont ancrés sur l'identité LOCALE. La mort d'un
    /// inconnu n'ajoute PAS sa zone ; le saut de système d'une entité étrangère
    /// n'ajoute PAS le système. Seuls les signaux du joueur local comptent.
    #[test]
    fn build_stats_locations_and_systems_anchored_on_local() {
        // GEID local = 1000 (fourni + SetDriver). Moniker "Rom".
        let evs = vec![
            GameEvent::SessionStart { ts: 50.0 },
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            // ── Systèmes ──────────────────────────────────────────────
            // Saut du joueur LOCAL (entity == moniker) Stanton→Pyro → Pyro compté.
            GameEvent::SolarSystemChange { ts: 110.0, entity: "Rom".into(), from: "Stanton".into(), to: "Pyro".into() },
            // Saut d'une entité ÉTRANGÈRE Stanton→Castra → Castra IGNORÉ.
            GameEvent::SolarSystemChange { ts: 120.0, entity: "Stranger".into(), from: "Stanton".into(), to: "Castra".into() },
            // ── Zones (morts) ─────────────────────────────────────────
            // MA mort (victim_geid == 1000) à Lorville → zone comptée.
            GameEvent::ActorDeath {
                ts: 130.0, victim: "Rom".into(), victim_geid: 1000, zone: "lorville".into(),
                killer: "Sniper".into(), killer_geid: 8000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            // Mort d'un INCONNU (victim_geid 7777) à Area18 → zone IGNORÉE.
            GameEvent::ActorDeath {
                ts: 140.0, victim: "Enemy".into(), victim_geid: 7777, zone: "area18".into(),
                killer: "OtherGuy".into(), killer_geid: 6000, weapon: "w".into(), weapon_class: "wc".into(),
                damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: false, is_suicide: false,
            },
            GameEvent::SessionEnd { ts: 200.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());

        // ── systemsVisited : Stanton (défaut) + Pyro (mon saut) ; PAS Castra ──
        let systems: Vec<String> = json["systemsVisited"].as_array().unwrap().iter()
            .map(|v| v.as_str().unwrap_or("").to_string())
            .collect();
        assert!(systems.iter().any(|s| s == "Pyro"), "mon saut local doit ajouter Pyro : {:?}", systems);
        assert!(!systems.iter().any(|s| s == "Castra"), "le saut d'un inconnu ne doit PAS ajouter Castra : {:?}", systems);
        assert!(systems.iter().any(|s| s == "Stanton"), "Stanton reste implicite : {:?}", systems);

        // ── uniqueZoneCount : seulement MA zone (Lorville) = 1 ──
        assert_eq!(json["uniqueZoneCount"], 1, "seule la zone de MA mort compte (pas celle de l'inconnu)");

        // ── topLocations : Lorville présent, Area18 absent ──
        let locations: Vec<String> = json["topLocations"].as_array().unwrap().iter()
            .map(|v| v["name"].as_str().unwrap_or("").to_string())
            .collect();
        assert!(locations.iter().any(|n| n == "Lorville"), "ma zone Lorville doit apparaître : {:?}", locations);
        assert!(!locations.iter().any(|n| n == "Area18"), "la zone où un inconnu est mort ne doit PAS apparaître : {:?}", locations);
    }

    /// Fix social : les comparaisons `own_geid` (issu de CharacterIdentified =
    /// mauvaise famille d'ID) sont remplacées par `resolved_local_geid` (entity
    /// GEID via SetDriver). Vérifie `timesLeader` (jamais incrémenté avant) et
    /// l'auto-exclusion du joueur dans les coéquipiers/teammates.
    #[test]
    fn build_stats_social_anchored_on_resolved_geid() {
        // GEID local résolu = 1000 (SetDriver le plus fréquent).
        let evs = vec![
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            // CharacterIdentified logue un AUTRE id (famille Character ≠ entity).
            // Avant le fix, own_geid = 42 → comparaisons sociales cassées.
            GameEvent::CharacterIdentified { ts: 101.0, name: "Rom".into(), geid: 42 },
            // Au moins un compagnon pour que le bloc social soit émis (non-null).
            GameEvent::PartyMember { ts: 102.0, geid: 2002 },
            // Le joueur local apparaît comme membre de party (entity GEID 1000) →
            // doit être EXCLU (ne pas se compter soi-même).
            GameEvent::PartyMember { ts: 103.0, geid: 1000 },
            // Teammates distincts (MissionPlayerJoined = entity GEID) :
            GameEvent::MissionPlayerJoined { ts: 110.0, player_geid: 2002 }, // coéquipier
            GameEvent::MissionPlayerJoined { ts: 111.0, player_geid: 1000 }, // MOI → exclu
            // Leadership transféré DEPUIS moi (entity GEID 1000) → timesLeader++.
            GameEvent::GroupLeadershipTransfer { ts: 120.0, leader_geid: 1000 },
            // Transfert depuis un autre → ne compte pas.
            GameEvent::GroupLeadershipTransfer { ts: 121.0, leader_geid: 2002 },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, None, &Default::default());
        let social = &json["companions"];
        assert!(!social.is_null(), "le bloc social doit être émis");
        // timesLeader = 1 (le transfert depuis MON entity GEID), pas 0.
        assert_eq!(social["timesLeader"], 1);
        // distinctTeammates = 1 (coéquipier 2002 ; moi=1000 exclu).
        assert_eq!(social["distinctTeammates"], 1);
    }

    /// Fix MISSIONS (MED#9) : ownership des `MissionEnded`. Un MissionEnded est
    /// loggé pour CHAQUE mission finissant dans l'instance (coéquipiers inclus).
    /// On ne compte comme PERSONNELLE que celle attribuable au joueur local :
    ///  - mission d'un AUTRE joueur (PlayerId ≠ GEID local) → exclue ;
    ///  - mission v2 SANS ownership (player="" / player_geid=0) → exclue (instance) ;
    ///  - mission du joueur local (PlayerId == GEID local) → comptée.
    /// Avant le fix, les 3 comptaient → compteur gonflé (×N joueurs du bubble).
    #[test]
    fn build_stats_mission_ownership_anchored_on_geid() {
        let mk = |ts: f64, player: &str, geid: u64, ct: &str| GameEvent::MissionEnded {
            ts, mission_id: format!("m-{ts}"), player: player.into(), player_geid: geid,
            completion_type: ct.into(), reason: "ObjectiveCompleted".into(),
        };
        let evs = vec![
            // Ancre GEID locale via SetDriver (resolved_local_geid = 1000).
            GameEvent::VehicleControl { ts: 50.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            // (1) MA mission complétée (PlayerId == 1000) → COMPTÉE.
            mk(100.0, "Rom", 1000, "Complete"),
            // (2) Mission d'un COÉQUIPIER (PlayerId == 2002) finissant dans MON
            //     instance → ancien format avec ownership → EXCLUE.
            mk(110.0, "Mate", 2002, "Complete"),
            // (3) Mission v2 SANS ownership (player="" / geid=0) → mission
            //     d'INSTANCE → EXCLUE (ne pas attribuer à tort).
            mk(120.0, "", 0, "Complete"),
            // (4) MON échec (PlayerId == 1000) → compté en failed.
            mk(130.0, "Rom", 1000, "Failed"),
            // (5) Échec d'un autre joueur → exclu.
            mk(140.0, "Mate", 2002, "Failed"),
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());
        // Une SEULE mission complétée m'est attribuée (la mienne), pas 3.
        assert_eq!(json["missionStats"]["totalMissionsComplete"], 1,
            "seule MA mission (GEID local) doit compter ; coéquipier + instance v2 exclus");
        // Un SEUL échec (le mien).
        assert_eq!(json["missionStats"]["totalMissionsFailed"], 1,
            "seul MON échec doit compter");

        // Non-régression legacy : SANS aucune ancre (pas de SetDriver, moniker
        // vide) → on retombe sur le comportement historique (tout compter).
        let evs_legacy = vec![
            mk(100.0, "", 0, "Complete"),
            mk(110.0, "Whoever", 2002, "Complete"),
        ];
        let json_legacy = build_logbook_stats(&evs_legacy, "", None, &[], None, None, &Default::default());
        assert_eq!(json_legacy["missionStats"]["totalMissionsComplete"], 2,
            "sans aucune ancre locale, comportement legacy = compter tout (pas de régression)");
    }

    /// FIX A : les `<EndMission>` réels loggent `CompletionType[Fail]` et
    /// `CompletionType[Abandon]` (PAS "Failed"/"Abandoned" — ça, c'est le mapping
    /// du format v2). Le code historique ne testait que "Failed" → "Fail" n'était
    /// JAMAIS compté. Ce test verrouille : "Fail" → failed, "Abandon" → abandoned,
    /// les deux orthographes (ancien + v2) acceptées.
    #[test]
    fn build_stats_counts_fail_and_abandon_completion_types() {
        let mk = |ts: f64, ct: &str| GameEvent::MissionEnded {
            ts, mission_id: format!("m-{ts}"), player: "Rom".into(), player_geid: 1000,
            completion_type: ct.into(), reason: "x".into(),
        };
        let evs = vec![
            // Ancre GEID locale (resolved_local_geid = 1000) → ownership actif.
            GameEvent::VehicleControl { ts: 10.0, geid: 1000, vehicle: "RSI_Polaris_5084560782383".into() },
            mk(100.0, "Complete"),
            mk(110.0, "Fail"),       // ancien format réel
            mk(120.0, "Failed"),     // mapping v2 (accepté aussi)
            mk(130.0, "Abandon"),    // ancien format réel
            mk(140.0, "Abandoned"),  // mapping v2 (accepté aussi)
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());
        let ms = &json["missionStats"];
        assert_eq!(ms["totalMissionsComplete"], 1, "1 Complete");
        assert_eq!(ms["totalMissionsFailed"], 2, "\"Fail\" + \"Failed\" = 2 échecs (le bug ne comptait que \"Failed\")");
        assert_eq!(ms["totalMissionsAbandoned"], 2, "\"Abandon\" + \"Abandoned\" = 2 abandons");
    }

    /// FIX B : la spécialité du joueur est dérivée du type d'objectif DOMINANT
    /// (`objective_kinds` agrégé). Hauling majoritaire → "Cargo / Hauling".
    /// On expose aussi la répartition brute. (Aucun lien objectif↔mission : on ne
    /// teste donc PAS un breakdown de missions complétées par type.)
    #[test]
    fn build_stats_derives_mission_specialty_from_objective_kinds() {
        let mut kinds: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        kinds.insert("Hauling".into(), 72961);
        kinds.insert("Bounty".into(), 12);
        let json = build_logbook_stats(&[], "Rom", None, &[], None, None, &kinds);
        let ms = &json["missionStats"];
        assert_eq!(ms["missionSpecialty"], "Cargo / Hauling",
            "Hauling dominant → label FR \"Cargo / Hauling\"");
        // Répartition brute exposée pour l'UI.
        assert_eq!(ms["objectiveTypeBreakdown"]["Hauling"], 72961);
        assert_eq!(ms["objectiveTypeBreakdown"]["Bounty"], 12);

        // Bounty dominant → "Chasse de primes".
        let mut kinds2: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        kinds2.insert("Hauling".into(), 3);
        kinds2.insert("Bounty".into(), 99);
        let json2 = build_logbook_stats(&[], "Rom", None, &[], None, None, &kinds2);
        assert_eq!(json2["missionStats"]["missionSpecialty"], "Chasse de primes");

        // Aucun objectif → spécialité null (et breakdown vide).
        let json3 = build_logbook_stats(&[], "Rom", None, &[], None, None, &Default::default());
        assert!(json3["missionStats"]["missionSpecialty"].is_null(),
            "sans objectif, missionSpecialty = null");
    }

    /// La regex `<Create(\w+)ObjectiveHandler>` capture bien le type d'activité.
    #[test]
    fn objective_handler_regex_captures_kind() {
        let line = "<2026-05-01T10:00:00.000Z> [Notice] <CreateHaulingObjectiveHandler> Created objective handler [Team_Missions]";
        let caps = re_objective_handler().captures(line).expect("doit matcher");
        assert_eq!(&caps[1], "Hauling");
        // Autre type.
        let line2 = "<CreateBountyObjectiveHandler> ...";
        assert_eq!(&re_objective_handler().captures(line2).unwrap()[1], "Bounty");
    }

    /// Fix MISSIONS (MED#10) : classification d'objectif MUTUELLEMENT EXCLUSIVE.
    /// Une mission aux signaux mixtes (mining + cargo) ne doit incrémenter QU'UNE
    /// seule catégorie (la dominante, ici mining > cargo), pas les deux.
    /// (Le classifieur PolyTool n'étant pas chargé en test offline, on exerce le
    /// fallback mots-clés à ordre de priorité.)
    #[test]
    fn build_stats_mission_classification_mutually_exclusive() {
        let evs = vec![
            // Objectif COMPLÉTÉ contenant À LA FOIS "mining" et "cargo" → avant le
            // fix : +1 mining ET +1 cargo (double comptage). Après : +1 mining seul.
            GameEvent::MissionObjective {
                ts: 100.0, kind: "complete".into(),
                text: "Mining: livrer la cargaison de minerai".into(),
            },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());
        let ms = &json["missionStats"];
        let mining = ms["miningMissionsComplete"].as_u64().unwrap();
        let cargo = ms["cargoMissionsComplete"].as_u64().unwrap();
        let salvage = ms["salvageMissionsComplete"].as_u64().unwrap();
        let bounty = ms["bountyMissionsComplete"].as_u64().unwrap();
        // Invariant central : exactement UNE catégorie est créditée (pas 2+).
        assert_eq!(mining + cargo + salvage + bounty, 1,
            "une mission aux signaux mixtes ne doit créditer QU'UNE catégorie (mining={mining} cargo={cargo} salvage={salvage} bounty={bounty})");
        // Le texte (libre, absent du global.ini) → classifieur None → fallback
        // mots-clés à priorité : mining > cargo, donc la dominante est mining.
        assert_eq!(mining, 1, "mining est la catégorie dominante (priorité sur cargo)");
        assert_eq!(cargo, 0, "cargo ne doit PAS être compté en plus (exclusivité)");
    }

    /// Fix VehicleDestruction : l'appartenance du vaisseau est ancrée sur
    /// `driver_geid` (capturé depuis `driven by '...' [GEID]`), pas sur le pseudo.
    /// Sans aucun SetDriver, on retombe sur la branche fallback `vehicle_hits`.
    #[test]
    fn build_stats_vehicle_destruction_driver_geid_attribution() {
        // Pas de VehicleControl → branche fallback (QT/destruction) active.
        // Pas de SetDriver → resolved_local_geid = None → is_local_actor matche
        // sur le moniker. Le vaisseau dont JE suis le driver est attribué ;
        // celui d'un homonyme imposteur l'est aussi en l'absence de GEID local
        // (legacy moniker fallback) — donc on teste l'ancrage GEID en
        // fournissant explicitement un local_geid.
        let evs = vec![
            GameEvent::VehicleDestruction {
                ts: 100.0, vehicle: "RSI_Polaris_5535611394782".into(), zone: "z".into(),
                driver: "Rom".into(), driver_geid: 1000,
                destroy_level_from: 0, destroy_level_to: 2, caused_by: "x".into(), damage_type: "Combat".into(),
            },
            // Vaisseau d'un imposteur homonyme (driver_geid 9999) → exclu.
            GameEvent::VehicleDestruction {
                ts: 110.0, vehicle: "AEGS_Idris_1111111111111".into(), zone: "z".into(),
                driver: "Rom".into(), driver_geid: 9999,
                destroy_level_from: 0, destroy_level_to: 2, caused_by: "x".into(), damage_type: "Combat".into(),
            },
        ];
        // local_geid fourni explicitement (1000) → ancrage GEID strict.
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, Some(1000), &Default::default());
        let names: Vec<String> = json["topVehicles"].as_array().unwrap().iter()
            .map(|v| v["name"].as_str().unwrap_or("").to_string())
            .collect();
        assert!(names.iter().any(|n| n.contains("Polaris")), "mon Polaris doit apparaître : {:?}", names);
        assert!(!names.iter().any(|n| n.contains("Idris")), "l'Idris de l'imposteur ne doit PAS apparaître : {:?}", names);
    }

    /// Fix robustesse QT : quand un GEID local est résolu mais qu'AUCUN nom de
    /// vaisseau n'a de suffixe ≥12 chiffres (`local_vehicle_geids` vide), on ne
    /// blanket-allow PAS les arrivées QT (sinon fuite des vaisseaux du bubble).
    #[test]
    fn qt_arrived_conservative_when_geids_unextractable() {
        let evs = vec![
            // SetDriver SANS suffixe numérique exploitable → resolved_local_geid
            // = Some(1000) MAIS local_vehicle_geids reste VIDE.
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris".into() },
            // Arrivée QT d'un vaisseau quelconque (GEID non corrélable).
            GameEvent::QuantumArrived { ts: 110.0, vehicle: "RSI_Perseus".into(), vehicle_geid: 7758557945986 },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, None, &Default::default());
        // Conservateur : 0 jump attribué (on ne sait pas si c'est le nôtre).
        assert_eq!(json["totalQuantumJumps"], 0);

        // Contraste : SANS aucun signal d'identité (pas de SetDriver du tout),
        // on garde le comportement legacy = laisser passer (pas de régression).
        let evs_legacy = vec![
            GameEvent::QuantumArrived { ts: 110.0, vehicle: "RSI_Perseus".into(), vehicle_geid: 7758557945986 },
        ];
        let json_legacy = build_logbook_stats(&evs_legacy, "Rom", None, &[], None, None, &Default::default());
        assert_eq!(json_legacy["totalQuantumJumps"], 1);
    }

    /// Fix sur-filtrage QT (cause racine) : une arrivée QT est reconnue comme
    /// NÔTRE via le ship-GEID **ItemNavigation** d'un `QuantumSelected - Local`,
    /// PAS via le GEID contrôle/Vehicle du SetDriver (qui est d'une AUTRE famille
    /// d'ID et ne matche jamais une arrivée — c'était le bug qui mettait
    /// totalQuantumJumps à 0). Reproduit le cas réel observé (rom/acki).
    #[test]
    fn qt_arrived_anchored_on_selected_local_itemnavigation_geid() {
        // GEID contrôle/Vehicle du SetDriver (5207664715954) ≠ GEID ItemNavigation
        // du même vaisseau dans les events Quantum (7758557945986) : familles
        // DIFFÉRENTES. C'est exactement la situation des vrais logs.
        let evs = vec![
            GameEvent::SessionStart { ts: 50.0 },
            // Le joueur prend les commandes : GEID contrôle = 5207664715954.
            GameEvent::VehicleControl { ts: 100.0, geid: 1000, vehicle: "RSI_Polaris_5207664715954".into() },
            // QuantumSelected LOCAL : porte le GEID ItemNavigation 7758557945986
            // (famille des arrivées). C'est l'ancre correcte.
            GameEvent::QuantumSelected { ts: 110.0, vehicle: "RSI_Perseus".into(), vehicle_geid: 7758557945986, destination: "ObjectContainer_Lorville_City".into() },
            // Arrivée QT de NOTRE vaisseau (même GEID ItemNavigation) → COMPTÉE,
            // alors même qu'elle ne matche AUCUN GEID SetDriver.
            GameEvent::QuantumArrived { ts: 160.0, vehicle: "RSI_Perseus".into(), vehicle_geid: 7758557945986 },
            // Arrivée QT d'un vaisseau JAMAIS sélectionné en local (autre joueur
            // du bubble) → EXCLUE.
            GameEvent::QuantumArrived { ts: 170.0, vehicle: "AEGS_Idris".into(), vehicle_geid: 9999999999999 },
            GameEvent::SessionEnd { ts: 200.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, None, &Default::default());
        // 1 seul saut attribué : le nôtre (Perseus), pas celui de l'autre (Idris).
        assert_eq!(json["totalQuantumJumps"], 1, "l'arrivée du ship Selected-Local doit compter, l'autre non");
        // fastestQuantumSeconds (sous `records`) : pairing Selected(110)→Arrived(160) = 50s.
        assert_eq!(json["records"]["fastestQuantumSeconds"], 50);
    }

    /// Régression "heures manquantes" : une session SANS `SessionEnd` (= un crash,
    /// fréquent dans Star Citizen) doit voir ses heures comptées (≈ dernier event
    /// observé − start), pas perdues à 0. Avant le fix, la session crashée était
    /// stockée `(start, None)` et `filter_map(|(s,e)| e.map(...))` l'ignorait → un
    /// joueur qui crash souvent perdait énormément d'heures.
    #[test]
    fn crashed_session_without_end_still_counts_hours() {
        // Helper : un event "d'activité" en session (ActorDeath) à un ts donné.
        let death_at = |ts: f64| GameEvent::ActorDeath {
            ts, victim: "Rom".into(), victim_geid: 1000, zone: "z".into(),
            killer: "NPC".into(), killer_geid: 8000, weapon: "w".into(), weapon_class: "wc".into(),
            damage_type: "Ballistic".into(), victim_is_npc: false, killer_is_npc: true, is_suicide: false,
        };
        let evs = vec![
            // Session 1 : CRASH. Démarre à t=0, dernier event à t=7200 (2 h), PUIS
            // plus aucun SessionEnd — elle est fermée par le SessionStart suivant.
            GameEvent::SessionStart { ts: 0.0 },
            death_at(3600.0),
            death_at(7200.0), // dernier event de la session crashée → fin estimée
            // Session 2 : propre, 1 h pile (SessionStart→SessionEnd).
            GameEvent::SessionStart { ts: 10_000.0 },
            GameEvent::SessionEnd { ts: 13_600.0, reason: SessionEndReason::Quit },
        ];
        let json = build_logbook_stats(&evs, "Rom", None, &[], None, None, &Default::default());
        // 2 h (session crashée, estimée 0→7200) + 1 h (session propre) = 3 h.
        // Sans le fix, la session crashée comptait 0 h → totalHours = 1.
        assert_eq!(json["totalHours"], 3, "les heures de la session crashée doivent être comptées via le dernier event");

        // Cas dégénéré : une session crashée avec AUCUN event après le start ne
        // peut pas être estimée (last_ts == start) → reste None → 0 h, donc seule
        // la session propre (1 h) compte. (Garantit qu'on n'invente pas d'heures.)
        let evs_no_activity = vec![
            GameEvent::SessionStart { ts: 0.0 },           // crash immédiat, 0 event
            GameEvent::SessionStart { ts: 10_000.0 },
            GameEvent::SessionEnd { ts: 13_600.0, reason: SessionEndReason::Quit },
        ];
        let json2 = build_logbook_stats(&evs_no_activity, "Rom", None, &[], None, None, &Default::default());
        assert_eq!(json2["totalHours"], 1, "une session crashée sans aucun event ne doit pas inventer d'heures");
    }

    #[test]
    fn parses_solar_system_change() {
        let line = "<2025-02-04T19:49:25.997Z> [Notice] <Changing Solar System> CEntityComponentJumpTunnelHost::RmChangeSolarSystem | CL18384 NOT AUTH | Stanton | JumpTunnelHost_1334051914875 [1334051914875] | Client entity R-om was found in tunnel zone JumpTunnelHost_1334051914875, changing system from Stanton to Pyro [Team_VehicleFeatures][JumpSystem]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::SolarSystemChange { entity, from, to, .. } => {
                assert_eq!(entity, "R-om");
                assert_eq!(from, "Stanton");
                assert_eq!(to, "Pyro");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_session_start() {
        let line = "<2025-08-02T09:03:54.785Z> [CSessionManager::OnClientSpawned] Spawned!";
        let ev = parse_line(line).expect("should parse");
        matches!(ev, GameEvent::SessionStart { .. });
    }

    #[test]
    fn pre_filter_skips_unrelated_lines() {
        let line = "<2025-08-02T09:03:54.785Z> [Trace] Some random unrelated trace line";
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn is_npc_detects_correctly() {
        assert!(is_npc("PU_Pilots-Human-Criminal-Pilot_Light_5274749111518"));
        assert!(is_npc("AIModule_Unmanned_PU_PDC_5207664716273"));
        assert!(is_npc("Kopion_NPC_123"));
        assert!(is_npc("unknown"));
        // Entité AI à GEID numérique long en suffixe (≥ 10 chiffres).
        assert!(is_npc("Quasi_Grazer_3321032172352"));
        assert!(!is_npc("R-om"));
        assert!(!is_npc("space-man-rob"));
        // MED#11 : un VRAI handle joueur avec beaucoup de tirets NE doit PLUS être
        // classé NPC (l'ancienne heuristique « ≥ 3 tirets » le catchait à tort).
        assert!(!is_npc("xX-Dark-Sniper-Pro"));
        // …ni un handle long (l'ancienne heuristique « len > 40 » le catchait).
        assert!(!is_npc("ThisIsAVeryLongButCompletelyValidHandleName"));
        // …ni un handle joueur à underscore (suffixe non numérique).
        assert!(!is_npc("Code_panther"));
        assert!(!is_npc("x_abdoulay_x"));
    }

    /// Test incremental scan : 2e run doit skip TOUS les fichiers (rien
    /// modifié), donc être quasi instantané (<100ms vs 3500ms pour scan
    /// complet). Vérifie aussi la diff modification mtime.
    ///
    /// Lance avec :
    ///   cargo test --release --lib bench_incremental_scan -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_incremental_scan() {
        use std::collections::HashMap;
        use std::time::Instant;

        let dir = std::path::Path::new(r"C:\Users\djame\Documents\site et appi\donné game log des gens\rom");
        if !dir.is_dir() {
            println!("[skip] Fixture R-om absente : {}", dir.display());
            return;
        }
        let logbackups = dir.join("logbackups");
        let files: Vec<_> = fs::read_dir(&logbackups)
            .expect("read logbackups")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("log")).unwrap_or(false))
            .collect();

        // Pass 1 : scan complet (simulé, on capture juste les mtimes)
        println!("\n=== Pass 1 : scan complet de {} fichiers ===", files.len());
        let start1 = Instant::now();
        let mut parsed_mtimes: HashMap<String, u64> = HashMap::new();
        let mut total_events_p1 = 0;
        for path in &files {
            let mtime = fs::metadata(path).ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
            parsed_mtimes.insert(path.display().to_string(), mtime);
            // Parse complet
            let bytes = match fs::read(path) { Ok(b) => b, Err(_) => continue };
            let content = String::from_utf8_lossy(&bytes);
            for line in content.lines() {
                if parse_line(line).is_some() { total_events_p1 += 1; }
            }
        }
        let elapsed1 = start1.elapsed();
        println!("Pass 1 elapsed : {:.2?} ({} events)", elapsed1, total_events_p1);

        // Pass 2 : incremental - skip tous les fichiers déjà parsés (mtime inchangé)
        println!("\n=== Pass 2 : scan incremental (rien modifié) ===");
        let start2 = Instant::now();
        let mut skipped = 0;
        let mut reparsed = 0;
        let mut total_events_p2 = 0;
        for path in &files {
            let path_str = path.display().to_string();
            let mtime = fs::metadata(path).ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
            if let Some(&prev) = parsed_mtimes.get(&path_str) {
                if prev >= mtime {
                    skipped += 1;
                    continue;
                }
            }
            reparsed += 1;
            let bytes = match fs::read(path) { Ok(b) => b, Err(_) => continue };
            let content = String::from_utf8_lossy(&bytes);
            for line in content.lines() {
                if parse_line(line).is_some() { total_events_p2 += 1; }
            }
        }
        let elapsed2 = start2.elapsed();
        println!("Pass 2 elapsed : {:.2?} (skipped {}, reparsed {}, events {})", elapsed2, skipped, reparsed, total_events_p2);

        let speedup = elapsed1.as_micros() as f64 / elapsed2.as_micros().max(1) as f64;
        println!("\n🚀 Speedup incremental : {:.0}× plus rapide", speedup);
        assert!(elapsed2 < elapsed1 / 10, "Incremental scan devrait être ≥10× plus rapide");
        assert_eq!(skipped, files.len(), "Tous les fichiers devraient être skippés");
        assert_eq!(reparsed, 0, "Aucun fichier ne devrait être re-parsé");
    }

    /// Génère un mock-data TypeScript complet à partir du dossier R-om pour
    /// que le frontend puisse afficher le carnet avec les vraies stats.
    /// Sortie : src/lib/logbook-mock-data-rom.ts
    ///
    /// Lance avec :
    ///   cargo test --release --lib generate_rom_mock_data -- --ignored --nocapture
    #[test]
    #[ignore]
    fn generate_rom_mock_data() {
        run_mock_data_generation("rom");
    }

    /// Idem mais sur la fixture zero (mineur).
    /// cargo test --release --lib generate_zero_mock_data -- --ignored --nocapture
    #[test]
    #[ignore]
    fn generate_zero_mock_data() {
        run_mock_data_generation("zero");
    }

    /// Idem mais sur la fixture acki.
    /// cargo test --release --lib generate_acki_mock_data -- --ignored --nocapture
    #[test]
    #[ignore]
    fn generate_acki_mock_data() {
        run_mock_data_generation("acki");
    }

    /// Mélange les 3 joueurs (rom + zero + acki) pour générer un carnet "all-in".
    /// Visuel uniquement — les stats ne représentent personne en particulier.
    /// cargo test --release --lib generate_combined_mock_data -- --ignored --nocapture
    #[test]
    #[ignore]
    fn generate_combined_mock_data() {
        run_mock_data_generation("combined");
    }

    fn run_mock_data_generation(player_dir: &str) {
        use std::collections::HashMap;

        // Cas spécial "combined" : agrège les 3 dossiers
        let base_dir = r"C:\Users\djame\Documents\site et appi\donné game log des gens";
        let player_dirs: Vec<&str> = if player_dir == "combined" {
            vec!["rom", "zero", "acki"]
        } else {
            vec![player_dir]
        };

        let mut files: Vec<std::path::PathBuf> = Vec::new();
        for pd in &player_dirs {
            let base = format!(r"{}\{}", base_dir, pd);
            let dir = std::path::Path::new(&base);
            if !dir.is_dir() {
                println!("[skip] Fixture {} absente", pd);
                continue;
            }
            let logbackups = dir.join("logbackups");
            if let Ok(entries) = fs::read_dir(&logbackups) {
                for e in entries.filter_map(|e| e.ok()) {
                    let p = e.path();
                    if p.is_file() && p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("log")).unwrap_or(false) {
                        files.push(p);
                    }
                }
            }
            let game_log = dir.join("Game.log");
            if game_log.is_file() { files.push(game_log); }
        }
        if files.is_empty() {
            println!("[skip] Aucun fichier .log trouvé pour {}", player_dir);
            return;
        }
        files.sort();
        println!("\n📂 Joueur(s) : {:?} — {} fichiers à parser", player_dirs, files.len());

        let mut all_events: Vec<GameEvent> = Vec::new();
        let mut handle: Option<String> = None;
        let mut versions = std::collections::HashSet::<String>::new();
        let mut first_version: Option<String> = None;
        // Spécialité : comptes d'objectifs par type, agrégés sur tous les fichiers
        // (même logique que la prod via `LogFileMetadata::objective_kinds`).
        let mut objective_kinds: HashMap<String, u64> = HashMap::new();

        for path in &files {
            let bytes = match fs::read(path) { Ok(b) => b, Err(_) => continue };
            let content = String::from_utf8_lossy(&bytes);
            let mut systems_seen: std::collections::HashSet<&'static str> = std::collections::HashSet::new();
            for line in content.lines() {
                if line.contains("ObjectiveHandler>") {
                    if let Some(caps) = re_objective_handler().captures(line) {
                        *objective_kinds.entry(caps[1].to_string()).or_insert(0) += 1;
                    }
                }
                if let Some(sys) = system_from_location_path(line) {
                    if systems_seen.insert(sys) {
                        all_events.push(GameEvent::SystemSeen { ts: parse_ts(line).unwrap_or(0.0), system: sys.to_string() });
                    }
                }
                if let Some(caps) = re_branch().captures(line) {
                    let v = caps[1].to_string();
                    if first_version.is_none() { first_version = Some(v.clone()); }
                    versions.insert(v);
                }
                if let Some(ev) = parse_line(line) {
                    if let GameEvent::CharacterIdentified { name, .. } = &ev {
                        if handle.is_none() { handle = Some(name.clone()); }
                    }
                    all_events.push(ev);
                }
            }
        }

        // Moniker via fréquence non-NPC
        let mut name_freq: HashMap<String, usize> = HashMap::new();
        for ev in &all_events {
            if let GameEvent::ActorDeath { killer, victim, killer_is_npc, victim_is_npc, .. } = ev {
                if !killer_is_npc { *name_freq.entry(killer.clone()).or_insert(0) += 1; }
                if !victim_is_npc { *name_freq.entry(victim.clone()).or_insert(0) += 1; }
            }
        }
        let moniker = name_freq.iter().max_by_key(|&(_, c)| c).map(|(n, _)| n.clone()).unwrap_or_default();

        // ─── Agrégation déléguée à build_logbook_stats (prod) ─────────────
        // Convertit le HashSet de versions en Vec trié pour l'appel.
        let mut versions_vec: Vec<String> = versions.iter().cloned().collect();
        versions_vec.sort();
        // Résout les noms de marchandises (best-effort UEX) avant l'agrégation,
        // pour que le mock affiche de vrais noms au lieu de "Marchandise #guid".
        let buys: Vec<(String, f64, String)> = all_events.iter().filter_map(|e| match e {
            GameEvent::CommodityBuy { commodity_guid, price_per_csu, shop_name, .. } =>
                Some((commodity_guid.clone(), *price_per_csu, shop_name.clone())),
            _ => None,
        }).collect();
        tokio::runtime::Runtime::new().unwrap()
            .block_on(crate::scripts::uex_commodity_api::resolve_unknown_commodities(&buys));
        // local_geid = None : résolution interne via les SetDriver locaux
        // (cf. note du call site prod). Garde le mock cohérent avec la prod.
        let json = build_logbook_stats(
            &all_events,
            &moniker,
            handle.as_deref(),
            &versions_vec,
            first_version.as_deref(),
            None,
            &objective_kinds,
        );

        // ─── Output JSON ──────────────────────────────────────
        // Le nom du fichier dépend du dossier joueur (rom.json, zero.json, etc.)
        let output_filename = format!("logbook-mock-data-{}.json", player_dir);
        let output_path_str = format!(
            r"C:\Users\djame\Documents\site et appi\TradSC-main\src\lib\{}",
            output_filename
        );
        let output_path = std::path::Path::new(&output_path_str);

        let pretty = serde_json::to_string_pretty(&json).unwrap();
        fs::write(output_path, &pretty).expect("write JSON");

        println!("\n✅ JSON écrit dans : {}", output_path.display());
        println!("Stats clés :");
        println!("  Moniker         : {}", moniker);
        println!("  Total events    : {}", all_events.len());
        println!("  Versions        : {}", versions.len());
        println!("  QT arrived      : {}", all_events.iter().filter(|e| matches!(e, GameEvent::QuantumArrived { .. })).count());
    }

    /// Bench complet sur la fixture privée R-om (343 fichiers, 991 MB).
    /// Skip par défaut, lancer avec :
    ///   cargo test --release --lib bench_scan_rom_fixture -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_scan_rom_fixture() {
        use std::time::Instant;
        let dir = std::path::Path::new(r"C:\Users\djame\Documents\site et appi\donné game log des gens\rom");
        if !dir.is_dir() {
            println!("[skip] Fixture R-om absente : {}", dir.display());
            return;
        }
        let logbackups = dir.join("logbackups");
        let mut files: Vec<_> = fs::read_dir(&logbackups)
            .expect("read logbackups")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("log")).unwrap_or(false))
            .collect();
        let game_log = dir.join("Game.log");
        if game_log.is_file() { files.push(game_log); }
        files.sort();

        println!("\nScanning {} fichiers (R-om fixture)...", files.len());
        let start = Instant::now();

        let mut total_events = 0usize;
        let mut kills_pvp = 0usize;
        let mut kills_pve = 0usize;
        let mut suicides = 0usize;
        let mut vehicle_destructions = 0usize;
        let mut qt_selected = 0usize;
        let mut qt_fuel = 0usize;
        let mut qt_arrived = 0usize;
        let mut solar_changes = 0usize;
        let mut sessions_start = 0usize;
        let mut sessions_end_quit = 0usize;
        let mut sessions_end_clean = 0usize;
        let mut handle: Option<String> = None;
        let mut player_geid: Option<u64> = None;
        let mut all_events: Vec<GameEvent> = Vec::new(); // pour 2e pass
        let mut missions_complete = 0usize;
        let mut missions_other = 0usize;
        let mut fatal_collisions = 0usize;
        let mut spawn_flow = 0usize;
        let mut purchases = 0usize;
        let mut purchase_total = 0.0f64;
        let mut versions = std::collections::HashSet::<String>::new();

        for path in &files {
            let bytes = match fs::read(path) { Ok(b) => b, Err(_) => continue };
            let content = String::from_utf8_lossy(&bytes);
            for line in content.lines() {
                if let Some(caps) = re_branch().captures(line) {
                    versions.insert(caps[1].to_string());
                }
                if let Some(ev) = parse_line(line) {
                    total_events += 1;
                    // Identification du joueur (handle + GEID) au fil du scan
                    if let GameEvent::CharacterIdentified { name, geid, .. } = &ev {
                        if handle.is_none() {
                            handle = Some(name.clone());
                            player_geid = Some(*geid);
                        }
                    }
                    match &ev {
                        GameEvent::VehicleDestruction { .. } => vehicle_destructions += 1,
                        GameEvent::QuantumSelected { .. } => qt_selected += 1,
                        GameEvent::QuantumFuelRequested { .. } => qt_fuel += 1,
                        GameEvent::QuantumArrived { .. } => qt_arrived += 1,
                        GameEvent::SolarSystemChange { .. } => solar_changes += 1,
                        GameEvent::SessionStart { .. } => sessions_start += 1,
                        GameEvent::SessionEnd { reason, .. } => {
                            match reason {
                                SessionEndReason::Quit => sessions_end_quit += 1,
                                SessionEndReason::EndSession => sessions_end_clean += 1,
                                _ => {}
                            }
                        }
                        GameEvent::MissionEnded { completion_type, .. } => {
                            if completion_type == "Complete" { missions_complete += 1; }
                            else { missions_other += 1; }
                        }
                        GameEvent::FatalCollision { .. } => fatal_collisions += 1,
                        GameEvent::SpawnFlow { .. } => spawn_flow += 1,
                        GameEvent::Purchase { client_price, .. } => {
                            purchases += 1;
                            purchase_total += *client_price;
                        }
                        _ => {}
                    }
                    all_events.push(ev);
                }
            }
        }

        // Heuristique : le joueur principal = le NON-NPC qui apparait le plus
        // souvent dans les Actor Death (killer ou victim). Le GEID du Character
        // event ne matche PAS celui des Actor Death (CIG utilise 2 IDs), donc
        // on s'appuie sur la fréquence d'apparition du nom.
        let mut name_freq: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for ev in &all_events {
            if let GameEvent::ActorDeath { killer, victim, killer_is_npc, victim_is_npc, .. } = ev {
                if !killer_is_npc {
                    *name_freq.entry(killer.clone()).or_insert(0) += 1;
                }
                if !victim_is_npc {
                    *name_freq.entry(victim.clone()).or_insert(0) += 1;
                }
            }
        }
        let moniker_latest = name_freq.iter().max_by_key(|&(_, c)| c).map(|(n, _)| n.clone());
        println!("\n=== Top 5 noms non-NPC ===");
        let mut sorted: Vec<_> = name_freq.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        for (n, c) in sorted.iter().take(5) {
            println!("  {:6}× {}", c, n);
        }

        // Match kills/morts via moniker (heuristique fréquence)
        if let Some(moniker) = &moniker_latest {
            for ev in &all_events {
                if let GameEvent::ActorDeath { killer, victim, victim_is_npc, is_suicide, .. } = ev {
                    let i_am_killer = killer == moniker;
                    let i_am_victim = victim == moniker;
                    if *is_suicide && i_am_victim { suicides += 1; }
                    else if i_am_killer {
                        if *victim_is_npc { kills_pve += 1; } else { kills_pvp += 1; }
                    }
                }
            }
        }

        let elapsed = start.elapsed();
        let mb_per_sec = 991.0_f64 / elapsed.as_secs_f64();

        println!("\n=== Résultats scan R-om ===");
        println!("Fichiers parsés          : {}", files.len());
        println!("Durée totale             : {:.2?} ({:.0} MB/s)", elapsed, mb_per_sec);
        println!("Total events parsés      : {}", total_events);
        println!();
        println!("Handle (login compte)    : {:?}", handle);
        println!("GEID stable              : {:?}", player_geid);
        println!("Moniker actuel (in-game) : {:?}", moniker_latest);
        println!("Versions traversées      : {} ({:?})", versions.len(), {
            let mut v: Vec<_> = versions.iter().cloned().collect();
            v.sort();
            v
        });
        println!();
        println!("Sessions start           : {}", sessions_start);
        println!("Sessions end (Quit)      : {}", sessions_end_quit);
        println!("Sessions end (clean)     : {}", sessions_end_clean);
        println!("Kills PVE (via GEID)     : {}", kills_pve);
        println!("Kills PVP (via GEID)     : {}", kills_pvp);
        println!("Suicides                 : {}", suicides);
        println!("Vehicle Destructions     : {}", vehicle_destructions);
        println!("QT Selected (stage 1)    : {}", qt_selected);
        println!("QT Fuel (stage 2)        : {}", qt_fuel);
        println!("QT Arrived (stage 4)     : {}", qt_arrived);
        println!("Changing Solar System    : {}", solar_changes);
        println!("Missions completed       : {}", missions_complete);
        println!("Missions other (fail/abort): {}", missions_other);
        println!("Fatal collisions         : {}", fatal_collisions);
        println!("Spawn Flow (respawn)     : {}", spawn_flow);
        println!("Purchases                : {} (total {} aUEC)", purchases, purchase_total);
    }
}
