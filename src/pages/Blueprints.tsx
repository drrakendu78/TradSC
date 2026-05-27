import { m } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    BookOpen,
    Check,
    Loader2,
    RefreshCw,
    Search,
    Eye,
    EyeOff,
    AlertCircle,
    Shield,
    ShieldOff,
    MapPin,
    Users,
    Clock,
    Hammer,
    Trophy,
    Tag,
    Briefcase,
    X,
    PictureInPicture2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { usePreferencesSyncStore } from "@/stores/preferences-sync-store";
import type { Session } from "@supabase/supabase-js";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { AutoDetectCard } from "@/components/blueprints/AutoDetectCard";

type Lang = "fr" | "en";

interface BlueprintSummary {
    id: number | null;
    classCode: string | null;
    size: number | null;
    blueprintId: string;
    nameEn: string;
    nameFr: string | null;
    locKey: string | null;
    category: string | null;
    craftTimeSeconds: number | null;
    tiers: number | null;
    defaultOwned: boolean;
    version: string | null;
}

interface IngredientOption {
    guid: string | null;
    name: string;
    nameFr: string | null;
    locKey: string | null;
    quantityScu: number | null;
    quantity: number | null;
    minQuality: number | null;
    unit: string | null;
}

interface IngredientGroup {
    slot: string;
    slotLocKey: string | null;
    slotLabelFr: string | null;
    options: IngredientOption[];
}

interface MissionInfo {
    missionId: number | null;
    nameRaw: string;
    nameFr: string | null;
    locKey: string | null;
    descriptionEn: string | null;
    descriptionFr: string | null;
    descriptionLocKey: string | null;
    contractor: string | null;
    missionType: string | null;
    category: string | null;
    lawful: boolean | null;
    notForRelease: boolean | null;
    dropChance: string | null;
    locations: string | null;
    timeToCompleteMinutes: number | null;
    minStandingName: string | null;
    minStandingReputation: number | null;
    standingReward: number | null;
}

interface BlueprintDetail extends BlueprintSummary {
    ingredients: IngredientGroup[];
    missions: MissionInfo[];
    itemStats: Record<string, unknown> | null;
}

interface ResourceHint {
    name: string;
    locKey: string | null;
}

interface ConfigPayload {
    versions: Array<{ id: number; version: string; channel: string; active: number }>;
    totalBlueprints: number | null;
    version: string | null;
    locations: string[];
    missionTypes: string[];
    contractors: string[];
    resources: ResourceHint[];
}

const OWNED_STORAGE_KEY = "blueprints_owned_v2";
const LANG_STORAGE_KEY = "blueprints_lang";
const ONLY_OWNED_STORAGE_KEY = "blueprints_only_owned";

function loadOwned(): Set<string> {
    try {
        const raw = localStorage.getItem(OWNED_STORAGE_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter((x) => typeof x === "string"));
    } catch {
        return new Set();
    }
}

function persistOwned(owned: Set<string>) {
    try {
        localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify(Array.from(owned)));
        window.dispatchEvent(new CustomEvent("blueprints-owned-changed"));
    } catch {
        // ignore
    }
}

/// Normalise un nom pour matching robuste : lowercase, sans accents, sans
/// espaces/tirets/deux-points. Permet de matcher "Jambes Morozov-SH Thule"
/// (log) avec "jambes morozov sh thule" ou variantes du catalogue.
function normalizeName(s: string | null | undefined): string {
    if (!s) return "";
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[\s\-_:.,/()]+/g, "")
        .trim();
}

/// Cherche le blueprintId correspondant à un product_name extrait du Game.log.
/// Stratégie : match exact normalisé sur nameFr puis nameEn, puis match
/// "contient" dans les deux sens (catalogue plus court ou plus long que log).
function matchProductName(
    productName: string,
    blueprints: BlueprintSummary[],
): string | null {
    const target = normalizeName(productName);
    if (!target) return null;
    // 1. Match exact normalisé
    for (const b of blueprints) {
        if (normalizeName(b.nameFr) === target || normalizeName(b.nameEn) === target) {
            return b.blueprintId;
        }
    }
    // 2. Match partiel : catalogue contient log, ou log contient catalogue
    for (const b of blueprints) {
        const fr = normalizeName(b.nameFr);
        const en = normalizeName(b.nameEn);
        if (fr && (fr.includes(target) || target.includes(fr))) return b.blueprintId;
        if (en && (en.includes(target) || target.includes(en))) return b.blueprintId;
    }
    return null;
}

function formatDuration(totalSeconds: number | null | undefined): string {
    if (totalSeconds == null) return "—";
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(" ");
}

function shortCategory(category: string | null | undefined): string {
    if (!category) return "—";
    const parts = category.split("/").map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || category;
}

const CATEGORY_FR: Record<string, string> = {
    Shield: "Bouclier",
    Cooler: "Refroidisseur",
    Quantumdrive: "Moteur Quantum",
    Powerplant: "Réacteur",
    Radar: "Radar",
    Salvage: "Salvage",
    "Tractor Beam": "Faisceau tracteur",
    "Docking Collar": "Collier d'amarrage",
    Weapons: "Armes",
    Cannon: "Canon",
    Gatling: "Gatling",
    Gun: "Canon",
    Mining: "Minage",
    Attachment: "Accessoire",
    Ballistic: "Balistique",
    Magazine: "Chargeur",
    Sniper: "Sniper",
    Heavy: "Lourde",
    Undersuit: "Sous-combinaison",
    Combat: "Combat",
    Ammo: "Munitions",
    Arms: "Bras",
    Backpack: "Sac à dos",
    Helmet: "Casque",
    Legs: "Jambes",
    Torso: "Torse",
    Misc: "Divers",
    Vehiclegear: "Équip. vaisseau",
    Personalgear: "Équip. perso",
    Armour: "Armure",
};

function categoryKey(category: string | null | undefined): string | null {
    if (!category) return null;
    const parts = category.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return parts[1];
}

function categoryLabelFr(key: string): string {
    return CATEGORY_FR[key] || key;
}

