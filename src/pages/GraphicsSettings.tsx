import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, Settings2 } from "lucide-react";

// Résolutions prédéfinies
const PREDEFINED_RESOLUTIONS = [
    { label: "1920x1080 (Full HD)", width: 1920, height: 1080 },
    { label: "2560x1440 (2K/QHD)", width: 2560, height: 1440 },
    { label: "3340x1440", width: 3340, height: 1440 },
    { label: "3840x2160 (4K/UHD)", width: 3840, height: 2160 },
    { label: "3440x1440 (Ultrawide)", width: 3440, height: 1440 },
    { label: "2560x1080 (Ultrawide)", width: 2560, height: 1080 },
    { label: "1920x1200", width: 1920, height: 1200 },
    { label: "1680x1050", width: 1680, height: 1050 },
    { label: "1366x768", width: 1366, height: 768 },
    { label: "1280x720 (HD)", width: 1280, height: 720 },
    { label: "3840x1080 (Super Ultrawide)", width: 3840, height: 1080 },
    { label: "5120x1440 (Super Ultrawide 2K)", width: 5120, height: 1440 },
];

const CUSTOM_VALUE = "custom";

export default function GraphicsSettings() {
    const { toast } = useToast();
    const [isVulkan, setIsVulkan] = useState(false);
    const [width, setWidth] = useState("1920");
    const [height, setHeight] = useState("1080");
    const [selectedResolution, setSelectedResolution] = useState<string>(CUSTOM_VALUE);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const loadSettings = async () => {
        setIsLoading(true);
        try {
            // Charger le renderer actuel
            const renderer = await invoke<number>("get_graphics_renderer");
            setIsVulkan(renderer === 1);

            // Charger la résolution actuelle
            const resolution = await invoke<[number, number]>("get_user_cfg_resolution");
            const currentWidth = resolution[0];
            const currentHeight = resolution[1];
            setWidth(currentWidth.toString());
            setHeight(currentHeight.toString());

            // Vérifier si la résolution correspond à une résolution prédéfinie
            const matchingResolution = PREDEFINED_RESOLUTIONS.find(
                (res) => res.width === currentWidth && res.height === currentHeight
            );
            if (matchingResolution) {
                setSelectedResolution(`${matchingResolution.width}x${matchingResolution.height}`);
            } else {
                setSelectedResolution(CUSTOM_VALUE);
            }
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Impossible de charger les paramètres",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRendererToggle = async (checked: boolean) => {
        setIsSaving(true);
        try {
            const renderer = checked ? 1 : 0; // 1 = Vulkan, 0 = DirectX 11
            await invoke("set_graphics_renderer", { renderer });
            setIsVulkan(checked);
            toast({
                title: "Succès",
                description: `Renderer changé pour ${checked ? "Vulkan" : "DirectX 11"}`,
                variant: "default",
            });
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Impossible de sauvegarder",
                variant: "destructive",
            });
            // Recharger pour restaurer l'état précédent
            loadSettings();
        } finally {
            setIsSaving(false);
        }
    };

    const handleResolutionChange = (value: string) => {
        setSelectedResolution(value);
        if (value !== CUSTOM_VALUE) {
            const [widthStr, heightStr] = value.split("x");
            const widthNum = parseInt(widthStr);
            const heightNum = parseInt(heightStr);
            if (!isNaN(widthNum) && !isNaN(heightNum)) {
                setWidth(widthNum.toString());
                setHeight(heightNum.toString());
            }
        }
    };

    const handleResolutionSave = async () => {
        const widthNum = parseInt(width);
        const heightNum = parseInt(height);

        if (isNaN(widthNum) || isNaN(heightNum) || widthNum <= 0 || heightNum <= 0) {
            toast({
                title: "Erreur",
                description: "Veuillez entrer des valeurs valides pour la résolution",
                variant: "destructive",
            });
            return;
        }

        setIsSaving(true);
        try {
            await invoke("set_user_cfg_resolution", { width: widthNum, height: heightNum });
            
            // Mettre à jour la sélection si ce n'est pas custom
            const matchingResolution = PREDEFINED_RESOLUTIONS.find(
                (res) => res.width === widthNum && res.height === heightNum
            );
            if (matchingResolution) {
                setSelectedResolution(`${widthNum}x${heightNum}`);
            } else {
                setSelectedResolution(CUSTOM_VALUE);
            }

            toast({
                title: "Succès",
                description: `Résolution mise à jour : ${widthNum}x${heightNum}`,
                variant: "default",
            });
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Impossible de sauvegarder",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    return (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
                duration: 0.8,
                delay: 0.2,
                ease: [0, 0.71, 0.2, 1.01],
            }}
            className="flex flex-col w-full max-h-[calc(100vh-50px)] p-2 pr-3"
        >
            <div className="flex items-center gap-2 mb-4">
                <h1 className="text-2xl mt-5">Paramètres Graphiques</h1>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <p>Chargement des paramètres...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Toggle Vulkan/DirectX */}
                    <Card className="bg-background/40">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings2 className="h-5 w-5" />
                                Renderer Graphique
                            </CardTitle>
                            <CardDescription>
                                Choisissez entre Vulkan et DirectX 11
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label htmlFor="renderer-toggle">
                                        {isVulkan ? "Vulkan" : "DirectX 11"}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {isVulkan 
                                            ? "Vulkan est actuellement activé" 
                                            : "DirectX 11 est actuellement activé"}
                                    </p>
                                </div>
                                <Switch
                                    id="renderer-toggle"
                                    checked={isVulkan}
                                    onCheckedChange={handleRendererToggle}
                                    disabled={isSaving}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Résolution */}
                    <Card className="bg-background/40">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Monitor className="h-5 w-5" />
                                Résolution
                            </CardTitle>
                            <CardDescription>
                                Définissez la résolution d'affichage
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="resolution-select">Résolution</Label>
                                <Select
                                    value={selectedResolution}
                                    onValueChange={handleResolutionChange}
                                    disabled={isSaving}
                                >
                                    <SelectTrigger id="resolution-select">
                                        <SelectValue placeholder="Sélectionnez une résolution" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PREDEFINED_RESOLUTIONS.map((res) => (
                                            <SelectItem
                                                key={`${res.width}x${res.height}`}
                                                value={`${res.width}x${res.height}`}
                                            >
                                                {res.label}
                                            </SelectItem>
                                        ))}
                                        <SelectSeparator />
                                        <SelectItem value={CUSTOM_VALUE}>
                                            Personnalisée
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {selectedResolution === CUSTOM_VALUE && (
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="width">Largeur</Label>
                                        <Input
                                            id="width"
                                            type="number"
                                            value={width}
                                            onChange={(e) => setWidth(e.target.value)}
                                            placeholder="1920"
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="height">Hauteur</Label>
                                        <Input
                                            id="height"
                                            type="number"
                                            value={height}
                                            onChange={(e) => setHeight(e.target.value)}
                                            placeholder="1080"
                                            disabled={isSaving}
                                        />
                                    </div>
                                </div>
                            )}

                            <Button
                                onClick={handleResolutionSave}
                                disabled={isSaving}
                                className="w-full"
                            >
                                {isSaving ? "Sauvegarde..." : "Sauvegarder la résolution"}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}
        </motion.div>
    );
}

