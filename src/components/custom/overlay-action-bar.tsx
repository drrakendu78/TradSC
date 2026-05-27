import { Droplet, Eye, EyeOff, Pin, PinOff, RefreshCw, Square, SquareDashed, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import * as Tooltip from "@radix-ui/react-tooltip";

export type OverlayCategory =
    | "combat"
    | "trading"
    | "crafting"
    | "database"
    | "map"
    | "mining";

export interface OverlayActionBarProps {
    toolName: string;
    toolDomain?: string;
    category?: OverlayCategory;
    /** Optionnel : si omis, le bouton refresh n'est pas rendu. */
    onRefresh?: () => void;
    opacity: number;                       // 0..1
    onOpacityChange: (v: number) => void;  // 0..1
    isClickThrough: boolean;
    onClickThroughToggle: (next: boolean) => void;
    /** Optionnels : si pin manquant, le bouton n'est pas rendu. */
    isPinned?: boolean;
    onPinToggle?: (next: boolean) => void;
    /** Optionnel : ajoute un bouton hide/show de l'iframe sous la bar. */
    isHidden?: boolean;
    onHideToggle?: (next: boolean) => void;
    /** Si true : le bouton click-through est remplacé par un placeholder
     *  invisible 26×26 (data-attribute pour ancrer une control window
     *  externe par-dessus). Utilisé sur OverlayView pour que le bouton
     *  œil soit un vrai bouton system (control window) et non un
     *  bouton React interne. */
    clickThroughAsAnchor?: boolean;
    onClose: () => void;
}

const CATEGORY_DOT: Record<OverlayCategory, string> = {
    combat: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.55)]",
    trading: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.55)]",
    crafting: "bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.55)]",
    database: "bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.55)]",
    map: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.55)]",
    mining: "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.55)]",
};

const TOOLTIP_BASE =
    "z-50 select-none rounded-md bg-zinc-900/95 px-2 py-1 text-[10.5px] font-medium text-zinc-100 shadow-md backdrop-blur";

