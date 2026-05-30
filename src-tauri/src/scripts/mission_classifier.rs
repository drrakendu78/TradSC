#![allow(dead_code)] // wire-up prod en cours, utilisé pour l'instant via le bench

// Mission classifier — utilise le global.ini PolyTool (CIG canonique) pour
// catégoriser les missions détectées par le parser Game.log.
//
// Stratégie :
//   1. Charger global.ini FR + EN depuis le cache PolyTool partagé avec
//      blueprints.rs (chemins : `data_local_dir/startradfr/blueprints/polytool_global_{fr,en}.ini`)
//   2. Construire un index inverse `texte_localisé → clé_interne_EN`
//   3. Quand le parser voit une notification mission, on retrouve la clé EN
//   4. La clé contient le type (mission_mining_*, mission_bounty_*, etc.)
//   5. On catégorise via préfixes connus
//
// Si le global.ini n'est pas encore téléchargé (1er lancement offline), on
// fallback sur l'heuristique mots-clés existante dans gamelog_history_parser.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Catégorie de mission détectée. Couvre les principaux types SC 4.x.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissionCategory {
    Mining,
    Salvage,
    Bounty,        // bounty hunting / eliminate / hi-risk
    Cargo,         // delivery / hauling / cargo / acquisition
    Fps,           // ground combat / infantry
    Medical,       // med beacon / rescue
    Refuel,        // refueling / fuel
    Investigation, // recon / scan / scout
    Race,
    Touring,       // VIP transport / passenger
    Tutorial,
    Other,
}

impl MissionCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            MissionCategory::Mining => "mining",
            MissionCategory::Salvage => "salvage",
            MissionCategory::Bounty => "bounty",
            MissionCategory::Cargo => "cargo",
            MissionCategory::Fps => "fps",
            MissionCategory::Medical => "medical",
            MissionCategory::Refuel => "refuel",
            MissionCategory::Investigation => "investigation",
            MissionCategory::Race => "race",
            MissionCategory::Touring => "touring",
            MissionCategory::Tutorial => "tutorial",
            MissionCategory::Other => "other",
        }
    }
}

/// Index inverse construit depuis global.ini. Map: texte_localisé_lowercased → clé_interne.
/// On garde aussi les 2 maps brutes pour lookups directs.
pub struct LocalizationIndex {
    /// Reverse index : value lowercased trimmée → key (préfixée par "mission_" si possible)
    pub reverse_fr: HashMap<String, String>,
    pub reverse_en: HashMap<String, String>,
    /// Direct maps key → value (utile pour debug)
    pub fr: HashMap<String, String>,
    pub en: HashMap<String, String>,
}

impl LocalizationIndex {
    /// Catégorise une notification mission. Si le global.ini ne contient pas
    /// le texte (offline ou mission non trouvée), retourne None.
    /// Stratégie : 1) lookup exact, 2) substring match si la notif est composite
    /// (ex "Rejoindre : Base minière d'astéroïdes" → contient "Base minière d'astéroïdes"
    /// qui a une clé `AsteroidCluster_MiningBase_*`).
    pub fn classify(&self, text: &str) -> Option<MissionCategory> {
        let needle = normalize_lookup(text);
        if needle.is_empty() { return None; }

        // 1. Lookup exact FR puis EN
        if let Some(key) = self.reverse_fr.get(&needle).or_else(|| self.reverse_en.get(&needle)) {
            return Some(classify_key(key));
        }

        // 2. Substring match — utile pour les notifs composites.
        //    On extrait les "segments" du texte séparés par les délimiteurs
        //    courants (": ", " - ", " ") et on cherche chaque segment dans
        //    l'index. Plus efficace qu'un sliding window byte-by-byte
        //    (qui pose problèmes UTF-8 et perf).
        let separators = [" : ", " - ", " — ", ":", "–"];
        let mut segments: Vec<String> = vec![needle.clone()];
        for sep in separators {
            let mut new_segments = Vec::new();
            for s in &segments {
                for piece in s.split(sep) {
                    let trimmed = piece.trim();
                    if trimmed.len() >= 8 {
                        new_segments.push(trimmed.to_string());
                    }
                }
            }
            if !new_segments.is_empty() {
                segments.extend(new_segments);
            }
        }
        // Dedup
        segments.sort();
        segments.dedup();
        // Lookup chaque segment
        for seg in &segments {
            if let Some(key) = self.reverse_fr.get(seg).or_else(|| self.reverse_en.get(seg)) {
                let cat = classify_key(key);
                if cat != MissionCategory::Other { return Some(cat); }
            }
        }
        None
    }

