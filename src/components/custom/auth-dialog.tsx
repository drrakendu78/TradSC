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
import { MessageCircle, User as UserIcon, Save, LogIn } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

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
    const [showCallbackInput, setShowCallbackInput] = useState(false);
    const [callbackUrl, setCallbackUrl] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [activeTab, setActiveTab] = useState(defaultTab || 'login');

    // Réinitialiser l'onglet quand le dialog s'ouvre
    useEffect(() => {
        if (open) {
            if (user) {
                setActiveTab(defaultTab || 'backup');
            } else {
                setActiveTab(defaultTab || 'login');
            }
        }
    }, [open, user, defaultTab]);

    useEffect(() => {
        // Vérifier la session actuelle
        checkSession();

        // Écouter les changements d'authentification
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            console.log('Auth state changed:', event, session?.user?.email);
            setUser(session?.user ?? null);
            
            // Si on détecte une connexion, basculer vers l'onglet backup
            if (event === 'SIGNED_IN' && session?.user) {
                setActiveTab('backup');
                
                // Si on attend Discord, arrêter le loading
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

    // Timeout pour la connexion Discord (3 minutes)
    useEffect(() => {
        if (discordLoading) {
            const timeout = setTimeout(() => {
                setDiscordLoading(false);
                setShowCallbackInput(true);
                toast({
                    title: 'Timeout',
                    description: 'La connexion automatique a échoué. Utilisez le mode manuel ci-dessous.',
                    variant: 'default',
                });
            }, 180000); // 3 minutes

            return () => clearTimeout(timeout);
        }
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
            } else if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
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
            } else if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            // Si c'est une erreur réseau, donner un message plus clair
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
            console.log('=== DÉBUT CONNEXION DISCORD ===');
            
            // Écouter l'événement oauth-callback AVANT de démarrer le serveur
            unlisten = await listen<string>('oauth-callback', async (event) => {
                console.log('✅ Événement oauth-callback reçu:', event.payload);
                
                try {
                    // Parser les données reçues (format: access_token=xxx&refresh_token=xxx ou code=xxx)
                    const params = new URLSearchParams(event.payload);
                    const accessToken = params.get('access_token');
                    const refreshToken = params.get('refresh_token');
                    const code = params.get('code');
                    
                    if (accessToken) {
                        console.log('🔑 Access token reçu, création de la session...');
                        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken || '',
                        });
                        
                        if (sessionError) {
                            console.error('❌ Erreur setSession:', sessionError);
                            throw sessionError;
                        }
                        
                        if (sessionData?.session) {
                            console.log('✅ Session créée:', sessionData.session.user.email);
                            setUser(sessionData.session.user);
                            setDiscordLoading(false);
                            setShowCallbackInput(false);
                            setActiveTab('backup');
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    } else if (code) {
                        console.log('🔑 Code reçu, échange contre une session...');
                        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
                        
                        if (sessionError) {
                            console.error('❌ Erreur exchangeCodeForSession:', sessionError);
                            throw sessionError;
                        }
                        
                        if (sessionData?.session) {
                            console.log('✅ Session créée:', sessionData.session.user.email);
                            setUser(sessionData.session.user);
                            setDiscordLoading(false);
                            setShowCallbackInput(false);
                            setActiveTab('backup');
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    }
                } catch (err: any) {
                    console.error('❌ Erreur traitement callback:', err);
                    setDiscordLoading(false);
                    toast({
                        title: 'Erreur de connexion',
                        description: err.message || 'Impossible de créer la session',
                        variant: 'destructive',
                    });
                }
                
                // Nettoyer le listener
                if (unlisten) unlisten();
            });
            
            // Écouter aussi les erreurs OAuth
            await listen<string>('oauth-error', (event) => {
                console.error('❌ Erreur OAuth reçue:', event.payload);
                setDiscordLoading(false);
                toast({
                    title: 'Erreur d\'authentification',
                    description: event.payload,
                    variant: 'destructive',
                });
                if (unlisten) unlisten();
            });

            // Démarrer le serveur OAuth local (en arrière-plan)
            console.log('🚀 Démarrage du serveur OAuth local...');
            invoke('start_oauth_server').then((result) => {
                console.log('📡 Serveur OAuth terminé:', result);
            }).catch((err) => {
                console.warn('⚠️ Serveur OAuth:', err);
            });
            
            // Attendre un peu que le serveur démarre
            await new Promise(resolve => setTimeout(resolve, 500));

            // Utiliser le serveur local comme URL de redirection
            const redirectUrl = 'http://localhost:1421/auth/callback';
            
            console.log('URL de redirection:', redirectUrl);
            
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'discord',
                options: {
                    redirectTo: redirectUrl,
                    skipBrowserRedirect: true,
                },
            });

            if (error) {
                console.error('❌ Erreur Supabase OAuth:', error);
                throw error;
            }

            // Ouvrir l'URL dans le navigateur
            if (data.url) {
                console.log('🌐 Ouverture de l\'URL Discord dans le navigateur...');
                await invoke('open_external', { url: data.url });
                
                toast({
                    title: 'Authentification Discord',
                    description: 'Veuillez autoriser l\'application dans votre navigateur. La connexion sera automatique.',
                    duration: 10000,
                });
            }
        } catch (error: any) {
            console.error('❌ Erreur de connexion Discord:', error);
            setDiscordLoading(false);
            if (unlisten) unlisten();
            toast({
                title: 'Erreur de connexion Discord',
                description: error.message || 'Une erreur est survenue',
                variant: 'destructive',
            });
        }
    };

    const handleCallbackUrlSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!callbackUrl.trim()) {
            toast({
                title: 'URL requise',
                description: 'Veuillez coller l\'URL du callback',
                variant: 'destructive',
            });
            return;
        }

        setDiscordLoading(true);
        try {
            console.log('=== DÉBUT VALIDATION CALLBACK ===');
            console.log('URL du callback reçue:', callbackUrl);
            
            // Vérifier d'abord si une session existe déjà
            const { data: existingSession } = await supabase.auth.getSession();
            if (existingSession?.session) {
                console.log('Session existante trouvée:', existingSession.session.user.email);
                setUser(existingSession.session.user);
                setDiscordLoading(false);
                setShowCallbackInput(false);
                setCallbackUrl('');
                setActiveTab('backup');
                toast({
                    title: 'Connexion réussie',
                    description: 'Vous êtes maintenant connecté avec Discord',
                });
                return;
            }
            
            // Extraire le code ou l'access_token de l'URL
            let code: string | null = null;
            let accessToken: string | null = null;
            let refreshToken: string | null = null;
            
            try {
                // Essayer d'abord avec une URL complète
                const url = new URL(callbackUrl);
                code = url.searchParams.get('code');
                // Vérifier aussi dans le hash
                const hash = url.hash;
                if (hash) {
                    const hashParams = new URLSearchParams(hash.substring(1));
                    accessToken = hashParams.get('access_token');
                    refreshToken = hashParams.get('refresh_token');
                    if (!code) {
                        code = hashParams.get('code');
                    }
                }
                console.log('Code extrait de l\'URL:', code ? `Oui (${code.substring(0, 20)}...)` : 'Non');
                console.log('Access token extrait:', accessToken ? `Oui (${accessToken.substring(0, 20)}...)` : 'Non');
                console.log('Refresh token extrait:', refreshToken ? `Oui (${refreshToken.substring(0, 20)}...)` : 'Non');
            } catch (urlError) {
                console.error('Erreur lors de la création de l\'URL:', urlError);
                // Si ce n'est pas une URL valide, essayer d'extraire directement avec regex
                const codeMatch = callbackUrl.match(/[?&#]code=([^&]+)/);
                if (codeMatch) {
                    code = decodeURIComponent(codeMatch[1]);
                    console.log('Code extrait via regex:', code.substring(0, 20) + '...');
                }
                const tokenMatch = callbackUrl.match(/[?&#]access_token=([^&]+)/);
                if (tokenMatch) {
                    accessToken = decodeURIComponent(tokenMatch[1]);
                    console.log('Access token extrait via regex:', accessToken.substring(0, 20) + '...');
                }
                const refreshMatch = callbackUrl.match(/[?&#]refresh_token=([^&]+)/);
                if (refreshMatch) {
                    refreshToken = decodeURIComponent(refreshMatch[1]);
                    console.log('Refresh token extrait via regex:', refreshToken.substring(0, 20) + '...');
                }
            }

            // Si on a un access_token (et idéalement un refresh_token), on peut l'utiliser directement
            if (accessToken) {
                console.log('✅ Access token trouvé, création de la session...');
                // Utiliser setSession avec le token
                const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken || '', // Utiliser le refresh_token si disponible
                });
                
                if (sessionError) {
                    console.error('Erreur setSession:', sessionError);
                    // Si setSession échoue, essayer avec exchangeCodeForSession si on a un code
                    if (code) {
                        console.log('Tentative avec exchangeCodeForSession...');
                        // Continuer avec le code ci-dessous
                    } else {
                        throw sessionError;
                    }
                } else if (sessionData?.session) {
                    console.log('✅ Session créée avec succès depuis access_token:', sessionData.session.user.email);
                    setUser(sessionData.session.user);
                    setDiscordLoading(false);
                    setShowCallbackInput(false);
                    setCallbackUrl('');
                    setActiveTab('backup');
                    toast({
                        title: 'Connexion réussie',
                        description: 'Vous êtes maintenant connecté avec Discord',
                    });
                    return;
                }
            }

            if (!code) {
                throw new Error('Code ou access_token non trouvé dans l\'URL. Assurez-vous de copier l\'URL complète de la page de redirection (elle doit contenir ?code=... ou #access_token=...).');
            }

            console.log('Tentative d\'échange du code contre une session...');
            console.log('Code à échanger:', code.substring(0, 30) + '...');
            
            // Échanger le code contre une session
            const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

            console.log('Résultat de exchangeCodeForSession:', { 
                hasSession: !!sessionData?.session, 
                hasUser: !!sessionData?.session?.user,
                userEmail: sessionData?.session?.user?.email,
                error: sessionError,
                errorMessage: sessionError?.message,
                errorStatus: sessionError?.status
            });

            if (sessionError) {
                console.error('Erreur détaillée de Supabase:', {
                    message: sessionError.message,
                    status: sessionError.status,
                    name: sessionError.name,
                    fullError: sessionError
                });
                
                // Si le code a expiré ou est invalide, suggérer de réessayer
                if (sessionError.message?.includes('expired') || sessionError.message?.includes('invalid')) {
                    throw new Error('Le code a expiré ou est invalide. Veuillez réessayer la connexion Discord.');
                }
                throw sessionError;
            }

            if (sessionData?.session) {
                console.log('✅ Session créée avec succès:', sessionData.session.user.email);
                setUser(sessionData.session.user);
                setDiscordLoading(false);
                setShowCallbackInput(false);
                setCallbackUrl('');
                setActiveTab('backup');
                toast({
                    title: 'Connexion réussie',
                    description: 'Vous êtes maintenant connecté avec Discord',
                });
            } else {
                console.error('❌ Aucune session dans la réponse:', sessionData);
                // Vérifier à nouveau la session après un court délai
                setTimeout(async () => {
                    const { data: retrySession } = await supabase.auth.getSession();
                    if (retrySession?.session) {
                        console.log('✅ Session trouvée après vérification:', retrySession.session.user.email);
                        setUser(retrySession.session.user);
                        setDiscordLoading(false);
                        setShowCallbackInput(false);
                        setCallbackUrl('');
                        setActiveTab('backup');
                        toast({
                            title: 'Connexion réussie',
                            description: 'Vous êtes maintenant connecté avec Discord',
                        });
                    } else {
                        throw new Error('Aucune session n\'a été créée. Le code a peut-être expiré. Veuillez réessayer.');
                    }
                }, 1000);
            }
        } catch (err: any) {
            console.error('=== ERREUR LORS DE L\'ÉCHANGE DU CODE ===');
            console.error('Type d\'erreur:', typeof err);
            console.error('Erreur complète:', err);
            console.error('Message:', err.message);
            console.error('Stack:', err.stack);
            
            setDiscordLoading(false);
            let errorMessage = 'Impossible d\'échanger le code contre une session';
            if (err.message) {
                errorMessage = err.message;
            } else if (err.error_description) {
                errorMessage = err.error_description;
            } else if (typeof err === 'string') {
                errorMessage = err;
            } else if (err.toString) {
                errorMessage = err.toString();
            }
            
            toast({
                title: 'Erreur',
                description: errorMessage,
                variant: 'destructive',
                duration: 10000,
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
                        <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1 rounded-lg">
                            <TabsTrigger 
                                value="backup" 
                                className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md"
                            >
                                <Save className="h-4 w-4" />
                                Mes sauvegardes
                            </TabsTrigger>
                            <TabsTrigger 
                                value="account" 
                                className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md"
                            >
                                <UserIcon className="h-4 w-4" />
                                Mon compte
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="backup" className="mt-6">
                            <CloudBackupContent user={user} />
                        </TabsContent>
                        <TabsContent value="account" className="mt-6 space-y-4">
                            {user.user_metadata?.avatar_url && (
                                <div className="flex justify-center">
                                    <img 
                                        src={user.user_metadata.avatar_url} 
                                        alt="Avatar" 
                                        className="h-20 w-20 rounded-full"
                                    />
                                </div>
                            )}
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
                        </TabsContent>
                    </Tabs>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1 rounded-lg">
                            <TabsTrigger 
                                value="login" 
                                className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md"
                            >
                                <LogIn className="h-4 w-4" />
                                Connexion
                            </TabsTrigger>
                            <TabsTrigger 
                                value="signup" 
                                className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md"
                            >
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

                            {showCallbackInput && (
                                <form onSubmit={handleCallbackUrlSubmit} className="space-y-4 mt-4 p-4 border rounded-lg bg-muted/50">
                                    <div className="space-y-2">
                                        <Label htmlFor="callback-url">
                                            Après avoir autorisé dans votre navigateur, copiez l'URL complète de la page de redirection (elle contient #access_token=... ou ?code=...)
                                        </Label>
                                        <Input
                                            id="callback-url"
                                            type="text"
                                            placeholder="http://localhost:3000/#access_token=... ou https://...?code=..."
                                            value={callbackUrl}
                                            onChange={(e) => setCallbackUrl(e.target.value)}
                                            disabled={discordLoading}
                                            className="font-mono text-xs"
                                            autoFocus
                                        />
                                        <div className="space-y-1">
                                            <p className="text-xs font-semibold text-foreground">
                                                ⚠️ Important : Après avoir cliqué sur "Autoriser" dans Discord :
                                            </p>
                                            <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                                                <li>Ne fermez PAS la page du navigateur</li>
                                                <li>Copiez l'URL COMPLÈTE depuis la barre d'adresse (elle doit contenir <code className="bg-muted px-1 rounded">?code=</code>)</li>
                                                <li>Collez-la dans le champ ci-dessus</li>
                                                <li>Cliquez sur "Valider" dans cette application</li>
                                            </ol>
                                            <p className="text-xs text-destructive font-semibold mt-2">
                                                ⏱️ Le code expire rapidement, faites-le rapidement !
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            className="flex-1"
                                            disabled={!callbackUrl.trim() || discordLoading}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (!callbackUrl.trim()) {
                                                    toast({
                                                        title: 'URL requise',
                                                        description: 'Veuillez coller l\'URL du callback',
                                                        variant: 'destructive',
                                                    });
                                                    return;
                                                }
                                                handleCallbackUrlSubmit(e as any);
                                            }}
                                        >
                                            {discordLoading ? 'Validation...' : 'Valider'}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setShowCallbackInput(false);
                                                setCallbackUrl('');
                                                setDiscordLoading(false);
                                            }}
                                            disabled={discordLoading}
                                        >
                                            Annuler
                                        </Button>
                                    </div>
                                </form>
                            )}
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

                            {showCallbackInput && (
                                <form onSubmit={handleCallbackUrlSubmit} className="space-y-4 mt-4 p-4 border rounded-lg bg-muted/50">
                                    <div className="space-y-2">
                                        <Label htmlFor="callback-url-signup">
                                            Collez l'URL de la page de callback ici
                                        </Label>
                                        <Input
                                            id="callback-url-signup"
                                            type="text"
                                            placeholder="https://rronicslgyoubiofbinu.supabase.co/auth/v1/callback?code=..."
                                            value={callbackUrl}
                                            onChange={(e) => setCallbackUrl(e.target.value)}
                                            disabled={discordLoading}
                                            className="font-mono text-xs"
                                        />
                                        <div className="space-y-1">
                                            <p className="text-xs font-semibold text-foreground">
                                                ⚠️ Important : Après avoir cliqué sur "Autoriser" dans Discord :
                                            </p>
                                            <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                                                <li>Ne fermez PAS la page du navigateur</li>
                                                <li>Copiez l'URL COMPLÈTE depuis la barre d'adresse (elle doit contenir <code className="bg-muted px-1 rounded">?code=</code>)</li>
                                                <li>Collez-la dans le champ ci-dessus</li>
                                                <li>Cliquez sur "Valider" dans cette application</li>
                                            </ol>
                                            <p className="text-xs text-destructive font-semibold mt-2">
                                                ⏱️ Le code expire rapidement, faites-le rapidement !
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            className="flex-1"
                                            disabled={!callbackUrl.trim() || discordLoading}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (!callbackUrl.trim()) {
                                                    toast({
                                                        title: 'URL requise',
                                                        description: 'Veuillez coller l\'URL du callback',
                                                        variant: 'destructive',
                                                    });
                                                    return;
                                                }
                                                handleCallbackUrlSubmit(e as any);
                                            }}
                                        >
                                            {discordLoading ? 'Validation...' : 'Valider'}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setShowCallbackInput(false);
                                                setCallbackUrl('');
                                                setDiscordLoading(false);
                                            }}
                                            disabled={discordLoading}
                                        >
                                            Annuler
                                        </Button>
                                    </div>
                                </form>
                            )}
                        </TabsContent>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}

