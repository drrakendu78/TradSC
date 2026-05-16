import { m } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
    X,
    Tag,
    Briefcase,
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

type Lang = "fr" | "en";

interface BlueprintSummary {
    id: number;
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
    Radar: "Radar",
    Salvage: "Salvage",
    Weapons: "Armes",
    Cannon: "Canon",
    Gatling: "Gatling",
    Ballistic: "Balistique",
    Magazine: "Chargeur",
    Sniper: "Sniper",
    Heavy: "Lourde",
    Undersuit: "Sous-combinaison",
    Combat: "Combat",
    Ammo: "Munitions",
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

export default function Blueprints() {
    const { toast } = useToast();
    const [config, setConfig] = useState<ConfigPayload | null>(null);
    const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
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
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<BlueprintDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [cloudStatus, setCloudStatus] = useState<"idle" | "syncing" | "saved" | "error">(
        "idle",
    );
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
            const filters = {
                location: locationFilter === "all" ? undefined : locationFilter,
                contractor: contractorFilter === "all" ? undefined : contractorFilter,
                missionType: missionTypeFilter === "all" ? undefined : missionTypeFilter,
                lawful:
                    lawfulFilter === "lawful"
                        ? 1
                        : lawfulFilter === "unlawful"
                          ? 0
                          : undefined,
                search: search.trim() || undefined,
            };
            const list = await invoke<BlueprintSummary[]>("blueprints_list", { filters });
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
    }, [toast, locationFilter, contractorFilter, missionTypeFilter, lawfulFilter, search]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        const t = setTimeout(() => {
            fetchList();
        }, 250);
        return () => clearTimeout(t);
    }, [fetchList]);

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

    const categoryOptions = useMemo(() => {
        const set = new Set<string>();
        for (const b of blueprints) {
            const k = categoryKey(b.category);
            if (k) set.add(k);
        }
        return Array.from(set).sort();
    }, [blueprints]);

    const displayedBlueprints = useMemo(() => {
        return blueprints.filter((b) => {
            if (onlyOwned && !owned.has(b.blueprintId)) return false;
            if (categoryFilter !== "all" && categoryKey(b.category) !== categoryFilter)
                return false;
            return true;
        });
    }, [blueprints, onlyOwned, owned, categoryFilter]);

    const total = config?.totalBlueprints ?? blueprints.length;
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
        setSelectedId(entry.id);
        setDetail(null);
        setDetailError(null);
        setDetailLoading(true);
        try {
            const value = await invoke<BlueprintDetail>("blueprint_detail", {
                blueprintInternalId: entry.id,
            });
            setDetail(value);
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
            setDetailError(message);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const clearFilters = useCallback(() => {
        setSearch("");
        setLocationFilter("all");
        setContractorFilter("all");
        setMissionTypeFilter("all");
        setCategoryFilter("all");
        setLawfulFilter("all");
        setOnlyOwned(false);
    }, []);

    const hasActiveFilter =
        !!search ||
        locationFilter !== "all" ||
        contractorFilter !== "all" ||
        missionTypeFilter !== "all" ||
        categoryFilter !== "all" ||
        lawfulFilter !== "all" ||
        onlyOwned;

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
                                className="h-8 pl-7 text-xs"
                            />
                        </div>
                        <CompactSelect
                            icon={<MapPin className="h-3 w-3" />}
                            placeholder="Système"
                            value={locationFilter}
                            onChange={setLocationFilter}
                            options={config?.locations ?? []}
                            allLabel="Système"
                            active={locationFilter !== "all"}
                        />
                        <CompactSelect
                            icon={<Users className="h-3 w-3" />}
                            placeholder="Contractor"
                            value={contractorFilter}
                            onChange={setContractorFilter}
                            options={config?.contractors ?? []}
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
                            onClick={() => setOnlyOwned((v) => !v)}
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
                        {hasActiveFilter && (
                            <button
                                onClick={clearFilters}
                                title="Réinitialiser les filtres"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/20 text-muted-foreground transition-all hover:border-destructive/40 hover:bg-destructive/10 hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
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
                                            const isSelected = b.id === selectedId;
                                            const isOwned = owned.has(b.blueprintId);
                                            const fallback =
                                                lang === "fr" && !b.nameFr && !b.nameEn
                                                    ? "italic text-muted-foreground"
                                                    : "";
                                            return (
                                                <tr
                                                    key={b.id}
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
                                                        <div className={`truncate ${fallback}`}>
                                                            {displayName(b)}
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
                        selectedId={selectedId}
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
    selectedId: number | null;
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
                {detail.tiers != null && (
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
                                const missionName =
                                    lang === "fr"
                                        ? m.nameFr || m.nameRaw
                                        : m.nameRaw || m.nameFr || "—";
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
