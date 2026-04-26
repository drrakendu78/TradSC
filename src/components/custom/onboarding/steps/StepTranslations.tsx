// Step 3 — Choix d'une source + bouton « Installer » par version, avec
// la même DA que la page Traduction principale : Card glassmorphism, radial
// primary overlay, badges status arrondis. Auto-detect du vrai état via
// `is_game_translated` (le cache de get_star_citizen_versions peut être
// périmé). Quand l'utilisateur change la source d'une trad installée, on
// affiche un appel à l'action explicite « Appliquer ».

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    AlertCircle,
    ArrowRight,
    CheckCircle,
    FolderOpen,
    Globe2,
    Languages,
    Loader2,
    RefreshCw,
    XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Link as TranslationLink } from "@/types/translation";
import type { VersionInfo, VersionSelection } from "../types";

interface StepTranslationsProps {
    versions: Record<string, VersionInfo>;
    links: TranslationLink[];
    perVersion: Record<string, VersionSelection>;
    onSelectLink: (version: string, url: string) => void;
}

type RealState = "checking" | "installed" | "not_installed";

export function StepTranslations({
    versions,
    links,
    perVersion,
    onSelectLink,
}: StepTranslationsProps) {
    const { toast } = useToast();
    const list = Object.keys(versions).sort();
    const [realState, setRealState] = useState<Record<string, RealState>>({});
    const [installing, setInstalling] = useState<Record<string, boolean>>({});
    const appliedLinkRef = useRef<Record<string, string | null>>({});

    useEffect(() => {
        let cancelled = false;
        const checkAll = async () => {
            const next: Record<string, RealState> = {};
            list.forEach((v) => { next[v] = "checking"; });
            setRealState(next);

            await Promise.all(
                list.map(async (ver) => {
                    const info = versions[ver];
                    if (!info) return;
                    try {
                        const translated = await invoke<boolean>("is_game_translated", {
                            path: info.path,
                            lang: "fr",
                        });
                        if (cancelled) return;
                        setRealState((cur) => ({
                            ...cur,
                            [ver]: translated ? "installed" : "not_installed",
                        }));
                        if (translated) {
                            appliedLinkRef.current[ver] = perVersion[ver]?.selectedLink ?? null;
                        }
                    } catch {
                        if (cancelled) return;
                        setRealState((cur) => ({
                            ...cur,
                            [ver]: info.translated ? "installed" : "not_installed",
                        }));
                    }
                })
            );
        };
        void checkAll();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.join("|")]);

    const runAction = async (
        ver: string,
        cmd: "init_translation_files" | "update_translation",
        link: string,
        successTitle: string,
        successDesc: string
    ) => {
        const info = versions[ver];
        if (!info) return;
        setInstalling((m) => ({ ...m, [ver]: true }));
        try {
            await invoke(cmd, {
                path: info.path,
                translationLink: link,
                lang: "fr",
                gameVersion: ver,
            });
            await invoke("save_translations_selected", {
                data: { [ver]: { link, settingsEN: false } },
            }).catch(() => {});
            appliedLinkRef.current[ver] = link;
            setRealState((cur) => ({ ...cur, [ver]: "installed" }));
            toast({
                title: successTitle,
                description: successDesc,
                variant: "success",
                duration: 2500,
            });
        } catch (e) {
            toast({
                title: `Erreur ${ver}`,
                description: String(e),
                variant: "destructive",
                duration: 4000,
            });
        } finally {
            setInstalling((m) => {
                const n = { ...m };
                delete n[ver];
                return n;
            });
        }
    };

    const handleInstall = (ver: string) => {
        const link = perVersion[ver]?.selectedLink;
        if (!link) return;
        void runAction(ver, "init_translation_files", link, "Traduction installée", `${ver} : trad FR appliquée.`);
    };

    const handleUpdate = (ver: string) => {
        const link = perVersion[ver]?.selectedLink;
        if (!link) return;
        void runAction(ver, "update_translation", link, "Source mise à jour", `${ver} : nouvelle source appliquée.`);
    };

    return (
        <div className="space-y-5">
            {/* Hero glass */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%)]" />
                <div className="relative flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                        <Languages className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="font-exo text-2xl font-semibold tracking-tight">
                            Choix des traductions
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Choisis une source et installe la traduction. Tu pourras tout modifier plus tard depuis la page Traduction.
                        </p>
                    </div>
                </div>
            </section>

            {list.length === 0 ? (
                <Card className="relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] backdrop-blur-md">
                    <CardContent className="p-6 text-center text-sm text-muted-foreground">
                        Aucune version SC détectée — passe à l'étape suivante.
                    </CardContent>
                </Card>
            ) : links.length === 0 ? (
                <Card className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-[hsl(var(--background)/0.14)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,rgba(245,158,11,0.12),transparent_58%)] opacity-50" />
                    <CardContent className="relative p-6 text-center text-sm text-amber-700/95 dark:text-amber-300/95">
                        Aucune source de traduction disponible (API hors-ligne ?). Réessaie depuis la page Traduction plus tard.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3">
                    {list.map((ver) => {
                        const sel = perVersion[ver] ?? { selectedLink: null, installNow: false };
                        const state = realState[ver] ?? "checking";
                        const isBusy = !!installing[ver];
                        const applied = appliedLinkRef.current[ver] ?? null;
                        const pendingChange =
                            state === "installed" && !!sel.selectedLink && sel.selectedLink !== applied;

                        const info = versions[ver];

                        return (
                            <Card
                                key={ver}
                                className={`group relative overflow-hidden rounded-2xl border bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all duration-200 ${
                                    pendingChange
                                        ? "border-primary/55 shadow-[0_0_0_1px_hsl(var(--primary)/0.30),0_10px_24px_hsl(var(--primary)/0.16)]"
                                        : "border-border/35 hover:border-primary/25 hover:bg-[hsl(var(--background)/0.18)]"
                                }`}
                            >
                                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                                <CardHeader className="relative space-y-2 pb-1.5 pt-3.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
                                            <Globe2 className="h-5 w-5 text-primary" />
                                            {ver}
                                        </CardTitle>
                                        <StatusBadge state={state} busy={isBusy} pendingChange={pendingChange} />
                                    </div>
                                    {info?.path && (
                                        <p
                                            className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground/90"
                                            title={info.path}
                                        >
                                            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                                            {info.path}
                                        </p>
                                    )}
                                </CardHeader>

                                <CardContent className="relative space-y-3 border-t border-border/30 pt-3">
                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-2 text-[13px] font-medium">
                                            <Languages className="h-4 w-4 text-primary/90" />
                                            Source de traduction
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="min-w-[240px] flex-1">
                                                <Select
                                                    value={sel.selectedLink ?? ""}
                                                    onValueChange={(v) => onSelectLink(ver, v)}
                                                    disabled={isBusy}
                                                >
                                                    <SelectTrigger className="h-10 w-full rounded-lg border-border/60 bg-background/40">
                                                        <SelectValue placeholder="Choisir une traduction" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {links.map((l) => (
                                                            <SelectItem key={l.id} value={l.url}>
                                                                {l.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <ActionButton
                                                state={state}
                                                busy={isBusy}
                                                canAct={!!sel.selectedLink}
                                                pendingChange={pendingChange}
                                                onInstall={() => handleInstall(ver)}
                                                onApplyNew={() => handleUpdate(ver)}
                                                onReinstall={() => handleUpdate(ver)}
                                            />
                                        </div>
                                    </div>

                                    {pendingChange && !isBusy && (
                                        <div className="flex items-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 text-[13px] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                            <ArrowRight className="h-4 w-4 flex-shrink-0" />
                                            <span>
                                                <strong className="font-semibold">Nouvelle source choisie.</strong>
                                                <span className="ml-1 text-primary/80">
                                                    Clique « Appliquer » pour l'installer.
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function StatusBadge({
    state,
    busy,
    pendingChange,
}: {
    state: RealState;
    busy: boolean;
    pendingChange: boolean;
}) {
    if (busy) {
        return (
            <Badge
                variant="default"
                className="h-6 gap-1 rounded-md border border-blue-500/30 bg-blue-500/20 text-[11px] text-blue-600 dark:text-blue-400"
            >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                En cours
            </Badge>
        );
    }
    if (state === "checking") {
        return (
            <Badge
                variant="outline"
                className="h-6 gap-1 rounded-md border-border/60 bg-background/30 text-[11px]"
            >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Vérification
            </Badge>
        );
    }
    if (state === "installed") {
        if (pendingChange) {
            return (
                <Badge
                    variant="default"
                    className="h-6 gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/20 text-[11px] text-yellow-600 dark:text-yellow-400"
                >
                    <AlertCircle className="h-3.5 w-3.5" />
                    Source modifiée
                </Badge>
            );
        }
        return (
            <Badge
                variant="default"
                className="h-6 gap-1 rounded-md border border-green-500/30 bg-green-500/20 text-[11px] text-green-600 dark:text-green-400"
            >
                <CheckCircle className="h-3.5 w-3.5" />
                Installée
            </Badge>
        );
    }
    return (
        <Badge
            variant="outline"
            className="h-6 gap-1 rounded-md border-border/60 bg-background/30 text-[11px]"
        >
            <XCircle className="h-3.5 w-3.5" />
            Non installée
        </Badge>
    );
}

function ActionButton({
    state,
    busy,
    canAct,
    pendingChange,
    onInstall,
    onApplyNew,
    onReinstall,
}: {
    state: RealState;
    busy: boolean;
    canAct: boolean;
    pendingChange: boolean;
    onInstall: () => void;
    onApplyNew: () => void;
    onReinstall: () => void;
}) {
    if (state === "checking") {
        return (
            <Button disabled variant="outline" size="sm" className="min-w-[140px]">
                ...
            </Button>
        );
    }
    if (state === "installed") {
        if (pendingChange) {
            return (
                <Button
                    onClick={onApplyNew}
                    disabled={busy || !canAct}
                    className="h-10 min-w-[140px] gap-1.5 rounded-lg font-semibold"
                >
                    {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <ArrowRight className="h-3.5 w-3.5" />
                    )}
                    Appliquer
                </Button>
            );
        }
        return (
            <Button
                onClick={onReinstall}
                disabled={busy || !canAct}
                variant="outline"
                className="h-10 min-w-[140px] gap-1.5 rounded-lg border-border/60 bg-background/40"
            >
                <RefreshCw className="h-3.5 w-3.5" />
                Réinstaller
            </Button>
        );
    }
    return (
        <Button
            onClick={onInstall}
            disabled={busy || !canAct}
            className="h-10 min-w-[140px] gap-1.5 rounded-lg font-semibold"
        >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Installer
        </Button>
    );
}