/// Nettoie les balises et placeholders du moteur CIG dans les strings localisées.
/// Exemples gérés :
///   "<EM4>[BP]</EM4> Retrieve Additional Smuggler Intel" → "[BP] Retrieve Additional Smuggler Intel"
///   "Target at ~mission(Location)" → "Target at [Lieu]"
///   "~mission(TargetName) needs stomping" → "[Cible] needs stomping"
function cleanScText(input: string | null | undefined): string {
    if (!input) return "";
    let out = input;
    // Strip <EM1>..</EM1>, <EM4>..</EM4>, etc.
    out = out.replace(/<\/?EM\d+>/gi, "");
    // Replace ~mission(X) placeholders with bracketed hints
    out = out.replace(/~mission\(Location[^)]*\)/gi, "[Lieu]");
    out = out.replace(/~mission\(Destination[^)]*\)/gi, "[Destination]");
    out = out.replace(/~mission\(TargetName[^)]*\)/gi, "[Cible]");
    out = out.replace(/~mission\(StoreName[^)]*\)/gi, "[Magasin]");
    out = out.replace(/~mission\(System[^)]*\)/gi, "[Système]");
    out = out.replace(/~mission\([^)]+\)/g, "[…]");
    // Collapse multiple spaces
    out = out.replace(/\s{2,}/g, " ").trim();
    return out;
}

function extractSize(b: BlueprintSummary): number | null {
    return b.size ?? null;
}

type BlueprintClass = "civi" | "mili" | "indu" | "stlh" | "comp";

const CLASS_PREFIX_MAP: Record<string, BlueprintClass> = {
    Civ: "civi",
    Civi: "civi",
    Mil: "mili",
    Mili: "mili",
    Ind: "indu",
    Indu: "indu",
    Stl: "stlh",
    Stlh: "stlh",
    Cmp: "comp",
    Comp: "comp",
};

/// Resolves the class for a blueprint. Priority:
///   1. backend `classCode` (from global.ini "Classe :" description)
///   2. fallback to prefix in the EN name ("Mil/1/D Charger" → mili)
function resolveClass(b: BlueprintSummary): BlueprintClass | null {
    const code = b.classCode;
    if (code === "civi" || code === "mili" || code === "indu" || code === "stlh" || code === "comp") {
        return code;
    }
    const m = b.nameEn?.match(/^(Civ|Civi|Mil|Mili|Ind|Indu|Stl|Stlh|Cmp|Comp)\b/);
    if (m) {
        return CLASS_PREFIX_MAP[m[1]] ?? null;
    }
    return null;
}

const CLASS_LABEL_FR: Record<BlueprintClass, string> = {
    civi: "Civil",
    mili: "Militaire",
    indu: "Industriel",
    stlh: "Furtif",
    comp: "Compétition",
};

const CLASS_BADGE_COLOR: Record<BlueprintClass, string> = {
    civi: "border-sky-400/55 bg-sky-400/20 text-sky-200",
    mili: "border-red-400/55 bg-red-400/20 text-red-200",
    indu: "border-amber-400/55 bg-amber-400/20 text-amber-200",
    stlh: "border-violet-400/55 bg-violet-400/20 text-violet-200",
    comp: "border-emerald-400/55 bg-emerald-400/20 text-emerald-200",
};

const MISSION_TYPE_FR: Record<string, string> = {
    "Bounty Hunter": "Chasse à prime",
    Collection: "Collecte",
    Courier: "Coursier",
    Delivery: "Livraison",
    Event: "Événement",
    "Hand Mining": "Minage à pied",
    Hauling: "Transport",
    "Hauling - Interstellar": "Transport interstellaire",
    Investigation: "Enquête",
    Mercenary: "Mercenaire",
    Priority: "Priorité",
    Refueling: "Ravitaillement",
    Salvage: "Récupération",
    "Ship Mining": "Minage vaisseau",
    "Wikelo - Other Items": "Wikelo — autres",
};

function missionTypeLabelFr(key: string): string {
    return MISSION_TYPE_FR[key] || key;
}

const SYSTEM_FR_SUFFIX: Record<string, string> = {
    "Stanton System": "Système Stanton",
    "Pyro System": "Système Pyro",
    "Nyx System": "Système Nyx",
};

function locationLabelFr(key: string): string {
    if (SYSTEM_FR_SUFFIX[key]) return SYSTEM_FR_SUFFIX[key];
    return key.replace(/\s+\/\s+/g, " / ");
}

const CONTRACTOR_FR: Record<string, string> = {
    "Bounty Hunters Guild": "Guilde des chasseurs de primes",
    "Dead Saints": "Dead Saints",
    "Headhunters": "Headhunters",
    "Highpoint Wilderness Specialists": "Spécialistes Highpoint",
    "FTL Courier": "FTL Courier",
    "Ling Family Hauling": "Transport familial Ling",
};

function contractorLabelFr(key: string): string {
    return CONTRACTOR_FR[key] || key;
}

interface CompactSelectProps {
    icon: React.ReactNode;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    options: string[];
    allLabel?: string;
    renderOption?: (v: string) => string;
    active?: boolean;
}

