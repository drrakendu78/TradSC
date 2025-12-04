import { useState, useEffect } from 'react';
import { User } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from '@/lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';
import AuthDialog from './auth-dialog';

export default function UserMenuButton() {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [authDialogOpen, setAuthDialogOpen] = useState(false);
    const [defaultTab, setDefaultTab] = useState<string | undefined>(undefined);

    useEffect(() => {
        // Vérifier la session actuelle
        checkSession();

        // Écouter les changements d'authentification
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            console.log('UserMenuButton - Auth state changed:', event, session?.user?.email);
            setUser(session?.user ?? null);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const checkSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
        } catch (error) {
            console.error('Erreur lors de la vérification de la session:', error);
        }
    };

    const handleSignOut = async () => {
        try {
            await supabase.auth.signOut();
            setUser(null);
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
        }
    };

    // Récupérer l'avatar Discord ou l'email pour l'affichage
    const getUserDisplayName = () => {
        if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
        if (user?.user_metadata?.name) return user.user_metadata.name;
        if (user?.user_metadata?.preferred_username) return user.user_metadata.preferred_username;
        return user?.email || 'Utilisateur';
    };

    const getUserAvatar = () => {
        // Discord fournit l'avatar dans user_metadata.avatar_url
        if (user?.user_metadata?.avatar_url) {
            return user.user_metadata.avatar_url;
        }
        return null;
    };

    const avatarUrl = getUserAvatar();
    const displayName = getUserDisplayName();

    return (
        <>
            {user ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button 
                            className='rounded-full flex justify-center items-center group shrink-0 overflow-hidden ring-2 ring-gray-500 hover:ring-blue-400 transition-all duration-200'
                            title={displayName}
                        >
                            {avatarUrl ? (
                                <img 
                                    src={avatarUrl} 
                                    alt="Avatar" 
                                    className='h-7 w-7 rounded-full object-cover'
                                    onError={(e) => {
                                        // Fallback sur l'icône si l'image ne charge pas
                                        e.currentTarget.style.display = 'none';
                                    }}
                                />
                            ) : (
                                <div className='h-7 w-7 rounded-full bg-gray-500 hover:bg-blue-400 flex items-center justify-center'>
                                    <User strokeWidth={2} className='h-4 w-4 text-gray-100 group-hover:text-background' />
                                </div>
                            )}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{displayName}</p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {user.email || user.user_metadata?.preferred_username || 'Utilisateur'}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => {
                            setDefaultTab('backup');
                            setAuthDialogOpen(true);
                        }}>
                            Mes sauvegardes
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleSignOut}>
                            Se déconnecter
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <button 
                    onClick={() => {
                        setDefaultTab(undefined);
                        setAuthDialogOpen(true);
                    }}
                    className='bg-gray-500 hover:bg-blue-400 rounded-full flex justify-center items-center p-1.5 group shrink-0 ring-2 ring-transparent hover:ring-blue-400 transition-all duration-200'
                    title="Se connecter"
                >
                    <User strokeWidth={2} className='h-5 w-5 text-gray-100 group-hover:text-background' />
                </button>
            )}
            <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} defaultTab={defaultTab} />
        </>
    );
}

