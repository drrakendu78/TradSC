import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Search,
    Plus,
    X,
    ChevronLeft,
    ChevronRight,
    ArrowUpRight,
    ArrowRight,
    ExternalLink,
    Users,
    BadgeCheck,
    Flag,
    Star,
    Twitch,
    Youtube,
    LayoutGrid,
    Package,
} from "lucide-react";
import { IconBrandDiscord } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { m, AnimatePresence } from "framer-motion";
import blackbirdLogo from "@/assets/partners/blackbird.png";
import { openExternalCustom } from "@/utils/external";
import { isTauri } from "@/utils/tauri-helpers";

interface DiscordInviteInfo {
    code: string;
    guildId: string | null;
    guildName: string | null;
    guildIconUrl: string | null;
    approximateMemberCount: number | null;
    approximatePresenceCount: number | null;
    fetchedAt: number;
    fromCache: boolean;
}

interface TwitchStatusInfo {
    login: string;
    avatarUrl: string | null;
    live: boolean;
    uptime: string | null;
    fetchedAt: number;
    fromCache: boolean;
}

type PartnerCat = "organisation" | "streamer" | "discord" | "sponsor" | "boutique" | "site";
type LinkType = "org" | "twitch" | "youtube" | "discord" | "web";

interface Partner {
    id: string;
    name: string;
    cat: PartnerCat;
    tag: string;
    desc: string;
    members?: number;
    /** Live Discord presence (en ligne) — injecté au runtime */
    online?: number;
    live?: boolean;
    since: string;
    verified: boolean;
    hue: number;
    link: string;
    linkType: LinkType;
    featured?: boolean;
    logo?: string;
    /** Optional Discord invite to fetch a live community member count from */
    discordInvite?: string;
}

const ST = {
    panel2: "oklch(0.245 0.032 275)",
    card: "oklch(0.275 0.035 275)",
    border: "rgba(255,255,255,0.07)",
    borderStrong: "rgba(255,255,255,0.14)",
    text: "#ECE9F5",
    textDim: "rgba(236,233,245,0.68)",
    textFaint: "rgba(236,233,245,0.42)",
    accent: "oklch(0.68 0.17 290)",
    accentGlow: "oklch(0.68 0.17 290 / 0.45)",
    green: "oklch(0.78 0.16 150)",
    rose: "oklch(0.72 0.16 20)",
    cyan: "oklch(0.78 0.12 220)",
    amber: "oklch(0.78 0.15 60)",
    fontDisplay: '"Sora", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
};

