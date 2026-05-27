import { ExternalLink, PictureInPicture2, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

export interface ToolPageHeaderProps {
    icon: LucideIcon;
    iconClassName?: string;
    toolName: string;
    detail?: string;
    onRefresh: () => void;
    onOpenOverlay?: () => void;
    onOpenExternal?: () => void;
    /** Boutons additionnels rendus à gauche de Refresh (ex. « Copier trad FR » sur SCMDB). */
    customActions?: React.ReactNode;
}

const TOOLTIP =
    "z-50 select-none rounded-md border border-white/10 bg-zinc-900/95 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-100 shadow-md backdrop-blur";

function IconButton(props: {
    onClick?: () => void;
    tooltip: string;
    ariaLabel: string;
    children: React.ReactNode;
}) {
    const { onClick, tooltip, ariaLabel, children } = props;
    return (
        <Tooltip.Root delayDuration={250}>
            <Tooltip.Trigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                >
                    {children}
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={6} className={TOOLTIP}>
                    {tooltip}
                    <Tooltip.Arrow className="fill-zinc-900/95" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

export function ToolPageHeader({
    icon: Icon,
    iconClassName,
    toolName,
    detail,
    onRefresh,
    onOpenOverlay,
    onOpenExternal,
    customActions,
}: ToolPageHeaderProps) {
    return (
        <Tooltip.Provider>
            <div className="flex h-9 w-full shrink-0 items-center justify-between border-b border-[hsl(var(--primary)/0.10)] bg-[hsl(var(--background)/0.40)] px-2 backdrop-blur-md">
                {/* Left — tool identity */}
                <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClassName ?? "text-primary"}`} />
                    <span className="truncate text-[12px] font-medium tracking-wide text-foreground">
                        {toolName}
                    </span>
                    {detail && (
                        <span className="hidden truncate text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
                            · {detail}
                        </span>
                    )}
                </div>

                {/* Right — actions */}
                <div className="flex h-full shrink-0 items-center gap-0.5 pr-1">
                    {customActions}
                    {customActions && (
                        <div className="mx-1 h-3 w-px bg-white/10" aria-hidden />
                    )}
                    <IconButton tooltip="Rafraîchir" ariaLabel="Rafraîchir" onClick={onRefresh}>
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </IconButton>
                    {onOpenOverlay && (
                        <IconButton
                            tooltip="Détacher en overlay"
                            ariaLabel="Détacher en overlay"
                            onClick={onOpenOverlay}
                        >
                            <PictureInPicture2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                    )}
                    {onOpenExternal && (
                        <IconButton
                            tooltip="Ouvrir dans le navigateur"
                            ariaLabel="Ouvrir dans le navigateur"
                            onClick={onOpenExternal}
                        >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                    )}
                </div>
            </div>
        </Tooltip.Provider>
    );
}
