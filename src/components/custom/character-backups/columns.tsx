import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Trash2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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

type ToastFn = ReturnType<typeof useToast>["toast"];

interface BackupActionsCellProps {
    backup: Backup;
    toast: ToastFn;
    refresh: () => void;
    gameVersions: string[];
    refreshLocalCharacters?: () => void;
}

function BackupActionsCell({
    backup,
    toast,
    refresh,
    gameVersions,
    refreshLocalCharacters,
}: BackupActionsCellProps) {
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    const restoreTo = async (version: string) => {
        await invokeWithToast(
            "restore_character_backup_to_version",
            {
                backupPath: backup.path,
                version,
            },
            toast,
            {
                title: "Succes",
                description: `Sauvegarde restauree vers ${version}.`,
            },
            () => {
                if (refreshLocalCharacters) {
                    refreshLocalCharacters();
                }
            },
        );
    };

    const remove = async () => {
        const deleted = await invokeDeleteWithToast(
            "delete_character_backup",
            { backupPath: backup.path },
            toast,
            "Sauvegarde",
            refresh,
        );

        if (deleted) {
            setDeleteModalOpen(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/45 bg-background/20 px-2 text-xs text-foreground/85 transition-colors hover:border-primary/40 hover:bg-primary/12 hover:text-primary"
                    >
                        <RotateCw className="h-3.5 w-3.5" />
                        <span>Restaurer</span>
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
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/8 px-2 text-xs text-red-600 transition-colors hover:border-red-500/45 hover:bg-red-500/16 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                onClick={() => setDeleteModalOpen(true)}
            >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Supprimer</span>
            </Button>

            <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
                <DialogContent className="max-w-[560px] overflow-hidden border-red-500/35 p-0">
                    <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--destructive)/0.18),hsl(var(--background)/0.18))] px-5 py-4">
                        <DialogHeader className="relative space-y-2 pr-10 text-left">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 text-red-400">
                                    <Trash2 className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <DialogTitle className="text-xl font-semibold tracking-tight">
                                        Supprimer cette sauvegarde
                                    </DialogTitle>
                                    <DialogDescription className="text-sm text-muted-foreground/92">
                                        Cette action est definitive.
                                    </DialogDescription>
                                </div>
                            </div>
                            <span className="inline-flex w-fit rounded-full border border-red-500/45 bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-red-500 dark:text-red-300">
                                Suppression
                            </span>
                        </DialogHeader>
                    </div>

                    <div className="space-y-2 px-5 py-4">
                        <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] px-3 py-2.5 text-sm">
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Sauvegarde</p>
                            <p className="mt-1 font-medium text-foreground/95">{backup.name}</p>
                        </div>
                        <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] px-3 py-2.5 text-sm">
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Date</p>
                            <p className="mt-1 font-medium text-foreground/95">{backup.date}</p>
                        </div>
                    </div>

                    <DialogFooter className="border-t border-border/45 bg-[hsl(var(--background)/0.18)] px-5 py-4">
                        <Button
                            variant="secondary"
                            onClick={() => setDeleteModalOpen(false)}
                            className="h-9 rounded-lg px-4"
                        >
                            Annuler
                        </Button>
                        <Button
                            onClick={remove}
                            variant="destructive"
                            className="h-9 gap-2 rounded-lg px-4"
                        >
                            <Trash2 className="h-4 w-4" />
                            Supprimer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export const columns = (
    toast: ToastFn,
    refresh: () => void,
    gameVersions: string[],
    refreshLocalCharacters?: () => void,
): ColumnDef<Backup>[] => [
    {
        header: "Nom de la sauvegarde",
        accessorKey: "name",
        cell: ({ row }) => <div>{row.getValue("name")}</div>,
    },
    {
        header: "Date",
        accessorKey: "date",
    },
    {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
            <BackupActionsCell
                backup={row.original}
                toast={toast}
                refresh={refresh}
                gameVersions={gameVersions}
                refreshLocalCharacters={refreshLocalCharacters}
            />
        ),
    },
];
