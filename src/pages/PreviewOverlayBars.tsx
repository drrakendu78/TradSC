import { useState } from "react";
import {
    OverlayActionBar,
    type OverlayCategory,
} from "@/components/custom/overlay-action-bar";
import { OverlayHubBar, type OverlayHubTool } from "@/components/custom/overlay-hub-bar";

const SAMPLE_TOOLS: OverlayHubTool[] = [
    { id: "erkul", label: "DPS (Erkul)", category: "combat", iconName: "crosshair" },
    { id: "pvp", label: "Zones PVP", category: "combat", iconName: "swords", isNew: true },
    { id: "uexcorp", label: "Routes (UEX)", category: "trading", iconName: "route" },
    { id: "sc-cargo", label: "SC Cargo", category: "trading", iconName: "package-check", isOpen: true },
    { id: "schaulers", label: "Schaulers", category: "trading", iconName: "package-check" },
    { id: "allsky", label: "AllSky Mining", category: "trading", iconName: "pickaxe" },
    { id: "protixit", label: "Protixit Rep", category: "trading", iconName: "shield-check" },
    { id: "crafter", label: "Crafter (SCCrafter)", category: "crafting", iconName: "hammer" },
    { id: "sc-craft-tools", label: "SC Craft Tools", category: "crafting", iconName: "pen-tool" },
    { id: "scdb-space", label: "SCDB Space", category: "crafting", iconName: "server" },
    { id: "scmdb", label: "SCMDB", category: "database", iconName: "database" },
    { id: "verseguide", label: "VerseGuide", category: "database", iconName: "map" },
    { id: "finder", label: "Finder", category: "database", iconName: "search" },
    { id: "shipmaps", label: "ShipMaps", category: "database", iconName: "plane" },
    { id: "sp-viewer", label: "SP Viewer", category: "misc", iconName: "eye" },
    { id: "hauler", label: "Hauler", category: "misc", iconName: "truck" },
];

const SAMPLE_BARS: Array<{
    toolName: string;
    toolDomain: string;
    category: OverlayCategory;
}> = [
    { toolName: "SCMDB — Base de données", toolDomain: "scmdb.space", category: "database" },
    { toolName: "Erkul — DPS Calculator", toolDomain: "erkul.games", category: "combat" },
    { toolName: "UEX Corp — Routes", toolDomain: "uexcorp.space", category: "trading" },
    { toolName: "Crafter (SCCrafter)", toolDomain: "sccrafter.com", category: "crafting" },
    { toolName: "VerseGuide", toolDomain: "verseguide.com", category: "map" },
    { toolName: "AllSky Mining", toolDomain: "allskymining.fr", category: "mining" },
];

export default function PreviewOverlayBars() {
    const [opacity, setOpacity] = useState(1);
    const [isClickThrough, setIsClickThrough] = useState(false);
    const [isPinned, setIsPinned] = useState(true);
    const [isLocked, setIsLocked] = useState(false);

    return (
        <div className="flex h-full w-full flex-col gap-8 overflow-y-auto p-6">
            <header className="space-y-1">
                <h1 className="text-lg font-semibold tracking-tight">Preview — Overlay bars</h1>
                <p className="text-xs text-muted-foreground">
                    Pages de prévisualisation isolée. Aucun lien avec les vraies fenêtres overlay
                    — les boutons changent uniquement l'état local de cet écran.
                </p>
            </header>

            {/* ── Action bar ── */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    Overlay Action Bar (header des fenêtres tiers)
                </h2>
                <p className="text-[11px] text-muted-foreground">
                    Variante subtle retenue. État partagé entre toutes les barres : opacity {Math.round(opacity * 100)} %,
                    click-through {isClickThrough ? "actif" : "off"}, pin {isPinned ? "actif" : "off"}.
                </p>

                <div className="space-y-3">
                    {SAMPLE_BARS.map((b) => (
                        <div
                            key={b.toolName}
                            className="overflow-hidden rounded-md border border-border/40 bg-zinc-950"
                        >
                            <OverlayActionBar
                                toolName={b.toolName}
                                toolDomain={b.toolDomain}
                                category={b.category}
                                onRefresh={() => console.log(`refresh ${b.toolName}`)}
                                opacity={opacity}
                                onOpacityChange={setOpacity}
                                isClickThrough={isClickThrough}
                                onClickThroughToggle={setIsClickThrough}
                                isPinned={isPinned}
                                onPinToggle={setIsPinned}
                                onClose={() => console.log(`close ${b.toolName}`)}
                            />
                            <div className="flex h-32 items-center justify-center text-xs uppercase tracking-wider text-muted-foreground/40">
                                {b.toolDomain} iframe content area…
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Hub bar ── */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    Overlay Hub Bar (pill flottante in-game)
                </h2>
                <p className="text-[11px] text-muted-foreground">
                    Variante A d'aidesigner (pills catégorisées CMB/TRD/CRF/DTA/MSC) + cluster
                    cadenas/grille ajouté manuellement. État verrouillé : {isLocked ? "OUI" : "non"}.
                </p>

                {/* Fond stylisé pour simuler le jeu */}
                <div className="relative flex min-h-[180px] items-start justify-center overflow-hidden rounded-md border border-border/40 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-6">
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-20"
                        style={{
                            backgroundImage:
                                "radial-gradient(circle at 30% 40%, hsla(280,100%,50%,0.15) 0%, transparent 50%), radial-gradient(circle at 70% 60%, hsla(190,100%,50%,0.12) 0%, transparent 50%)",
                        }}
                    />
                    <div className="relative">
                        <OverlayHubBar
                            tools={SAMPLE_TOOLS}
                            isLocked={isLocked}
                            onToolClick={(id) => console.log(`tool click: ${id}`)}
                            onLockToggle={setIsLocked}
                            onOpenAllTools={() => console.log("open all tools popover")}
                        />
                    </div>
                </div>
            </section>

            <footer className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200/80">
                Page de prévisualisation interne. À retirer (ou laisser cachée) avant le build de
                release. Pour valider : navigue sur <code>#/preview-overlay-bars</code>.
            </footer>
        </div>
    );
}
