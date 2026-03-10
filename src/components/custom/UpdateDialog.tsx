import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, ExternalLink } from 'lucide-react';

interface UpdateInfo {
    version: string;
    notes: string;
    pub_date: string;
}

interface UpdateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    updateInfo: UpdateInfo | null;
    onDownload: () => void;
    onOpenGitHub: () => void;
}

// Convertit le markdown inline (**bold**, `code`) en JSX
function InlineMd({ text }: { text: string }) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
    return (
        <>
            {parts.map((part) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={part}>{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('`') && part.endsWith('`')) {
                    return <code key={part} className="text-xs bg-muted px-1 py-0.5 rounded">{part.slice(1, -1)}</code>;
                }
                return <span key={part}>{part}</span>;
            })}
        </>
    );
}

// Parse le markdown GitHub en éléments React simples
// Coupe le contenu inutile (checksums, téléchargements, SmartScreen, MS Store)
function MarkdownNotes({ notes }: { notes: string }) {
    const excludeSections = [
        "checksums", "téléchargements", "télécharger", "smartscreen",
        "microsoft store", "note windows"
    ];

    const lines = notes.split("\n");
    const elements: JSX.Element[] = [];
    let skip = false;
    let listItems: string[] = [];
    let key = 0;

    const flushList = () => {
        if (listItems.length > 0) {
            elements.push(
                <ul key={key++} className="space-y-1 ml-1">
                    {listItems.map((item) => (
                        <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                            <span className="text-primary mt-0.5">•</span>
                            <InlineMd text={item} />
                        </li>
                    ))}
                </ul>
            );
            listItems = [];
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^#{1,3}\s/.test(trimmed)) {
            flushList();
            const titleText = trimmed.replace(/^#{1,3}\s+/, "").replace(/[🚀🔧🎮📥🔐⚠️🪟]\s*/g, "").trim().toLowerCase();
            skip = excludeSections.some(s => titleText.includes(s));
            if (skip) continue;

            if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) continue;

            const level = trimmed.startsWith("### ") ? "text-xs" : "text-sm";
            const title = trimmed.replace(/^#{2,3}\s+/, "").replace(/[🚀🔧🎮📥🔐⚠️🪟]\s*/g, "").trim();
            if (title) {
                elements.push(
                    <h3 key={key++} className={`font-semibold ${level} mt-2 first:mt-0`}>{title}</h3>
                );
            }
            continue;
        }

        if (skip) continue;
        if (!trimmed) { flushList(); continue; }

        if (trimmed.startsWith("```")) { skip = !skip; continue; }

        if (trimmed.startsWith("- ")) {
            listItems.push(trimmed.slice(2));
            continue;
        }

        flushList();
        if (trimmed.startsWith("<")) continue;
        elements.push(
            <p key={key++} className="text-sm text-muted-foreground"><InlineMd text={trimmed} /></p>
        );
    }
    flushList();
    return <>{elements}</>;
}

export function UpdateDialog({
    open,
    onOpenChange,
    updateInfo,
    onDownload,
    onOpenGitHub,
}: UpdateDialogProps) {
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        Mise à jour {updateInfo?.version}
                    </DialogTitle>
                    <DialogDescription>
                        Une nouvelle version est disponible
                    </DialogDescription>
                </DialogHeader>

                {updateInfo && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Version {updateInfo.version}</span>
                            <Badge variant="secondary">
                                {formatDate(updateInfo.pub_date)}
                            </Badge>
                        </div>

                        {updateInfo.notes && (
                            <div className="bg-muted/50 p-3 rounded-md max-h-[250px] overflow-y-auto space-y-2">
                                <MarkdownNotes notes={updateInfo.notes} />
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="flex-col space-y-2 sm:flex-row sm:space-y-0">
                    {updateInfo && (
                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button
                                variant="outline"
                                onClick={onOpenGitHub}
                                className="flex items-center gap-2 flex-1 sm:flex-initial"
                            >
                                <ExternalLink className="h-4 w-4" />
                                GitHub
                            </Button>
                            <Button
                                onClick={onDownload}
                                className="flex items-center gap-2 flex-1 sm:flex-initial"
                            >
                                <Download className="h-4 w-4" />
                                Installer la mise à jour
                            </Button>
                        </div>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Fermer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
