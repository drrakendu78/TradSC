import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface AnnouncementDialogProps {
    /** Clé unique pour cette annonce (utilisée pour localStorage) */
    storageKey: string;
    /** Titre de l'annonce */
    title: string;
    /** Message principal de l'annonce */
    message: string;
    /** Message secondaire optionnel (affiché en italique) */
    secondaryMessage?: string;
    /** Icône optionnelle à afficher (ReactNode) */
    icon?: React.ReactNode;
    /** Délai avant l'affichage (en ms, défaut: 500) */
    delay?: number;
    /** Couleurs de fond personnalisées (défaut: gradient primaire) */
    gradientColors?: string;
    /** Texte du bouton (défaut: "Fermer") */
    buttonText?: string;
    /** Afficher la case "Ne plus afficher" (défaut: true) */
    showDontShowAgain?: boolean;
}

export function AnnouncementDialog({
    storageKey,
    title,
    message,
    secondaryMessage,
    icon,
    delay = 500,
    gradientColors = "from-primary/20 via-primary/10 to-background/80",
    buttonText = "Fermer",
    showDontShowAgain = true,
}: AnnouncementDialogProps) {
    const [open, setOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    useEffect(() => {
        // Vérifier si l'utilisateur a déjà fermé cette annonce
        const dismissed = localStorage.getItem(storageKey);
        if (!dismissed) {
            // Attendre le délai spécifié avant d'afficher
            const timer = setTimeout(() => {
                setOpen(true);
            }, delay);
            return () => clearTimeout(timer);
        }
    }, [storageKey, delay]);

    const handleClose = (open: boolean) => {
        if (!open) {
            if (dontShowAgain && showDontShowAgain) {
                localStorage.setItem(storageKey, 'true');
            }
            setOpen(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent 
                className={`sm:max-w-md bg-gradient-to-br ${gradientColors} border-primary/30`}
            >
                <DialogHeader className="text-center space-y-4">
                    {icon && (
                        <div className="flex justify-center items-center">
                            {icon}
                        </div>
                    )}
                    <DialogTitle className="text-2xl font-bold">
                        {title}
                    </DialogTitle>
                    <DialogDescription className="text-base text-foreground space-y-3 pt-2">
                        <p className="font-medium">
                            {message}
                        </p>
                        {secondaryMessage && (
                            <p className="text-sm text-muted-foreground italic">
                                {secondaryMessage}
                            </p>
                        )}
                    </DialogDescription>
                </DialogHeader>
                
                {showDontShowAgain && (
                    <div className="flex items-center space-x-2 pt-4 pb-2">
                        <Checkbox
                            id={`dont-show-again-${storageKey}`}
                            checked={dontShowAgain}
                            onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                        />
                        <label
                            htmlFor={`dont-show-again-${storageKey}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                            Ne plus afficher ce message
                        </label>
                    </div>
                )}

                <div className="flex justify-end pt-2">
                    <Button onClick={() => handleClose(false)} className="gap-2">
                        {buttonText}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

