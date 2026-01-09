import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Clock } from "lucide-react";

type Release = {
    name: string;
    body: string;
    published_at: string;
    tag_name: string;
};

export default function RecentPatchNotes({ max = 3 }: { max?: number }) {
    const [releases, setReleases] = useState<Release[] | null>(null);

    useEffect(() => {
        const fetchReleases = async () => {
            try {
                const response = await fetch("https://api.github.com/repos/drrakendu78/TradSC/releases");
                const data = await response.json();
                setReleases(data);
            } catch {
                setReleases([]);
            }
        };
        fetchReleases();
    }, []);

    if (releases === null) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
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
        <div className="space-y-2">
            {releases.slice(0, max).map((release, idx) => (
                <div
                    key={release.tag_name || idx}
                    className={`
                        relative p-3 rounded-lg border transition-all duration-200
                        ${idx === 0
                            ? 'bg-primary/10 border-primary/30 hover:border-primary/50'
                            : 'bg-muted/30 border-border/50 hover:border-border'
                        }
                    `}
                >
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <Badge
                                    variant={idx === 0 ? "default" : "secondary"}
                                    className="text-[10px] px-1.5 py-0 h-5"
                                >
                                    {release.tag_name}
                                </Badge>
                                {idx === 0 && (
                                    <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                                        <Sparkles className="h-3 w-3" />
                                        Nouveau
                                    </span>
                                )}
                            </div>
                            <p className="text-sm font-medium truncate">
                                {getFirstLine(release.body) || release.name}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                            <Clock className="h-3 w-3" />
                            {formatDate(release.published_at)}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
