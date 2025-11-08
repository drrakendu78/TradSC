import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

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
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
                className="flex w-full h-full flex-col gap-4 p-2 pr-3"
            >
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold">Patchnotes</h1>
                </div>
                <div className="flex items-center justify-center h-full">
                    <p className="text-muted-foreground">Chargement des patchnotes...</p>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
            className="flex w-full h-full flex-col gap-4 p-2 pr-3"
        >
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Patchnotes</h1>
            </div>
            <div className="space-y-4 max-h-[calc(100vh-130px)] overflow-y-auto pr-3">
                {releases.length === 0 ? (
                    <Card className="bg-background/40 p-4">
                <CardContent>
                            <p className="text-muted-foreground">Aucune release disponible.</p>
                </CardContent>
            </Card>
                ) : (
                    releases.map((release) => (
                        <Card key={release.tag_name} className="bg-background/40 p-4 rounded-lg shadow">
                            <h2 className="font-semibold text-lg text-primary">{release.name}</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                {new Date(release.published_at).toLocaleString('fr-FR')}
                            </p>
                            <div className="mt-2 whitespace-pre-line text-sm text-foreground">
                                {release.body}
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </motion.div>
    );
}