const PARTNERS: Partner[] = [
    { id: "p1", name: "VECTARIS CORP.", cat: "organisation", tag: "ORG · Fret · Transport · Commerce · Passagers", desc: "Organisation francophone de fret, transport (cargo et passagers) et commerce. Sim en développement actif au sein du Verse.", since: "2026-05-17", verified: true, hue: 45, link: "https://robertsspaceindustries.com/en/orgs/ARSW", linkType: "org", discordInvite: "https://discord.gg/BfGpnUCGPZ" },
    { id: "p2", name: "Artics001", cat: "streamer", tag: "Twitch · Star Citizen FR", desc: "Streamer francophone Star Citizen — fondateur du HUB, tutos, événements communautaires et lives réguliers depuis Stanton.", live: false, since: "2026-05-17", verified: true, hue: 200, link: "https://www.twitch.tv/artics001", linkType: "twitch" },
    { id: "p3", name: "Le HUB", cat: "discord", tag: "Projet communautaire · Base-building", desc: "Le Hub est une communauté francophone ouverte dédiée à Star Citizen, pensée comme un espace de rencontre, d'entraide et de coopération entre joueurs, issus de tous les milieux. Son objectif : rassembler nouveaux venus, vétérans, créateurs de contenu, rôlistes, commerçants, explorateurs, combattants et corpos autour d'une vision commune — construire une véritable expérience communautaire persistante dans le Verse.", since: "2026-05-17", verified: true, hue: 200, link: "https://discord.gg/75gpShnHx", linkType: "discord", featured: true },
    { id: "s-erkul", name: "Erkul Games", cat: "site", tag: "Site · DPS calculator", desc: "Calculateur DPS, builds vaisseaux et armes. Référence absolue pour comparer ses configs avant le combat.", since: "2024-01-01", verified: true, hue: 220, link: "https://www.erkul.games", linkType: "web" },
    { id: "s-uex", name: "UEX Corp", cat: "site", tag: "Site · Routes de trading", desc: "Routes de commerce, prix des matières, données crowdsourcées par la communauté. Indispensable pour optimiser ses runs.", since: "2024-01-01", verified: true, hue: 35, link: "https://uexcorp.space", linkType: "web" },
    { id: "s-sccrafter", name: "SCCrafter", cat: "site", tag: "Site · Crafting database", desc: "Liste complète des 1564 blueprints du système crafting 4.0+. Source utilisée par StarTrad pour la page Blueprints.", since: "2024-01-01", verified: true, hue: 30, link: "https://www.sccrafter.com", linkType: "web" },
    { id: "s-sc-craft", name: "SC Craft Tools", cat: "site", tag: "Site · Détails crafting", desc: "API et UI pour les recettes de craft enrichies — missions, ingrédients, lawful/illegal. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 25, link: "https://sc-craft.tools", linkType: "web" },
    { id: "s-schaulers", name: "Schaulers", cat: "site", tag: "Site · Server status & alerts", desc: "Status temps réel des serveurs SC, alertes patchs et événements. Intégré dans la sidebar StarTrad.", since: "2024-01-01", verified: true, hue: 200, link: "https://schaulers.space", linkType: "web" },
    { id: "s-sc-cargo", name: "SC Cargo", cat: "site", tag: "Site · Cargo viewer", desc: "Visualiseur de cargaisons et soutes — calcule les compositions optimales avant un voyage. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 55, link: "https://sc-cargo.space", linkType: "web" },
    { id: "s-allsky", name: "AllSky Mining", cat: "site", tag: "Site · Minage", desc: "Outils de calcul pour le minage de surface et de quantum. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 195, link: "https://mining.getallsky.net", linkType: "web" },
    { id: "s-protixit", name: "Protixit", cat: "site", tag: "Site · Réputation joueurs", desc: "Base de réputation communautaire pour identifier les pirates, trolls et joueurs fair-play. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 145, link: "https://www.protixit.com/reputation", linkType: "web" },
    { id: "s-scdb", name: "SCDB", cat: "site", tag: "Site · Database", desc: "Base de données complète sur les vaisseaux, items, armes et lieux. Intégrée dans StarTrad.", since: "2024-01-01", verified: true, hue: 290, link: "https://scdb.space", linkType: "web" },
    { id: "s-hauler", name: "Hauler", cat: "site", tag: "Site · Hauling missions", desc: "Optimiseur de missions de hauling — itinéraires, charges et profits. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 100, link: "https://hauler.thespacecoder.space", linkType: "web" },
    { id: "s-finder", name: "Finder Cstone", cat: "site", tag: "Site · Lieux & cartes", desc: "Recherche de lieux d'intérêt et points de map dans tous les systèmes accessibles. Intégré dans StarTrad.", since: "2024-01-01", verified: true, hue: 240, link: "https://finder.cstone.space", linkType: "web" },
    { id: "s-verseguide", name: "Verse Guide", cat: "site", tag: "Site · Guides & wiki", desc: "Guides débutants, lore et tutoriels FR. Source enrichie pour comprendre l'univers Star Citizen.", since: "2024-01-01", verified: true, hue: 175, link: "https://verseguide.com", linkType: "web" },
    { id: "s-scmdb", name: "SCMDB", cat: "site", tag: "Site · SCM Database", desc: "Base de données sur les mécaniques SCM (Spatial Combat Maneuver). Intégrée dans StarTrad.", since: "2024-01-01", verified: true, hue: 260, link: "https://scmdb.net", linkType: "web" },
    { id: "s-spviewer", name: "SP Viewer", cat: "site", tag: "Site · Ship viewer", desc: "Visualiseur 3D des vaisseaux Star Citizen avec specs détaillées.", since: "2024-01-01", verified: true, hue: 280, link: "https://www.spviewer.eu", linkType: "web" },
    { id: "s-scwiki", name: "Star Citizen Wiki", cat: "site", tag: "Site · Encyclopédie", desc: "Wiki officiel de référence — vaisseaux, lore, systèmes, items. Source canonique de la communauté.", since: "2024-01-01", verified: true, hue: 5, link: "https://starcitizen.tools", linkType: "web" },
    { id: "s-polytool", name: "PolyTool SC", cat: "site", tag: "Site · Outil communautaire", desc: "Suite d'outils SC dont StarTrad utilise les global.ini auto-syncés comme source canonique des traductions CIG.", since: "2024-01-01", verified: true, hue: 310, link: "https://github.com/GerbyTV/PolyToolSC", linkType: "web" },
    { id: "b-blackbird", name: "BlackBird", cat: "boutique", tag: "Boutique · Supports joystick 3D", desc: "Créateur indépendant qui imprime en 3D des supports de joystick pour chaises gaming et setups sim. Qualité artisanale, idéal pour les pilotes Star Citizen.", since: "2026-05-19", verified: true, hue: 45, link: "https://www.etsy.com/fr/listing/4325499582/support-pour-joystick", linkType: "web", logo: blackbirdLogo, featured: true },
];

const CAT_INFO: Record<PartnerCat, { label: string; short: string; icon: React.ComponentType<{ size?: number | string }>; color: string }> = {
    organisation: { label: "Organisations", short: "Orgs", icon: Flag, color: ST.amber },
    streamer: { label: "Streamers", short: "Streamers", icon: Twitch, color: ST.rose },
    discord: { label: "Discord", short: "Discord", icon: IconBrandDiscord, color: ST.cyan },
    sponsor: { label: "Sponsors", short: "Sponsors", icon: Star, color: ST.green },
    boutique: { label: "Boutiques & Makers", short: "Boutiques", icon: Package, color: ST.amber },
    site: { label: "Sites", short: "Sites", icon: ExternalLink, color: ST.green },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
const fmtFullDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const linkLabel = (p: Partner) => p.link.replace(/^https?:\/\//, "");

/** Builds a high-res favicon URL for any domain via Google's free service. */
function faviconFor(url: string): string | null {
    try {
        const host = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=128&domain=${host}`;
    } catch {
        return null;
    }
}

function openLink(url: string) {
    void openExternalCustom(url).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
    });
}

function PartnerLogo({ p, size = 56, radius = 14 }: { p: Partner; size?: number; radius?: number }) {
    if (p.logo) {
        return (
            <img
                src={p.logo}
                alt={p.name}
                style={{
                    width: size,
                    height: size,
                    borderRadius: radius,
                    flexShrink: 0,
                    objectFit: "cover",
                    boxShadow: `0 6px 18px oklch(0.5 0.18 ${p.hue} / 0.35), inset 0 1px 0 rgba(255,255,255,0.2)`,
                    display: "block",
                }}
            />
        );
    }
    const initials = p.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("");
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: radius,
                flexShrink: 0,
                background: `linear-gradient(135deg, oklch(0.6 0.18 ${p.hue}) 0%, oklch(0.4 0.16 ${(p.hue + 40) % 360}) 100%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontFamily: ST.fontDisplay,
                fontWeight: 700,
                fontSize: size * 0.36,
                letterSpacing: -0.5,
                boxShadow: `0 6px 18px oklch(0.5 0.18 ${p.hue} / 0.35), inset 0 1px 0 rgba(255,255,255,0.2)`,
                position: "relative",
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    opacity: 0.18,
                    backgroundImage:
                        "repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.25) 6px 7px)",
                }}
            />
            <span style={{ position: "relative" }}>{initials}</span>
        </div>
    );
}

function VerifBadge({ size = 14 }: { size?: number }) {
    return (
        <span
            style={{ display: "inline-flex", alignItems: "center", color: ST.accent }}
            title="Partenaire vérifié"
        >
            <BadgeCheck size={size} strokeWidth={1.8} />
        </span>
    );
}

interface CardProps {
    p: Partner;
    onClick: () => void;
}

function OrgCard({ p, onClick }: CardProps) {
    return (
        <article
            onClick={onClick}
            data-no-drag
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                width: 360,
                height: 168,
                borderRadius: 14,
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                background: `linear-gradient(105deg, oklch(0.38 0.17 ${p.hue}) 0%, oklch(0.22 0.08 ${(p.hue + 30) % 360}) 60%, ${ST.card} 100%)`,
                border: "1px solid " + ST.borderStrong,
                flexShrink: 0,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
            }}
        >
            <svg
                style={{
                    position: "absolute",
                    right: -40,
                    top: -40,
                    width: 180,
                    height: 180,
                    opacity: 0.2,
                    pointerEvents: "none",
                }}
                viewBox="0 0 100 100"
            >
                <circle cx="50" cy="50" r="46" fill="none" stroke="#fff" strokeWidth="0.4" />
                <circle cx="50" cy="50" r="34" fill="none" stroke="#fff" strokeWidth="0.3" strokeDasharray="1.5 3" />
                <circle cx="96" cy="50" r="2" fill="#fff" />
            </svg>
            <div
                style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <PartnerLogo p={p} size={44} radius={11} />
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 9,
                        color: "rgba(255,255,255,0.85)",
                        fontFamily: ST.fontMono,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        padding: "4px 8px",
                        background: "rgba(0,0,0,0.35)",
                        borderRadius: 4,
                    }}
                >
                    <Users size={10} /> {p.members?.toLocaleString("fr-FR") ?? "—"}
                    {p.online != null && p.online > 0 && (
                        <>
                            <span
                                style={{
                                    width: 1,
                                    height: 10,
                                    background: "rgba(255,255,255,0.2)",
                                }}
                            />
                            <span
                                style={{
                                    display: "inline-block",
                                    width: 5,
                                    height: 5,
                                    borderRadius: 3,
                                    background: "oklch(0.78 0.16 150)",
                                    boxShadow: "0 0 5px oklch(0.78 0.16 150 / 0.7)",
                                }}
                            />
                            <span style={{ color: "oklch(0.85 0.16 150)", fontWeight: 700 }}>
                                {p.online.toLocaleString("fr-FR")}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <h4
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 600,
                            fontSize: 17,
                            letterSpacing: -0.3,
                            margin: 0,
                            color: "#fff",
                        }}
                    >
                        {p.name}
                    </h4>
                    {p.verified && <VerifBadge size={13} />}
                </div>
                <p
                    style={{
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.7)",
                        margin: 0,
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {p.desc}
                </p>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 10,
                    }}
                >
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: ST.fontMono }}>
                        {p.tag}
                    </span>
                    <span
                        style={{
                            fontSize: 11,
                            color: "#fff",
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                        }}
                    >
                        Détails <ChevronRight size={11} strokeWidth={2.2} />
                    </span>
                </div>
            </div>
        </article>
    );
}

