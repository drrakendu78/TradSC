import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getOverlayHubItems } from "@/utils/overlay-hub-registry";
import type { OverlayHubItem } from "@/types/overlay-hub";
import { useCustomLinksStore } from "@/stores/custom-links-store";
import type { LocalizationConfig, TranslationsChoosen, Link } from "@/types/translation";

// Types partagés avec le HTML companion (côté téléphone)

type IncomingEvent = {
    clientId: number;
    payload: string;
    peer: string;
};

type VersionInfo = { path: string; translated: boolean; up_to_date: boolean };
type VersionPaths = { versions: Record<string, VersionInfo> };
type LauncherStatus = { installed: boolean; path: string | null };
type BackgroundServiceConfig = {
    enabled: boolean;
    check_interval_minutes: number;
    language: string;
};
type AppStats = {
    first_install_date?: string | null;
    days_since_install?: number | null;
    local_backups_count: number;
    translations_installed_count: number;
    translated_versions: string[];
};
type PlaytimeStats = {
    total_hours: number;
    formatted: string;
    session_count: number;
};
type DiscordStatus = {
    connected: boolean;
    activity?: {
        state?: string | null;
        details?: string | null;
    } | null;
};
type CharacterInfo = {
    name: string;
    path: string;
    version: string;
};
type CharacterInfoResult = {
    characters: CharacterInfo[];
};
type OnlinePresetRow = {
    id: string;
    title: string;
    previewUrl?: string;
    dnaUrl: string;
    user?: {
        name?: string;
    };
    _count?: {
        characterDownloads?: number;
        characterLikes?: number;
    };
};

const DEFAULT_LANG = "fr";

const BROADCAST_DEBOUNCE_MS = 120;
const DASHBOARD_REBROADCAST_EVENTS = ["overlay_closed"] as const;
const PLAYTIME_CACHE_KEY = "startradfr_playtime_cache";
const STATS_STORAGE_KEY = "stats-storage";
const DISCORD_RPC_STORAGE_KEY = "discordRPCEnabled";

