import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invokeDeleteWithToast } from "@/utils/invoke-helpers";

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
                await invokeDeleteWithToast(
                    "delete_bindings_file",
                    { filePath: binding.path },
                    toast,
                    `Le fichier ${binding.name}`,
                    updateBindings
                );
            };

            return (
                <div className="flex flex-col items-start gap-2">
                    <button
                        onClick={handleDelete}
                        className="flex items-center gap-2 hover:text-red-500 transition-colors"
                        aria-label="Supprimer le fichier"
                    >
                        <Trash2
                            strokeWidth={3}
                            className="h-4 w-4"
                        />
                        <span>Supprimer le fichier</span>
                    </button>
                </div>
            );
        },
    },
];

