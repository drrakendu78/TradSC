"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Trash } from "lucide-react";
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
    await invokeDeleteWithToast(
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
            header: " ",
            cell: ({ row }) => (
                <button
                    onClick={() =>
                        deleteFolder(row.original.path, toast, updateCacheInfos)
                    }>
                    <Trash
                        strokeWidth={3}
                        className="h-4 w-4 
                hover:text-red-500 hover:cursor-pointer"
                    />
                </button>
            ),
        },
    ];