const formatHoursToPlaytime = (totalHours: number) => {
    const safeHours = Math.max(0, Number(totalHours) || 0);
    const totalMinutes = Math.round(safeHours * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}min` : `${minutes}min`;
};

const getSavedPlaytimeHours = (): number => {
    try {
        const statsRaw = window.localStorage.getItem(STATS_STORAGE_KEY);
        if (!statsRaw) return 0;
        const parsedStats = JSON.parse(statsRaw);
        return Number(parsedStats?.state?.savedPlaytimeHours ?? 0) || 0;
    } catch {
        return 0;
    }
};

const getSavedAppUsageDays = (): number | null => {
    try {
        const statsRaw = window.localStorage.getItem(STATS_STORAGE_KEY);
        if (!statsRaw) return null;
        const parsedStats = JSON.parse(statsRaw);
        const firstUseDate = parsedStats?.state?.firstUseDate;
        if (!firstUseDate) return null;

        const firstDate = new Date(firstUseDate);
        const firstTime = firstDate.getTime();
        if (!Number.isFinite(firstTime)) return null;

        const diffMs = Date.now() - firstTime;
        return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    } catch {
        return null;
    }
};

const withLocalUsageDays = (appStats: AppStats): AppStats => {
    const savedDays = getSavedAppUsageDays();
    if (savedDays === null) return appStats;
    return {
        ...appStats,
        days_since_install: savedDays,
    };
};

const getCachedPlaytimeStats = (): PlaytimeStats => {
    try {
        const savedHours = getSavedPlaytimeHours();
        const raw = window.localStorage.getItem(PLAYTIME_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const calculatedHours = Number(parsed?.total_hours ?? 0) || 0;
            const totalHours = savedHours + calculatedHours;
            return {
                total_hours: totalHours,
                formatted: formatHoursToPlaytime(totalHours),
                session_count: Number(parsed?.session_count ?? 0) || 0,
            };
        }

        if (savedHours > 0) {
            return {
                total_hours: savedHours,
                formatted: formatHoursToPlaytime(savedHours),
                session_count: 0,
            };
        }

        return { total_hours: 0, formatted: "0min", session_count: 0 };
    } catch {
        return { total_hours: 0, formatted: "0min", session_count: 0 };
    }
};

const getDiscordEnabled = (): boolean => {
    try {
        const raw = window.localStorage.getItem(DISCORD_RPC_STORAGE_KEY);
        return raw === null ? true : raw === "true";
    } catch {
        return true;
    }
};

export function useCompanionBridge(enabled: boolean = true) {
    const customLinks = useCustomLinksStore((s) => s.links);
    const customLinksRef = useRef(customLinks);
    const pendingRef = useRef<number | null>(null);
    const busyRef = useRef<Record<string, { action: string; progress?: number }>>({});
    const overlayOpacityRef = useRef<Record<string, number>>({});
    const overlayActiveRef = useRef<Record<string, boolean>>({});
    const appStatsRef = useRef<AppStats>({
        first_install_date: null,
        days_since_install: null,
        local_backups_count: 0,
        translations_installed_count: 0,
        translated_versions: [],
    });
    const playtimeRef = useRef<PlaytimeStats>({
        ...getCachedPlaytimeStats(),
    });
    const dashboardStatsLoadedRef = useRef(false);
    const dashboardStatsLoadingRef = useRef<Promise<void> | null>(null);
    const dashboardStatsUpdatedAtRef = useRef(0);

    useEffect(() => {
        customLinksRef.current = customLinks;
    }, [customLinks]);

    useEffect(() => {
        if (!enabled) return;

        // Le bridge ne tourne que dans la fenêtre principale — les overlays,
        // control windows et hub sont des webviews séparés qui n'ont pas
        // besoin (ni ne doivent) répondre aux clients companion.
        const hash = window.location.hash;
        if (
            hash.includes("/overlay-view") ||
            hash.includes("/overlay-control") ||
            hash.includes("/pvp-overlay") ||
            hash.includes("/overlay-hub")
        ) {
            return;
        }

        let unlistenIncoming: UnlistenFn | null = null;
        let unlistenConnect: UnlistenFn | null = null;
        let unlistenDisconnect: UnlistenFn | null = null;
        const unlistenMisc: UnlistenFn[] = [];
        let cancelled = false;

        const baseAppUrl = `${window.location.origin}${window.location.pathname}`;

        const getItems = (): OverlayHubItem[] =>
            getOverlayHubItems(customLinksRef.current, baseAppUrl);

        const overlayStateKey = (id: string, kind: string) => `${kind}:${id}`;
        const overlayWindowLabel = (id: string, kind: string) =>
            kind === "webview" ? `wvoverlay_${id}` : `overlay_${id}`;

        const broadcast = async (message: Record<string, unknown>) => {
            try {
                await invoke("companion_broadcast", { message: JSON.stringify(message) });
            } catch (e) {
                console.error("[companion] broadcast failed", e);
            }
        };

        const sendToClient = async (
            clientId: number,
            message: Record<string, unknown>
        ) => {
            try {
                await invoke("companion_send", {
                    clientId,
                    message: JSON.stringify(message),
                });
            } catch (e) {
                console.error("[companion] send failed", e);
            }
        };

        const buildDashboardMetaState = () => ({
            type: "state.meta",
            stats: appStatsRef.current,
            playtime: playtimeRef.current,
        });

        const buildOverlayActivityState = () => ({
            type: "state.overlays",
            overlays: getItems().map((it) => {
                const key = overlayStateKey(it.id, it.kind);
                return {
                    id: it.id,
                    type: it.kind,
                    active: Boolean(overlayActiveRef.current[key]),
                    opacity: overlayOpacityRef.current[key] ?? it.opacity,
                };
            }),
        });

        const refreshOverlayActivity = async () => {
            const items = getItems();
            await Promise.all(
                items.map(async (it) => {
                    const key = overlayStateKey(it.id, it.kind);
                    // Tauri convertit les params Rust snake_case en camelCase côté JS.
                    // Param Rust `overlay_type` → JS `overlayType`. Sans la bonne clé,
                    // Tauri voit `None` et retombe sur "iframe", ce qui fait foirer la
                    // détection des overlays webview (SP Viewer / Routes).
                    const active = await invoke<boolean>("is_overlay_open", {
                        id: it.id,
                        overlayType: it.kind,
                    }).catch(() => false);
                    overlayActiveRef.current[key] = active;
                })
            );
            await broadcast(buildOverlayActivityState());
        };

        const refreshDashboardStats = async (force = false) => {
            const isFresh =
                dashboardStatsLoadedRef.current &&
                Date.now() - dashboardStatsUpdatedAtRef.current < 60_000;
            if (!force && (isFresh || dashboardStatsLoadingRef.current)) {
                return dashboardStatsLoadingRef.current ?? Promise.resolve();
            }

            const task = Promise.all([
                invoke<AppStats>("get_app_stats").catch(() => ({
                    first_install_date: null,
                    days_since_install: null,
                    local_backups_count: 0,
                    translations_installed_count: 0,
                    translated_versions: [],
                })),
            ])
                .then(([appStats]) => {
                    appStatsRef.current = withLocalUsageDays(appStats);
                    playtimeRef.current = getCachedPlaytimeStats();
                    dashboardStatsLoadedRef.current = true;
                    dashboardStatsUpdatedAtRef.current = Date.now();
                })
                .finally(() => {
                    dashboardStatsLoadingRef.current = null;
                });

            dashboardStatsLoadingRef.current = task.then(() => undefined);
            await dashboardStatsLoadingRef.current;
            await broadcast(buildDashboardMetaState());
        };

        const buildDashboardState = async () => {
            const items = getItems();
            const [hubOpen, editMode, launcher, serviceConfig, serviceRunning] = await Promise.all([
                invoke<boolean>("is_overlay_hub_open").catch(() => false),
                invoke<boolean>("get_overlay_hub_mode").catch(() => true),
                invoke<LauncherStatus>("check_rsi_launcher").catch(() => ({
                    installed: false,
                    path: null,
                })),
                invoke<BackgroundServiceConfig>("get_background_service_config").catch(() => ({
                    enabled: false,
                    check_interval_minutes: 5,
                    language: DEFAULT_LANG,
                })),
                invoke<boolean>("is_background_service_running").catch(() => false),
            ]);
            const overlays = await Promise.all(
                items.map(async (it) => {
                    const key = overlayStateKey(it.id, it.kind);
                    const opacity =
                        overlayOpacityRef.current[key] ?? it.opacity;
                    return {
                        id: it.id,
                        title: it.label,
                        type: it.kind,
                        url: it.url,
                        width: it.width,
                        height: it.height,
                        opacity,
                        label: overlayWindowLabel(it.id, it.kind),
                        active: Boolean(overlayActiveRef.current[key]),
                    };
                })
            );
            return {
                type: "state",
                hubOpen,
                editMode,
                launcher,
                service: {
                    ...serviceConfig,
                    running: serviceRunning,
                },
                overlays,
            };
        };

        const scheduleDashboardBroadcast = () => {
            if (pendingRef.current !== null) return;
            pendingRef.current = window.setTimeout(async () => {
                pendingRef.current = null;
                try {
                    const state = await buildDashboardState();
                    await broadcast(state);
                } catch (e) {
                    console.error("[companion] state build failed", e);
                }
            }, BROADCAST_DEBOUNCE_MS);
        };

        // ─── Traduction ────────────────────────────────────────────────────
        // `get_translations` renvoie un LocalizationConfig (fr: { links: [...] }),
        // et la sélection utilisateur est persistée via save/load_translations_selected
        // au format { [version]: { link, settingsEN } }. Le téléphone doit donc voir :
        //  - la liste des liens FR disponibles (id/name/url)
        //  - par version : le lien actuellement sélectionné + l'état install / à jour.
        const emptyLocalization: LocalizationConfig = {
            fr: { folder: "", enabled: true, links: [] },
        };

        const buildTranslationState = async () => {
            const [vp, localization, saved] = await Promise.all([
                invoke<VersionPaths>("get_star_citizen_versions").catch(() => ({
                    versions: {} as Record<string, VersionInfo>,
                })),
                invoke<LocalizationConfig>("get_translations").catch(() => emptyLocalization),
                invoke<TranslationsChoosen>("load_translations_selected").catch(
                    () => ({} as TranslationsChoosen)
                ),
            ]);

            const links: Link[] = Array.isArray(localization?.fr?.links)
                ? localization.fr.links
                : [];
            const versionEntries = Object.entries(vp.versions || {});

            // Pour chaque version installée, réinterroger Rust pour avoir des états
            // à jour — VersionInfo peut être périmé si une opération a eu lieu
            // depuis la dernière détection. L'état "à jour" est évalué par rapport
            // au lien que l'utilisateur a réellement sélectionné (pas un lien
            // arbitraire), sinon on renvoie un état neutre.
            const versions = await Promise.all(
                versionEntries.map(async ([version, info]) => {
                    const setting = version; // LIVE/PTU/EPTU servent d'ID unique
                    const selection = saved?.[version] ?? null;
                    const selectedLink = selection?.link ?? null;
                    const settingsEN = selection?.settingsEN === true;

                    const translated = await invoke<boolean>("is_game_translated", {
                        path: info.path,
                        lang: DEFAULT_LANG,
                    }).catch(() => info.translated);

                    let upToDate: boolean | null = null;
                    if (translated && selectedLink) {
                        if (selectedLink.startsWith("cache:")) {
                            // Lien hors-ligne : on ne peut pas comparer à la source,
                            // on considère « à jour » tant que la trad est installée.
                            upToDate = true;
                        } else {
                            upToDate = await invoke<boolean>("is_translation_up_to_date", {
                                path: info.path,
                                translationLink: selectedLink,
                                lang: DEFAULT_LANG,
                            }).catch(() => true);
                        }
                    } else if (translated && !selectedLink) {
                        // Traduction présente mais aucun lien choisi : on ne sait pas
                        // la comparer. On ne déclenche PAS de « mise à jour dispo »
                        // fantôme — c'était la source du bug reporté.
                        upToDate = true;
                    }

                    return {
                        setting,
                        label: version,
                        version,
                        path: info.path,
                        installed: translated,
                        upToDate,
                        selectedLink,
                        settingsEN,
                    };
                })
            );

            return {
                type: "translation.state",
                versions,
                links: links.map((l) => ({ id: l.id, name: l.name, url: l.url })),
                busy: { ...busyRef.current },
            };
        };

        const broadcastTranslation = async () => {
            try {
                const state = await buildTranslationState();
                await broadcast(state);
            } catch (e) {
                console.error("[companion] translation state failed", e);
            }
        };

        const buildDiscordState = async () => {
            const enabled = getDiscordEnabled();
            let connected = false;
            let activity: DiscordStatus["activity"] = null;

            if (enabled) {
                try {
                    await invoke<boolean>("check_and_reconnect_discord").catch(() => false);
                } catch {
                    // ignore, status query below handles fallback
                }
                const status = await invoke<DiscordStatus>("get_discord_status").catch(() => ({
                    connected: false,
                    activity: null,
                }));
                connected = Boolean(status.connected);
                activity = status.activity ?? null;
            }

            return {
                type: "discord.state",
                enabled,
                connected,
                activity,
            };
        };

        const buildPresetsState = async () => {
            const versionsInfo = await invoke<VersionPaths>("get_star_citizen_versions").catch(
                () => ({ versions: {} as Record<string, VersionInfo> })
            );
            const versionNames = Object.keys(versionsInfo.versions || {}).sort();

            const results = await Promise.all(
                versionNames.map(async (version) => {
                    const path = versionsInfo.versions?.[version]?.path;
                    if (!path) return { version, characters: [] as CharacterInfo[] };
                    const raw = await invoke<string>("get_character_informations", {
                        path,
                    }).catch(() => '{"characters":[]}');
                    const parsed = JSON.parse(raw) as CharacterInfoResult;
                    return {
                        version,
                        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
                    };
                })
            );

            const byName = new Map<
                string,
                {
                    name: string;
                    sources: Record<string, string>;
                }
            >();

            results.forEach(({ version, characters }) => {
                characters.forEach((character) => {
                    const current = byName.get(character.name) ?? {
                        name: character.name,
                        sources: {},
                    };
                    current.sources[version] = character.path;
                    byName.set(character.name, current);
                });
            });

            const characters = Array.from(byName.values())
                .map((character) => ({
                    name: character.name,
                    sources: character.sources,
                    availableVersions: Object.keys(character.sources).sort(),
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "fr"));

            return {
                type: "presets.state",
                versions: versionNames,
                characters,
            };
        };

        const buildOnlinePresetsState = async (
            page = 1,
            orderType: "latest" | "download" = "latest",
            search = ""
        ) => {
            const response = await invoke<any>("get_characters", {
                page,
                orderType,
                search: search.trim() || undefined,
            }).catch(() => ({
                body: {
                    rows: [],
                    hasNextPage: false,
                },
            }));

            const body = response?.body ?? {};
            const rows = Array.isArray(body?.rows) ? body.rows : [];

            return {
                type: "online.presets.state",
                page,
                order: orderType,
                search,
                hasNextPage: Boolean(body?.hasNextPage),
                items: rows.map((row: OnlinePresetRow) => ({
                    id: String(row?.id ?? ""),
                    title: String(row?.title ?? "Preset"),
                    previewUrl:
                        typeof row?.previewUrl === "string" ? row.previewUrl : "",
                    dnaUrl: String(row?.dnaUrl ?? ""),
                    author: String(row?.user?.name ?? "Auteur inconnu"),
                    downloads: Number(row?._count?.characterDownloads ?? 0) || 0,
                    likes: Number(row?._count?.characterLikes ?? 0) || 0,
                })),
            };
        };

        // ─── Cache soft pour news / server status / pvp ─────────────────────
        // Ces trois endpoints tapent Internet, on évite de refaire une requête
        // si un client demande la même info moins de 60 s plus tard.
        const softCache: Record<string, { at: number; data: unknown }> = {};
        const CACHE_TTL_MS = 60_000;

        const withCache = async <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
            const entry = softCache[key];
            if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
                return entry.data as T;
            }
            const data = await fetcher();
            softCache[key] = { at: Date.now(), data };
            return data;
        };

        const buildServerState = async () =>
            withCache("server", async () => {
                const html = await invoke<string>("fetch_server_status");
                const doc = new DOMParser().parseFromString(html, "text/html");
                const nodes = Array.from(doc.querySelectorAll(".component"));
                let services = nodes
                    .map((c) => {
                        const name = c.querySelector(".name")?.textContent?.trim() ?? "";
                        const status =
                            c.querySelector("[data-status]")?.getAttribute("data-status") ??
                            "unknown";
                        return { name, status };
                    })
                    .filter((s) => s.name);
                // Fallback regex : certaines versions du status page ne rendent
                // pas `.component` côté serveur (SSR partiel). On retombe sur
                // une détection directe des 3 services clés, comme le fait le
                // composant ServerStatus dans l'app principale.
                if (services.length === 0) {
                    const known = ["Platform", "Persistent Universe", "Arena Commander"];
                    services = known.map((svc) => {
                        const re = new RegExp(
                            `${svc}[\\s\\S]*?data-status="(\\w+)"`,
                            "i"
                        );
                        const m = html.match(re);
                        return { name: svc, status: m ? m[1] : "unknown" };
                    });
                }
                // Dérive un statut global pour un affichage résumé en tête de page.
                const hasMajor = services.some((s) => s.status === "major");
                const hasPartial = services.some((s) => s.status === "partial");
                const hasDegraded = services.some((s) => s.status === "degraded");
                const hasMaint = services.some((s) => s.status === "maintenance");
                const allOp = services.length > 0 && services.every((s) => s.status === "operational");
                const overall = hasMajor
                    ? "major"
                    : hasPartial
                        ? "partial"
                        : hasDegraded
                            ? "degraded"
                            : hasMaint
                                ? "maintenance"
                                : allOp
                                    ? "operational"
                                    : "unknown";
                return { type: "server.state", services, overall, fetchedAt: Date.now() };
            });

        const buildNewsState = async () =>
            withCache("news", async () => {
                const xml = await invoke<string>("fetch_rss");
                const doc = new DOMParser().parseFromString(xml, "application/xml");
                const entries = Array.from(doc.getElementsByTagName("entry")).slice(0, 12);
                const items = entries.map((e) => {
                    const title = e.getElementsByTagName("title")[0]?.textContent?.trim() ?? "";
                    const updated = e.getElementsByTagName("updated")[0]?.textContent?.trim() ?? "";
                    const links = Array.from(e.getElementsByTagName("link"));
                    const html = links.find((l) => l.getAttribute("type") === "text/html");
                    const link =
                        html?.getAttribute("href") ?? links[0]?.getAttribute("href") ?? "";
                    const rawSummary =
                        e.getElementsByTagName("summary")[0]?.textContent ??
                        e.getElementsByTagName("content")[0]?.textContent ??
                        "";
                    const summary = rawSummary
                        .replace(/<[^>]*>/g, "")
                        .replace(/&nbsp;/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 240);
                    return { title, link, updated, summary };
                });
                return { type: "news.state", items, fetchedAt: Date.now() };
            });

        const buildPvpState = async () =>
            withCache("pvp", async () => {
                const raw = await invoke<string>("fetch_contested_zone_timer");
                const parsed = parseInt(String(raw).trim(), 10);
                const cycleStart = Number.isFinite(parsed) ? parsed : null;
                // Les durées sont envoyées au téléphone pour qu'il affiche sa propre
                // horloge sans re-requêter — on ne veut pas une requête par seconde.
                return {
                    type: "pvp.state",
                    cycleStart,
                    durations: { red: 7200, green: 3600, black: 300 },
                    fetchedAt: Date.now(),
                };
            });

        const mergeSelection = async (
            version: string,
            patch: { link?: string | null; settingsEN?: boolean }
        ): Promise<TranslationsChoosen> => {
            const current = await invoke<TranslationsChoosen>("load_translations_selected").catch(
                () => ({} as TranslationsChoosen)
            );
            const previous = current?.[version] ?? { link: null, settingsEN: false };
            const next: TranslationsChoosen = {
                ...current,
                [version]: {
                    link: patch.link !== undefined ? patch.link : previous?.link ?? null,
                    settingsEN:
                        patch.settingsEN !== undefined
                            ? patch.settingsEN
                            : previous?.settingsEN ?? false,
                },
            };
            await invoke("save_translations_selected", { data: next }).catch(console.error);
            return next;
        };

        // ─── Routing des messages entrants ─────────────────────────────────
        const handleMessage = async (clientId: number, raw: string) => {
            let msg: { type?: string; [k: string]: unknown };
            try {
                msg = JSON.parse(raw);
            } catch {
                return;
            }
            if (!msg || typeof msg.type !== "string") return;

                switch (msg.type) {
                case "state.query": {
                    const state = await buildDashboardState();
                    await sendToClient(clientId, state);
                    await sendToClient(clientId, buildDashboardMetaState());
                    void refreshDashboardStats().then(() =>
                        sendToClient(clientId, buildDashboardMetaState())
                    );
                    void refreshOverlayActivity();
                    break;
                }
                case "hub.toggle": {
                    await invoke("toggle_overlay_hub").catch(console.error);
                    scheduleDashboardBroadcast();
                    break;
                }
                case "hub.open": {
                    await invoke("open_overlay_hub").catch(console.error);
                    scheduleDashboardBroadcast();
                    break;
                }
                case "hub.set_mode": {
                    const editMode = Boolean(msg.editMode);
                    await invoke("set_overlay_hub_mode", { editMode }).catch(console.error);
                    scheduleDashboardBroadcast();
                    break;
                }
                case "launcher.launch": {
                    try {
                        await invoke("launch_rsi_launcher");
                        await broadcast({
                            type: "toast",
                            message: "RSI Launcher lance",
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Impossible de lancer RSI: ${String(e)}`,
                            isError: true,
                        });
                    }
                    scheduleDashboardBroadcast();
                    break;
                }
                case "service.set_enabled": {
                    const enabled = Boolean(msg.enabled);
                    try {
                        const current = await invoke<BackgroundServiceConfig>(
                            "get_background_service_config"
                        ).catch(() => ({
                            enabled: false,
                            check_interval_minutes: 5,
                            language: DEFAULT_LANG,
                        }));
                        const nextConfig = { ...current, enabled };
                        await invoke("save_background_service_config", { config: nextConfig });
                        await invoke("set_background_service_config", { config: nextConfig });
                        if (enabled) {
                            await invoke("start_background_service");
                        } else {
                            await invoke("stop_background_service");
                        }
                        await broadcast({
                            type: "toast",
                            message: enabled
                                ? "Auto-check active"
                                : "Auto-check arrete",
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Service auto-check: ${String(e)}`,
                            isError: true,
                        });
                    }
                    scheduleDashboardBroadcast();
                    break;
                }
                case "service.set_interval": {
                    const interval = Math.max(1, Number(msg.minutes ?? 5) || 5);
                    try {
                        const current = await invoke<BackgroundServiceConfig>(
                            "get_background_service_config"
                        ).catch(() => ({
                            enabled: false,
                            check_interval_minutes: 5,
                            language: DEFAULT_LANG,
                        }));
                        const nextConfig = {
                            ...current,
                            check_interval_minutes: interval,
                        };
                        await invoke("save_background_service_config", { config: nextConfig });
                        await invoke("set_background_service_config", { config: nextConfig });

                        if (current.enabled) {
                            await invoke("stop_background_service").catch(() => null);
                            await new Promise((resolve) => window.setTimeout(resolve, 100));
                            await invoke("start_background_service");
                        }

                        await broadcast({
                            type: "toast",
                            message: `Verification toutes les ${interval} min`,
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Intervalle auto-check: ${String(e)}`,
                            isError: true,
                        });
                    }
                    scheduleDashboardBroadcast();
                    break;
                }
                case "overlay.open": {
                    const id = String(msg.id ?? "");
                    const kind = String(msg.overlayType ?? "iframe");
                    const url = String(msg.url ?? "");
                    const width = Number(msg.width ?? 600);
                    const height = Number(msg.height ?? 800);
                    const opacity = Number(msg.opacity ?? 1);
                    overlayOpacityRef.current[overlayStateKey(id, kind)] = opacity;
                    try {
                        if (kind === "webview") {
                            await invoke("open_webview_overlay", {
                                id,
                                url,
                                width,
                                height,
                                opacity,
                            });
                        } else {
                            await invoke("open_overlay", {
                                id,
                                url,
                                x: 100,
                                y: 100,
                                width,
                                height,
                                opacity,
                            });
                        }
                        overlayActiveRef.current[overlayStateKey(id, kind)] = true;
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Impossible d'ouvrir l'overlay ${id}`,
                            isError: true,
                        });
                        console.error(e);
                    }
                    scheduleDashboardBroadcast();
                    break;
                }
                case "overlay.set_opacity": {
                    const id = String(msg.id ?? "");
                    const kind = String(msg.overlayType ?? "iframe");
                    const opacity = Math.min(1, Math.max(0.1, Number(msg.opacity ?? 1) || 1));
                    if (!id) break;

                    overlayOpacityRef.current[overlayStateKey(id, kind)] = opacity;

                    try {
                        // camelCase obligatoire — voir refreshOverlayActivity.
                        const active = await invoke<boolean>("is_overlay_open", {
                            id,
                            overlayType: kind,
                        }).catch(() => false);

                        if (active) {
                            if (kind === "webview") {
                                // Webview overlay : pas de wrapper React, on doit
                                // changer l'alpha au niveau OS via WS_EX_LAYERED +
                                // SetLayeredWindowAttributes (set_window_opacity).
                                await invoke("set_window_opacity", {
                                    label: overlayWindowLabel(id, kind),
                                    opacity,
                                });
                            } else {
                                // Iframe overlay : OverlayView.tsx applique l'opacité
                                // en CSS sur l'<iframe>. set_window_opacity ferait
                                // disparaître la fenêtre car la window est créée
                                // avec transparent(true) (DWM) — incompatible avec
                                // un override LWA_ALPHA. On émet plutôt un event
                                // que OverlayView écoute.
                                await emit("overlay_opacity_set", { id, opacity });
                            }
                        }
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Opacite ${id}: ${String(e)}`,
                            isError: true,
                        });
                    }

                    break;
                }
                case "overlay.close": {
                    const id = String(msg.id ?? "");
                    const kind = String(msg.overlayType ?? "iframe");
                    try {
                        if (kind === "webview") {
                            await invoke("close_webview_overlay", { id });
                        } else {
                            await invoke("close_overlay", { id });
                        }
                        overlayActiveRef.current[overlayStateKey(id, kind)] = false;
                    } catch (e) {
                        console.error(e);
                    }
                    scheduleDashboardBroadcast();
                    break;
                }

                case "translation.query": {
                    const state = await buildTranslationState();
                    await sendToClient(clientId, state);
                    break;
                }

                case "discord.query": {
                    const state = await buildDiscordState();
                    await sendToClient(clientId, state);
                    break;
                }

                case "discord.set_enabled": {
                    const enabled = Boolean(msg.enabled);
                    try {
                        window.localStorage.setItem(
                            DISCORD_RPC_STORAGE_KEY,
                            String(enabled)
                        );
                    } catch {
                        // ignore storage failures
                    }

                    try {
                        if (enabled) {
                            await invoke<boolean>("check_and_reconnect_discord").catch(
                                () => false
                            );
                        } else {
                            await invoke("disconnect_discord").catch(() => null);
                        }
                        await invoke("update_tray_service", {
                            service: "discord",
                            enabled,
                        }).catch(() => null);
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Discord RPC: ${String(e)}`,
                            isError: true,
                        });
                    }

                    await sendToClient(clientId, await buildDiscordState());
                    break;
                }

                case "presets.query": {
                    const state = await buildPresetsState();
                    await sendToClient(clientId, state);
                    break;
                }

                case "online.presets.query": {
                    const page =
                        Math.max(1, Number(msg.page ?? 1) || 1);
                    const order =
                        msg.order === "download" ? "download" : "latest";
                    const search = String(msg.search ?? "");
                    const state = await buildOnlinePresetsState(page, order, search);
                    await sendToClient(clientId, state);
                    break;
                }

                case "preset.apply": {
                    const sourcePath = String(msg.sourcePath ?? "");
                    const version = String(msg.version ?? "");
                    if (!sourcePath || !version) break;

                    try {
                        await invoke("apply_character_to_version", {
                            characterPath: sourcePath,
                            version,
                        });
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Preset applique sur ${version}`,
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Preset ${version}: ${String(e)}`,
                            isError: true,
                        });
                    }

                    await sendToClient(clientId, await buildPresetsState());
                    break;
                }

                case "preset.delete": {
                    const sourcePath = String(msg.sourcePath ?? "");
                    if (!sourcePath) break;

                    try {
                        const deleted = await invoke<boolean>("delete_character", {
                            path: sourcePath,
                        }).catch(() => false);

                        await sendToClient(clientId, {
                            type: "toast",
                            message: deleted
                                ? "Preset supprime"
                                : "Suppression impossible",
                            isError: !deleted,
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Suppression preset: ${String(e)}`,
                            isError: true,
                        });
                    }

                    await sendToClient(clientId, await buildPresetsState());
                    break;
                }

                case "online.preset.download": {
                    const dnaUrl = String(msg.dnaUrl ?? "");
                    const title = String(msg.title ?? "");
                    if (!dnaUrl || !title) break;

                    try {
                        await invoke("download_character", {
                            dnaUrl,
                            title,
                        });
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Preset telecharge: ${title}`,
                        });
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "toast",
                            message: `Telechargement preset: ${String(e)}`,
                            isError: true,
                        });
                    }

                    await sendToClient(clientId, await buildPresetsState());
                    break;
                }

                case "server.query": {
                    try {
                        const state = await buildServerState();
                        await sendToClient(clientId, state);
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "server.state",
                            services: [],
                            overall: "unknown",
                            error: String(e),
                        });
                    }
                    break;
                }

                case "news.query": {
                    try {
                        const state = await buildNewsState();
                        await sendToClient(clientId, state);
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "news.state",
                            items: [],
                            error: String(e),
                        });
                    }
                    break;
                }

                case "pvp.query": {
                    try {
                        const state = await buildPvpState();
                        await sendToClient(clientId, state);
                    } catch (e) {
                        await sendToClient(clientId, {
                            type: "pvp.state",
                            cycleStart: null,
                            durations: { red: 7200, green: 3600, black: 300 },
                            error: String(e),
                        });
                    }
                    break;
                }

                case "external.open": {
                    // Ouvre un lien externe depuis le PC (utile quand le téléphone
                    // ne peut pas afficher, ex. page actualité longue).
                    const url = String(msg.url ?? "");
                    if (!url) break;
                    try {
                        await invoke("open_external", { url });
                    } catch (e) {
                        console.error("[companion] external.open failed", e);
                    }
                    break;
                }

                case "translation.select": {
                    // Sélection d'un lien de traduction depuis le téléphone.
                    // `link` peut être null pour effacer la sélection.
                    const version = String(msg.setting ?? msg.version ?? "");
                    if (!version) break;
                    const rawLink = msg.link;
                    const link =
                        rawLink === null
                            ? null
                            : typeof rawLink === "string"
                                ? rawLink
                                : undefined;
                    if (link === undefined) break;
                    await mergeSelection(version, { link });
                    await broadcastTranslation();
                    break;
                }

                case "translation.set_settings_en": {
                    const version = String(msg.setting ?? msg.version ?? "");
                    if (!version) break;
                    const settingsEN = Boolean(msg.settingsEN ?? msg.settings_en);
                    await mergeSelection(version, { settingsEN });
                    await broadcastTranslation();
                    break;
                }

                case "translation.install":
                case "translation.update": {
                    const setting = String(msg.setting ?? "");
                    const actionKey = msg.type === "translation.install" ? "install" : "update";
                    if (!setting) break;
                    try {
                        const vp = await invoke<VersionPaths>("get_star_citizen_versions");
                        const info = vp.versions?.[setting];
                        if (!info) throw new Error("Version introuvable");

                        // On peut recevoir un lien explicite (bouton « install avec ce
                        // lien ») OU retomber sur la sélection sauvegardée.
                        let link: string | null = null;
                        if (typeof msg.link === "string" && msg.link) {
                            link = msg.link;
                            await mergeSelection(setting, { link });
                        } else {
                            const saved = await invoke<TranslationsChoosen>(
                                "load_translations_selected"
                            ).catch(() => ({} as TranslationsChoosen));
                            link = saved?.[setting]?.link ?? null;
                        }
                        if (!link) {
                            throw new Error("Aucune traduction sélectionnée pour cette version");
                        }

                        busyRef.current[setting] = { action: actionKey };
                        await broadcastTranslation();

                        if (link.startsWith("cache:")) {
                            const cacheId = link.slice("cache:".length);
                            await invoke("install_translation_from_cache", {
                                path: info.path,
                                cacheId,
                                lang: DEFAULT_LANG,
                                gameVersion: setting,
                            });
                        } else if (actionKey === "install") {
                            await invoke("init_translation_files", {
                                path: info.path,
                                translationLink: link,
                                lang: DEFAULT_LANG,
                                gameVersion: setting,
                            });
                        } else {
                            await invoke("update_translation", {
                                path: info.path,
                                translationLink: link,
                                lang: DEFAULT_LANG,
                                gameVersion: setting,
                            });
                        }
                        await broadcast({
                            type: "toast",
                            message:
                                actionKey === "install"
                                    ? `Traduction ${setting} installée`
                                    : `Traduction ${setting} mise à jour`,
                        });
                    } catch (e) {
                        console.error(e);
                        await broadcast({
                            type: "toast",
                            message: `Erreur ${actionKey} ${setting}: ${String(e)}`,
                            isError: true,
                        });
                    } finally {
                        delete busyRef.current[setting];
                        await broadcastTranslation();
                    }
                    break;
                }

                case "translation.uninstall": {
                    const setting = String(msg.setting ?? "");
                    if (!setting) break;
                    try {
                        const vp = await invoke<VersionPaths>("get_star_citizen_versions");
                        const info = vp.versions?.[setting];
                        if (!info) throw new Error("Version introuvable");
                        busyRef.current[setting] = { action: "uninstall" };
                        await broadcastTranslation();

                        await invoke("uninstall_translation", { path: info.path });
                        await broadcast({
                            type: "toast",
                            message: `Traduction ${setting} désinstallée`,
                        });
                    } catch (e) {
                        console.error(e);
                        await broadcast({
                            type: "toast",
                            message: `Erreur désinstallation ${setting}: ${String(e)}`,
                            isError: true,
                        });
                    } finally {
                        delete busyRef.current[setting];
                        await broadcastTranslation();
                    }
                    break;
                }
            }
        };

        const setup = async () => {
            unlistenIncoming = await listen<IncomingEvent>("companion:incoming", (event) => {
                const { clientId, payload } = event.payload;
                handleMessage(clientId, payload).catch(console.error);
            });

            unlistenConnect = await listen("companion:client_connected", () => {
                // Nouveau client: push l'état complet des deux pages pour couvrir
                // dashboard et traduction peu importe celle qui est ouverte.
                scheduleDashboardBroadcast();
                void refreshOverlayActivity();
                broadcastTranslation().catch(console.error);
            });

            unlistenDisconnect = await listen("companion:client_disconnected", () => {
                // Rien à faire : on garde la connexion aux autres clients.
            });

            for (const evt of DASHBOARD_REBROADCAST_EVENTS) {
                const un = await listen(evt, () => {
                    void refreshOverlayActivity();
                    scheduleDashboardBroadcast();
                });
                unlistenMisc.push(un);
            }

            void refreshDashboardStats();
            void refreshOverlayActivity();

            if (cancelled) {
                unlistenIncoming?.();
                unlistenConnect?.();
                unlistenDisconnect?.();
                unlistenMisc.forEach((u) => u());
            }
        };

        setup().catch(console.error);

        return () => {
            cancelled = true;
            if (pendingRef.current !== null) {
                window.clearTimeout(pendingRef.current);
                pendingRef.current = null;
            }
            unlistenIncoming?.();
            unlistenConnect?.();
            unlistenDisconnect?.();
            unlistenMisc.forEach((u) => u());
        };
    }, [enabled]);
}
