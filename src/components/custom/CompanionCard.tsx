import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import {
    Copy,
    Check,
    Smartphone,
    Wifi,
    WifiOff,
    RefreshCw,
    Power,
    PowerOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type CompanionInfo = {
    url: string | null;
    ip: string | null;
    port: number;
    token: string;
    running: boolean;
    clients: number;
    persistentToken: boolean;
};

const COMPANION_ENABLED_KEY = "companionServerEnabled";
const DEFAULT_PORT = 47823;
const COMPANION_QR_OPTIONS = {
    margin: 1,
    width: 340,
    color: { dark: "#0f172a", light: "#ffffff" },
};

function setCompanionEnabledState(next: boolean) {
    localStorage.setItem(COMPANION_ENABLED_KEY, String(next));
    window.dispatchEvent(
        new CustomEvent("companion-enabled-changed", {
            detail: { enabled: next },
        })
    );
}

async function buildCompanionQrDataUrl(url: string | null) {
    if (!url) return null;
    try {
        return await QRCode.toDataURL(url, COMPANION_QR_OPTIONS);
    } catch {
        return null;
    }
}

export function CompanionCard() {
    const { toast } = useToast();
    const [enabled, setEnabled] = useState<boolean>(() => {
        const saved = localStorage.getItem(COMPANION_ENABLED_KEY);
        return saved === "true";
    });
    const [info, setInfo] = useState<CompanionInfo | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const ranInitRef = useRef(false);

    const applyCompanionInfo = useCallback(async (next: CompanionInfo) => {
        setInfo(next);
        setQrDataUrl(await buildCompanionQrDataUrl(next.url));
        if (next.running) {
            setEnabled(true);
            setCompanionEnabledState(true);
        } else {
            setEnabled(false);
        }
    }, []);

    const refresh = useCallback(async () => {
        try {
            const next = await invoke<CompanionInfo>("get_companion_info");
            await applyCompanionInfo(next);
        } catch (e) {
            console.error(e);
        }
    }, [applyCompanionInfo]);

    const start = useCallback(
        async (port: number = DEFAULT_PORT) => {
            setBusy(true);
            try {
                await invoke<CompanionInfo>("start_companion_server", { port });
                setEnabled(true);
                setCompanionEnabledState(true);
                await refresh();
                toast({
                    title: "Companion actif",
                    description: "Scanne le QR code depuis ton téléphone sur le même réseau.",
                });
            } catch (e) {
                toast({
                    title: "Impossible de démarrer",
                    description: `${e}`,
                    variant: "destructive",
                });
                setEnabled(false);
                setCompanionEnabledState(false);
            } finally {
                setBusy(false);
            }
        },
        [refresh, toast]
    );

    const stop = useCallback(async () => {
        setBusy(true);
        try {
            await invoke("stop_companion_server");
            setEnabled(false);
            setCompanionEnabledState(false);
            await refresh();
        } catch (e) {
            console.error(e);
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const toggleEnabled = useCallback(
        (next: boolean) => {
            setEnabled(next);
            setCompanionEnabledState(next);
            if (next) {
                start().catch(console.error);
            } else {
                stop().catch(console.error);
            }
        },
        [start, stop]
    );

    useEffect(() => {
        if (ranInitRef.current) return;
        ranInitRef.current = true;
        // Si le user avait activé avant redémarrage, on relance.
        const boot = async () => {
            try {
                const next = await invoke<CompanionInfo>("get_companion_info");
                await applyCompanionInfo(next);

                if (next.running) {
                    return;
                }

                if (localStorage.getItem(COMPANION_ENABLED_KEY) === "true") {
                    setEnabled(true);
                    await start();
                    return;
                }

                setEnabled(false);
            } catch (e) {
                console.error(e);
            }
        };

        boot().catch(console.error);
    }, [applyCompanionInfo, start]);

    useEffect(() => {
        let connectUn: UnlistenFn | null = null;
        let disconnectUn: UnlistenFn | null = null;
        (async () => {
            connectUn = await listen("companion:client_connected", () => refresh());
            disconnectUn = await listen("companion:client_disconnected", () => refresh());
        })().catch(console.error);
        return () => {
            connectUn?.();
            disconnectUn?.();
        };
    }, [refresh]);

    useEffect(() => {
        const syncFromStorage = () => {
            setEnabled(localStorage.getItem(COMPANION_ENABLED_KEY) === "true");
            refresh().catch(console.error);
        };

        const syncOnFocus = () => {
            refresh().catch(console.error);
        };

        window.addEventListener("storage", syncFromStorage);
        window.addEventListener("companion-enabled-changed", syncFromStorage);
        window.addEventListener("focus", syncOnFocus);
        document.addEventListener("visibilitychange", syncOnFocus);
        return () => {
            window.removeEventListener("storage", syncFromStorage);
            window.removeEventListener("companion-enabled-changed", syncFromStorage);
            window.removeEventListener("focus", syncOnFocus);
            document.removeEventListener("visibilitychange", syncOnFocus);
        };
    }, [refresh]);

    const copyUrl = useCallback(async () => {
        if (!info?.url) return;
        try {
            await navigator.clipboard.writeText(info.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* ignore */
        }
    }, [info?.url]);

    const togglePersistentToken = useCallback(async (next: boolean) => {
        setTokenBusy(true);
        try {
            const updated = await invoke<CompanionInfo>("set_companion_persistent_token", { enabled: next });
            await applyCompanionInfo(updated);

            toast({
                title: next ? "QR code conserve" : "QR code renouvele",
                description: next
                    ? "Le meme lien restera valide entre les redemarrages."
                    : "Un nouveau lien sera genere pour les prochains demarrages.",
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
    }, [applyCompanionInfo, toast]);

    const running = Boolean(info?.running);
    const clients = info?.clients ?? 0;
    const statusColor = running
        ? clients > 0
            ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.65)]"
            : "bg-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.6)]"
        : "bg-slate-500";

    return (
        <div className="rounded-2xl bg-slate-950/40 ring-1 ring-white/5 backdrop-blur-md p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-1 h-9 w-9 flex-none rounded-xl bg-sky-500/15 ring-1 ring-sky-400/30 flex items-center justify-center text-sky-300">
                        <Smartphone className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold tracking-[0.02em] text-slate-100">
                            Companion LAN
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                            Contrôle l'app depuis ton téléphone ou ta tablette sur le même réseau Wi-Fi.
                            Aucune donnée ne quitte le LAN.
                        </p>
                    </div>
                </div>
                <Switch checked={enabled} onCheckedChange={toggleEnabled} disabled={busy} />
            </div>

            <div className="flex items-center gap-2 text-[11px]">
                <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                <span className="text-slate-300">
                    {running ? (
                        <>
                            Serveur actif sur le port{" "}
                            <span className="text-slate-100 font-medium">{info?.port}</span>
                            {" · "}
                            <span className="text-slate-100 font-medium">
                                {clients} client{clients > 1 ? "s" : ""}
                            </span>{" "}
                            connecté{clients > 1 ? "s" : ""}
                        </>
                    ) : enabled ? (
                        "Démarrage..."
                    ) : (
                        "Serveur arrêté"
                    )}
                </span>
                {running && (
                    <button
                        onClick={refresh}
                        className="ml-auto text-slate-500 hover:text-slate-300"
                        title="Rafraîchir"
                    >
                        <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                )}
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-900/38 ring-1 ring-white/5 px-3 py-3">
                <div className="min-w-0">
                    <div className="text-[12px] font-medium text-slate-100">Garder ce QR code</div>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                        Garde le meme lien Companion entre les redemarrages pour eviter de rescanner.
                    </p>
                </div>
                <Switch
                    checked={Boolean(info?.persistentToken)}
                    onCheckedChange={togglePersistentToken}
                    disabled={tokenBusy}
                />
            </div>

            {running && info?.url && (
                <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                    <div className="flex-none rounded-xl bg-white p-2 self-center">
                        {qrDataUrl ? (
                            <img
                                src={qrDataUrl}
                                alt="QR code companion"
                                width={160}
                                height={160}
                                className="block rounded-md"
                            />
                        ) : (
                            <div className="h-40 w-40 flex items-center justify-center text-[10px] text-slate-500">
                                QR...
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            Adresse du companion
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 ring-1 ring-white/5 px-3 py-2 min-w-0">
                            <Wifi className="h-3.5 w-3.5 text-sky-400 flex-none" strokeWidth={1.5} />
                            <code className="text-[11px] font-mono text-slate-200 truncate">
                                {info.url}
                            </code>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-7 px-2"
                                onClick={copyUrl}
                            >
                                {copied ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                                ) : (
                                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                                )}
                            </Button>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                            Scanne le QR avec l'appareil photo de ton téléphone. Les overlays et la
                            traduction se mettent à jour en direct. Si tu ne vois pas le téléphone se
                            connecter, vérifie que ton PC autorise le port {info.port} (pare-feu
                            Windows).
                        </p>
                    </div>
                </div>
            )}

            {!running && !enabled && (
                <div className="rounded-lg bg-slate-900/40 ring-1 ring-white/5 px-3 py-3 text-[11px] text-slate-400 flex items-center gap-2">
                    <WifiOff className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
                    Active le switch pour démarrer le serveur et afficher le QR.
                </div>
            )}

            {running && (
                <div className="flex justify-end">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-3 text-[11px]"
                        onClick={() => toggleEnabled(false)}
                        disabled={busy}
                    >
                        <PowerOff className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                        Arrêter
                    </Button>
                </div>
            )}
            {enabled && !running && !busy && (
                <div className="flex justify-end">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-3 text-[11px]"
                        onClick={() => start()}
                    >
                        <Power className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                        Redémarrer
                    </Button>
                </div>
            )}
        </div>
    );
}
