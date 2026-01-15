import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCustomLinksStore, CustomLink } from "@/stores/custom-links-store";
import {
    Trash2, Info, Globe, Link, Star, Heart, Bookmark, Folder,
    Gamepad2, Rocket, Target, Trophy,
    MessageCircle, Users, Share2,
    Wrench, Calculator, Map, Compass,
    Image, Video, Music, FileText, ChevronDown, type LucideIcon
} from "lucide-react";

// Liste des icônes disponibles
const AVAILABLE_ICONS: { name: string; icon: LucideIcon }[] = [
    { name: "Globe", icon: Globe },
    { name: "Link", icon: Link },
    { name: "Star", icon: Star },
    { name: "Heart", icon: Heart },
    { name: "Bookmark", icon: Bookmark },
    { name: "Folder", icon: Folder },
    { name: "Gamepad2", icon: Gamepad2 },
    { name: "Rocket", icon: Rocket },
    { name: "Target", icon: Target },
    { name: "Trophy", icon: Trophy },
    { name: "MessageCircle", icon: MessageCircle },
    { name: "Users", icon: Users },
    { name: "Share2", icon: Share2 },
    { name: "Wrench", icon: Wrench },
    { name: "Calculator", icon: Calculator },
    { name: "Map", icon: Map },
    { name: "Compass", icon: Compass },
    { name: "Image", icon: Image },
    { name: "Video", icon: Video },
    { name: "Music", icon: Music },
    { name: "FileText", icon: FileText },
];

// Export pour utilisation dans la sidebar
export const getIconByName = (name?: string): LucideIcon => {
    const found = AVAILABLE_ICONS.find(i => i.name === name);
    return found?.icon || Link;
};

interface CustomLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingLink?: CustomLink | null;
}

export default function CustomLinkDialog({
    open,
    onOpenChange,
    editingLink,
}: CustomLinkDialogProps) {
    const { toast } = useToast();
    const { addLink, updateLink, removeLink } = useCustomLinksStore();
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [selectedIcon, setSelectedIcon] = useState("Link");
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [iconPopoverOpen, setIconPopoverOpen] = useState(false);

    // Réinitialiser les champs quand le dialog s'ouvre
    useEffect(() => {
        if (open) {
            if (editingLink) {
                setName(editingLink.name);
                setUrl(editingLink.url);
                setSelectedIcon(editingLink.icon || "Link");
            } else {
                setName("");
                setUrl("");
                setSelectedIcon("Link");
            }
            setShowDeleteConfirm(false);
        }
    }, [open, editingLink]);

    const isValidUrl = (urlString: string): boolean => {
        try {
            const u = new URL(urlString);
            return u.protocol === "https:" || u.protocol === "http:";
        } catch {
            return false;
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedName = name.trim();
        const trimmedUrl = url.trim();

        if (!trimmedName) {
            toast({
                title: "Erreur",
                description: "Le nom est requis",
                variant: "destructive",
            });
            return;
        }

        if (trimmedName.length > 50) {
            toast({
                title: "Erreur",
                description: "Le nom ne peut pas dépasser 50 caractères",
                variant: "destructive",
            });
            return;
        }

        if (!trimmedUrl) {
            toast({
                title: "Erreur",
                description: "L'URL est requise",
                variant: "destructive",
            });
            return;
        }

        if (!isValidUrl(trimmedUrl)) {
            toast({
                title: "Erreur",
                description: "L'URL doit commencer par http:// ou https://",
                variant: "destructive",
            });
            return;
        }

        if (editingLink) {
            updateLink(editingLink.id, trimmedName, trimmedUrl, selectedIcon);
            toast({
                title: "Lien modifié",
                description: `"${trimmedName}" a été mis à jour`,
            });
        } else {
            addLink(trimmedName, trimmedUrl, selectedIcon);
            toast({
                title: "Lien ajouté",
                description: `"${trimmedName}" a été ajouté à vos liens`,
            });
        }

        onOpenChange(false);
    };

    const handleDelete = () => {
        if (!editingLink) return;

        if (!showDeleteConfirm) {
            setShowDeleteConfirm(true);
            return;
        }

        removeLink(editingLink.id);
        toast({
            title: "Lien supprimé",
            description: `"${editingLink.name}" a été supprimé`,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {editingLink ? "Modifier le lien" : "Ajouter un lien"}
                    </DialogTitle>
                    <DialogDescription>
                        {editingLink
                            ? "Modifiez les informations du lien"
                            : "Ajoutez un lien personnalisé vers un site externe"}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="link-name">Nom</Label>
                        <Input
                            id="link-name"
                            placeholder="Mon site préféré"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={50}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="link-url">URL</Label>
                        <Input
                            id="link-url"
                            type="url"
                            placeholder="https://exemple.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Icône</Label>
                        <Popover open={iconPopoverOpen} onOpenChange={setIconPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-between"
                                >
                                    <div className="flex items-center gap-2">
                                        {(() => {
                                            const IconComp = getIconByName(selectedIcon);
                                            return <IconComp size={18} />;
                                        })()}
                                        <span className="text-muted-foreground">{selectedIcon}</span>
                                    </div>
                                    <ChevronDown size={16} className="text-muted-foreground" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2 bg-popover border border-border shadow-lg" align="start">
                                <div className="grid grid-cols-7 gap-1">
                                    {AVAILABLE_ICONS.map(({ name: iconName, icon: IconComponent }) => (
                                        <button
                                            key={iconName}
                                            type="button"
                                            onClick={() => {
                                                setSelectedIcon(iconName);
                                                setIconPopoverOpen(false);
                                            }}
                                            className={`
                                                w-8 h-8 flex items-center justify-center rounded-md transition-all duration-150
                                                ${selectedIcon === iconName
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                                                }
                                            `}
                                            title={iconName}
                                        >
                                            <IconComponent size={16} />
                                        </button>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>
                            Vos liens sont sauvegardés localement. Pour les synchroniser sur tous vos appareils,
                            connectez-vous et utilisez "Sauvegarder les préférences" sur la page d'accueil.
                        </span>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        {editingLink && (
                            <Button
                                type="button"
                                variant={showDeleteConfirm ? "destructive" : "outline"}
                                onClick={handleDelete}
                                className="mr-auto"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {showDeleteConfirm ? "Confirmer" : "Supprimer"}
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Annuler
                        </Button>
                        <Button type="submit">
                            {editingLink ? "Enregistrer" : "Ajouter"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
