import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase, MAX_BACKUPS } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import { GamePaths, isGamePaths } from '@/types/translation';
import { Download, Upload, Trash2, Loader2 } from 'lucide-react';

interface BackupItem {
    name: string;
    id: string;
    created_at: string;
    updated_at: string;
    last_accessed_at: string;
    version?: string; // Version extraite du nom de fichier
    metadata: {
        size: number;
        mimetype: string;
    };
}

interface CloudBackupContentProps {
    user: User;
}

export default function CloudBackupContent({ user }: CloudBackupContentProps) {
    const { toast } = useToast();
    const [backups, setBackups] = useState<BackupItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [restoring, setRestoring] = useState<string | null>(null);
    const [confirmRestore, setConfirmRestore] = useState<BackupItem | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<BackupItem | null>(null);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string>('LIVE');
    const [restoreTargetVersion, setRestoreTargetVersion] = useState<string>('LIVE');

    useEffect(() => {
        loadBackups();
        loadGameVersions();
    }, [user]);

    const loadGameVersions = async () => {
        try {
            const versions = await invoke('get_star_citizen_versions');
            if (isGamePaths(versions)) {
                setGamePaths(versions);
                // Sélectionner LIVE par défaut s'il existe, sinon la première version disponible
                if (versions.versions['LIVE']) {
                    setSelectedVersion('LIVE');
                } else {
                    const firstVersion = Object.keys(versions.versions)[0];
                    if (firstVersion) {
                        setSelectedVersion(firstVersion);
                    }
                }
            }
        } catch (error) {
            console.error('Erreur lors du chargement des versions:', error);
        }
    };

    const loadBackups = async () => {
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvée');
            }

            const result = await invoke<string>('list_user_backups', {
                userId: user.id,
                accessToken: session.access_token,
            });

            const parsed = JSON.parse(result);
            const items: BackupItem[] = parsed?.map((item: any) => {
                // Extraire la version du nom de fichier (format: backup_VERSION_timestamp.zip)
                // Le timestamp est toujours au format YYYYMMDD_HHMMSS (8 chiffres _ 6 chiffres)
                let version = 'LIVE'; // Par défaut
                const match = item.name.match(/backup_(.+)_(\d{8}_\d{6})\.zip/);
                if (match) {
                    version = match[1];
                }
                
                return {
                    name: item.name,
                    id: item.id,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                    last_accessed_at: item.last_accessed_at,
                    version: version,
                    metadata: item.metadata || { size: 0, mimetype: 'application/zip' },
                };
            }) || [];

            // Trier par date de création (plus récent en premier)
            items.sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            setBackups(items);
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: `Impossible de charger les sauvegardes: ${error.message || error}`,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvée');
            }

            // Créer le backup local
            toast({
                title: 'Création de la sauvegarde...',
                description: 'Compression du dossier user/ en cours',
            });

            const zipPath = await invoke<string>('create_user_backup', { version: selectedVersion });

            // Vérifier le nombre de sauvegardes existantes
            if (backups.length >= MAX_BACKUPS) {
                // Supprimer la plus ancienne
                const oldest = backups[backups.length - 1];
                try {
                    // S'assurer que le fileName contient le préfixe user_id/ si nécessaire
                    let fileName = oldest.name;
                    if (!fileName.startsWith(`${user.id}/`)) {
                        fileName = `${user.id}/${oldest.name}`;
                    }
                    
                    await invoke('delete_backup_from_supabase', {
                        fileName: fileName,
                        userId: user.id,
                        accessToken: session.access_token,
                    });
                } catch (error) {
                    console.error('Erreur lors de la suppression de l\'ancienne sauvegarde:', error);
                }
            }

            // Upload vers Supabase
            toast({
                title: 'Upload en cours...',
                description: 'Téléversement vers le cloud',
            });

            await invoke('upload_backup_to_supabase', {
                zipPath,
                userId: user.id,
                accessToken: session.access_token,
                version: selectedVersion,
            });

            toast({
                title: 'Sauvegarde réussie',
                description: 'Votre dossier user/ a été sauvegardé dans le cloud',
            });

            // Recharger la liste
            await loadBackups();
        } catch (error: any) {
            toast({
                title: 'Erreur de sauvegarde',
                description: error.message || 'Une erreur est survenue lors de la sauvegarde',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = async (backup: BackupItem) => {
        // Initialiser la version cible avec la version du backup
        setRestoreTargetVersion(backup.version || 'LIVE');
        setConfirmRestore(backup);
    };

    const confirmRestoreAction = async () => {
        if (!confirmRestore) return;

        const backup = confirmRestore;
        setConfirmRestore(null);
        setRestoring(backup.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvée');
            }

            toast({
                title: 'Téléchargement...',
                description: 'Récupération de la sauvegarde depuis le cloud',
            });

            // Télécharger le backup
            // S'assurer que le fileName contient le préfixe user_id/ si nécessaire
            let fileName = backup.name;
            if (!fileName.startsWith(`${user.id}/`)) {
                fileName = `${user.id}/${backup.name}`;
            }
            
            const localPath = await invoke<string>('download_backup_from_supabase', {
                fileName: fileName,
                userId: user.id,
                accessToken: session.access_token,
            });

            toast({
                title: 'Restauration...',
                description: 'Extraction et restauration du dossier user/',
            });

            // Restaurer le backup - utiliser la version cible sélectionnée par l'utilisateur
            await invoke('restore_backup', { zipPath: localPath, version: restoreTargetVersion });

            toast({
                title: 'Restauration réussie',
                description: 'Votre dossier user/ a été restauré avec succès',
            });
        } catch (error: any) {
            console.error('Erreur de restauration:', error);
            const errorMessage = error?.message || error?.toString() || 'Une erreur est survenue lors de la restauration';
            toast({
                title: 'Erreur de restauration',
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setRestoring(null);
        }
    };

    const handleDelete = async (backup: BackupItem) => {
        setConfirmDelete(backup);
    };

    const confirmDeleteAction = async () => {
        if (!confirmDelete) return;

        const backup = confirmDelete;
        setConfirmDelete(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvée');
            }

            // S'assurer que le fileName contient le préfixe user_id/ si nécessaire
            let fileName = backup.name;
            if (!fileName.startsWith(`${user.id}/`)) {
                fileName = `${user.id}/${backup.name}`;
            }

            await invoke('delete_backup_from_supabase', {
                fileName: fileName,
                userId: user.id,
                accessToken: session.access_token,
            });

            toast({
                title: 'Sauvegarde supprimée',
                description: 'La sauvegarde a été supprimée avec succès',
            });

            // Recharger la liste
            await loadBackups();
        } catch (error: any) {
            toast({
                title: 'Erreur de suppression',
                description: error.message || 'Une erreur est survenue lors de la suppression',
                variant: 'destructive',
            });
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const availableVersions = gamePaths ? Object.keys(gamePaths.versions).sort() : [];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold">Mes sauvegardes</h3>
                    <p className="text-sm text-muted-foreground">
                        {backups.length}/{MAX_BACKUPS} sauvegardes
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Sauvegarde cloud de votre dossier user/ contenant vos préférences, paramètres, bindings, personnages personnalisés, etc.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {availableVersions.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="version-select" className="text-xs text-muted-foreground">
                                Version
                            </Label>
                            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                                <SelectTrigger id="version-select" className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableVersions.map((version) => (
                                        <SelectItem key={version} value={version}>
                                            {version}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <Button
                        onClick={handleSave}
                        disabled={saving || loading || availableVersions.length === 0}
                        className="flex items-center gap-2"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Sauvegarde...
                            </>
                        ) : (
                            <>
                                <Upload className="h-4 w-4" />
                                Sauvegarder maintenant
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : backups.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                        <p>Aucune sauvegarde pour le moment</p>
                        <p className="text-sm mt-2">Cliquez sur "Sauvegarder maintenant" pour créer votre première sauvegarde</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {backups.map((backup) => (
                        <Card key={backup.id}>
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <CardTitle className="text-base">
                                            Sauvegarde du {formatDate(backup.created_at)}
                                        </CardTitle>
                                        <CardDescription>
                                            {formatSize(backup.metadata.size)} • Créée le {formatDate(backup.created_at)}
                                            {backup.version && ` • Version: ${backup.version}`}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRestore(backup)}
                                            disabled={restoring === backup.id}
                                            className="flex items-center gap-2"
                                        >
                                            {restoring === backup.id ? (
                                                <>
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                    Restauration...
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="h-3 w-3" />
                                                    Restaurer
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(backup)}
                                            className="flex items-center gap-2 text-destructive hover:text-destructive"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            )}

            {/* Dialog de confirmation pour la restauration */}
            <Dialog open={confirmRestore !== null} onOpenChange={(open) => !open && setConfirmRestore(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmer la restauration</DialogTitle>
                        <DialogDescription>
                            Êtes-vous sûr de vouloir restaurer cette sauvegarde ? Cela remplacera votre dossier user/ actuel.
                        </DialogDescription>
                    </DialogHeader>
                    {confirmRestore && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="restore-version">Version de destination</Label>
                                <Select value={restoreTargetVersion} onValueChange={setRestoreTargetVersion}>
                                    <SelectTrigger id="restore-version">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableVersions.map((version) => (
                                            <SelectItem key={version} value={version}>
                                                {version}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Sauvegarde d'origine : {confirmRestore.version || 'LIVE'}
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmRestore(null)}>
                            Annuler
                        </Button>
                        <Button variant="default" onClick={confirmRestoreAction}>
                            Restaurer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de confirmation pour la suppression */}
            <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmer la suppression</DialogTitle>
                        <DialogDescription>
                            Êtes-vous sûr de vouloir supprimer cette sauvegarde ? Cette action est irréversible.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                            Annuler
                        </Button>
                        <Button variant="destructive" onClick={confirmDeleteAction}>
                            Supprimer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

