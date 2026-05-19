import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Shield, ChevronDown, ChevronUp, ExternalLink, Users, BadgeCheck } from "lucide-react";
import { IconBrandDiscord } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri-helpers";
import { openExternalCustom } from "@/utils/external";
import {
    getActiveBanner,
    setActiveBanner,
    subscribeActiveBanner,
} from "@/components/custom/titlebar-banner-coordinator";

const ORG_NAME_FALLBACK = "VECTARIS CORP.";
const ORG_TAG = "Fret · Transport · Commerce · Passagers";
const ORG_SID = "ARSW";
const ORG_DISCORD_URL = "https://discord.gg/BfGpnUCGPZ";
const ORG_DISCORD_INVITE = "BfGpnUCGPZ";
const ORG_RSI_URL = "https://robertsspaceindustries.com/en/orgs/ARSW";

interface DiscordInviteInfo {
    guildName: string | null;
    guildIconUrl: string | null;
    approximateMemberCount: number | null;
    approximatePresenceCount: number | null;
}

function openLink(url: string) {
    void openExternalCustom(url).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
    });
}

export function OrgPill() {
    const [open, setOpen] = useState(false);
    // Le nom est figé sur ORG_NAME_FALLBACK ; on ignore le guild Discord
    // pour éviter qu'un renaming Discord ne casse l'affichage côté appli.
    const name = ORG_NAME_FALLBACK;
    const [iconUrl, setIconUrl] = useState<string | null>(null);
    const [members, setMembers] = useState<number | null>(null);
    const [online, setOnline] = useState<number | null>(null);

    // useSyncExternalStore : se sync avec activeBanner à chaque render,
    // sans race condition entre mount et useEffect. Indispensable au
    // re-mount (changement de page) pour que le pill se masque
    // immédiatement quand le parrainage est actif.
    const referralActive = useSyncExternalStore(
        useCallback((onChange) => subscribeActiveBanner(() => onChange()), []),
        useCallback(() => getActiveBanner() === "referral", [])
    );

    useEffect(() => {
        if (!isTauri()) return;
        let cancelled = false;
        (async () => {
            try {
                const info = await invoke<DiscordInviteInfo>("partners_fetch_discord_invite", {
                    codeOrUrl: ORG_DISCORD_INVITE,
                });
                if (cancelled) return;
                // On ignore info.guildName : le nom affiché reste figé sur ORG_NAME_FALLBACK.
                if (info.guildIconUrl) setIconUrl(info.guildIconUrl);
                if (info.approximateMemberCount != null) setMembers(info.approximateMemberCount);
                if (info.approximatePresenceCount != null) setOnline(info.approximatePresenceCount);
            } catch {
                // silently ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Coordination : si un autre bandeau s'ouvre, on se replie.
    // (referralActive est géré par useSyncExternalStore ci-dessus,
    // ici on s'occupe uniquement de fermer notre propre open state.)
    useEffect(() => {
        const unsub = subscribeActiveBanner((id) => {
            if (id !== "org" && open) {
                setOpen(false);
            }
        });
        return unsub;
    }, [open]);

    const expand = () => {
        setOpen(true);
        setActiveBanner("org");
    };
    const collapse = () => {
        setOpen(false);
        setActiveBanner(null);
    };

    const logoSmall = iconUrl ? (
        <img
            src={iconUrl}
            alt={name}
            className="h-4 w-4 shrink-0 rounded-full object-cover ring-1 ring-amber-300/50"
        />
    ) : (
        <Shield className="h-3.5 w-3.5 shrink-0 text-amber-200" />
    );

    const logoLarge = iconUrl ? (
        <img
            src={iconUrl}
            alt={name}
            className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-amber-300/50"
        />
    ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 ring-1 ring-amber-300/50">
            <Shield className="h-5 w-5 text-amber-200" />
        </div>
    );

    if (referralActive) return null;

    return (
        <div className="pointer-events-none absolute left-1/2 -top-4 z-30 grid translate-x-[100px] items-start justify-items-start [&>*]:[grid-area:1/1]">
            <AnimatePresence initial={false}>
                {open ? (
                    <m.div
                        key="open"
                        initial={{ y: -40, opacity: 0, scale: 0.92 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 0, opacity: 0, scale: 0.85, transformOrigin: "top right" }}
                        transition={{ type: "spring", stiffness: 280, damping: 28 }}
                        style={{
                            transformOrigin: "top right",
                            backgroundImage:
                                "linear-gradient(135deg, oklch(0.42 0.13 70 / 0.55) 0%, oklch(0.28 0.06 60 / 0.85) 45%, oklch(0.18 0.025 275 / 0.92) 100%), repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.025) 4px 5px)",
                            boxShadow:
                                "0 12px 32px -12px rgba(180,120,50,0.55), inset 0 1px 0 rgba(255,210,140,0.18)",
                        }}
                        className="pointer-events-auto relative flex w-[280px] flex-col gap-2.5 overflow-hidden rounded-b-2xl border border-t-0 border-amber-600/60 p-3 backdrop-blur-xl"
                    >
                        {/* Decorative rivets dans les coins inférieurs */}
                        <span
                            aria-hidden
                            className="pointer-events-none absolute bottom-2 left-2 h-1 w-1 rounded-full bg-amber-300/50 shadow-[0_0_3px_rgba(252,211,77,0.6)]"
                        />
                        <span
                            aria-hidden
                            className="pointer-events-none absolute bottom-2 right-2 h-1 w-1 rounded-full bg-amber-300/50 shadow-[0_0_3px_rgba(252,211,77,0.6)]"
                        />
                        {/* Glow ambient en haut */}
                        <span
                            aria-hidden
                            className="pointer-events-none absolute -top-8 left-1/2 h-16 w-32 -translate-x-1/2 rounded-full bg-amber-400/25 blur-2xl"
                        />

                        <div className="relative flex items-start gap-2.5">
                            <div className="relative shrink-0">
                                {logoLarge}
                                {/* Anneau bronze accentué */}
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute -inset-0.5 rounded-lg ring-1 ring-amber-400/40"
                                />
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                                <div className="flex items-center gap-1">
                                    <span className="truncate text-[13.5px] font-bold tracking-tight text-amber-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                                        {name}
                                    </span>
                                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-amber-300 drop-shadow-[0_0_4px_rgba(252,211,77,0.5)]" />
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                    <span className="rounded-sm border border-amber-500/40 bg-amber-500/15 px-1 py-0 text-[9px] font-bold font-mono tracking-[0.18em] text-amber-200">
                                        {ORG_SID}
                                    </span>
                                    <span className="text-[9.5px] font-mono uppercase tracking-wider text-amber-100/60">
                                        Mon orga
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={collapse}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-100/70 transition-colors hover:bg-amber-300/15 hover:text-amber-100"
                                title="Réduire"
                                aria-label="Réduire"
                            >
                                <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        {/* Tag avec séparateur bronze */}
                        <div className="relative flex items-center gap-2">
                            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/35 to-amber-500/45" />
                            <span className="text-[10.5px] font-mono uppercase tracking-wider text-amber-100/85">
                                {ORG_TAG}
                            </span>
                            <span className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-500/35 to-amber-500/45" />
                        </div>

                        {members != null && (
                            <div className="relative flex items-center gap-3 rounded-md border border-amber-500/25 bg-black/35 px-2.5 py-1.5 text-[11px]">
                                <span className="flex items-center gap-1 text-amber-50/95">
                                    <Users className="h-3 w-3 text-amber-300" />
                                    <span className="font-bold tabular-nums">{members}</span>
                                    <span className="text-amber-100/55">membres</span>
                                </span>
                                {online != null && online > 0 && (
                                    <>
                                        <span className="h-3 w-px bg-amber-500/30" />
                                        <span className="flex items-center gap-1">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                            <span className="font-bold tabular-nums text-emerald-300">
                                                {online}
                                            </span>
                                            <span className="text-amber-100/55">en ligne</span>
                                        </span>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="relative flex gap-1.5">
                            <button
                                onClick={() => openLink(ORG_DISCORD_URL)}
                                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-[hsl(235,86%,65%)]/90 px-2 text-[11px] font-semibold text-white shadow-[0_3px_10px_-3px_rgba(88,101,242,0.55)] transition-colors hover:bg-[hsl(235,86%,65%)]"
                                title="Rejoindre le Discord"
                            >
                                <IconBrandDiscord size={13} />
                                <span>Discord</span>
                            </button>
                            <button
                                onClick={() => openLink(ORG_RSI_URL)}
                                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-amber-400/50 bg-gradient-to-b from-amber-500/25 to-amber-700/20 px-2 text-[11px] font-semibold text-amber-100 shadow-[0_3px_10px_-3px_rgba(245,158,11,0.45)] transition-colors hover:border-amber-300/70 hover:from-amber-500/35 hover:to-amber-700/30"
                                title="Voir sur RSI"
                            >
                                <ExternalLink className="h-3 w-3" />
                                <span>RSI</span>
                            </button>
                        </div>
                    </m.div>
                ) : (
                    <m.button
                        key="collapsed"
                        initial={{ opacity: 0, scale: 0.85, y: 0 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ y: -24, opacity: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                        style={{ transformOrigin: "top left" }}
                        onClick={expand}
                        className="pointer-events-auto relative flex h-7 items-center gap-2 rounded-b-2xl border border-t-0 border-amber-500/50 bg-gradient-to-b from-amber-500/35 to-amber-600/20 pl-1.5 pr-2.5 text-[11px] font-semibold text-white shadow-[0_6px_18px_-10px_rgba(245,158,11,0.6)] backdrop-blur-xl transition-all hover:from-amber-500/50 hover:to-amber-600/30"
                        title={`Mon orga — ${name}`}
                    >
                        {logoSmall}
                        <span className="drop-shadow-sm">Mon orga</span>
                        {members != null && (
                            <span className="flex items-center gap-1 rounded-full bg-black/30 px-1.5 py-0.5 text-[10px]">
                                <Users className="h-2.5 w-2.5" />
                                <span className="font-bold tabular-nums">{members}</span>
                                {online != null && online > 0 && (
                                    <>
                                        <span className="h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]" />
                                        <span className="font-bold tabular-nums text-emerald-300">
                                            {online}
                                        </span>
                                    </>
                                )}
                            </span>
                        )}
                        <ChevronDown className="h-3 w-3 opacity-90" />
                    </m.button>
                )}
            </AnimatePresence>
        </div>
    );
}
