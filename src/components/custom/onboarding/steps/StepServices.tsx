// Step 4 — Services optionnels avec la même DA que SettingsContent.
//
// IMPORTANT : toutes les interactions sont LIVE (pas différées à "Suivant"),
// pour matcher le comportement de la page Paramètres :
//   - Toggle background → save_background_service_config + set + start/stop
//   - Slider intervalle → save + set + stop/sleep/start si actif (sinon le
//     service garde son ancienne valeur en mémoire, c'est le bug que tu as vu)
//   - Toggle Discord → connect/disconnect immédiat
//   - Toggle autostart → enable/disable immédiat
//   - Companion : déjà live + QR aperçu inline
//
// Le parent (`OnboardingWizard.applyServicesConfig`) est devenu un no-op
// pour ces services : tout est appliqué au moment du clic.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import {
    Bell,
    Check,
    Copy,
    Disc3,
    KeyRound,
    Loader2,
    Power,
    Smartphone,
    Sparkles,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ServicesConfig } from "../types";

interface StepServicesProps {
    services: ServicesConfig;
    onChange: (next: ServicesConfig) => void;
}

export function StepServices({ services, onChange }: StepServicesProps) {
    const { toast } = useToast();

    // ─── Background service : toggle + intervalle, live ─────────────────
    const applyBackgroundConfig = useCallback(
        async (next: ServicesConfig, restartIfRunning: boolean) => {
            const cfg = {
                enabled: next.backgroundEnabled,
                check_interval_minutes: next.backgroundIntervalMin,
                language: "fr",
            };
            try {
                await Promise.all([
                    invoke("save_background_service_config", { config: cfg }),
                    invoke("set_background_service_config", { config: cfg }).catch(() => {}),
                ]);
                if (next.backgroundEnabled) {
                    if (restartIfRunning) {
                        // Stop puis start pour piquer le nouvel intervalle.
                        await invoke("stop_background_service").catch(() => {});
                        await new Promise((r) => setTimeout(r, 120));
                    }
                    await invoke("start_background_service").catch(() => {});
                } else {
                    await invoke("stop_background_service").catch(() => {});
                }
            } catch (e) {
                console.error("[Onboarding] background service", e);
            }
        },
        []
    );

    const handleBackgroundToggle = (on: boolean) => {
        const next = { ...services, backgroundEnabled: on };
        onChange(next);
        void applyBackgroundConfig(next, false);
    };

    // Slider : on debounce légèrement (220 ms) pour ne pas spammer le
    // restart pendant le drag.
    const debounceRef = useRef<number | null>(null);
    const handleIntervalChange = (val: number) => {
        const v = Math.max(1, Math.min(30, val));
        const next = { ...services, backgroundIntervalMin: v };
        onChange(next);
        if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current);
        }
        debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null;
            // restartIfRunning=true car l'intervalle ne s'applique qu'au
            // restart (la boucle Rust capture la valeur initiale de la config).
            void applyBackgroundConfig(next, true);
        }, 220);
    };

    // ─── Discord RPC : live connect/disconnect ──────────────────────────
    const handleDiscordToggle = async (on: boolean) => {
        const next = { ...services, discordEnabled: on };
        onChange(next);
        try {
            if (on) {
                await invoke("check_and_reconnect_discord");
            } else {
                await invoke("disconnect_discord").catch(() => {});
            }
            // Aligne le flag legacy localStorage utilisé par SettingsContent.
            try {
                localStorage.setItem("discordRPCEnabled", String(on));
            } catch {
                /* ignore */
            }
        } catch (e) {
            toast({
                title: "Discord : erreur",
                description: `${e}`,
                variant: "destructive",
            });
        }
    };

    // ─── Auto-startup : live enable/disable ─────────────────────────────
    const handleAutoStartupToggle = async (on: boolean) => {
        const next = { ...services, autoStartup: on };
        onChange(next);
        try {
            if (on) {
                await invoke("enable_auto_startup");
            } else {
                await invoke("disable_auto_startup");
            }
        } catch (e) {
            toast({
                title: "Démarrage Windows : erreur",
                description: `${e}`,
                variant: "destructive",
            });
            // Rollback visuel.
            onChange({ ...services, autoStartup: !on });
        }
    };

    return (
        <div className="space-y-5">
            {/* Hero glass */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%)]" />
                <div className="relative flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                        <Sparkles className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="font-exo text-2xl font-semibold tracking-tight">
                            Services optionnels
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Tout est désactivé par défaut. Active uniquement ce qui te sert.
                        </p>
                    </div>
                </div>
            </section>

            {/* Settings panel : même look que les onglets de Paramètres */}
            <div className="space-y-3 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.34)] p-4 shadow-[0_14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-5">
                <ServiceRow
                    icon={<Bell className="h-5 w-5" />}
                    accent="primary"
                    title="Vérification automatique"
                    desc="L'app vérifie périodiquement si une nouvelle traduction est dispo et applique les mises à jour."
                    checked={services.backgroundEnabled}
                    onCheckedChange={handleBackgroundToggle}
                    extra={
                        services.backgroundEnabled && (
                            <div className="mt-3 rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Toutes les
                                    </span>
                                    <Slider
                                        value={[services.backgroundIntervalMin]}
                                        onValueChange={(v) => handleIntervalChange(v[0] ?? 5)}
                                        min={1}
                                        max={30}
                                        step={1}
                                        className="flex-1"
                                    />
                                    <span className="w-16 rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-right font-mono text-[12px] font-semibold">
                                        {services.backgroundIntervalMin} min
                                    </span>
                                </div>
                            </div>
                        )
                    }
                />
                <ServiceRow
                    icon={<Disc3 className="h-5 w-5" />}
                    accent="indigo"
                    title="Discord Rich Presence"
                    desc="Affiche StarTrad FR + ta version SC dans ton statut Discord."
                    checked={services.discordEnabled}
                    onCheckedChange={(on) => void handleDiscordToggle(on)}
                />
                <ServiceRow
                    icon={<Power className="h-5 w-5" />}
                    accent="emerald"
                    title="Démarrer avec Windows"
                    desc="L'app se lance automatiquement à l'ouverture de session."
                    checked={services.autoStartup}
                    onCheckedChange={(on) => void handleAutoStartupToggle(on)}
                />
                <CompanionRow services={services} onChange={onChange} />
            </div>
        </div>
    );
}

