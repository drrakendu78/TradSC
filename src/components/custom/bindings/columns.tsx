import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";

export type Binding = {
    name: string;
    path: string;
};

export const columns = (
    toast: ReturnType<typeof useToast>["toast"],
    updateBindings: () => void
): ColumnDef<Binding>[] => [
    {
        header: "Nom",
        accessorKey: "name",
    },
    {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
            const binding = row.original;

            const handleDelete = async () => {
                try {
                    await invoke("delete_bindings_file", { filePath: binding.path });
                    toast({
                        title: "Succès",
                        description: `Le fichier ${binding.name} a été supprimé avec succès !`,
                        variant: "default",
                    });
                    updateBindings();
                } catch (error: unknown) {
                    toast({
                        title: "Erreur",
                        description: `Impossible de supprimer le fichier ${binding.name}`,
                        variant: "destructive",
                    });
                }
            };

            return (
                <div className="flex flex-col items-start gap-2">
                    <div className="flex flex-row-reverse items-center gap-2">
                        <span>Supprimer le fichier</span>
                        <button
                            onClick={handleDelete}
                            aria-label="Supprimer le fichier"
                        >
                            <Trash2
                                strokeWidth={3}
                                className="h-4 w-4 hover:text-red-500 hover:cursor-pointer"
                            />
                        </button>
                    </div>
                </div>
            );
        },
    },
];

