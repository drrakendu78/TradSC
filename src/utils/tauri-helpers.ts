/**
 * Helpers pour détecter l'environnement d'exécution
 * Utile pour l'architecture hybride Tauri + Vercel
 */

/**
 * Détecte si l'application tourne dans Tauri (app desktop)
 * @returns true si dans Tauri, false si dans un navigateur web
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * Détecte si l'UI est servie depuis Vercel (accès web direct)
 * @returns true si déployé sur Vercel, false sinon
 */
export const isVercelWeb = (): boolean => {
  return import.meta.env.VITE_IS_VERCEL === true || import.meta.env.VITE_IS_VERCEL === 'true';
};

/**
 * Wrapper sécurisé pour les appels Tauri invoke
 * Retourne null si on n'est pas dans Tauri
 */
export const safeTauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> => {
  if (!isTauri()) {
    console.warn(`[Tauri] Commande "${command}" ignorée - pas dans Tauri`);
    return null;
  }
  
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[Tauri] Erreur invoke "${command}":`, error);
    throw error;
  }
};

