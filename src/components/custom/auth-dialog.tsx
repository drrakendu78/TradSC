import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import CloudBackupContent from './cloud-backup-content';
import { MessageCircle, User as UserIcon, Save, LogIn, Camera, RotateCcw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useAvatar } from '@/hooks/useAvatar';

interface AuthDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultTab?: string;
}

export default function AuthDialog({ open, onOpenChange, defaultTab }: AuthDialogProps) {
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(false);
    const [discordLoading, setDiscordLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [activeTab, setActiveTab] = useState(defaultTab || 'login');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const { avatarUrl, isCustom, setCustomAvatar, resetAvatar } = useAvatar(user);

    // Réinitialiser l'onglet quand le dialog s'ouvre
    useEffect(() => {
        if (open) {
            if (user) {
                setActiveTab('backup');
            } else {
                setActiveTab(defaultTab || 'login');
            }
        }
    }, [open, defaultTab]);

    // S'assurer que l'onglet backup est sélectionné quand l'utilisateur se connecte
    useEffect(() => {
        if (user && open) {
            setActiveTab('backup');
        }
    }, [user, open]);

    useEffect(() => {
        checkSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null);

            if (event === 'SIGNED_IN' && session?.user) {
                setActiveTab('backup');

                if (discordLoading) {
                    setDiscordLoading(false);
                    toast({
                        title: 'Connexion réussie',
                        description: 'Vous êtes maintenant connecté avec Discord',
                    });
                }
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [discordLoading, toast]);

    const checkSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
        } catch (error) {
            console.error('Erreur lors de la vérification de la session:', error);
        }
    };

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
            });

            if (error) throw error;

            if (data.user) {
                toast({
                    title: 'Inscription réussie',
                    description: 'Votre compte a été créé avec succès',
                });
                setUser(data.user);
                setActiveTab('backup');
            }
        } catch (error: any) {
            console.error('Erreur d\'inscription:', error);
            let errorMessage = 'Une erreur est survenue';
            if (error.message) {
                errorMessage = error.message;
            }
            toast({
                title: 'Erreur d\'inscription',
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            if (data.user) {
                toast({
                    title: 'Connexion réussie',
                    description: 'Vous êtes maintenant connecté',
                });
                setUser(data.user);
                setActiveTab('backup');
            }
        } catch (error: any) {
            console.error('Erreur de connexion:', error);
            let errorMessage = 'Email ou mot de passe incorrect';
            if (error.message) {
                errorMessage = error.message;
            }
            if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Erreur de connexion au serveur. Vérifiez votre connexion internet.';
            }
            toast({
                title: 'Erreur de connexion',
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDiscordSignIn = async () => {
        setDiscordLoading(true);
        let unlisten: UnlistenFn | null = null;

        try {
            // Écouter l'événement oauth-callback AVANT de démarrer le serveur
            unlisten = await listen<string>('oauth-callback', async (event) => {
                try {
                    const params = new URLSearchParams(event.payload);
                    const accessToken = params.get('access_token');
                    const refreshToken = params.get('refresh_token');
                    const code = params.get('code');

                    if (accessToken) {
                        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken || '',
                        });

                        if (sessionError) throw sessionError;

                        if (sessionData?.session) {
                            setUser(sessionData.session.user);
                            setDiscordLoading(false);
                            setActiveTab('backup');
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    } else if (code) {
                        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

                        if (sessionError) throw sessionError;

                        if (sessionData?.session) {
                            setUser(sessionData.session.user);
                            setDiscordLoading(false);
                            setActiveTab('backup');
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    }
                } catch (err: any) {
                    console.error('Erreur traitement callback:', err);
                    setDiscordLoading(false);
                    toast({
                        title: 'Erreur de connexion',
                        description: err.message || 'Impossible de créer la session',
                        variant: 'destructive',
                    });
                }

                if (unlisten) unlisten();
            });

            // Écouter les erreurs OAuth
            await listen<string>('oauth-error', (event) => {
                console.error('Erreur OAuth:', event.payload);
                setDiscordLoading(false);
                toast({
                    title: 'Erreur d\'authentification',
                    description: event.payload,
                    variant: 'destructive',
                });
                if (unlisten) unlisten();
            });

            // Démarrer le serveur OAuth local
            invoke('start_oauth_server').catch((err) => {
                console.warn('Serveur OAuth:', err);
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            const redirectUrl = 'http://localhost:1421/auth/callback';

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'discord',
                options: {
                    redirectTo: redirectUrl,
                    skipBrowserRedirect: true,
                },
            });

            if (error) throw error;

            if (data.url) {
                await invoke('open_external', { url: data.url });

                toast({
                    title: 'Authentification Discord',
                    description: 'Veuillez autoriser l\'application dans votre navigateur. La connexion sera automatique.',
                    duration: 10000,
                });
            }
        } catch (error: any) {
            console.error('Erreur de connexion Discord:', error);
            setDiscordLoading(false);
            if (unlisten) unlisten();
            toast({
                title: 'Erreur de connexion Discord',
                description: error.message || 'Une erreur est survenue',
                variant: 'destructive',
            });
        }
    };

    const handleSignOut = async () => {
        setLoading(true);
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            setUser(null);
            setEmail('');
            setPassword('');
            setActiveTab('login');
            toast({
                title: 'Déconnexion réussie',
                description: 'Vous avez été déconnecté',
            });
        } catch (error: any) {
            toast({
                title: 'Erreur de déconnexion',
                description: error.message || 'Une erreur est survenue',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeleteLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Session non trouvée');
            }

            const response = await fetch(
                'https://rronicslgyoubiofbinu.supabase.co/functions/v1/delete-account',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Erreur lors de la suppression');
            }

            await supabase.auth.signOut();
            setUser(null);
            setShowDeleteConfirm(false);
            onOpenChange(false);

            toast({
                title: 'Compte supprimé',
                description: 'Votre compte et vos données ont été supprimés définitivement.',
            });
        } catch (error: any) {
            console.error('Erreur suppression compte:', error);
            toast({
                title: 'Erreur',
                description: error.message || 'Impossible de supprimer le compte',
                variant: 'destructive',
            });
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {user ? 'Sauvegarde Cloud' : 'Authentification'}
                    </DialogTitle>
                    <DialogDescription>
                        {user
                            ? 'Gérez vos sauvegardes cloud'
                            : 'Connectez-vous ou créez un compte pour sauvegarder vos données'}
                    </DialogDescription>
                </DialogHeader>

                {user ? (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="backup" className="gap-2">
                                <Save className="h-4 w-4" />
                                Mes sauvegardes
                            </TabsTrigger>
                            <TabsTrigger value="account" className="gap-2">
                                <UserIcon className="h-4 w-4" />
                                Mon compte
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="backup" className="mt-6">
                            <CloudBackupContent user={user} />
                        </TabsContent>
                        <TabsContent value="account" className="mt-6 space-y-4">
                            <div className="flex flex-col items-center gap-2">
                                <div className="relative group">
                                    {avatarUrl ? (
                                        <img
                                            src={avatarUrl}
                                            alt="Avatar"
                                            className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/30"
                                        />
                                    ) : (
                                        <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30">
                                            <UserIcon className="h-8 w-8 text-primary" />
                                        </div>
                                    )}
                                    <button
                                        onClick={async () => {
                                            const file = await openFileDialog({
                                                title: 'Choisir une photo de profil',
                                                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                                            });
                                            if (file) {
                                                try {
                                                    await setCustomAvatar(file);
                                                    toast({ title: 'Photo mise à jour' });
                                                } catch {
                                                    toast({ title: 'Erreur', description: 'Impossible de changer la photo', variant: 'destructive' });
                                                }
                                            }
                                        }}
                                        className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                                        title="Changer la photo"
                                    >
                                        <Camera className="h-6 w-6 text-white" />
                                    </button>
                                </div>
                                {isCustom && (
                                    <button
                                        onClick={async () => {
                                            await resetAvatar();
                                            toast({ title: 'Photo réinitialisée' });
                                        }}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                    >
                                        <RotateCcw className="h-3 w-3" />
                                        Revenir à Discord
                                    </button>
                                )}
                            </div>
                            {user.user_metadata?.full_name || user.user_metadata?.name ? (
                                <div className="space-y-2">
                                    <Label>Nom</Label>
                                    <Input
                                        value={user.user_metadata?.full_name || user.user_metadata?.name || 'Non défini'}
                                        disabled
                                    />
                                </div>
                            ) : null}
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input value={user.email || ''} disabled />
                            </div>
                            {user.user_metadata?.preferred_username && (
                                <div className="space-y-2">
                                    <Label>Nom d'utilisateur Discord</Label>
                                    <Input value={user.user_metadata.preferred_username} disabled />
                                </div>
                            )}
                            <Button
                                onClick={handleSignOut}
                                variant="destructive"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? 'Déconnexion...' : 'Se déconnecter'}
                            </Button>

                            {/* Section suppression de compte */}
                            <div className="pt-6 border-t border-destructive/20">
                                <div className="space-y-3">
                                    <h4 className="text-sm font-medium text-destructive">Zone de danger</h4>
                                    {!showDeleteConfirm ? (
                                        <Button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            variant="outline"
                                            className="w-full border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                        >
                                            Supprimer mon compte
                                        </Button>
                                    ) : (
                                        <div className="space-y-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                                            <p className="text-sm text-destructive font-medium">
                                                Cette action est irréversible !
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Toutes vos données et sauvegardes seront définitivement supprimées.
                                            </p>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => setShowDeleteConfirm(false)}
                                                    variant="outline"
                                                    className="flex-1"
                                                    disabled={deleteLoading}
                                                >
                                                    Annuler
                                                </Button>
                                                <Button
                                                    onClick={handleDeleteAccount}
                                                    variant="destructive"
                                                    className="flex-1"
                                                    disabled={deleteLoading}
                                                >
                                                    {deleteLoading ? 'Suppression...' : 'Confirmer'}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="login" className="gap-2">
                                <LogIn className="h-4 w-4" />
                                Connexion
                            </TabsTrigger>
                            <TabsTrigger value="signup" className="gap-2">
                                <UserIcon className="h-4 w-4" />
                                Inscription
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="login" className="mt-4 space-y-4">
                            <form onSubmit={handleSignIn} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="login-email">Email</Label>
                                    <Input
                                        id="login-email"
                                        type="email"
                                        placeholder="votre@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        disabled={loading || discordLoading}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="login-password">Mot de passe</Label>
                                    <Input
                                        id="login-password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        disabled={loading || discordLoading}
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={loading || discordLoading}>
                                    {loading ? 'Connexion...' : 'Se connecter'}
                                </Button>
                            </form>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">
                                        Ou continuer avec
                                    </span>
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                onClick={handleDiscordSignIn}
                                disabled={loading || discordLoading}
                            >
                                <MessageCircle className="mr-2 h-4 w-4" />
                                {discordLoading ? 'Connexion en cours...' : 'Se connecter avec Discord'}
                            </Button>
                        </TabsContent>
                        <TabsContent value="signup" className="mt-4 space-y-4">
                            <form onSubmit={handleSignUp} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="signup-email">Email</Label>
                                    <Input
                                        id="signup-email"
                                        type="email"
                                        placeholder="votre@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        disabled={loading || discordLoading}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="signup-password">Mot de passe</Label>
                                    <Input
                                        id="signup-password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        disabled={loading || discordLoading}
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={loading || discordLoading}>
                                    {loading ? 'Inscription...' : 'S\'inscrire'}
                                </Button>
                            </form>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">
                                        Ou continuer avec
                                    </span>
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                onClick={handleDiscordSignIn}
                                disabled={loading || discordLoading}
                            >
                                <MessageCircle className="mr-2 h-4 w-4" />
                                {discordLoading ? 'Connexion en cours...' : 'S\'inscrire avec Discord'}
                            </Button>
                        </TabsContent>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}
