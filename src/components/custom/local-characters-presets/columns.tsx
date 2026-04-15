"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Trash, Folder, FolderSync, Check, X } from "lucide-react";
import { useState } from "react";
import { PresetActionModal } from "./PresetActionModal";
import logger from "@/utils/logger";
import { invokeWithToast, invokeDeleteWithToast } from "@/utils/invoke-helpers";

const deleteCharacter = async (
    path: string,
    toast: any
) => {
    await invokeDeleteWithToast(
        "delete_character",
        { path },
        toast,
        "Le personnage",
        undefined,
        true // Utiliser toFriendlyFsError
    );
};

const duplicateCharacter = async (
    path: string,
    toast: any,
    onSuccess?: () => void
) => {
    await invokeWithToast(
        "duplicate_character",
        { characterPath: path },
        toast,
        {
            title: "Preset dupliqué",
            description: "Le preset a été copié sur toutes les versions.",
        },
        onSuccess,
        undefined,
        true // Utiliser toFriendlyFsError
    );
};

const handleOpenCharactersFolder = async (
    path: string,
    toast: any
) => {
    const folderPath = path.split('\\').slice(0, -1).join('\\');
    logger.log("Chemin du dossier des personnages :", folderPath);
    await invokeWithToast(
        "open_characters_folder",
        { path: folderPath },
        toast,
        {
            title: "Dossier ouvert",
            description: "Le dossier des personnages a bien été ouvert.",
        },
        undefined,
        undefined,
        true // Utiliser toFriendlyFsError
    );
};

type CharacterRow = { name: string; versions: { version: string; path: string }[] };

interface CharacterActionsCellProps {
    character: CharacterRow;
    toast: any;
    refreshData?: () => void;
}

function CharacterActionsCell({ character, toast, refreshData }: CharacterActionsCellProps) {
    const [modalOpen, setModalOpen] = useState<false | "delete" | "open">(false);
    const [pendingAction, setPendingAction] = useState<null | "delete" | "open">(null);

    const handleModalConfirm = async (selectedVersions: any) => {
        if (pendingAction === "delete") {
            for (const v of selectedVersions) {
                if (v.path) await deleteCharacter(v.path, toast);
            }
            if (typeof refreshData === "function") {
                await refreshData();
            }
        } else if (pendingAction === "open") {
            for (const v of selectedVersions) {
                if (v.path) await handleOpenCharactersFolder(v.path, toast);
            }
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <button
                type="button"
                onClick={() => { setPendingAction("delete"); setModalOpen("delete"); }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/8 px-2 text-xs text-red-600 transition-colors hover:bg-red-500/14 dark:text-red-300"
                aria-label="Supprimer le personnage"
            >
                <Trash strokeWidth={2.5} className="h-3.5 w-3.5" />
                <span>Supprimer</span>
            </button>
            <button
                type="button"
                onClick={() => {
                    const path = character.versions.find(v => v.path)?.path;
                    if (path) {
                        duplicateCharacter(path, toast, refreshData);
                    } else {
                        toast({ title: "Erreur", description: "Impossible de dupliquer : aucun chemin disponible.", success: "false", duration: 3000 });
                    }
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/45 bg-background/20 px-2 text-xs text-foreground/85 transition-colors hover:bg-background/35 hover:text-foreground"
                aria-label="Dupliquer le personnage"
            >
                <FolderSync strokeWidth={2.5} className="h-3.5 w-3.5" />
                <span>Dupliquer</span>
            </button>
            <button
                type="button"
                onClick={() => { setPendingAction("open"); setModalOpen("open"); }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/45 bg-background/20 px-2 text-xs text-foreground/85 transition-colors hover:bg-background/35 hover:text-foreground"
                aria-label="Ouvrir le dossier des personnages"
            >
                <Folder strokeWidth={2.5} className="h-3.5 w-3.5" />
                <span>Dossier</span>
            </button>
            <PresetActionModal
                open={!!modalOpen}
                onClose={() => setModalOpen(false)}
                characterName={character.name}
                versions={character.versions}
                action={pendingAction === "delete" || pendingAction === "open" ? pendingAction : "open"}
                onConfirm={handleModalConfirm}
            />
        </div>
    );
}

export const columns = (
    toast: any,
    refreshData?: () => void,
    availableVersions: string[] = []
): ColumnDef<CharacterRow>[] => [
        {
            header: "Nom",
            accessorKey: "name",
        },
        {
            header: "Versions du jeu",
            accessorKey: "versions",
            cell: ({ row }) => {
                const allVersions: string[] = availableVersions;
                const character = row.original;
                const chunked = [];
                for (let i = 0; i < allVersions.length; i += 3) {
                    chunked.push(allVersions.slice(i, i + 3));
                }
                return (
                    <div className="flex gap-4">
                        {chunked.map((group, idx) => (
                            <div key={group[0] ?? idx} className="flex flex-col gap-2">
                                {group.map((version: string) => {
                                    const found = character.versions.find(v => v.version === version);
                                    const exists = found && found.path;
                                    return (
                                        <span key={version} className="flex items-center gap-1">
                                            <span>{version}</span>
                                            {exists
                                                ? <Check className="text-green-500 h-3 w-3" />
                                                : <X className="text-red-500 h-3 w-3" />}
                                        </span>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                );
            },
        },
        {
            header: "Actions",
            id: "actions",
            cell: ({ row }) => (
                <CharacterActionsCell
                    character={row.original}
                    toast={toast}
                    refreshData={refreshData}
                />
            ),
        },
    ];
