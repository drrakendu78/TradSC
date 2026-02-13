import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { User as SupabaseUser } from '@supabase/supabase-js';

// Event global pour synchroniser tous les composants qui utilisent useAvatar
const AVATAR_CHANGE_EVENT = 'customAvatarChanged';

export function useAvatar(user: SupabaseUser | null) {
    const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);

    const loadCustomAvatar = useCallback(async () => {
        try {
            // Rust retourne directement un data:image/... URL en base64
            const dataUrl: string | null = await invoke('get_custom_avatar');
            setCustomAvatarUrl(dataUrl);
        } catch {
            setCustomAvatarUrl(null);
        }
    }, []);

    useEffect(() => {
        loadCustomAvatar();

        const handleAvatarChange = () => loadCustomAvatar();
        window.addEventListener(AVATAR_CHANGE_EVENT, handleAvatarChange);
        return () => window.removeEventListener(AVATAR_CHANGE_EVENT, handleAvatarChange);
    }, [loadCustomAvatar]);

    const setCustomAvatar = useCallback(async (sourcePath: string) => {
        await invoke('save_custom_avatar', { sourcePath });
        await loadCustomAvatar();
        window.dispatchEvent(new CustomEvent(AVATAR_CHANGE_EVENT));
    }, [loadCustomAvatar]);

    const resetAvatar = useCallback(async () => {
        await invoke('remove_custom_avatar');
        setCustomAvatarUrl(null);
        window.dispatchEvent(new CustomEvent(AVATAR_CHANGE_EVENT));
    }, []);

    // Priorité : custom local > Discord > null
    const discordUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
    const avatarUrl = customAvatarUrl || discordUrl;

    return { avatarUrl, isCustom: !!customAvatarUrl, setCustomAvatar, resetAvatar };
}
