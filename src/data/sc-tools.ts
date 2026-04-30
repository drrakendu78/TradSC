export type ScToolIcon = "server" | "package" | "database" | "hammer" | "route" | "pickaxe" | "shield";

interface ScToolBase {
    id: string;
    label: string;
    detail: string;
    url: string;
    host: string;
    icon: ScToolIcon;
    iconClassName: string;
    webviewId?: string;
    webviewWidth?: number;
    webviewHeight?: number;
    webviewOpacity?: number;
    hideIframeScrollbar?: boolean;
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
    },
];

export const SC_IFRAME_TOOLS = SC_EXTERNAL_TOOLS.filter(
    (tool): tool is ScIframeTool => tool.mode === "iframe",
);

export const SC_WEBVIEW_TOOLS = SC_EXTERNAL_TOOLS.filter(
    (tool): tool is ScWebviewTool => tool.mode === "webview",
);
