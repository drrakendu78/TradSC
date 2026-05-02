import { m } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Globe2,
    Brush,
    Users,
    Download,
    FileText,
    Newspaper,
    Keyboard,
    Monitor,
    Rocket,
    ArrowRight,
    Sparkles,
    Map,
    Eye,
    EyeOff,
    ExternalLink,
    Play,
    Clock,
    FileDown,
    FileUp,
    Cloud,
    CloudUpload,
    CloudDownload,
    Loader2,
    Palette,
    PanelLeft,
    BarChart3,
    Trash2,
    AlertCircle,
    AppWindow,
    FolderOpen,
    Pencil,
    Save,
    Settings2,
    X,
    Zap,
    CircleCheck,
    Gamepad2
} from 'lucide-react';
import { usePreferencesSyncStore, ExportedPreferences } from '@/stores/preferences-sync-store';
import { useStatsStore } from '@/stores/stats-store';
import { supabase } from '@/lib/supabase';
import RecentPatchNotes from '@/components/custom/recent-patchnotes';
import RecentActualites from '@/components/custom/recent-actualites';
import { AnnouncementDialog } from '@/components/custom/announcement-dialog';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/utils/tauri-helpers';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ProjectorShadow, type ProjectorShadowSettings } from '@/utils/ambilight/projector-shadow';
import { detectDistribution } from '@/utils/buildInfo';

const IS_MICROSOFT_STORE = detectDistribution() === 'microsoft-store';

interface LauncherStatus {
    installed: boolean;
    path: string | null;
}

interface LauncherActivityStatus {
    launcher_running: boolean;
    game_running: boolean;
}

interface VersionPlaytime {
    version: string;
    hours: number;
    formatted: string;
    session_count: number;
}

interface PlaytimeStats {
    total_hours: number;
    formatted: string;
    session_count: number;
    by_version: VersionPlaytime[];
}