function StreamerCard({ p, onClick }: CardProps) {
    const PlatformIcon = p.linkType === "youtube" ? Youtube : Twitch;
    return (
        <article
            onClick={onClick}
            data-no-drag
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                width: 200,
                height: 280,
                borderRadius: 14,
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                background: `linear-gradient(180deg, oklch(0.4 0.2 ${p.hue}) 0%, oklch(0.2 0.1 ${(p.hue + 50) % 360}) 60%, oklch(0.13 0.04 270) 100%)`,
                border: "1px solid " + ST.borderStrong,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: 16,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    background:
                        "radial-gradient(circle at 50% 25%, rgba(255,255,255,0.25), transparent 50%)",
                    pointerEvents: "none",
                }}
            />
            <div
                style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div
                    style={{
                        fontSize: 10,
                        color: "rgba(255,255,255,0.7)",
                        fontFamily: ST.fontMono,
                        textTransform: "uppercase",
                        letterSpacing: 1.4,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                    }}
                >
                    <PlatformIcon size={12} strokeWidth={2} /> {p.linkType}
                </div>
                {p.live ? (
                    <div
                        style={{
                            fontSize: 9,
                            fontFamily: ST.fontMono,
                            fontWeight: 700,
                            letterSpacing: 1,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            background: "oklch(0.55 0.22 25)",
                            padding: "3px 7px",
                            borderRadius: 4,
                        }}
                    >
                        <span
                            style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                background: "#fff",
                                animation: "startrad-pulse 1.4s infinite",
                            }}
                        />{" "}
                        LIVE
                    </div>
                ) : (
                    <div
                        style={{
                            fontSize: 9,
                            fontFamily: ST.fontMono,
                            color: "rgba(255,255,255,0.5)",
                            padding: "3px 7px",
                            background: "rgba(0,0,0,0.3)",
                            borderRadius: 4,
                        }}
                    >
                        OFFLINE
                    </div>
                )}
            </div>

            <div
                style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                }}
            >
                <PartnerLogo p={p} size={84} radius={42} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
                    <h4
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 600,
                            fontSize: 17,
                            letterSpacing: -0.3,
                            margin: 0,
                            color: "#fff",
                        }}
                    >
                        {p.name}
                    </h4>
                    {p.verified && <VerifBadge size={13} />}
                </div>
                <div
                    style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.65)",
                        fontFamily: ST.fontMono,
                        marginTop: 3,
                    }}
                >
                    {p.tag}
                </div>
            </div>

            <div style={{ position: "relative" }}>
                <p
                    style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.75)",
                        margin: "0 0 10px",
                        lineHeight: 1.4,
                        textAlign: "center",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {p.desc}
                </p>
                <button
                    data-no-drag
                    onClick={(e) => {
                        e.stopPropagation();
                        openLink(p.link);
                    }}
                    style={{
                        width: "100%",
                        border: "none",
                        background: "#fff",
                        color: "#1a1326",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: 8,
                        borderRadius: 7,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                    }}
                >
                    {p.live ? "Regarder" : "Voir la chaîne"} <ArrowUpRight size={11} strokeWidth={2.4} />
                </button>
            </div>
        </article>
    );
}

function DiscordNode({ p, onClick }: CardProps) {
    return (
        <article
            onClick={onClick}
            data-no-drag
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                flexShrink: 0,
                width: 180,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 10,
            }}
        >
            <div
                style={{
                    width: 132,
                    height: 132,
                    borderRadius: "50%",
                    position: "relative",
                    overflow: "hidden",
                    background: `radial-gradient(circle at 30% 30%, oklch(0.55 0.2 ${p.hue}) 0%, oklch(0.32 0.12 ${(p.hue + 40) % 360}) 60%, oklch(0.18 0.04 270) 100%)`,
                    border: "2px solid rgba(255,255,255,0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 8px 28px oklch(0.4 0.18 ${p.hue} / 0.35), inset 0 2px 0 rgba(255,255,255,0.2)`,
                }}
            >
                {p.logo && (
                    <>
                        <img
                            src={p.logo}
                            alt={p.name}
                            style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                            }}
                        />
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                    "radial-gradient(circle at 50% 60%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.15) 100%)",
                            }}
                        />
                    </>
                )}
                <div
                    style={{
                        position: "absolute",
                        inset: 8,
                        borderRadius: "50%",
                        border: "1px dashed rgba(255,255,255,0.25)",
                    }}
                />
                {Array.from({ length: 5 }).map((_, i) => {
                    const angle = ((i * 72 - 90) * Math.PI) / 180;
                    const r = 60;
                    const x = 66 + Math.cos(angle) * r;
                    const y = 66 + Math.sin(angle) * r;
                    return (
                        <div
                            key={i}
                            style={{
                                position: "absolute",
                                left: x - 4,
                                top: y - 4,
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                background: "#fff",
                                opacity: 0.75,
                                boxShadow: "0 0 4px rgba(0,0,0,0.4)",
                            }}
                        />
                    );
                })}
                <div
                    style={{
                        textAlign: "center",
                        position: "relative",
                        textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                    }}
                >
                    <IconBrandDiscord size={28} color="#fff" />
                    <div
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 700,
                            fontSize: 16,
                            color: "#fff",
                            marginTop: 4,
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
                        {p.members ? (p.members / 1000).toFixed(1) + "k" : ""}
                    </div>
                </div>
            </div>
            <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <h4
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 600,
                            fontSize: 14,
                            letterSpacing: -0.2,
                            margin: 0,
                            color: "#fff",
                        }}
                    >
                        {p.name}
                    </h4>
                    {p.verified && <VerifBadge size={12} />}
                </div>
                <p
                    style={{
                        fontSize: 11.5,
                        color: ST.textDim,
                        margin: "4px 0 0",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {p.desc}
                </p>
            </div>
        </article>
    );
}

function SponsorChip({ p, onClick }: CardProps) {
    return (
        <article
            onClick={onClick}
            data-no-drag
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className="startrad-sponsor-chip"
            style={{
                flexShrink: 0,
                width: 250,
                padding: "14px 14px 14px 12px",
                borderRadius: 14,
                background: `linear-gradient(135deg, oklch(0.27 0.04 ${p.hue} / 0.9) 0%, oklch(0.22 0.025 275 / 0.9) 70%)`,
                border: "1px solid " + ST.border,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                position: "relative",
                overflow: "hidden",
                transition: "transform .18s ease, border-color .18s ease, box-shadow .18s ease",
                boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            }}
        >
            <span
                aria-hidden
                style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 3,
                    background: `linear-gradient(180deg, oklch(0.7 0.18 ${p.hue}) 0%, oklch(0.5 0.16 ${(p.hue + 30) % 360}) 100%)`,
                }}
            />
            <PartnerLogo p={p} size={44} radius={11} />
            <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <h4
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 600,
                            fontSize: 14,
                            letterSpacing: -0.2,
                            margin: 0,
                            color: ST.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {p.name}
                    </h4>
                    {p.verified && <VerifBadge size={12} />}
                </div>
                <div
                    style={{
                        fontSize: 10.5,
                        color: ST.textFaint,
                        fontFamily: ST.fontMono,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {p.tag}
                </div>
            </div>
            <ExternalLink
                size={13}
                color={ST.textFaint}
                strokeWidth={1.8}
                style={{ flexShrink: 0, position: "relative" }}
            />
        </article>
    );
}

