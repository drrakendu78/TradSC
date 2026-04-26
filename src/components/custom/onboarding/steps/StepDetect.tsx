// Step 2 — Détection de Star Citizen via `get_star_citizen_versions`.
// DA alignée sur la page Traduction : Card glassmorphism + radial primary,
// mais layout adaptatif selon le nombre de versions pour ne pas avoir de
// cards perdues seules dans le vide quand seul LIVE est installé.
//
// L'état "traduite" est re-vérifié à la volée via `is_game_translated` car
// le champ `translated` retourné par `get_star_citizen_versions` peut être
// périmé (cache, install/desinstall manuel récent, etc.).

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    CheckCircle,
    FolderOpen,
    Globe2,
    Info,
    Loader2,
    Rocket,
    Sparkles,
    XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VersionInfo } from "../types";

interface StepDetectProps {
    versions: Record<string, VersionInfo>;
    versionsLoaded: boolean;
}

// Toutes les branches officielles RSI listées en ordre de stabilité.
// TECH-PREVIEW est rare mais réel (ex. pour tester des nouvelles features
// graphiques avant la PTU). Le launcher RSI peut l'afficher sans qu'elle
// soit installée chez la plupart des utilisateurs.
const KNOWN_BRANCHES: Array<{ name: string; tone: string; desc: string }> = [
    { name: "LIVE", tone: "emerald", desc: "Branche stable publique" },
    { name: "PTU", tone: "amber", desc: "Public Test Universe" },
    { name: "EPTU", tone: "rose", desc: "Evocati / pre-release" },
    { name: "TECH-PREVIEW", tone: "indigo", desc: "Tests de tech récente (rare)" },
];

type RealMap = Record<string, boolean>;

