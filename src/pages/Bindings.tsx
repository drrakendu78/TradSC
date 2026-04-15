import { m } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useCallback, useMemo } from "react";
import { columns } from "@/components/custom/bindings/columns";
import { DataTable } from "@/components/custom/bindings/data-table";
import { Plus, Folder, Keyboard, Loader2, RefreshCw, Globe2, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GamePaths, isGamePaths } from "@/types/translation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface BindingFile {
    name: string;
    path: string;
}

export default function Bindings() {
    const { toast } = useToast();
    const [bindings, setBindings] = useState<BindingFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [gameCheckDone, setGameCheckDone] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState<string>("");
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importTargetVersion, setImportTargetVersion] = useState("");

    const versions = useMemo(
        () => (gamePaths ? Object.keys(gamePaths.versions).sort() : []),
        [gamePaths],
    );

    const loadGameVersions = useCallback(async () => {
        try {
            const versions = await invoke("get_star_citizen_versions");
            if (isGamePaths(versions)) {
                setGamePaths(versions);

                let defaultVersion = "";
                if (versions.versions["LIVE"]) {
                    defaultVersion = "LIVE";
                } else {
                    defaultVersion = Object.keys(versions.versions)[0] || "";
                }

                if (defaultVersion) {
                    setSelectedVersion(defaultVersion);
                    setIsLoading(true);
                    try {
                        const files = await invoke<BindingFile[]>("list_bindings_files", { version: defaultVersion });
                        setBindings(files);
                    } catch {
                        // silent
                    } finally {
                        setIsLoading(false);
                    }
                }
            }
        } catch (error) {
            console.error("Erreur lors du chargement des versions:", error);
        } finally {
            setGameCheckDone(true);
        }
    }, []);

    const loadBindings = useCallback(async (version?: string) => {
        const v = version ?? selectedVersion;
        if (!v) return;

        setIsLoading(true);
        try {
            const files = await invoke<BindingFile[]>("list_bindings_files", { version: v });
            setBindings(files);
        } catch {
            toast({
                title: "Erreur",
                description: "Impossible de charger la liste des bindings",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [selectedVersion, toast]);

    const handleImportBindings = async (versionOverride?: string) => {
        const targetVersion = versionOverride ?? importTargetVersion ?? selectedVersion;
        if (!targetVersion) {
            toast({
                title: "Erreur",
                description: "Aucune version selectionnee pour l'import",
                variant: "destructive",
            });
            return;
        }

        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: "Bindings", extensions: ["xml"] }],
            });

            if (!selected) return;

            let filePath: string;
            if (Array.isArray(selected)) {
                filePath = selected[0];
            } else if (typeof selected === "string") {
                filePath = selected;
            } else {
                return;
            }

            await invoke("import_bindings_file", { sourcePath: filePath, version: targetVersion });

            toast({
                title: "Succes",
                description: `Bindings importes pour ${targetVersion}`,
                variant: "default",
            });

            setSelectedVersion(targetVersion);
            loadBindings(targetVersion);
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    const handleRefreshBindings = async () => {
        try {
            await invoke("refresh_bindings");
            toast({
                title: "Succes",
                description: "Les bindings ont ete rafraichis avec succes",
                variant: "default",
            });
            loadBindings();
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    const handleOpenFolder = async () => {
        try {
            await invoke("open_bindings_folder", { version: selectedVersion });
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    useEffect(() => {
        loadGameVersions();
    }, [loadGameVersions]);

    useEffect(() => {
        if (versions.length === 0) {
            setImportTargetVersion("");
            return;
        }

        setImportTargetVersion((prev) => {
            if (prev && versions.includes(prev)) return prev;
            if (selectedVersion && versions.includes(selectedVersion)) return selectedVersion;
            const live = versions.find((version) => version.toUpperCase() === "LIVE");
            return live ?? versions[0];
        });
    }, [versions, selectedVersion]);

    if (!gameCheckDone) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                <div className="rounded-full bg-muted p-4 animate-pulse">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Recherche des installations de Star Citizen...</p>
            </div>
        );
    }

    if (!gamePaths) {
        return (
            <div className="flex h-full w-full items-center justify-center p-4">
                <section className="w-full max-w-xl rounded-2xl border border-border/60 bg-[hsl(var(--background)/0.28)] p-7 text-center shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border/55 bg-background/45">
                        <Globe2 className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-1.5">
                        <h2 className="text-xl font-bold tracking-tight">Aucune version detectee</h2>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                            <kbd className="mx-2 rounded border border-border/55 bg-background/60 px-2 py-1 text-xs">CTRL + R</kbd>
                        </p>
                    </div>
                </section>
            </div>
        );
    }

    const bindingCount = bindings.length;

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10">
                                <Keyboard className="h-4 w-4 text-blue-500" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Bindings</h1>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        {bindingCount} fichier{bindingCount > 1 ? "s" : ""}
                                    </Badge>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        Version: {selectedVersion || "-"}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Gerez vos configurations de controles</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-blue-500/25 via-border/40 to-transparent" />
                </section>

                <section className="relative overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,hsl(var(--primary)/0.10),transparent_62%)]" />
                    <div className="relative grid grid-cols-1 gap-3 p-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
                        <div className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-border/55 bg-[hsl(var(--background)/0.24)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setImportModalOpen(true)}
                                className="h-8 gap-2 rounded-lg border border-primary/45 bg-[linear-gradient(140deg,hsl(var(--primary)/0.22),hsl(var(--primary)/0.12))] px-3.5 text-xs font-semibold text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.18)] transition-all hover:border-primary/60 hover:bg-[linear-gradient(140deg,hsl(var(--primary)/0.30),hsl(var(--primary)/0.16))]"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Importer
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleOpenFolder}
                                className="h-8 gap-2 rounded-lg border border-border/50 bg-background/25 px-3 text-xs font-medium text-foreground/90 transition-all hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground"
                            >
                                <Folder className="h-3.5 w-3.5" />
                                Dossier
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRefreshBindings}
                                className="h-8 w-8 rounded-lg border border-border/50 bg-background/22 p-0 text-foreground/85 transition-all hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.10)] hover:text-foreground"
                                title="Rafraichir"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                        </div>

                        <p className="text-[11px] text-muted-foreground lg:justify-self-end">
                            Importez des fichiers XML de controles et gerez-les par version de jeu.
                        </p>
                    </div>
                </section>

                <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_100%,hsl(var(--primary)/0.08),transparent_64%)]" />
                    <div className="relative border-b border-border/35 px-3 py-2 text-[11px] text-muted-foreground">
                        Les fichiers sont supprimes localement du dossier Bindings de la version selectionnee.
                    </div>

                    <div className="relative p-2.5">
                        {isLoading ? (
                            <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)]">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Chargement des bindings...</p>
                            </div>
                        ) : (
                            <DataTable columns={columns(toast, loadBindings)} data={bindings} />
                        )}
                    </div>
                </section>
            </div>

            <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
                <DialogContent className="max-w-[560px] overflow-hidden border-primary/35 p-0">
                    <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.16))] px-5 py-4">
                        <DialogHeader className="relative space-y-2 pr-10 text-left">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-primary/45 bg-primary/12 text-primary">
                                    <Plus className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <DialogTitle className="text-xl font-semibold tracking-tight">
                                        Importer un binding
                                    </DialogTitle>
                                    <DialogDescription className="text-sm text-muted-foreground/92">
                                        Choisissez la version cible avant de selectionner votre fichier XML.
                                    </DialogDescription>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="rounded-full border border-border/50 bg-background/25 px-2 py-0.5 text-muted-foreground/90">
                                    {versions.length} version{versions.length > 1 ? "s" : ""} disponible{versions.length > 1 ? "s" : ""}
                                </span>
                                <span className="rounded-full border border-primary/45 bg-primary/12 px-2 py-0.5 font-semibold uppercase tracking-[0.06em] text-primary">
                                    Import
                                </span>
                            </div>
                        </DialogHeader>
                    </div>

                    <div className="space-y-2 px-5 py-4">
                        {versions.length > 0 ? (
                            versions.map((version) => {
                                const isSelected = importTargetVersion === version;

                                return (
                                    <button
                                        key={version}
                                        type="button"
                                        onClick={() => setImportTargetVersion(version)}
                                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                            isSelected
                                                ? "border-primary/45 bg-[hsl(var(--primary)/0.12)] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]"
                                                : "border-border/45 bg-[hsl(var(--background)/0.22)] hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.08)]"
                                        }`}
                                    >
                                        <span className="font-medium text-foreground/95">{version}</span>
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                                                isSelected
                                                    ? "border-primary/45 bg-primary/12 text-primary"
                                                    : "border-border/45 bg-background/30 text-muted-foreground"
                                            }`}
                                        >
                                            {isSelected && <Check className="h-3 w-3" />}
                                            {isSelected ? "Selectionnee" : "Choisir"}
                                        </span>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="rounded-xl border border-border/40 bg-[hsl(var(--background)/0.2)] px-3 py-3 text-sm text-muted-foreground">
                                Aucune version installee detectee.
                            </div>
                        )}
                    </div>

                    <DialogFooter className="border-t border-border/45 bg-[hsl(var(--background)/0.18)] px-5 py-4">
                        <Button variant="secondary" onClick={() => setImportModalOpen(false)} className="h-9 rounded-lg px-4">
                            Annuler
                        </Button>
                        <Button
                            onClick={() => {
                                if (!importTargetVersion) return;
                                setImportModalOpen(false);
                                handleImportBindings(importTargetVersion);
                            }}
                            disabled={!importTargetVersion}
                            className="h-9 rounded-lg px-4"
                        >
                            Importer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </m.div>
    );
}