// @ts-expect-error reserved for future grid mode
function PartnerCardA({ p, onClick }: CardProps) {
    const ci = CAT_INFO[p.cat];
    const CatIcon = ci.icon;
    return (
        <article
            onClick={onClick}
            data-no-drag
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                borderRadius: 14,
                overflow: "hidden",
                position: "relative",
                background: ST.card,
                border: "1px solid " + ST.border,
                cursor: "pointer",
            }}
        >
            <div
                style={{
                    height: 70,
                    position: "relative",
                    background: `linear-gradient(135deg, oklch(0.45 0.18 ${p.hue}) 0%, oklch(0.3 0.12 ${(p.hue + 50) % 360}) 100%)`,
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 80% -20%, rgba(255,255,255,0.35), transparent 60%)",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        fontSize: 9,
                        fontFamily: ST.fontMono,
                        fontWeight: 600,
                        letterSpacing: 1,
                        color: "rgba(255,255,255,0.85)",
                        textTransform: "uppercase",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(0,0,0,0.25)",
                        padding: "3px 7px",
                        borderRadius: 4,
                    }}
                >
                    <CatIcon size={10} /> {ci.short}
                </div>
                {p.live && (
                    <div
                        style={{
                            position: "absolute",
                            top: 10,
                            left: 10,
                            fontSize: 9,
                            fontFamily: ST.fontMono,
                            fontWeight: 700,
                            letterSpacing: 1,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            background: "oklch(0.55 0.22 25)",
                            padding: "3px 7px",
                            borderRadius: 4,
                        }}
                    >
                        <span
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                background: "#fff",
                                animation: "startrad-pulse 1.4s infinite",
                            }}
                        />{" "}
                        LIVE
                    </div>
                )}
            </div>
            <div style={{ padding: "0 16px 16px", marginTop: -28, position: "relative" }}>
                <PartnerLogo p={p} size={56} radius={12} />
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <h3
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 600,
                            fontSize: 17,
                            letterSpacing: -0.3,
                            margin: 0,
                            color: ST.text,
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {p.name}
                    </h3>
                    {p.verified && <VerifBadge size={14} />}
                </div>
                <div style={{ fontSize: 11, color: ST.textFaint, fontFamily: ST.fontMono, marginTop: 2 }}>
                    {p.tag}
                </div>
                <p
                    style={{
                        fontSize: 13,
                        color: ST.textDim,
                        lineHeight: 1.45,
                        margin: "10px 0 14px",
                        minHeight: 56,
                    }}
                >
                    {p.desc}
                </p>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 11,
                        color: ST.textFaint,
                        fontFamily: ST.fontMono,
                        paddingTop: 10,
                        borderTop: "1px solid " + ST.border,
                    }}
                >
                    <span>Depuis {fmtDate(p.since)}</span>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            color: ST.accent,
                            fontWeight: 600,
                        }}
                    >
                        Ouvrir <ExternalLink size={11} strokeWidth={2} />
                    </span>
                </div>
            </div>
        </article>
    );
}

function ReelRow({
    icon: Icon,
    title,
    subtitle,
    wrap = false,
    children,
}: {
    icon: React.ComponentType<{ size?: number | string; color?: string; strokeWidth?: number | string }>;
    title: string;
    subtitle: string;
    wrap?: boolean;
    children: React.ReactNode;
}) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState(false);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const updateArrows = () => {
        const el = scrollerRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setCanLeft(el.scrollLeft > 4);
        setCanRight(el.scrollLeft < max - 4);
    };

    useLayoutEffect(() => {
        updateArrows();
    }, [children]);

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const onScroll = () => updateArrows();
        el.addEventListener("scroll", onScroll, { passive: true });
        const ro = new ResizeObserver(() => updateArrows());
        ro.observe(el);
        return () => {
            el.removeEventListener("scroll", onScroll);
            ro.disconnect();
        };
    }, []);

    const scrollBy = (dir: -1 | 1) => {
        const el = scrollerRef.current;
        if (!el) return;
        const step = Math.max(240, Math.round(el.clientWidth * 0.8));
        el.scrollBy({ left: dir * step, behavior: "smooth" });
    };

    const arrowBase: React.CSSProperties = {
        position: "absolute",
        top: 0,
        bottom: 4,
        width: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: "#fff",
        cursor: "pointer",
        zIndex: 3,
        transition: "opacity .18s ease",
        padding: 0,
    };

    const fadeBase: React.CSSProperties = {
        position: "absolute",
        top: 0,
        bottom: 4,
        width: 56,
        pointerEvents: "none",
        zIndex: 2,
        transition: "opacity .18s ease",
    };

    return (
        <section style={{ marginBottom: 22 }}>
            <div
                style={{
                    padding: "14px 0 12px",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                        style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid " + ST.border,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Icon size={15} color={ST.textDim} strokeWidth={1.7} />
                    </div>
                    <div>
                        <h3
                            style={{
                                fontFamily: ST.fontDisplay,
                                fontWeight: 700,
                                fontSize: 17,
                                letterSpacing: -0.3,
                                margin: 0,
                            }}
                        >
                            {title}
                        </h3>
                        <div style={{ fontSize: 11, color: ST.textFaint, marginTop: 1 }}>{subtitle}</div>
                    </div>
                </div>
            </div>
            {wrap ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                    {children}
                </div>
            ) : (
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{ position: "relative", margin: "0 -32px" }}
            >
                <div
                    style={{
                        ...fadeBase,
                        left: 0,
                        background:
                            "linear-gradient(90deg, oklch(0.22 0.03 275) 10%, rgba(0,0,0,0) 100%)",
                        opacity: canLeft ? 1 : 0,
                    }}
                />
                <div
                    style={{
                        ...fadeBase,
                        right: 0,
                        background:
                            "linear-gradient(270deg, oklch(0.22 0.03 275) 10%, rgba(0,0,0,0) 100%)",
                        opacity: canRight ? 1 : 0,
                    }}
                />
                <button
                    data-no-drag
                    onClick={() => scrollBy(-1)}
                    aria-label="Précédent"
                    tabIndex={canLeft ? 0 : -1}
                    style={{
                        ...arrowBase,
                        left: 0,
                        opacity: hovered && canLeft ? 1 : 0,
                        pointerEvents: hovered && canLeft ? "auto" : "none",
                    }}
                >
                    <span
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            background: "rgba(15,12,28,0.78)",
                            border: "1px solid " + ST.borderStrong,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                            backdropFilter: "blur(6px)",
                            WebkitBackdropFilter: "blur(6px)",
                        }}
                    >
                        <ChevronLeft size={18} strokeWidth={2.2} />
                    </span>
                </button>
                <button
                    data-no-drag
                    onClick={() => scrollBy(1)}
                    aria-label="Suivant"
                    tabIndex={canRight ? 0 : -1}
                    style={{
                        ...arrowBase,
                        right: 0,
                        opacity: hovered && canRight ? 1 : 0,
                        pointerEvents: hovered && canRight ? "auto" : "none",
                    }}
                >
                    <span
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            background: "rgba(15,12,28,0.78)",
                            border: "1px solid " + ST.borderStrong,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                            backdropFilter: "blur(6px)",
                            WebkitBackdropFilter: "blur(6px)",
                        }}
                    >
                        <ChevronRight size={18} strokeWidth={2.2} />
                    </span>
                </button>
                <div
                    ref={scrollerRef}
                    className="startrad-reel-scroller"
                    style={{
                        overflowX: "auto",
                        overflowY: "hidden",
                        padding: "0 32px 4px",
                        scrollSnapType: "x proximity",
                        scrollPaddingLeft: 32,
                        scrollPaddingRight: 32,
                    }}
                >
                    {children}
                </div>
            </div>
            )}
        </section>
    );
}

