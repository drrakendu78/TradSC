import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/utils/tauri-helpers';

export const AUTO_CLEAN_OBSOLETE_CACHES_KEY = 'startradfr_auto_clear_obsolete_caches';
/// User a explicitement cliqué "Ne plus me demander" sur la modale de cleanup.
/// → on ne propose plus rien, on ne supprime rien non plus.
export const AUTO_CLEAN_PROMPT_DISMISSED_KEY = 'startradfr_auto_clear_prompt_dismissed';
/// Flag de test (set via console dev) — force la modal à apparaître avec
/// TOUS les caches détectés, peu importe la version actuelle de SC.
/// Permet de tester la modal sans attendre une vraie major bump.
const FORCE_CLEANUP_TEST_KEY = 'startradfr_force_cleanup_test';
/// Stores the SC "major" (X.Y) game_version(s) last seen by the auto-clean check.
/// On déclenche un cleanup à chaque vraie nouvelle Alpha SC (4.7 → 4.8 → 4.9 → 5.0),
/// pas sur les patches (4.9.0 → 4.9.1 → 4.9.2). Les patches gardent leur shader
/// cache puisque le renderer reste stable entre patches d'une même Alpha.
const AUTO_CLEAN_LAST_SEEN_MAJORS_KEY = 'startradfr_auto_clear_last_seen_majors';

interface RawVersionInfo {
    path?: string;
    game_version?: string | null;
    release_version?: string | null;
    build_number?: string | null;
    branch?: string | null;
}

interface CacheFolder {
    name: string;
    weight: string;
    path: string;
}

interface CacheInfoResponse {
    folders?: CacheFolder[];
}

export interface AutoCleanResult {
    cleared: string[];
    freedMb: number;
}

const SC_VERSION_RE = /sc-alpha-(\d+\.\d+\.\d+)/i;

function parseWeightMb(weight: string): number {
    const m = weight.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
}

