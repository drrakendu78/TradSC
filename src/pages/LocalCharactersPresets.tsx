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
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Folder, Users, Loader2, Save, Globe2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { open } from "@tauri-apps/plugin-dialog";

function LocalCharactersPresets() {
    // Nouvelle structure : chaque personnage a une liste de versions et chemins associés
    type CharacterRow = {
        name: string;
        versions: { version: string; path: string }[];
        // Ajoute d'autres propriétés si besoin (ex: description, etc.)
    };
    const [localCharacters, setLocalCharacters] = useState<CharacterRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingDot, setLoadingDot] = useState(0);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [gameCheckDone, setGameCheckDone] = useState(false);
    const [isAdmin, setIsAdmin] = useState(true); // Supposer admin par défaut pour éviter flash de toast
    const { toast } = useToast();
    const [backups, setBackups] = useState<Backup[]>([]);
    const [backupDir, setBackupDir] = useState("");
    const [isLoadingBackups, setIsLoadingBackups] = useState(false);

    // On regroupe les personnages par identifiant unique (ex: path ou name)
    // Regroupe les personnages par nom et stocke les versions et chemins
    const scanLocalCharacters = useCallback(async (gamePath: string) => {
        try {
            const result: LocalCharactersResult = JSON.parse(
                await invoke("get_character_informations", { path: gamePath }),
            );

            setLocalCharacters(prev => {
                // Récupère toutes les versions connues
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
                description: "Impossible de récupérer les informations des personnages",
                variant: "destructive",
            });
        }
    }, [toast, gamePaths]);

    // Fonction pour rafraîchir complètement les données
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

    // Récupération des versions de jeu et statut admin au chargement
    useEffect(() => {
        const getAdminStatus = (): Promise<boolean> =>
            invoke<boolean>("is_running_as_admin").catch((error) => {
                logger.error("Erreur lors de la vérification du statut admin:", error);
                return false;
            });

        const init = async () => {
            const [versions, adminStatus] = await Promise.all([
                invoke("get_star_citizen_versions").catch((error) => {
                    logger.error("Erreur lors de la récupération des versions:", error);
                    toast({ title: "Erreur", description: "Impossible de récupérer les versions de Star Citizen", variant: "destructive" });
                    return null;
                }),
                getAdminStatus(),
            ]);
            setGamePaths(versions && isGamePaths(versions) ? versions : null);
            setIsAdmin(adminStatus);
            setGameCheckDone(true);
        };

        init();

        // Vérification périodique du statut admin (toutes les 5 secondes)
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
                        title: "Chemin protégé",
                        description: "Certaines opérations peuvent nécessiter l'administrateur (bouclier en bas à droite).",
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
                title: "Succès",
                description: `Sauvegarde de ${version} créée !`,
                variant: "default",
            });
            refreshBackups();
        } catch (e: unknown) {
            toast({
                title: "Erreur",
                description: e instanceof Error ? e.message : "Erreur lors de la création de la sauvegarde",
                variant: "destructive",
            });
        }
    };
    
    const handleChangeFolder = async () => {
        try {
            const selected = await open({ 
                directory: true,
                multiple: false,
                title: "Sélectionner un dossier pour les sauvegardes"
            });
            
            if (!selected) {
                return; // L'utilisateur a annulé
            }
            
            // Dans Tauri v2, open peut retourner string | string[] | null
            let dir: string;
            if (Array.isArray(selected)) {
                dir = selected[0];
            } else if (typeof selected === 'string') {
                dir = selected;
            } else {
                return; // Annulé
            }
            
            console.log("Tentative de changement de dossier vers:", dir);
            await invoke("set_character_backup_directory", { path: dir });
            toast({
                title: "Succès",
                description: "Dossier de sauvegarde mis à jour. Redémarrage requis.",
                variant: "default",
            });
            refreshBackups();
        } catch (e: unknown) {
            console.error("Erreur complète lors du changement de dossier:", e);
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


    if (!gameCheckDone) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                <div className="p-4 rounded-full bg-muted animate-pulse">
                    <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                </div>
                <p className="text-muted-foreground">Recherche des installations de Star Citizen...</p>
            </div>
        );
    }

    if (!gamePaths) {
        return (
            <div className="flex flex-col items-center justify-center w-full h-full gap-4">
                <div className="p-4 rounded-full bg-muted">
                    <Globe2 className="h-12 w-12 text-muted-foreground" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold">Aucune version détectée</h2>
                    <p className="text-muted-foreground max-w-md">
                        Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                        <kbd className="mx-2 px-2 py-1 text-xs bg-muted rounded border">CTRL + R</kbd>
                    </p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                <div className="p-4 rounded-full bg-muted animate-pulse">
                    <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                </div>
                <p className="text-muted-foreground">
                    Récupération des données{Array.from({ length: loadingDot }).map((_, i) => <span key={i}>.</span>)}
                </p>
            </div>
        );
    }

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-pink-500/10">
                        <Users className="h-6 w-6 text-pink-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Gestionnaire de Personnages</h1>
                        <p className="text-sm text-muted-foreground">Gérez vos presets et sauvegardes</p>
                    </div>
                </div>

                <Tabs defaultValue="presets" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="mb-4 w-fit">
                        <TabsTrigger value="presets" className="gap-2">
                            <Users className="h-4 w-4" />
                            Presets locaux
                        </TabsTrigger>
                        <TabsTrigger value="backups" className="gap-2">
                            <Save className="h-4 w-4" />
                            Sauvegardes
                        </TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="presets" className="flex flex-col gap-4 overflow-auto">
                        <Card className="bg-gradient-to-r from-pink-500/5 to-pink-500/10 border-pink-500/20">
                            <CardContent className="py-4">
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    👤 Gérez vos configurations de personnages sauvegardées localement.
                                    Importez, exportez et organisez vos presets entre les différentes versions du jeu.
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="overflow-hidden bg-background/40 border-border/50">
                            <CardContent className="p-0">
                                <DataTable
                                    columns={columns(toast, refreshLocalCharacters, availableVersions)}
                                    data={localCharacters}
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>
                    
                    <TabsContent value="backups" className="flex flex-col gap-4 overflow-auto">
                        <Card className="bg-gradient-to-r from-amber-500/5 to-amber-500/10 border-amber-500/20">
                            <CardContent className="py-4">
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    💾 Gérez les sauvegardes de vos personnages. Créez des sauvegardes et restaurez-les vers différentes versions du jeu.
                                </p>
                                <p className="text-xs text-yellow-500/90 mt-2">
                                    ⚠️ Le changement d'emplacement de sauvegarde nécessite un redémarrage de l'application.
                                </p>
                            </CardContent>
                        </Card>
                        
                        <div className="flex justify-between items-center">
                            <div className="flex gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            className="gap-2"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Créer une sauvegarde
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        {gameVersionsList.map((version) => (
                                            <DropdownMenuItem
                                                key={version}
                                                onClick={() => handleCreateBackup(version)}
                                            >
                                                Sauvegarder {version}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleChangeFolder}
                                    className="gap-2"
                                >
                                    <Folder className="h-4 w-4" />
                                    Changer de dossier
                                </Button>
                                {backupDir && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleOpenBackupFolder}
                                        className="gap-2"
                                    >
                                        <Folder className="h-4 w-4" />
                                        Ouvrir
                                    </Button>
                                )}
                            </div>
                            {backupDir && (
                                <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                                    📁 {backupDir}
                                </p>
                            )}
                        </div>
                        
                        <Card className="overflow-hidden bg-background/40 border-border/50">
                            <CardContent className="p-0">
                                {isLoadingBackups ? (
                                    <div className="flex flex-col items-center justify-center h-32 gap-3">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">Chargement des sauvegardes...</p>
                                    </div>
                                ) : (
                                    <BackupDataTable
                                        columns={backupColumns(toast, refreshBackups, gameVersionsList, refreshLocalCharacters)}
                                        data={backups}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </m.div>
    );
}

export default LocalCharactersPresets;
