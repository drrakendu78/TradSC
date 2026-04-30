import { m } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, Settings2, Loader2, Cpu, Zap, Sparkles, Film, Gauge, Eye, Mountain, RefreshCw, Globe2, Keyboard } from "lucide-react";
import { GamePaths, isGamePaths } from "@/types/translation";
import { BindingsEditor } from "@/components/custom/bindings/bindings-editor";

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

const defaultAdvancedSettings: UserCfgSettings = {
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
};

export default function GraphicsSettings() {
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const initialTab = ["general", "presets", "bindings"].includes(searchParams.get("tab") ?? "")
        ? searchParams.get("tab")!
        : "general";
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [gameCheckDone, setGameCheckDone] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [presets, setPresets] = useState<GraphicsPreset[]>([]);
    const [isVulkan, setIsVulkan] = useState(false);
    const [width, setWidth] = useState("1920");
    const [height, setHeight] = useState("1080");
    const [selectedResolution, setSelectedResolution] = useState(CUSTOM_VALUE);
    const [advancedSettings, setAdvancedSettings] = useState<UserCfgSettings>(defaultAdvancedSettings);
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        const queryTab = searchParams.get("tab");
        if (queryTab && ["general", "presets", "bindings"].includes(queryTab) && queryTab !== activeTab) {
            setActiveTab(queryTab);
        }
    }, [activeTab, searchParams]);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        setSearchParams(value === "general" ? {} : { tab: value }, { replace: true });
    };

    const loadGameVersions = async () => {
        try {
            const versions = await invoke('get_star_citizen_versions');
            if (isGamePaths(versions)) {
                const newVersion = versions.versions['LIVE'] ? 'LIVE' : (Object.keys(versions.versions)[0] || '');
                setGamePaths(versions);
                setSelectedVersion(newVersion);
            }
        } catch (error) {
            console.error('Erreur lors du chargement des versions:', error);
        } finally {
            setGameCheckDone(true);
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
            const resolution = await invoke<[number, number]>("get_user_cfg_resolution", { version: selectedVersion });
            const currentWidth = resolution[0];
            const currentHeight = resolution[1];
            const matchingResolution = PREDEFINED_RESOLUTIONS.find(
                (res) => res.width === currentWidth && res.height === currentHeight
            );
            const newSelectedResolution = matchingResolution
                ? `${matchingResolution.width}x${matchingResolution.height}`
                : CUSTOM_VALUE;
            const settings = await invoke<UserCfgSettings>("get_user_cfg_advanced_settings", { version: selectedVersion });
            setIsVulkan(renderer === 1);
            setWidth(currentWidth.toString());
            setHeight(currentHeight.toString());
            setSelectedResolution(newSelectedResolution);
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
        if (value !== CUSTOM_VALUE) {
            const [widthStr, heightStr] = value.split("x");
            const widthNum = parseInt(widthStr);
            const heightNum = parseInt(heightStr);
            if (!isNaN(widthNum) && !isNaN(heightNum)) {
                setSelectedResolution(value);
                setWidth(widthNum.toString());
                setHeight(heightNum.toString());
                return;
            }
        }
        setSelectedResolution(value);
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
            setSelectedResolution(matchingResolution ? `${widthNum}x${heightNum}` : CUSTOM_VALUE);

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

    if (!gameCheckDone) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Recherche des installations de Star Citizen...</p>
            </div>
        );
    }

    if (!gamePaths) {
        return (
            <div className="flex h-full w-full items-center justify-center p-4">
                <section className="w-full max-w-md rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] p-6 text-center backdrop-blur-md">
                    <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                        <Globe2 className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="text-base font-semibold tracking-tight">Aucune version détectée</h2>
                    <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
                        Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                        <kbd className="mx-1.5 rounded-md border border-border/40 bg-background/40 px-1.5 py-0.5 text-[10px] font-mono">CTRL + R</kbd>
                    </p>
                </section>
            </div>
        );
    }

    const totalVersions = Object.keys(gamePaths.versions).length;
    const compactControls = activeTab === "bindings";
    const tabTriggerClass = [
        "group flex h-auto items-center justify-between gap-2 rounded-lg border border-transparent text-left transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 data-[state=active]:-translate-y-[1px] data-[state=active]:border-primary/45 data-[state=active]:bg-[linear-gradient(140deg,hsl(var(--primary)/0.16),hsl(var(--background)/0.36))] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_0_1px_hsl(var(--primary)/0.30),0_10px_24px_hsl(var(--primary)/0.16)]",
        compactControls ? "min-h-[42px] px-2 py-2" : "min-h-[52px] px-2.5 py-2.5",
    ].join(" ");

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className={compactControls ? "flex h-full flex-col gap-2 overflow-y-auto pr-2" : "flex h-full flex-col gap-3.5 overflow-y-auto pr-2"}>
                {/* Header */}
                <section className={compactControls ? "relative px-1 pt-0" : "relative px-1 pt-1.5"}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className={compactControls ? "mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 sm:flex" : "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10"}>
                                <Monitor className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className={compactControls ? "text-lg font-semibold leading-none tracking-tight" : "text-[1.28rem] font-semibold leading-none tracking-tight"}>
                                        {compactControls ? "Controles" : "Paramètres généraux"}
                                    </h1>
                                    {totalVersions > 0 && (
                                        <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                            {totalVersions} version{totalVersions > 1 ? "s" : ""}
                                        </Badge>
                                    )}
                                </div>
                                <p className={compactControls ? "mt-0.5 text-xs text-muted-foreground/90" : "mt-1 text-sm text-muted-foreground/90"}>
                                    {compactControls ? "Modifiez les liaisons, peripheriques et courbes depuis les profils Star Citizen." : "Configurez le rendu, la résolution et les effets visuels"}
                                </p>
                            </div>
                        </div>
                        {totalVersions > 0 && (
                            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                                <SelectTrigger id="version-select" className="h-9 w-32 rounded-lg border-border/40 bg-background/20 text-xs">
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
                        )}
                    </div>
                    <div className={compactControls ? "mt-2 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" : "mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent"} />
                </section>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-muted-foreground">Chargement des paramètres...</p>
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                        <TabsList className={compactControls ? "grid h-auto w-full grid-cols-1 gap-1 rounded-xl border border-border/55 bg-[hsl(var(--background)/0.26)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] md:grid-cols-3" : "grid h-auto w-full grid-cols-1 gap-1.5 rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.26)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] md:grid-cols-3"}>
                            <TabsTrigger
                                value="general"
                                className={tabTriggerClass}
                            >
                                <span className="flex items-center gap-2">
                                    <Settings2 className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em]">Général</span>
                                </span>
                                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    {totalVersions}v
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="presets"
                                className={tabTriggerClass}
                            >
                                <span className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em]">Presets</span>
                                </span>
                                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    {presets.length}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="bindings"
                                className={tabTriggerClass}
                            >
                                <span className="flex items-center gap-2">
                                    <Keyboard className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em]">Controles</span>
                                </span>
                                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    PAK
                                </span>
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="general" className="mt-4 space-y-6">
                            {/* Ligne 1 : Renderer + Résolution */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Cpu className="h-5 w-5 text-purple-500" />
                                            Renderer graphique
                                        </CardTitle>
                                        <CardDescription>
                                            Choisissez entre Vulkan et DirectX 11
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-1">
                                                <Label htmlFor="renderer-toggle" className="text-sm font-medium">
                                                    {isVulkan ? "Vulkan" : "DirectX 11"}
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
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
                                        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                            <p className="text-xs leading-relaxed text-foreground/85">
                                                Vulkan est généralement plus performant sur GPU récents (RTX, RX 6000+). En cas d'instabilité, revenez à DirectX 11.
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Settings2 className="h-5 w-5 text-blue-500" />
                                            Résolution
                                        </CardTitle>
                                        <CardDescription>
                                            Définissez la résolution d'affichage
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="space-y-2 rounded-lg border border-border/30 bg-background/20 p-3">
                                            <Label htmlFor="resolution-select" className="text-xs text-muted-foreground">Résolution prédéfinie</Label>
                                            <Select
                                                value={selectedResolution}
                                                onValueChange={handleResolutionChange}
                                                disabled={isSaving}
                                            >
                                                <SelectTrigger id="resolution-select" className="h-9 rounded-md border-border/40 bg-background/40">
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

                                            {selectedResolution === CUSTOM_VALUE && (
                                                <div className="grid grid-cols-2 gap-3 pt-1">
                                                    <div className="space-y-1.5">
                                                        <Label htmlFor="width" className="text-[11px] text-muted-foreground">Largeur (px)</Label>
                                                        <Input
                                                            id="width"
                                                            type="number"
                                                            value={width}
                                                            onChange={(e) => setWidth(e.target.value)}
                                                            placeholder="1920"
                                                            disabled={isSaving}
                                                            className="h-9 rounded-md border-border/40 bg-background/40"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label htmlFor="height" className="text-[11px] text-muted-foreground">Hauteur (px)</Label>
                                                        <Input
                                                            id="height"
                                                            type="number"
                                                            value={height}
                                                            onChange={(e) => setHeight(e.target.value)}
                                                            placeholder="1080"
                                                            disabled={isSaving}
                                                            className="h-9 rounded-md border-border/40 bg-background/40"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <Button
                                            onClick={handleResolutionSave}
                                            disabled={isSaving}
                                            className="w-full gap-2"
                                        >
                                            {isSaving ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Sauvegarde...
                                                </>
                                            ) : (
                                                "Sauvegarder la résolution"
                                            )}
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Séparateur de section */}
                            <div className="flex items-center gap-3 px-1">
                                <Sparkles className="h-3.5 w-3.5 text-primary/70" />
                                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Paramètres détaillés</span>
                                <div className="flex-1 h-px bg-gradient-to-r from-border/40 via-border/20 to-transparent" />
                            </div>

                            {/* Ligne 2 : Effets visuels + Performance */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Eye className="h-5 w-5 text-blue-500" />
                                            Effets visuels
                                        </CardTitle>
                                        <CardDescription>
                                            Synchronisation, flou et upscaling
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2.5">
                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">VSync</Label>
                                                <p className="text-xs text-muted-foreground">Synchronisation verticale</p>
                                            </div>
                                            <Switch
                                                checked={advancedSettings.r_vsync === 1}
                                                onCheckedChange={(checked) => updateSetting('r_vsync', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">Motion Blur</Label>
                                                <p className="text-xs text-muted-foreground">Flou de mouvement</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_motionblur ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_motionblur', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <div className="flex items-center gap-1.5">
                                                    <Label className="text-sm font-medium">TSR</Label>
                                                    <Badge variant="outline" className="h-4 rounded-md border-primary/30 bg-primary/10 px-1 text-[9px] text-primary">
                                                        Recommandé
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground">Temporal Super Resolution</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_tsr ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_tsr', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Gauge className="h-5 w-5 text-amber-500" />
                                            Performance
                                        </CardTitle>
                                        <CardDescription>
                                            Contrôle du framerate et affichage
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2.5">
                                        <div className="space-y-2.5 rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-sm font-medium">Limite FPS</Label>
                                                <Badge variant="outline" className="h-5 rounded-md border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] font-mono text-amber-500">
                                                    {advancedSettings.sys_maxfps === 0 || advancedSettings.sys_maxfps === null
                                                        ? "∞"
                                                        : `${advancedSettings.sys_maxfps}`}
                                                </Badge>
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
                                            <p className="text-[11px] text-muted-foreground">
                                                0 = illimité · FPS idle : <span className="text-foreground/80">{advancedSettings.sys_maxidlefps ?? 60}</span>
                                            </p>
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">Compteur FPS</Label>
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

                            {/* Ligne 3 : Environnement pleine largeur en grid 2 colonnes interne */}
                            <Card className="rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <Mountain className="h-5 w-5 text-green-500" />
                                        Environnement
                                    </CardTitle>
                                    <CardDescription>
                                        Occlusion, réflexions, ombres et nuages
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">SSDO</Label>
                                                <p className="text-xs text-muted-foreground">Occlusion ambiante</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssdo ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssdo', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">SSR</Label>
                                                <p className="text-xs text-muted-foreground">Screen Space Reflections</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssr ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssr', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">SSR demi-résolution</Label>
                                                <p className="text-xs text-muted-foreground">SSR en demi-res (+ performance)</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_ssreflhalfres ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_ssreflhalfres', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">Nuages volumétriques</Label>
                                                <p className="text-xs text-muted-foreground">Nuages 3D réalistes</p>
                                            </div>
                                            <Switch
                                                checked={(advancedSettings.r_volumetric_clouds ?? 0) > 0}
                                                onCheckedChange={(checked) => updateSetting('r_volumetric_clouds', checked ? 1 : 0)}
                                                disabled={isSaving}
                                            />
                                        </div>

                                        <div className="space-y-2 rounded-lg border border-border/30 bg-background/20 p-3 md:col-span-2">
                                            <Label className="text-sm font-medium">Qualité des ombres</Label>
                                            <Select
                                                value={(advancedSettings.e_shadows ?? 2).toString()}
                                                onValueChange={(value) => updateSetting('e_shadows', parseInt(value))}
                                                disabled={isSaving}
                                            >
                                                <SelectTrigger className="h-9 rounded-md border-border/40 bg-background/40">
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
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Barre d'actions */}
                            <div className="sticky bottom-0 flex gap-3 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.25)] p-3 backdrop-blur-lg shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
                                <Button
                                    onClick={handleAdvancedSettingsSave}
                                    disabled={isSaving}
                                    className="flex-1 gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Sauvegarde...
                                        </>
                                    ) : (
                                        "Sauvegarder tous les paramètres"
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={loadSettings}
                                    disabled={isSaving}
                                    className="gap-2 border-border/40 bg-background/30 backdrop-blur-sm hover:bg-background/50"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    Recharger
                                </Button>
                            </div>
                        </TabsContent>

                        <TabsContent value="presets" className="mt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {presets.map((preset) => (
                                    <Card
                                        key={preset.name}
                                        className="group relative overflow-hidden rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] shadow-none backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.15)] cursor-pointer"
                                        onClick={() => handlePresetApply(preset.name)}
                                    >
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                                        <CardHeader className="pb-3">
                                            <CardTitle className="flex items-center gap-3 text-lg">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/30 bg-background/30">
                                                    {getPresetIcon(preset.name)}
                                                </div>
                                                {preset.name}
                                            </CardTitle>
                                            <CardDescription className="text-sm">
                                                {preset.description}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 px-2.5 py-2 text-xs">
                                                    <span className="text-muted-foreground">VSync</span>
                                                    <span className={`font-medium ${preset.settings.r_vsync === 1 ? "text-green-500" : "text-muted-foreground/60"}`}>
                                                        {preset.settings.r_vsync === 1 ? "On" : "Off"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 px-2.5 py-2 text-xs">
                                                    <span className="text-muted-foreground">Motion Blur</span>
                                                    <span className={`font-medium ${(preset.settings.r_motionblur ?? 0) > 0 ? "text-green-500" : "text-muted-foreground/60"}`}>
                                                        {(preset.settings.r_motionblur ?? 0) > 0 ? "On" : "Off"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 px-2.5 py-2 text-xs">
                                                    <span className="text-muted-foreground">Ombres</span>
                                                    <span className="font-medium text-foreground">
                                                        {["Off", "Basse", "Moyenne", "Haute"][preset.settings.e_shadows ?? 2]}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 px-2.5 py-2 text-xs">
                                                    <span className="text-muted-foreground">FPS</span>
                                                    <span className="font-medium text-foreground">
                                                        {preset.settings.sys_maxfps === 0 ? "∞" : `${preset.settings.sys_maxfps}`}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="default"
                                                className="w-full gap-2"
                                                disabled={isSaving}
                                            >
                                                {isSaving ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
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

                        <TabsContent value="bindings" className="mt-2">
                            <BindingsEditor selectedVersion={selectedVersion} />
                        </TabsContent>

                    </Tabs>
                )}
            </div>
        </m.div>
    );
}
