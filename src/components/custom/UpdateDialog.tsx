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
import { Download, ExternalLink } from 'lucide-react';

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
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        Mise à jour {updateInfo?.version}
                    </DialogTitle>
                    <DialogDescription>
                        Une nouvelle version est disponible
                    </DialogDescription>
                </DialogHeader>

                {updateInfo && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Version {updateInfo.version}</span>
                            <Badge variant="secondary">
                                {formatDate(updateInfo.pub_date)}
                            </Badge>
                        </div>

                        {updateInfo.notes && (
                            <div className="bg-muted p-3 rounded-md max-h-[300px] overflow-y-auto">
                                <pre className="text-sm whitespace-pre-wrap font-mono">
                                    {updateInfo.notes}
                                </pre>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="flex-col space-y-2 sm:flex-row sm:space-y-0">
                    {updateInfo && (
                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button
                                variant="outline"
                                onClick={onOpenGitHub}
                                className="flex items-center gap-2 flex-1 sm:flex-initial"
                            >
                                <ExternalLink className="h-4 w-4" />
                                GitHub
                            </Button>
                            <Button
                                onClick={onDownload}
                                className="flex items-center gap-2 flex-1 sm:flex-initial"
                            >
                                <Download className="h-4 w-4" />
                                Installer la mise à jour
                            </Button>
                        </div>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Fermer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
