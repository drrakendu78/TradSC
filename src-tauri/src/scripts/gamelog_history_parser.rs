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
        destroy_level_from: u8,
        destroy_level_to: u8,
        caused_by: String,
        damage_type: String,
    },

    /// Player a confirmé une destination QT (stage 1 du pipeline SC 4.5+).
    QuantumSelected { ts: f64, vehicle: String, destination: String },
    /// Server a calculé le fuel pour le QT (stage 2).
    QuantumFuelRequested { ts: f64, vehicle: String, destination: String },
    /// QT arrivé à destination (stage 4, = QT réussi).
    QuantumArrived { ts: f64, vehicle: String },

    /// Le joueur local prend les commandes d'un véhicule (`Vehicle Control Flow`
    /// `SetDriver`). Compté comme une **sortie** réelle (≠ estimation QT÷2).
    VehicleControl { ts: f64, vehicle: String },

    SolarSystemChange { ts: f64, entity: String, from: String, to: String },

    /// Système solaire détecté via le chargement de ses zones (object containers
    /// `loc/mod/<système>/…`). Signal de PRÉSENCE complémentaire au saut
    /// (`SolarSystemChange`) : certains systèmes (Nyx) sont atteints sans event
    /// de changement de système loggé. Émis dédupliqué (1× par système/fichier).
    SystemSeen { ts: f64, system: String },

    /// Épisode d'asphyxie (manque d'O2) — `[STAMINA] Player started/stopped
    /// suffocating`. `started=false` = fin d'épisode (permet de mesurer la durée).
    Suffocation { ts: f64, player: String, started: bool },

    /// Le joueur local meurt éjecté d'un véhicule détruit (`[ActorState] Dead`
    /// … `destroyed vehicle`). `vehicle` = zone d'éjection (canonicalisée ensuite).
    VehicleDeath { ts: f64, actor: String, vehicle: String },

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
        player: String,
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

    SpawnFlow {
        ts: f64,
        player: String,
        bed: String,
        location: String,
    },

    Purchase {
        ts: f64,
        item: String,
        client_price: u64,
        shop: String,
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
        Regex::new(
            r"<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle '([^']+)' \[\d+\] in zone '([^']+)' \[pos.*?\] driven by '([^']+)' \[\d+\] advanced from destroy level (\d+) to (\d+) caused by '([^']+)' \[\d+\] with '([^']+)'"
        ).unwrap()
    })
}

fn re_vehicle_control() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <Vehicle Control Flow> CVehicleMovementBase::SetDriver: Local client node [GEID] requesting control token for 'DRAK_Clipper_346349172816' [346349172816] [Team_CGP4][Vehicle]
        Regex::new(
            r"SetDriver: Local client node \[\d+\] requesting control token for '([A-Za-z0-9_]+)'"
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
        Regex::new(r"Actor '([^']+)' \[\d+\] ejected from zone '([^']+)'").unwrap()
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
        Regex::new(
            r"<Player Selected Quantum Target[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[\d+\].*?selected point (\w+) as their destination"
        ).unwrap()
    })
}

fn re_quantum_fuel() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"<Player Requested Fuel to Quantum Target[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[\d+\].*?requested fuel calculation to destination (\w+)"
        ).unwrap()
    })
}

fn re_quantum_arrived() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"<Quantum Drive Arrived[^>]*>.*?\| ([A-Z]+_[A-Za-z0-9_]+)_\d{12,}\[\d+\].*?has arrived at final destination"
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
        Regex::new(
            r"<EndMission>.*?MissionId\[([a-f0-9\-]+)\].*?Player\[([^\]]+)\].*?CompletionType\[([^\]]+)\].*?Reason\[([^\]]+)\]"
        ).unwrap()
    })
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
        Regex::new(
            r"SendStandardItemBuyRequest>.*?shopName\[([^\]]+)\].*?client_price\[(\d+)(?:\.\d+)?\].*?itemName\[([^\]]+)\]"
        ).unwrap()
    })
}

/// Match SendCommodityBuyRequest. Capture shop, prix, GUID commodity, quantité.
fn re_commodity_buy() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"SendCommodityBuyRequest>.*?shopId\[(\d+)\].*?shopName\[([^\]]+)\].*?price\[([\d.]+)\].*?shopPricePerCentiSCU\[([\d.]+)\].*?resourceGUID\[([a-f0-9\-]+)\].*?quantity\[([\d.]+)\s+cSCU\].*?boxSize\[([\d.]+)\].*?unitAmount\[(\d+)\]"
        ).unwrap()
    })
}