export function isAutoCleanEnabled(): boolean {
    try {
        return localStorage.getItem(AUTO_CLEAN_OBSOLETE_CACHES_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setAutoCleanEnabled(enabled: boolean): void {
    try {
        if (enabled) localStorage.setItem(AUTO_CLEAN_OBSOLETE_CACHES_KEY, 'true');
        else localStorage.removeItem(AUTO_CLEAN_OBSOLETE_CACHES_KEY);
    } catch {
        // ignore
    }
}

export function isPromptDismissed(): boolean {
    try {
        return localStorage.getItem(AUTO_CLEAN_PROMPT_DISMISSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function isForceCleanupTest(): boolean {
    try {
        return localStorage.getItem(FORCE_CLEANUP_TEST_KEY) === '1';
    } catch {
        return false;
    }
}

export function setPromptDismissed(dismissed: boolean): void {
    try {
        if (dismissed) localStorage.setItem(AUTO_CLEAN_PROMPT_DISMISSED_KEY, 'true');
        else localStorage.removeItem(AUTO_CLEAN_PROMPT_DISMISSED_KEY);
    } catch {
        // ignore
    }
}

/// Extract the SC "major" version (X.Y) from a full version "X.Y.Z" or "X.Y".
/// Dans le monde Star Citizen, une "version majeure" c'est 4.7 → 4.8 → 4.9 → 5.0,
/// PAS juste le X de X.Y.Z. Les vrais patches (4.9 → 4.9.1) ne déclenchent pas
/// de cleanup, mais une nouvelle Alpha (4.8 → 4.9) oui.
/// Returns null if the string doesn't look like a version.
function extractMajor(version: string): string | null {
    const m = version.match(/^(\d+\.\d+)/);
    return m ? m[1] : null;
}

function majorsOf(installed: Set<string>): Set<string> {
    const majors = new Set<string>();
    for (const v of installed) {
        const major = extractMajor(v);
        if (major) majors.add(major);
    }
    return majors;
}

function fingerprintMajors(majors: Set<string>): string {
    return Array.from(majors).sort().join('|');
}

/// Clé legacy qui stockait la fingerprint full-version (avant le refactor major-only).
/// Conservée pour migration silencieuse au premier boot après mise à jour.
const LEGACY_LAST_SEEN_VERSIONS_KEY = 'startradfr_auto_clear_last_seen_versions';

function readLastSeenMajorsFingerprint(): string | null {
    try {
        const stored = localStorage.getItem(AUTO_CLEAN_LAST_SEEN_MAJORS_KEY);
        if (stored !== null) return stored;
        // Migration depuis l'ancienne clé : on dérive les majors des full-versions
        // pour éviter de re-prompter à tort au tout premier boot après update.
        const legacy = localStorage.getItem(LEGACY_LAST_SEEN_VERSIONS_KEY);
        if (legacy) {
            const majors = new Set<string>();
            for (const v of legacy.split('|')) {
                const major = extractMajor(v.trim());
                if (major) majors.add(major);
            }
            const migrated = Array.from(majors).sort().join('|');
            try { localStorage.setItem(AUTO_CLEAN_LAST_SEEN_MAJORS_KEY, migrated); } catch {}
            return migrated;
        }
        return null;
    } catch {
        return null;
    }
}

function writeLastSeenMajorsFingerprint(fp: string): void {
    try {
        localStorage.setItem(AUTO_CLEAN_LAST_SEEN_MAJORS_KEY, fp);
    } catch {
        // ignore
    }
}

export interface RunAutoCleanOptions {
    /// If true, ignore the "last seen versions" guard and always run the scan.
    /// Used for the manual cleanup button. Default false (= only run on version change).
    force?: boolean;
}

export interface ObsoleteCacheFolder {
    name: string;
    path: string;
    weight: string;
    weightMb: number;
    version: string;
    major: string;
}

export interface DetectionResult {
    /// True si la fingerprint des majors installés a changé depuis le dernier check
    /// (= une vraie nouvelle major version vient d'être installée). False si on est
    /// juste sur le même major mais une minor/patch différente.
    majorChanged: boolean;
    /// Fingerprint actuelle des majors installés (à persister une fois l'action prise).
    currentMajorsFingerprint: string;
    /// Liste des dossiers de cache dont la major n'est plus installée.
    folders: ObsoleteCacheFolder[];
    /// Total à libérer si on supprime tout.
    totalMb: number;
}

/// Scanne les caches et retourne la liste des dossiers obsolètes SANS rien supprimer.
/// `force = true` retourne TOUS les caches dont la major n'est plus installée, même
/// si la fingerprint n'a pas changé (utilisé pour le bouton manuel).
export async function detectObsoleteCaches(opts: RunAutoCleanOptions = {}): Promise<DetectionResult> {
    const empty: DetectionResult = {
        majorChanged: false,
        currentMajorsFingerprint: '',
        folders: [],
        totalMb: 0,
    };
    if (!isTauri()) return empty;

    const [versions, cacheInfoStr] = await Promise.all([
        invoke<Record<string, RawVersionInfo>>('get_star_citizen_versions').catch(
            () => ({} as Record<string, RawVersionInfo>),
        ),
        invoke<string>('get_cache_informations').catch(() => '{"folders":[]}'),
    ]);

    const installedVersions = new Set<string>();
    for (const v of Object.values(versions)) {
        if (v && typeof v.game_version === 'string' && v.game_version.length > 0) {
            installedVersions.add(v.game_version);
        }
    }
    const installedMajors = majorsOf(installedVersions);
    const currentMajorsFingerprint = fingerprintMajors(installedMajors);
    const forceTest = isForceCleanupTest();

    // Safety : si on n'a détecté AUCUNE version SC installée, on ne flagge rien
    // comme obsolète (sinon tous les caches seraient considérés obsolètes parce
    // que `installedMajors.has(...)` est toujours false sur un set vide).
    // Empêche le faux positif "tout est obsolète" quand SC n'est temporairement
    // pas détecté (drive non monté, RSI Launcher pas encore lancé, etc.).
    // EXCEPTION : en force test, on bypass la safety pour pouvoir tester la modal.
    if (installedMajors.size === 0 && !forceTest) {
        return { ...empty, majorChanged: false, currentMajorsFingerprint };
    }

    const lastSeen = readLastSeenMajorsFingerprint();
    let majorChanged = lastSeen !== currentMajorsFingerprint;
    // En force test, on simule une major change pour déclencher la modale.
    if (forceTest) majorChanged = true;

    // En mode auto (pas force), on ne ramène rien si le major n'a pas bougé —
    // évite de re-prompter sur chaque démarrage tant que rien n'a changé.
    if (!opts.force && !majorChanged) {
        return { ...empty, majorChanged: false, currentMajorsFingerprint };
    }

    let cacheInfo: CacheInfoResponse;
    try {
        cacheInfo = JSON.parse(cacheInfoStr);
    } catch {
        return { ...empty, majorChanged, currentMajorsFingerprint };
    }

    const folders: ObsoleteCacheFolder[] = [];
    let totalMb = 0;
    for (const folder of cacheInfo.folders ?? []) {
        const m = folder.name.match(SC_VERSION_RE);
        if (!m) continue;
        const cacheVersion = m[1];
        const cacheMajor = extractMajor(cacheVersion);
        if (!cacheMajor) continue;
        // Mode normal : garde le cache si sa "major" (X.Y) est encore installée.
        // Ex : cache 4.9.0 conservé tant qu'un 4.9.x est installé, mais
        // supprimable dès qu'on passe à 4.10 ou 5.0.
        // Mode force test : on prend TOUT pour pouvoir tester la modale.
        if (!forceTest && installedMajors.has(cacheMajor)) continue;

        const weightMb = parseWeightMb(folder.weight);
        folders.push({
            name: folder.name,
            path: folder.path,
            weight: folder.weight,
            weightMb,
            version: cacheVersion,
            major: cacheMajor,
        });
        totalMb += weightMb;
    }

    return { majorChanged, currentMajorsFingerprint, folders, totalMb };
}

/// Supprime effectivement les dossiers de cache passés en argument.
/// Met à jour la fingerprint des majors après suppression pour éviter de re-prompter.
export async function clearCacheFolders(
    folders: ObsoleteCacheFolder[],
    currentMajorsFingerprint: string,
): Promise<AutoCleanResult> {
    if (!isTauri()) return { cleared: [], freedMb: 0 };

    const cleared: string[] = [];
    let freedMb = 0;
    for (const folder of folders) {
        const ok = await invoke<boolean>('delete_folder', { path: folder.path }).catch(() => false);
        if (ok) {
            cleared.push(folder.version);
            freedMb += folder.weightMb;
        }
    }
    if (currentMajorsFingerprint) {
        writeLastSeenMajorsFingerprint(currentMajorsFingerprint);
    }
    return { cleared, freedMb };
}

/// Marque la fingerprint actuelle comme vue, sans rien supprimer.
/// Utilisé quand l'user clique "Garder" dans le modal — on ne re-prompte plus
/// tant que la major ne change pas à nouveau.
export function acknowledgeMajorsFingerprint(fp: string): void {
    if (fp) writeLastSeenMajorsFingerprint(fp);
}

/// Compat : ancienne API tout-en-un (détection + suppression silencieuse).
/// Utilisée uniquement quand `isAutoCleanEnabled()` est true (mode "ne plus demander
/// et supprimer automatiquement à chaque major change").
export async function runShaderCacheAutoClean(
    opts: RunAutoCleanOptions = {},
): Promise<AutoCleanResult> {
    const detection = await detectObsoleteCaches(opts);
    if (detection.folders.length === 0) return { cleared: [], freedMb: 0 };
    return clearCacheFolders(detection.folders, detection.currentMajorsFingerprint);
}

/// Mode silencieux historique : si l'user a explicitement activé "auto-clean"
/// (toggle dans les préférences), on supprime sans rien demander à chaque major change.
export function useShaderCacheAutoCleanOnBoot() {
    const { toast } = useToast();

    useEffect(() => {
        if (!isAutoCleanEnabled()) return;
        let cancelled = false;
        runShaderCacheAutoClean()
            .then((result) => {
                if (cancelled) return;
                if (result.cleared.length > 0) {
                    toast({
                        title: 'Caches obsolètes nettoyés',
                        description: `${result.cleared.length} cache(s) supprimé(s) (versions ${result.cleared.join(', ')}) — ${result.freedMb.toFixed(0)} Mo libérés.`,
                    });
                }
            })
            .catch((error) => {
                console.error('Erreur lors du nettoyage automatique des caches:', error);
            });
        return () => {
            cancelled = true;
        };
    }, [toast]);
}

/// Détecte au boot si un cleanup serait pertinent et expose la liste pour la modale.
/// - Ne fait rien si `isAutoCleanEnabled()` (auto silencieux) ou `isPromptDismissed()` (refusé)
/// - Sinon, scanne et retourne les candidats si majorChanged et folders > 0
/// La modale décide quoi en faire (suppression confirmée + memo "ne plus demander").
export function useDetectObsoleteCachesOnBoot(): {
    detection: DetectionResult | null;
    dismiss: () => void;
} {
    const [detection, setDetection] = useState<DetectionResult | null>(null);

    useEffect(() => {
        // Si l'auto silent est ON → useShaderCacheAutoCleanOnBoot gère, pas de modale.
        if (isAutoCleanEnabled()) return;
        // Si l'user a coché "ne plus me demander" → respect du choix, rien.
        if (isPromptDismissed()) return;

        let cancelled = false;
        detectObsoleteCaches()
            .then((result) => {
                if (cancelled) return;
                if (result.majorChanged && result.folders.length > 0) {
                    setDetection(result);
                }
            })
            .catch((error) => {
                console.error('Erreur détection caches obsolètes:', error);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return {
        detection,
        dismiss: () => setDetection(null),
    };
}
