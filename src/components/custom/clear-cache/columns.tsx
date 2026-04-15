"use client";
import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { invokeDeleteWithToast } from "@/utils/invoke-helpers";
import { useStatsStore } from "@/stores/stats-store";

export type Folder = {
    name: string;
    weight: string;
    path: string;
};

export type CacheInfos = {
    folders: Folder[];
};

const deleteFolder = async (
    path: string,
    toast: any,
    updateCacheInfos: (path: string) => void,
) => {
    return invokeDeleteWithToast(
        "delete_folder",
        { path },
        toast,
        `Le dossier ${path}`,
        () => {
            updateCacheInfos(path);
            // Enregistrer la stat de nettoyage
            useStatsStore.getState().recordCacheClean();
        }
    );
};

interface CacheDeleteCellProps {
    folder: Folder;
    toast: any;
    updateCacheInfos: (path: string) => void;
}

function CacheDeleteCell({ folder, toast, updateCacheInfos }: CacheDeleteCellProps) {
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    const remove = async () => {
        const deleted = await deleteFolder(folder.path, toast, updateCacheInfos);
        if (deleted) {
            setDeleteModalOpen(false);
        }
    };

    return (
        <>
            <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/8 px-2 text-xs text-red-600 transition-colors hover:border-red-500/45 hover:bg-red-500/16 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                onClick={() => setDeleteModalOpen(true)}
            >
                <Trash
                    strokeWidth={2.5}
                    className="h-3.5 w-3.5"
                />
                <span>Supprimer</span>
            </button>

            <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
                <DialogContent className="max-w-[560px] overflow-hidden border-red-500/35 p-0">
                    <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--destructive)/0.18),hsl(var(--background)/0.18))] px-5 py-4">
                        <DialogHeader className="relative space-y-2 pr-10 text-left">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 text-red-400">
                                    <Trash className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <DialogTitle className="text-xl font-semibold tracking-tight">
                                        Supprimer ce dossier cache
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
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Nom</p>
                            <p className="mt-1 font-medium text-foreground/95">{folder.name}</p>
                        </div>
                        <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] px-3 py-2.5 text-sm">
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Poids</p>
                            <p className="mt-1 font-medium text-foreground/95">{folder.weight}</p>
                        </div>
                        <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] px-3 py-2.5 text-sm">
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Chemin</p>
                            <p className="mt-1 break-all font-medium text-foreground/90">{folder.path}</p>
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
                            <Trash className="h-4 w-4" />
                            Supprimer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export const columns = (
    toast: any,
    updateCacheInfos: (path: string) => void,
): ColumnDef<Folder>[] => [
        {
            header: "Nom",
            accessorKey: "name",
        },
        {
            header: "Poids",
            accessorKey: "weight",
        },
        {
            header: "Actions",
            cell: ({ row }) => (
                <CacheDeleteCell
                    folder={row.original}
                    toast={toast}
                    updateCacheInfos={updateCacheInfos}
                />
            ),
        },
    ];
