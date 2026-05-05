/**
 * Wizard d'onboarding plein-écran qui s'affiche au tout premier lancement.
 * Orchestre 6 étapes (steps/StepXxx.tsx) :
 *   1. Bienvenue + sécurité    4. Services optionnels
 *   2. Détection SC            5. Compte cloud
 *   3. Choix traductions       6. Récap final
 *
 * Réutilise les commandes Tauri existantes (`get_star_citizen_versions`,
 * `init_translation_files`, `start_background_service`, etc.) au lieu de
 * réimplémenter la logique métier.
 *
 * Particularité : la fenêtre Tauri se redimensionne dynamiquement avec une
 * animation cubic-bezier(0.32, 0.72, 0, 1) façon Apple pour fitter le contenu
 * du wizard, puis restaure la taille initiale à la fermeture.
 */

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, Loader2, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthDialog from "@/components/custom/auth-dialog";
import { supabase } from "@/lib/supabase";
import {
    animateWindowResize,
    computeWizardSize,
    restoreWindow,
    snapshotWindow,
    type WindowSnapshot,
} from "@/utils/window-animate";
import type { LocalizationConfig, TranslationsChoosen, Link as TranslationLink } from "@/types/translation";
import { ProgressDots } from "./ProgressDots";
import { StepWelcome } from "./steps/StepWelcome";
import { StepDetect } from "./steps/StepDetect";
import { StepTranslations } from "./steps/StepTranslations";
import { StepServices } from "./steps/StepServices";
import { StepAccount } from "./steps/StepAccount";
import { StepRecap } from "./steps/StepRecap";
import type { OnboardingState, ServicesConfig, VersionInfo, VersionPaths, VersionSelection } from "./types";

interface OnboardingWizardProps {
    onClose: () => void;
}

const WIZARD_DESIRED_WIDTH = 1100;
const WIZARD_DESIRED_HEIGHT = 820;
const STEP_LABELS = ["Bienvenue", "Détection", "Traductions", "Services", "Compte", "Prêt"] as const;
const TOTAL_STEPS = STEP_LABELS.length;