    /// Pour debug : retourne la clé interne d'un texte localisé.
    pub fn lookup_key(&self, text: &str) -> Option<&str> {
        let needle = normalize_lookup(text);
        self.reverse_fr.get(&needle)
            .or_else(|| self.reverse_en.get(&needle))
            .map(|s| s.as_str())
    }
}

/// Normalise un texte de notification pour le lookup :
/// - lowercase
/// - trim
/// - strip ponctuation finale (":", ".", "!")
fn normalize_lookup(text: &str) -> String {
    text.trim()
        .trim_end_matches(|c: char| matches!(c, ':' | '.' | '!' | ' ' | '…'))
        .to_lowercase()
}

/// Catégorise une clé de localisation via son préfixe / contenu.
/// Les clés CIG suivent une convention : `mission_<type>_<id>_<field>`.
fn classify_key(key: &str) -> MissionCategory {
    let k = key.to_lowercase();
    // Mining (Greycat hand mining, ship mining, mining base zones)
    if k.contains("mining") || k.contains("_mineable") || k.contains("_asteroid")
        || k.starts_with("asteroidcluster") {
        return MissionCategory::Mining;
    }
    // Salvage (Reclaimer, Vulture, hand salvage)
    if k.contains("_salvage") || k.contains("_reclam") || k.contains("_wreck") {
        return MissionCategory::Salvage;
    }
    // Bounty / Eliminate / Hi-Risk
    if k.contains("_bounty") || k.contains("_eliminate") || k.contains("_hirisk")
        || k.contains("_assassinat") || k.contains("_kill")
        || k.contains("_pirate_swarm") {
        return MissionCategory::Bounty;
    }
    // FPS / Ground combat
    if k.contains("_fps") || k.contains("_infantry") || k.contains("_bunker")
        || k.contains("_ground_assault") {
        return MissionCategory::Fps;
    }
    // Medical / Med Beacon
    if k.contains("_medical") || k.contains("_medbeacon") || k.contains("_med_beacon")
        || k.contains("_rescue") || k.contains("_extract") {
        return MissionCategory::Medical;
    }
    // Refuel
    if k.contains("_refuel") || k.contains("_fuel_") {
        return MissionCategory::Refuel;
    }
    // Investigation / Recon / Scout
    if k.contains("_recon") || k.contains("_scout") || k.contains("_scan")
        || k.contains("_investigate") || k.contains("_inspect") {
        return MissionCategory::Investigation;
    }
    // Race
    if k.contains("_race") || k.contains("_racing") {
        return MissionCategory::Race;
    }
    // Touring / Transport / VIP
    if k.contains("_taxi") || k.contains("_vip") || k.contains("_transport")
        || k.contains("_passenger") || k.contains("_touring") {
        return MissionCategory::Touring;
    }
    // Tutorial
    if k.contains("_tutorial") || k.contains("_intro_") {
        return MissionCategory::Tutorial;
    }
    // Cargo / Delivery / Hauling / Acquisition
    if k.contains("_cargo") || k.contains("_delivery") || k.contains("_hauling")
        || k.contains("_acquisition") || k.contains("_freight") || k.contains("_haul") {
        return MissionCategory::Cargo;
    }
    MissionCategory::Other
}

// ── Chargement depuis cache PolyTool partagé ────────────────────────────────

fn polytool_cache_path(suffix: &str) -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("startradfr").join("blueprints");
    if !dir.exists() { return None; }
    Some(dir.join(format!("polytool_global_{}.ini", suffix)))
}

fn parse_global_ini(path: &PathBuf) -> Option<HashMap<String, String>> {
    let raw = fs::read_to_string(path).ok()?;
    let mut map = HashMap::with_capacity(60_000);
    for line in raw.lines() {
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') { continue; }
        let Some(eq_idx) = line.find('=') else { continue; };
        let raw_key = &line[..eq_idx];
        let value = line[eq_idx + 1..].trim();
        let key = raw_key
            .split(|c: char| c == ',' || c.is_whitespace())
            .next()
            .unwrap_or(raw_key)
            .trim()
            .to_ascii_lowercase();
        if key.is_empty() { continue; }
        map.entry(key).or_insert_with(|| value.to_string());
    }
    Some(map)
}

