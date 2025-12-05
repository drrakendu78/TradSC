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
import { Sparkles, Gift } from 'lucide-react';

const STORAGE_KEY = 'startradfr_holiday_wishes_2026_dismissed';

export function HolidayWishesDialog() {
    const [open, setOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    useEffect(() => {
        // Vérifier si l'utilisateur a déjà fermé la popup
        const dismissed = localStorage.getItem(STORAGE_KEY);
        if (!dismissed) {
            // Attendre un peu pour que la page se charge
            const timer = setTimeout(() => {
                setOpen(true);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleClose = (open: boolean) => {
        if (!open) {
            if (dontShowAgain) {
                localStorage.setItem(STORAGE_KEY, 'true');
            }
            setOpen(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent 
                className="sm:max-w-md bg-gradient-to-br from-red-500/20 via-green-500/20 to-background/80 border-primary/30"
            >
                <DialogHeader className="text-center space-y-4">
                    <div className="flex justify-center gap-2 items-center">
                        <Gift className="h-8 w-8 text-red-500" />
                        <Sparkles className="h-6 w-6 text-yellow-400 animate-pulse" />
                        <Gift className="h-8 w-8 text-green-500" />
                    </div>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 bg-clip-text text-transparent">
                        Joyeux Noël 2025 !
                    </DialogTitle>
                    <DialogDescription className="text-base text-foreground space-y-3 pt-2">
                        <p className="font-medium">
                            Toute l'équipe de StarTrad FR vous souhaite de merveilleuses fêtes de fin d'année ! 🎄✨
                        </p>
                        <p>
                            Que 2026 vous apporte de nombreuses aventures dans l'univers de Star Citizen, des sessions de jeu mémorables et surtout, beaucoup de plaisir à explorer les étoiles ! 🚀
                        </p>
                        <p className="text-sm text-muted-foreground italic">
                            Merci de faire partie de notre communauté. Vos retours et votre soutien nous motivent chaque jour à améliorer l'application.
                        </p>
                    </DialogDescription>
                </DialogHeader>
                
                <div className="flex items-center space-x-2 pt-4 pb-2">
                    <Checkbox
                        id="dont-show-again"
                        checked={dontShowAgain}
                        onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                    />
                    <label
                        htmlFor="dont-show-again"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                        Ne plus afficher ce message
                    </label>
                </div>

                <div className="flex justify-end pt-2">
                    <Button onClick={() => handleClose(false)} className="gap-2">
                        <Sparkles className="h-4 w-4" />
                        Merci et bonne année !
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

