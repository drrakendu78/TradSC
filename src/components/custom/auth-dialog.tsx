import { useEffect, useReducer, useState } from 'react';
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
import { User as UserIcon, Save, LogIn, Camera, RotateCcw, LogOut, ShieldAlert, CheckCircle2, KeyRound, ArrowLeft, Mail, Database, Fingerprint, FileText, ShieldCheck } from 'lucide-react';

function DiscordLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 127.14 96.36" fill="currentColor" className={className} aria-hidden="true">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21a105.73,105.73,0,0,0,32.17,16.15,77.7,77.7,0,0,0,6.89-11.11,68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
        </svg>
    );
}

function DiscordAuthButton({ label, loading, disabled, onClick }: { label: string; loading: boolean; disabled: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(88,101,242,0.25)] transition-colors duration-200 hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-70"
        >
            <DiscordLogo className="h-5 w-5" />
            {loading ? 'Connexion en cours...' : label}
        </button>
    );
}
import { invoke } from '@tauri-apps/api/core';
import { openExternalCustom } from '@/utils/external';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useAvatar } from '@/hooks/useAvatar';

const PRIVACY_URL = 'https://startrad.link/privacy';
const LEGAL_URL = 'https://startrad.link/mentions-legales';
const CGU_URL = 'https://startrad.link/cgu';

/** Liens légaux réutilisables (confidentialité + mentions légales + CGU), ouverts dans le navigateur. */
function LegalLinks({ className = '' }: { className?: string }) {
    return (
        <span className={`inline-flex flex-wrap items-center gap-x-1 ${className}`}>
            <button type="button" onClick={() => { void openExternalCustom(PRIVACY_URL); }} className="text-emerald-400 underline-offset-2 transition-colors hover:text-emerald-300 hover:underline">
                Politique de confidentialité
            </button>
            <span className="text-muted-foreground/50">·</span>
            <button type="button" onClick={() => { void openExternalCustom(LEGAL_URL); }} className="text-emerald-400 underline-offset-2 transition-colors hover:text-emerald-300 hover:underline">
                Mentions légales
            </button>
            <span className="text-muted-foreground/50">·</span>
            <button type="button" onClick={() => { void openExternalCustom(CGU_URL); }} className="text-emerald-400 underline-offset-2 transition-colors hover:text-emerald-300 hover:underline">
                CGU
            </button>
        </span>
    );
}

interface AuthDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultTab?: string;
}

type AuthView = 'tabs' | 'forgot' | 'forgot-sent';

type AuthState = {
    user: User | null;
    loading: boolean;
    discordLoading: boolean;
    email: string;
    password: string;
    activeTab: string;
    view: AuthView;
    forgotEmail: string;
    showDeleteConfirm: boolean;
    deleteLoading: boolean;
};

type AuthAction =
    | { type: 'SET_USER'; user: User | null }
    | { type: 'SET_LOADING'; value: boolean }
    | { type: 'SET_DISCORD_LOADING'; value: boolean }
    | { type: 'SET_EMAIL'; value: string }
    | { type: 'SET_PASSWORD'; value: string }
    | { type: 'SET_ACTIVE_TAB'; value: string }
    | { type: 'SET_VIEW'; value: AuthView }
    | { type: 'SET_FORGOT_EMAIL'; value: string }
    | { type: 'SET_SHOW_DELETE_CONFIRM'; value: boolean }
    | { type: 'SET_DELETE_LOADING'; value: boolean }
    | { type: 'SIGNED_IN'; user: User }
    | { type: 'SIGNED_OUT' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
    switch (action.type) {
        case 'SET_USER': return { ...state, user: action.user };
        case 'SET_LOADING': return { ...state, loading: action.value };
        case 'SET_DISCORD_LOADING': return { ...state, discordLoading: action.value };
        case 'SET_EMAIL': return { ...state, email: action.value };
        case 'SET_PASSWORD': return { ...state, password: action.value };
        case 'SET_ACTIVE_TAB': return { ...state, activeTab: action.value };
        case 'SET_VIEW': return { ...state, view: action.value };
        case 'SET_FORGOT_EMAIL': return { ...state, forgotEmail: action.value };
        case 'SET_SHOW_DELETE_CONFIRM': return { ...state, showDeleteConfirm: action.value };
        case 'SET_DELETE_LOADING': return { ...state, deleteLoading: action.value };
        case 'SIGNED_IN': return { ...state, user: action.user, activeTab: 'backup', view: 'tabs', discordLoading: false };
        case 'SIGNED_OUT': return { ...state, user: null, email: '', password: '', activeTab: 'login', view: 'tabs', loading: false };
        default: return state;
    }
}

