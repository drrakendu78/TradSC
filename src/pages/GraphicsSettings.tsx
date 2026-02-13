import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, Settings2, Loader2, Cpu, Zap, Sparkles, Film, Gauge, Eye, Mountain, RefreshCw } from "lucide-react";
import { GamePaths, isGamePaths } from "@/types/translation";

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

// Paramètres confirmés dans la console SC 4.5/4.6
interface UserCfgSettings {
    r_vsync: number | null;
    r_motionblur: number | null;
    sys_maxfps: number | null;
    sys_maxidlefps: number | null;
    r_displayinfo: number | null;
    r_ssdo: number | null;
    r_ssr: number | null;
    r_ssreflhalfres: number | null;
    r_tsr: number | null;
    e_shadows: number | null;
    r_volumetric_clouds: number | null;
}

interface GraphicsPreset {
    name: string;
    description: string;
    settings: UserCfgSettings;
}

export default function GraphicsSettings() {
    const { toast } = useToast();
    const [isVulkan, setIsVulkan] = useState(false);
    const [width, setWidth] = useState("1920");
    const [height, setHeight] = useState("1080");
    const [selectedResolution, setSelectedResolution] = useState<string>(CUSTOM_VALUE);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [advancedSettings, setAdvancedSettings] = useState<UserCfgSettings>({
        r_vsync: null,
        r_motionblur: null,
        sys_maxfps: null,
        sys_maxidlefps: null,
        r_displayinfo: null,
        r_ssdo: null,
        r_ssr: null,
        r_ssreflhalfres: null,
        r_tsr: null,
        e_shadows: null,
        r_volumetric_clouds: null,
    });
    const [presets, setPresets] = useState<GraphicsPreset[]>([]);
    const [activeTab, setActiveTab] = useState("general");

    const loadGameVersions = async () => {
        try {
            const versions = await invoke('get_star_citizen_versions');
            if (isGamePaths(versions)) {
                setGamePaths(versions);
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

    const loadPresets = async () => {
        try {
            const loadedPresets = await invoke<GraphicsPreset[]>('get_graphics_presets');
            setPresets(loadedPresets);
        } catch (error) {
            console.error('Erreur lors du chargement des presets:', error);
        }
    };

    const loadSettings = async () => {
        setIsLoading(true);
        try {
            const renderer = await invoke<number>("get_graphics_renderer", { version: selectedVersion });
            setIsVulkan(renderer === 1);

            const resolution = await invoke<[number, number]>("get_user_cfg_resolution", { version: selectedVersion });
            const currentWidth = resolution[0];
            const currentHeight = resolution[1];
            setWidth(currentWidth.toString());
            setHeight(currentHeight.toString());

            const matchingResolution = PREDEFINED_RESOLUTIONS.find(
                (res) => res.width === currentWidth && res.height === currentHeight
            );
            if (matchingResolution) {
                setSelectedResolution(`${matchingResolution.width}x${matchingResolution.height}`);
            } else {
                setSelectedResolution(CUSTOM_VALUE);
            }

            const settings = await invoke<UserCfgSettings>("get_user_cfg_advanced_settings", { version: selectedVersion });
            setAdvancedSettings(settings);
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
            const renderer = checked ? 1 : 0;
            await invoke("set_graphics_renderer", { renderer, version: selectedVersion });
            setIsVulkan(checked);
            toast({
                title: "Succès",
                description: `Renderer changé pour ${checked ? "Vulkan" : "DirectX 11"} (${selectedVersion})`,
                variant: "default",
            });
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Impossible de sauvegarder",
                variant: "destructive",
            });
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
            await invoke("set_user_cfg_resolution", { width: widthNum, height: heightNum, version: selectedVersion });

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
                description: `Résolution mise à jour : ${widthNum}x${heightNum} (${selectedVersion})`,
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

    const handlePresetApply = async (presetName: string) => {
        setIsSaving(true);
        try {
            await invoke("apply_graphics_preset", { presetName, version: selectedVersion });
            const preset = presets.find(p => p.name === presetName);
            if (preset) {
                setAdvancedSettings(prev => ({ ...prev, ...preset.settings }));
            }
            toast({
                title: "Preset appliqué",
                description: `Le preset "${presetName}" a été appliqué avec succès`,
                variant: "default",
            });
        } catch (error) {
            toast({
                title: "Erreur",
                description: error instanceof Error ? error.message : "Impossible d'appliquer le preset",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdvancedSettingsSave = async () => {
        setIsSaving(true);
        try {
            await invoke("set_user_cfg_advanced_settings", { settings: advancedSettings, version: selectedVersion });
            toast({
                title: "Succès",
                description: "Paramètres avancés sauvegardés",
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

    const updateSetting = async <K extends keyof UserCfgSettings>(key: K, value: UserCfgSettings[K]) => {
        const newSettings = { ...advancedSettings, [key]: value };
        setAdvancedSettings(newSettings);

        try {
            await invoke("set_user_cfg_advanced_settings", { settings: newSettings, version: selectedVersion });
        } catch (error) {
            console.error("Erreur sauvegarde auto:", error);
        }
    };


    useEffect(() => {
        loadGameVersions();
        loadPresets();
    }, []);

    useEffect(() => {
        if (selectedVersion && gamePaths) {
            loadSettings();
        }
    }, [selectedVersion]);

    const getPresetIcon = (name: string) => {
        switch (name) {
            case "Performance": return <Zap className="h-5 w-5 text-green-500" />;
            case "Equilibre": return <Gauge className="h-5 w-5 text-blue-500" />;
            case "Qualite": return <Sparkles className="h-5 w-5 text-purple-500" />;
            case "Cinematique": return <Film className="h-5 w-5 text-amber-500" />;
            default: return <Settings2 className="h-5 w-5" />;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-500/10">
                            <Monitor className="h-6 w-6 text-purple-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Paramètres Graphiques</h1>
                            <p className="text-sm text-muted-foreground">Configurez le rendu, la résolution et les effets visuels</p>
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
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-muted-foreground">Chargement des paramètres...</p>
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="general">Général</TabsTrigger>
                            <TabsTrigger value="presets">Presets</TabsTrigger>
                            <TabsTrigger value="advanced">Avancé</TabsTrigger>
                        </TabsList>

                        <TabsContent value="general" className="mt-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                                                    {isVulkan ? "Vulkan" : "DirectX 11"}
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
                                                        Personnalisée
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
                        </TabsContent>

                        <TabsContent value="presets" className="mt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {presets.map((preset) => (
                                    <Card
                                        key={preset.name}
                                        className="bg-background/40 border border-border/50 shadow-sm hover:border-primary/50 transition-all cursor-pointer hover:shadow-lg"
                                        onClick={() => handlePresetApply(preset.name)}
                                    >
                                        <CardHeader className="pb-3">
                                            <CardTitle className="flex items-center gap-3 text-xl">
                                                <div className="p-2 rounded-lg bg-muted/50">
                                                    {getPresetIcon(preset.name)}
                                                </div>
                                                {preset.name}
                                            </CardTitle>
                                            <CardDescription className="text-sm mt-2">
                                                {preset.description}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                                    <span className="text-muted-foreground">VSync:</span>
                                                    <span className={preset.settings.r_vsync === 1 ? "text-green-500" : "text-red-500"}>
                                                        {preset.settings.r_vsync === 1 ? "On" : "Off"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                                    <span className="text-muted-foreground">Motion Blur:</span>
                                                    <span className={(preset.settings.r_motionblur ?? 0) > 0 ? "text-green-500" : "text-red-500"}>
                                                        {(preset.settings.r_motionblur ?? 0) > 0 ? "On" : "Off"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                                    <span className="text-muted-foreground">Ombres:</span>
                                                    <span className="text-foreground">
                                                        {["Off", "Basse", "Moyenne", "Haute"][preset.settings.e_shadows ?? 2]}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                                    <span className="text-muted-foreground">FPS Limit:</span>
                                                    <span className="text-foreground">
                                                        {preset.settings.sys_maxfps === 0 ? "Illimité" : `${preset.settings.sys_maxfps}`}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="default"
                                                className="w-full"
                                                disabled={isSaving}
                                            >
                                                {isSaving ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Application...
                                                    </>
                                                ) : (
                                                    "Appliquer ce preset"
                                                )}
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </TabsContent>

                        <TabsContent value="advanced" className="mt-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Colonne gauche : Effets visuels + Performance */}
                                <div className="flex flex-col gap-6">
                                    <Card className="bg-background/40 border border-border/50 shadow-sm">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2 text-lg">
                                                <Eye className="h-5 w-5 text-blue-500" />
                                                Effets visuels
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>VSync</Label>
                                                    <p className="text-xs text-muted-foreground">Synchronisation verticale</p>
                                                </div>
                                                <Switch
                                                    checked={advancedSettings.r_vsync === 1}
                                                    onCheckedChange={(checked) => updateSetting('r_vsync', checked ? 1 : 0)}
                                                    disabled={isSaving}
                                                />
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>Motion Blur</Label>
                                                    <p className="text-xs text-muted-foreground">Flou de mouvement</p>
                                                </div>
                                                <Switch
                                                    checked={(advancedSettings.r_motionblur ?? 0) > 0}
                                                    onCheckedChange={(checked) => updateSetting('r_motionblur', checked ? 1 : 0)}
                                                    disabled={isSaving}
                                                />
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>TSR (Temporal Super Resolution)</Label>
                                                    <p className="text-xs text-muted-foreground">Upscaling temporel (recommandé)</p>
                                                </div>
                                                <Switch
                                                    checked={(advancedSettings.r_tsr ?? 0) > 0}
                                                    onCheckedChange={(checked) => updateSetting('r_tsr', checked ? 1 : 0)}
                                                    disabled={isSaving}
                                                />
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-background/40 border border-border/50 shadow-sm">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2 text-lg">
                                                <Gauge className="h-5 w-5 text-amber-500" />
                                                Performance
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <Label>Limite FPS</Label>
                                                    <span className="text-xs text-muted-foreground">
                                                        {advancedSettings.sys_maxfps === 0 || advancedSettings.sys_maxfps === null
                                                            ? "Illimité"
                                                            : `${advancedSettings.sys_maxfps} FPS`}
                                                    </span>
                                                </div>
                                                <Slider
                                                    value={[advancedSettings.sys_maxfps ?? 0]}
                                                    onValueChange={([value]) => {
                                                        const idleFps = value === 0 ? 60 : value;
                                                        const newSettings = {
                                                            ...advancedSettings,
                                                            sys_maxfps: value,
                                                            sys_maxidlefps: idleFps
                                                        };
                                                        setAdvancedSettings(newSettings);
                                                        invoke("set_user_cfg_advanced_settings", { settings: newSettings, version: selectedVersion }).catch(console.error);
                                                    }}
                                                    max={240}
                                                    step={10}
                                                    disabled={isSaving}
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    0 = Illimité | FPS idle : {advancedSettings.sys_maxidlefps ?? 60}
                                                </p>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>Compteur FPS</Label>
                                                    <p className="text-xs text-muted-foreground">Affiche les FPS en jeu</p>
                                                </div>
                                                <Switch
                                                    checked={(advancedSettings.r_displayinfo ?? 0) > 0}
                                                    onCheckedChange={(checked) => updateSetting('r_displayinfo', checked ? 1 : 0)}
                                                    disabled={isSaving}
                                                />
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Colonne droite : Environnement */}
                                <Card className="bg-background/40 border border-border/50 shadow-sm">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Mountain className="h-5 w-5 text-green-500" />
                                            Environnement
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label>SSDO (Ambient Occlusion)</Label>
                                                <p className="text-xs text-muted-foreground">Occlusion ambiante</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssdo ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssdo', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label>SSR (Screen Space Reflections)</Label>
                                                <p className="text-xs text-muted-foreground">Réflexions en espace écran</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssr ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssr', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label>SSR demi-résolution</Label>
                                                <p className="text-xs text-muted-foreground">SSR en demi-res (+ performance)</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssreflhalfres ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssreflhalfres', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label>Nuages volumétriques</Label>
                                                <p className="text-xs text-muted-foreground">Nuages 3D réalistes</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_volumetric_clouds ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_volumetric_clouds', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Qualité des ombres</Label>
                                            <Select
                                                value={(advancedSettings.e_shadows ?? 2).toString()}
                                                onValueChange={(value) => updateSetting('e_shadows', parseInt(value))}
                                                disabled={isSaving}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="0">Désactivées</SelectItem>
                                                    <SelectItem value="1">Basse</SelectItem>
                                                    <SelectItem value="2">Moyenne</SelectItem>
                                                    <SelectItem value="3">Haute</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="mt-6 flex gap-4">
                                <Button
                                    onClick={handleAdvancedSettingsSave}
                                    disabled={isSaving}
                                    className="flex-1"
                                >
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sauvegarde...
                                        </>
                                    ) : (
                                        "Sauvegarder les paramètres avancés"
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={loadSettings}
                                    disabled={isSaving}
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Recharger
                                </Button>
                            </div>
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </motion.div>
    );
}