interface ThirdPartyApplication {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

interface ThirdPartyApplicationDraft {
    name: string;
    path: string;
    enabled: boolean;
}

// ============================================
// CONFIGURATION DE LA POPUP D'ANNONCE
// ============================================
// Pour activer une annonce, modifie les valeurs ci-dessous
// Pour désactiver, mets showAnnouncement à false
const ANNOUNCEMENT_CONFIG = {
    showAnnouncement: false,
    storageKey: "startradfr_noel_2025",
    title: "🎄 Joyeuses Fêtes !",
    message: "Toute l'équipe de StarTrad FR vous souhaite un Joyeux Noël et une excellente année 2026 ! 🎅✨",
    secondaryMessage: "Merci de faire partie de notre communauté de Citizens francophones. À l'année prochaine dans le 'verse ! 🚀",
    buttonText: "Bonne année ! 🎉",
    delay: 500,
};
// ============================================

// Animation variants pour les cartes
const cardVariants = {
    hidden: { opacity: 1, y: 0 },
    visible: { opacity: 1, y: 0 },
};

// Bouton d'action rapide
interface QuickActionProps {
    to: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    color: string;
    index: number;
}

function QuickAction({ to, icon, title, description, color, index }: QuickActionProps) {
    return (
        <m.div
            custom={index}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
        >
            <Link to={to} className="block group">
                <div className="relative overflow-hidden rounded-xl border border-border/30 bg-background/60 transition-all duration-200 hover:border-primary/35 hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)]">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <div className="flex items-center gap-3 p-3.5">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${color}`}>
                            {icon}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-[12.5px] font-semibold leading-none transition-colors group-hover:text-primary">
                                {title}
                            </h3>
                            <p className="mt-1 truncate text-[11px] text-foreground/70 dark:text-muted-foreground/65">
                                {description}
                            </p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                </div>
            </Link>
        </m.div>
    );
}

const LAUNCHER_CACHE_KEY = 'startradfr_launcher_status';
const PLAYTIME_CACHE_KEY = 'startradfr_playtime_cache';
const THIRD_PARTY_APPS_STORAGE_KEY = 'startradfr_third_party_apps';
const AMBILIGHT_PRESET_STORAGE_KEY = 'ambilightPreset';
const DEFAULT_LAUNCHER_ACTIVITY: LauncherActivityStatus = {
    launcher_running: false,
    game_running: false,
};
type AmbilightPreset = 'soft' | 'cinema' | 'intense';

interface AmbilightPresetSettings {
    render: {
        blur2: number;
        edge: number;
        spread: number;
    };
    innerStrength: number;
    topOverflowMin: number;
    bottomOverflowMin: number;
    sideMask: {
        edgeAlpha: number;
        midAlpha: number;
        innerAlpha: number;
    };
    shadow: ProjectorShadowSettings;
}

const HERO_AMBILIGHT_PRESETS: Record<AmbilightPreset, AmbilightPresetSettings> = {
    soft: {
        render: { blur2: 24, edge: 10, spread: 14 },
        innerStrength: 2,
        topOverflowMin: 90,
        bottomOverflowMin: 170,
        sideMask: { edgeAlpha: 0.2, midAlpha: 0.5, innerAlpha: 0.84 },
        shadow: {
            spreadFadeCurve: 35,
            spreadFadeStart: 15,
            directionTopEnabled: true,
            directionRightEnabled: true,
            directionBottomEnabled: true,
            directionLeftEnabled: true,
        },
    },
    cinema: {
        render: { blur2: 30, edge: 12, spread: 17 },
        innerStrength: 2,
        topOverflowMin: 110,
        bottomOverflowMin: 210,
        sideMask: { edgeAlpha: 0.14, midAlpha: 0.42, innerAlpha: 0.86 },
        shadow: {
            spreadFadeCurve: 35,
            spreadFadeStart: 15,
            directionTopEnabled: true,
            directionRightEnabled: true,
            directionBottomEnabled: true,
            directionLeftEnabled: true,
        },
    },
    intense: {
        render: { blur2: 40, edge: 14, spread: 22 },
        innerStrength: 2,
        topOverflowMin: 155,
        bottomOverflowMin: 280,
        sideMask: { edgeAlpha: 0.1, midAlpha: 0.32, innerAlpha: 0.9 },
        shadow: {
            spreadFadeCurve: 35,
            spreadFadeStart: 15,
            directionTopEnabled: true,
            directionRightEnabled: true,
            directionBottomEnabled: true,
            directionLeftEnabled: true,
        },
    },
};

function isAmbilightPreset(value: string | null): value is AmbilightPreset {
    return value === 'soft' || value === 'cinema' || value === 'intense';
}

function getCachedLauncherStatus(): LauncherStatus {
    try {
        const cached = localStorage.getItem(LAUNCHER_CACHE_KEY);
        if (cached) return JSON.parse(cached) as LauncherStatus;
    } catch {}
    return { installed: false, path: null };
}

function getCachedPlaytime(): PlaytimeStats | null {
    try {
        const cached = localStorage.getItem(PLAYTIME_CACHE_KEY);
        if (cached) return JSON.parse(cached) as PlaytimeStats;
    } catch {}
    return null;
}

function createThirdPartyApplicationId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `third-party-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getFilenameFromPath(path: string) {
    return path.split(/[\\/]/).pop() || path;
}

function getApplicationNameFromPath(path: string) {
    const filename = getFilenameFromPath(path).trim();
    return filename.replace(/\.[^.]+$/, '') || 'Application tierce';
}

function readThirdPartyApplications(): ThirdPartyApplication[] {
    try {
        const raw = localStorage.getItem(THIRD_PARTY_APPS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((item): item is Partial<ThirdPartyApplication> =>
                Boolean(item) && typeof item === 'object' && typeof item.path === 'string'
            )
            .map((item) => {
                const now = new Date().toISOString();
                const name =
                    typeof item.name === 'string' && item.name.trim()
                        ? item.name.trim()
                        : getApplicationNameFromPath(item.path || '');

                return {
                    id: typeof item.id === 'string' && item.id ? item.id : createThirdPartyApplicationId(),
                    name,
                    path: item.path || '',
                    enabled: item.enabled !== false,
                    createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
                    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
                };
            })
            .filter((item) => item.path.trim().length > 0);
    } catch {}
    return [];
}

function writeThirdPartyApplications(apps: ThirdPartyApplication[]) {
    try {
        localStorage.setItem(THIRD_PARTY_APPS_STORAGE_KEY, JSON.stringify(apps));
    } catch {}
}

function Home() {
    const [showContent, setShowContent] = useState(true);
    const [isInTauri] = useState(() => isTauri());
    const [launcherStatus, setLauncherStatus] = useState<LauncherStatus>(() => getCachedLauncherStatus());
    const [launcherActivity, setLauncherActivity] = useState<LauncherActivityStatus>(DEFAULT_LAUNCHER_ACTIVITY);
    const [playtime, setPlaytime] = useState<PlaytimeStats | null>(() => getCachedPlaytime());
    const [launchingLauncher, setLaunchingLauncher] = useState(false);
    const [thirdPartyApps, setThirdPartyApps] = useState<ThirdPartyApplication[]>(() => readThirdPartyApplications());
    const [showThirdPartyAppsDialog, setShowThirdPartyAppsDialog] = useState(false);
    const [editingThirdPartyAppId, setEditingThirdPartyAppId] = useState<string | null>(null);
    const [thirdPartyAppDraft, setThirdPartyAppDraft] = useState<ThirdPartyApplicationDraft>({
        name: '',
        path: '',
        enabled: true,
    });
    const [launchingThirdPartyAppId, setLaunchingThirdPartyAppId] = useState<string | null>(null);
    const [isBackgroundVideoEnabled, setIsBackgroundVideoEnabled] = useState(() => {
        const saved = localStorage.getItem('backgroundVideoEnabled');
        return saved === null ? true : saved === 'true';
    });
    const [ambilightPreset, setAmbilightPreset] = useState<AmbilightPreset>(() => {
        const saved = localStorage.getItem(AMBILIGHT_PRESET_STORAGE_KEY);
        return isAmbilightPreset(saved) ? saved : 'soft';
    });
    const ambilightSettings = HERO_AMBILIGHT_PRESETS[ambilightPreset];
    const ambilightLevels = Math.max(
        2,
        Math.round(ambilightSettings.render.spread / ambilightSettings.render.edge) +
            ambilightSettings.innerStrength +
            1
    );
    const { toast } = useToast();
    const { savedPlaytimeHours } = useStatsStore();

    // Préférences app
    const {
        exportPreferences,
        importPreferences,
        saveToCloud,
        loadFromCloud,
        deleteFromCloud,
        isSyncing
    } = usePreferencesSyncStore();
    const [userId, setUserId] = useState<string | null>(null);
    const [prefsSaving, setPrefsSaving] = useState(false);
    const [prefsDeleting, setPrefsDeleting] = useState(false);
    const [showCloudPrefsDialog, setShowCloudPrefsDialog] = useState(false);
    const [showCloudPrefsManager, setShowCloudPrefsManager] = useState(false);
    const [cloudPrefsPreview, setCloudPrefsPreview] = useState<ExportedPreferences | null>(null);
    const [hasCloudPrefs, setHasCloudPrefs] = useState(false);
    const [checkingCloudPrefs, setCheckingCloudPrefs] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const heroVideoRef = useRef<HTMLVideoElement>(null);
    const heroCardRef = useRef<HTMLDivElement>(null);
    const heroAmbilightFilterRef = useRef<HTMLDivElement>(null);
    const heroAmbilightClipRef = useRef<HTMLDivElement>(null);
    const heroAmbilightProjectorsRef = useRef<HTMLDivElement>(null);
    const heroAmbilightProjectorListRef = useRef<HTMLDivElement>(null);
    const heroAmbilightShadowRef = useRef<HTMLCanvasElement>(null);
    const heroAmbilightProjectorRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const heroAmbilightRafRef = useRef<number | null>(null);

    const refreshLauncherActivity = async () => {
        if (!isInTauri) return DEFAULT_LAUNCHER_ACTIVITY;

        const status = await tauriInvoke<LauncherActivityStatus>('get_launcher_activity_status');
        setLauncherActivity(status);
        return status;
    };

    // Vérifier si on est dans Tauri et si le RSI Launcher est installé
    useEffect(() => {
        if (!isInTauri) return;

        // Launcher status d'abord (rapide - registre), puis playtime (lent - logs)
        tauriInvoke<LauncherStatus>('check_rsi_launcher').then((status) => {
            try { localStorage.setItem(LAUNCHER_CACHE_KEY, JSON.stringify(status)); } catch {}
            setLauncherStatus(status);
        }).catch(() => {});

        tauriInvoke<PlaytimeStats>('get_playtime').then((stats) => {
            try { localStorage.setItem(PLAYTIME_CACHE_KEY, JSON.stringify(stats)); } catch {}
            setPlaytime(stats);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!isInTauri) return;

        let disposed = false;
        const refresh = async () => {
            try {
                const status = await tauriInvoke<LauncherActivityStatus>('get_launcher_activity_status');
                if (!disposed) {
                    setLauncherActivity(status);
                }
            } catch {}
        };

        refresh();
        const interval = window.setInterval(refresh, 5000);

        return () => {
            disposed = true;
            window.clearInterval(interval);
        };
    }, [isInTauri]);

    useEffect(() => {
        const handleVideoToggle = (event: Event) => {
            const customEvent = event as CustomEvent<boolean>;
            setIsBackgroundVideoEnabled(Boolean(customEvent.detail));
        };

        window.addEventListener('backgroundVideoToggle', handleVideoToggle as EventListener);
        return () => {
            window.removeEventListener('backgroundVideoToggle', handleVideoToggle as EventListener);
        };
    }, []);

    useEffect(() => {
        const handleAmbilightPreset = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            if (isAmbilightPreset(customEvent.detail)) {
                setAmbilightPreset(customEvent.detail);
            }
        };

        window.addEventListener('ambilightPresetChange', handleAmbilightPreset as EventListener);
        return () => {
            window.removeEventListener('ambilightPresetChange', handleAmbilightPreset as EventListener);
        };
    }, []);

    useEffect(() => {
        const video = heroVideoRef.current;
        const heroCard = heroCardRef.current;
        const filterElem = heroAmbilightFilterRef.current;
        const clipElem = heroAmbilightClipRef.current;
        const projectorsElem = heroAmbilightProjectorsRef.current;
        const projectorListElem = heroAmbilightProjectorListRef.current;
        const shadowCanvas = heroAmbilightShadowRef.current;
        const preset = HERO_AMBILIGHT_PRESETS[ambilightPreset];
        const projectors = heroAmbilightProjectorRefs.current
            .slice(0, ambilightLevels)
            .filter((canvas): canvas is HTMLCanvasElement => Boolean(canvas));

        if (
            !isBackgroundVideoEnabled ||
            !video ||
            !heroCard ||
            !filterElem ||
            !clipElem ||
            !projectorsElem ||
            !projectorListElem ||
            !shadowCanvas ||
            projectors.length !== ambilightLevels
        ) {
            return;
        }

        const shadow = new ProjectorShadow(shadowCanvas);
        const projectorContexts = projectors
            .map((canvas) => canvas.getContext('2d', { alpha: true }))
            .filter((ctx): ctx is CanvasRenderingContext2D => Boolean(ctx));
        if (projectorContexts.length !== projectors.length) return;

        const barsClip: [number, number] = [0, 0];
        let srcVideoWidth = Math.max(1, video.videoWidth || 1920);
        let srcVideoHeight = Math.max(1, video.videoHeight || 1080);
        let projectorWidth = 1;
        let projectorHeight = 1;

        const resize = () => {
            const containerRect = filterElem.getBoundingClientRect();
            const cardRect = heroCard.getBoundingClientRect();
            if (!containerRect.width || !containerRect.height || !cardRect.width || !cardRect.height) return;

            const pMinSize = Math.max(257, Math.min(512, srcVideoWidth, srcVideoHeight));
            const pScale = Math.max(pMinSize / srcVideoWidth, pMinSize / srcVideoHeight);
            projectorWidth = Math.max(1, Math.ceil(srcVideoWidth * pScale));
            projectorHeight = Math.max(1, Math.ceil(srcVideoHeight * pScale));

            for (const canvas of projectors) {
                if (canvas.width !== projectorWidth) canvas.width = projectorWidth;
                if (canvas.height !== projectorHeight) canvas.height = projectorHeight;
            }

            const clippedVideoScale: [number, number] = [
                1 - barsClip[0] * 2,
                1 - barsClip[1] * 2,
            ];
            const cardLeft = Math.round(cardRect.left - containerRect.left);
            const cardTop = Math.round(cardRect.top - containerRect.top);
            const topExpansion = Math.max(
                preset.topOverflowMin,
                Math.round(cardRect.height * 0.9)
            );
            const bottomExpansion = Math.max(
                preset.bottomOverflowMin,
                Math.round(cardRect.height * 1.2)
            );
            const ambientTop = Math.max(0, Math.round(cardTop - topExpansion));
            const ambientBottom = Math.min(
                Math.round(containerRect.height),
                Math.round(cardTop + cardRect.height + bottomExpansion)
            );
            const ambientHeight = Math.max(1, ambientBottom - ambientTop);
            projectorsElem.style.left = `${cardLeft}px`;
            projectorsElem.style.top = `${ambientTop}px`;
            projectorsElem.style.width = `${Math.round(cardRect.width)}px`;
            projectorsElem.style.height = `${ambientHeight}px`;
            projectorsElem.style.transform = `scale(1) scale(${clippedVideoScale[0]}, ${clippedVideoScale[1]})`;
            projectorsElem.style.transformOrigin = 'center center';
            filterElem.style.maskImage = '';
            filterElem.style.webkitMaskImage = '';
            filterElem.style.clipPath = '';
            filterElem.style.removeProperty('-webkit-clip-path');

            const projectorSize = {
                w: Math.max(1, Math.round(projectorWidth * clippedVideoScale[0])),
                h: Math.max(1, Math.round(projectorHeight * clippedVideoScale[1])),
            };

            const ratio =
                projectorWidth > projectorHeight
                    ? {
                          x: projectorWidth / projectorSize.w,
                          y:
                              (projectorWidth / projectorSize.w) *
                              (projectorSize.w / projectorSize.h),
                      }
                    : {
                          x:
                              (projectorHeight / projectorSize.h) *
                              (projectorSize.h / projectorSize.w),
                          y: projectorHeight / projectorSize.h,
                      };

            const minScale = {
                x: 1 / projectorSize.w,
                y: 1 / projectorSize.h,
            };
            const scaleStep = preset.render.edge / 100;
            const scales: Array<{ x: number; y: number }> = [];
            const lastScale = { x: 1, y: 1 };

            for (let i = 0; i < ambilightLevels; i += 1) {
                const pos = i - preset.innerStrength;
                let scaleX = 1;
                let scaleY = 1;

                if (pos > 0) {
                    scaleX = 1 + scaleStep * ratio.x * pos;
                    scaleY = 1 + scaleStep * ratio.y * pos;
                }

                if (pos < 0) {
                    scaleX = 1 - scaleStep * ratio.x * -pos;
                    scaleY = 1 - scaleStep * ratio.y * -pos;
                    if (scaleX < 0) scaleX = 0;
                    if (scaleY < 0) scaleY = 0;
                }

                lastScale.x = scaleX;
                lastScale.y = scaleY;

                scales.push({
                    x: Math.max(minScale.x, scaleX),
                    y: Math.max(minScale.y, scaleY),
                });
            }

            for (let i = 0; i < projectors.length; i += 1) {
                const canvas = projectors[i];
                canvas.style.transform = `scale(${scales[i].x}, ${scales[i].y})`;
                canvas.style.transformOrigin = 'center center';
                canvas.style.opacity = '';
            }

            shadow.rescale(lastScale, projectorSize, preset.shadow);
            const blurPx = Math.max(
                0,
                Math.round(ambientHeight * 0.0025 * preset.render.blur2)
            );
            filterElem.style.filter = blurPx ? `blur(${blurPx}px)` : '';
        };

        const draw = () => {
            if (video.readyState >= 2 && projectorWidth > 1 && projectorHeight > 1) {
                if (
                    video.videoWidth &&
                    video.videoHeight &&
                    (video.videoWidth !== srcVideoWidth || video.videoHeight !== srcVideoHeight)
                ) {
                    srcVideoWidth = Math.max(1, video.videoWidth);
                    srcVideoHeight = Math.max(1, video.videoHeight);
                    resize();
                }

                const croppedSrcX = srcVideoWidth * barsClip[0];
                const croppedSrcY = srcVideoHeight * barsClip[1];
                const croppedSrcWidth = srcVideoWidth * (1 - barsClip[0] * 2);
                const croppedSrcHeight = srcVideoHeight * (1 - barsClip[1] * 2);

                for (let i = 0; i < projectors.length; i += 1) {
                    const canvas = projectors[i];
                    const context = projectorContexts[i];
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(
                        video,
                        croppedSrcX,
                        croppedSrcY,
                        croppedSrcWidth,
                        croppedSrcHeight,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );

                    // Directional shaping:
                    // - reduce left/right spread
                    // - keep stronger energy toward the bottom
                    context.save();
                    context.globalCompositeOperation = 'destination-in';

                    const sideMask = context.createLinearGradient(0, 0, canvas.width, 0);
                    sideMask.addColorStop(0, `rgba(0,0,0,${preset.sideMask.edgeAlpha})`);
                    sideMask.addColorStop(0.16, `rgba(0,0,0,${preset.sideMask.midAlpha})`);
                    sideMask.addColorStop(0.32, `rgba(0,0,0,${preset.sideMask.innerAlpha})`);
                    sideMask.addColorStop(0.5, 'rgba(0,0,0,1)');
                    sideMask.addColorStop(0.68, `rgba(0,0,0,${preset.sideMask.innerAlpha})`);
                    sideMask.addColorStop(0.84, `rgba(0,0,0,${preset.sideMask.midAlpha})`);
                    sideMask.addColorStop(1, `rgba(0,0,0,${preset.sideMask.edgeAlpha})`);
                    context.fillStyle = sideMask;
                    context.fillRect(0, 0, canvas.width, canvas.height);

                    context.restore();
                }
            }

            heroAmbilightRafRef.current = requestAnimationFrame(draw);
        };

        const handleVideoReady = () => {
            if (video.videoWidth && video.videoHeight) {
                srcVideoWidth = Math.max(1, video.videoWidth);
                srcVideoHeight = Math.max(1, video.videoHeight);
            }
            resize();
        };

        const observer = new ResizeObserver(resize);
        observer.observe(filterElem);
        video.addEventListener('loadedmetadata', handleVideoReady);
        video.addEventListener('loadeddata', handleVideoReady);
        video.addEventListener('canplay', handleVideoReady);

        resize();
        heroAmbilightRafRef.current = requestAnimationFrame(draw);

        return () => {
            if (heroAmbilightRafRef.current) {
                cancelAnimationFrame(heroAmbilightRafRef.current);
                heroAmbilightRafRef.current = null;
            }
            video.removeEventListener('loadedmetadata', handleVideoReady);
            video.removeEventListener('loadeddata', handleVideoReady);
            video.removeEventListener('canplay', handleVideoReady);
            observer.disconnect();
        };
    }, [isBackgroundVideoEnabled, ambilightPreset, ambilightLevels]);

    // Vérifier si l'utilisateur est connecté
    useEffect(() => {
        const checkUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUserId(session.user.id);
            }
        };
        checkUser();

        // Écouter les changements de session
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            setUserId(session?.user?.id || null);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Export local - ouvrir dialogue pour choisir où enregistrer
    const handleExportLocal = async () => {
        try {
            const prefs = await exportPreferences();
            const json = JSON.stringify(prefs, null, 2);

            if (isInTauri) {
                console.log('[Export] Ouverture du dialogue de sauvegarde...');
                const filePath = await saveDialog({
                    title: 'Exporter les préférences',
                    defaultPath: `startradfr_preferences_${new Date().toISOString().split('T')[0]}.json`,
                    filters: [{
                        name: 'JSON',
                        extensions: ['json']
                    }]
                });
                console.log('[Export] Chemin sélectionné:', filePath);

                if (filePath) {
                    console.log('[Export] Écriture du fichier...');
                    await tauriInvoke('write_text_file', { path: filePath, content: json });
                    console.log('[Export] Fichier écrit avec succès');
                    toast({
                        title: 'Export réussi',
                        description: 'Vos préférences ont été exportées.',
                        variant: 'success',
                    });
                } else {
                    console.log('[Export] Dialogue annulé par l\'utilisateur');
                }
            } else {
                // Fallback pour navigateur
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `startradfr_preferences_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                toast({
                    title: 'Export réussi',
                    description: 'Vos préférences ont été exportées en fichier JSON.',
                    variant: 'success',
                });
            }
        } catch (error: any) {
            console.error('[Export] Erreur:', error);
            toast({
                title: 'Erreur d\'export',
                description: error?.message || error?.toString() || 'Impossible d\'exporter les préférences',
                variant: 'destructive',
            });
        }
    };

    // Import local - ouvrir dialogue pour choisir un fichier
    const handleImportLocal = async () => {
        try {
            if (isInTauri) {
                const filePath = await openDialog({
                    filters: [{
                        name: 'JSON',
                        extensions: ['json']
                    }],
                    multiple: false
                });

                if (filePath && typeof filePath === 'string') {
                    const content = await tauriInvoke<string>('read_text_file', { path: filePath });
                    const prefs = JSON.parse(content) as ExportedPreferences;

                    if (!prefs.version || !prefs.sidebar || !prefs.theme || !prefs.stats) {
                        throw new Error('Format de fichier invalide');
                    }

                    importPreferences(prefs);

                    toast({
                        title: 'Import réussi',
                        description: 'Redémarrage pour appliquer les préférences...',
                        variant: 'success',
                    });

                    // Recharger la page pour que les stores se rechargent depuis localStorage
                    setTimeout(() => window.location.reload(), 1000);
                }
            } else {
                // Fallback pour navigateur - utiliser l'input file
                fileInputRef.current?.click();
            }
        } catch (error: any) {
            toast({
                title: 'Erreur d\'import',
                description: error.message || 'Fichier invalide',
                variant: 'destructive',
            });
        }
    };

    // Fallback import pour navigateur
    const handleImportLocalFallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const prefs = JSON.parse(content) as ExportedPreferences;

                if (!prefs.version || !prefs.sidebar || !prefs.theme || !prefs.stats) {
                    throw new Error('Format de fichier invalide');
                }

                importPreferences(prefs);

                toast({
                    title: 'Import réussi',
                    description: 'Redémarrage pour appliquer les préférences...',
                    variant: 'success',
                });

                // Recharger la page pour que les stores se rechargent depuis localStorage
                setTimeout(() => window.location.reload(), 1000);
            } catch (error: any) {
                toast({
                    title: 'Erreur d\'import',
                    description: error.message || 'Fichier invalide',
                    variant: 'destructive',
                });
            }
        };
        reader.readAsText(file);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Ouvrir le gestionnaire cloud
    const handleOpenCloudManager = async () => {
        if (!userId) return;
        setShowCloudPrefsManager(true);
        setCheckingCloudPrefs(true);
        setCloudPrefsPreview(null);

        try {
            // Vérifier si des préférences existent et les charger
            const prefs = await loadFromCloud(userId);
            if (prefs) {
                setCloudPrefsPreview(prefs);
                setHasCloudPrefs(true);
            } else {
                setHasCloudPrefs(false);
            }
        } catch {
            setHasCloudPrefs(false);
        } finally {
            setCheckingCloudPrefs(false);
        }
    };

    // Sauvegarder les préférences dans le cloud (depuis le manager)
    const handleSavePrefsToCloud = async () => {
        if (!userId) return;
        setPrefsSaving(true);
        try {
            const success = await saveToCloud(userId);
            if (success) {
                toast({
                    title: 'Sauvegarde cloud réussie',
                    description: 'Vos préférences ont été sauvegardées dans le cloud.',
                    variant: 'success',
                });
                // Recharger les préférences pour mettre à jour l'aperçu
                const prefs = await loadFromCloud(userId);
                if (prefs) {
                    setCloudPrefsPreview(prefs);
                    setHasCloudPrefs(true);
                }
            } else {
                throw new Error('Échec de la sauvegarde');
            }
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error.message || 'Impossible de sauvegarder dans le cloud',
                variant: 'destructive',
            });
        } finally {
            setPrefsSaving(false);
        }
    };

    // Supprimer les préférences du cloud
    const handleDeleteCloudPrefs = async () => {
        if (!userId) return;
        setPrefsDeleting(true);
        try {
            const success = await deleteFromCloud(userId);
            if (success) {
                toast({
                    title: 'Suppression réussie',
                    description: 'Vos préférences ont été supprimées du cloud.',
                    variant: 'success',
                });
                setCloudPrefsPreview(null);
                setHasCloudPrefs(false);
            } else {
                throw new Error('Échec de la suppression');
            }
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error.message || 'Impossible de supprimer du cloud',
                variant: 'destructive',
            });
        } finally {
            setPrefsDeleting(false);
        }
    };

    // Ouvrir le dialogue de confirmation pour charger les préférences cloud
    const handleOpenCloudPrefsDialog = () => {
        if (cloudPrefsPreview) {
            setShowCloudPrefsDialog(true);
        }
    };

    // Confirmer et appliquer les préférences cloud
    const handleConfirmLoadCloudPrefs = () => {
        if (!cloudPrefsPreview) return;

        importPreferences(cloudPrefsPreview);
        setShowCloudPrefsDialog(false);
        setCloudPrefsPreview(null);

        toast({
            title: 'Chargement réussi',
            description: 'Redémarrage pour appliquer les préférences...',
            variant: 'success',
        });

        // Recharger la page pour que les stores se rechargent depuis localStorage
        setTimeout(() => window.location.reload(), 1000);
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const saveThirdPartyApps = (apps: ThirdPartyApplication[]) => {
        setThirdPartyApps(apps);
        writeThirdPartyApplications(apps);
    };

    const resetThirdPartyAppDraft = () => {
        setEditingThirdPartyAppId(null);
        setThirdPartyAppDraft({
            name: '',
            path: '',
            enabled: true,
        });
    };

    const handleSelectThirdPartyAppPath = async () => {
        if (!isInTauri) return;

        try {
            const selected = await openDialog({
                filters: [
                    {
                        name: 'Applications',
                        extensions: ['exe', 'bat', 'cmd'],
                    },
                ],
                multiple: false,
            });

            if (typeof selected !== 'string') return;

            setThirdPartyAppDraft((draft) => ({
                ...draft,
                path: selected,
                name: draft.name.trim() ? draft.name : getApplicationNameFromPath(selected),
            }));
        } catch (error: any) {
            toast({
                title: 'Selection impossible',
                description: error?.message || error?.toString() || 'Impossible de choisir une application.',
                variant: 'destructive',
            });
        }
    };

    const handleSaveThirdPartyApp = () => {
        const name = thirdPartyAppDraft.name.trim();
        const path = thirdPartyAppDraft.path.trim();

        if (!name || !path) {
            toast({
                title: 'Configuration incomplete',
                description: 'Ajoutez un nom et le chemin de l\'application.',
                variant: 'warning',
            });
            return;
        }

        const now = new Date().toISOString();
        const next = editingThirdPartyAppId
            ? thirdPartyApps.map((app) =>
                  app.id === editingThirdPartyAppId
                      ? {
                            ...app,
                            name,
                            path,
                            enabled: thirdPartyAppDraft.enabled,
                            updatedAt: now,
                        }
                      : app
              )
            : [
                  ...thirdPartyApps,
                  {
                      id: createThirdPartyApplicationId(),
                      name,
                      path,
                      enabled: thirdPartyAppDraft.enabled,
                      createdAt: now,
                      updatedAt: now,
                  },
              ];

        saveThirdPartyApps(next);
        resetThirdPartyAppDraft();

        toast({
            title: editingThirdPartyAppId ? 'Application mise a jour' : 'Application ajoutee',
            description: `${name} sera ${thirdPartyAppDraft.enabled ? 'lancee' : 'gardee en pause'} avec le RSI Launcher.`,
            variant: 'success',
        });
    };

    const handleEditThirdPartyApp = (app: ThirdPartyApplication) => {
        setEditingThirdPartyAppId(app.id);
        setThirdPartyAppDraft({
            name: app.name,
            path: app.path,
            enabled: app.enabled,
        });
    };

    const handleToggleThirdPartyApp = (id: string, enabled: boolean) => {
        saveThirdPartyApps(
            thirdPartyApps.map((app) =>
                app.id === id
                    ? {
                          ...app,
                          enabled,
                          updatedAt: new Date().toISOString(),
                      }
                    : app
            )
        );
    };

    const handleRemoveThirdPartyApp = (id: string) => {
        const app = thirdPartyApps.find((item) => item.id === id);
        saveThirdPartyApps(thirdPartyApps.filter((item) => item.id !== id));
        if (editingThirdPartyAppId === id) {
            resetThirdPartyAppDraft();
        }
        if (app) {
            toast({
                title: 'Application retiree',
                description: `${app.name} ne sera plus lancee automatiquement.`,
            });
        }
    };

    const launchThirdPartyApplication = async (app: ThirdPartyApplication, showToast = false) => {
        try {
            await tauriInvoke('launch_third_party_application', { path: app.path });
            if (showToast) {
                toast({
                    title: 'Application lancee',
                    description: `${app.name} a ete ouverte.`,
                    variant: 'success',
                });
            }
            return true;
        } catch (error: any) {
            if (showToast) {
                toast({
                    title: 'Lancement impossible',
                    description: error?.message || error?.toString() || `Impossible de lancer ${app.name}.`,
                    variant: 'destructive',
                });
            }
            return false;
        }
    };

    const handleLaunchThirdPartyApp = async (app: ThirdPartyApplication) => {
        if (!isInTauri) return;
        setLaunchingThirdPartyAppId(app.id);
        try {
            await launchThirdPartyApplication(app, true);
        } finally {
            setLaunchingThirdPartyAppId(null);
        }
    };

    const launchEnabledThirdPartyApplications = async () => {
        const enabledApps = thirdPartyApps.filter((app) => app.enabled);
        if (enabledApps.length === 0) {
            return { launched: 0, failed: [] as string[] };
        }

        const results = await Promise.all(
            enabledApps.map(async (app) => ({
                name: app.name,
                ok: await launchThirdPartyApplication(app),
            }))
        );

        return {
            launched: results.filter((result) => result.ok).length,
            failed: results.filter((result) => !result.ok).map((result) => result.name),
        };
    };

    // Lancer le RSI Launcher
    const handleLaunchLauncher = async () => {
        if (!isInTauri) return;
        setLaunchingLauncher(true);
        try {
            await tauriInvoke('launch_rsi_launcher');
            setLauncherActivity((status) => ({ ...status, launcher_running: true }));
            void refreshLauncherActivity().catch(() => {});
            window.setTimeout(() => {
                void refreshLauncherActivity().catch(() => {});
            }, 1500);
            const companionLaunch = await launchEnabledThirdPartyApplications();
            const companionSummary =
                companionLaunch.launched > 0
                    ? ` ${companionLaunch.launched} programme(s) tiers lance(s).`
                    : '';
            if (companionLaunch.launched > 0 || companionLaunch.failed.length > 0) {
                toast({
                    title: companionLaunch.failed.length > 0 ? 'Programmes tiers partiels' : 'Programmes tiers lances',
                    description:
                        companionLaunch.failed.length > 0
                            ? `${companionSummary.trim()} Echec: ${companionLaunch.failed.join(', ')}`.trim()
                            : companionSummary.trim(),
                    variant: companionLaunch.failed.length > 0 ? 'warning' : 'success',
                });
            }
            toast({
                title: 'RSI Launcher lancé',
                description: 'Le launcher Star Citizen a été ouvert.',
            });
        } catch (error: any) {
            toast({
                title: 'Erreur',
                description: error || 'Impossible de lancer le RSI Launcher',
                variant: 'destructive',
            });
        } finally {
            setLaunchingLauncher(false);
        }
    };

    // Ouvrir un lien externe
    const handleOpenExternal = async (url: string) => {
        if (isInTauri) {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(url);
        } else {
            window.open(url, '_blank');
        }
    };

    const enabledThirdPartyAppCount = thirdPartyApps.filter((app) => app.enabled).length;
    const thirdPartyAppDraftIsValid =
        thirdPartyAppDraft.name.trim().length > 0 && thirdPartyAppDraft.path.trim().length > 0;
    const launcherButtonLabel = launchingLauncher
        ? 'Demarrage...'
        : launcherActivity.game_running
          ? 'Star Citizen en cours'
          : launcherActivity.launcher_running
            ? 'RSI Launcher actif'
            : 'Demarrer RSI Launcher';
    const launcherStatusTone = launcherActivity.game_running || launcherActivity.launcher_running
        ? 'border-green-500/35 bg-green-500/10 text-green-500'
        : 'border-border/35 bg-background/30 text-muted-foreground';

    return (
        <div className="flex w-full h-full flex-col gap-3 p-4 overflow-visible relative justify-between">
            {isBackgroundVideoEnabled && (
                <div className="pointer-events-none absolute inset-0 z-0 overflow-visible">
                    <div
                        ref={heroAmbilightFilterRef}
                        className="absolute inset-0 overflow-visible will-change-[filter]"
                    >
                        <div ref={heroAmbilightClipRef} className="absolute inset-0 overflow-visible">
                            <div ref={heroAmbilightProjectorsRef} className="absolute inset-0 overflow-visible">
                                <div ref={heroAmbilightProjectorListRef} className="absolute inset-0 overflow-visible">
                                    <canvas
                                        ref={heroAmbilightShadowRef}
                                        className="absolute inset-0 h-full w-full hidden [background:none]"
                                    />
                                    {Array.from({ length: ambilightLevels }).map((_, i) => (
                                        <canvas
                                            key={`hero-ambient-${i}`}
                                            ref={(canvas) => {
                                                heroAmbilightProjectorRefs.current[i] = canvas;
                                            }}
                                            className="absolute inset-0 h-full w-full [background:none]"
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Popup d'annonce - uniquement sur la page d'accueil */}
            {ANNOUNCEMENT_CONFIG.showAnnouncement && (
                <AnnouncementDialog
                    storageKey={ANNOUNCEMENT_CONFIG.storageKey}
                    title={ANNOUNCEMENT_CONFIG.title}
                    message={ANNOUNCEMENT_CONFIG.message}
                    secondaryMessage={ANNOUNCEMENT_CONFIG.secondaryMessage}
                    buttonText={ANNOUNCEMENT_CONFIG.buttonText}
                    delay={ANNOUNCEMENT_CONFIG.delay}
                />
            )}
            
            {/* Hero Section - Action principale */}
            <m.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="relative -mx-4 px-4 pt-2 pb-3"
            >
                <Card ref={heroCardRef} className={`relative z-10 overflow-hidden ${isBackgroundVideoEnabled ? 'border-white/8 bg-background/68' : 'border-border/35 bg-background/80'}`}>
                    <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

                    {isBackgroundVideoEnabled ? (
                        <>
                            <video
                                ref={heroVideoRef}
                                autoPlay
                                loop
                                muted
                                playsInline
                                preload="metadata"
                                className="absolute inset-0 h-full w-full object-cover object-center"
                            >
                                <source src="/video-montage-sc.mp4" type="video/mp4" />
                            </video>
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/78 via-black/58 to-black/68" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
                        </>
                    ) : null}

                    <CardContent className="relative z-10 p-4 md:p-4">
                        <div className="max-w-3xl space-y-3">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <Rocket className={`h-5 w-5 ${isBackgroundVideoEnabled ? 'text-white/90' : 'text-primary'}`} />
                                    <h1 className={`text-xl font-bold md:text-2xl${isBackgroundVideoEnabled ? ' text-white' : ''}`}>Bienvenue, Citizen !</h1>
                                </div>
                                <p className={`max-w-md text-sm md:text-base ${isBackgroundVideoEnabled ? 'text-white/75' : 'text-muted-foreground'}`}>
                                    Pret a jouer en francais ? Installez la traduction en un clic.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Link to="/traduction">
                                        <Button size="default" className="h-9 gap-2 px-4 text-sm shadow-lg transition-shadow hover:shadow-primary/25">
                                            <Globe2 className="h-4 w-4" />
                                            Installer la traduction
                                            <Sparkles className="h-4 w-4" />
                                        </Button>
                                    </Link>
                                    {isInTauri && (
                                        launcherStatus.installed ? (
                                            <Button
                                                size="default"
                                                variant="outline"
                                                className={`h-9 gap-2 px-4 text-sm ${
                                                    launcherActivity.game_running || launcherActivity.launcher_running
                                                        ? 'border-green-500/35 bg-green-500/10 text-green-500 hover:bg-green-500/15 hover:text-green-400'
                                                        : ''
                                                }`}
                                                onClick={handleLaunchLauncher}
                                                disabled={launchingLauncher}
                                            >
                                                {launchingLauncher ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : launcherActivity.game_running ? (
                                                    <Gamepad2 className="h-4 w-4" />
                                                ) : launcherActivity.launcher_running ? (
                                                    <CircleCheck className="h-4 w-4" />
                                                ) : (
                                                    <Play className="h-4 w-4" />
                                                )}
                                                {launcherButtonLabel}
                                            </Button>
                                        ) : !IS_MICROSOFT_STORE ? (
                                            <Button
                                                size="default"
                                                variant="outline"
                                                className="h-9 gap-2 px-4 text-sm"
                                                onClick={() => handleOpenExternal('https://install.robertsspaceindustries.com/rel/2/RSI%20Launcher-Setup-2.11.0.exe')}
                                            >
                                                <Download className="h-4 w-4" />
                                                Telecharger le Launcher
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                        ) : null
                                )}
                                {isInTauri && (
                                    <Button
                                        size="default"
                                        variant="outline"
                                        className="h-9 gap-2 px-4 text-sm"
                                        onClick={() => setShowThirdPartyAppsDialog(true)}
                                    >
                                        <Settings2 className="h-4 w-4" />
                                        Programmes tiers
                                        {enabledThirdPartyAppCount > 0 && (
                                            <Badge className="ml-0.5 border-primary/30 bg-primary/15 px-1.5 py-0 text-[10px] text-primary">
                                                {enabledThirdPartyAppCount}
                                            </Badge>
                                        )}
                                    </Button>
                                )}
                            </div>

                            {isInTauri && launcherStatus.installed && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${launcherStatusTone}`}>
                                        <CircleCheck className="h-3.5 w-3.5" />
                                        {launcherActivity.launcher_running
                                            ? "RSI Launcher en cours d'utilisation"
                                            : 'RSI Launcher pret'}
                                    </span>
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                                            launcherActivity.game_running
                                                ? 'border-green-500/35 bg-green-500/10 text-green-500'
                                                : 'border-border/35 bg-background/30 text-muted-foreground'
                                        }`}
                                    >
                                        <Gamepad2 className="h-3.5 w-3.5" />
                                        {launcherActivity.game_running
                                            ? "Star Citizen en cours d'utilisation"
                                            : 'Star Citizen en attente'}
                                    </span>
                                </div>
                            )}

                            {isInTauri && ((playtime && playtime.session_count > 0) || savedPlaytimeHours > 0) && (() => {
                                const calculatedHours = playtime?.total_hours || 0;
                                const totalHours = savedPlaytimeHours + calculatedHours;
                                const hours = Math.floor(totalHours);
                                const minutes = Math.round((totalHours - hours) * 60);
                                const sessionCount = playtime?.session_count || 0;

                                return (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="inline-flex cursor-help items-center gap-2.5 rounded-full border border-primary/35 bg-black/45 px-2.5 py-1.5 shadow-[0_0_20px_rgba(20,184,255,0.18)] backdrop-blur-sm transition-colors hover:border-primary/55">
                                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary">
                                                        <Clock className="h-3.5 w-3.5" />
                                                    </span>
                                                    <div className="flex items-baseline gap-1">
                                                        <span className="text-sm font-semibold text-white">{hours}h</span>
                                                        <span className="text-sm font-semibold text-white/90">{minutes}min</span>
                                                    </div>
                                                    <span className="h-4 w-px bg-white/20" />
                                                    <span className="text-[10px] uppercase tracking-wide text-white/75">
                                                        {sessionCount > 0
                                                            ? `${sessionCount} session${sessionCount > 1 ? 's' : ''}`
                                                            : 'Temps de jeu'}
                                                    </span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom" className="max-w-xs">
                                                <p className="text-sm">
                                                    Temps de jeu calcule depuis les logs Star Citizen.
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                );
                            })()}
                        </div>
                    </CardContent>
                </Card>

            </m.div>

            {/* Actions rapides */}
            <div className="relative z-10">
                <div className="flex items-center justify-between px-1 mb-3">
                    {showContent && (
                        <m.h2 
                            className="text-lg font-semibold flex items-center gap-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.2 }}
                        >
                            <Sparkles className="h-4 w-4 text-primary" />
                            Actions rapides
                        </m.h2>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowContent(!showContent)}
                        className="gap-2 text-muted-foreground hover:text-foreground ml-auto"
                    >
                        {showContent ? (
                            <>
                                <EyeOff className="h-4 w-4" />
                                <span className="hidden sm:inline">Masquer le contenu</span>
                            </>
                        ) : (
                            <>
                                <Eye className="h-4 w-4" />
                                <span className="hidden sm:inline">Afficher le contenu</span>
                            </>
                        )}
                    </Button>
                </div>
                
                {showContent && (
                    <m.div 
                        className="space-y-3"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    >
                    
                    <m.div 
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <QuickAction
                            to="/cache"
                            icon={<Brush className="h-4 w-4" />}
                            title="Gestion du cache"
                            description="Libérer de l'espace disque"
                            color="border-orange-500/30 bg-orange-500/10 text-orange-500"
                            index={0}
                        />
                        <QuickAction
                            to="/presets-local"
                            icon={<Users className="h-4 w-4" />}
                            title="Mes personnages"
                            description="Gérer vos persos locaux"
                            color="border-blue-500/30 bg-blue-500/10 text-blue-500"
                            index={1}
                        />
                        <QuickAction
                            to="/presets-remote"
                            icon={<Download className="h-4 w-4" />}
                            title="Persos en ligne"
                            description="Télécharger des presets"
                            color="border-green-500/30 bg-green-500/10 text-green-500"
                            index={2}
                        />
                        <QuickAction
                            to="/bindings"
                            icon={<Keyboard className="h-4 w-4" />}
                            title="Bindings"
                            description="Raccourcis clavier"
                            color="border-purple-500/30 bg-purple-500/10 text-purple-500"
                            index={3}
                        />
                        <QuickAction
                            to="/graphics-settings"
                            icon={<Monitor className="h-4 w-4" />}
                            title="Paramètres généraux"
                            description="Graphismes et contrôles"
                            color="border-pink-500/30 bg-pink-500/10 text-pink-500"
                            index={4}
                        />
                        <QuickAction
                            to="/ship-maps"
                            icon={<Map className="h-4 w-4" />}
                            title="Cartes vaisseaux"
                            description="Plans détaillés"
                            color="border-cyan-500/30 bg-cyan-500/10 text-cyan-500"
                            index={5}
                        />
                        <QuickAction
                            to="/updates"
                            icon={<Download className="h-4 w-4" />}
                            title="Mises à jour"
                            description="Gérer les mises à jour"
                            color="border-primary/30 bg-primary/10 text-primary"
                            index={6}
                        />
                    </m.div>
                    </m.div>
                )}
            </div>

            {/* Préférences app - barre compacte */}
            {showContent && (
                <div className="flex items-center gap-2 px-1 py-2 bg-muted/30 rounded-lg border border-border/30">
                    <span className="text-xs text-muted-foreground ml-2">Sauvegardez vos préférences (thème, sidebar, stats) en local ou dans le cloud</span>
                    <div className="flex-1" />
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExportLocal}>
                        <FileDown className="h-3 w-3" />
                        Exporter
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleImportLocal}>
                        <FileUp className="h-3 w-3" />
                        Importer
                    </Button>
                    <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportLocalFallback} className="hidden" />
                    <div className="w-px h-5 bg-border" />
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={handleOpenCloudManager}
                        disabled={isSyncing || !userId}
                    >
                        <Cloud className="h-3 w-3" />
                        {userId ? "Cloud" : "Connexion requise"}
                    </Button>
                </div>
            )}

            {/* Section infos */}
            {showContent && (
                <m.div 
                    className="relative z-10 space-y-3 rounded-2xl border border-border/35 bg-background/30 p-2.5 backdrop-blur-md md:p-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                >
                    <m.div 
                        className="grid grid-cols-1 gap-3 xl:grid-cols-12"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        {/* Patchnotes */}
                        <m.div
                            className="xl:col-span-4"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <Card className="h-full border-border/45 bg-background/38">
                                <CardHeader className="space-y-1 border-b border-border/40 pb-2 pt-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <CardTitle className="text-sm flex items-center gap-1.5">
                                            <FileText className="h-4 w-4 text-primary" />
                                            Patchnotes StarTrad
                                        </CardTitle>
                                        <Link to="/patchnotes" className="md:hidden">
                                            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]">
                                                Voir
                                                <ArrowRight className="h-3 w-3" />
                                            </Button>
                                        </Link>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        Dernieres versions, correctifs et changements
                                    </p>
                                </CardHeader>
                                <CardContent className="space-y-2 pb-2.5 pt-2.5">
                                    <RecentPatchNotes max={3} />
                                    <Link to="/patchnotes" className="block md:hidden">
                                        <Button variant="ghost" size="sm" className="w-full text-[11px]">
                                            Voir tout
                                            <ArrowRight className="h-3 w-3 ml-1" />
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        </m.div>

                        {/* Actualites */}
                        <m.div
                            className="xl:col-span-8"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 }}
                        >
                            <Card className="h-full border-border/45 bg-background/38">
                                <CardHeader className="space-y-1 border-b border-border/40 pb-2 pt-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <CardTitle className="text-sm flex items-center gap-1.5">
                                            <Newspaper className="h-4 w-4 text-primary" />
                                            Actualites Star Citizen
                                        </CardTitle>
                                        <Link to="/actualites">
                                            <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]">
                                                Ouvrir
                                                <ArrowRight className="h-3 w-3" />
                                            </Button>
                                        </Link>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        Flux RSI recent pour rester a jour rapidement
                                    </p>
                                </CardHeader>
                                <CardContent className="space-y-2 pb-2.5 pt-2.5">
                                    <RecentActualites max={3} />
                                </CardContent>
                            </Card>
                        </m.div>
                    </m.div>
                </m.div>
            )}
            {/* Footer hint */}
            <m.p
                className="text-center text-xs text-muted-foreground/60 pb-2 relative z-10 mt-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
            >
                💡 Astuce : Utilisez le menu à gauche pour naviguer rapidement
            </m.p>

            {/* Dialog des programmes tiers */}
            <Dialog
                open={showThirdPartyAppsDialog}
                onOpenChange={(open) => {
                    setShowThirdPartyAppsDialog(open);
                    if (!open) resetThirdPartyAppDraft();
                }}
            >
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AppWindow className="h-5 w-5 text-primary" />
                            Programmes tiers
                        </DialogTitle>
                        <DialogDescription>
                            Choisissez les applications a lancer automatiquement avec le RSI Launcher.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/35 bg-background/25 px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">Lancement automatique</p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {enabledThirdPartyAppCount} actif(s) sur {thirdPartyApps.length}
                                    </p>
                                </div>
                                <Badge variant="outline" className="shrink-0 border-primary/30 text-primary">
                                    {enabledThirdPartyAppCount}
                                </Badge>
                            </div>

                            {thirdPartyApps.length === 0 ? (
                                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border/45 bg-background/20 px-6 text-center">
                                    <AppWindow className="mb-3 h-9 w-9 text-muted-foreground/65" />
                                    <p className="text-sm font-medium">Aucun programme configure</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Ajoutez UEX, un outil de carte, Discord ou tout executable utile a votre session.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {thirdPartyApps.map((app) => (
                                        <div
                                            key={app.id}
                                            className="rounded-lg border border-border/35 bg-background/25 p-3 transition-colors hover:bg-background/35"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                                                    <AppWindow className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <p className="truncate text-sm font-semibold">{app.name}</p>
                                                        <Badge
                                                            variant="outline"
                                                            className={
                                                                app.enabled
                                                                    ? "border-green-500/30 text-green-500"
                                                                    : "border-border/40 text-muted-foreground"
                                                            }
                                                        >
                                                            {app.enabled ? 'Auto' : 'Pause'}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-1 truncate text-xs text-muted-foreground" title={app.path}>
                                                        {getFilenameFromPath(app.path)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <div className="flex items-center gap-2 rounded-md border border-border/30 bg-background/20 px-2 py-1">
                                                    <Switch
                                                        checked={app.enabled}
                                                        onCheckedChange={(checked) => handleToggleThirdPartyApp(app.id, checked)}
                                                        aria-label={`Lancer ${app.name} avec le RSI Launcher`}
                                                    />
                                                    <span className="text-xs text-muted-foreground">Avec RSI</span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 gap-1.5 px-2.5 text-xs"
                                                    onClick={() => handleLaunchThirdPartyApp(app)}
                                                    disabled={launchingThirdPartyAppId === app.id}
                                                >
                                                    {launchingThirdPartyAppId === app.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Zap className="h-3.5 w-3.5" />
                                                    )}
                                                    Tester
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 gap-1.5 px-2.5 text-xs"
                                                    onClick={() => handleEditThirdPartyApp(app)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    Modifier
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 gap-1.5 px-2.5 text-xs text-red-500 hover:text-red-500"
                                                    onClick={() => handleRemoveThirdPartyApp(app.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    Retirer
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-border/35 bg-background/25 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold">
                                        {editingThirdPartyAppId ? 'Modifier' : 'Ajouter'} une application
                                    </p>
                                    <p className="text-xs text-muted-foreground">Executable local, lance en arriere-plan.</p>
                                </div>
                                {editingThirdPartyAppId && (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={resetThirdPartyAppDraft}
                                        aria-label="Annuler la modification"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            <div className="space-y-3">
                                <label className="block space-y-1.5">
                                    <span className="text-xs font-medium text-muted-foreground">Nom affiche</span>
                                    <Input
                                        value={thirdPartyAppDraft.name}
                                        onChange={(event) =>
                                            setThirdPartyAppDraft((draft) => ({
                                                ...draft,
                                                name: event.target.value,
                                            }))
                                        }
                                        placeholder="UEX, Discord, outil de carte..."
                                        className="h-9 text-sm"
                                    />
                                </label>

                                <label className="block space-y-1.5">
                                    <span className="text-xs font-medium text-muted-foreground">Chemin de l'application</span>
                                    <div className="flex gap-2">
                                        <Input
                                            value={thirdPartyAppDraft.path}
                                            onChange={(event) =>
                                                setThirdPartyAppDraft((draft) => ({
                                                    ...draft,
                                                    path: event.target.value,
                                                }))
                                            }
                                            placeholder="C:\\Program Files\\..."
                                            className="h-9 min-w-0 text-sm"
                                        />
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="outline"
                                            className="h-9 w-9 shrink-0"
                                            onClick={handleSelectThirdPartyAppPath}
                                            disabled={!isInTauri}
                                            aria-label="Choisir une application"
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </label>

                                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/20 px-3 py-2">
                                    <div>
                                        <p className="text-sm font-medium">Lancer avec RSI</p>
                                        <p className="text-xs text-muted-foreground">Desactivez pour garder l'application en favoris.</p>
                                    </div>
                                    <Switch
                                        checked={thirdPartyAppDraft.enabled}
                                        onCheckedChange={(checked) =>
                                            setThirdPartyAppDraft((draft) => ({
                                                ...draft,
                                                enabled: checked,
                                            }))
                                        }
                                        aria-label="Lancer automatiquement avec le RSI Launcher"
                                    />
                                </div>

                                <Button
                                    className="h-9 w-full gap-2"
                                    onClick={handleSaveThirdPartyApp}
                                    disabled={!thirdPartyAppDraftIsValid}
                                >
                                    <Save className="h-4 w-4" />
                                    {editingThirdPartyAppId ? 'Enregistrer' : 'Ajouter'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowThirdPartyAppsDialog(false)}>
                            Fermer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog du gestionnaire cloud */}
            <Dialog open={showCloudPrefsManager} onOpenChange={setShowCloudPrefsManager}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Cloud className="h-5 w-5 text-primary" />
                            Préférences Cloud
                        </DialogTitle>
                        <DialogDescription>
                            Gérez vos préférences sauvegardées dans le cloud
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {checkingCloudPrefs ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <span className="ml-2 text-sm text-muted-foreground">Chargement...</span>
                            </div>
                        ) : hasCloudPrefs && cloudPrefsPreview ? (
                            <>
                                {/* Sauvegarde existante */}
                                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                                    <div className="flex items-center gap-2 mb-3">
                                        <CloudDownload className="h-4 w-4 text-primary" />
                                        <span className="font-medium text-sm">Sauvegarde trouvée</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mb-3">
                                        Sauvegardée le : <span className="font-medium text-foreground">{formatDate(cloudPrefsPreview.exportedAt)}</span>
                                    </div>

                                    {/* Aperçu compact */}
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <Palette className="h-3 w-3 text-muted-foreground" />
                                            <span>Thème : {cloudPrefsPreview.theme.primaryColor} ({cloudPrefsPreview.theme.mode})</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <BarChart3 className="h-3 w-3 text-muted-foreground" />
                                            <span>{cloudPrefsPreview.stats.translationInstallCount} installations, {cloudPrefsPreview.stats.backupCreatedCount} backups</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col gap-2">
                                    <Button
                                        variant="default"
                                        className="w-full gap-2"
                                        onClick={handleOpenCloudPrefsDialog}
                                    >
                                        <CloudDownload className="h-4 w-4" />
                                        Restaurer ces préférences
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full gap-2"
                                        onClick={handleSavePrefsToCloud}
                                        disabled={prefsSaving}
                                    >
                                        {prefsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                                        Écraser avec mes préférences actuelles
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        className="w-full gap-2"
                                        onClick={handleDeleteCloudPrefs}
                                        disabled={prefsDeleting}
                                    >
                                        {prefsDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        Supprimer du cloud
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Aucune sauvegarde */}
                                <div className="flex flex-col items-center justify-center py-6 text-center">
                                    <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Aucune sauvegarde cloud</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Sauvegardez vos préférences pour les retrouver sur un autre appareil
                                    </p>
                                </div>

                                <Button
                                    variant="default"
                                    className="w-full gap-2"
                                    onClick={handleSavePrefsToCloud}
                                    disabled={prefsSaving}
                                >
                                    {prefsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                                    Sauvegarder mes préférences
                                </Button>
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCloudPrefsManager(false)}>
                            Fermer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de chargement des préférences cloud */}
            <Dialog open={showCloudPrefsDialog} onOpenChange={setShowCloudPrefsDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CloudDownload className="h-5 w-5 text-primary" />
                            Charger les préférences cloud
                        </DialogTitle>
                        <DialogDescription>
                            Voulez-vous restaurer ces préférences ?
                        </DialogDescription>
                    </DialogHeader>

                    {cloudPrefsPreview && (
                        <div className="space-y-4 py-2">
                            {/* Date de sauvegarde */}
                            <div className="text-sm text-muted-foreground">
                                Sauvegardée le : <span className="font-medium text-foreground">{formatDate(cloudPrefsPreview.exportedAt)}</span>
                            </div>

                            {/* Aperçu des préférences */}
                            <div className="space-y-3">
                                {/* Thème */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <Palette className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Thème</div>
                                        <div className="text-xs text-muted-foreground">
                                            Couleur : {cloudPrefsPreview.theme.primaryColor} • Mode : {cloudPrefsPreview.theme.mode}
                                        </div>
                                    </div>
                                </div>

                                {/* Sidebar */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <PanelLeft className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Sidebar</div>
                                        <div className="text-xs text-muted-foreground">
                                            {cloudPrefsPreview.sidebar.isLocked ? 'Verrouillée' : 'Non verrouillée'} • {cloudPrefsPreview.sidebar.isCollapsed ? 'Réduite' : 'Étendue'}
                                        </div>
                                    </div>
                                </div>

                                {/* Statistiques */}
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <BarChart3 className="h-4 w-4 text-primary" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Statistiques</div>
                                        <div className="text-xs text-muted-foreground">
                                            {cloudPrefsPreview.stats.translationInstallCount} installations • {cloudPrefsPreview.stats.cacheCleanCount} nettoyages cache
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setShowCloudPrefsDialog(false)}>
                            Annuler
                        </Button>
                        <Button onClick={handleConfirmLoadCloudPrefs}>
                            Restaurer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            </div>
    );
}

export default Home;