type Accent = "primary" | "indigo" | "emerald" | "sky";

const accentClasses: Record<Accent, { iconBox: string; iconColor: string }> = {
    primary: {
        iconBox: "border-primary/30 bg-primary/10",
        iconColor: "text-primary",
    },
    indigo: {
        iconBox: "border-indigo-500/30 bg-indigo-500/10",
        iconColor: "text-indigo-500",
    },
    emerald: {
        iconBox: "border-emerald-500/30 bg-emerald-500/10",
        iconColor: "text-emerald-500",
    },
    sky: {
        iconBox: "border-sky-500/30 bg-sky-500/10",
        iconColor: "text-sky-500",
    },
};

interface ServiceRowProps {
    icon: React.ReactNode;
    accent: Accent;
    title: string;
    desc: string;
    checked: boolean;
    onCheckedChange: (on: boolean) => void;
    extra?: React.ReactNode;
}

function ServiceRow({ icon, accent, title, desc, checked, onCheckedChange, extra }: ServiceRowProps) {
    const styles = accentClasses[accent];
    return (
        <div className="rounded-xl border border-border/40 bg-[hsl(var(--background)/0.26)] px-3 py-3">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${styles.iconBox} ${styles.iconColor}`}
                    >
                        {icon}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">{desc}</p>
                    </div>
                </div>
                <Switch checked={checked} onCheckedChange={onCheckedChange} />
            </div>
            {extra}
        </div>
    );
}

// ─── Companion LAN : action live + QR aperçu ──────────────────────────

type CompanionInfo = {
    url: string | null;
    ip: string | null;
    port: number;
    token: string;
    running: boolean;
    clients: number;
    persistentToken: boolean;
};

const QR_OPTIONS = {
    margin: 1,
    width: 280,
    color: { dark: "#0f172a", light: "#ffffff" },
};

function CompanionRow({
    services,
    onChange,
}: {
    services: ServicesConfig;
    onChange: (next: ServicesConfig) => void;
}) {
    const { toast } = useToast();
    const styles = accentClasses.sky;
    const [info, setInfo] = useState<CompanionInfo | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const refreshInfo = useCallback(async () => {
        try {
            const next = await invoke<CompanionInfo>("get_companion_info");
            setInfo(next);
            if (next.url) {
                try {
                    setQrDataUrl(await QRCode.toDataURL(next.url, QR_OPTIONS));
                } catch {
                    setQrDataUrl(null);
                }
            } else {
                setQrDataUrl(null);
            }
        } catch {
            /* ignore */
        }
    }, []);

    // Au montage, si le toggle est déjà coché (service redémarrant déjà
    // depuis le préload du parent), on hydrate l'info et le QR.
    useEffect(() => {
        if (services.companionEnabled) {
            void refreshInfo();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleEnabled = async (next: boolean) => {
        setBusy(true);
        try {
            if (next) {
                await invoke<CompanionInfo>("start_companion_server", { port: 47823 });
                localStorage.setItem("companionServerEnabled", "true");
                window.dispatchEvent(
                    new CustomEvent("companion-enabled-changed", {
                        detail: { enabled: true },
                    })
                );
                onChange({ ...services, companionEnabled: true });
                await refreshInfo();
            } else {
                await invoke("stop_companion_server").catch(() => {});
                localStorage.setItem("companionServerEnabled", "false");
                window.dispatchEvent(
                    new CustomEvent("companion-enabled-changed", {
                        detail: { enabled: false },
                    })
                );
                onChange({ ...services, companionEnabled: false });
                setInfo(null);
                setQrDataUrl(null);
            }
        } catch (e) {
            toast({
                title: "Companion : échec",
                description: `${e}`,
                variant: "destructive",
            });
            // Rollback du toggle si erreur.
            onChange({ ...services, companionEnabled: !next });
        } finally {
            setBusy(false);
        }
    };

    const togglePersistentToken = async (next: boolean) => {
        setTokenBusy(true);
        try {
            const updated = await invoke<CompanionInfo>(
                "set_companion_persistent_token",
                { enabled: next }
            );
            setInfo(updated);
            if (updated.url) {
                try {
                    setQrDataUrl(await QRCode.toDataURL(updated.url, QR_OPTIONS));
                } catch {
                    /* keep previous */
                }
            }
            onChange({ ...services, companionPersistentToken: next });
            toast({
                title: next ? "QR code conservé" : "QR code renouvelé",
                description: next
                    ? "Le même lien restera valide entre les redémarrages."
                    : "Un nouveau lien sera généré aux prochains démarrages.",
            });
        } catch (e) {
            toast({
                title: "Impossible de changer le token",
                description: `${e}`,
                variant: "destructive",
            });
        } finally {
            setTokenBusy(false);
        }
    };

    const copyUrl = async () => {
        if (!info?.url) return;
        try {
            await navigator.clipboard.writeText(info.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* ignore */
        }
    };

    const running = !!info?.running;

    return (
        <div className="rounded-xl border border-border/40 bg-[hsl(var(--background)/0.26)] px-3 py-3">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${styles.iconBox} ${styles.iconColor}`}
                    >
                        <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold tracking-tight">
                            Companion LAN
                        </h3>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                            Pilote l'app depuis ton téléphone / tablette sur le même Wi-Fi (overlays, traduction, infos serveurs).
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Switch
                        checked={services.companionEnabled}
                        onCheckedChange={(on) => void toggleEnabled(on)}
                        disabled={busy}
                    />
                </div>
            </div>

            {services.companionEnabled && (
                <div className="mt-3 space-y-3">
                    {/* QR + URL + copy */}
                    <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        {!running || !info?.url ? (
                            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Démarrage du serveur…
                            </div>
                        ) : (
                            <div className="flex items-start gap-3">
                                {qrDataUrl ? (
                                    <img
                                        src={qrDataUrl}
                                        alt="QR Companion"
                                        className="h-[120px] w-[120px] flex-shrink-0 rounded-lg border border-border/60 bg-white p-1.5"
                                    />
                                ) : (
                                    <div className="h-[120px] w-[120px] flex-shrink-0 rounded-lg border border-border/60 bg-background/40" />
                                )}
                                <div className="min-w-0 flex-1 space-y-2">
                                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Scanne le QR avec ton tel
                                    </p>
                                    <p
                                        className="break-all rounded-lg border border-border/40 bg-background/30 px-2 py-1.5 font-mono text-[11px] text-foreground/85"
                                        title={info.url}
                                    >
                                        {info.url}
                                    </p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={copyUrl}
                                        className="h-8 gap-1.5 rounded-lg border-border/60 bg-background/40 text-[12px]"
                                    >
                                        {copied ? (
                                            <>
                                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                                Copié
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-3.5 w-3.5" />
                                                Copier l'URL
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sub-toggle persistent token */}
                    <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 min-w-0">
                                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500">
                                    <KeyRound className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-[13px] font-semibold tracking-tight">
                                        Garder le QR code actuel
                                    </h4>
                                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                                        Le même lien restera valide entre les redémarrages. Pratique si tu as déjà scanné le QR sur ton tel.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {tokenBusy && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                <Switch
                                    checked={services.companionPersistentToken}
                                    onCheckedChange={(on) => void togglePersistentToken(on)}
                                    disabled={tokenBusy || !running}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