/// Construit un index FR/EN depuis les caches PolyTool si dispos.
/// Filtre uniquement les clés liées aux missions pour économiser la RAM
/// (l'index complet ferait ~60k entrées, on n'en garde que ~3k pertinentes).
pub fn load_localization_index() -> Option<LocalizationIndex> {
    let fr_path = polytool_cache_path("fr")?;
    let en_path = polytool_cache_path("en")?;
    let fr = parse_global_ini(&fr_path).unwrap_or_default();
    let en = parse_global_ini(&en_path).unwrap_or_default();
    if fr.is_empty() && en.is_empty() { return None; }

    // Construit l'index inverse en se concentrant sur les clés de missions
    let reverse_fr = build_reverse_index(&fr);
    let reverse_en = build_reverse_index(&en);

    Some(LocalizationIndex { reverse_fr, reverse_en, fr, en })
}

/// Construit un index `value → key` pour les clés liées aux missions ET zones associées.
/// On inclut aussi les noms de zones mining/bunker/etc. car les notifs SC sont composites.
fn build_reverse_index(map: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(8000);
    for (key, value) in map.iter() {
        let k_lower = key.to_lowercase();
        // Garde les clés pertinentes pour classification mission :
        // - mission_* / contract_* / quest_* (objectifs directs)
        // - asteroidcluster_* (zones mining)
        // - ugf_* / bunker_* (zones bounty/fps)
        // - int_s4_dc_* / int_s4_ld_* (zones cargo/delivery)
        // - reststop_*, refinery_* (zones cargo/refuel)
        // - missionmanager_* (objectifs de missions tutoriels/race)
        let is_relevant = k_lower.starts_with("mission")
            || k_lower.contains("_objective")
            || k_lower.contains("_obj_")
            || k_lower.starts_with("contract_")
            || k_lower.contains("_quest_")
            || k_lower.starts_with("asteroidcluster_")
            || k_lower.starts_with("ugf_")
            || k_lower.starts_with("int_s4_")
            || k_lower.contains("_bunker")
            || k_lower.contains("_refinery")
            || k_lower.starts_with("missionmanager_")
            || k_lower.contains("mining")    // Capture MiningAsteroidBase_*, MiningOutpost_*, etc.
            || k_lower.contains("salvage")
            || k_lower.contains("bounty")
            || k_lower.contains("derelict");
        if !is_relevant { continue; }
        let v_norm = normalize_lookup(value);
        if v_norm.is_empty() || v_norm.len() < 8 { continue; } // skip valeurs trop courtes pour éviter faux positifs
        out.entry(v_norm).or_insert_with(|| key.clone());
    }
    out
}

/// Singleton global accessible depuis le parser. Init paresseuse au 1er accès.
pub fn get_index() -> Option<&'static LocalizationIndex> {
    static INDEX: OnceLock<Option<LocalizationIndex>> = OnceLock::new();
    INDEX.get_or_init(load_localization_index).as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_trailing_punct() {
        assert_eq!(normalize_lookup("New Objective: "), "new objective");
        assert_eq!(normalize_lookup("  Rejoindre  "), "rejoindre");
        assert_eq!(normalize_lookup("Acquerir le bien…"), "acquerir le bien");
    }

    #[test]
    fn classify_mining_keys() {
        assert_eq!(classify_key("mission_mining_basic_obj_001"), MissionCategory::Mining);
        assert_eq!(classify_key("mining_asteroid_base_objective_title"), MissionCategory::Mining);
    }

    #[test]
    fn classify_bounty_keys() {
        assert_eq!(classify_key("mission_bounty_lvl3_obj"), MissionCategory::Bounty);
        assert_eq!(classify_key("mission_eliminate_target_obj"), MissionCategory::Bounty);
    }

    #[test]
    fn classify_cargo_keys() {
        assert_eq!(classify_key("mission_acquisition_obj"), MissionCategory::Cargo);
        assert_eq!(classify_key("mission_cargo_delivery"), MissionCategory::Cargo);
        assert_eq!(classify_key("mission_hauling_obj"), MissionCategory::Cargo);
    }

    #[test]
    fn classify_other_unknown() {
        assert_eq!(classify_key("mission_xyz_unknown"), MissionCategory::Other);
    }
}
