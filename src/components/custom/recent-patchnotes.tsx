import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

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
        return <Skeleton className="h-[160px] w-full" />;
    }

    const getFirstLine = (text: string): string => {
        if (!text) return "";
        const firstLine = text.split('\n')[0].trim();
        // Retirer les markdown headers (#, ##, etc.)
        return firstLine.replace(/^#+\s*/, '');
    };

    return (
        <div className="flex flex-col gap-3 flex-1">
            <ul className="space-y-3 flex-1">
                {releases.slice(0, max).map((release, idx) => (
                    <li key={release.tag_name || idx} className="text-sm">
                        <p className="font-medium">{getFirstLine(release.body) || release.name}</p>
                        <p className="text-xs text-muted-foreground">
                            {new Date(release.published_at).toLocaleString('fr-FR')}
                        </p>
                    </li>
                ))}
            </ul>
            <div className="mt-auto">
                <Link to="/patchnotes">
                    <Button variant="secondary" size="sm" className="hover:scale-[1.01] transition">Voir tous les patchnotes</Button>
                </Link>
            </div>
        </div>
    );
}


