import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rronicslgyoubiofbinu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyb25pY3NsZ3lvdWJpb2ZiaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTQwNzIsImV4cCI6MjA4MDE5MDA3Mn0.YzsYpn0_2PTrCaqchZAixW_Fh-8iQLcHImgwGM3mGr4';

// Configuration du client Supabase pour Tauri
// Utilise le fetch global qui fonctionne dans l'environnement Tauri
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // Activé pour détecter les tokens dans l'URL hash
    },
    global: {
        fetch: (...args) => fetch(...args), // Utilise le fetch global
    },
});

export const BUCKET_NAME = 'user-backups';
export const MAX_BACKUPS = 5;

