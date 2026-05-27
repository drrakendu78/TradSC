import { useMemo, useRef, useState } from "react";
import {
    BookOpen,
    Crosshair,
    Database,
    Eye,
    Hammer,
    LayoutGrid,
    Lock,
    Map as MapIcon,
    Move,
    PackageCheck,
    PenTool,
    Pickaxe,
    Plane,
    Route,
    Search,
    Server,
    ShieldCheck,
    Swords,
    Truck,
    Unlock,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { LucideIcon } from "lucide-react";

export type OverlayHubCategory = "combat" | "trading" | "crafting" | "database" | "misc";

export interface OverlayHubTool {
    id: string;
    label: string;
    category: OverlayHubCategory;
    iconName: string;
    isOpen?: boolean;
    isNew?: boolean;
}

export type OverlayHubPreset =
    | "free"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right";

export interface OverlayHubBarProps {
    tools: OverlayHubTool[];
    isLocked: boolean;
    /** Orientation du rail principal. Vertical = empilé (utilisé quand le
     *  hub est snap aux presets `left` ou `right`). Défaut horizontal. */
    orientation?: "horizontal" | "vertical";
    onToolClick: (id: string) => void;
    onLockToggle: (next: boolean) => void;
    onOpenAllTools?: () => void;
    /** Si true, affiche le bouton "sélecteur de position" qui spawn la
     *  mini-fenêtre Tauri `/overlay-hub-preset-picker`. La sélection est
     *  propagée via l'event Tauri `overlay_hub_preset_change` que
     *  OverlayHub.tsx écoute déjà. Si false, le bouton est masqué. */
    enablePresetPicker?: boolean;
}

// Icon name (string from props) → Lucide component.
// Le hub déclare son catalogue côté front, on map ici pour éviter une dépendance
// runtime à `lucide-react/dynamicIconImports`.
const ICONS: Record<string, LucideIcon> = {
    crosshair: Crosshair,
    swords: Swords,
    route: Route,
    "package-check": PackageCheck,
    pickaxe: Pickaxe,
    "shield-check": ShieldCheck,
    hammer: Hammer,
    "pen-tool": PenTool,
    server: Server,
    database: Database,
    map: MapIcon,
    search: Search,
    plane: Plane,
    eye: Eye,
    truck: Truck,
    "book-open": BookOpen,
};

// Labels courts mono pour chaque catégorie (affichés en uppercase 9 px).
const CATEGORY_LABEL: Record<OverlayHubCategory, string> = {
    combat: "CMB",
    trading: "TRD",
    crafting: "CRF",
    database: "DTA",
    misc: "MSC",
};

const CATEGORY_ORDER: OverlayHubCategory[] = ["combat", "trading", "crafting", "database", "misc"];

// Tooltip style aligné sur l'aesthetic HUD de la run aidesigner.
const TOOLTIP =
    "z-50 select-none rounded-sm border border-white/10 bg-zinc-900/95 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-100 shadow-md backdrop-blur";

function ToolButton({
    tool,
    onClick,
}: {
    tool: OverlayHubTool;
    onClick: () => void;
}) {
    const Icon = ICONS[tool.iconName] ?? Database;
    const active = tool.isOpen === true;
    return (
        <Tooltip.Root delayDuration={250}>
            <Tooltip.Trigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={tool.label}
                    className={[
                        "relative flex h-6 w-6 items-center justify-center rounded-full border border-transparent transition-colors",
                        active
                            ? "bg-cyan-400/10 text-cyan-300 shadow-[0_0_8px_rgba(12,231,247,0.45)]"
                            : "text-slate-400 hover:text-white",
                    ].join(" ")}
                >
                    <Icon className="h-3 w-3" strokeWidth={1.5} />
                    {tool.isNew && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full border border-black bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
                    )}
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={8} className={TOOLTIP}>
                    {tool.label}
                    <Tooltip.Arrow className="fill-zinc-900/95" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

function CategoryGroup({
    category,
    tools,
    onToolClick,
    forceAllExpanded,
    orientation = "horizontal",
}: {
    category: OverlayHubCategory;
    tools: OverlayHubTool[];
    onToolClick: (id: string) => void;
    /** Si true (toggle global "Tout déployer"), force expanded peu importe
     *  l'état hover ou un outil ouvert. */
    forceAllExpanded?: boolean;
    /** Orientation : horizontal (défaut) = label à gauche + outils à droite,
     *  vertical = label en haut + outils empilés en bas. */
    orientation?: "horizontal" | "vertical";
}) {
    if (tools.length === 0) return null;
    // Smart collapse : fidèle au mockup aidesigner Variant A. Au repos la
    // catégorie ne montre que son label (CMB/TRD/etc.) à ~44 px (largeur en
    // mode horizontal, hauteur en mode vertical), et s'étend au hover.
    // Exception : si au moins un outil de la catégorie est ouvert
    // (`isOpen === true`), la catégorie reste forcée étendue pour que le
    // glow cyan de l'outil actif reste visible d'un coup d'œil — utile en
    // cours de session sans avoir à survoler.
    //
    // Surcharge : `forceAllExpanded` (toggle global du bouton LayoutGrid)
    // force TOUTES les catégories en mode étendu, peu importe le hover ou
    // l'état d'un outil ouvert.
    //
    // Implem CSS : on anime `max-width` (horizontal) ou `max-height`
    // (vertical) car `auto` ne s'anime pas en CSS. 300 px couvre la
    // catégorie la plus chargée (TRADING = 6 outils ≈ 220 px). Anim 200 ms
    // ease-out, fade-in des outils synchronisé.
    //
    // Valeurs design aidesigner Variant A conservées : bg-white/[0.02]
    // border /[0.05], label cyan-300/70 tracking-wider sans bold, inner
    // pill bg-black/40 border /40, boutons w-7 h-7 stroke-1.5.
    const forceExpanded = forceAllExpanded || tools.some((t) => t.isOpen === true);
    const isVertical = orientation === "vertical";
    return (
        <div
            className={[
                "group/cat flex overflow-hidden rounded-full border border-white/[0.05] bg-white/[0.02] p-0.5",
                isVertical ? "flex-col items-center" : "items-center",
                isVertical
                    ? "transition-[max-height,background-color] duration-200 ease-out"
                    : "transition-[max-width,background-color] duration-200 ease-out",
                isVertical
                    ? forceExpanded
                        ? "max-h-[300px]"
                        : "max-h-[36px] cursor-pointer hover:max-h-[300px] hover:bg-white/[0.05]"
                    : forceExpanded
                        ? "max-w-[300px]"
                        : "max-w-[36px] cursor-pointer hover:max-w-[300px] hover:bg-white/[0.05]",
            ].join(" ")}
        >
            <div
                className={[
                    "flex shrink-0 items-center justify-center text-center font-mono text-[9px] uppercase tracking-wider text-cyan-300/70",
                    // En vertical, h-8 (32 px) = max-h collapsed (36 px) - padding wrapper (4 px),
                    // donc le label remplit toute la hauteur visible du cercle en mode collapsed
                    // → texte centré verticalement dans le cercle.
                    isVertical ? "h-8 w-6" : "px-2",
                ].join(" ")}
            >
                {CATEGORY_LABEL[category]}
            </div>
            <div
                className={[
                    "flex rounded-full border border-black/40 bg-black/40 p-0.5 transition-opacity duration-200",
                    isVertical ? "flex-col items-center" : "items-center whitespace-nowrap",
                    forceExpanded ? "opacity-100" : "opacity-0 group-hover/cat:opacity-100",
                ].join(" ")}
            >
                {tools.map((t) => (
                    <ToolButton key={t.id} tool={t} onClick={() => onToolClick(t.id)} />
                ))}
            </div>
        </div>
    );
}

export function OverlayHubBar({
    tools,
    isLocked,
    orientation = "horizontal",
    onToolClick,
    onLockToggle,
    onOpenAllTools,
    enablePresetPicker = false,
}: OverlayHubBarProps) {
    // Toggle "Tout déployer" — quand actif, toutes les catégories sont
    // forcées en mode étendu (le smart collapse hover est court-circuité).
    // Le hub s'élargit, la fenêtre Tauri suit via ResizeObserver + setSize
    // (cf. OverlayHub.tsx), et SetWindowRgn recalcule la pill côté Rust.
    const [allExpanded, setAllExpanded] = useState(false);

    // Le sélecteur de position est rendu dans une mini-fenêtre Tauri
    // dédiée (route /overlay-hub-preset-picker), spawnée à la demande.
    // Comme l'œil, c'est une fenêtre indépendante qui ne perturbe pas
    // la pill SetWindowRgn du hub. Le bouton Move ci-dessous se sert de
    // ce ref pour calculer la position de la mini-fenêtre.
    const presetButtonRef = useRef<HTMLButtonElement | null>(null);

    const isVertical = orientation === "vertical";

    const byCategory = useMemo(() => {
        const map: Record<OverlayHubCategory, OverlayHubTool[]> = {
            combat: [],
            trading: [],
            crafting: [],
            database: [],
            misc: [],
        };
        for (const t of tools) {
            map[t.category]?.push(t);
        }
        return map;
    }, [tools]);

    return (
        <Tooltip.Provider>
            {/* `rounded-full` (vraie pill) — la fenêtre Tauri elle-même est
             *  découpée à la même forme via `SetWindowRgn` côté Rust
             *  (`apply_hub_pill_region`) pour qu'on ne voie aucun bord
             *  rectangulaire dépasser. Trade-off : bord arrondi pixelisé. */}
            <div
                data-tauri-drag-region={!isLocked ? "" : undefined}
                className={[
                    "flex gap-2 rounded-full border bg-[rgba(8,12,17,0.75)] backdrop-blur-md transition-colors",
                    isVertical
                        ? "flex-col items-center px-0.5 py-1 pb-1.5"
                        : "items-center py-1 pl-1 pr-1.5",
                    "shadow-[0_4px_30px_rgba(0,0,0,0.5)]",
                    isLocked
                        ? "border-cyan-400/30 shadow-[0_0_0_1px_rgba(12,231,247,0.15),0_4px_30px_rgba(0,0,0,0.5)]"
                        : "border-white/[0.10]",
                ].join(" ")}
            >
                {/* Drag affordance (dots) — masqué quand verrouillé.
                 *  En mode vertical : dots horizontaux en haut (matrice 2 lignes × N).
                 *  En mode horizontal : dots verticaux à gauche (inchangé).
                 *  La taille est calée sur le cluster (28 px) pour rester centré. */}
                {!isLocked && (
                    <div
                        className={[
                            "flex shrink-0 cursor-move items-center justify-center",
                            isVertical ? "h-4 w-7" : "h-6 w-5",
                        ].join(" ")}
                        aria-hidden
                    >
                        <div
                            className={isVertical ? "h-2 w-5 opacity-50" : "h-4 w-2 opacity-50"}
                            style={{
                                backgroundImage:
                                    "radial-gradient(circle, #5a7185 1px, transparent 1px)",
                                backgroundSize: "4px 4px",
                            }}
                        />
                    </div>
                )}

                {/* Cluster contrôles (All-tools + Lock) — même style qu'un groupe catégorie.
                 *  Bascule en stack vertical quand le hub est vertical pour
                 *  rester aligné avec la largeur des CategoryGroup en dessous. */}
                <div
                    className={[
                        "flex rounded-full border border-white/[0.05] bg-white/[0.02] p-0.5",
                        isVertical ? "flex-col items-center" : "items-center",
                    ].join(" ")}
                >
                    <div
                        className={[
                            "flex rounded-full border border-black/40 bg-black/40 p-0.5",
                            isVertical ? "flex-col items-center" : "items-center",
                        ].join(" ")}
                    >
                        {/* Toggle "Tout déployer" — étend toutes les catégories
                         *  en mode persistent (vs hover par catégorie). Au
                         *  re-click, retour au smart collapse normal. Le
                         *  callback `onOpenAllTools` est conservé en hook
                         *  optionnel pour permettre au parent de réagir
                         *  (ex: tracking, log). */}
                        <Tooltip.Root delayDuration={250}>
                            <Tooltip.Trigger asChild>
                                <button
                                    type="button"
                                    aria-label={
                                        allExpanded
                                            ? "Refermer les catégories"
                                            : "Tout déployer"
                                    }
                                    onClick={() => {
                                        const next = !allExpanded;
                                        setAllExpanded(next);
                                        onOpenAllTools?.();
                                    }}
                                    className={[
                                        "flex h-6 w-6 items-center justify-center rounded-full border border-transparent transition-colors",
                                        allExpanded
                                            ? "bg-cyan-400/10 text-cyan-300 shadow-[0_0_8px_rgba(12,231,247,0.45)]"
                                            : "text-slate-400 hover:text-white",
                                    ].join(" ")}
                                >
                                    <LayoutGrid className="h-3 w-3" strokeWidth={allExpanded ? 2 : 1.5} />
                                </button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content
                                    side="bottom"
                                    sideOffset={8}
                                    className={TOOLTIP}
                                >
                                    {allExpanded ? "Refermer les catégories" : "Tout déployer"}
                                    <Tooltip.Arrow className="fill-zinc-900/95" />
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                        {/* Sélecteur de position — toggle la mini-fenêtre
                         *  Tauri picker (route /overlay-hub-preset-picker)
                         *  qui rend un grid 3×3 indépendant. Fenêtre dédiée
                         *  pour ne pas perturber la pill SetWindowRgn du hub.
                         *  Position calculée à partir du bounding rect du
                         *  bouton (juste en dessous). */}
                        {enablePresetPicker && (
                            <Tooltip.Root delayDuration={250}>
                                <Tooltip.Trigger asChild>
                                    <button
                                        ref={presetButtonRef}
                                        type="button"
                                        aria-label="Choisir la position du hub"
                                        data-no-drag
                                        onClick={async () => {
                                            const btn = presetButtonRef.current;
                                            if (!btn) return;
                                            const rect = btn.getBoundingClientRect();
                                            const dpr = window.devicePixelRatio || 1;
                                            // Convertit la position du bouton (CSS px relatifs
                                            // au viewport du hub) en coordonnées ÉCRAN physiques
                                            // en ajoutant la position physique de la fenêtre du
                                            // hub. Sinon la mini-fenêtre picker apparaîtrait à
                                            // (rect.left, rect.bottom) DEPUIS le coin 0,0 de
                                            // l'écran, pas sous le bouton.
                                            try {
                                                const winPos = await getCurrentWindow()
                                                    .outerPosition();
                                                const anchorX = Math.round(
                                                    winPos.x + rect.left * dpr,
                                                );
                                                const anchorY = Math.round(
                                                    winPos.y + (rect.bottom + 6) * dpr,
                                                );
                                                await invoke("toggle_hub_preset_picker", {
                                                    anchorX,
                                                    anchorY,
                                                });
                                            } catch (e) {
                                                console.warn(
                                                    "[HubBar] toggle_hub_preset_picker:",
                                                    e,
                                                );
                                            }
                                        }}
                                        className="flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-slate-400 transition-colors hover:text-white"
                                    >
                                        <Move className="h-3 w-3" strokeWidth={1.5} />
                                    </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                    <Tooltip.Content
                                        side="bottom"
                                        sideOffset={8}
                                        className={TOOLTIP}
                                    >
                                        Choisir la position du hub
                                        <Tooltip.Arrow className="fill-zinc-900/95" />
                                    </Tooltip.Content>
                                </Tooltip.Portal>
                            </Tooltip.Root>
                        )}
                        <Tooltip.Root delayDuration={250}>
                            <Tooltip.Trigger asChild>
                                <button
                                    type="button"
                                    aria-label={
                                        isLocked
                                            ? "Hub verrouillé — déverrouiller"
                                            : "Verrouiller le hub"
                                    }
                                    onClick={() => onLockToggle(!isLocked)}
                                    className={[
                                        "flex h-6 w-6 items-center justify-center rounded-full border border-transparent transition-colors",
                                        isLocked
                                            ? "bg-cyan-400/10 text-cyan-300 shadow-[0_0_8px_rgba(12,231,247,0.45)]"
                                            : "text-slate-400 hover:text-white",
                                    ].join(" ")}
                                >
                                    {isLocked ? (
                                        <Lock className="h-3 w-3" strokeWidth={2} />
                                    ) : (
                                        <Unlock className="h-3 w-3" strokeWidth={1.5} />
                                    )}
                                </button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content side="bottom" sideOffset={8} className={TOOLTIP}>
                                    {isLocked
                                        ? "Hub verrouillé — cliquer pour déverrouiller"
                                        : "Verrouiller le hub"}
                                    <Tooltip.Arrow className="fill-zinc-900/95" />
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                    </div>
                </div>

                {/* Rail scrollable des catégories — bascule entre rail
                 *  horizontal (défaut) et stack vertical selon orientation.
                 *  En vertical, les CategoryGroup s'empilent ; chacun reste
                 *  horizontal internement (label + outils côte à côte) avec
                 *  son propre smart collapse hover qui s'étend vers la droite. */}
                <div
                    className={[
                        "flex gap-2",
                        isVertical
                            ? "flex-col items-center overflow-y-auto px-0.5"
                            : "items-center overflow-x-auto py-0.5",
                    ].join(" ")}
                    style={
                        isVertical
                            ? { scrollbarWidth: "none" }
                            : { scrollbarWidth: "none" }
                    }
                >
                    {CATEGORY_ORDER.map((cat) => (
                        <CategoryGroup
                            key={cat}
                            category={cat}
                            tools={byCategory[cat]}
                            onToolClick={onToolClick}
                            forceAllExpanded={allExpanded}
                            orientation={orientation}
                        />
                    ))}
                </div>
            </div>
        </Tooltip.Provider>
    );
}
