"use client";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { useToast } from "@/hooks/use-toast";
import { open } from "@tauri-apps/api/dialog";

interface ActionsMenuProps {
    updateBindings: () => void;
}

export default function ActionsMenu({ updateBindings }: ActionsMenuProps) {
    const { toast } = useToast();

    const handleRefreshBindings = async () => {
        try {
            await invoke("refresh_bindings");
            
            toast({
                title: "Succès",
                description: "Les bindings ont été rafraîchis avec succès !",
                success: true,
                duration: 3000,
            });

            updateBindings();
        } catch (error: unknown) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
                success: false,
                duration: 3000,
            });
        }
    };

    const handleOpenFolder = async () => {
        try {
            await invoke("open_bindings_folder");
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
                success: false,
                duration: 3000,
            });
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleOpenFolder}>
                    Ouvrir le dossier
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRefreshBindings}>
                    Rafraîchir la liste
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
