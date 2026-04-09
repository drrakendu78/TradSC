export type OverlayHubKind = "iframe" | "webview";
export type OverlayHubSource = "builtin" | "custom";

export interface OverlayHubItem {
    id: string;
    label: string;
    kind: OverlayHubKind;
    url: string;
    width: number;
    height: number;
    opacity: number;
    source: OverlayHubSource;
    iconKey: string;
}