/// Match SendCommoditySellRequest. ⚠️ `amount` (≠ buy `price`), `quantity` en SCU nu.
fn re_commodity_sell() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"SendCommoditySellRequest>.*?shopName\[([^\]]+)\].*?amount\[([\d.]+)\].*?resourceGUID\[([a-f0-9\-]+)\].*?quantity\[(\d+)\]"
        ).unwrap()
    })
}

/// Match les notifications de mission ("New Objective: X" / "Objective Complete: X").
/// Capture le texte de l'objectif. Supporte EN / FR / DE / ES / IT.
/// Le quote fermante est parfois absente (texte tronqué par CIG sur certaines
/// notifications), on accepte donc soit la quote, soit un saut de ligne, soit
/// la fin de string.
fn re_mission_objective() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"notification\s*"(?:New Objective:|Objective Complete:|Nouvel objectif\s*:|Objectif accompli\s*:|Objectif complété\s*:|Objectif terminé\s*:|Neues Ziel:|Ziel abgeschlossen:|Nuevo objetivo:|Objetivo completado:|Nuovo obiettivo:|Obiettivo completato:)\s*([^"\r\n]+?)\s*(?:"|$|\r|\n)"#
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

// ── Helpers ────────────────────────────────────────────────────────────────

fn parse_ts(line: &str) -> Option<f64> {
    let caps = re_timestamp().captures(line)?;
    let raw = format!("{}+00:00", caps.get(1)?.as_str());
    DateTime::parse_from_rfc3339(&raw).ok().map(|dt| {
        dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0
    })
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
    // ── Heuristique : nom trop long ou trop de tirets = NPC ──────────────────
    // (Pas de check sur underscores ici car des handles valides peuvent en
    // avoir : ex "Code_panther", "x_abdoulay_x".)
    if name.len() > 40 { return true; }
    if name.matches('-').count() >= 3 { return true; }
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
                destroy_level_from: caps[4].parse().unwrap_or(0),
                destroy_level_to: caps[5].parse().unwrap_or(0),
                caused_by: caps[6].to_string(),
                damage_type: caps[7].to_string(),
            });
        }
    }

    // Vehicle Control Flow — prise de commandes (SetDriver) = sortie réelle.
    if line.contains("Vehicle Control Flow") && line.contains("SetDriver") {
        if let Some(caps) = re_vehicle_control().captures(line) {
            return Some(GameEvent::VehicleControl { ts, vehicle: caps[1].to_string() });
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

    // Mort en vaisseau — éjecté d'un véhicule détruit.
    if line.contains("destroyed vehicle") && line.contains("[ActorState] Dead") {
        if let Some(caps) = re_vehicle_death().captures(line) {
            return Some(GameEvent::VehicleDeath {
                ts,
                actor: caps[1].to_string(),
                vehicle: caps[2].to_string(),
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
                destination: caps[2].to_string(),
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
            return Some(GameEvent::MissionEnded {
                ts,
                mission_id: caps[1].to_string(),
                player: caps[2].to_string(),
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
                player: String::new(), // nouveau format ne capture pas le nom
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
                // Ordre réel du log : shopName … client_price … itemName.
                shop: caps[1].to_string(),
                client_price: caps[2].parse().unwrap_or(0),
                item: caps[3].to_string(),
            });
        }
    }

    // Achat de commodity (cargo terminal)
    if line.contains("SendCommodityBuyRequest") {
        if let Some(caps) = re_commodity_buy().captures(line) {
            return Some(GameEvent::CommodityBuy {
                ts,
                shop_id: caps[1].parse().unwrap_or(0),
                shop_name: caps[2].to_string(),
                price_total: caps[3].parse().unwrap_or(0.0),
                price_per_csu: caps[4].parse().unwrap_or(0.0),
                commodity_guid: caps[5].to_string(),
                quantity_csu: caps[6].parse().unwrap_or(0.0),
                box_size: caps[7].parse().unwrap_or(0.0),
                unit_amount: caps[8].parse().unwrap_or(0),
            });
        }
    }

    // Vente de commodity (cargo terminal) — pour le P&L commerce cargo.
    if line.contains("SendCommoditySellRequest") {
        if let Some(caps) = re_commodity_sell().captures(line) {
            return Some(GameEvent::CommoditySell {
                ts,
                shop_name: caps[1].to_string(),
                amount: caps[2].parse().unwrap_or(0.0),
                commodity_guid: caps[3].to_string(),
                quantity_scu: caps[4].parse().unwrap_or(0.0),
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

pub fn scan_file(path: &Path) -> Result<FileScanResult, String> {
    let bytes = fs::read(path).map_err(|e| format!("Lecture {}: {e}", path.display()))?;
    let content = String::from_utf8_lossy(&bytes);

    let mut events = Vec::new();
    let mut version: Option<String> = None;
    let mut build_id: Option<u64> = None;
    // Systèmes déjà émis pour ce fichier (dédup → 1 event SystemSeen/système).
    let mut systems_seen: std::collections::HashSet<&'static str> = std::collections::HashSet::new();

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }

        // Présence système via chargement de zones (Nyx atteint sans event de saut).
        if let Some(sys) = system_from_location_path(line) {
            if systems_seen.insert(sys) {
                events.push(GameEvent::SystemSeen { ts: parse_ts(line).unwrap_or(0.0), system: sys.to_string() });
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

    Ok(FileScanResult { events, version, build_id })
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
        GameEvent::Suffocation { ts, .. } => *ts,
        GameEvent::VehicleDeath { ts, .. } => *ts,
        GameEvent::PartyLeader { ts, .. } => *ts,
        GameEvent::PartyMember { ts, .. } => *ts,
        GameEvent::MissionPlayerJoined { ts, .. } => *ts,
        GameEvent::MissionShared { ts, .. } => *ts,
        GameEvent::GroupLeadershipTransfer { ts, .. } => *ts,
        GameEvent::MissionEnded { ts, .. } => *ts,
        GameEvent::FatalCollision { ts, .. } => *ts,
        GameEvent::SpawnFlow { ts, .. } => *ts,
        GameEvent::Purchase { ts, .. } => *ts,
        GameEvent::MissionObjective { ts, .. } => *ts,
        GameEvent::CommodityBuy { ts, .. } => *ts,
        GameEvent::CommoditySell { ts, .. } => *ts,
    }
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
            // Le fichier a été modifié depuis dernier scan : on doit le
            // re-parser ET virer ses anciens events du cache. Pour V1 simple,
            // on supprime juste l'entrée du cache.files (les events restent
            // mais seront déduplicates par ts au prochain sort).
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
    pub purchase_total_uec: u64,
    pub versions_traversed: Vec<String>,
    pub files_scanned: usize,
    pub last_scan_ts: u64,
}

#[command]
pub async fn gamelog_history_summary(app: AppHandle) -> Result<HistorySummary, String> {
    let cache = load_cache(&app)?;
    // Match via moniker (le name in-game qui apparaît dans Actor Death).
    // Le GEID de Character ne matche pas celui des Actor Death (CIG = 2 IDs).
    let moniker = cache.player_moniker.as_deref();

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
        purchase_total_uec: 0,
        versions_traversed: cache.files.iter().filter_map(|f| f.sc_version.clone()).collect::<HashSet<_>>().into_iter().collect(),
        files_scanned: cache.files.len(),
        last_scan_ts: cache.last_scan_ts,
    };

    for ev in &cache.events {
        match ev {
            GameEvent::SessionStart { .. } => s.session_count += 1,
            GameEvent::ActorDeath { killer, victim, is_suicide, killer_is_npc, victim_is_npc, .. } => {
                let i_am_killer = moniker.map(|n| killer == n).unwrap_or(false);
                let i_am_victim = moniker.map(|n| victim == n).unwrap_or(false);
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
            GameEvent::MissionEnded { completion_type, .. } => {
                if completion_type == "Complete" { s.mission_completed += 1; }
                else { s.mission_failed += 1; }
            }
            GameEvent::FatalCollision { .. } => s.fatal_collision_count += 1,
            GameEvent::SpawnFlow { .. } => s.spawn_flow_count += 1,
            GameEvent::Purchase { client_price, .. } => {
                s.purchase_count += 1;
                s.purchase_total_uec += client_price;
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
) -> serde_json::Value {
    use std::collections::HashMap;
    use chrono::{DateTime, Datelike, Timelike, Utc};

    // ─── KPIs ─────────────────────────────────────────────────────────
    let mut sessions: Vec<(f64, Option<f64>)> = Vec::new();
    let mut current_start: Option<f64> = None;
    for ev in all_events {
        match ev {
            GameEvent::SessionStart { ts } => {
                if let Some(s) = current_start.take() { sessions.push((s, None)); }
                current_start = Some(*ts);
            }
            GameEvent::SessionEnd { ts, .. } => {
                if let Some(s) = current_start.take() { sessions.push((s, Some(*ts))); }
            }
            _ => {}
        }
    }
    if let Some(s) = current_start { sessions.push((s, None)); }

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
                GameEvent::QuantumSelected { vehicle, .. }
                | GameEvent::QuantumFuelRequested { vehicle, .. }
                | GameEvent::QuantumArrived { vehicle, .. } => {
                    *vehicle_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
                }
                GameEvent::VehicleDestruction { vehicle, driver, .. } if driver == &moniker => {
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
            GameEvent::QuantumArrived { ts, vehicle } => {
                last_vehicle = Some((*ts, canonicalize_vehicle(vehicle)));
            }
            GameEvent::QuantumSelected { ts, vehicle, .. } => {
                last_vehicle = Some((*ts, canonicalize_vehicle(vehicle)));
            }
            GameEvent::ActorDeath { ts, zone, .. } => {
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
            GameEvent::Purchase { item, .. } => {
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
                let is_mining_kw = t.contains("mining") || t.contains("asteroid")
                    || t.contains("minage") || t.contains("astéroïde") || t.contains("astéroïdes") || t.contains("mineur")
                    || t.contains("bergbau") || t.contains("minería") || t.contains("estrazione");
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

                use crate::scripts::mission_classifier::MissionCategory;
                let is_mining = matches!(classifier_cat, Some(MissionCategory::Mining)) || is_mining_kw;
                let is_salvage = matches!(classifier_cat, Some(MissionCategory::Salvage)) || is_salvage_kw;
                let is_bounty = matches!(classifier_cat, Some(MissionCategory::Bounty)) || is_bounty_kw;
                let is_cargo = matches!(classifier_cat, Some(MissionCategory::Cargo)) || is_cargo_kw;
                if is_mining {
                    if is_complete { mining_missions_complete += 1; }
                    else { mining_missions_new += 1; }
                }
                if is_complete {
                    if is_salvage { salvage_missions_complete += 1; }
                    if is_bounty { bounty_missions_complete += 1; }
                    if is_cargo { cargo_missions_complete += 1; }
                }
            }
            _ => {}
        }
    }
    // Compte des vaisseaux mining hits (Mole/Prospector/Orion/ROC)
    let mut mining_ship_hits = 0usize;
    for ev in all_events {
        if let GameEvent::QuantumSelected { vehicle, .. } | GameEvent::QuantumArrived { vehicle, .. } = ev {
            let v = vehicle.to_lowercase();
            if v.contains("prospector") || v.contains("mole") || v.contains("orion") || v.contains("roc") {
                mining_ship_hits += 1;
            }
        }
    }
    // Score global mining (hand + ship + missions)
    let mining_score = mining_purchases + mining_missions_complete * 2 + mining_ship_hits;
    let has_mined = mining_score > 0;

    // Compte total des MissionEnded complétées (ancien + nouveau format)
    let total_missions_complete = all_events.iter().filter(|e| matches!(e,
        GameEvent::MissionEnded { completion_type, .. } if completion_type == "Complete"
    )).count() as u32;
    let total_missions_failed = all_events.iter().filter(|e| matches!(e,
        GameEvent::MissionEnded { completion_type, .. } if completion_type == "Failed"
    )).count() as u32;

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
                    if t.contains("mining") || t.contains("asteroid") || t.contains("minage") || t.contains("astéroïde") || t.contains("mineur") { "mining" }
                    else if t.contains("salvage") || t.contains("sauvetage") || t.contains("épave") || t.contains("wreck") || t.contains("debris") || t.contains("débris") { "salvage" }
                    else if t.contains("bounty") || t.contains("eliminate") || t.contains("prime") || t.contains("élimine") || t.contains("éliminer") { "bounty" }
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
            let dt = DateTime::<Utc>::from_timestamp(*s as i64, 0).unwrap();
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
            let day_idx = (*s as i64) / 86400;
            *daily_hours.entry(day_idx).or_insert(0.0) += dur / 3600.0;
        }
    }
    let now_day = (SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64) / 86400;
    let mut heatmap = Vec::with_capacity(364);
    for i in 0..364 {
        let day = now_day - (363 - i);
        heatmap.push(daily_hours.get(&day).copied().unwrap_or(0.0));
    }

    // Peak day
    let peak_day_idx = heatmap.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).map(|(i, _)| i).unwrap_or(0);
    let peak_day_secs = (now_day - (363 - peak_day_idx as i64)) * 86400;
    let peak_day_iso = DateTime::<Utc>::from_timestamp(peak_day_secs, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default();
    let peak_hours = heatmap[peak_day_idx];

    // ─── Heure préférée (24 bins) ─────────────────────────────────────
    let mut hourly = [0u32; 24];
    for (s, _) in &sessions {
        let dt = DateTime::<Utc>::from_timestamp(*s as i64, 0).unwrap();
        hourly[dt.hour() as usize] += 1;
    }

    // ─── Top jour de la semaine ───────────────────────────────────────
    let mut weekday = [0u32; 7]; // Lun=0..Dim=6
    for (s, e) in &sessions {
        if let Some(end) = e {
            let dur = end - s;
            if dur <= 0.0 || dur > 86400.0 { continue; }
            let dt = DateTime::<Utc>::from_timestamp(*s as i64, 0).unwrap();
            let dow = dt.weekday().num_days_from_monday() as usize;
            weekday[dow] += (dur / 3600.0) as u32;
        }
    }

    // ─── Dernières sessions (5 plus récentes) ─────────────────────────
    let mut recent_sessions = sessions.iter()
        .filter(|(s, e)| e.is_some() && e.unwrap() - s < 86400.0 && e.unwrap() - s > 0.0)
        .cloned()
        .collect::<Vec<_>>();
    recent_sessions.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    // 30 dernières sessions (~1 mois de recul actif). L'UI affiche les 5
    // premières puis expand pour le reste.
    let recent_5: Vec<_> = recent_sessions.iter().take(30).cloned().collect();

    // ─── Combat ──────────────────────────────────────────────────────
    let mut kills_pve = 0usize;
    let mut kills_pvp = 0usize;
    let mut deaths = 0usize;
    let mut last_kill: Option<(f64, String, String)> = None; // ts, weapon, victim
    let mut weapon_freq: HashMap<String, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::ActorDeath { killer, victim, victim_is_npc, weapon_class, ts, is_suicide, .. } = ev {
            if killer == &moniker && !is_suicide {
                if *victim_is_npc { kills_pve += 1; } else { kills_pvp += 1; }
                *weapon_freq.entry(weapon_class.clone()).or_insert(0) += 1;
                if last_kill.is_none() || ts > &last_kill.as_ref().unwrap().0 {
                    last_kill = Some((*ts, weapon_class.clone(), clean_combat_target(victim, *victim_is_npc)));
                }
            } else if victim == &moniker && !is_suicide {
                deaths += 1;
            }
        }
    }
    let fav_weapon = weapon_freq.iter().max_by_key(|&(_, c)| c).map(|(w, n)| (w.clone(), *n)).unwrap_or_default();

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
        if let GameEvent::ActorDeath { victim, damage_type, .. } = ev {
            if victim == &moniker {
                *death_causes.entry(damage_type.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut top_causes: Vec<_> = death_causes.into_iter().collect();
    top_causes.sort_by(|a, b| b.1.cmp(&a.1));
    // Pas de truncate — liste courte (max ~15 types), on garde tout

    // ─── Croisés en combat ───────────────────────────────────────────
    // name → (kills, deaths, max_ts) — max_ts est le ts du dernier
    // ActorDeath impliquant ce joueur (sert au lastSeen réel).
    let mut encounters: HashMap<String, (usize, usize, f64)> = HashMap::new();
    for ev in all_events {
        if let GameEvent::ActorDeath { ts, killer, victim, killer_is_npc, victim_is_npc, .. } = ev {
            if killer == &moniker && !victim_is_npc && victim != &moniker {
                let e = encounters.entry(victim.clone()).or_insert((0, 0, 0.0));
                e.0 += 1;
                if *ts > e.2 { e.2 = *ts; }
            } else if victim == &moniker && !killer_is_npc && killer != &moniker {
                let e = encounters.entry(killer.clone()).or_insert((0, 0, 0.0));
                e.1 += 1;
                if *ts > e.2 { e.2 = *ts; }
            }
        }
    }
    let mut top_encounters: Vec<_> = encounters.into_iter().collect();
    top_encounters.sort_by(|a, b| (b.1.0 + b.1.1).cmp(&(a.1.0 + a.1.1)));
    // Pas de truncate — chaque rencontre PVP a une histoire

    // ─── Compagnons de vol (social) ───────────────────────────────────────
    // Dico GEID→pseudo (combat + login) pour nommer les coéquipiers logués en
    // GEID nu. `party-launch leader[Handle]` = chef NOMMÉ en clair ;
    // `CPartyMarkerComponent TrackedEntityId` = membre (GEID → résolu si connu).
    let mut geid_name: HashMap<u64, String> = HashMap::new();
    let mut own_geid: Option<u64> = None;
    for ev in all_events {
        match ev {
            GameEvent::CharacterIdentified { name, geid, .. } => {
                if *geid != 0 && !name.is_empty() {
                    geid_name.insert(*geid, name.clone());
                    if name.as_str() == moniker || Some(name.as_str()) == handle {
                        own_geid = Some(*geid);
                    }
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
                if *geid == 0 || Some(*geid) == own_geid { continue; }
                let (label, resolved) = match geid_name.get(geid) {
                    Some(n) if n.as_str() != moniker => (n.clone(), true),
                    _ => (format!("Joueur #{}", geid % 1_000_000), false),
                };
                companions.entry(label).or_insert((0, false, resolved)).0 += 1;
            }
            _ => {}
        }
    }
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
            GameEvent::MissionPlayerJoined { player_geid, .. } => {
                if *player_geid != 0 && Some(*player_geid) != own_geid {
                    distinct_teammates.insert(*player_geid);
                }
            }
            GameEvent::MissionShared { mission_id, .. } => { shared_missions.insert(mission_id.clone()); }
            GameEvent::GroupLeadershipTransfer { leader_geid, .. } => {
                if Some(*leader_geid) == own_geid { times_leader += 1; }
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
        let dt = DateTime::<Utc>::from_timestamp(*s as i64, 0).unwrap();
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
    let max_kills_per_session = compute_max_kills_per_session(&sessions, &all_events, &moniker);

    // Last session details — itère sur les sessions récentes jusqu'à trouver
    // une session qui peut être enrichie (vehicle/zone détectés + durée > 1min).
    // Évite l'affichage "0h aux commandes d'un Inconnu autour de Inconnue".
    let last_session = recent_5.iter().find_map(|(s, e)| {
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
        recent_5.iter().find_map(|(s, e)| {
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
            GameEvent::SolarSystemChange { from, to, .. } => {
                let f = prettify_zone_sc(from);
                let t = prettify_zone_sc(to);
                if !f.is_empty() { systems_set.insert(f); }
                if !t.is_empty() { systems_set.insert(t); }
            }
            // Présence détectée via chargement de zones (ex Nyx atteint sans
            // event de saut loggé) — compte comme visité (même 2 sec).
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
            GameEvent::QuantumArrived { ts, vehicle } => {
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
    let mut days_played: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (s, _) in &sessions {
        days_played.insert((*s as i64) / 86400);
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
    let recent_5_enriched: Vec<(f64, f64, Vec<String>, Vec<String>, u32, u32)> = recent_5.iter()
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
                    GameEvent::QuantumArrived { vehicle, .. } => {
                        vset.insert(canonicalize_vehicle(vehicle));
                    }
                    GameEvent::ActorDeath { killer, victim, zone, is_suicide, .. } => {
                        let z = prettify_zone_sc(zone);
                        if !z.is_empty() { zset.insert(z); }
                        if killer == &moniker && !is_suicide { k += 1; }
                        if victim == &moniker && !is_suicide { d += 1; }
                    }
                    GameEvent::VehicleDestruction { vehicle, driver, .. } if driver == &moniker => {
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
    let qt_count = all_events.iter().filter(|e| matches!(e, GameEvent::QuantumArrived { .. })).count() as u32;
    let unique_zone_count_total = zone_count_total(&all_events) as u32;
    // Compte les arcs électriques (mort par ElectricArc en Pyro)
    let electric_deaths = all_events.iter().filter(|e| matches!(e, GameEvent::ActorDeath { victim, damage_type, .. } if victim == &moniker && damage_type == "ElectricArc")).count() as u32;
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
        kills_pvp + kills_pve,
        (longest_session_secs / 60.0) as u32,
        unique_vehicle_count as u32,
        unique_zone_count_total,
        fastest_quantum_seconds,
        longest_streak,
        deaths as u32,
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
    );
    let unlocked_count = achievement_items.iter().filter(|v| v.get("unlocked").and_then(|u| u.as_bool()).unwrap_or(false)).count();
    let total_count = achievement_items.len();

    // ─── systemTime réel ──────────────────────────────────────────────
    // Pour chaque session CLÔTURÉE (durée valide), on détermine le système
    // solaire actif = `to` du DERNIER SolarSystemChange dont le ts <= début
    // de session (défaut "Stanton" si aucun ne précède). On accumule les
    // heures de la session sur ce système. Aucune répartition arbitraire.
    let mut system_hours: HashMap<String, f64> = HashMap::new();
    for (start, end_opt) in &sessions {
        let end = match end_opt {
            Some(e) => *e,
            None => continue,
        };
        let dur = end - start;
        if dur <= 0.0 || dur >= 86400.0 { continue; }
        let mut active_system = "Stanton".to_string();
        let mut best_ts = f64::MIN;
        for ev in all_events {
            if let GameEvent::SolarSystemChange { ts, to, .. } = ev {
                if *ts <= *start && *ts > best_ts {
                    let pretty = prettify_zone_sc(to);
                    if !pretty.is_empty() {
                        best_ts = *ts;
                        active_system = pretty;
                    }
                }
            }
        }
        *system_hours.entry(active_system).or_insert(0.0) += dur / 3600.0;
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
            GameEvent::Suffocation { ts, player, started } if player == &moniker => {
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
    let mut vehicle_death_count: u32 = 0;
    let mut vehicle_death_hits: HashMap<String, usize> = HashMap::new();
    for ev in all_events {
        if let GameEvent::VehicleDeath { actor, vehicle, .. } = ev {
            if actor == &moniker {
                vehicle_death_count += 1;
                *vehicle_death_hits.entry(canonicalize_vehicle(vehicle)).or_insert(0) += 1;
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
        serde_json::json!({
            "count": vehicle_death_count,
            "deadliestVehicle": deadliest_vehicle.as_ref()
                .map(|(name, n)| serde_json::json!({ "name": name, "count": *n })),
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
            GameEvent::CommodityBuy { price_total, commodity_guid, .. } => {
                cargo_bought += price_total;
                cargo_buy_count += 1;
                cargo_by_guid.entry(commodity_guid.clone()).or_insert((0.0, 0.0)).0 += price_total;
            }
            GameEvent::CommoditySell { amount, commodity_guid, .. } => {
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
    let mut shop_total: u64 = 0;
    let mut shop_count: u32 = 0;
    let mut shop_by_name: HashMap<String, u64> = HashMap::new();
    for ev in all_events {
        if let GameEvent::Purchase { client_price, shop, .. } = ev {
            shop_total += *client_price;
            shop_count += 1;
            *shop_by_name.entry(clean_shop_label(shop)).or_insert(0) += *client_price;
        }
    }
    let mut shop_top: Vec<(String, u64)> = shop_by_name.into_iter().collect();
    shop_top.sort_by(|a, b| b.1.cmp(&a.1));
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
        "uniqueZoneCount": zone_count_total(&all_events),
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
        "recentSessions": recent_5_enriched.iter().map(|(s, end, vehicles, zones, k, d)| {
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
            "ratio": if deaths > 0 { (kills_pvp + kills_pve) as f64 / deaths as f64 } else { 999.0 },
            "favoriteWeapon": { "name": weapon_class_to_name(&fav_weapon.0).unwrap_or_else(|| fav_weapon.0.clone()), "kills": fav_weapon.1 },
            "lastKill": last_kill.map(|(ts, w, v)| serde_json::json!({
                "weapon": weapon_class_to_name(&w).unwrap_or(w),
                "victim": v,
                "date": DateTime::<Utc>::from_timestamp(ts as i64, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
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
        "totalQuantumJumps": all_events.iter().filter(|e| matches!(e, GameEvent::QuantumArrived { .. })).count(),
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

fn canonicalize_vehicle(raw: &str) -> String {
    // Strip suffix _DIGITS, keep MANUFACTURER_Model
    let re = regex::Regex::new(r"_\d{6,}$").unwrap();
    let cleaned = re.replace(raw, "").to_string();
    // Strip "PU_AI_*"
    let cleaned = regex::Regex::new(r"_PU_AI_\w+").unwrap().replace(&cleaned, "").to_string();
    cleaned
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
    let re = regex::Regex::new(r"_\d{6,}$").unwrap();
    let cleaned = re.replace(raw, "").to_string();
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
    let mut days: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (s, _) in sessions {
        days.insert((*s as i64) / 86400);
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

fn compute_max_kills_per_session(sessions: &[(f64, Option<f64>)], events: &[GameEvent], moniker: &str) -> u32 {
    let mut max_k = 0u32;
    for (s, e) in sessions {
        let end = e.unwrap_or(s + 86400.0);
        let mut k = 0u32;
        for ev in events {
            let ts = event_ts(ev);
            if ts < *s || ts > end { continue; }
            if let GameEvent::ActorDeath { killer, is_suicide, .. } = ev {
                if killer == moniker && !is_suicide { k += 1; }
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

fn zone_count_total(events: &[GameEvent]) -> usize {
    let mut set = std::collections::HashSet::new();
    for ev in events {
        if let GameEvent::ActorDeath { zone, .. } = ev {
            set.insert(clean_zone_name(zone));
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
    deaths_count: u32,
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
) -> Vec<serde_json::Value> {
    use chrono::{DateTime, Utc};

    let first_flight_date = first_session_ts
        .and_then(|ts| DateTime::<Utc>::from_timestamp(ts as i64, 0))
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
    items.push(serde_json::json!({
        "id": "ironman-survival",
        "label": "Iron Will",
        "unlocked": deaths_count > 0 && (total_kills as u32 / deaths_count.max(1)) >= 5,
        "description": if deaths_count > 0 {
            format!("Ratio K/D : {:.1} (obj. ≥ 5.0)", total_kills as f64 / deaths_count as f64)
        } else {
            "Aucune mort enregistrée".to_string()
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
    Ok(build_logbook_stats(
        &cache.events,
        &moniker,
        cache.player_handle.as_deref(),
        &versions,
        first_version.as_deref(),
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
            GameEvent::VehicleDestruction { vehicle, destroy_level_from, destroy_level_to, damage_type, .. } => {
                assert!(vehicle.starts_with("ESPR_Talon_Shrike"));
                assert_eq!(destroy_level_from, 0);
                assert_eq!(destroy_level_to, 1);
                assert_eq!(damage_type, "Combat");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_quantum_arrived() {
        let line = "<2025-11-25T17:30:28.146Z> [Notice] <Quantum Drive Arrived - Arrived at Final Destination> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnQuantumDriveArrived|Quantum Drive has arrived at final destination [Team_CGP4][QuantumTravel]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::QuantumArrived { vehicle, .. } => {
                assert_eq!(vehicle, "RSI_Perseus");
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn parses_quantum_selected() {
        let line = "<2025-11-25T17:24:53.673Z> [Notice] <Player Selected Quantum Target - Local> [ItemNavigation][CL][1448] | NOT AUTH | RSI_Perseus_7758557945986[7758557945986]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point ObjectContainer_Lorville_City as their destination, routing locally [Team_CGP4][QuantumTravel]";
        let ev = parse_line(line).expect("should parse");
        match ev {
            GameEvent::QuantumSelected { vehicle, destination, .. } => {
                assert_eq!(vehicle, "RSI_Perseus");
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
            GameEvent::VehicleControl { vehicle, .. } => {
                assert_eq!(vehicle, "RSI_Constellation_Phoenix_5084560782383");
                // canonicalisé dans build_logbook_stats → code sans l'id d'instance.
                assert_eq!(canonicalize_vehicle(&vehicle), "RSI_Constellation_Phoenix");
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
            GameEvent::CommoditySell { shop_name, amount, quantity_scu, .. } => {
                assert_eq!(shop_name, "TDD_SCShop-001");
                assert_eq!(amount, 62850.0);
                assert_eq!(quantity_scu, 7.0);
            }
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
            GameEvent::Purchase { shop, client_price, item, .. } => {
                assert_eq!(shop, "SCShop_Refinery_Store");
                assert_eq!(client_price, 1000);
                assert_eq!(item, "rsi_deckcrew_undersuit_01_01_01");
            }
            _ => panic!("wrong event type"),
        }
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
        assert!(!is_npc("R-om"));
        assert!(!is_npc("space-man-rob"));
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

        for path in &files {
            let bytes = match fs::read(path) { Ok(b) => b, Err(_) => continue };
            let content = String::from_utf8_lossy(&bytes);
            let mut systems_seen: std::collections::HashSet<&'static str> = std::collections::HashSet::new();
            for line in content.lines() {
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
        let json = build_logbook_stats(
            &all_events,
            &moniker,
            handle.as_deref(),
            &versions_vec,
            first_version.as_deref(),
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
        let mut purchase_total = 0u64;
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
                            purchase_total += client_price;
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
