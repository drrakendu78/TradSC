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
import { Monitor, Settings2, Loader2, Cpu } from "lucide-react";
<<<<<<< HEAD
import { GamePaths, isGamePaths } from "@/types/translation";
=======
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b

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
<<<<<<< HEAD
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string>('');

    const loadGameVersions = async () => {
        try {
            const versions = await invoke('get_star_citizen_versions');
            if (isGamePaths(versions)) {
                setGamePaths(versions);
                // Sélectionner LIVE par défaut s'il existe, sinon la première version disponible
                if (versions.versions['LIVE']) {
                    setSelectedVersion('LIVE');
                } else {
                    const firstVersion = Object.keys(versions.versions)[0];
                    if (firstVersion) {
                        setSelectedVersion(firstVersion);
                    }
                }
            }
        } catch (error) {
            console.error('Erreur lors du chargement des versions:', error);
        }
    };
=======
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b

    const loadSettings = async () => {
        setIsLoading(true);
        try {
<<<<<<< HEAD
            // Charger le renderer actuel pour la version sélectionnée
            const renderer = await invoke<number>("get_graphics_renderer", { version: selectedVersion });
            setIsVulkan(renderer === 1);

            // Charger la résolution actuelle pour la version sélectionnée
            const resolution = await invoke<[number, number]>("get_user_cfg_resolution", { version: selectedVersion });
=======
            // Charger le renderer actuel
            const renderer = await invoke<number>("get_graphics_renderer");
            setIsVulkan(renderer === 1);

            // Charger la résolution actuelle
            const resolution = await invoke<[number, number]>("get_user_cfg_resolution");
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
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
<<<<<<< HEAD
            await invoke("set_graphics_renderer", { renderer, version: selectedVersion });
            setIsVulkan(checked);
            toast({
                title: "Succès",
                description: `Renderer changé pour ${checked ? "Vulkan" : "DirectX 11"} (${selectedVersion})`,
=======
            await invoke("set_graphics_renderer", { renderer });
            setIsVulkan(checked);
            toast({
                title: "Succès",
                description: `Renderer changé pour ${checked ? "Vulkan" : "DirectX 11"}`,
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
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
<<<<<<< HEAD
            await invoke("set_user_cfg_resolution", { width: widthNum, height: heightNum, version: selectedVersion });

=======
            await invoke("set_user_cfg_resolution", { width: widthNum, height: heightNum });
            
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
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
<<<<<<< HEAD
                description: `Résolution mise à jour : ${widthNum}x${heightNum} (${selectedVersion})`,
=======
                description: `Résolution mise à jour : ${widthNum}x${heightNum}`,
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
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
<<<<<<< HEAD
        loadGameVersions();
    }, []);

    useEffect(() => {
        if (selectedVersion && gamePaths) {
            loadSettings();
        }
    }, [selectedVersion]);

=======
        loadSettings();
    }, []);

>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                {/* Header */}
<<<<<<< HEAD
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-500/10">
                            <Monitor className="h-6 w-6 text-purple-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Paramètres Graphiques</h1>
                            <p className="text-sm text-muted-foreground">Configurez le rendu et la résolution</p>
                        </div>
                    </div>
                    {gamePaths && Object.keys(gamePaths.versions).length > 0 && (
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="version-select" className="text-xs text-muted-foreground">
                                Version
                            </Label>
                            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                                <SelectTrigger id="version-select" className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.keys(gamePaths.versions).sort().map((version) => (
                                        <SelectItem key={version} value={version}>
                                            {version}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
=======
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                        <Monitor className="h-6 w-6 text-purple-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Paramètres Graphiques</h1>
                        <p className="text-sm text-muted-foreground">Configurez le rendu et la résolution</p>
                    </div>
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-muted-foreground">Chargement des paramètres...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Toggle Vulkan/DirectX */}
                        <Card className="bg-background/40 border border-border/50 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Cpu className="h-5 w-5 text-purple-500" />
                                    Renderer Graphique
                                </CardTitle>
                                <CardDescription>
                                    Choisissez entre Vulkan et DirectX 11
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/30">
                                    <div className="space-y-1">
                                        <Label htmlFor="renderer-toggle" className="text-base font-medium">
                                            {isVulkan ? "🔥 Vulkan" : "⚡ DirectX 11"}
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            {isVulkan 
                                                ? "Meilleure performance sur hardware moderne" 
                                                : "Compatibilité maximale"}
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
                        <Card className="bg-background/40 border border-border/50 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Settings2 className="h-5 w-5 text-blue-500" />
                                    Résolution
                                </CardTitle>
                                <CardDescription>
                                    Définissez la résolution d'affichage
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="resolution-select">Résolution prédéfinie</Label>
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
                                                ✏️ Personnalisée
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {selectedResolution === CUSTOM_VALUE && (
                                    <div className="grid grid-cols-2 gap-4 pt-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="width">Largeur (px)</Label>
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
                                            <Label htmlFor="height">Hauteur (px)</Label>
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
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sauvegarde...
                                        </>
                                    ) : (
                                        "Sauvegarder la résolution"
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

