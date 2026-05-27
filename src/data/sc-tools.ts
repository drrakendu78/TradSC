export type ScToolIcon = "server" | "package" | "database" | "hammer" | "route" | "pickaxe" | "shield";

/**
 * Catégories utilisées pour grouper les outils dans la sidebar (sous-dossiers
 * collapsibles "Outils SC"). Garde aligné avec TOOL_CATEGORIES dans
 * app-sidebar.tsx.
 */
export type ScToolCategory = "database" | "economy" | "craft-mining" | "combat" | "ships-guides";

interface ScToolBase {
    id: string;
    label: string;
    detail: string;
    url: string;
    host: string;
    icon: ScToolIcon;
    iconClassName: string;
    /** Sous-dossier de classement dans la sidebar "Outils SC". */
    category: ScToolCategory;
    webviewId?: string;
    webviewWidth?: number;
    webviewHeight?: number;
    webviewOpacity?: number;
    hideIframeScrollbar?: boolean;
    /** Optional URL to a community FR translation file, shown as a copy button. */
    frTranslationUrl?: string;
    /** Optional helper text shown next to the copy button. */
    frTranslationHint?: string;
}

export interface ScIframeTool extends ScToolBase {
    mode: "iframe";
    route: string;
}

export interface ScWebviewTool extends ScToolBase {
    mode: "webview";
}

export type ScTool = ScIframeTool | ScWebviewTool;

export const SC_EXTERNAL_TOOLS: ScTool[] = [
    {
        id: "schaulers",
        label: "Schaulers",
        detail: "App",
        url: "https://schaulers.space/app",
        host: "schaulers.space",
        mode: "iframe",
        route: "/schaulers",
        icon: "server",
        iconClassName: "text-sky-400",
        category: "database",
    },
    {
        id: "sc-cargo-viewer",
        label: "SC Cargo",
        detail: "Viewer",
        url: "https://sc-cargo.space/#/v1/viewer",
        host: "sc-cargo.space",
        mode: "iframe",
        route: "/sc-cargo-viewer",
        icon: "package",
        iconClassName: "text-amber-400",
        category: "economy",
    },
    {
        id: "allsky-mining",
        label: "AllSky Mining",
        detail: "Mining",
        url: "https://mining.getallsky.net/",
        host: "mining.getallsky.net",
        mode: "webview",
        icon: "pickaxe",
        iconClassName: "text-cyan-400",
        category: "craft-mining",
    },
    {
        id: "protixit-reputation",
        label: "Protixit Reputation",
        detail: "Reputation",
        url: "https://www.protixit.com/reputation",
        host: "www.protixit.com",
        mode: "webview",
        icon: "shield",
        iconClassName: "text-emerald-400",
        category: "ships-guides",
    },
    {
        id: "scdb-space",
        label: "SCDB Space",
        detail: "Database",
        url: "https://scdb.space/",
        host: "scdb.space",
        mode: "iframe",
        route: "/scdb-space",
        icon: "database",
        iconClassName: "text-violet-400",
        hideIframeScrollbar: true,
        category: "database",
    },
    {
        id: "sc-craft-tools",
        label: "SC Craft Tools",
        detail: "Craft",
        url: "https://sc-craft.tools/",
        host: "sc-craft.tools",
        mode: "iframe",
        route: "/sc-craft-tools",
        icon: "hammer",
        iconClassName: "text-orange-400",
        category: "craft-mining",
    },
    {
        id: "hauler-spacecoder",
        label: "Hauler",
        detail: "Hauling",
        url: "https://hauler.thespacecoder.space/",
        host: "hauler.thespacecoder.space",
        mode: "iframe",
        route: "/hauler-spacecoder",
        icon: "route",
        iconClassName: "text-lime-400",
        category: "economy",
    },
    {
        // Discord thread #7 (r0m021, 25/05) — calculateur de routes commerciales
        // multi-hop alimenté par UEX. Drrakendu avait promis publiquement
        // l'intégration "ce soir" → livré le 27/05.
        id: "sc-trade-routes",
        label: "SC Trade Routes",
        detail: "Trading",
        url: "https://sc-trade-routes.streamerforge.com/",
        host: "sc-trade-routes.streamerforge.com",
        mode: "iframe",
        route: "/sc-trade-routes",
        icon: "route",
        iconClassName: "text-yellow-400",
        category: "economy",
    },
];

export const SC_IFRAME_TOOLS = SC_EXTERNAL_TOOLS.filter(
    (tool): tool is ScIframeTool => tool.mode === "iframe",
);

export const SC_WEBVIEW_TOOLS = SC_EXTERNAL_TOOLS.filter(
    (tool): tool is ScWebviewTool => tool.mode === "webview",
);
