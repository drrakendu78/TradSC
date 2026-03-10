/**
 * Helpers pour détecter l'environnement d'exécution
 * Utile pour l'architecture hybride Tauri + Vercel
 */

/**
 * Détecte si l'application tourne dans Tauri (app desktop)
 * @returns true si dans Tauri, false si dans un navigateur web
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
};


