import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { HardDrive, Trash2, Archive } from 'lucide-react';
import {
    useDetectObsoleteCachesOnBoot,
    clearCacheFolders,
    acknowledgeMajorsFingerprint,
} from '@/hooks/useShaderCacheAutoClean';

/// Modale qui apparaît au boot si une nouvelle version *majeure* de SC a été
/// installée et qu'il y a des caches obsolètes à nettoyer.
/// L'user peut choisir de garder ou supprimer + cocher "ne plus me demander".
export function CacheCleanupPrompt() {
    const { detection, dismiss } = useDetectObsoleteCachesOnBoot();
    const { toast } = useToast();
    const [neverAsk, setNeverAsk] = useState(false);
    const [loading, setLoading] = useState(false);

    if (!detection) return null;

    const handleDelete = async () => {
        setLoading(true);
        try {
            // clearCacheFolders supprime + acknowledge la fingerprint courante.
            // Comportement : modal réapparaît à la prochaine major SC, peu importe
            // que la case soit cochée ou non (la sémantique de la case est juste
            // "acknowledge cette version" — la deletion + acknowledge revient au
            // même résultat).
            const result = await clearCacheFolders(detection.folders, detection.currentMajorsFingerprint);
            toast({
                title: 'Caches obsolètes supprimés',
                description: `${result.cleared.length} cache(s) (versions ${result.cleared.join(', ')}) — ${result.freedMb.toFixed(0)} Mo libérés.`,
            });
        } catch (e) {
            console.error('Erreur suppression caches:', e);
            toast({
                title: 'Erreur',
                description: "Impossible de supprimer certains caches.",
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
            dismiss();
        }
    };

    const handleKeep = () => {
        if (neverAsk) {
            acknowledgeMajorsFingerprint(detection.currentMajorsFingerprint);
        }
        dismiss();
    };

    const versions = detection.folders.map((f) => f.version).sort();
    const versionsLabel = versions.length === 1
        ? `version ${versions[0]}`
        : `versions ${versions.join(', ')}`;

    return (
        <Dialog open onOpenChange={(open) => { if (!open) handleKeep(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/30">
                        <HardDrive className="h-5 w-5 text-primary" />
                    </div>
                    <DialogTitle>Caches Star Citizen obsolètes détectés</DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Une nouvelle version majeure de Star Citizen a été installée. Les
                        anciens caches shaders ({versionsLabel}) ne sont plus utilisés et
                        peuvent être supprimés pour libérer de l'espace.
                    </DialogDescription>
                </DialogHeader>

                <div className="my-2 rounded-lg border border-border/50 bg-background/50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <Archive className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-foreground/90">
                                {detection.folders.length} dossier{detection.folders.length > 1 ? 's' : ''} de cache
                            </span>
                        </div>
                        <span className="font-mono text-sm font-semibold text-primary">
                            {detection.totalMb.toFixed(0)} Mo
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-1 py-1">
                    <Checkbox
                        id="never-ask"
                        checked={neverAsk}
                        onCheckedChange={(checked) => setNeverAsk(checked === true)}
                        disabled={loading}
                    />
                    <Label
                        htmlFor="never-ask"
                        className="cursor-pointer text-sm font-normal text-muted-foreground"
                    >
                        Ne plus me redemander pour cette version (modal réapparaîtra à la prochaine Alpha SC)
                    </Label>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        onClick={handleKeep}
                        disabled={loading}
                        className="flex-1"
                    >
                        Garder
                    </Button>
                    <Button
                        onClick={handleDelete}
                        disabled={loading}
                        className="flex-1 gap-2"
                    >
                        <Trash2 className="h-4 w-4" />
                        {loading ? 'Suppression…' : `Supprimer (${detection.totalMb.toFixed(0)} Mo)`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
