// Step 6 — Récap final. DA alignée sur les stat tiles de SettingsContent
// (rounded-xl border border-border/40 bg-background/45) regroupés dans un
// settings panel.

import { useMemo } from "react";
import {
    Bell,
    BrushCleaning,
    CheckCircle2,
    Cloud,
    Disc3,
    Globe2,
    Languages,
    Power,
    Smartphone,
    Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ServicesConfig, VersionInfo, VersionSelection } from "../types";

interface StepRecapProps {
    versions: Record<string, VersionInfo>;
    perVersion: Record<string, VersionSelection>;
    services: ServicesConfig;
    connected: boolean;
}

export function StepRecap({ versions, perVersion, services, connected }: StepRecapProps) {
    const installSummary = useMemo(() => {
        return Object.entries(perVersion)
            .filter(([, sel]) => sel.installNow && sel.selectedLink)
            .map(([ver]) => ver);
    }, [perVersion]);

    const versionList = Object.keys(versions).sort();
    const hasVersions = versionList.length > 0;

    return (
        <div className="space-y-5">
            {/* Hero glass succès */}
            <section className="relative overflow-hidden rounded-2xl border border-emerald-500/35 bg-[hsl(var(--background)/0.30)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,rgba(16,185,129,0.18),transparent_62%),radial-gradient(100%_80%_at_0%_100%,hsl(var(--primary)/0.08),transparent_58%)]" />
                <div className="relative flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-500">
                        <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="font-exo text-2xl font-semibold tracking-tight">
                            Configuration prête
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Voici ce qui va être appliqué. Tout reste modifiable depuis les paramètres.
                        </p>
                    </div>
                </div>
            </section>

            {/* Stat tiles glass façon Settings activity */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-4 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-5">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%)]" />
                <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <RecapTile
                        icon={<Globe2 className="h-4 w-4" />}
                        label="Star Citizen"
                        value={hasVersions ? versionList.join(" · ") : "Non détecté"}
                        accent="primary"
                    />
                    <RecapTile
                        icon={<Languages className="h-4 w-4" />}
                        label="Traductions"
                        value={
                            installSummary.length > 0
                                ? installSummary.join(" · ") + " installée(s)"
                                : "Aucune"
                        }
                        accent="primary"
                    />
                    <RecapTile
                        icon={<Sparkles className="h-4 w-4" />}
                        label="Services"
                        value={`${[
                            services.backgroundEnabled,
                            services.discordEnabled,
                            services.autoStartup,
                            services.companionEnabled,
                            services.autoCleanObsoleteCaches,
                        ].filter(Boolean).length} activé(s)`}
                        accent="primary"
                    />
                    <RecapTile
                        icon={<Cloud className="h-4 w-4" />}
                        label="Cloud"
                        value={connected ? "Connecté" : "Local"}
                        accent={connected ? "emerald" : "muted"}
                    />
                </div>
            </section>

            {/* Cards détail : services activés + sources choisies */}
            <div className="grid grid-cols-2 gap-4">
                <Card className="relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                    <CardContent className="relative space-y-2 p-4">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Services
                        </h3>
                        <DetailRow
                            icon={<Bell className="h-4 w-4" />}
                            label="Vérification auto"
                            value={
                                services.backgroundEnabled
                                    ? `Toutes les ${services.backgroundIntervalMin} min`
                                    : "Désactivée"
                            }
                            on={services.backgroundEnabled}
                        />
                        <DetailRow
                            icon={<Disc3 className="h-4 w-4" />}
                            label="Discord RPC"
                            value={services.discordEnabled ? "Activé" : "Désactivé"}
                            on={services.discordEnabled}
                        />
                        <DetailRow
                            icon={<Power className="h-4 w-4" />}
                            label="Démarrage Windows"
                            value={services.autoStartup ? "Activé" : "Manuel"}
                            on={services.autoStartup}
                        />
                        <DetailRow
                            icon={<Smartphone className="h-4 w-4" />}
                            label="Companion LAN"
                            value={
                                services.companionEnabled
                                    ? services.companionPersistentToken
                                        ? "Activé · QR fixe"
                                        : "Activé"
                                    : "Désactivé"
                            }
                            on={services.companionEnabled}
                        />
                        <DetailRow
                            icon={<BrushCleaning className="h-4 w-4" />}
                            label="Auto-clean caches"
                            value={services.autoCleanObsoleteCaches ? "Activé" : "Désactivé"}
                            on={services.autoCleanObsoleteCaches}
                        />
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                    <CardContent className="relative space-y-2 p-4">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Versions Star Citizen
                        </h3>
                        {hasVersions ? (
                            versionList.map((ver) => (
                                <DetailRow
                                    key={ver}
                                    icon={<Globe2 className="h-4 w-4" />}
                                    label={ver}
                                    value={
                                        installSummary.includes(ver)
                                            ? "Trad installée"
                                            : "Détectée"
                                    }
                                    on={installSummary.includes(ver)}
                                />
                            ))
                        ) : (
                            <p className="px-2 py-3 text-[12px] text-muted-foreground">
                                Aucune version SC détectée. Tu pourras installer les traductions plus tard.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

type TileAccent = "primary" | "emerald" | "muted";
const tileAccents: Record<TileAccent, string> = {
    primary: "border-border/40 bg-background/45 text-foreground",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    muted: "border-border/40 bg-background/45 text-muted-foreground",
};

function RecapTile({
    icon,
    label,
    value,
    accent = "primary",
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    accent?: TileAccent;
}) {
    return (
        <div className={`rounded-xl border px-3 py-2.5 ${tileAccents[accent]}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80">
                {icon}
                {label}
            </div>
            <p className="mt-1 truncate text-[13px] font-semibold" title={value}>
                {value}
            </p>
        </div>
    );
}

function DetailRow({
    icon,
    label,
    value,
    on,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    on: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-[hsl(var(--background)/0.26)] px-2.5 py-2">
            <div className="flex items-center gap-2 text-[13px]">
                <span className={on ? "text-primary" : "text-muted-foreground"}>{icon}</span>
                <span>{label}</span>
            </div>
            <span
                className={`text-[11px] font-semibold ${
                    on ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                }`}
            >
                {value}
            </span>
        </div>
    );
}
