import { useEffect, useReducer } from 'react';
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

type BackupState = {
    backups: BackupItem[];
    loading: boolean;
    saving: boolean;
    restoring: string | null;
    confirmRestore: BackupItem | null;
    confirmDelete: BackupItem | null;
    gamePaths: GamePaths | null;
    selectedVersion: string;
    restoreTargetVersion: string;
};
type BackupAction =
    | { type: 'SET_BACKUPS'; backups: BackupItem[] }
    | { type: 'SET_LOADING'; value: boolean }
    | { type: 'SET_SAVING'; value: boolean }
    | { type: 'SET_RESTORING'; value: string | null }
    | { type: 'SET_CONFIRM_RESTORE'; value: BackupItem | null }
    | { type: 'SET_CONFIRM_DELETE'; value: BackupItem | null }
    | { type: 'SET_GAME_PATHS'; paths: GamePaths; defaultVersion: string }
    | { type: 'SET_SELECTED_VERSION'; value: string }
    | { type: 'SET_RESTORE_TARGET'; value: string };

function backupReducer(state: BackupState, action: BackupAction): BackupState {
    switch (action.type) {
        case 'SET_BACKUPS': return { ...state, backups: action.backups, loading: false };
        case 'SET_LOADING': return { ...state, loading: action.value };
        case 'SET_SAVING': return { ...state, saving: action.value };
        case 'SET_RESTORING': return { ...state, restoring: action.value };
        case 'SET_CONFIRM_RESTORE': return { ...state, confirmRestore: action.value };
        case 'SET_CONFIRM_DELETE': return { ...state, confirmDelete: action.value };
        case 'SET_GAME_PATHS': return { ...state, gamePaths: action.paths, selectedVersion: action.defaultVersion };
        case 'SET_SELECTED_VERSION': return { ...state, selectedVersion: action.value };
        case 'SET_RESTORE_TARGET': return { ...state, restoreTargetVersion: action.value };
    }
}

export default function CloudBackupContent({ user }: CloudBackupContentProps) {
    const { toast } = useToast();
    const [{ backups, loading, saving, restoring, confirmRestore, confirmDelete, gamePaths, selectedVersion, restoreTargetVersion }, dispatch] = useReducer(backupReducer, {
        backups: [],
        loading: false,
        saving: false,
        restoring: null,
        confirmRestore: null,
        confirmDelete: null,
        gamePaths: null,
        selectedVersion: 'LIVE',
        restoreTargetVersion: 'LIVE',
    });

    useEffect(() => {
        loadBackups();
        loadGameVersions();
    }, [user]);

    const loadGameVersions = async () => {
        try {
            const versions = await invoke('get_star_citizen_versions');
            if (isGamePaths(versions)) {
                const defaultVersion = versions.versions['LIVE']
                    ? 'LIVE'
                    : (Object.keys(versions.versions)[0] ?? 'LIVE');
                dispatch({ type: 'SET_GAME_PATHS', paths: versions, defaultVersion });
            }
        } catch (error) {
            console.error('Erreur lors du chargement des versions:', error);
        }
    };

    const loadBackups = async () => {
        dispatch({ type: 'SET_LOADING', value: true });
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
            // Filtrer pour n'inclure que les vrais fichiers de backup (format: backup_VERSION_timestamp.zip)
            // Exclut les dossiers comme "preferences/" qui sont utilisés pour d'autres fonctionnalités
            const backupPattern = /^backup_(.+)_(\d{8}_\d{6})\.zip$/;

            const items: BackupItem[] = (parsed || [])
                .filter((item: any) => {
                    // Ne garder que les fichiers qui correspondent au pattern de backup
                    return item.name && backupPattern.test(item.name);
                })
                .map((item: any) => {
                    // Extraire la version du nom de fichier
                    const match = item.name.match(backupPattern);
                    const version = match ? match[1] : 'LIVE';

                    return {
                        name: item.name,
                        id: item.id,
                        created_at: item.created_at,
                        updated_at: item.updated_at,
                        last_accessed_at: item.last_accessed_at,
                        version: version,
                        metadata: item.metadata || { size: 0, mimetype: 'application/zip' },
                    };
                });

            // Trier par date de création (plus récent en premier)
            items.sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            dispatch({ type: 'SET_BACKUPS', backups: items });
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: `Impossible de charger les sauvegardes: ${error.message || error}`,
                variant: 'destructive',
            });
            dispatch({ type: 'SET_LOADING', value: false });
        }
    };

    const handleSave = async () => {
        dispatch({ type: 'SET_SAVING', value: true });
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
            dispatch({ type: 'SET_SAVING', value: false });
        }
    };

    const handleRestore = async (backup: BackupItem) => {
        dispatch({ type: 'SET_RESTORE_TARGET', value: backup.version || 'LIVE' });
        dispatch({ type: 'SET_CONFIRM_RESTORE', value: backup });
    };

    const confirmRestoreAction = async () => {
        if (!confirmRestore) return;

        const backup = confirmRestore;
        dispatch({ type: 'SET_CONFIRM_RESTORE', value: null });
        dispatch({ type: 'SET_RESTORING', value: backup.id });
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
            dispatch({ type: 'SET_RESTORING', value: null });
        }
    };

    const handleDelete = async (backup: BackupItem) => {
        dispatch({ type: 'SET_CONFIRM_DELETE', value: backup });
    };

    const confirmDeleteAction = async () => {
        if (!confirmDelete) return;

        const backup = confirmDelete;
        dispatch({ type: 'SET_CONFIRM_DELETE', value: null });

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
                            <Select value={selectedVersion} onValueChange={(v) => dispatch({ type: 'SET_SELECTED_VERSION', value: v })}>
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
            <Dialog open={confirmRestore !== null} onOpenChange={(open) => !open && dispatch({ type: 'SET_CONFIRM_RESTORE', value: null })}>
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
                                <Select value={restoreTargetVersion} onValueChange={(v) => dispatch({ type: 'SET_RESTORE_TARGET', value: v })}>
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
                        <Button variant="outline" onClick={() => dispatch({ type: 'SET_CONFIRM_RESTORE', value: null })}>
                            Annuler
                        </Button>
                        <Button variant="default" onClick={confirmRestoreAction}>
                            Restaurer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de confirmation pour la suppression */}
            <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && dispatch({ type: 'SET_CONFIRM_DELETE', value: null })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmer la suppression</DialogTitle>
                        <DialogDescription>
                            Êtes-vous sûr de vouloir supprimer cette sauvegarde ? Cette action est irréversible.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => dispatch({ type: 'SET_CONFIRM_DELETE', value: null })}>
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