export default function OnboardingWizard({ onClose }: OnboardingWizardProps) {
    const snapshotRef = useRef<WindowSnapshot | null>(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [wasCompleted, setWasCompleted] = useState(false);
    const [windowReady, setWindowReady] = useState(false);

    const [versions, setVersions] = useState<Record<string, VersionInfo>>({});
    const [versionsLoaded, setVersionsLoaded] = useState(false);
    const [translationLinks, setTranslationLinks] = useState<TranslationLink[]>([]);
    // L'install se fait directement depuis StepTranslations (clic sur le bouton
    // « Installer »). Le parent ne stocke que la sélection courante de la
    // source par version pour la persistance et le récap.
    const [perVersion, setPerVersion] = useState<Record<string, VersionSelection>>({});

    const [services, setServices] = useState<ServicesConfig>(() => {
        let autoCleanInit = false;
        try {
            autoCleanInit = localStorage.getItem('startradfr_auto_clear_obsolete_caches') === 'true';
        } catch {
            /* ignore */
        }
        return {
            backgroundEnabled: false,
            backgroundIntervalMin: 5,
            discordEnabled: false,
            autoStartup: false,
            companionEnabled: false,
            companionPersistentToken: false,
            autoCleanObsoleteCaches: autoCleanInit,
        };
    });

    const [authDialogOpen, setAuthDialogOpen] = useState(false);
    const [accountConnected, setAccountConnected] = useState(false);

    // ─── Init : snapshot fenêtre, anim resize, préchargement ────────────
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            try {
                snapshotRef.current = await snapshotWindow();
                const state = await invoke<OnboardingState>("record_onboarding_attempt");
                if (cancelled) return;
                setWasCompleted(!!state.was_completed);

                const target = await computeWizardSize(WIZARD_DESIRED_WIDTH, WIZARD_DESIRED_HEIGHT);
                await animateWindowResize(target.width, target.height, 420);
                if (cancelled) return;
                setWindowReady(true);

                void preloadAll();
            } catch (e) {
                console.error("[Onboarding] init failed", e);
                if (!cancelled) setWindowReady(true);
            }
        };
        void init();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const preloadAll = async () => {
        try {
            const [vp, loc, savedSel] = await Promise.all([
                invoke<VersionPaths>("get_star_citizen_versions").catch(() => ({ versions: {} })),
                invoke<LocalizationConfig>("get_translations").catch(() => ({
                    fr: { folder: "", enabled: true, links: [] },
                })),
                invoke<TranslationsChoosen>("load_translations_selected").catch(
                    () => ({} as TranslationsChoosen)
                ),
            ]);
            setVersions(vp.versions || {});
            const links = Array.isArray(loc?.fr?.links) ? loc.fr.links : [];
            setTranslationLinks(links);
            setVersionsLoaded(true);

            // Sélection par défaut : reprend la sauvegarde si existante, sinon
            // 1er lien dispo. Coche "Installer" pour les versions non-traduites.
            const defaultLink = links[0]?.url ?? null;
            const next: Record<string, VersionSelection> = {};
            Object.entries(vp.versions || {}).forEach(([ver, info]) => {
                const saved = savedSel?.[ver];
                next[ver] = {
                    selectedLink: saved?.link ?? defaultLink,
                    installNow: !(info as VersionInfo).translated,
                };
            });
            setPerVersion(next);
        } catch (e) {
            console.error("[Onboarding] preload SC/trad", e);
        }

        try {
            const [bgCfg, autoStartup, discordOk, companionInfo] = await Promise.all([
                invoke<{ enabled: boolean; check_interval_minutes: number; language: string }>(
                    "load_background_service_config"
                ).catch(() => null),
                invoke<boolean>("is_auto_startup_enabled").catch(() => false),
                invoke<boolean>("check_and_reconnect_discord").catch(() => false),
                invoke<{ running: boolean; persistentToken: boolean }>(
                    "get_companion_info"
                ).catch(() => null),
            ]);
            // Le flag « companion activé » est en fait stocké en localStorage
            // pour le démarrage auto. On lit aussi `running` côté Rust pour
            // refléter l'état réel courant.
            const savedCompanionEnabled =
                localStorage.getItem("companionServerEnabled") === "true";
            setServices((s) => ({
                backgroundEnabled: bgCfg?.enabled ?? s.backgroundEnabled,
                backgroundIntervalMin: bgCfg?.check_interval_minutes ?? s.backgroundIntervalMin,
                autoStartup,
                discordEnabled: discordOk,
                companionEnabled: savedCompanionEnabled || !!companionInfo?.running,
                companionPersistentToken: !!companionInfo?.persistentToken,
                autoCleanObsoleteCaches: s.autoCleanObsoleteCaches,
            }));
        } catch (e) {
            console.error("[Onboarding] preload services", e);
        }

        try {
            const { data } = await supabase.auth.getSession();
            setAccountConnected(!!data?.session);
        } catch {
            /* ignore */
        }
    };

    const isFirst = stepIndex === 0;
    const isLast = stepIndex === TOTAL_STEPS - 1;
    // « Passer » n'apparaît qu'à partir du moment où l'utilisateur a déjà
    // terminé le wizard une fois (champ `was_completed` côté Rust). Au tout
    // 1er lancement, il doit aller jusqu'à « C'est parti ».
    const showSkipButton = wasCompleted;

    const goNext = () => setStepIndex((s) => Math.min(TOTAL_STEPS - 1, s + 1));
    const goBack = () => setStepIndex((s) => Math.max(0, s - 1));

    const handleSelectLink = (version: string, url: string) => {
        setPerVersion((cur) => ({
            ...cur,
            [version]: {
                selectedLink: url || null,
                installNow: cur[version]?.installNow ?? false,
            },
        }));
    };

    // Persiste juste la sélection de source par version (sans déclencher
    // d'install : ça se fait depuis le bouton « Installer » du step lui-même).
    const persistSelections = async () => {
        const choosen: TranslationsChoosen = {};
        Object.entries(perVersion).forEach(([ver, sel]) => {
            if (sel.selectedLink) {
                choosen[ver] = { link: sel.selectedLink, settingsEN: false };
            }
        });
        if (Object.keys(choosen).length === 0) return;
        try {
            await invoke("save_translations_selected", { data: choosen });
        } catch (e) {
            console.error("[Onboarding] save_translations_selected", e);
        }
    };

    // Tous les services sont appliqués LIVE depuis StepServices (chaque
    // toggle/slider invoke immédiatement Tauri, comme dans SettingsContent).
    // Cette fonction reste comme filet de sécurité : si le user passe par
    // « Passer » sans avoir interagi, on s'assure quand même d'avoir un
    // état cohérent côté Rust.
    const applyServicesConfig = async () => {
        try {
            const cfg = {
                enabled: services.backgroundEnabled,
                check_interval_minutes: services.backgroundIntervalMin,
                language: "fr",
            };
            await invoke("save_background_service_config", { config: cfg }).catch(() => {});
        } catch {
            /* ignore — déjà appliqué live */
        }
    };

    const finishWizard = async (markDone: boolean) => {
        // Sécurité : on persiste la sélection même si l'utilisateur n'a pas
        // installé depuis le step (au cas où il a juste choisi une source
        // sans cliquer sur Installer, et qu'il finit ensuite via Passer).
        try {
            await persistSelections();
        } catch {
            /* déjà loggé */
        }
        try {
            await applyServicesConfig();
        } catch {
            /* déjà loggé */
        }

        if (markDone) {
            try {
                await invoke("complete_onboarding");
                try {
                    localStorage.setItem("security-warning-seen", "true");
                } catch {
                    /* ignore */
                }
            } catch (e) {
                console.error("[Onboarding] complete_onboarding", e);
            }
        }

        if (snapshotRef.current) {
            try {
                await restoreWindow(snapshotRef.current, 380);
            } catch (e) {
                console.error("[Onboarding] restore window", e);
            }
        }
        onClose();
    };

    // Le bouton « Suivant » applique les actions du step courant avant
    // d'avancer. Step 3 : on persiste juste la sélection (l'install est faite
    // au clic du bouton « Installer » dans le step lui-même). Step 4 :
    // applique la config services.
    const handleNextFromStep = async () => {
        if (stepIndex === 2) {
            await persistSelections();
        } else if (stepIndex === 3) {
            await applyServicesConfig();
        }
        if (isLast) {
            await finishWizard(true);
        } else {
            goNext();
        }
    };

    if (!windowReady) {
        // Splash discret pendant l'animation de resize de la fenêtre.
        return (
            <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-background/95 backdrop-blur-md">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        // z-[10001] pour passer au-dessus de l'AdminElevateButton (z-[9999])
        // et de toute la chrome de l'app, le wizard est censé être seul à
        // l'écran tant qu'il est actif.
        // bg semi-transparent + backdrop-blur pour rester cohérent avec les
        // dialogs Settings (`bg-[hsl(var(--background)/0.46)]`) — laisse
        // passer un peu d'acrylique du desktop sans tout dévoiler.
        <div className="fixed inset-0 z-[10001] flex flex-col overflow-hidden bg-[hsl(var(--background)/0.78)] backdrop-blur-2xl backdrop-saturate-150">
            {/* Ambient background : gradients radiaux primary qui rappellent
                l'en-tête glassmorphism des paramètres / page Traduction. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                    backgroundImage: [
                        "radial-gradient(120% 85% at 85% -10%, hsl(var(--primary) / 0.22), transparent 60%)",
                        "radial-gradient(100% 70% at -5% 110%, hsl(var(--primary) / 0.12), transparent 55%)",
                    ].join(", "),
                }}
            />
            {/* Header : back + progress + skip.
                `data-tauri-drag-region` directement sur le header — Tauri auto-bloque
                les éléments interactifs à l'intérieur (boutons), donc seules les zones
                vides du header servent de poignée pour déplacer la fenêtre.
                Indispensable car la window Tauri a `decorations: false`, donc pas de
                titlebar OS native. */}
            <div
                data-tauri-drag-region
                className="flex items-center justify-between px-8 pt-6 pb-3"
            >
                <div data-tauri-drag-region className="flex items-center gap-3">
                    {!isFirst && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goBack}
                            className="h-8 gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Précédent
                        </Button>
                    )}
                </div>
                <div data-tauri-drag-region>
                    <ProgressDots stepIndex={stepIndex} total={TOTAL_STEPS} />
                </div>
                <div data-tauri-drag-region className="flex items-center gap-2">
                    {showSkipButton && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void finishWizard(true)}
                            className="h-8 gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground"
                        >
                            Passer
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Contenu (sans scroll, on dimensionne la fenêtre pour fitter) */}
            <div className="flex flex-1 items-center justify-center overflow-hidden px-8">
                <div className="w-full max-w-[920px]">
                    {stepIndex === 0 && <StepWelcome />}
                    {stepIndex === 1 && (
                        <StepDetect versions={versions} versionsLoaded={versionsLoaded} />
                    )}
                    {stepIndex === 2 && (
                        <StepTranslations
                            versions={versions}
                            links={translationLinks}
                            perVersion={perVersion}
                            onSelectLink={handleSelectLink}
                        />
                    )}
                    {stepIndex === 3 && <StepServices services={services} onChange={setServices} />}
                    {stepIndex === 4 && (
                        <StepAccount
                            connected={accountConnected}
                            onConnect={() => setAuthDialogOpen(true)}
                        />
                    )}
                    {stepIndex === 5 && (
                        <StepRecap
                            versions={versions}
                            perVersion={perVersion}
                            services={services}
                            connected={accountConnected}
                        />
                    )}
                </div>
            </div>

            {/* Footer glass — même langage que les panels Settings */}
            <div className="flex items-center justify-end gap-3 border-t border-border/55 bg-[hsl(var(--background)/0.34)] px-8 py-5 shadow-[0_-14px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <span className="mr-auto text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {STEP_LABELS[stepIndex]} · {stepIndex + 1} / {TOTAL_STEPS}
                </span>
                <Button
                    size="lg"
                    onClick={() => void handleNextFromStep()}
                    className="h-11 min-w-[160px] gap-2 rounded-xl px-6 text-sm font-semibold"
                >
                    {isLast ? (
                        <>
                            <Rocket className="h-4 w-4" />
                            C'est parti
                        </>
                    ) : (
                        "Suivant"
                    )}
                </Button>
            </div>

            <AuthDialog
                open={authDialogOpen}
                onOpenChange={(open) => {
                    setAuthDialogOpen(open);
                    if (!open) {
                        void supabase.auth
                            .getSession()
                            .then(({ data }) => setAccountConnected(!!data?.session))
                            .catch(() => {});
                    }
                }}
                defaultTab="login"
            />
        </div>
    );
}
