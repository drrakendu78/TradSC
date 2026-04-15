import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import logger from "@/utils/logger";
import { toFriendlyFsError } from "@/utils/fs-permissions";
import openExternal from "@/utils/external";
import { Download, Heart, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { useStatsStore } from "@/stores/stats-store";

export function CharacterCard(
    { url, name, owner, downloads, likes, characterid, dnaurl }:
        { url: string, name: string, owner: string, downloads: number, likes: number, characterid: string, dnaurl: string }
) {
    const { toast } = useToast();
    const [isDownloading, setIsDownloading] = useState(false);
    const recordCharacterDownload = useStatsStore((state) => state.recordCharacterDownload);

    const openExternalLink = async (id: string) => {
        logger.log("Opening external link for character ID:", id);
        try {
            await openExternal(`https://www.star-citizen-characters.com/character/${id}`);
        } catch {
            window.open(`https://www.star-citizen-characters.com/character/${id}`, "_blank", "noopener,noreferrer");
        }
    };

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            const res = await invoke("download_character", { dnaUrl: dnaurl, title: name });
            if (res) {
                recordCharacterDownload();
                toast({
                    title: "Preset telecharge",
                    description: "Le preset a ete ajoute dans vos versions.",
                    variant: "success",
                    duration: 3000,
                });
            }
        } catch (error) {
            toast({
                title: "Erreur",
                description: toFriendlyFsError(error),
                variant: "destructive",
                duration: 4000,
            });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="group relative h-full overflow-hidden rounded-2xl border border-border/40 bg-[hsl(var(--background)/0.18)] shadow-[0_10px_22px_rgba(0,0,0,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_30px_rgba(0,0,0,0.22)]">
            <div className="absolute inset-0">
                <img
                    src={url}
                    alt={name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0.55)_50%,rgba(0,0,0,0.88)_100%)] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.44)_48%,rgba(0,0,0,0.82)_100%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(100%_70%_at_50%_0%,rgba(255,255,255,0.08)_0%,transparent_58%)]" />
            </div>

            <div className="absolute left-2.5 right-2.5 top-2.5 z-10 flex items-start justify-between gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); openExternalLink(characterid); }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white backdrop-blur-md transition-all duration-300 hover:border-white/50 hover:bg-black/60 hover:text-white"
                    title="Voir sur SC Characters"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </button>

                <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-black/45 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
                        <Download className="h-3 w-3" />
                        {downloads}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-black/45 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
                        <Heart className="h-3 w-3" />
                        {likes}
                    </span>
                </div>
            </div>

            <div className="absolute inset-x-2 bottom-2 z-10 rounded-xl border border-white/20 bg-black/50 px-2.5 py-2 backdrop-blur-md">
                <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="truncate text-[13px] font-semibold leading-tight tracking-tight text-white" title={name}>
                            {name}
                        </h3>
                        <p className="mt-0.5 truncate text-[10px] leading-tight text-white/80">
                            par {owner}
                        </p>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                        disabled={isDownloading}
                        title={isDownloading ? "Telechargement..." : "Telecharger"}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/20 text-white transition-colors hover:border-white/55 hover:bg-white/35 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isDownloading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Download className="h-3 w-3" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