const PANEL_CLOSE_MS = 220;

function DetailPanel({ p, onClose }: { p: Partner; onClose: () => void }) {
    const ci = CAT_INFO[p.cat];
    const CatIcon = ci.icon;
    const [isClosing, setIsClosing] = useState(false);
    const handleClose = () => {
        if (isClosing) return;
        setIsClosing(true);
        window.setTimeout(onClose, PANEL_CLOSE_MS);
    };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div
            onClick={handleClose}
            data-no-drag
            style={{
                position: "absolute",
                inset: 0,
                background: "rgba(10,8,16,0.5)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                display: "flex",
                justifyContent: "flex-end",
                zIndex: 30,
                animation: isClosing
                    ? `startrad-fadeout ${PANEL_CLOSE_MS}ms ease-in forwards`
                    : "startrad-fadein 0.22s ease-out",
            }}
        >
            <aside
                onClick={(e) => e.stopPropagation()}
                data-no-drag
                style={{
                    width: 440,
                    maxWidth: "100%",
                    height: "100%",
                    background: ST.panel2,
                    borderLeft: "1px solid " + ST.borderStrong,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "-12px 0 40px rgba(0,0,0,0.4)",
                    animation: isClosing
                        ? `startrad-slideout ${PANEL_CLOSE_MS}ms cubic-bezier(0.55, 0, 0.7, 0.2) forwards`
                        : "startrad-slidein 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
                    willChange: "transform, opacity",
                }}
            >
                <div
                    style={{
                        height: 180,
                        position: "relative",
                        background: `linear-gradient(165deg, oklch(0.4 0.18 ${p.hue}) 0%, oklch(0.22 0.08 ${(p.hue + 40) % 360}) 100%)`,
                        padding: 20,
                        display: "flex",
                        alignItems: "flex-end",
                    }}
                >
                    <button
                        onClick={handleClose}
                        data-no-drag
                        style={{
                            position: "absolute",
                            top: 14,
                            right: 14,
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            border: "none",
                            background: "rgba(0,0,0,0.3)",
                            color: "#fff",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                        aria-label="Fermer"
                    >
                        <X size={16} strokeWidth={2} />
                    </button>
                    <PartnerLogo p={p} size={84} radius={18} />
                </div>
                <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 1.4,
                                color: ST.accent,
                                fontFamily: ST.fontMono,
                                textTransform: "uppercase",
                                padding: "3px 8px",
                                background: "rgba(160,120,255,0.12)",
                                borderRadius: 4,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                            }}
                        >
                            <CatIcon size={10} /> {ci.label}
                        </span>
                        {p.verified && (
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: 1.2,
                                    color: ST.accent,
                                    fontFamily: ST.fontMono,
                                    textTransform: "uppercase",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                }}
                            >
                                <VerifBadge size={12} /> Vérifié
                            </span>
                        )}
                    </div>
                    <h2
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontWeight: 700,
                            fontSize: 26,
                            letterSpacing: -0.5,
                            margin: "0 0 10px",
                        }}
                    >
                        {p.name}
                    </h2>
                    <p style={{ color: ST.textDim, fontSize: 14, lineHeight: 1.6 }}>{p.desc}</p>

                    <div
                        style={{
                            marginTop: 20,
                            padding: 16,
                            background: "rgba(0,0,0,0.2)",
                            borderRadius: 10,
                            border: "1px solid " + ST.border,
                        }}
                    >
                        <Row label="Catégorie" value={ci.label} />
                        {p.members && (
                            <Row label="Membres" value={p.members.toLocaleString("fr-FR")} mono />
                        )}
                        {p.cat !== "sponsor" && p.cat !== "site" && (
                            <Row label="Partenaire depuis" value={fmtFullDate(p.since)} />
                        )}
                        <Row
                            label="Lien"
                            value={linkLabel(p)}
                            accent
                            last
                        />
                    </div>

                    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                        <button
                            data-no-drag
                            onClick={() => openLink(p.link)}
                            style={{
                                width: "100%",
                                border: "none",
                                color: "#1a1326",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                padding: 14,
                                borderRadius: 10,
                                background: "#fff",
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            {p.cat === "organisation"
                                ? "Voir sur RSI"
                                : p.cat === "discord"
                                  ? "Rejoindre le Discord"
                                  : p.cat === "streamer"
                                    ? "Voir la chaîne"
                                    : "Visiter"}{" "}
                            <ArrowUpRight size={14} strokeWidth={2.4} />
                        </button>
                        {p.discordInvite && (
                            <button
                                data-no-drag
                                onClick={() => openLink(p.discordInvite!)}
                                style={{
                                    width: "100%",
                                    border: "1px solid " + ST.borderStrong,
                                    color: "#fff",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    padding: 14,
                                    borderRadius: 10,
                                    background: "rgba(88,101,242,0.18)",
                                    fontSize: 14,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                <IconBrandDiscord size={16} /> Rejoindre le Discord
                            </button>
                        )}
                    </div>
                </div>
            </aside>
        </div>
    );
}

function Row({
    label,
    value,
    mono,
    accent,
    last,
}: {
    label: string;
    value: string;
    mono?: boolean;
    accent?: boolean;
    last?: boolean;
}) {
    return (
        <div
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: last ? "none" : "1px solid " + ST.border,
            }}
        >
            <span
                style={{
                    fontSize: 11,
                    color: ST.textFaint,
                    fontFamily: ST.fontMono,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: accent ? 12 : 13,
                    fontWeight: accent ? 500 : 600,
                    color: accent ? ST.accent : ST.text,
                    fontFamily: accent || mono ? ST.fontMono : undefined,
                    fontVariantNumeric: mono ? "tabular-nums" : undefined,
                }}
            >
                {value}
            </span>
        </div>
    );
}

