import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Clock } from "lucide-react";

type Release = {
    name: string;
    body: string;
    published_at: string;
    tag_name: string;
};

const PATCHNOTES_CACHE_KEY = 'startradfr_patchnotes_releases';

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

function getCachedReleases(): Release[] | null {
    try {
        const cached = localStorage.getItem(PATCHNOTES_CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached) as unknown;
            if (!Array.isArray(parsed)) return null;
            return normalizeReleases(parsed);
        }
    } catch {}
    return null;
}

async function loadReleases(): Promise<Release[]> {
    const response = await fetch("https://api.github.com/repos/drrakendu78/TradSC/releases");
    if (!response.ok) {
        throw new Error(`GitHub releases request failed with status ${response.status}`);
    }

    const data = (await response.json()) as unknown;
    return normalizeReleases(data);
}

export default function RecentPatchNotes({ max = 3 }: { max?: number }) {
    const [releases, setReleases] = useState<Release[] | null>(getCachedReleases);

    useEffect(() => {
        loadReleases()
            .then((data) => {
                try { localStorage.setItem(PATCHNOTES_CACHE_KEY, JSON.stringify(data)); } catch {}
                setReleases(data);
            })
            .catch(() => setReleases((current) => current ?? []));
    }, []);

    if (releases === null) {
        return (
            <div className="space-y-1.5">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
            </div>
        );
    }

    const getFirstLine = (text: string): string => {
        if (!text) return "";
        const firstLine = text.split('\n')[0].trim();
        return firstLine.replace(/^#+\s*/, '');
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Aujourd'hui";
        if (diffDays === 1) return "Hier";
        if (diffDays < 7) return `Il y a ${diffDays} jours`;

        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short'
        });
    };

    return (
        <div className="space-y-1.5">
            {releases.slice(0, max).map((release, idx) => (
                <Link
                    key={release.tag_name || idx}
                    to="/patchnotes"
                    className={`
                        block relative rounded-lg border p-2.5 transition-all duration-200 cursor-pointer
                        ${idx === 0
                            ? 'bg-primary/10 border-primary/30 hover:border-primary/50 hover:bg-primary/15'
                            : 'bg-muted/30 border-border/50 hover:border-border hover:bg-muted/50'
                        }
                    `}
                >
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="mb-1 flex items-center gap-1.5">
                                <Badge
                                    variant={idx === 0 ? "default" : "secondary"}
                                    className="h-4 px-1.5 py-0 text-[9px]"
                                >
                                    {release.tag_name}
                                </Badge>
                                {idx === 0 && (
                                    <span className="flex items-center gap-1 text-[9px] text-primary font-medium">
                                        <Sparkles className="h-2.5 w-2.5" />
                                        Nouveau
                                    </span>
                                )}
                            </div>
                            <p className="truncate text-[13px] font-medium leading-tight">
                                {getFirstLine(release.body) || release.name}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDate(release.published_at)}
                        </div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
