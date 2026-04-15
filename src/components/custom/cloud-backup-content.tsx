import { useEffect, useReducer } from 'react';
import { Button } from '@/components/ui/button';
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
import { Database, Clock3, Download, HardDrive, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react';

interface BackupItem {
    name: string;
    id: string;
    created_at: string;
    updated_at: string;
    last_accessed_at: string;
    version?: string;
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
        case 'SET_BACKUPS':
            return { ...state, backups: action.backups, loading: false };
        case 'SET_LOADING':
            return { ...state, loading: action.value };
        case 'SET_SAVING':
            return { ...state, saving: action.value };
        case 'SET_RESTORING':
            return { ...state, restoring: action.value };
        case 'SET_CONFIRM_RESTORE':
            return { ...state, confirmRestore: action.value };
        case 'SET_CONFIRM_DELETE':
            return { ...state, confirmDelete: action.value };
        case 'SET_GAME_PATHS':
            return { ...state, gamePaths: action.paths, selectedVersion: action.defaultVersion };
        case 'SET_SELECTED_VERSION':
            return { ...state, selectedVersion: action.value };
        case 'SET_RESTORE_TARGET':
            return { ...state, restoreTargetVersion: action.value };
        default:
            return state;
    }
}

export default function CloudBackupContent({ user }: CloudBackupContentProps) {
    const { toast } = useToast();
    const [
        {
            backups,
            loading,
            saving,
            restoring,
            confirmRestore,
            confirmDelete,
            gamePaths,
            selectedVersion,
            restoreTargetVersion,
        },
        dispatch,
    ] = useReducer(backupReducer, {
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
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvee');
            }

            const result = await invoke<string>('list_user_backups', {
                userId: user.id,
                accessToken: session.access_token,
            });

            const parsed = JSON.parse(result);
            const backupPattern = /^backup_(.+)_(\d{8}_\d{6})\.zip$/;

            const items: BackupItem[] = (parsed || [])
                .filter((item: any) => item.name && backupPattern.test(item.name))
                .map((item: any) => {
                    const match = item.name.match(backupPattern);
                    const version = match ? match[1] : 'LIVE';

                    return {
                        name: item.name,
                        id: item.id,
                        created_at: item.created_at,
                        updated_at: item.updated_at,
                        last_accessed_at: item.last_accessed_at,
                        version,
                        metadata: item.metadata || { size: 0, mimetype: 'application/zip' },
                    };
                });

            items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvee');
            }

            toast({
                title: 'Creation de la sauvegarde...',
                description: 'Compression du dossier user/ en cours',
            });

            const zipPath = await invoke<string>('create_user_backup', { version: selectedVersion });

            if (backups.length >= MAX_BACKUPS) {
                const oldest = backups[backups.length - 1];
                try {
                    let fileName = oldest.name;
                    if (!fileName.startsWith(`${user.id}/`)) {
                        fileName = `${user.id}/${oldest.name}`;
                    }

                    await invoke('delete_backup_from_supabase', {
                        fileName,
                        userId: user.id,
                        accessToken: session.access_token,
                    });
                } catch (error) {
                    console.error('Erreur lors de la suppression de l ancienne sauvegarde:', error);
                }
            }

            toast({
                title: 'Upload en cours...',
                description: 'Televersement vers le cloud',
            });

            await invoke('upload_backup_to_supabase', {
                zipPath,
                userId: user.id,
                accessToken: session.access_token,
                version: selectedVersion,
            });

            toast({
                title: 'Sauvegarde reussie',
                description: 'Votre dossier user/ a ete sauvegarde dans le cloud',
            });

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
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvee');
            }

            toast({
                title: 'Telechargement...',
                description: 'Recuperation de la sauvegarde depuis le cloud',
            });

            let fileName = backup.name;
            if (!fileName.startsWith(`${user.id}/`)) {
                fileName = `${user.id}/${backup.name}`;
            }

            const localPath = await invoke<string>('download_backup_from_supabase', {
                fileName,
                userId: user.id,
                accessToken: session.access_token,
            });

            toast({
                title: 'Restauration...',
                description: 'Extraction et restauration du dossier user/',
            });

            await invoke('restore_backup', { zipPath: localPath, version: restoreTargetVersion });

            toast({
                title: 'Restauration reussie',
                description: 'Votre dossier user/ a ete restaure avec succes',
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
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvee');
            }

            let fileName = backup.name;
            if (!fileName.startsWith(`${user.id}/`)) {
                fileName = `${user.id}/${backup.name}`;
            }

            await invoke('delete_backup_from_supabase', {
                fileName,
                userId: user.id,
                accessToken: session.access_token,
            });

            toast({
                title: 'Sauvegarde supprimee',
                description: 'La sauvegarde a ete supprimee avec succes',
            });

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
    const panelClass =
        'rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.34)] p-4 shadow-[0_14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl';
    const rowClass =
        'group rounded-xl border border-border/45 bg-[hsl(var(--background)/0.24)] px-3 py-3 transition-all duration-200 hover:border-primary/40 hover:bg-[hsl(var(--background)/0.32)]';

    return (
        <div className="space-y-3">
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-4 shadow-[0_14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,hsl(var(--primary)/0.16),transparent_60%),radial-gradient(100%_80%_at_0%_100%,hsl(var(--primary)/0.08),transparent_60%)]" />
                <div className="relative flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                    <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">Sauvegarde cloud</p>
                        <h3 className="text-lg font-semibold tracking-tight">Mes sauvegardes user/</h3>
                        <p className="max-w-[720px] text-sm text-muted-foreground">
                            Sauvegarde cloud de votre dossier user/ contenant vos preferences, parametres, bindings et personnages personnalises.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/45 px-2.5 py-1 text-[11px] font-medium">
                                <Database className="h-3.5 w-3.5 text-primary" />
                                {backups.length}/{MAX_BACKUPS} sauvegardes
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/45 px-2.5 py-1 text-[11px] font-medium">
                                <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                                Limite {MAX_BACKUPS}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/45 px-2.5 py-1 text-[11px] font-medium">
                                <ShieldCheck className="h-3.5 w-3.5 text-indigo-300" />
                                Restauration multi-version
                            </span>
                        </div>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="version-select" className="text-[11px] font-medium text-muted-foreground">
                                Version cible (backup)
                            </Label>
                            <Select value={selectedVersion} onValueChange={(v) => dispatch({ type: 'SET_SELECTED_VERSION', value: v })}>
                                <SelectTrigger id="version-select" className="w-full min-w-[160px] sm:w-[180px]">
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
                        <Button
                            onClick={handleSave}
                            disabled={saving || loading || availableVersions.length === 0}
                            className="h-10 min-w-[180px] gap-2"
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
            </section>

            {loading ? (
                <section className={`${panelClass} flex items-center justify-center py-10`}>
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </section>
            ) : backups.length === 0 ? (
                <section className={`${panelClass} py-8 text-center`}>
                    <p className="text-sm font-medium">Aucune sauvegarde pour le moment</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Cliquez sur "Sauvegarder maintenant" pour creer votre premiere sauvegarde.
                    </p>
                </section>
            ) : (
                <div className="space-y-2">
                    {backups.map((backup) => (
                        <article key={backup.id} className={rowClass}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold tracking-tight">Sauvegarde du {formatDate(backup.created_at)}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/45 px-2 py-0.5">
                                            <HardDrive className="h-3 w-3" />
                                            {formatSize(backup.metadata.size)}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/45 px-2 py-0.5">
                                            <Clock3 className="h-3 w-3" />
                                            {formatDate(backup.created_at)}
                                        </span>
                                        {backup.version && (
                                            <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-primary">
                                                Version {backup.version}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRestore(backup)}
                                        disabled={restoring === backup.id}
                                        className="h-8 gap-2 border-border/60 bg-background/60"
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
                                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            )}

            <Dialog open={confirmRestore !== null} onOpenChange={(open) => !open && dispatch({ type: 'SET_CONFIRM_RESTORE', value: null })}>
                <DialogContent
                    overlayClassName="bg-transparent"
                    className="border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                >
                    <DialogHeader>
                        <DialogTitle>Confirmer la restauration</DialogTitle>
                        <DialogDescription>
                            Etes-vous sur de vouloir restaurer cette sauvegarde ? Cela remplacera votre dossier user/ actuel.
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
                                <p className="text-xs text-muted-foreground">Sauvegarde d origine : {confirmRestore.version || 'LIVE'}</p>
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

            <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && dispatch({ type: 'SET_CONFIRM_DELETE', value: null })}>
                <DialogContent
                    overlayClassName="bg-transparent"
                    className="border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                >
                    <DialogHeader>
                        <DialogTitle>Confirmer la suppression</DialogTitle>
                        <DialogDescription>Etes-vous sur de vouloir supprimer cette sauvegarde ? Cette action est irreversible.</DialogDescription>
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
