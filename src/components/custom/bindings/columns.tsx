import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { invokeDeleteWithToast } from "@/utils/invoke-helpers";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

type Binding = {
    name: string;
    path: string;
    source?: string;
    editable?: boolean;
};

interface BindingActionsCellProps {
    binding: Binding;
    toast: ReturnType<typeof useToast>["toast"];
    updateBindings: () => void;
}

function BindingActionsCell({ binding, toast, updateBindings }: BindingActionsCellProps) {
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const isProtected = binding.editable === false || binding.source === "Base Data.pak";

    const handleDelete = async () => {
        const deleted = await invokeDeleteWithToast(
            "delete_bindings_file",
            { filePath: binding.path },
            toast,
            `Le fichier ${binding.name}`,
            updateBindings
        );

        if (deleted) {
            setDeleteModalOpen(false);
        }
    };

    return (
        <div className="flex items-center gap-1.5">
            {isProtected ? (
                <span className="inline-flex h-7 items-center rounded-md border border-primary/25 bg-primary/8 px-2 text-xs text-primary/90">
                    Base protegee
                </span>
            ) : (
                <button
                    onClick={() => setDeleteModalOpen(true)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/8 px-2 text-xs text-red-600 transition-colors hover:border-red-500/45 hover:bg-red-500/16 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                    aria-label="Supprimer le fichier"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Supprimer</span>
                </button>
            )}

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
                                        Supprimer ce binding
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
                            <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Fichier</p>
                            <p className="mt-1 font-medium text-foreground/95">{binding.name}</p>
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
                            onClick={handleDelete}
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
        cell: ({ row }) => (
            <BindingActionsCell
                binding={row.original}
                toast={toast}
                updateBindings={updateBindings}
            />
        ),
    },
];
