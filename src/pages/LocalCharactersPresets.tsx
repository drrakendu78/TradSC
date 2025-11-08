import { motion } from 'framer-motion';
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
import { Plus, Folder } from "lucide-react";
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
    const [isAdmin, setIsAdmin] = useState<boolean>(true); // Supposer admin par défaut pour éviter flash de toast
    const { toast } = useToast();
    
    // État pour les sauvegardes
    const [backups, setBackups] = useState<Backup[]>([]);
    const [backupDir, setBackupDir] = useState<string>("");
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
                    // On clone pour ne pas muter l'état
                    map.set(char.name, {
                        name: char.name,
                        versions: [...char.versions],
                    });
                });
                // Ajoute les nouveaux
                result.characters.forEach(newChar => {
                    const key = newChar.name;
                    if (!map.has(key)) {
                        // Crée la structure avec toutes les versions, path vide
                        map.set(key, {
                            name: newChar.name,
                            versions: allVersions.map(version => ({
                                version,
                                path: version === newChar.version ? newChar.path : ""
                            }))
                        });
                    } else {
                        // Met à jour le path pour la version correspondante
                        const existing = map.get(key)!;
                        const idx = existing.versions.findIndex(v => v.version === newChar.version);
                        if (idx !== -1) {
                            // Si le path est vide, on le remplit
                            if (!existing.versions[idx].path) {
                                existing.versions[idx].path = newChar.path;
                            }
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
        setLocalCharacters([]); // Vider les données existantes

        const entries = Object.entries(gamePaths.versions)
            .filter(([_, version]) => version?.path)
            .map(([versionName, version]) => ({ versionName, path: version!.path }));

        await Promise.all(entries.map(({ path }) => scanLocalCharacters(path)));
        setIsLoading(false);
    }, [gamePaths, scanLocalCharacters]);

    // Récupération des versions de jeu et statut admin au chargement
    useEffect(() => {
        const getGameVersions = async () => {
            try {
                const versions = await invoke("get_star_citizen_versions");
                if (isGamePaths(versions)) {
                    logger.log("Versions du jeu reçues:", versions);
                    setGamePaths(versions);
                }
            } catch (error) {
                logger.error("Erreur lors de la récupération des versions:", error);
                toast({
                    title: "Erreur",
                    description: "Impossible de récupérer les versions de Star Citizen",
                    variant: "destructive",
                });
            }
        };

        const checkAdminStatus = async () => {
            try {
                const adminStatus = await invoke<boolean>("is_running_as_admin");
                setIsAdmin(adminStatus);
            } catch (error) {
                logger.error("Erreur lors de la vérification du statut admin:", error);
                setIsAdmin(false);
            }
        };

        Promise.all([getGameVersions(), checkAdminStatus()]);

        // Vérification périodique du statut admin (toutes les 5 secondes)
        const adminCheckInterval = setInterval(checkAdminStatus, 5000);
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
            const list = await invoke<Backup[]>("list_character_backups");
            setBackups(list);
            const dir = await invoke<string>("get_character_backup_directory");
            setBackupDir(dir);
        } catch (e: unknown) {
            toast({
                title: "Erreur",
                description: e instanceof Error ? e.message : "Erreur lors du chargement des sauvegardes",
                variant: "destructive",
            });
        } finally {
            setIsLoadingBackups(false);
        }
    }, [toast]);
    
    const handleCreateBackup = async () => {
        try {
            await invoke("create_character_backup");
            toast({
                title: "Succès",
                description: "Sauvegarde créée !",
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


    if (!gamePaths) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <p>Recherche des installations de Star Citizen...</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <p>
                    Récupération des données{" "}
                    {Array.from({ length: loadingDot }).map((_, i) => (
                        <span key={i}>.</span>
                    ))}
                </p>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
                duration: 0.8,
                delay: 0.2,
                ease: [0, 0.71, 0.2, 1.01],
            }}
            className="flex flex-col w-full max-h-[calc(100vh-50px)]"
        >
            <div className="flex items-center gap-2 mb-4">
                <h1 className="text-2xl mt-5">Gestionnaire de presets de Personnages</h1>
            </div>

            <Tabs defaultValue="presets" className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="presets">Presets locaux</TabsTrigger>
                    <TabsTrigger value="backups">Sauvegardes</TabsTrigger>
                </TabsList>
                
                <TabsContent value="presets" className="space-y-4">
            {/* Description d'en-tête */}
                    <div className="p-4 bg-muted/30 rounded-lg border border-muted">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Gérez vos configurations de personnages sauvegardées localement.
                    Importez, exportez et organisez vos presets entre les différentes versions du jeu.
                </p>
            </div>

            <DataTable
                columns={columns(toast, refreshLocalCharacters, availableVersions)}
                        data={localCharacters}
                    />
                </TabsContent>
                
                <TabsContent value="backups" className="space-y-4">
                    <div className="p-4 bg-muted/30 rounded-lg border border-muted">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                            Gérez les sauvegardes de vos personnages Star Citizen. Créez des sauvegardes, restaurez-les vers différentes versions du jeu.
                        </p>
                        <p className="text-xs text-yellow-500/90">
                            Note : Le changement d'emplacement de sauvegarde nécessite un redémarrage de l'application.
                        </p>
                    </div>
                    
                    <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                            <Button
                                variant="default"
                                size="sm"
                                onClick={handleCreateBackup}
                                className="gap-2"
                            >
                                <Plus className="h-4 w-4" />
                                Créer une sauvegarde
                            </Button>
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
                                    Ouvrir le dossier
                                </Button>
                            )}
                        </div>
                        {backupDir && (
                            <div className="text-sm text-muted-foreground">
                                Dossier : {backupDir || "(défaut)"}
                            </div>
                        )}
                    </div>
                    
                    {isLoadingBackups ? (
                        <div className="flex items-center justify-center h-24">
                            <p>Chargement des sauvegardes...</p>
                        </div>
                    ) : (
                        <BackupDataTable
                            columns={backupColumns(toast, refreshBackups, gameVersionsList, refreshLocalCharacters)}
                            data={backups}
                        />
                    )}
                </TabsContent>
            </Tabs>
        </motion.div>
    );
}

export default LocalCharactersPresets;
