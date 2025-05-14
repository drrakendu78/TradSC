"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { useToast } from "@/hooks/use-toast";

export type Binding = {
    name: string;
    path: string;
};

const deleteBinding = async (
    path: string,
    name: string,
    toast: any,
    updateBindings: () => void,
) => {
    try {
        await invoke("delete_bindings_file", { filePath: path });
        toast({
            title: "Succès",
            description: `Le fichier ${name} a été supprimé avec succès !`,
            success: true,
            duration: 3000,
        });
        updateBindings();
    } catch (error) {
        toast({
            title: "Erreur",
            description: `Impossible de supprimer le fichier ${name}`,
            success: false,
            duration: 3000,
        });
    }
};

export const columns = (
    toast: any,
    updateBindings: () => void,
): ColumnDef<Binding>[] => [
    {
        header: "Nom du fichier",
        accessorKey: "name",
        cell: ({ row }) => (
            <div className="font-medium">
                {row.getValue("name")}
            </div>
        ),
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const binding = row.original;

            const handleDelete = async () => {
                await deleteBinding(binding.path, binding.name, toast, updateBindings);
            };

            return (
                <div className="text-right">
                    <Trash2
                        onClick={handleDelete}
                        className="h-4 w-4 hover:text-red-500 hover:cursor-pointer"
                        strokeWidth={3}
                    />
                </div>
            );
        },
    },
];
