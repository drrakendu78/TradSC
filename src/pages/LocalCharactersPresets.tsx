import { m } from 'framer-motion';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { columns } from "@/components/custom/local-characters-presets/columns";
import { DataTable } from "@/components/custom/local-characters-presets/data-table";
import { columns as backupColumns, type Backup } from "@/components/custom/character-backups/columns";
import { DataTable as BackupDataTable } from "@/components/custom/character-backups/data-table";
import { useToast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { GamePaths, isGamePaths } from "@/types/translation";
import { LocalCharactersResult } from "@/types/charactersList";
import logger from "@/utils/logger";
import { isProtectedPath } from "@/utils/fs-permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Folder, Users, Loader2, Save, Globe2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";

function LocalCharactersPresets() {
    // Nouvelle structure : chaque personnage a une liste de versions et chemins associÃ©s
    type CharacterRow = {
        name: string;
        versions: { version: string; path: string }[];
        // Ajoute d'autres propriÃ©tÃ©s si besoin (ex: description, etc.)
    };
    const [localCharacters, setLocalCharacters] = useState<CharacterRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingDot, setLoadingDot] = useState(0);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [gameCheckDone, setGameCheckDone] = useState(false);
    const [isAdmin, setIsAdmin] = useState(true); // Supposer admin par dÃ©faut pour Ã©viter flash de toast
    const { toast } = useToast();
    const [backups, setBackups] = useState<Backup[]>([]);
    const [backupDir, setBackupDir] = useState("");
    const [isLoadingBackups, setIsLoadingBackups] = useState(false);
    const [selectedBackupVersion, setSelectedBackupVersion] = useState("");
    const [createBackupModalOpen, setCreateBackupModalOpen] = useState(false);

    // On regroupe les personnages par identifiant unique (ex: path ou name)
    // Regroupe les personnages par nom et stocke les versions et chemins
    const scanLocalCharacters = useCallback(async (gamePath: string) => {
        try {
            const result: LocalCharactersResult = JSON.parse(
                await invoke("get_character_informations", { path: gamePath }),
            );

            setLocalCharacters(prev => {
                // RÃ©cupÃ¨re toutes les versions connues
                const allVersions = Object.keys(gamePaths?.versions || {});
                const map = new Map<string, CharacterRow>();
                // Ajoute les anciens
                prev.forEach(char => {
                    map.set(char.name, { name: char.name, versions: [...char.versions] });
                });
                // Ajoute les nouveaux
                result.characters.forEach(newChar => {
                    const key = newChar.name;
                    if (!map.has(key)) {
                        map.set(key, {
                            name: newChar.name,
                            versions: allVersions.map(version => ({
                                version,
                                path: version === newChar.version ? newChar.path : ""
                            }))
                        });
                    } else {
                        const existing = map.get(key)!;
                        const idx = existing.versions.findIndex(v => v.version === newChar.version);
                        if (idx !== -1 && !existing.versions[idx].path) {
                            existing.versions[idx].path = newChar.path;
                        }
                    }
                });
                return Array.from(map.values());
            });
        } catch (error) {
            console.error("Erreur lors du scan du cache:", error);
            toast({
                title: "Erreur",
                description: "Impossible de rÃ©cupÃ©rer les informations des personnages",
                variant: "destructive",
            });
        }
    }, [toast, gamePaths]);
    // Fonction pour rafraichir completement les donnees
    const refreshLocalCharacters = useCallback(async () => {
        if (!gamePaths) return;

        setIsLoading(true);
        setLocalCharacters([]);

        const entries = Object.entries(gamePaths.versions)
            .filter(([_, version]) => version?.path)
            .map(([versionName, version]) => ({ versionName, path: version!.path }));

        await Promise.all(entries.map(({ path }) => scanLocalCharacters(path)));
        setIsLoading(false);
    }, [gamePaths, scanLocalCharacters]);

    // RÃ©cupÃ©ration des versions de jeu et statut admin au chargement
    useEffect(() => {
        const getAdminStatus = (): Promise<boolean> =>
            invoke<boolean>("is_running_as_admin").catch((error) => {
                logger.error("Erreur lors de la vÃ©rification du statut admin:", error);
                return false;
            });

        const init = async () => {
            const [versions, adminStatus] = await Promise.all([
                invoke("get_star_citizen_versions").catch((error) => {
                    logger.error("Erreur lors de la rÃ©cupÃ©ration des versions:", error);
                    toast({ title: "Erreur", description: "Impossible de rÃ©cupÃ©rer les versions de Star Citizen", variant: "destructive" });
                    return null;
                }),
                getAdminStatus(),
            ]);
            setGamePaths(versions && isGamePaths(versions) ? versions : null);
            setIsAdmin(adminStatus);
            setGameCheckDone(true);
        };

        init();

        // Verification periodique du statut admin (toutes les 5 secondes)
        const adminCheckInterval = setInterval(() => {
            getAdminStatus().then(setIsAdmin);
        }, 5000);
        return () => clearInterval(adminCheckInterval);
    }, [toast]);

    // Scanner le cache quand les chemins sont disponibles
    useEffect(() => {
        if (!gamePaths) return;

        const scanAllPaths = async () => {
            const entries = Object.entries(gamePaths.versions)
                .filter(([_, version]) => version?.path)
                .map(([versionName, version]) => ({ versionName, path: version!.path }));

            for (const { path } of entries) {
                if (isProtectedPath(path) && !isAdmin) {
                    toast({
                        title: "Chemin protÃ©gÃ©",
                        description: "Certaines opÃ©rations peuvent nÃ©cessiter l'administrateur (bouclier en bas Ã  droite).",
                        variant: "warning",
                        duration: 4000,
                    });
                }
                await scanLocalCharacters(path);
            }
            setIsLoading(false);
        };
        scanAllPaths();
    }, [gamePaths, scanLocalCharacters]);

    // Animation des points de chargement
    useEffect(() => {
        if (!isLoading) return;

        const interval = setInterval(() => {
            setLoadingDot(prev => prev === 3 ? 0 : prev + 1);
        }, 500);

        return () => clearInterval(interval);
    }, [isLoading]);



    // Obtenir la liste des versions disponibles
    const availableVersions = useMemo(() => {
        const versions = localCharacters.flatMap(char => char.versions.map(v => v.version));
        return Array.from(new Set(versions)).sort();
    }, [localCharacters]);
    
    // Fonctions pour les sauvegardes
    const refreshBackups = useCallback(async () => {
        setIsLoadingBackups(true);
        try {
            const [list, dir] = await Promise.all([
                invoke<Backup[]>("list_character_backups"),
                invoke<string>("get_character_backup_directory"),
            ]);
            setBackups(list);
            setBackupDir(dir);
            setIsLoadingBackups(false);
        } catch (e: unknown) {
            toast({
                title: "Erreur",
                description: e instanceof Error ? e.message : "Erreur lors du chargement des sauvegardes",
                variant: "destructive",
            });
            setIsLoadingBackups(false);
        }
    }, [toast]);
    
    const handleCreateBackup = async (version: string) => {
        try {
            await invoke("create_character_backup", { version });
            toast({
                title: "SuccÃ¨s",
                description: `Sauvegarde de ${version} crÃ©Ã©e !`,
                variant: "default",
            });
            refreshBackups();
        } catch (e: unknown) {
            toast({
                title: "Erreur",
                description: e instanceof Error ? e.message : "Erreur lors de la crÃ©ation de la sauvegarde",
                variant: "destructive",
            });
        }
    };
    
    const handleChangeFolder = async () => {
        try {
            const selected = await open({ 
                directory: true,
                multiple: false,
                title: "SÃ©lectionner un dossier pour les sauvegardes"
            });
            
            if (!selected) {
                return; // L'utilisateur a annulÃ©
            }
            
            // Dans Tauri v2, open peut retourner string | string[] | null
            let dir: string;
            if (Array.isArray(selected)) {
                dir = selected[0];
            } else if (typeof selected === 'string') {
                dir = selected;
            } else {
                return; // AnnulÃ©
            }
            
            console.log("Tentative de changement de dossier vers:", dir);
            await invoke("set_character_backup_directory", { path: dir });
            toast({
                title: "SuccÃ¨s",
                description: "Dossier de sauvegarde mis Ã  jour. RedÃ©marrage requis.",
                variant: "default",
            });
            refreshBackups();
        } catch (e: unknown) {
            console.error("Erreur complÃ¨te lors du changement de dossier:", e);
            let errorMessage = "Erreur lors du changement de dossier";
            if (e instanceof Error) {
                errorMessage = e.message;
            } else if (typeof e === 'string') {
                errorMessage = e;
            } else if (e && typeof e === 'object' && 'message' in e) {
                errorMessage = String(e.message);
            }
            toast({
                title: "Erreur",
                description: errorMessage,
                variant: "destructive",
            });
        }
    };
    
    const handleOpenBackupFolder = async () => {
        try {
            await invoke("open_character_backup_folder");
        } catch (e: unknown) {
            toast({
                title: "Erreur",
                description: e instanceof Error ? e.message : "Erreur lors de l'ouverture du dossier",
                variant: "destructive",
            });
        }
    };
    
    // Charger les sauvegardes au montage
    useEffect(() => {
        refreshBackups();
    }, [refreshBackups]);
    
    // Obtenir les versions de jeu pour les restaurations
    const gameVersionsList = useMemo(() => {
        if (!gamePaths) return [];
        return Object.keys(gamePaths.versions).sort();
    }, [gamePaths]);

    useEffect(() => {
        if (gameVersionsList.length === 0) {
            setSelectedBackupVersion("");
            return;
        }

        setSelectedBackupVersion((prev) => {
            if (prev && gameVersionsList.includes(prev)) return prev;
            const live = gameVersionsList.find((version) => version.toUpperCase() === "LIVE");
            return live ?? gameVersionsList[0];
        });
    }, [gameVersionsList]);

    const localTabTriggerClass =
        "group flex h-auto min-h-[34px] items-center justify-between gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 data-[state=active]:border-primary/45 data-[state=active]:bg-[linear-gradient(140deg,hsl(var(--primary)/0.14),hsl(var(--background)/0.34))] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_0_1px_hsl(var(--primary)/0.28),0_6px_16px_hsl(var(--primary)/0.14)] data-[state=active]:animate-[tab-activate_220ms_ease-out]";


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
                <section className="w-full max-w-xl rounded-xl border border-border/60 bg-[hsl(var(--background)/0.28)] p-7 text-center shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
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

    if (isLoading) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                <div className="rounded-full bg-muted p-4 animate-pulse">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                    Recuperation des donnees{Array.from({ length: loadingDot }).map((_, i) => <span key={i}>.</span>)}
                </p>
            </div>
        );
    }

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-auto pr-1">
                {/* Header */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pink-500/30 bg-pink-500/10">
                                <Users className="h-4 w-4 text-pink-500" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Persos locaux</h1>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        {localCharacters.length} perso{localCharacters.length > 1 ? "s" : ""}
                                    </Badge>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        {backups.length} sauvegarde{backups.length > 1 ? "s" : ""}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Gerez vos presets locaux et vos sauvegardes</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-pink-500/25 via-border/40 to-transparent" />
                </section>

                <Tabs defaultValue="presets" className="flex flex-col">
                    <section className="relative flex flex-col overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,hsl(var(--primary)/0.12),transparent_62%)]" />

                        <div className="relative border-b border-border/35 px-2.5 py-2">
                            <TabsList className="inline-grid h-auto w-fit grid-cols-2 gap-1 rounded-xl border border-border/55 bg-[hsl(var(--background)/0.24)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                                <TabsTrigger value="presets" className={localTabTriggerClass}>
                                    <span className="flex items-center gap-1.5">
                                        <Users className="h-3.5 w-3.5 text-pink-500" />
                                        <span className="text-[10px] font-semibold tracking-[0.04em] sm:text-[10px]">PRESETS</span>
                                    </span>
                                    <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground/85">
                                        {localCharacters.length}
                                    </span>
                                </TabsTrigger>
                                <TabsTrigger value="backups" className={localTabTriggerClass}>
                                    <span className="flex items-center gap-1.5">
                                        <Save className="h-3.5 w-3.5 text-primary" />
                                        <span className="text-[10px] font-semibold tracking-[0.04em] sm:text-[10px]">SAUVEGARDES</span>
                                    </span>
                                    <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground/85">
                                        {backups.length}
                                    </span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="presets" className="relative mt-0 px-2.5 pb-2.5 pt-2">
                            <div className="mb-2 rounded-xl border border-border/35 bg-[hsl(var(--background)/0.22)] px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[11px] text-muted-foreground">
                                        Gerez vos presets locaux et passez facilement d'une version du jeu a l'autre.
                                    </p>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/45 bg-background/20 px-2 text-[10px]">
                                        {availableVersions.length} version{availableVersions.length > 1 ? "s" : ""}
                                    </Badge>
                                </div>
                            </div>

                            <DataTable
                                columns={columns(toast, refreshLocalCharacters, availableVersions)}
                                data={localCharacters}
                            />
                        </TabsContent>

                        <TabsContent value="backups" className="relative mt-0 px-2.5 pb-2.5 pt-2">
                            <div className="mb-2 space-y-2 rounded-xl border border-border/35 bg-[hsl(var(--background)/0.22)] px-3 py-2.5">
                                <p className="text-[11px] text-muted-foreground">
                                    Gerez les sauvegardes de vos persos et restaurez-les vers les versions du jeu que vous utilisez.
                                </p>
                                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                    Le changement d'emplacement de sauvegarde necessite un redemarrage de l'application.
                                </p>

                                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={() => setCreateBackupModalOpen(true)}
                                            disabled={gameVersionsList.length === 0}
                                            className="h-8 gap-2 rounded-lg px-3"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Creer une sauvegarde
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleChangeFolder}
                                            className="h-8 gap-2 rounded-lg border-border/50 bg-background/20 px-3"
                                        >
                                            <Folder className="h-4 w-4" />
                                            Changer de dossier
                                        </Button>
                                        {backupDir && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleOpenBackupFolder}
                                                className="h-8 gap-2 rounded-lg px-3"
                                            >
                                                <Folder className="h-4 w-4" />
                                                Ouvrir
                                            </Button>
                                        )}
                                    </div>
                                    {backupDir && (
                                        <p className="max-w-[380px] truncate text-[11px] text-muted-foreground">
                                            {backupDir}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {isLoadingBackups ? (
                                <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)]">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">Chargement des sauvegardes...</p>
                                </div>
                            ) : (
                                <BackupDataTable
                                    columns={backupColumns(toast, refreshBackups, gameVersionsList, refreshLocalCharacters)}
                                    data={backups}
                                />
                            )}
                        </TabsContent>
                    </section>
                </Tabs>

                <Dialog
                    open={createBackupModalOpen}
                    onOpenChange={(nextOpen) => {
                        setCreateBackupModalOpen(nextOpen);
                    }}
                >
                    <DialogContent className="max-w-[560px] overflow-hidden border-primary/35 p-0">
                        <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.16))] px-5 py-4">
                            <DialogHeader className="relative space-y-2 pr-10 text-left">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-primary/45 bg-primary/12 text-primary">
                                        <Save className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                        <DialogTitle className="text-xl font-semibold tracking-tight">
                                            CrÃ©er une sauvegarde
                                        </DialogTitle>
                                        <DialogDescription className="text-sm text-muted-foreground/92">
                                            Choisissez la version Ã  sauvegarder.
                                        </DialogDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="rounded-full border border-border/50 bg-background/25 px-2 py-0.5 text-muted-foreground/90">
                                        {gameVersionsList.length} version{gameVersionsList.length > 1 ? "s" : ""} disponible{gameVersionsList.length > 1 ? "s" : ""}
                                    </span>
                                    <span className="rounded-full border border-primary/45 bg-primary/12 px-2 py-0.5 font-semibold uppercase tracking-[0.06em] text-primary">
                                        Sauvegarde
                                    </span>
                                </div>
                            </DialogHeader>
                        </div>

                        <div className="space-y-2 px-5 py-4">
                            {gameVersionsList.length > 0 ? (
                                gameVersionsList.map((version) => {
                                    const isSelected = selectedBackupVersion === version;

                                    return (
                                        <button
                                            key={version}
                                            type="button"
                                            onClick={() => setSelectedBackupVersion(version)}
                                            className={cn(
                                                "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                                                "border-border/45 bg-[hsl(var(--background)/0.22)] hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.08)]",
                                                isSelected && "border-primary/45 bg-[hsl(var(--primary)/0.12)] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]",
                                            )}
                                        >
                                            <span className="font-medium text-foreground/95">{version}</span>
                                            <span
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
                                                    isSelected
                                                        ? "border-primary/45 bg-primary/12 text-primary"
                                                        : "border-border/45 bg-background/30 text-muted-foreground",
                                                )}
                                            >
                                                {isSelected && <Check className="h-3 w-3" />}
                                                {isSelected ? "Selectionnee" : "Choisir"}
                                            </span>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="rounded-xl border border-border/40 bg-[hsl(var(--background)/0.2)] px-3 py-3 text-sm text-muted-foreground">
                                    Aucune version installÃ©e dÃ©tectÃ©e.
                                </div>
                            )}
                        </div>

                        <DialogFooter className="border-t border-border/45 bg-[hsl(var(--background)/0.18)] px-5 py-4">
                            <Button variant="secondary" onClick={() => setCreateBackupModalOpen(false)} className="h-9 rounded-lg px-4">
                                Annuler
                            </Button>
                            <Button
                                onClick={() => {
                                    if (!selectedBackupVersion) return;
                                    setCreateBackupModalOpen(false);
                                    handleCreateBackup(selectedBackupVersion);
                                }}
                                disabled={!selectedBackupVersion}
                                className="h-9 rounded-lg px-4"
                            >
                                CrÃ©er
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </m.div>
    );
}
export default LocalCharactersPresets;
