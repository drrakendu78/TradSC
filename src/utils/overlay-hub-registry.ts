import type { CustomLink } from "@/stores/custom-links-store";
import type { OverlayHubItem } from "@/types/overlay-hub";

interface BuiltinOverlayHubDefinition extends Omit<OverlayHubItem, "url" | "source"> {
    url?: string;
    resolveUrl?: (baseAppUrl: string) => string;
}

const ALLOWED_TOOL_DOMAINS = [
    "erkul.games",
    "spviewer.eu",
    "adi.sc",
    "cstone.space",
    "ratjack.net",
    "verseguide.com",
    "scmdb.net",
    "sccrafter.com",
    "uexcorp.space",
] as const;

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

function extractHost(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    try {
        return new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
        try {
            return new URL(`https://${trimmed}`).hostname.replace(/^www\./i, "").toLowerCase();
        } catch {
            return null;
        }
    }
}

function isAllowedToolUrl(url: string): boolean {
    const host = extractHost(url);
    if (!host) return false;

    return ALLOWED_TOOL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function resolveCustomLabel(name: unknown, url: unknown): string {
    const safeName = String(name ?? "");
    const safeUrl = String(url ?? "");
    const trimmedName = safeName.trim();
    if (trimmedName) {
        return trimmedName;
    }

    const normalizedUrl = safeUrl.trim();
    if (!normalizedUrl) {
        return "LIEN";
    }

    // Supporte aussi les URLs sans protocole (ex: "example.com/path")
    const plainHost = normalizedUrl
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("/")[0]
        .trim();
    if (plainHost) {
        const firstPart = plainHost.split(".")[0]?.trim();
        if (firstPart) return firstPart.toUpperCase();
        return plainHost.toUpperCase();
    }

    try {
        const hostname = new URL(normalizedUrl).hostname.replace(/^www\./i, "").trim();
        if (!hostname) return "";
        const firstPart = hostname.split(".")[0]?.trim();
        return (firstPart || hostname).toUpperCase();
    } catch {
        return "LIEN";
    }
}

export function getBuiltinOverlayHubItems(baseAppUrl: string): OverlayHubItem[] {
    return BUILTIN_OVERLAY_ITEMS.map((item) => ({
        ...item,
        source: "builtin",
        url: item.resolveUrl ? item.resolveUrl(baseAppUrl) : (item.url ?? ""),
    }));
}

export function getCustomOverlayHubItems(customLinks: CustomLink[]): OverlayHubItem[] {
    return customLinks.flatMap((link, index) => {
        const cleanedUrl = String(link.url ?? "").trim();
        if (!cleanedUrl) {
            return [];
        }

        if (!isAllowedToolUrl(cleanedUrl)) {
            return [];
        }

        const label = resolveCustomLabel(link.name, cleanedUrl);
        const cleanedId = String(link.id ?? "").trim() || `link_${index}`;
        const iconKey = typeof link.icon === "string" && link.icon.trim() ? link.icon.trim() : "custom";

        return [{
            id: `custom_${cleanedId}`,
            label,
            kind: "iframe" as const,
            url: cleanedUrl,
            width: 600,
            height: 800,
            opacity: 0.9,
            source: "custom" as const,
            iconKey,
        }];
    });
}

export function getOverlayHubItems(customLinks: CustomLink[], baseAppUrl: string): OverlayHubItem[] {
    return [...getBuiltinOverlayHubItems(baseAppUrl), ...getCustomOverlayHubItems(customLinks)];
}
