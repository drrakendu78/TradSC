import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useCallback } from "react";
import { columns } from "@/components/custom/bindings/columns";
import { DataTable } from "@/components/custom/bindings/data-table";
import { Plus, Folder, Keyboard, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface BindingFile {
    name: string;
    path: string;
}

export default function Bindings() {
    const { toast } = useToast();
    const [bindings, setBindings] = useState<BindingFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadBindings = useCallback(async () => {
        setIsLoading(true);
        try {
            const files = await invoke<BindingFile[]>("list_bindings_files");
            setBindings(files);
        } catch (error) {
            toast({
                title: "Erreur",
                description: "Impossible de charger la liste des bindings",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    const handleImportBindings = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: "Bindings", extensions: ["xml"] }],
            });

            if (!selected) {
                return;
            }

            // Dans Tauri v2, open peut retourner string | string[] | null
            let filePath: string;
            if (Array.isArray(selected)) {
                filePath = selected[0];
            } else if (typeof selected === "string") {
                filePath = selected;
            } else {
                return;
            }

            await invoke("import_bindings_file", { sourcePath: filePath });

            toast({
                title: "Succès",
                description: "Les bindings ont été importés avec succès !",
                variant: "default",
            });

            // Recharger la liste après l'import
            loadBindings();
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description:
                    error instanceof Error
                        ? error.message
                        : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    const handleRefreshBindings = async () => {
        try {
            await invoke("refresh_bindings");
            toast({
                title: "Succès",
                description: "Les bindings ont été rafraîchis avec succès !",
                variant: "default",
            });
            loadBindings();
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description:
                    error instanceof Error
                        ? error.message
                        : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    const handleOpenFolder = async () => {
        try {
            await invoke("open_bindings_folder");
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description:
                    error instanceof Error
                        ? error.message
                        : "Une erreur inattendue s'est produite.",
                variant: "destructive",
            });
        }
    };

    useEffect(() => {
        loadBindings();
    }, [loadBindings]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                            <Keyboard className="h-6 w-6 text-blue-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Gestion des Bindings</h1>
                            <p className="text-sm text-muted-foreground">Gérez vos configurations de contrôles</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleImportBindings}
                            className="gap-2"
                        >
                            <Plus className="h-4 w-4" />
                            Importer
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpenFolder}
                            className="gap-2"
                        >
                            <Folder className="h-4 w-4" />
                            Dossier
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleRefreshBindings}
                            className="gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Info Card */}
                <Card className="bg-gradient-to-r from-blue-500/5 to-blue-500/10 border-blue-500/20">
                    <CardContent className="py-4">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            🎮 Importez vos fichiers <strong>XML</strong> de configuration des contrôles.
                            Ils seront copiés dans le dossier de Star Citizen pour être utilisés en jeu.
                        </p>
                    </CardContent>
                </Card>

                {/* Table */}
                <Card className="flex-1 overflow-hidden">
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-32 gap-3">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Chargement des bindings...</p>
                            </div>
                        ) : (
                            <DataTable columns={columns(toast, loadBindings)} data={bindings} />
                        )}
                    </CardContent>
                </Card>
            </div>
        </motion.div>
    );
}

