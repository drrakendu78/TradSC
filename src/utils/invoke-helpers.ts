import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import { toFriendlyFsError } from "@/utils/fs-permissions";

/**
 * Utilitaire pour exécuter une commande Tauri avec gestion automatique des erreurs et toast
 * @param command - Nom de la commande Tauri à invoquer
 * @param args - Arguments à passer à la commande
 * @param toast - Fonction toast pour afficher les notifications
 * @param successMessage - Message de succès à afficher (optionnel)
 * @param onSuccess - Callback appelé en cas de succès (optionnel)
 * @param onError - Callback appelé en cas d'erreur (optionnel)
 * @param useFriendlyError - Utiliser toFriendlyFsError pour les messages d'erreur (défaut: false)
 * @returns Promise qui se résout avec le résultat ou null en cas d'erreur
 */
export async function invokeWithToast<T = any>(
    command: string,
    args: Record<string, any> = {},
    toast: ReturnType<typeof useToast>["toast"],
    successMessage?: { title: string; description?: string },
    onSuccess?: (result: T) => void,
    onError?: (error: unknown) => void,
    useFriendlyError: boolean = false
): Promise<T | null> {
    try {
        const result = await invoke<T>(command, args);
        
        if (successMessage) {
            toast({
                title: successMessage.title,
                description: successMessage.description,
                variant: "default",
            });
        }
        
        if (onSuccess) {
            onSuccess(result);
        }
        
        return result;
    } catch (error: unknown) {
        const errorMessage = useFriendlyError 
            ? toFriendlyFsError(error)
            : (error instanceof Error ? error.message : "Une erreur est survenue");
        
        toast({
            title: "Erreur",
            description: errorMessage,
            variant: "destructive",
        });
        
        if (onError) {
            onError(error);
        }
        
        return null;
    }
}

/**
 * Version simplifiée pour les opérations de suppression
 */
export async function invokeDeleteWithToast(
    command: string,
    args: Record<string, any>,
    toast: ReturnType<typeof useToast>["toast"],
    itemName: string,
    onSuccess?: () => void,
    useFriendlyError: boolean = false
): Promise<boolean> {
    const result = await invokeWithToast(
        command,
        args,
        toast,
        {
            title: "Succès",
            description: `${itemName} supprimé avec succès.`,
        },
        onSuccess,
        undefined,
        useFriendlyError
    );
    
    return result !== null;
}

/**
 * Version simplifiée pour les opérations de restauration/copie
 */
export async function invokeActionWithToast(
    command: string,
    args: Record<string, any>,
    toast: ReturnType<typeof useToast>["toast"],
    successMessage: string,
    onSuccess?: () => void
): Promise<boolean> {
    const result = await invokeWithToast(
        command,
        args,
        toast,
        {
            title: "Succès",
            description: successMessage,
        },
        onSuccess
    );
    
    return result !== null;
}

