import { useState } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import { useStatsStore } from "@/stores/stats-store";
import type { Folder } from "@/components/custom/clear-cache/columns";

export default function ActionsMenu({
    setCacheInfos,
}: {
    setCacheInfos: React.Dispatch<React.SetStateAction<Folder[] | null>>;
}) {
    const { toast } = useToast();
    const recordCacheClean = useStatsStore((state) => state.recordCacheClean);
    const [clearModalOpen, setClearModalOpen] = useState(false);

    const handleOpenCacheFolder = async () => {
        try {
            const res = await invoke("open_cache_folder");
            if (res) {
                toast({
                    title: "Dossier ouvert",
                    description: "Le dossier du cache a bien ete ouvert.",
                    success: "true",
                    duration: 3000,
                });
            }
        } catch (error) {
            toast({
                title: "Erreur lors de l'ouverture",
                description: `Une erreur est survenue : ${error}`,
                success: "false",
                duration: 3000,
            });
        }
    };

    const handleClearCache = async () => {
        try {
            const res = await invoke("clear_cache");
            if (res) {
                setCacheInfos([]);
                recordCacheClean();
                setClearModalOpen(false);
                toast({
                    title: "Cache nettoye",
                    description: "Le cache a bien ete nettoye.",
                    success: "true",
                    duration: 3000,
                });
            }
        } catch (error) {
            toast({
                title: "Erreur lors du nettoyage",
                description: `Une erreur est survenue : ${error}`,
                success: "false",
                duration: 3000,
            });
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/45 bg-background/20 px-2.5 text-xs text-foreground/90 transition-colors hover:bg-background/35"
                    >
                        <MoreHorizontal className="h-4 w-4" />
                        Actions
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                        className="cursor-pointer text-red-600 dark:text-red-300 hover:bg-red-500/14 hover:text-red-700 dark:hover:text-red-200 data-[highlighted]:bg-red-500/14 data-[highlighted]:text-red-700 dark:data-[highlighted]:text-red-200"
                        onClick={() => setClearModalOpen(true)}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Nettoyer le cache
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={handleOpenCacheFolder}
                    >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Ouvrir le dossier du cache
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={clearModalOpen} onOpenChange={setClearModalOpen}>
                <DialogContent className="max-w-[560px] overflow-hidden border-red-500/35 p-0">
                    <div className="relative border-b border-border/45 bg-[linear-gradient(135deg,hsl(var(--destructive)/0.18),hsl(var(--background)/0.18))] px-5 py-4">
                        <DialogHeader className="relative space-y-2 pr-10 text-left">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 text-red-400">
                                    <Trash2 className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <DialogTitle className="text-xl font-semibold tracking-tight">
                                        Nettoyer tout le cache
                                    </DialogTitle>
                                    <DialogDescription className="text-sm text-muted-foreground/92">
                                        Tous les dossiers de cache listes sur cette page seront supprimes.
                                    </DialogDescription>
                                </div>
                            </div>
                            <span className="inline-flex w-fit rounded-full border border-red-500/45 bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-red-500 dark:text-red-300">
                                Suppression globale
                            </span>
                        </DialogHeader>
                    </div>

                    <div className="space-y-2 px-5 py-4">
                        <div className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.22)] px-3 py-2.5 text-sm">
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Confirmation</p>
                            <p className="mt-1 font-medium text-foreground/95">
                                Cette action est irreversible.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="border-t border-border/45 bg-[hsl(var(--background)/0.18)] px-5 py-4">
                        <Button
                            variant="secondary"
                            onClick={() => setClearModalOpen(false)}
                            className="h-9 rounded-lg px-4"
                        >
                            Annuler
                        </Button>
                        <Button
                            onClick={handleClearCache}
                            variant="destructive"
                            className="h-9 gap-2 rounded-lg px-4"
                        >
                            <Trash2 className="h-4 w-4" />
                            Nettoyer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