export default function Partenaires() {
    const [tab, setTab] = useState<PartnerCat | "all">("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [liveMembers, setLiveMembers] = useState<Record<string, number>>({});
    const [livePresence, setLivePresence] = useState<Record<string, number>>({});
    const [discordIcons, setDiscordIcons] = useState<Record<string, string>>({});
    const [twitchInfo, setTwitchInfo] = useState<Record<string, TwitchStatusInfo>>({});

    useEffect(() => {
        if (!isTauri()) return;
        let cancelled = false;
        const discordPartners = PARTNERS.filter((p) => {
            const url = p.cat === "discord" ? p.link : p.discordInvite;
            return url != null && /discord\.(gg|com)/.test(url);
        });
        const twitchPartners = PARTNERS.filter(
            (p) => p.linkType === "twitch" && /twitch\.tv/.test(p.link)
        );
        (async () => {
            for (const p of discordPartners) {
                const inviteUrl = p.cat === "discord" ? p.link : p.discordInvite!;
                try {
                    const info = await invoke<DiscordInviteInfo>(
                        "partners_fetch_discord_invite",
                        { codeOrUrl: inviteUrl }
                    );
                    if (cancelled) return;
                    if (info.approximateMemberCount != null) {
                        setLiveMembers((prev) => ({
                            ...prev,
                            [p.id]: info.approximateMemberCount!,
                        }));
                    }
                    if (info.approximatePresenceCount != null) {
                        setLivePresence((prev) => ({
                            ...prev,
                            [p.id]: info.approximatePresenceCount!,
                        }));
                    }
                    if (info.guildIconUrl) {
                        setDiscordIcons((prev) => ({
                            ...prev,
                            [p.id]: info.guildIconUrl!,
                        }));
                    }
                } catch {
                    // silently ignore — fallback to hardcoded p.members if any
                }
            }
            for (const p of twitchPartners) {
                try {
                    const info = await invoke<TwitchStatusInfo>(
                        "partners_fetch_twitch_status",
                        { loginOrUrl: p.link }
                    );
                    if (cancelled) return;
                    setTwitchInfo((prev) => ({ ...prev, [p.id]: info }));
                } catch {
                    // silently ignore
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const partners = useMemo(
        () =>
            PARTNERS.map((p) => {
                let next = p;
                if (liveMembers[p.id] != null) {
                    next = { ...next, members: liveMembers[p.id] };
                }
                if (livePresence[p.id] != null) {
                    next = { ...next, online: livePresence[p.id] };
                }
                if (!next.logo && discordIcons[p.id]) {
                    next = { ...next, logo: discordIcons[p.id] };
                }
                const tw = twitchInfo[p.id];
                if (tw) {
                    next = {
                        ...next,
                        live: tw.live,
                        logo: tw.avatarUrl ?? next.logo,
                    };
                }
                if (!next.logo && (next.cat === "site" || next.cat === "sponsor") && next.linkType === "web") {
                    const fav = faviconFor(next.link);
                    if (fav) next = { ...next, logo: fav };
                }
                return next;
            }),
        [liveMembers, livePresence, discordIcons, twitchInfo]
    );

    // Tous les partenaires marqués featured : on tourne entre eux en hero
    const featuredPartners = useMemo(
        () => partners.filter((p) => p.featured),
        [partners]
    );
    const [heroIndex, setHeroIndex] = useState(0);
    // `manualTick` permet de reset l'interval quand l'user clique un dot
    const [manualTick, setManualTick] = useState(0);
    // Rotation lente entre les featured (toutes les 8s) — désactivée s'il n'y en a qu'un
    useEffect(() => {
        if (featuredPartners.length <= 1) return;
        const id = window.setInterval(() => {
            setHeroIndex((i) => (i + 1) % featuredPartners.length);
        }, 8000);
        return () => window.clearInterval(id);
    }, [featuredPartners.length, manualTick]);
    // Reset l'index si la liste change et qu'on est out of bounds
    useEffect(() => {
        if (heroIndex >= featuredPartners.length) setHeroIndex(0);
    }, [featuredPartners.length, heroIndex]);

    const hero = featuredPartners[heroIndex] ?? partners[0];
    const heroOnline = livePresence[hero.id];

    const goToHero = (idx: number) => {
        setHeroIndex(idx);
        setManualTick((t) => t + 1); // reset l'interval pour pas switch trop vite après clic
    };
    const selected = selectedId ? partners.find((p) => p.id === selectedId) ?? null : null;

    const matchSearch = (p: Partner) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
            p.name.toLowerCase().includes(q) ||
            p.tag.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q)
        );
    };

    const showHero = (tab === "all" || tab === hero.cat) && matchSearch(hero);

    const counts = useMemo(
        () => ({
            all: partners.length,
            organisation: partners.filter((p) => p.cat === "organisation").length,
            streamer: partners.filter((p) => p.cat === "streamer").length,
            discord: partners.filter((p) => p.cat === "discord").length,
            sponsor: partners.filter((p) => p.cat === "sponsor").length,
            site: partners.filter((p) => p.cat === "site").length,
        }),
        [partners]
    );

    const inReel = (cat: PartnerCat) =>
        partners.filter((p) => p.cat === cat && matchSearch(p));

    const Chip = ({
        id,
        icon: Icon,
        label,
        count,
    }: {
        id: PartnerCat | "all";
        icon: React.ComponentType<{ size?: number | string }>;
        label: string;
        count: number;
    }) => {
        const active = tab === id;
        return (
            <button
                data-no-drag
                onClick={() => setTab(id)}
                style={{
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: active ? "#fff" : "rgba(255,255,255,0.05)",
                    color: active ? "#1a1326" : ST.textDim,
                    fontSize: 13,
                    fontWeight: 600,
                    boxShadow: active ? "0 4px 18px rgba(0,0,0,0.25)" : "inset 0 0 0 1px " + ST.border,
                    transition: "all .15s",
                }}
            >
                <Icon size={14} />
                <span>{label}</span>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        opacity: active ? 0.5 : 0.6,
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    {count}
                </span>
            </button>
        );
    };

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                color: ST.text,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}
        >
            <style>{`
                @keyframes startrad-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
                @keyframes startrad-slidein { from { transform: translateX(48px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
                @keyframes startrad-slideout { from { transform: translateX(0); opacity: 1 } to { transform: translateX(48px); opacity: 0 } }
                @keyframes startrad-fadein { from { opacity: 0 } to { opacity: 1 } }
                @keyframes startrad-fadeout { from { opacity: 1 } to { opacity: 0 } }
                .startrad-reel-scroller { scrollbar-width: none; -ms-overflow-style: none; }
                .startrad-reel-scroller::-webkit-scrollbar { display: none; height: 0; width: 0; }
                .startrad-sponsor-chip:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.18); box-shadow: 0 8px 22px rgba(0,0,0,0.35); }
            `}</style>

            <div
                style={{
                    padding: "24px 32px 0",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: 24,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <div
                        style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 2,
                            color: ST.accent,
                            fontFamily: ST.fontMono,
                            textTransform: "uppercase",
                            marginBottom: 8,
                        }}
                    >
                        ╴ Communauté
                    </div>
                    <h1
                        style={{
                            fontFamily: ST.fontDisplay,
                            fontSize: 36,
                            fontWeight: 700,
                            letterSpacing: -1,
                            margin: 0,
                            lineHeight: 1,
                        }}
                    >
                        Le salon des partenaires
                    </h1>
                    <p
                        style={{
                            color: ST.textDim,
                            fontSize: 14,
                            margin: "8px 0 0",
                            maxWidth: 520,
                            lineHeight: 1.5,
                        }}
                    >
                        Les orgs, créateurs, communautés Discord et sponsors qui font vivre StarTrad au quotidien.
                    </p>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            background: "rgba(255,255,255,0.05)",
                            borderRadius: 10,
                            fontSize: 13,
                            color: ST.textDim,
                            width: 240,
                            border: "1px solid " + ST.border,
                        }}
                    >
                        <Search size={14} color={ST.textFaint} />
                        <input
                            data-no-drag
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Rechercher…"
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                color: ST.text,
                                fontSize: 13,
                                minWidth: 0,
                            }}
                        />
                        {search ? (
                            <button
                                data-no-drag
                                onClick={() => setSearch("")}
                                aria-label="Effacer la recherche"
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    color: ST.textFaint,
                                    cursor: "pointer",
                                    display: "flex",
                                    padding: 0,
                                }}
                            >
                                <X size={12} />
                            </button>
                        ) : (
                            <kbd
                                style={{
                                    fontSize: 10,
                                    fontFamily: ST.fontMono,
                                    padding: "1px 5px",
                                    background: "rgba(255,255,255,0.06)",
                                    borderRadius: 4,
                                    color: ST.textFaint,
                                }}
                            >
                                ⌘K
                            </kbd>
                        )}
                    </div>
                    <button
                        data-no-drag
                        onClick={() => openLink("https://discord.startrad.link/")}
                        style={{
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 13,
                            padding: "10px 16px",
                            borderRadius: 10,
                            color: "#fff",
                            background: `linear-gradient(135deg, ${ST.accent}, oklch(0.55 0.2 320))`,
                            boxShadow: `0 6px 20px ${ST.accentGlow}`,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <Plus size={14} strokeWidth={2.2} />
                        Devenir partenaire
                    </button>
                </div>
            </div>

            <div style={{ padding: "20px 32px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Chip id="all" icon={LayoutGrid} label="Tous" count={counts.all} />
                <Chip id="organisation" icon={Flag} label="Organisations" count={counts.organisation} />
                <Chip id="streamer" icon={Twitch} label="Streamers" count={counts.streamer} />
                <Chip id="discord" icon={IconBrandDiscord} label="Discord" count={counts.discord} />
                <Chip id="sponsor" icon={Star} label="Sponsors" count={counts.sponsor} />
                <Chip id="site" icon={ExternalLink} label="Sites" count={counts.site} />
            </div>

            <div
                className="app-scroll-root"
                style={{ flex: 1, overflowY: "auto", padding: "20px 32px 32px", minHeight: 0 }}
            >
                {showHero && (
                    <AnimatePresence mode="wait">
                    <m.article
                        key={hero.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        onClick={() => setSelectedId(hero.id)}
                        data-no-drag
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedId(hero.id);
                            }
                        }}
                        style={{
                            borderRadius: 16,
                            overflow: "hidden",
                            position: "relative",
                            cursor: "pointer",
                            background: `linear-gradient(115deg, oklch(0.32 0.12 ${hero.hue}) 0%, oklch(0.22 0.07 ${(hero.hue + 30) % 360}) 60%, ${ST.card} 100%)`,
                            border: "1px solid " + ST.borderStrong,
                            padding: "28px 32px",
                            display: "flex",
                            gap: 28,
                            alignItems: "center",
                            marginBottom: tab === "all" ? 12 : 28,
                            minHeight: 200,
                            flexWrap: "wrap",
                        }}
                    >
                        <svg
                            style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                opacity: 0.15,
                                pointerEvents: "none",
                            }}
                            viewBox="0 0 800 240"
                        >
                            {Array.from({ length: 60 }).map((_, i) => {
                                const x = (i * 137.5) % 800;
                                const y = (i * 91.3) % 240;
                                const r = i % 4 === 0 ? 2 : 0.8;
                                return <circle key={i} cx={x} cy={y} r={r} fill="#fff" />;
                            })}
                            <path
                                d="M 0 200 Q 200 140 400 170 T 800 130"
                                stroke="#fff"
                                strokeWidth="0.5"
                                fill="none"
                                opacity="0.4"
                            />
                        </svg>
                        <PartnerLogo p={hero} size={120} radius={22} />
                        <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: 1.6,
                                        color: ST.accent,
                                        fontFamily: ST.fontMono,
                                        textTransform: "uppercase",
                                        padding: "3px 8px",
                                        background: "rgba(255,255,255,0.08)",
                                        borderRadius: 4,
                                    }}
                                >
                                    ★ Mis en avant
                                </span>
                                <span
                                    style={{ fontSize: 11, color: ST.textFaint, fontFamily: ST.fontMono }}
                                >
                                    {hero.tag}
                                </span>
                            </div>
                            <h2
                                style={{
                                    fontFamily: ST.fontDisplay,
                                    fontSize: 30,
                                    fontWeight: 700,
                                    letterSpacing: -0.6,
                                    margin: "4px 0 6px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                }}
                            >
                                {hero.name} {hero.verified && <VerifBadge size={20} />}
                            </h2>
                            <p
                                style={{
                                    color: ST.textDim,
                                    fontSize: 14,
                                    margin: 0,
                                    lineHeight: 1.55,
                                    maxWidth: 560,
                                }}
                            >
                                {hero.desc}
                            </p>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                                alignItems: "flex-end",
                                minWidth: 200,
                                position: "relative",
                            }}
                        >
                            {/* Stats box (membres / online) — uniquement pour les cats avec
                                une vraie communauté (orga, discord, streamer). Pour les
                                boutiques/sponsors/sites c'est pas pertinent. */}
                            {(hero.cat === "organisation" || hero.cat === "discord" || hero.cat === "streamer") && (
                            <div
                                style={{
                                    display: "flex",
                                    gap: 14,
                                    padding: "12px 16px",
                                    background: "rgba(0,0,0,0.25)",
                                    borderRadius: 10,
                                    border: "1px solid " + ST.border,
                                }}
                            >
                                <div style={{ textAlign: "center" }}>
                                    <div
                                        style={{
                                            fontFamily: ST.fontDisplay,
                                            fontSize: 22,
                                            fontWeight: 700,
                                            color: "#fff",
                                            fontVariantNumeric: "tabular-nums",
                                        }}
                                    >
                                        {hero.members != null
                                            ? hero.members >= 1000
                                                ? (hero.members / 1000).toFixed(1) + "k"
                                                : hero.members.toLocaleString("fr-FR")
                                            : "—"}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 10,
                                            color: ST.textFaint,
                                            fontFamily: ST.fontMono,
                                            letterSpacing: 0.8,
                                            textTransform: "uppercase",
                                            marginTop: 2,
                                        }}
                                    >
                                        Membres
                                    </div>
                                </div>
                                <div style={{ width: 1, background: ST.border }} />
                                <div style={{ textAlign: "center" }}>
                                    <div
                                        style={{
                                            fontFamily: ST.fontDisplay,
                                            fontSize: 22,
                                            fontWeight: 700,
                                            color: "#fff",
                                            fontVariantNumeric: "tabular-nums",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 6,
                                        }}
                                    >
                                        {heroOnline != null ? (
                                            <>
                                                <span
                                                    style={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: 4,
                                                        background: "oklch(0.78 0.16 150)",
                                                        boxShadow:
                                                            "0 0 8px oklch(0.78 0.16 150 / 0.7)",
                                                    }}
                                                />
                                                {heroOnline.toLocaleString("fr-FR")}
                                            </>
                                        ) : (
                                            `${new Date().getFullYear() - new Date(hero.since).getFullYear()} ans`
                                        )}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 10,
                                            color: ST.textFaint,
                                            fontFamily: ST.fontMono,
                                            letterSpacing: 0.8,
                                            textTransform: "uppercase",
                                            marginTop: 2,
                                        }}
                                    >
                                        {heroOnline != null ? "En ligne" : "Partenaire"}
                                    </div>
                                </div>
                            </div>
                            )}
                            <button
                                data-no-drag
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openLink(hero.link);
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "10px 18px",
                                    borderRadius: 10,
                                    background: "#fff",
                                    color: "#1a1326",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    border: "none",
                                    cursor: "pointer",
                                }}
                            >
                                {hero.cat === "discord"
                                    ? "Rejoindre le Discord"
                                    : hero.cat === "streamer"
                                      ? "Voir la chaîne"
                                      : "Visiter"}{" "}
                                <ArrowUpRight size={14} strokeWidth={2} />
                            </button>
                        </div>
                    </m.article>
                    </AnimatePresence>
                )}
                {showHero && featuredPartners.length > 1 && (
                    <div
                        data-no-drag
                        style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: -16,
                            marginBottom: tab === "all" ? 12 : 24,
                            position: "relative",
                            zIndex: 2,
                        }}
                    >
                        {featuredPartners.map((p, idx) => {
                            const active = idx === heroIndex;
                            return (
                                <button
                                    key={p.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        goToHero(idx);
                                    }}
                                    aria-label={`Afficher ${p.name}`}
                                    aria-current={active}
                                    title={p.name}
                                    style={{
                                        cursor: "pointer",
                                        background: active
                                            ? `oklch(0.7 0.17 ${p.hue})`
                                            : "rgba(255,255,255,0.18)",
                                        border: "1px solid " + (active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.10)"),
                                        width: active ? 22 : 8,
                                        height: 8,
                                        borderRadius: 999,
                                        padding: 0,
                                        transition: "width .25s ease, background .25s ease",
                                        boxShadow: active ? `0 0 8px oklch(0.7 0.17 ${p.hue} / 0.6)` : "none",
                                    }}
                                />
                            );
                        })}
                    </div>
                )}

                {(tab === "all" || tab === "organisation") && inReel("organisation").length > 0 && (
                    <ReelRow
                        icon={Flag}
                        title="Organisations"
                        subtitle="Corporations et squadrons francophones"
                        wrap={tab === "organisation"}
                    >
                        {tab === "organisation" ? (
                            inReel("organisation").map((p) => (
                                <OrgCard key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 14 }}>
                                {inReel("organisation").map((p) => (
                                    <OrgCard key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {(tab === "all" || tab === "streamer") && inReel("streamer").length > 0 && (
                    <ReelRow
                        icon={Twitch}
                        title="Streamers & créateurs"
                        subtitle="Lives, guides, lore"
                        wrap={tab === "streamer"}
                    >
                        {tab === "streamer" ? (
                            inReel("streamer").map((p) => (
                                <StreamerCard key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 14 }}>
                                {inReel("streamer").map((p) => (
                                    <StreamerCard key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {(tab === "all" || tab === "boutique") && (
                    <ReelRow
                        icon={Package}
                        title="Boutiques & Makers"
                        subtitle="Artisans et créateurs de la communauté"
                        wrap={tab === "boutique"}
                    >
                        {inReel("boutique").length === 0 ? (
                            <div
                                style={{
                                    padding: "18px 0 4px",
                                    fontSize: 12,
                                    color: ST.textFaint,
                                    fontStyle: "italic",
                                }}
                            >
                                Aucune boutique pour le moment.
                            </div>
                        ) : tab === "boutique" ? (
                            inReel("boutique").map((p) => (
                                <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 12 }}>
                                {inReel("boutique").map((p) => (
                                    <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {(tab === "all" || tab === "discord") && inReel("discord").length > 0 && (
                    <ReelRow
                        icon={IconBrandDiscord}
                        title="Serveurs Discord"
                        subtitle="Là où on se retrouve"
                        wrap={tab === "discord"}
                    >
                        {tab === "discord" ? (
                            inReel("discord").map((p) => (
                                <DiscordNode key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
                                {inReel("discord").map((p) => (
                                    <DiscordNode key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {(tab === "all" || tab === "sponsor") && (
                    <ReelRow
                        icon={Star}
                        title="Sponsors"
                        subtitle="Ils soutiennent StarTrad"
                        wrap={tab === "sponsor"}
                    >
                        {inReel("sponsor").length === 0 ? (
                            <div
                                style={{
                                    padding: "18px 0 4px",
                                    fontSize: 12,
                                    color: ST.textFaint,
                                    fontStyle: "italic",
                                }}
                            >
                                Aucun sponsor pour le moment.
                            </div>
                        ) : tab === "sponsor" ? (
                            inReel("sponsor").map((p) => (
                                <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 12 }}>
                                {inReel("sponsor").map((p) => (
                                    <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {(tab === "all" || tab === "site") && inReel("site").length > 0 && (
                    <ReelRow
                        icon={ExternalLink}
                        title="Sites"
                        subtitle="Les sites SC que j'utilise au quotidien"
                        wrap={tab === "site"}
                    >
                        {tab === "site" ? (
                            inReel("site").map((p) => (
                                <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                            ))
                        ) : (
                            <div style={{ display: "flex", gap: 12 }}>
                                {inReel("site").map((p) => (
                                    <SponsorChip key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                                ))}
                            </div>
                        )}
                    </ReelRow>
                )}
                {tab !== "all" && inReel(tab).length === 0 && (
                    <div
                        style={{
                            padding: "48px 16px",
                            textAlign: "center",
                            color: ST.textDim,
                            fontSize: 14,
                        }}
                    >
                        Aucun partenaire dans cette catégorie pour le moment.
                    </div>
                )}

                {false && <div
                    style={{
                        marginTop: 28,
                        padding: "18px 24px",
                        borderRadius: 12,
                        border: "1px dashed " + ST.borderStrong,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <div
                            style={{
                                fontFamily: ST.fontDisplay,
                                fontWeight: 600,
                                fontSize: 15,
                                marginBottom: 2,
                            }}
                        >
                            Et si c'était vous le prochain ?
                        </div>
                        <div style={{ fontSize: 13, color: ST.textDim }}>
                            StarTrad ouvre des partenariats orgs, streamers et outils communautaires
                            chaque mois.
                        </div>
                    </div>
                    <button
                        data-no-drag
                        onClick={() => openLink("https://discord.startrad.link/")}
                        style={{
                            border: "1px solid " + ST.borderStrong,
                            background: "transparent",
                            color: ST.text,
                            fontWeight: 600,
                            fontSize: 13,
                            padding: "9px 16px",
                            borderRadius: 9,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        En savoir plus <ArrowRight size={13} strokeWidth={2} />
                    </button>
                </div>}
            </div>

            {selected && <DetailPanel p={selected} onClose={() => setSelectedId(null)} />}
        </div>
    );
}
