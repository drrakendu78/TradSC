import { ColumnDef } from "@tanstack/react-table";
import { Trash2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { invokeWithToast, invokeDeleteWithToast } from "@/utils/invoke-helpers";

export type Backup = {
    name: string;
    path: string;
    date: string;
};

export const columns = (
    toast: ReturnType<typeof useToast>["toast"],
    refresh: () => void,
    gameVersions: string[],
    refreshLocalCharacters?: () => void
): ColumnDef<Backup>[] => [
    {
        header: "Nom de la sauvegarde",
        accessorKey: "name",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        header: "Date",
        accessorKey: "date",
    },
    {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
            const backup = row.original;

            const restoreTo = async (version: string) => {
                await invokeWithToast(
                    "restore_character_backup_to_version",
                    {
                        backupPath: backup.path,
                        version,
                    },
                    toast,
                    {
                        title: "Succès",
                        description: `Sauvegarde restaurée vers ${version}.`,
                    },
                    () => {
                        // Rafraîchir la liste des presets locaux si la fonction est fournie
                        if (refreshLocalCharacters) {
                            refreshLocalCharacters();
                        }
                    }
                );
            };

            const remove = async () => {
                await invokeDeleteWithToast(
                    "delete_character_backup",
                    { backupPath: backup.path },
                    toast,
                    "Sauvegarde",
                    refresh
                );
            };

            return (
                <div className="flex items-center justify-end gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <RotateCw className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {gameVersions.map((version) => (
                                <DropdownMenuItem
                                    key={version}
                                    onClick={() => restoreTo(version)}
                                >
                                    Restaurer vers {version}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:text-destructive"
                        onClick={remove}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            );
        },
    },
];