export function StepDetect({ versions, versionsLoaded }: StepDetectProps) {
    const list = Object.keys(versions).sort();
    const detectedCount = list.length;

    // Re-check réel par version. Tant que le check n'a pas répondu, on retombe
    // sur le `info.translated` du parent pour ne pas afficher tout faux.
    const [realTranslated, setRealTranslated] = useState<RealMap>({});

    useEffect(() => {
        if (!versionsLoaded || list.length === 0) return;
        let cancelled = false;
        const checkAll = async () => {
            await Promise.all(
                list.map(async (ver) => {
                    const info = versions[ver];
                    if (!info?.path) return;
                    try {
                        const ok = await invoke<boolean>("is_game_translated", {
                            path: info.path,
                            lang: "fr",
                        });
                        if (cancelled) return;
                        setRealTranslated((cur) => ({ ...cur, [ver]: ok }));
                    } catch {
                        /* on garde le default du parent */
                    }
                })
            );
        };
        void checkAll();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.join("|"), versionsLoaded]);

    const isTranslated = (ver: string): boolean => {
        if (ver in realTranslated) return realTranslated[ver];
        return !!versions[ver]?.translated;
    };
    const translatedCount = list.filter(isTranslated).length;
    const missing = KNOWN_BRANCHES.filter((b) => !list.includes(b.name));

    return (
        <div className="space-y-5">
            {/* Hero glass + stats inline */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%)]" />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                            <Globe2 className="h-6 w-6" />
                        </div>
                        <div className="space-y-1">
                            <h2 className="font-exo text-2xl font-semibold tracking-tight">
                                Détection de Star Citizen
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                On scanne tes installations pour proposer la traduction adaptée.
                            </p>
                        </div>
                    </div>
                    {versionsLoaded && (
                        <div className="flex items-center gap-2">
                            <StatPill
                                value={detectedCount}
                                label={detectedCount > 1 ? "détectées" : "détectée"}
                                accent="primary"
                            />
                            <StatPill
                                value={translatedCount}
                                label={translatedCount > 1 ? "traduites" : "traduite"}
                                accent="emerald"
                            />
                        </div>
                    )}
                </div>
            </section>

            {!versionsLoaded ? (
                <div className="flex h-32 items-center justify-center rounded-2xl border border-border/40 bg-[hsl(var(--background)/0.14)]">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : list.length === 0 ? (
                <Card className="relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                    <CardContent className="relative flex flex-col items-center gap-3 p-8 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
                            <XCircle className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-semibold">Aucune version Star Citizen détectée</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Lance le launcher RSI pour installer ou détecter une version, puis
                                reviens ici.
                            </p>
                        </div>
                        <Button
                            variant="default"
                            onClick={() => void invoke("launch_rsi_launcher").catch(console.error)}
                            className="mt-2 h-10 gap-2 rounded-lg"
                        >
                            <Rocket className="h-4 w-4" />
                            Lancer le launcher RSI
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* Versions installées : grid adaptative selon le count */}
                    <div
                        className={`grid gap-3 ${
                            detectedCount === 1
                                ? "grid-cols-1"
                                : detectedCount === 2
                                    ? "grid-cols-2"
                                    : "grid-cols-3"
                        }`}
                    >
                        {list.map((ver) => {
                            const info = versions[ver];
                            return (
                                <VersionCard
                                    key={ver}
                                    ver={ver}
                                    info={info}
                                    translated={isTranslated(ver)}
                                    expanded={detectedCount === 1}
                                />
                            );
                        })}
                    </div>

                    {/* Slots des branches non détectées : transparent, indicatif,
                        rappelle qu'on peut installer plus de variantes */}
                    {missing.length > 0 && (
                        <section className="rounded-2xl border border-border/40 bg-[hsl(var(--background)/0.20)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground/90">
                                    <Sparkles className="h-4 w-4 text-primary" />
                                    Branches Star Citizen disponibles
                                </h3>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        void invoke("launch_rsi_launcher").catch(console.error)
                                    }
                                    className="h-8 gap-1.5 rounded-lg border-border/60 bg-background/40 text-[12px]"
                                >
                                    <Rocket className="h-3.5 w-3.5" />
                                    Lancer RSI launcher
                                </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {KNOWN_BRANCHES.map((b) => {
                                    const detected = list.includes(b.name);
                                    return (
                                        <BranchSlot
                                            key={b.name}
                                            name={b.name}
                                            desc={b.desc}
                                            detected={detected}
                                            tone={b.tone}
                                        />
                                    );
                                })}
                            </div>
                            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Info className="h-3 w-3" />
                                Installer d'autres branches via le launcher RSI les rendra
                                disponibles dans le wizard et la page Traduction.
                            </p>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

function VersionCard({
    ver,
    info,
    translated,
    expanded,
}: {
    ver: string;
    info: VersionInfo;
    translated: boolean;
    expanded: boolean;
}) {
    return (
        <Card
            className={`group relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all duration-200 hover:border-primary/25 hover:bg-[hsl(var(--background)/0.18)] ${
                expanded ? "" : ""
            }`}
        >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
            <CardHeader className="relative space-y-2 pb-2 pt-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                            <Globe2 className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-base tracking-tight">{ver}</CardTitle>
                            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                                Branche {ver}
                            </p>
                        </div>
                    </div>
                    {translated ? (
                        <Badge
                            variant="default"
                            className="h-6 gap-1 rounded-md border border-green-500/30 bg-green-500/20 text-[11px] text-green-600 dark:text-green-400"
                        >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Traduite
                        </Badge>
                    ) : (
                        <Badge
                            variant="outline"
                            className="h-6 gap-1 rounded-md border-border/60 bg-background/30 text-[11px]"
                        >
                            <XCircle className="h-3.5 w-3.5" />
                            Non traduite
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="relative pb-4 pt-1">
                <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-[hsl(var(--background)/0.26)] px-2.5 py-2">
                    <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <p
                        className="truncate font-mono text-[11px] text-muted-foreground/95"
                        title={info.path}
                    >
                        {info.path}
                    </p>
                </div>
                {expanded && (
                    <p className="mt-3 text-[12px] text-muted-foreground/85">
                        Cette version est prête à recevoir la traduction française. Clique sur
                        Suivant pour choisir la source.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

const slotTones: Record<string, { border: string; bg: string; text: string }> = {
    emerald: {
        border: "border-emerald-500/25",
        bg: "bg-emerald-500/8",
        text: "text-emerald-600 dark:text-emerald-400",
    },
    amber: {
        border: "border-amber-500/25",
        bg: "bg-amber-500/8",
        text: "text-amber-600 dark:text-amber-400",
    },
    rose: {
        border: "border-rose-500/25",
        bg: "bg-rose-500/8",
        text: "text-rose-600 dark:text-rose-400",
    },
    indigo: {
        border: "border-indigo-500/25",
        bg: "bg-indigo-500/8",
        text: "text-indigo-600 dark:text-indigo-400",
    },
};

function BranchSlot({
    name,
    desc,
    detected,
    tone,
}: {
    name: string;
    desc: string;
    detected: boolean;
    tone: string;
}) {
    const t = slotTones[tone] ?? slotTones.emerald;
    return (
        <div
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
                detected
                    ? `${t.border} ${t.bg}`
                    : "border-dashed border-border/40 bg-[hsl(var(--background)/0.20)]"
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <span
                    className={`text-[13px] font-semibold ${
                        detected ? t.text : "text-muted-foreground"
                    }`}
                >
                    {name}
                </span>
                {detected ? (
                    <CheckCircle className={`h-4 w-4 ${t.text}`} />
                ) : (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Absente
                    </span>
                )}
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/85">{desc}</p>
        </div>
    );
}

function StatPill({
    value,
    label,
    accent,
}: {
    value: number;
    label: string;
    accent: "primary" | "emerald";
}) {
    const cls =
        accent === "emerald"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-primary/35 bg-primary/10 text-primary";
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${cls}`}
        >
            <span className="font-exo text-xl font-semibold leading-none">{value}</span>
            <span className="text-[10.5px] uppercase tracking-wider opacity-80">{label}</span>
        </div>
    );
}
