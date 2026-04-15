import { m } from "framer-motion";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Calendar, Tag, Sparkles, AlertCircle } from "lucide-react";

type Release = {
    name: string;
    body: string;
    published_at: string;
    tag_name: string;
};

function normalizeReleases(data: unknown): Release[] {
    if (!Array.isArray(data)) return [];

    return data.filter((item): item is Release => {
        if (!item || typeof item !== "object") return false;
        const release = item as Record<string, unknown>;
        return (
            typeof release.name === "string" &&
            typeof release.body === "string" &&
            typeof release.published_at === "string" &&
            typeof release.tag_name === "string"
        );
    });
}

async function loadReleases(): Promise<Release[]> {
    const res = await fetch("https://api.github.com/repos/drrakendu78/TradSC/releases");
    if (!res.ok) {
        throw new Error(`GitHub releases request failed with status ${res.status}`);
    }

    const data = (await res.json()) as unknown;
    return normalizeReleases(data);
}

// Parse le markdown GitHub (## headings, - listes, **bold**, `code`)
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

function MarkdownBody({ notes }: { notes: string }) {
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
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
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
                    <h3 key={key++} className="mt-3 text-[13px] font-semibold tracking-tight text-foreground/90 first:mt-0">
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
            <p key={key++} className="text-[13px] leading-relaxed text-muted-foreground">
                <InlineMd text={trimmed} />
            </p>
        );
    }
    flushList();
    return <>{elements}</>;
}

export default function PatchNotes() {
    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadReleases()
            .then((data) => { setReleases(data); setLoading(false); })
            .catch((err) => {
                console.error("Erreur lors du chargement des releases:", err);
                setError(err instanceof Error ? err.message : "Erreur de chargement");
                setLoading(false);
            });
    }, []);

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                {/* Header */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                                <FileText className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Patchnotes</h1>
                                    {releases.length > 0 && (
                                        <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                            {releases.length} version{releases.length > 1 ? "s" : ""}
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Historique des mises à jour de StarTrad FR</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" />
                </section>

                {loading ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Chargement des patchnotes...</p>
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center flex-1">
                        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] p-6 text-center backdrop-blur-md">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10">
                                <AlertCircle className="h-5 w-5 text-destructive" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">Impossible de charger les patchnotes</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : releases.length === 0 ? (
                    <div className="flex items-center justify-center flex-1">
                        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] p-6 text-center backdrop-blur-md">
                            <FileText className="h-8 w-8 text-muted-foreground/60" />
                            <p className="text-sm text-muted-foreground">Aucune release disponible.</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {releases.map((release, index) => (
                            <m.article
                                key={release.tag_name}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3) }}
                                className={`group relative overflow-hidden rounded-xl border backdrop-blur-md transition-all duration-200 ${
                                    index === 0
                                        ? 'border-primary/30 bg-[hsl(var(--primary)/0.06)] shadow-[0_8px_24px_rgba(0,0,0,0.15)]'
                                        : 'border-border/30 bg-[hsl(var(--background)/0.10)] hover:border-border/50'
                                }`}
                            >
                                {index === 0 && (
                                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
                                )}
                                <header className="flex items-start justify-between gap-3 border-b border-border/20 px-4 py-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-sm font-semibold tracking-tight text-foreground">
                                                {release.name || release.tag_name}
                                            </h2>
                                            {index === 0 && (
                                                <Badge className="h-5 gap-1 rounded-md bg-primary/15 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/15">
                                                    <Sparkles className="h-2.5 w-2.5" />
                                                    Dernière version
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                                            <span className="inline-flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(release.published_at).toLocaleDateString('fr-FR', {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric'
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="h-6 shrink-0 gap-1 rounded-md border-border/40 bg-background/30 px-1.5 text-[10px] font-mono">
                                        <Tag className="h-2.5 w-2.5" />
                                        {release.tag_name}
                                    </Badge>
                                </header>
                                <div className="space-y-2 px-4 py-3.5">
                                    <MarkdownBody notes={release.body} />
                                </div>
                            </m.article>
                        ))}
                    </div>
                )}
            </div>
        </m.div>
    );
}