export default function AuthDialog({ open, onOpenChange, defaultTab }: AuthDialogProps) {
    const { toast } = useToast();
    const [{ user, loading, discordLoading, email, password, activeTab, view, forgotEmail, showDeleteConfirm, deleteLoading }, dispatch] = useReducer(authReducer, {
        user: null,
        loading: false,
        discordLoading: false,
        email: '',
        password: '',
        activeTab: defaultTab || 'login',
        view: 'tabs' as AuthView,
        forgotEmail: '',
        showDeleteConfirm: false,
        deleteLoading: false,
    });
    const { avatarUrl, isCustom, setCustomAvatar, resetAvatar } = useAvatar(user);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [hwid, setHwid] = useState<string | null>(null);
    const [pseudo, setPseudo] = useState('');

    // Réinitialiser l'onglet et la vue quand le dialog s'ouvre ou l'utilisateur change
    useEffect(() => {
        if (open) {
            dispatch({ type: 'SET_ACTIVE_TAB', value: user ? 'backup' : (defaultTab || 'login') });
            dispatch({ type: 'SET_VIEW', value: 'tabs' });
        }
    }, [open, user, defaultTab]);

    useEffect(() => {
        checkSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                dispatch({ type: 'SIGNED_IN', user: session.user });
                if (discordLoading) {
                    toast({
                        title: 'Connexion réussie',
                        description: 'Vous êtes maintenant connecté avec Discord',
                    });
                }
            } else {
                dispatch({ type: 'SET_USER', user: session?.user ?? null });
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [discordLoading, toast]);

    // Récupère le HWID de la machine (SHA-256 du MachineGuid Windows) pour
    // l'afficher dans "Mes données" — transparence : l'utilisateur voit
    // exactement l'identifiant stocké le concernant.
    useEffect(() => {
        if (!user) { setHwid(null); return; }
        invoke<string>('get_machine_id')
            .then((id) => setHwid(id))
            .catch(() => setHwid(null));
    }, [user]);

    const checkSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            dispatch({ type: 'SET_USER', user: session?.user ?? null });
        } catch (error) {
            console.error('Erreur lors de la vérification de la session:', error);
        }
    };

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        dispatch({ type: 'SET_LOADING', value: true });

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    // Pseudo stocké dans user_metadata : sert UNIQUEMENT à l'affichage
                    // dans l'app + lier un nom lisible au compte (récupérable côté admin
                    // pour identifier/bannir plus facilement les comptes email sans Discord).
                    data: {
                        full_name: pseudo.trim(),
                        name: pseudo.trim(),
                    },
                },
            });

            if (error) throw error;

            if (data.user) {
                toast({
                    title: 'Inscription réussie',
                    description: 'Votre compte a été créé avec succès',
                });
                dispatch({ type: 'SIGNED_IN', user: data.user });
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
            dispatch({ type: 'SET_LOADING', value: false });
        }
    };

    const handleSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        dispatch({ type: 'SET_LOADING', value: true });

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
                dispatch({ type: 'SIGNED_IN', user: data.user });
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
            dispatch({ type: 'SET_LOADING', value: false });
        }
    };

    const handleDiscordSignIn = async () => {
        dispatch({ type: 'SET_DISCORD_LOADING', value: true });
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
                            dispatch({ type: 'SIGNED_IN', user: sessionData.session.user });
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    } else if (code) {
                        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

                        if (sessionError) throw sessionError;

                        if (sessionData?.session) {
                            dispatch({ type: 'SIGNED_IN', user: sessionData.session.user });
                            toast({
                                title: 'Connexion réussie !',
                                description: `Bienvenue ${sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email}`,
                            });
                        }
                    }
                } catch (err: any) {
                    console.error('Erreur traitement callback:', err);
                    dispatch({ type: 'SET_DISCORD_LOADING', value: false });
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
                dispatch({ type: 'SET_DISCORD_LOADING', value: false });
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
            dispatch({ type: 'SET_DISCORD_LOADING', value: false });
            if (unlisten) unlisten();
            toast({
                title: 'Erreur de connexion Discord',
                description: error.message || 'Une erreur est survenue',
                variant: 'destructive',
            });
        }
    };

    const openForgotPasswordView = () => {
        // Pré-remplit avec l'email saisi sur le formulaire de login si dispo
        dispatch({ type: 'SET_FORGOT_EMAIL', value: email.trim() });
        dispatch({ type: 'SET_VIEW', value: 'forgot' });
    };

    const backToLoginView = () => {
        dispatch({ type: 'SET_VIEW', value: 'tabs' });
        dispatch({ type: 'SET_ACTIVE_TAB', value: 'login' });
    };

    const handleSendResetEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = forgotEmail.trim();
        if (!trimmed) {
            toast({
                title: 'Email requis',
                description: 'Saisis ton email pour recevoir le lien.',
                variant: 'destructive',
            });
            return;
        }
        dispatch({ type: 'SET_LOADING', value: true });
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
                redirectTo: 'https://reset.startrad.link/',
            });
            if (error) throw error;
            dispatch({ type: 'SET_VIEW', value: 'forgot-sent' });
        } catch (error: any) {
            console.error('Erreur réinitialisation mot de passe:', error);
            toast({
                title: 'Erreur',
                description: error.message || "Impossible d'envoyer l'email de réinitialisation",
                variant: 'destructive',
            });
        } finally {
            dispatch({ type: 'SET_LOADING', value: false });
        }
    };

    const handleSignOut = async () => {
        dispatch({ type: 'SET_LOADING', value: true });
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            dispatch({ type: 'SIGNED_OUT' });
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
            dispatch({ type: 'SET_LOADING', value: false });
        }
    };

    const handleDeleteAccount = async () => {
        dispatch({ type: 'SET_DELETE_LOADING', value: true });
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
            dispatch({ type: 'SET_USER', user: null });
            dispatch({ type: 'SET_SHOW_DELETE_CONFIRM', value: false });
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
            dispatch({ type: 'SET_DELETE_LOADING', value: false });
        }
    };

    const cloudTabTriggerClass =
        "group flex h-auto min-h-[52px] items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 data-[state=active]:-translate-y-[1px] data-[state=active]:border-primary/45 data-[state=active]:bg-[linear-gradient(140deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.36))] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_0_1px_hsl(var(--primary)/0.30),0_10px_24px_hsl(var(--primary)/0.16)] data-[state=active]:animate-[tab-activate_260ms_ease-out]";
    const authInputClass =
        "h-11 rounded-lg border-border/55 bg-background/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] placeholder:text-muted-foreground/75 focus-visible:border-primary/50 focus-visible:ring-primary/30";
    const authPrimaryButtonClass =
        "h-11 w-full rounded-lg border border-primary/45 bg-[linear-gradient(140deg,hsl(var(--primary)/0.30),hsl(var(--primary)/0.18))] text-foreground shadow-[0_8px_18px_hsl(var(--primary)/0.18)] transition-all duration-200 hover:border-primary/60 hover:bg-[linear-gradient(140deg,hsl(var(--primary)/0.38),hsl(var(--primary)/0.22))]";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                overlayClassName={user ? "bg-black/18 backdrop-blur-sm" : "bg-black/26 backdrop-blur-md"}
                className={user
                    ? "max-w-4xl max-h-[90vh] overflow-y-auto border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"
                    : "max-w-2xl max-h-[90vh] overflow-y-auto border border-border/45 bg-[hsl(var(--background)/0.46)] shadow-[0_18px_46px_rgba(0,0,0,0.32)] backdrop-blur-2xl backdrop-saturate-150"}
            >
                <DialogHeader className={user ? "space-y-1 pb-1" : ""}>
                    {user && (
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">Parametres systeme</p>
                    )}
                    <DialogTitle className={user ? "text-[28px] font-semibold tracking-tight leading-none" : ""}>
                        {user ? 'Sauvegarde Cloud' : 'Authentification'}
                    </DialogTitle>
                    <DialogDescription className={user ? "text-sm text-muted-foreground" : ""}>
                        {user
                            ? 'Gérez vos sauvegardes cloud'
                            : 'Connectez-vous ou créez un compte pour sauvegarder vos données'}
                    </DialogDescription>
                </DialogHeader>

                {user ? (
                    <Tabs value={activeTab} onValueChange={(v) => dispatch({ type: 'SET_ACTIVE_TAB', value: v })} className="w-full space-y-3">
                        <TabsList className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.26)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                            <TabsTrigger value="backup" className={cloudTabTriggerClass}>
                                <span className="flex items-center gap-2">
                                    <Save className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">Sauvegardes</span>
                                </span>
                                <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                    Cloud
                                </span>
                            </TabsTrigger>
                            <TabsTrigger value="account" className={cloudTabTriggerClass}>
                                <span className="flex items-center gap-2">
                                    <UserIcon className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em] sm:text-[11px]">Compte</span>
                                </span>
                                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    Profil
                                </span>
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="backup" className="mt-0">
                            <CloudBackupContent user={user} />
                        </TabsContent>
                        <TabsContent value="account" className="mt-0 space-y-4 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.34)] p-4 shadow-[0_14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                            <section className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.24)] p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Profil utilisateur</p>
                                        <h4 className="text-base font-semibold tracking-tight">Mon compte</h4>
                                        <p className="text-sm text-muted-foreground">Gere votre photo, vos infos et votre session.</p>
                                    </div>
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/45 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Connecte
                                    </span>
                                </div>

                                <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                                    <div className="lg:self-start rounded-2xl border border-border/40 bg-[hsl(var(--background)/0.24)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="relative group">
                                                <div className="pointer-events-none absolute -inset-1 rounded-full bg-primary/20 blur-md opacity-80" />
                                                {avatarUrl ? (
                                                    <img
                                                        src={avatarUrl}
                                                        alt="Avatar"
                                                        className="relative h-24 w-24 rounded-full object-cover ring-2 ring-primary/35 shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
                                                    />
                                                ) : (
                                                    <div className="relative h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/35 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                                                        <UserIcon className="h-9 w-9 text-primary" />
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
                                            <p className="text-xs text-muted-foreground">Photo de profil</p>

                                            {isCustom && (
                                                <button
                                                    onClick={async () => {
                                                        await resetAvatar();
                                                        toast({ title: 'Photo réinitialisée' });
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/55 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                >
                                                    <RotateCcw className="h-3 w-3" />
                                                    Revenir a Discord
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        {user.user_metadata?.full_name || user.user_metadata?.name ? (
                                            <div className="space-y-2 rounded-xl border border-border/40 bg-[hsl(var(--background)/0.24)] p-3">
                                                <Label>Nom</Label>
                                                <Input
                                                    value={user.user_metadata?.full_name || user.user_metadata?.name || 'Non defini'}
                                                    disabled
                                                    className="bg-background/65"
                                                />
                                            </div>
                                        ) : null}

                                        <div className="space-y-2 rounded-xl border border-border/40 bg-[hsl(var(--background)/0.24)] p-3">
                                            <Label>Email</Label>
                                            <Input value={user.email || ''} disabled className="bg-background/65" />
                                        </div>

                                        {user.user_metadata?.preferred_username && (
                                            <div className="space-y-2 rounded-xl border border-border/40 bg-[hsl(var(--background)/0.24)] p-3">
                                                <Label>Nom d'utilisateur Discord</Label>
                                                <Input value={user.user_metadata.preferred_username} disabled className="bg-background/65" />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-3">
                                    <Button
                                        onClick={handleSignOut}
                                        variant="outline"
                                        disabled={loading}
                                        className="w-full border-border/60 bg-background/55"
                                    >
                                        <LogOut className="mr-2 h-4 w-4" />
                                        {loading ? 'Deconnexion...' : 'Se deconnecter'}
                                    </Button>
                                </div>
                            </section>

                            <section className="rounded-xl border border-border/45 bg-[hsl(var(--background)/0.24)] p-4">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Transparence</p>
                                    <h4 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                                        <Database className="h-4 w-4 text-primary" />
                                        Mes données
                                    </h4>
                                    <p className="text-sm text-muted-foreground">Exactement ce que StarTrad enregistre te concernant, et pourquoi.</p>
                                </div>

                                <ul className="mt-3 space-y-2 text-sm">
                                    <li className="flex items-start gap-2 rounded-lg border border-border/40 bg-[hsl(var(--background)/0.24)] p-2.5">
                                        <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary/90" />
                                        <span><span className="font-medium">Pseudo</span> — affiché dans l'app et lié à ton compte (ton identité publique).</span>
                                    </li>
                                    <li className="flex items-start gap-2 rounded-lg border border-border/40 bg-[hsl(var(--background)/0.24)] p-2.5">
                                        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary/90" />
                                        <span><span className="font-medium">Email (ou compte Discord)</span> — pour te connecter et sauvegarder tes données dans le cloud.</span>
                                    </li>
                                    <li className="flex items-start gap-2 rounded-lg border border-border/40 bg-[hsl(var(--background)/0.24)] p-2.5">
                                        <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-primary/90" />
                                        <span>
                                            <span className="font-medium">Identifiant d'appareil (HWID)</span> — pour la sécurité : empêcher un compte banni de revenir. C'est un hash anonyme, pas un numéro de série lisible.
                                            {hwid && (
                                                <span className="mt-1.5 block break-all rounded bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">{hwid}</span>
                                            )}
                                        </span>
                                    </li>
                                </ul>

                                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                    <span>Stockage : Supabase (hébergement EU). On ne collecte <span className="font-medium text-foreground">rien d'autre</span>. Détails : <LegalLinks className="text-xs" /></span>
                                </p>
                                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                    Tu peux supprimer ton compte et toutes tes données quand tu veux (juste en dessous).
                                </p>
                            </section>

                            <section className="rounded-xl border border-destructive/35 bg-[hsl(var(--destructive)/0.08)] p-4">
                                <div className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-sm font-medium text-destructive">
                                        <ShieldAlert className="h-4 w-4" />
                                        Zone de danger
                                    </h4>
                                    {!showDeleteConfirm ? (
                                        <Button
                                            onClick={() => dispatch({ type: 'SET_SHOW_DELETE_CONFIRM', value: true })}
                                            variant="outline"
                                            className="w-full border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                        >
                                            Supprimer mon compte
                                        </Button>
                                    ) : (
                                        <div className="space-y-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                                            <p className="text-sm text-destructive font-medium">
                                                Cette action est irreversible !
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Toutes vos donnees et sauvegardes seront definitivement supprimees.
                                            </p>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => dispatch({ type: 'SET_SHOW_DELETE_CONFIRM', value: false })}
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
                            </section>
                        </TabsContent>
                    </Tabs>
                ) : view === 'forgot' ? (
                    <div className="mt-2 space-y-5">
                        <div className="flex flex-col items-center gap-3 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                                <KeyRound className="h-6 w-6 text-primary" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold tracking-tight">Réinitialiser le mot de passe</h3>
                                <p className="text-sm text-muted-foreground">
                                    Saisis l'email de ton compte. On t'envoie un lien pour définir un nouveau mot de passe.
                                </p>
                            </div>
                        </div>
                        <form onSubmit={handleSendResetEmail} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="forgot-email">Email du compte</Label>
                                <Input
                                    id="forgot-email"
                                    type="email"
                                    placeholder="votre@email.com"
                                    value={forgotEmail}
                                    onChange={(e) => dispatch({ type: 'SET_FORGOT_EMAIL', value: e.target.value })}
                                    required
                                    autoFocus
                                    disabled={loading}
                                    className={authInputClass}
                                />
                            </div>
                            <Button type="submit" className={authPrimaryButtonClass} disabled={loading}>
                                <Mail className="mr-2 h-4 w-4" />
                                {loading ? 'Envoi en cours...' : 'Envoyer le lien'}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={backToLoginView}
                                disabled={loading}
                                className="h-11 w-full rounded-lg border-border/60 bg-background/55"
                            >
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Retour à la connexion
                            </Button>
                        </form>
                    </div>
                ) : view === 'forgot-sent' ? (
                    <div className="mt-2 space-y-5">
                        <div className="flex flex-col items-center gap-3 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold tracking-tight">Email envoyé !</h3>
                                <p className="text-sm text-muted-foreground">
                                    On a envoyé un lien de réinitialisation à
                                    <span className="ml-1 font-medium text-foreground">{forgotEmail}</span>.
                                </p>
                                <p className="text-xs text-muted-foreground/80">
                                    Vérifie ta boîte de réception (et les spams). Le lien est valable pendant un temps limité.
                                </p>
                            </div>
                        </div>
                        <Button onClick={backToLoginView} className={authPrimaryButtonClass}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Retour à la connexion
                        </Button>
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={(v) => dispatch({ type: 'SET_ACTIVE_TAB', value: v })} className="w-full">
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
                                        onChange={(e) => dispatch({ type: 'SET_EMAIL', value: e.target.value })}
                                        required
                                        disabled={loading || discordLoading}
                                        className={authInputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="login-password">Mot de passe</Label>
                                        <button
                                            type="button"
                                            onClick={openForgotPasswordView}
                                            disabled={loading || discordLoading}
                                            className="text-xs text-muted-foreground transition-colors hover:text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline cursor-pointer"
                                        >
                                            Mot de passe oublié ?
                                        </button>
                                    </div>
                                    <Input
                                        id="login-password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => dispatch({ type: 'SET_PASSWORD', value: e.target.value })}
                                        required
                                        disabled={loading || discordLoading}
                                        className={authInputClass}
                                    />
                                </div>
                                <Button type="submit" className={authPrimaryButtonClass} disabled={loading || discordLoading}>
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

                            <DiscordAuthButton
                                label="Se connecter avec Discord"
                                loading={discordLoading}
                                disabled={loading || discordLoading}
                                onClick={handleDiscordSignIn}
                            />

                            <p className="pt-1 text-center text-[11px] text-muted-foreground/80">
                                En te connectant, tu acceptes notre <LegalLinks className="text-[11px]" />
                            </p>
                        </TabsContent>
                        <TabsContent value="signup" className="mt-4 space-y-4">
                            <form onSubmit={handleSignUp} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="signup-pseudo">Pseudo</Label>
                                    <Input
                                        id="signup-pseudo"
                                        type="text"
                                        placeholder="Ton pseudo"
                                        value={pseudo}
                                        onChange={(e) => setPseudo(e.target.value)}
                                        required
                                        minLength={2}
                                        maxLength={32}
                                        disabled={loading || discordLoading}
                                        className={authInputClass}
                                    />
                                    <p className="text-[11px] text-muted-foreground/80">Affiché dans l'app et lié à ton compte.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="signup-email">Email</Label>
                                    <Input
                                        id="signup-email"
                                        type="email"
                                        placeholder="votre@email.com"
                                        value={email}
                                        onChange={(e) => dispatch({ type: 'SET_EMAIL', value: e.target.value })}
                                        required
                                        disabled={loading || discordLoading}
                                        className={authInputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="signup-password">Mot de passe</Label>
                                    <Input
                                        id="signup-password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => dispatch({ type: 'SET_PASSWORD', value: e.target.value })}
                                        required
                                        minLength={6}
                                        disabled={loading || discordLoading}
                                        className={authInputClass}
                                    />
                                </div>
                                <div className="space-y-2 rounded-lg border border-border/45 bg-[hsl(var(--background)/0.24)] p-3">
                                    <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={acceptedTerms}
                                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                                            disabled={loading || discordLoading}
                                            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                                        />
                                        <span>
                                            J'accepte que StarTrad enregistre mon <span className="font-medium text-foreground">pseudo</span>, mon <span className="font-medium text-foreground">email</span> et un <span className="font-medium text-foreground">identifiant d'appareil (HWID)</span> pour l'affichage, la connexion et la sécurité (anti-contournement de ban).
                                        </span>
                                    </label>
                                    <p className="pl-[26px] text-[11px] text-muted-foreground">
                                        Détails : <LegalLinks className="text-[11px]" />
                                    </p>
                                </div>
                                <Button type="submit" className={authPrimaryButtonClass} disabled={loading || discordLoading || !acceptedTerms}>
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

                            <DiscordAuthButton
                                label="S'inscrire avec Discord"
                                loading={discordLoading}
                                disabled={loading || discordLoading || !acceptedTerms}
                                onClick={handleDiscordSignIn}
                            />
                        </TabsContent>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}
