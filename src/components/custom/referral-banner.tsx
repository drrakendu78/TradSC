import { useEffect, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Copy, Check, Sparkles, HelpCircle, Trophy, Coins, Rocket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    setActiveBanner,
    subscribeActiveBanner,
} from "@/components/custom/titlebar-banner-coordinator";

const REFERRAL_CODE = "STAR-FYZN-9HQQ";
const REFERRAL_URL = `https://robertsspaceindustries.com/enlist?referral=${REFERRAL_CODE}`;
const COLLAPSED_STORAGE_KEY = "startradfr_referral_banner_collapsed";

type BannerState = "open" | "collapsed";

// Une fois que l'user a cliqué ▲ pour réduire, on persiste ce choix.
// Le pill reste cliquable pour réouvrir manuellement, mais l'app ne
// déploie plus automatiquement le bandeau à chaque démarrage.

const AUTO_COLLAPSE_DELAY_MS = 10_000;

function loadInitialState(): BannerState {
    try {
        if (localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1") return "collapsed";
    } catch {}
    return "open";
}

function persistCollapsed(collapsed: boolean) {
    try {
        if (collapsed) localStorage.setItem(COLLAPSED_STORAGE_KEY, "1");
        else localStorage.removeItem(COLLAPSED_STORAGE_KEY);
    } catch {}
}

export function ReferralBanner() {
    const [state, setState] = useState<BannerState>(() => loadInitialState());
    const [mounted, setMounted] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [hovered, setHovered] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        setMounted(true);
        // Au mount, si on est dans l'état "open", on l'enregistre auprès du
        // coordinateur pour que les autres bandeaux puissent réagir.
        if (state === "open") {
            setActiveBanner("referral");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Coordination : si un autre bandeau s'ouvre, on se replie.
    useEffect(() => {
        const unsub = subscribeActiveBanner((id) => {
            if (id !== "referral" && state === "open") {
                setState("collapsed");
            }
        });
        return unsub;
    }, [state]);

    // Auto-collapse après 10s d'inactivité (souris pas dessus) quand ouvert.
    // On persiste l'état collapsed pour ne plus afficher en grand au prochain
    // démarrage (les users râlent quand ça s'ouvre à chaque fois).
    useEffect(() => {
        if (state !== "open" || hovered) return;
        const timer = window.setTimeout(() => {
            setState("collapsed");
            setActiveBanner(null);
            persistCollapsed(true);
        }, AUTO_COLLAPSE_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [state, hovered]);

    const copy = async (text: string, kind: "code" | "link") => {
        try {
            await navigator.clipboard.writeText(text);
            if (kind === "code") {
                setCopiedCode(true);
                window.setTimeout(() => setCopiedCode(false), 2000);
            } else {
                setCopiedLink(true);
                window.setTimeout(() => setCopiedLink(false), 2000);
            }
            toast({
                title: kind === "code" ? "Code copié !" : "Lien copié !",
                description:
                    kind === "code"
                        ? "Colle-le au moment de créer ton compte RSI pour recevoir 50 000 UEC."
                        : "Inscris-toi via ce lien pour recevoir automatiquement 50 000 UEC et débloquer des récompenses RSI exclusives.",
            });
        } catch {
            toast({
                title: "Erreur",
                description: "Impossible de copier dans le presse-papiers.",
                variant: "destructive",
            });
        }
    };

    if (!mounted) return null;

    return (
        <div className="pointer-events-none absolute inset-x-0 -top-4 z-30 grid items-start justify-items-center justify-center [&>*]:[grid-area:1/1]">
            <style>{`
                @keyframes startrad-pill-pulse {
                    0%, 100% { opacity: 0.45; transform: scale(1); }
                    50% { opacity: 0.85; transform: scale(1.05); }
                }
                @keyframes startrad-pill-dot {
                    0%, 100% { opacity: 0.6; }
                    50% { opacity: 1; }
                }
            `}</style>
            <AnimatePresence initial={false}>
                {state === "open" ? (
                    <m.div
                        key="open"
                        initial={{ y: -80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -80, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        className="pointer-events-auto group relative"
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                    >
                        {/* Halo emerald subtil sous le bandeau pour ressortir */}
                        <span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 -z-10 rounded-b-2xl bg-emerald-500/25 opacity-50 blur-xl"
                        />
                        <div className="flex items-center gap-3 rounded-b-2xl border border-t-0 border-primary/50 bg-gradient-to-b from-primary/40 to-primary/20 px-3 py-1.5 shadow-[0_8px_24px_-10px_rgba(160,120,255,0.55)] backdrop-blur-xl ring-1 ring-emerald-400/20">
                            <div className="flex items-center gap-2 pl-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-emerald-300 drop-shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                                <span className="text-[11px] font-semibold text-white/95 drop-shadow-sm">
                                    Tu débutes sur Star Citizen ?
                                </span>
                                <span className="text-[11px] text-white/55">·</span>
                                <span className="text-[11px] text-white/75">
                                    Utilise ce code à l'inscription RSI →{" "}
                                    <span className="font-bold text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">
                                        50&nbsp;000&nbsp;UEC offerts
                                    </span>
                                </span>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                                            title="Comment ça marche ?"
                                            aria-label="Comment ça marche ?"
                                        >
                                            <HelpCircle className="h-3.5 w-3.5" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                        side="bottom"
                                        align="center"
                                        sideOffset={10}
                                        className="w-80 border border-border/50 bg-background/95 p-0 shadow-xl backdrop-blur-xl"
                                    >
                                        <div className="border-b border-border/40 px-4 py-3">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
                                                Comment ça marche
                                            </div>
                                            <div className="text-[12px] font-semibold text-foreground/90">
                                                Programme de parrainage RSI
                                            </div>
                                        </div>
                                        <div className="space-y-3 px-4 py-3 text-[12px] leading-relaxed">
                                            <div className="flex gap-3">
                                                <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                                                <div>
                                                    <div className="font-semibold text-foreground/90">
                                                        Pour le nouveau pilote
                                                    </div>
                                                    <div className="text-muted-foreground">
                                                        Tu reçois{" "}
                                                        <span className="font-semibold text-primary">
                                                            50&nbsp;000&nbsp;UEC
                                                        </span>{" "}
                                                        offerts dès la création de ton compte RSI avec ce code.
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-3">
                                                <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                <div>
                                                    <div className="font-semibold text-foreground/90">
                                                        Points de parrainage
                                                    </div>
                                                    <div className="text-muted-foreground">
                                                        Chaque fois qu'une recrue achète un pack de jeu de{" "}
                                                        <span className="font-semibold">40&nbsp;$</span>{" "}
                                                        ou plus, le parrain gagne 1 point.
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-3">
                                                <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                                                <div>
                                                    <div className="font-semibold text-foreground/90">
                                                        Récompenses exclusives
                                                    </div>
                                                    <div className="text-muted-foreground">
                                                        Les points cumulés débloquent des récompenses RSI exclusives
                                                        (skins, items, accès anticipés).
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="border-t border-border/40 px-4 py-2.5">
                                            <a
                                                href="https://robertsspaceindustries.com/referral-program"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    window.open(
                                                        "https://robertsspaceindustries.com/referral-program",
                                                        "_blank",
                                                        "noopener,noreferrer"
                                                    );
                                                }}
                                                className="text-[11px] text-primary hover:underline"
                                            >
                                                → Voir le programme officiel RSI
                                            </a>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => copy(REFERRAL_CODE, "code")}
                                    className="flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 font-mono text-[11px] tracking-wider text-white/95 transition-colors hover:bg-black/35"
                                    title="Copier le code"
                                >
                                    <span>{REFERRAL_CODE}</span>
                                    {copiedCode ? (
                                        <Check className="h-3 w-3 text-emerald-300" />
                                    ) : (
                                        <Copy className="h-3 w-3 opacity-60" />
                                    )}
                                </button>
                                <button
                                    onClick={() => copy(REFERRAL_URL, "link")}
                                    className="flex h-7 items-center gap-1.5 rounded-full bg-emerald-500/85 px-3 text-[11px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(52,211,153,0.6)] transition-colors hover:bg-emerald-500"
                                    title="Copier le lien d'inscription complet"
                                >
                                    {copiedLink ? (
                                        <Check className="h-3 w-3" />
                                    ) : (
                                        <Copy className="h-3 w-3" />
                                    )}
                                    <span>{copiedLink ? "Copié" : "Copier le lien"}</span>
                                </button>
                            </div>

                            <button
                                onClick={() => {
                                    setState("collapsed");
                                    setActiveBanner(null);
                                    persistCollapsed(true);
                                }}
                                className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                                title="Réduire (le bandeau ne se rouvrira plus automatiquement)"
                                aria-label="Réduire le bandeau de parrainage"
                            >
                                <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </m.div>
                ) : (
                    <m.button
                        key="collapsed"
                        initial={{ y: -24, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -24, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        onClick={() => {
                            setState("open");
                            setActiveBanner("referral");
                        }}
                        className="startrad-referral-pill pointer-events-auto relative flex h-7 items-center gap-2 rounded-b-2xl border border-t-0 border-primary/50 bg-gradient-to-b from-primary/40 to-primary/25 px-3.5 text-[11.5px] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_rgba(160,120,255,0.7)] backdrop-blur-xl transition-all hover:from-primary/55 hover:to-primary/35"
                        title="Afficher le code de parrainage (50 000 UEC offerts)"
                    >
                        {/* Halo pulsant pour attirer l'œil */}
                        <span
                            aria-hidden
                            className="absolute inset-0 -z-10 rounded-b-2xl bg-primary/40 opacity-60 blur-md"
                            style={{ animation: "startrad-pill-pulse 2.4s ease-in-out infinite" }}
                        />
                        {/* Dot d'accroche */}
                        <span
                            aria-hidden
                            className="absolute -right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                            style={{ animation: "startrad-pill-dot 2s ease-in-out infinite" }}
                        />
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="text-white drop-shadow-sm">
                            Parrainage <span className="font-bold">50 000 UEC</span>
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-90" />
                    </m.button>
                )}
            </AnimatePresence>
        </div>
    );
}
