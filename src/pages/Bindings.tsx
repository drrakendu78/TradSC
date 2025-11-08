import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useCallback } from "react";
import { columns } from "@/components/custom/bindings/columns";
import { DataTable } from "@/components/custom/bindings/data-table";
import { Plus, Folder } from "lucide-react";
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
                <h1 className="text-2xl mt-5">Gestion des Bindings</h1>
            </div>

            {/* Description d'en-tête */}
            <div className="mb-4 p-4 bg-muted/30 rounded-lg border border-muted">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Gérez vos fichiers de configuration des contrôles de Star Citizen.
                    Importez, supprimez et organisez vos fichiers de bindings XML.
                </p>
            </div>

            {/* Actions */}
            <div className="mb-4 flex justify-end gap-2">
                <Button
                    variant="default"
                    size="sm"
                    onClick={handleImportBindings}
                    className="gap-2"
                >
                    <Plus className="h-4 w-4" />
                    Importer des bindings
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenFolder}
                    className="gap-2"
                >
                    <Folder className="h-4 w-4" />
                    Ouvrir le dossier
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshBindings}
                >
                    Rafraîchir la liste
                </Button>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="flex items-center justify-center h-24">
                    <p>Chargement des bindings...</p>
                </div>
            ) : (
                <DataTable columns={columns(toast, loadBindings)} data={bindings} />
            )}
        </motion.div>
    );
}

