import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, FolderOpen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface VersionInfo {
    version: string;
    path: string;
}

interface PresetActionModalProps {
    open: boolean;
    onClose: () => void;
    characterName: string;
    versions: VersionInfo[];
    action: "delete" | "open";
    onConfirm: (selectedVersions: VersionInfo[]) => void;
}

export const PresetActionModal: React.FC<PresetActionModalProps> = ({
    open,
    onClose,
    characterName,
    versions,
    action,
    onConfirm,
}) => {
    const [selected, setSelected] = useState<string[]>([]);
    const isDelete = action === "delete";
    const availableCount = versions.filter((v) => Boolean(v.path)).length;

    const title = isDelete
        ? `Supprimer le preset "${characterName}"`
        : `Ouvrir le dossier du preset "${characterName}"`;

    const description = isDelete
        ? "Selectionnez les versions a supprimer."
        : "Selectionnez les versions dont vous voulez ouvrir le dossier.";

    React.useEffect(() => {
        setSelected([]);
    }, [open]);

    const handleToggle = (version: string) => {
        setSelected((prev) =>
            prev.includes(version)
                ? prev.filter((v) => v !== version)
                : [...prev, version],
        );
    };

    const handleConfirm = () => {
        const selectedVersions = versions.filter((v) => selected.includes(v.version));
        onConfirm(selectedVersions);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
        >
            <DialogContent
                className={cn(
                    "max-w-[560px] overflow-hidden p-0",
                    isDelete ? "border-red-500/35" : "border-primary/35",
                )}
            >
                <div
                    className={cn(
                        "relative border-b border-border/45 px-5 py-4",
                        isDelete
                            ? "bg-[linear-gradient(135deg,hsl(var(--destructive)/0.18),hsl(var(--background)/0.18))]"
                            : "bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.16))]",
                    )}
                >
                    <DialogHeader className="relative space-y-2 pr-10 text-left">
                        <div className="flex items-start gap-3">
                            <div
                                className={cn(
                                    "mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border",
                                    isDelete
                                        ? "border-red-500/40 bg-red-500/15 text-red-400"
                                        : "border-primary/45 bg-primary/12 text-primary",
                                )}
                            >
                                {isDelete ? <Trash2 className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 space-y-1">
                                <DialogTitle className="text-xl font-semibold tracking-tight">
                                    {title}
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground/92">
                                    {description}
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded-full border border-border/50 bg-background/25 px-2 py-0.5 text-muted-foreground/90">
                                {availableCount} version{availableCount > 1 ? "s" : ""} disponible{availableCount > 1 ? "s" : ""}
                            </span>
                            <span
                                className={cn(
                                    "rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.06em]",
                                    isDelete
                                        ? "border-red-500/45 bg-red-500/12 text-red-500 dark:text-red-300"
                                        : "border-primary/45 bg-primary/12 text-primary",
                                )}
                            >
                                {isDelete ? "Suppression" : "Ouverture"}
                            </span>
                        </div>
                    </DialogHeader>
                </div>

                <div className="space-y-2 px-5 py-4">
                    {versions.map((v) => {
                        const isSelected = selected.includes(v.version);
                        const isAvailable = Boolean(v.path);

                        return (
                            <label
                                key={v.version}
                                className={cn(
                                    "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                                    isAvailable
                                        ? "cursor-pointer border-border/45 bg-[hsl(var(--background)/0.22)] hover:border-primary/35 hover:bg-[hsl(var(--primary)/0.08)]"
                                        : "cursor-not-allowed border-border/30 bg-[hsl(var(--background)/0.16)] opacity-70",
                                    isSelected &&
                                        "border-primary/45 bg-[hsl(var(--primary)/0.12)] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]",
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => {
                                            if (!isAvailable) return;
                                            handleToggle(v.version);
                                        }}
                                        disabled={!isAvailable}
                                    />
                                    {isAvailable ? (
                                        <Check className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <X className="h-4 w-4 text-red-500" />
                                    )}
                                    <span className="font-medium text-foreground/95">{v.version}</span>
                                </div>

                                <span
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
                                        isAvailable
                                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                                            : "border-border/45 bg-background/30 text-muted-foreground",
                                    )}
                                >
                                    {isAvailable ? "Disponible" : "Absent"}
                                </span>
                            </label>
                        );
                    })}
                </div>

                <DialogFooter className="border-t border-border/45 bg-[hsl(var(--background)/0.18)] px-5 py-4">
                    <div className="mr-auto flex items-center text-[11px] text-muted-foreground/85">
                        {selected.length} selection{selected.length > 1 ? "s" : ""}
                    </div>
                    <Button variant="secondary" onClick={onClose} className="h-9 rounded-lg px-4">
                        Annuler
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={selected.length === 0}
                        variant={isDelete ? "destructive" : "default"}
                        className="h-9 gap-2 rounded-lg px-4"
                    >
                        {isDelete ? <Trash2 className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                        {isDelete ? "Supprimer" : "Ouvrir"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