function IconButton(props: {
    onClick?: () => void;
    tooltip: string;
    ariaLabel: string;
    active?: boolean;
    danger?: boolean;
    children: React.ReactNode;
}) {
    const { onClick, tooltip, ariaLabel, active, danger, children } = props;
    // Fond sombre semi-transparent par défaut sur chaque bouton — garantit
    // que les icônes restent lisibles peu importe le fond derrière (un site
    // tiers avec fond blanc rendait les icônes muted-foreground invisibles).
    return (
        <Tooltip.Root delayDuration={300}>
            <Tooltip.Trigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel}
                    className={[
                        "flex h-[26px] w-[26px] items-center justify-center rounded-md bg-black/40 transition-colors",
                        active
                            ? "text-cyan-300 drop-shadow-[0_0_4px_rgba(6,182,212,0.55)] hover:bg-black/55"
                            : danger
                              ? "text-foreground/85 hover:bg-[hsl(var(--destructive))] hover:text-white"
                              : "text-foreground/85 hover:bg-black/55 hover:text-foreground",
                    ].join(" ")}
                >
                    {children}
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={6} className={TOOLTIP_BASE}>
                    {tooltip}
                    <Tooltip.Arrow className="fill-zinc-900/95" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

export function OverlayActionBar({
    toolName,
    toolDomain,
    category = "database",
    onRefresh,
    opacity,
    onOpacityChange,
    isClickThrough,
    onClickThroughToggle,
    isPinned,
    onPinToggle,
    isHidden,
    onHideToggle,
    clickThroughAsAnchor,
    onClose,
}: OverlayActionBarProps) {
    const opacityPct = Math.round(opacity * 100);
    const dotClass = CATEGORY_DOT[category];

    return (
        <Tooltip.Provider>
            <div
                data-tauri-drag-region
                className="flex h-9 w-full items-center justify-between border-b border-[hsl(var(--primary)/0.05)] bg-[hsl(var(--background)/0.2)] px-2 backdrop-blur-sm"
            >
                {/* Left — info (non-interactive, drag passes through) */}
                <div className="pointer-events-none flex h-full flex-1 items-center gap-2.5 overflow-hidden">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                    <span className="truncate text-[12px] font-medium tracking-wide text-foreground">
                        {toolName}
                    </span>
                    {toolDomain && (
                        <span className="hidden truncate text-[10px] text-muted-foreground sm:block">
                            {toolDomain}
                        </span>
                    )}
                </div>

                {/* Right — actions */}
                <div className="pointer-events-auto flex h-full shrink-0 items-center gap-0.5 pr-1">
                    {onRefresh && (
                        <IconButton tooltip="Rafraîchir" ariaLabel="Rafraîchir" onClick={onRefresh}>
                            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                    )}

                    {/* Opacity popover */}
                    <Popover.Root>
                        <Tooltip.Root delayDuration={300}>
                            <Tooltip.Trigger asChild>
                                <Popover.Trigger asChild>
                                    <button
                                        type="button"
                                        aria-label={`Opacité ${opacityPct} %`}
                                        className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-black/40 text-foreground/85 transition-colors hover:bg-black/55 hover:text-foreground"
                                    >
                                        <Droplet className="h-3.5 w-3.5" strokeWidth={1.5} />
                                    </button>
                                </Popover.Trigger>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content
                                    side="bottom"
                                    sideOffset={6}
                                    className={TOOLTIP_BASE}
                                >
                                    Opacité {opacityPct} %
                                    <Tooltip.Arrow className="fill-zinc-900/95" />
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                        <Popover.Portal>
                            <Popover.Content
                                side="bottom"
                                sideOffset={6}
                                align="end"
                                className="z-50 w-44 rounded-md border border-border/50 bg-zinc-950/95 p-3 shadow-lg backdrop-blur"
                            >
                                <div className="mb-2 flex items-center justify-between text-[11px]">
                                    <span className="text-muted-foreground">Opacité</span>
                                    <span className="font-mono tabular-nums text-foreground">
                                        {opacityPct} %
                                    </span>
                                </div>
                                <Slider.Root
                                    className="relative flex h-4 w-full touch-none select-none items-center"
                                    min={30}
                                    max={100}
                                    step={1}
                                    value={[opacityPct]}
                                    onValueChange={(v) => onOpacityChange(v[0] / 100)}
                                    aria-label="Opacité de la fenêtre"
                                >
                                    <Slider.Track className="relative h-1 w-full grow rounded-full bg-white/10">
                                        <Slider.Range className="absolute h-full rounded-full bg-cyan-500" />
                                    </Slider.Track>
                                    <Slider.Thumb className="block h-3 w-3 rounded-full border border-cyan-300 bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.55)] outline-none focus:ring-2 focus:ring-cyan-400" />
                                </Slider.Root>
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>

                    <div className="mx-1 h-3 w-px bg-white/10" />

                    {clickThroughAsAnchor ? (
                        /* Placeholder invisible 26×26 qui réserve l'espace
                         * du bouton click-through. La control window
                         * (spawn côté Rust) viendra se positionner pile
                         * dessus via getBoundingClientRect, et c'est
                         * elle qui sera le vrai bouton interactif. */
                        <div
                            aria-label="Basculer le mode fantôme"
                            data-click-through-anchor
                            className="h-[26px] w-[26px] shrink-0"
                        />
                    ) : (
                        <IconButton
                            tooltip={
                                isClickThrough
                                    ? "Mode fantôme actif — clics traversent l'overlay"
                                    : "Mode fantôme — clics traversent l'overlay"
                            }
                            ariaLabel="Basculer le mode fantôme"
                            onClick={() => onClickThroughToggle(!isClickThrough)}
                            active={isClickThrough}
                        >
                            {isClickThrough ? (
                                <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                            ) : (
                                <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                            )}
                        </IconButton>
                    )}

                    {onPinToggle && (
                        <IconButton
                            tooltip={isPinned ? "Toujours au-dessus" : "Épingler au-dessus"}
                            ariaLabel="Basculer toujours au-dessus"
                            onClick={() => onPinToggle(!isPinned)}
                            active={!!isPinned}
                        >
                            {isPinned ? (
                                <Pin className="h-3.5 w-3.5" strokeWidth={2} />
                            ) : (
                                <PinOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                            )}
                        </IconButton>
                    )}

                    {onHideToggle && (
                        <IconButton
                            tooltip={isHidden ? "Afficher le contenu" : "Masquer le contenu"}
                            ariaLabel="Basculer affichage du contenu"
                            onClick={() => onHideToggle(!isHidden)}
                            active={!!isHidden}
                        >
                            {isHidden ? (
                                <SquareDashed className="h-3.5 w-3.5" strokeWidth={1.5} />
                            ) : (
                                <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
                            )}
                        </IconButton>
                    )}

                    <div className="mx-1 h-3 w-px bg-white/10" />

                    <IconButton
                        tooltip="Fermer"
                        ariaLabel={`Fermer ${toolName}`}
                        onClick={onClose}
                        danger
                    >
                        <X className="h-4 w-4" strokeWidth={1.5} />
                    </IconButton>
                </div>
            </div>
        </Tooltip.Provider>
    );
}
