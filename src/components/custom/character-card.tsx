import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import logger from "@/utils/logger";
import { toFriendlyFsError } from "@/utils/fs-permissions";
import openExternal from "@/utils/external";
import { Download, Heart, ExternalLink } from "lucide-react";
import { useState } from "react";

export function CharacterCard(
    { url, name, owner, downloads, likes, characterid, dnaurl }:
        { url: string, name: string, owner: string, downloads: number, likes: number, characterid: string, dnaurl: string }
) {
    const { toast } = useToast();
    const [isDownloading, setIsDownloading] = useState(false);

    const openExternalLink = async (id: string) => {
        logger.log("Opening external link for character ID:", id);
        await openExternal(`https://www.star-citizen-characters.com/character/${id}`);
    };

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            const res = await invoke("download_character", { dnaUrl: dnaurl, title: name });
            if (res) {
                toast({
                    title: "Preset téléchargé",
                    description: "Le preset a été ajouté dans vos versions.",
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
        <div className="group relative h-full rounded-xl overflow-hidden cursor-pointer">
            {/* Image de fond */}
            <div className="absolute inset-0">
                <img
                    src={url}
                    alt={name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            </div>

            {/* Stats en haut */}
            <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-10">
                <button
                    onClick={(e) => { e.stopPropagation(); openExternalLink(characterid); }}
                    className="p-2 rounded-full bg-white/10 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-white/20"
                    title="Voir sur SC Characters"
                >
                    <ExternalLink className="h-4 w-4" />
                </button>
                <div className="flex gap-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-white text-xs font-medium">
                        <Download className="h-3.5 w-3.5" />
                        {downloads}
                    </span>
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-white text-xs font-medium">
                        <Heart className="h-3.5 w-3.5" />
                        {likes}
                    </span>
                </div>
            </div>

            {/* Contenu en bas */}
            <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
                <h3 className="font-bold text-white text-lg truncate mb-1" title={name}>
                    {name}
                </h3>
                <p className="text-white/70 text-sm truncate mb-3">
                    par {owner}
                </p>
                
                {/* Bouton télécharger */}
                <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    disabled={isDownloading}
                    className="w-full py-2.5 px-4 rounded-lg bg-white/20 backdrop-blur-md text-white font-medium text-sm
                             hover:bg-white/30 active:scale-[0.98] transition-all duration-200
                             disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center justify-center gap-2"
                >
                    <Download className={`h-4 w-4 ${isDownloading ? 'animate-bounce' : ''}`} />
                    {isDownloading ? 'Téléchargement...' : 'Télécharger'}
                </button>
            </div>
        </div>
    );
}