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
import { Download, ExternalLink, Sparkles, Calendar, Tag } from 'lucide-react';

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

function InlineMd({ text }: { text: string }) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i} className="text-foreground/95 font-semibold">{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('`') && part.endsWith('`')) {
                    return <code key={i} className="rounded-md border border-border/30 bg-background/40 px-1.5 py-0.5 text-[11px] font-mono text-primary/90">{part.slice(1, -1)}</code>;
                }
                return <span key={i}>{part}</span>;
            })}
        </>
    );
}

function MarkdownNotes({ notes }: { notes: string }) {
    const excludeSections = [
        "checksums", "téléchargements", "télécharger", "smartscreen",
        "microsoft store", "note windows"
    ];

    const lines = notes.split("\n");
    const elements: JSX.Element[] = [];
    let skip = false;
    let inCodeBlock = false;
    let listItems: string[] = [];
    let key = 0;

    const flushList = () => {
        if (listItems.length > 0) {
            elements.push(
                <ul key={key++} className="ml-1 space-y-1.5">
                    {listItems.map((item, i) => (
                        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                            <span className="min-w-0"><InlineMd text={item} /></span>
                        </li>
                    ))}
                </ul>
            );
            listItems = [];
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;

        if (/^#{1,3}\s/.test(trimmed)) {
            flushList();
            const titleText = trimmed.replace(/^#{1,3}\s+/, "").replace(/[🚀🔧🎮📥🔐⚠️🪟✨🎨🐛]\s*/g, "").trim().toLowerCase();
            skip = excludeSections.some(s => titleText.includes(s));
            if (skip) continue;

            if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) continue;

            const title = trimmed.replace(/^#{2,3}\s+/, "").replace(/[🚀🔧🎮📥🔐⚠️🪟✨🎨🐛]\s*/g, "").trim();
            if (title) {
                elements.push(
                    <h3 key={key++} className="mt-2.5 text-[12.5px] font-semibold tracking-tight text-foreground/90 first:mt-0">
                        {title}
                    </h3>
                );
            }
            continue;
        }

        if (skip) continue;
        if (!trimmed) { flushList(); continue; }

        if (trimmed.startsWith("- ")) {
            listItems.push(trimmed.slice(2));
            continue;
        }

        flushList();
        if (trimmed.startsWith("<")) continue;
        elements.push(
            <p key={key++} className="text-[12.5px] leading-relaxed text-muted-foreground">
                <InlineMd text={trimmed} />
            </p>
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
            <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

                <DialogHeader className="space-y-2.5 border-b border-border/20 px-5 pb-4 pt-5">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                            <Download className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <DialogTitle className="text-[1.05rem] font-semibold leading-none tracking-tight">
                                    Mise à jour disponible
                                </DialogTitle>
                                <Badge className="h-5 gap-1 rounded-md bg-primary/15 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/15">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    Nouveau
                                </Badge>
                            </div>
                            <DialogDescription className="mt-1 text-[12.5px] text-muted-foreground/90">
                                Une nouvelle version de StarTrad FR est prête à être installée.
                            </DialogDescription>
                        </div>
                    </div>

                    {updateInfo && (
                        <div className="flex items-center gap-2 pl-[3rem]">
                            <Badge variant="outline" className="h-6 gap-1 rounded-md border-border/40 bg-background/30 px-1.5 text-[10px] font-mono">
                                <Tag className="h-2.5 w-2.5" />
                                {updateInfo.version}
                            </Badge>
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                                <Calendar className="h-2.5 w-2.5" />
                                {formatDate(updateInfo.pub_date)}
                            </span>
                        </div>
                    )}
                </DialogHeader>

                {updateInfo?.notes && (
                    <div className="max-h-[280px] space-y-2 overflow-y-auto px-5 py-4">
                        <MarkdownNotes notes={updateInfo.notes} />
                    </div>
                )}

                <DialogFooter className="flex-col gap-2 border-t border-border/20 bg-[hsl(var(--background)/0.25)] px-5 py-3.5 backdrop-blur-sm sm:flex-row sm:justify-between sm:gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="h-9 rounded-lg text-[12.5px] text-muted-foreground hover:bg-background/40 hover:text-foreground"
                    >
                        Plus tard
                    </Button>
                    {updateInfo && (
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={onOpenGitHub}
                                className="h-9 gap-1.5 rounded-lg border-border/40 bg-background/30 text-[12.5px] backdrop-blur-sm hover:bg-background/50"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                GitHub
                            </Button>
                            <Button
                                onClick={onDownload}
                                className="h-9 gap-1.5 rounded-lg bg-primary text-[12.5px] font-semibold shadow-[0_4px_12px_rgba(var(--primary-rgb,88,101,242),0.25)] hover:bg-primary/90"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Installer
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