function CompactSelect({
    icon,
    placeholder,
    value,
    onChange,
    options,
    allLabel,
    renderOption,
    active,
}: CompactSelectProps) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger
                className={`h-8 w-[150px] shrink-0 gap-1.5 text-xs ${
                    active ? "border-primary/55 bg-[hsl(var(--primary)/0.14)]" : ""
                }`}
            >
                <span className="shrink-0 opacity-70">{icon}</span>
                <span className="truncate">
                    {value === "all"
                        ? placeholder
                        : renderOption
                          ? renderOption(value)
                          : value}
                </span>
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">Tous{allLabel ? ` (${allLabel.toLowerCase()})` : ""}</SelectItem>
                {options.map((o) => (
                    <SelectItem key={o} value={o}>
                        {renderOption ? renderOption(o) : o}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function rootSystem(locations: string | null | undefined): string | null {
    if (!locations) return null;
    const first = locations.split(",")[0]?.trim();
    if (!first) return null;
    return first.split("/")[0]?.trim() ?? first;
}

function systemBadgeColor(system: string | null): string {
    switch (system) {
        case "Stanton":
            return "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
        case "Pyro":
            return "border-orange-400/40 bg-orange-400/10 text-orange-300";
        case "Nyx":
            return "border-purple-400/40 bg-purple-400/10 text-purple-300";
        default:
            return "border-border/40 bg-background/30 text-muted-foreground";
    }
}

interface BlueprintsProps {
    /** Si true, page rendue en mode overlay détaché (fenêtre Tauri séparée,
     *  route /overlay-blueprints). Active fond transparent + cache l'auto-detect
     *  card pour gagner de la place. Sinon (false, par défaut), rendu normal
     *  dans l'app principale avec un bouton "Open Overlay" supplémentaire. */
    isOverlayEmbed?: boolean;
}

export default function Blueprints({ isOverlayEmbed = false }: BlueprintsProps = {}) {
    const { toast } = useToast();
    const [config, setConfig] = useState<ConfigPayload | null>(null);
    const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Track si l'overlay détaché est ouvert. Pour l'instant on n'affiche pas
    // de placeholder (l'user peut utiliser les 2 en parallèle), mais on garde
    // le state pour pouvoir l'utiliser plus tard (re-focus button, etc.).
    const [, setIsDetachedToOverlay] = useState(false);

    // Mode overlay : force le body/html transparent pour que la fenêtre
    // Tauri laisse voir le jeu derrière. Même pattern que Pvp.tsx.
    useEffect(() => {
        if (!isOverlayEmbed) return;
        const html = document.documentElement;
        const body = document.body;
        const root = document.getElementById("root");
        const prevHtmlBg = html.style.background;
        const prevBodyBg = body.style.background;
        const prevRootBg = root?.style.background ?? "";
        html.style.setProperty("background", "transparent", "important");
        body.style.setProperty("background", "transparent", "important");
        if (root) root.style.setProperty("background", "transparent", "important");
        const style = document.createElement("style");
        style.id = "blueprints-overlay-transparent-fix";
        style.textContent = `
            html, body, #root {
                background: transparent !important;
                background-color: transparent !important;
            }
            #root::before {
                display: none !important;
                background: transparent !important;
            }
        `;
        document.head.appendChild(style);
        return () => {
            style.remove();
            html.style.background = prevHtmlBg;
            body.style.background = prevBodyBg;
            if (root) root.style.background = prevRootBg;
        };
    }, [isOverlayEmbed]);

    // Listen close de l'overlay détaché → revient au mode normal embed dans
    // l'app principale (sans nécessité de refresh manuel).
    useEffect(() => {
        if (isOverlayEmbed) return;
        let unlisten: (() => void) | undefined;
        listen<{ id: string }>("overlay_closed", (event) => {
            if (event.payload?.id !== "blueprints") return;
            setIsDetachedToOverlay(false);
        })
            .then((fn) => { unlisten = fn; })
            .catch(console.error);
        return () => {
            if (unlisten) unlisten();
        };
    }, [isOverlayEmbed]);

    const handleOpenOverlay = useCallback(async () => {
        try {
            const overlayUrl = `${window.location.origin}${window.location.pathname}#/overlay-blueprints`;
            await invoke("open_overlay", {
                id: "blueprints",
                url: overlayUrl,
                x: 120.0,
                y: 120.0,
                width: 1100.0,
                height: 820.0,
                opacity: 1.0,
            });
            if (!isOverlayEmbed) setIsDetachedToOverlay(true);
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: "Impossible d'ouvrir Blueprints en overlay.",
                variant: "destructive",
            });
        }
    }, [isOverlayEmbed, toast]);
    const [search, setSearch] = useState("");
    const [locationFilter, setLocationFilter] = useState<string>("all");
    const [contractorFilter, setContractorFilter] = useState<string>("all");
    const [missionTypeFilter, setMissionTypeFilter] = useState<string>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [lawfulFilter, setLawfulFilter] = useState<"all" | "lawful" | "unlawful">("all");
    const [onlyOwned, setOnlyOwned] = useState<boolean>(() => {
        try {
            return localStorage.getItem(ONLY_OWNED_STORAGE_KEY) === "true";
        } catch {
            return false;
        }
    });
    const [lang, setLang] = useState<Lang>(() => {
        try {
            const v = localStorage.getItem(LANG_STORAGE_KEY);
            return v === "en" ? "en" : "fr";
        } catch {
            return "fr";
        }
    });
    const [owned, setOwned] = useState<Set<string>>(() => loadOwned());
    const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
    const [detail, setDetail] = useState<BlueprintDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [cloudStatus, setCloudStatus] = useState<"idle" | "syncing" | "saved" | "error">(
        "idle",
    );
    const filtersSnapshotRef = useRef<{
        search: string;
        locationFilter: string;
        contractorFilter: string;
        missionTypeFilter: string;
        categoryFilter: string;
        lawfulFilter: "all" | "lawful" | "unlawful";
    } | null>(null);
    const loadFromCloud = usePreferencesSyncStore((s) => s.loadFromCloud);
    const saveToCloud = usePreferencesSyncStore((s) => s.saveToCloud);

    const fetchConfig = useCallback(async () => {
        try {
            const cfg = await invoke<ConfigPayload>("blueprints_config");
            setConfig(cfg);
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            console.warn("[blueprints] config fetch failed:", message);
        }
    }, []);

    const fetchList = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            // Les filtres serveur (système / contractor / mission / UEE) demandent
            // sc-craft (capé à 100 items). La recherche reste client-side sur le full list.
            const hasServerFilter =
                locationFilter !== "all" ||
                contractorFilter !== "all" ||
                missionTypeFilter !== "all" ||
                lawfulFilter !== "all";
            let list: BlueprintSummary[];
            if (hasServerFilter) {
                const filters = {
                    location: locationFilter === "all" ? undefined : locationFilter,
                    contractor:
                        contractorFilter === "all" ? undefined : contractorFilter,
                    missionType:
                        missionTypeFilter === "all" ? undefined : missionTypeFilter,
                    lawful:
                        lawfulFilter === "lawful"
                            ? 1
                            : lawfulFilter === "unlawful"
                              ? 0
                              : undefined,
                };
                list = await invoke<BlueprintSummary[]>("blueprints_list", { filters });
            } else {
                list = await invoke<BlueprintSummary[]>("blueprints_list_full");
            }
            setBlueprints(list);
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            setLoadError(message);
            toast({
                title: "Impossible de charger les blueprints",
                description: message,
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, locationFilter, contractorFilter, missionTypeFilter, lawfulFilter]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        const t = setTimeout(() => {
            fetchList();
        }, 250);
        return () => clearTimeout(t);
    }, [fetchList]);

    // Refresh erkul classes (shields/coolers/QDs/weapons) en arrière-plan.
    // Update le cache disque ; les prochains loads bénéficient des nouvelles classes.
    useEffect(() => {
        const t = setTimeout(() => {
            invoke<number>("blueprints_refresh_erkul_classes")
                .then((n) => {
                    if (n > 0) {
                        console.log(`[blueprints] erkul classes loaded: ${n}`);
                    }
                })
                .catch((e) =>
                    console.warn("[blueprints] erkul refresh failed:", e),
                );
            // Telecharge les global.ini canoniques (PolyTool) en arriere-plan.
            // Garantit la meme couverture FR/EN pour tous les users, peu importe
            // le pack de traduction qu'ils ont installe (StarTrad, Circuspes, etc.)
            invoke("blueprints_refresh_polytool_globals")
                .then(() => console.log("[blueprints] polytool globals refreshed"))
                .catch((e) =>
                    console.warn("[blueprints] polytool refresh failed:", e),
                );
        }, 3000);
        return () => clearTimeout(t);
    }, []);

    // Stale-while-revalidate : après le chargement initial (cache instantané),
    // on re-fetch en arrière-plan pour détecter les nouveaux blueprints.
    // Pas de blocage UI, pas de bouton.
    const hasFilteredViewRef = useRef(false);
    hasFilteredViewRef.current =
        locationFilter !== "all" ||
        contractorFilter !== "all" ||
        missionTypeFilter !== "all" ||
        lawfulFilter !== "all";
    useEffect(() => {
        // Ne pas revalider si on est en vue filtrée (sc-craft, pas concerné par le cache scunpacked)
        if (hasFilteredViewRef.current) return;
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const result = await invoke<{
                    list: BlueprintSummary[];
                    newCount: number;
                    removedCount: number;
                    changed: boolean;
                }>("blueprints_revalidate_full");
                if (cancelled) return;
                // Toujours mettre à jour : même si les IDs n'ont pas bougé, les noms /
                // catégories / loc_keys peuvent avoir évolué côté sccrafter.
                setBlueprints(result.list);
                if (result.newCount > 0) {
                    toast({
                        title: `${result.newCount} nouveau${result.newCount > 1 ? "x" : ""} blueprint${result.newCount > 1 ? "s" : ""}`,
                        description:
                            "La liste a été mise à jour depuis sccrafter.",
                    });
                }
            } catch (e) {
                console.warn("[blueprints] revalidate failed:", e);
            }
        }, 1500);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [toast, locationFilter, contractorFilter, missionTypeFilter, lawfulFilter]);

    useEffect(() => {
        try {
            localStorage.setItem(LANG_STORAGE_KEY, lang);
        } catch {
            // ignore
        }
    }, [lang]);

    useEffect(() => {
        try {
            localStorage.setItem(ONLY_OWNED_STORAGE_KEY, String(onlyOwned));
        } catch {
            // ignore
        }
    }, [onlyOwned]);

    // Track Supabase session
    useEffect(() => {
        let mounted = true;
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (mounted) setSession(session);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
            setSession(sess);
        });
        return () => {
            mounted = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    // On login : pull cloud, merge avec local (union) — jamais de perte
    useEffect(() => {
        if (!session?.user?.id) return;
        let cancelled = false;
        (async () => {
            setCloudStatus("syncing");
            const prefs = await loadFromCloud(session.user.id);
            if (cancelled) return;
            const cloudOwned = prefs?.blueprints?.owned ?? [];
            if (cloudOwned.length === 0) {
                setCloudStatus("saved");
                return;
            }
            setOwned((prev) => {
                const merged = new Set(prev);
                let added = 0;
                for (const id of cloudOwned) {
                    if (!merged.has(id)) {
                        merged.add(id);
                        added++;
                    }
                }
                if (added > 0) {
                    persistOwned(merged);
                }
                return merged;
            });
            setCloudStatus("saved");
        })().catch((err) => {
            console.warn("[blueprints] cloud pull failed:", err);
            setCloudStatus("error");
        });
        return () => {
            cancelled = true;
        };
    }, [session?.user?.id, loadFromCloud]);

    // Auto-push debounced : si user connecté, push les owned dès qu'ils changent
    useEffect(() => {
        if (!session?.user?.id) return;
        const userId = session.user.id;
        const handle = setTimeout(async () => {
            setCloudStatus("syncing");
            const ok = await saveToCloud(userId);
            setCloudStatus(ok ? "saved" : "error");
        }, 1500);
        return () => clearTimeout(handle);
    }, [owned, session?.user?.id, saveToCloud]);

    // Cross-tab sync : si une autre fenêtre/skill modifie localStorage, on rafraîchit
    useEffect(() => {
        const handler = () => setOwned(loadOwned());
        window.addEventListener("blueprints-owned-changed", handler);
        const storageHandler = (e: StorageEvent) => {
            if (e.key === OWNED_STORAGE_KEY) setOwned(loadOwned());
        };
        window.addEventListener("storage", storageHandler);
        return () => {
            window.removeEventListener("blueprints-owned-changed", handler);
            window.removeEventListener("storage", storageHandler);
        };
    }, []);

    // Auto-tick depuis le watcher Game.log :
    //   - au mount (quand catalogue chargé) on matche les détectés persistés
    //     avec sc-craft et on push dans owned (union, jamais de décochage)
    //   - en live on écoute gamelog-watcher:blueprint pour cocher direct
    // Le matching utilise normalizeName + fallback "contient" (cf. helpers).
    useEffect(() => {
        if (blueprints.length === 0) return;
        let cancelled = false;

        const syncFromStore = async () => {
            try {
                const store = await invoke<{
                    blueprints: { productName: string; ts: number }[];
                }>("gamelog_blueprints_load");
                if (cancelled) return;
                setOwned((prev) => {
                    const next = new Set(prev);
                    let added = 0;
                    for (const detected of store.blueprints) {
                        const id = matchProductName(detected.productName, blueprints);
                        if (id && !next.has(id)) {
                            next.add(id);
                            added++;
                        }
                    }
                    if (added > 0) {
                        persistOwned(next);
                        console.log(`[blueprints] auto-cocheé ${added} schéma(s) depuis le watcher`);
                    }
                    return added > 0 ? next : prev;
                });
            } catch (e) {
                console.warn("[blueprints] auto-tick sync failed:", e);
            }
        };

        syncFromStore();

        const unlistenPromise = listen<{ productName: string; ts: number }>(
            "gamelog-watcher:blueprint",
            (event) => {
                const id = matchProductName(event.payload.productName, blueprints);
                if (!id) {
                    console.warn(
                        `[blueprints] schéma détecté sans match catalogue : ${event.payload.productName}`,
                    );
                    return;
                }
                setOwned((prev) => {
                    if (prev.has(id)) return prev;
                    const next = new Set(prev);
                    next.add(id);
                    persistOwned(next);
                    toast({
                        title: "Schéma coché automatiquement",
                        description: event.payload.productName,
                    });
                    return next;
                });
            },
        );

        return () => {
            cancelled = true;
            unlistenPromise.then((f) => f());
        };
    }, [blueprints, toast]);

    const categoryOptions = useMemo(() => {
        const set = new Set<string>();
        for (const b of blueprints) {
            const k = categoryKey(b.category);
            if (k) set.add(k);
        }
        return Array.from(set).sort();
    }, [blueprints]);

    const displayedBlueprints = useMemo(() => {
        const q = search.trim().toLowerCase();
        return blueprints.filter((b) => {
            if (onlyOwned && !owned.has(b.blueprintId)) return false;
            if (categoryFilter !== "all" && categoryKey(b.category) !== categoryFilter)
                return false;
            if (q) {
                const hay = [
                    b.blueprintId,
                    b.nameEn,
                    b.nameFr ?? "",
                    b.category ?? "",
                ]
                    .join(" ")
                    .toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [blueprints, onlyOwned, owned, categoryFilter, search]);

    const total = Math.max(blueprints.length, config?.totalBlueprints ?? 0);
    const ownedCount = useMemo(
        () => blueprints.reduce((acc, b) => (owned.has(b.blueprintId) ? acc + 1 : acc), 0),
        [blueprints, owned],
    );
    const progress = total > 0 ? (ownedCount / total) * 100 : 0;

    const toggleOwned = useCallback((blueprintId: string) => {
        setOwned((prev) => {
            const next = new Set(prev);
            if (next.has(blueprintId)) next.delete(blueprintId);
            else next.add(blueprintId);
            persistOwned(next);
            return next;
        });
    }, []);

    const selectBlueprint = useCallback(async (entry: BlueprintSummary) => {
        console.log("[blueprints] click row:", entry.blueprintId, "id:", entry.id);
        setSelectedBlueprintId(entry.blueprintId);
        setDetail(null);
        setDetailError(null);
        setDetailLoading(true);
        try {
            // Si on vient de scunpacked, id est null : on résout via sc-craft search
            let numericId = entry.id;
            if (numericId == null) {
                console.log("[blueprints] resolving sc-craft id for", entry.blueprintId);
                numericId = await invoke<number | null>("blueprint_resolve_sc_craft_id", {
                    blueprintId: entry.blueprintId,
                });
                console.log("[blueprints] resolved to:", numericId);
                if (numericId == null) {
                    throw new Error(
                        "Ce blueprint n'est pas référencé dans sc-craft.tools — détails enrichis indisponibles.",
                    );
                }
            }
            console.log("[blueprints] fetching detail id:", numericId);
            const value = await invoke<BlueprintDetail>("blueprint_detail", {
                blueprintInternalId: numericId,
            });
            console.log("[blueprints] detail loaded:", value?.blueprintId);
            setDetail(value);
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            console.error("[blueprints] select failed:", message);
            setDetailError(message);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const displayName = (b: BlueprintSummary): string => {
        const fr = b.nameFr;
        const en = b.nameEn;
        if (lang === "fr") return fr || en || b.blueprintId;
        return en || fr || b.blueprintId;
    };

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3 overflow-y-auto pr-2">
                {/* HEADER */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                                <BookOpen className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">
                                        Collection de blueprints
                                    </h1>
                                    <Badge
                                        variant="outline"
                                        className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]"
                                    >
                                        {blueprints.length} chargé{blueprints.length > 1 ? "s" : ""}
                                    </Badge>
                                    {config?.version && (
                                        <Badge
                                            variant="outline"
                                            className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]"
                                        >
                                            {config.version}
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">
                                    Source : sc-craft.tools · noms FR via global.ini local
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 text-sm tabular-nums">
                                <span>
                                    <span className="font-semibold text-foreground">{ownedCount}</span>
                                    <span className="text-muted-foreground"> / {total}</span>
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                    ({progress.toFixed(1)}%)
                                </span>
                            </div>
                            <div className="h-2 w-44 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-gradient-to-r from-primary/60 to-primary transition-all"
                                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                                />
                            </div>
                            {session?.user && (
                                <div
                                    title={
                                        cloudStatus === "syncing"
                                            ? "Synchronisation cloud en cours…"
                                            : cloudStatus === "saved"
                                              ? "Synchronisé avec ton compte StarTrad"
                                              : cloudStatus === "error"
                                                ? "Erreur de synchronisation cloud (le local reste OK)"
                                                : "Cloud prêt"
                                    }
                                    className={`flex h-8 w-8 items-center justify-center rounded-lg border text-[10.5px] ${
                                        cloudStatus === "syncing"
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : cloudStatus === "error"
                                              ? "border-red-400/40 bg-red-400/10 text-red-300"
                                              : "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
                                    }`}
                                >
                                    {cloudStatus === "syncing" ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : cloudStatus === "error" ? (
                                        <AlertCircle className="h-3.5 w-3.5" />
                                    ) : (
                                        <Check className="h-3.5 w-3.5" />
                                    )}
                                </div>
                            )}
                            {!isOverlayEmbed && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleOpenOverlay}
                                    className="h-8 gap-1.5 rounded-lg border border-border/50 bg-background/22 px-3 text-[11.5px] text-foreground/85 transition-all hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground"
                                    title="Ouvrir Blueprints en overlay (par-dessus le jeu)"
                                >
                                    <PictureInPicture2 className="h-3.5 w-3.5" />
                                    Overlay
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={fetchList}
                                disabled={isLoading}
                                className="h-8 w-8 rounded-lg border border-border/50 bg-background/22 p-0 text-foreground/85 transition-all hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground"
                                title="Recharger la liste"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" />
                </section>

                {/* AUTO-DETECT SERVICE — caché en mode overlay (déjà géré
                 *  par le toggle dans Paramètres, occupe trop de place ici). */}
                {!isOverlayEmbed && <AutoDetectCard />}

                {/* FILTERS */}
                <section className="relative overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,hsl(var(--primary)/0.10),transparent_62%)]" />
                    <div className="relative flex items-center gap-1.5 overflow-x-auto p-2">
                        <div className="relative w-[180px] shrink-0">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Rechercher…"
                                className="h-8 px-7 text-xs"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch("")}
                                    title="Effacer la recherche"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                        <CompactSelect
                            icon={<MapPin className="h-3 w-3" />}
                            placeholder="Système"
                            value={locationFilter}
                            onChange={setLocationFilter}
                            options={config?.locations ?? []}
                            renderOption={(c) => (lang === "fr" ? locationLabelFr(c) : c)}
                            allLabel="Système"
                            active={locationFilter !== "all"}
                        />
                        <CompactSelect
                            icon={<Users className="h-3 w-3" />}
                            placeholder="Contractor"
                            value={contractorFilter}
                            onChange={setContractorFilter}
                            options={config?.contractors ?? []}
                            renderOption={(c) => (lang === "fr" ? contractorLabelFr(c) : c)}
                            allLabel="Contractor"
                            active={contractorFilter !== "all"}
                        />
                        <CompactSelect
                            icon={<Tag className="h-3 w-3" />}
                            placeholder="Catégorie"
                            value={categoryFilter}
                            onChange={setCategoryFilter}
                            options={categoryOptions}
                            renderOption={(c) => (lang === "fr" ? categoryLabelFr(c) : c)}
                            allLabel="Catégorie"
                            active={categoryFilter !== "all"}
                        />
                        <CompactSelect
                            icon={<Briefcase className="h-3 w-3" />}
                            placeholder="Type"
                            value={missionTypeFilter}
                            onChange={setMissionTypeFilter}
                            options={config?.missionTypes ?? []}
                            renderOption={(c) => (lang === "fr" ? missionTypeLabelFr(c) : c)}
                            allLabel="Type"
                            active={missionTypeFilter !== "all"}
                        />
                        <Select
                            value={lawfulFilter}
                            onValueChange={(v) => setLawfulFilter(v as typeof lawfulFilter)}
                        >
                            <SelectTrigger
                                className={`h-8 w-[130px] shrink-0 gap-1.5 text-xs ${
                                    lawfulFilter !== "all"
                                        ? "border-primary/55 bg-[hsl(var(--primary)/0.14)]"
                                        : ""
                                }`}
                            >
                                <Shield className="h-3 w-3 shrink-0 opacity-70" />
                                <span className="truncate">
                                    {lawfulFilter === "lawful"
                                        ? "Légal"
                                        : lawfulFilter === "unlawful"
                                          ? "Illégal"
                                          : "Statut UEE"}
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Tous (statut UEE)</SelectItem>
                                <SelectItem value="lawful">Légal</SelectItem>
                                <SelectItem value="unlawful">Illégal</SelectItem>
                            </SelectContent>
                        </Select>
                        <button
                            onClick={() => {
                                setOnlyOwned((v) => {
                                    const next = !v;
                                    if (next) {
                                        // Activation : snapshot des filtres puis reset
                                        filtersSnapshotRef.current = {
                                            search,
                                            locationFilter,
                                            contractorFilter,
                                            missionTypeFilter,
                                            categoryFilter,
                                            lawfulFilter,
                                        };
                                        setSearch("");
                                        setLocationFilter("all");
                                        setContractorFilter("all");
                                        setMissionTypeFilter("all");
                                        setCategoryFilter("all");
                                        setLawfulFilter("all");
                                    } else {
                                        // Désactivation : restaure les filtres précédents
                                        const snap = filtersSnapshotRef.current;
                                        if (snap) {
                                            setSearch(snap.search);
                                            setLocationFilter(snap.locationFilter);
                                            setContractorFilter(snap.contractorFilter);
                                            setMissionTypeFilter(snap.missionTypeFilter);
                                            setCategoryFilter(snap.categoryFilter);
                                            setLawfulFilter(snap.lawfulFilter);
                                            filtersSnapshotRef.current = null;
                                        }
                                    }
                                    return next;
                                });
                            }}
                            title={onlyOwned ? "Afficher tous" : "Afficher seulement les possédés"}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-all ${
                                onlyOwned
                                    ? "border-primary/55 bg-[hsl(var(--primary)/0.18)] text-primary"
                                    : "border-border/50 bg-background/20 text-muted-foreground hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground"
                            }`}
                        >
                            {onlyOwned ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/55 bg-background/22 p-0.5">
                            <button
                                onClick={() => setLang("fr")}
                                className={`flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-[10.5px] font-medium transition-colors ${
                                    lang === "fr"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                FR
                            </button>
                            <button
                                onClick={() => setLang("en")}
                                className={`flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-[10.5px] font-medium transition-colors ${
                                    lang === "en"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                EN
                            </button>
                        </div>
                    </div>
                </section>

                <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    <span>
                        {displayedBlueprints.length} affiché{displayedBlueprints.length > 1 ? "s" : ""}
                    </span>
                    <span>·</span>
                    <span>Cliquez sur un blueprint pour voir les détails</span>
                </div>

                {/* MAIN: TABLE + DETAIL */}
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_420px]">
                    <section className="relative flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_100%,hsl(var(--primary)/0.06),transparent_64%)]" />
                        {isLoading && blueprints.length === 0 ? (
                            <div className="relative flex h-full items-center justify-center p-10">
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                    <p className="text-xs text-muted-foreground">
                                        Récupération des blueprints depuis sc-craft.tools…
                                    </p>
                                </div>
                            </div>
                        ) : loadError ? (
                            <div className="relative flex h-full items-center justify-center p-6">
                                <div className="flex max-w-md flex-col items-center gap-3 text-center">
                                    <AlertCircle className="h-8 w-8 text-destructive" />
                                    <p className="text-sm">Impossible de charger la liste.</p>
                                    <p className="text-xs text-muted-foreground">{loadError}</p>
                                    <Button size="sm" onClick={fetchList}>
                                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Réessayer
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative flex-1 min-h-0 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                                        <tr className="border-b border-border/50 text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                                            <th className="w-9 px-3 py-2"></th>
                                            <th className="px-2 py-2">Blueprint</th>
                                            <th className="px-2 py-2">Catégorie</th>
                                            <th className="px-2 py-2 text-right">Craft</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayedBlueprints.map((b) => {
                                            const isSelected = b.blueprintId === selectedBlueprintId;
                                            const isOwned = owned.has(b.blueprintId);
                                            const fallback =
                                                lang === "fr" && !b.nameFr && !b.nameEn
                                                    ? "italic text-muted-foreground"
                                                    : "";
                                            return (
                                                <tr
                                                    key={b.blueprintId}
                                                    data-no-drag
                                                    onClick={() => selectBlueprint(b)}
                                                    className={`group cursor-pointer border-b border-border/25 transition-colors hover:bg-primary/[0.06] ${
                                                        isSelected
                                                            ? "bg-primary/[0.10]"
                                                            : ""
                                                    }`}
                                                >
                                                    <td
                                                        className="px-3 py-1.5"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <Checkbox
                                                            checked={isOwned}
                                                            onCheckedChange={() =>
                                                                toggleOwned(b.blueprintId)
                                                            }
                                                        />
                                                    </td>
                                                    <td className="px-2 py-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`truncate ${fallback}`}>
                                                                {displayName(b)}
                                                            </div>
                                                            {(() => {
                                                                const size = extractSize(b);
                                                                return size != null ? (
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="h-5 shrink-0 px-1.5 text-[10.5px] font-semibold border-primary/60 bg-primary/20 text-primary"
                                                                    >
                                                                        T{size}
                                                                    </Badge>
                                                                ) : null;
                                                            })()}
                                                            {(() => {
                                                                const cls = resolveClass(b);
                                                                return cls ? (
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={`h-5 shrink-0 px-1.5 text-[10.5px] font-semibold ${CLASS_BADGE_COLOR[cls]}`}
                                                                    >
                                                                        {CLASS_LABEL_FR[cls]}
                                                                    </Badge>
                                                                ) : null;
                                                            })()}
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-1.5 text-muted-foreground">
                                                        <span className="text-[12px]">
                                                            {shortCategory(b.category)}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right text-[11px] text-muted-foreground tabular-nums">
                                                        {formatDuration(b.craftTimeSeconds)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {displayedBlueprints.length === 0 && !isLoading && (
                                    <div className="p-10 text-center text-sm text-muted-foreground">
                                        Aucun blueprint ne correspond aux filtres.
                                    </div>
                                )}
                                {isLoading && blueprints.length > 0 && (
                                    <div className="absolute inset-x-0 top-0 z-20 flex justify-center p-2">
                                        <div className="flex items-center gap-2 rounded-full border border-border/50 bg-background/85 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Mise à jour…
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    {/* DETAIL PANEL */}
                    <DetailPanel
                        selectedId={selectedBlueprintId}
                        detail={detail}
                        loading={detailLoading}
                        error={detailError}
                        lang={lang}
                        owned={owned}
                        onToggleOwned={toggleOwned}
                    />
                </div>
            </div>
        </m.div>
    );
}

interface DetailPanelProps {
    selectedId: string | null;
    detail: BlueprintDetail | null;
    loading: boolean;
    error: string | null;
    lang: Lang;
    owned: Set<string>;
    onToggleOwned: (blueprintId: string) => void;
}

function DetailPanel({
    selectedId,
    detail,
    loading,
    error,
    lang,
    owned,
    onToggleOwned,
}: DetailPanelProps) {
    return (
        <section className="relative flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_100%_0%,hsl(var(--primary)/0.10),transparent_60%)]" />
            <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),transparent)] px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                    <Hammer className="h-3.5 w-3.5 text-primary" />
                    Détail du blueprint
                </h2>
            </div>

            {selectedId == null ? (
                <div className="relative flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
                    Sélectionne un blueprint dans la liste pour voir ses détails, missions,
                    ingrédients et statut.
                </div>
            ) : loading ? (
                <div className="relative flex flex-1 items-center justify-center p-8">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
            ) : error ? (
                <div className="relative flex flex-1 items-center justify-center p-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                        <AlertCircle className="h-6 w-6 text-destructive" />
                        <p className="text-xs text-muted-foreground">{error}</p>
                    </div>
                </div>
            ) : detail ? (
                <DetailBody
                    detail={detail}
                    lang={lang}
                    isOwned={owned.has(detail.blueprintId)}
                    onToggleOwned={() => onToggleOwned(detail.blueprintId)}
                />
            ) : null}
        </section>
    );
}

function DetailBody({
    detail,
    lang,
    isOwned,
    onToggleOwned,
}: {
    detail: BlueprintDetail;
    lang: Lang;
    isOwned: boolean;
    onToggleOwned: () => void;
}) {
    const displayName =
        lang === "fr"
            ? detail.nameFr || detail.nameEn || detail.blueprintId
            : detail.nameEn || detail.nameFr || detail.blueprintId;

    const systems = useMemo(() => {
        const set = new Set<string>();
        for (const m of detail.missions) {
            const s = rootSystem(m.locations);
            if (s) set.add(s);
        }
        return Array.from(set).sort();
    }, [detail.missions]);

    const allLawful = useMemo(() => {
        if (detail.missions.length === 0) return null;
        const lawValues = detail.missions
            .map((m) => m.lawful)
            .filter((v) => v !== null);
        if (lawValues.length === 0) return null;
        if (lawValues.every((v) => v === true)) return true;
        if (lawValues.every((v) => v === false)) return false;
        return null; // mixed
    }, [detail.missions]);

    return (
        <div className="relative flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-sm">
            {/* Title block */}
            <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Blueprint
                </div>
                <div className="text-lg font-semibold leading-tight text-primary">
                    {displayName}
                </div>
                {detail.nameFr && detail.nameEn && detail.nameFr !== detail.nameEn && (
                    <div className="text-[11px] text-muted-foreground">
                        {lang === "fr" ? `EN : ${detail.nameEn}` : `FR : ${detail.nameFr}`}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {systems.map((sys) => (
                        <Badge
                            key={sys}
                            variant="outline"
                            className={`h-5 gap-1 px-1.5 text-[10px] ${systemBadgeColor(sys)}`}
                        >
                            <MapPin className="h-2.5 w-2.5" /> {sys}
                        </Badge>
                    ))}
                    {allLawful === true && (
                        <Badge
                            variant="outline"
                            className="h-5 gap-1 px-1.5 text-[10px] border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                        >
                            <Shield className="h-2.5 w-2.5" /> UEE légal
                        </Badge>
                    )}
                    {allLawful === false && (
                        <Badge
                            variant="outline"
                            className="h-5 gap-1 px-1.5 text-[10px] border-red-400/40 bg-red-400/10 text-red-300"
                        >
                            <ShieldOff className="h-2.5 w-2.5" /> Illégal
                        </Badge>
                    )}
                    {allLawful === null && detail.missions.length > 0 && (
                        <Badge
                            variant="outline"
                            className="h-5 gap-1 px-1.5 text-[10px] border-amber-400/40 bg-amber-400/10 text-amber-300"
                        >
                            <Shield className="h-2.5 w-2.5" /> Statut mixte
                        </Badge>
                    )}
                </div>
            </div>

            <Separator />

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Catégorie</div>
                    <div className="break-words">{detail.category || "—"}</div>
                </div>
                <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Temps de craft</div>
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {formatDuration(detail.craftTimeSeconds)}
                    </div>
                </div>
                {(() => {
                    const size = extractSize(detail);
                    return size != null ? (
                        <div>
                            <div className="text-[10px] uppercase text-muted-foreground">
                                Taille
                            </div>
                            <div className="font-medium">T{size}</div>
                        </div>
                    ) : null;
                })()}
                {(() => {
                    const cls = resolveClass(detail);
                    return cls ? (
                        <div>
                            <div className="text-[10px] uppercase text-muted-foreground">
                                Classe
                            </div>
                            <div className="font-medium">{CLASS_LABEL_FR[cls]}</div>
                        </div>
                    ) : null;
                })()}
                {detail.tiers != null && detail.tiers > 1 && (
                    <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Tiers</div>
                        <div>{detail.tiers}</div>
                    </div>
                )}
                {detail.defaultOwned && (
                    <div className="col-span-2">
                        <Badge
                            variant="outline"
                            className="h-5 gap-1 px-1.5 text-[10px] border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                        >
                            <Check className="h-2.5 w-2.5" /> Disponible par défaut
                        </Badge>
                    </div>
                )}
            </div>

            <Button
                size="sm"
                onClick={onToggleOwned}
                variant={isOwned ? "secondary" : "default"}
                className="w-full gap-1.5"
            >
                <Check className="h-3.5 w-3.5" />
                {isOwned ? "Décocher comme possédé" : "Marquer comme possédé"}
            </Button>

            {/* Ingredients */}
            {detail.ingredients.length > 0 && (
                <>
                    <Separator />
                    <div>
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <Hammer className="h-3 w-3" /> Ressources requises
                        </div>
                        <div className="space-y-2">
                            {detail.ingredients.map((grp, idx) => (
                                <div
                                    key={`${grp.slot}-${idx}`}
                                    className="rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5"
                                >
                                    <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-primary/90">
                                        <span>{grp.slotLabelFr || grp.slot}</span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {grp.slot}
                                        </span>
                                    </div>
                                    <div className="mt-1 space-y-0.5">
                                        {grp.options.map((opt, oi) => (
                                            <div
                                                key={`${opt.guid || opt.name}-${oi}`}
                                                className="flex items-center justify-between gap-2 text-xs"
                                            >
                                                <span className="truncate">
                                                    {(lang === "fr"
                                                        ? opt.nameFr
                                                        : opt.name) ||
                                                        opt.name ||
                                                        opt.guid ||
                                                        "—"}
                                                </span>
                                                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                                    {opt.quantityScu != null
                                                        ? `${opt.quantityScu.toFixed(2)} SCU`
                                                        : opt.quantity != null
                                                          ? `× ${opt.quantity}`
                                                          : "—"}
                                                    {opt.minQuality != null &&
                                                        opt.minQuality > 1 && (
                                                            <span className="ml-1 text-muted-foreground/70">
                                                                (Q≥{opt.minQuality})
                                                            </span>
                                                        )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Missions */}
            {detail.missions.length > 0 && (
                <>
                    <Separator />
                    <div>
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <Trophy className="h-3 w-3" /> Missions ({detail.missions.length})
                        </div>
                        <div className="space-y-1.5">
                            {detail.missions.map((m, i) => {
                                const rawName =
                                    lang === "fr"
                                        ? m.nameFr || m.nameRaw
                                        : m.nameRaw || m.nameFr || "—";
                                const missionName = cleanScText(rawName) || "—";
                                const lawful = m.lawful;
                                const sys = rootSystem(m.locations);
                                return (
                                    <div
                                        key={`${m.missionId ?? i}`}
                                        className="rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5 text-xs"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium">
                                                    {missionName}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                                    {m.contractor && (
                                                        <span className="flex items-center gap-0.5">
                                                            <Users className="h-2.5 w-2.5" />
                                                            {m.contractor}
                                                        </span>
                                                    )}
                                                    {m.missionType && (
                                                        <>
                                                            <span>·</span>
                                                            <span>{m.missionType}</span>
                                                        </>
                                                    )}
                                                    {m.timeToCompleteMinutes != null && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="flex items-center gap-0.5">
                                                                <Clock className="h-2.5 w-2.5" />
                                                                {m.timeToCompleteMinutes}m
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                                                {sys && (
                                                    <Badge
                                                        variant="outline"
                                                        className={`h-4 gap-0.5 px-1 text-[9px] ${systemBadgeColor(sys)}`}
                                                    >
                                                        <MapPin className="h-2 w-2" /> {sys}
                                                    </Badge>
                                                )}
                                                {lawful === true && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-4 gap-0.5 px-1 text-[9px] border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                                                    >
                                                        <Shield className="h-2 w-2" /> UEE
                                                    </Badge>
                                                )}
                                                {lawful === false && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-4 gap-0.5 px-1 text-[9px] border-red-400/40 bg-red-400/10 text-red-300"
                                                    >
                                                        <ShieldOff className="h-2 w-2" /> Illégal
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                        {m.minStandingName && (
                                            <div className="mt-1 text-[10px] text-muted-foreground">
                                                Réputation min : {m.minStandingName}
                                                {m.minStandingReputation != null &&
                                                    ` (${m.minStandingReputation})`}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            <Separator />
            <div className="text-[10px] text-muted-foreground">
                Identifiant : <code className="text-muted-foreground/80">{detail.blueprintId}</code>
                {detail.version && (
                    <>
                        {" · "}
                        <span>{detail.version}</span>
                    </>
                )}
            </div>
        </div>
    );
}
