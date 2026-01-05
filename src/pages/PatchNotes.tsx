import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Calendar, Tag } from "lucide-react";

type Release = {
    name: string;
    body: string;
    published_at: string;
    tag_name: string;
};

export default function PatchNotes() {
    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("https://api.github.com/repos/drrakendu78/TradSC/releases")
            .then((res) => res.json())
            .then((data) => {
                setReleases(data);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Erreur lors du chargement des releases:", error);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="flex flex-col w-full h-full p-4"
            >
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-green-500/10">
                        <FileText className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Patchnotes</h1>
                        <p className="text-sm text-muted-foreground">Historique des mises à jour</p>
                    </div>
                </div>
                <div className="flex flex-col items-center justify-center flex-1 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-muted-foreground">Chargement des patchnotes...</p>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                        <FileText className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Patchnotes</h1>
                        <p className="text-sm text-muted-foreground">Historique des mises à jour de StarTrad FR</p>
                    </div>
                </div>

                {/* Content */}
                <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                    {releases.length === 0 ? (
                        <Card className="bg-muted/30">
                            <CardContent className="py-8 text-center">
                                <p className="text-muted-foreground">Aucune release disponible.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        releases.map((release, index) => (
                            <motion.div
                                key={release.tag_name}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                            >
                                <Card className="bg-background/40 border border-border/50 shadow-sm hover:shadow-md transition-shadow duration-200">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-start justify-between gap-4">
                                            <CardTitle className="text-lg text-primary">{release.name}</CardTitle>
                                            <Badge variant="outline" className="gap-1 shrink-0">
                                                <Tag className="h-3 w-3" />
                                                {release.tag_name}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Calendar className="h-3 w-3" />
                                            {new Date(release.published_at).toLocaleDateString('fr-FR', {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric'
                                            })}
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="whitespace-pre-line text-sm text-muted-foreground leading-relaxed">
                                            {release.body}
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>
        </motion.div>
    );
}


