import type { CustomLink } from "@/stores/custom-links-store";
import type { OverlayHubItem } from "@/types/overlay-hub";

interface BuiltinOverlayHubDefinition extends Omit<OverlayHubItem, "url" | "source"> {
    url?: string;
    resolveUrl?: (baseAppUrl: string) => string;
}

const BUILTIN_OVERLAY_ITEMS: BuiltinOverlayHubDefinition[] = [
    {
        id: "erkul",
        label: "DPS",
        kind: "iframe",
        url: "https://www.erkul.games/live/calculator",
        width: 500,
        height: 700,
        opacity: 1.0,
        iconKey: "dps",
    },
    {
        id: "spviewer",
        label: "SP Viewer",
        kind: "webview",
        url: "https://www.spviewer.eu/",
        width: 900,
        height: 700,
        opacity: 1.0,
        iconKey: "spviewer",
    },
    {
        id: "shipmaps",
        label: "ShipMaps",
        kind: "iframe",
        url: "https://maps.adi.sc/",
        width: 700,
        height: 800,
        opacity: 1.0,
        iconKey: "shipmaps",
    },
    {
        id: "finder",
        label: "Finder",
        kind: "iframe",
        url: "https://finder.cstone.space/",
        width: 500,
        height: 700,
        opacity: 1.0,
        iconKey: "finder",
    },
    {
        id: "pvp",
        label: "Zones PVP",
        kind: "iframe",
        resolveUrl: (baseAppUrl) => `${baseAppUrl}#/pvp-overlay`,
        width: 900,
        height: 760,
        opacity: 1.0,
        iconKey: "pvp",
    },
    {
        id: "cargo",
        label: "Cargo",
        kind: "iframe",
        url: "https://ratjack.net/Star-Citizen/Cargo-Grids/",
        width: 500,
        height: 700,
        opacity: 1.0,
        iconKey: "cargo",
    },
    {
        id: "verseguide",
        label: "VerseGuide",
        kind: "iframe",
        url: "https://verseguide.com/",
        width: 700,
        height: 800,
        opacity: 1.0,
        iconKey: "verseguide",
    },
    {
        id: "scmdb",
        label: "SCMDB",
        kind: "iframe",
        url: "https://scmdb.net/",
        width: 500,
        height: 700,
        opacity: 1.0,
        iconKey: "scmdb",
    },
    {
        id: "crafter",
        label: "Crafter",
        kind: "iframe",
        url: "https://www.sccrafter.com/",
        width: 600,
        height: 800,
        opacity: 0.9,
        iconKey: "crafter",
    },
    {
        id: "uexcorp",
        label: "Routes",
        kind: "webview",
        url: "https://uexcorp.space/",
        width: 600,
        height: 800,
        opacity: 0.9,
        iconKey: "trading",
    },
];

export function getBuiltinOverlayHubItems(baseAppUrl: string): OverlayHubItem[] {
    return BUILTIN_OVERLAY_ITEMS.map((item) => ({
        ...item,
        source: "builtin",
        url: item.resolveUrl ? item.resolveUrl(baseAppUrl) : (item.url ?? ""),
    }));
}

export function getCustomOverlayHubItems(customLinks: CustomLink[]): OverlayHubItem[] {
    return customLinks.map((link) => ({
        id: `custom_${link.id}`,
        label: link.name,
        kind: "iframe" as const,
        url: link.url,
        width: 600,
        height: 800,
        opacity: 0.9,
        source: "custom" as const,
        iconKey: link.icon || "custom",
    }));
}

export function getOverlayHubItems(customLinks: CustomLink[], baseAppUrl: string): OverlayHubItem[] {
    return [...getBuiltinOverlayHubItems(baseAppUrl), ...getCustomOverlayHubItems(customLinks)];
}
