import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import { XMLParser } from "fast-xml-parser";
import { ExternalLink, Sparkles, Clock } from "lucide-react";

const RSS_URL = "https://leonick.se/feeds/rsi/atom";

interface RssItem {
    title: string | { '#text': string };
    link: any;
    updated: string;
    content?: {
        "#text": string;
    };
    summary?: string;
    id?: string;
}

function extractLinkFromXml(xml: string): string | undefined {
    const match = xml.match(/<link[^>]*type=["']text\/html["'][^>]*href=["']([^"']+)["'][^>]*\/?\s*>/);
    return match ? match[1] : undefined;
}

function getItemUrl(item: RssItem, rawXml?: string): string | undefined {
    if (Array.isArray(item.link)) {
        const found = item.link.find((l: any) => l && l["@_type"] === "text/html" && l["@_href"]);
        if (found) return found["@_href"];
    }
    if (typeof item.link === "object" && item.link !== null) {
        if (item.link["@_type"] === "text/html" && item.link["@_href"]) {
            return item.link["@_href"];
        }
        if (item.link["@_href"]) {
            return item.link["@_href"];
        }
    }
    if (typeof item.link === "string" && item.link.trim() !== "") {
        return item.link;
    }
    if (item.id && typeof item.id === "string" && item.id.startsWith("http")) {
        return item.id;
    }
    const html = item.content?.["#text"] || item.summary || "";
    const match = html.match(/href="([^"]+)"/);
    if (match) {
        return match[1];
    }
    if (rawXml) {
        const extracted = extractLinkFromXml(rawXml);
        if (extracted) return extracted;
    }
    return undefined;
}

function getText(val: any): string {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && '#text' in val) return val['#text'];
    return '';
}

function stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function extractImageFromHtml(html: string): string | null {
    if (!html) return null;
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch && imgMatch[1]) {
        return imgMatch[1];
    }
    const dataSrcMatch = html.match(/<img[^>]+(?:data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i);
    if (dataSrcMatch && dataSrcMatch[1]) {
        return dataSrcMatch[1];
    }
    return null;
}

async function fetchRssData(): Promise<string> {
    try {
        return await invoke("fetch_rss");
    } catch (e) {
        console.warn('Not in Tauri environment, using proxy server...');
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(RSS_URL);
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.text();
    }
}

export default function RecentActualites({ max = 3 }: { max?: number }) {
    const [items, setItems] = useState<RssItem[] | null>(null);
    const [rawXml, setRawXml] = useState<string | null>(null);

    useEffect(() => {
        const fetchRss = async () => {
            try {
                const text = await fetchRssData();
                setRawXml(text);
                const parser = new XMLParser({
                    ignoreAttributes: false,
                    attributeNamePrefix: "@_"
                });
                const xml = parser.parse(text);

                if (!xml.feed?.entry) {
                    setItems([]);
                    return;
                }

                const entries = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
                setItems(entries);
            } catch (err) {
                console.error('RSS fetch error:', err);
                setItems([]);
            }
        };
        fetchRss();
    }, []);

    const handleClick = async (item: RssItem, e: React.MouseEvent, url?: string) => {
        e.preventDefault();
        e.stopPropagation();

        let finalUrl = url;
        if (!finalUrl) {
            let itemXml = undefined;
            const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
            if (rawXml) {
                const entryRegex = new RegExp(`<entry[\\s\\S]*?<title>${title}<\\/title>[\\s\\S]*?<\\/entry>`, 'i');
                const found = rawXml.match(entryRegex);
                itemXml = found ? found[0] : undefined;
            }
            finalUrl = getItemUrl(item, itemXml);
        }

        if (!finalUrl || typeof finalUrl !== 'string' || finalUrl.trim() === '') {
            return;
        }

        try {
            await invoke("open_external", { url: finalUrl.trim() });
        } catch (error) {
            try {
                const { open } = await import("@tauri-apps/plugin-shell");
                await open(finalUrl.trim());
            } catch (shellError) {
                window.open(finalUrl.trim(), '_blank', 'noopener,noreferrer');
            }
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Aujourd'hui";
        if (diffDays === 1) return "Hier";
        if (diffDays < 7) return `Il y a ${diffDays} jours`;

        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short'
        });
    };

    const getCategoryFromTitle = (title: string): string => {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('subscriber') || lowerTitle.includes('promotion')) return 'Promo';
        if (lowerTitle.includes('letter') || lowerTitle.includes('chairman')) return 'Lettre';
        if (lowerTitle.includes('this week') || lowerTitle.includes('week in')) return 'Hebdo';
        if (lowerTitle.includes('patch') || lowerTitle.includes('update')) return 'Patch';
        if (lowerTitle.includes('star citizen live') || lowerTitle.includes('scl')) return 'Live';
        if (lowerTitle.includes('inside star citizen') || lowerTitle.includes('isc')) return 'ISC';
        return 'Actu';
    };

    if (items === null) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {items.slice(0, max).map((item, idx) => {
                let itemXml = undefined;
                const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
                if (rawXml) {
                    const entryRegex = new RegExp(`<entry[\\s\\S]*?<title>${title}<\\/title>[\\s\\S]*?<\\/entry>`, 'i');
                    const found = rawXml.match(entryRegex);
                    itemXml = found ? found[0] : undefined;
                }

                const url = getItemUrl(item, itemXml);
                const content = getText(item.content?.["#text"] || item.summary || "");
                const preview = stripHtml(content).substring(0, 60) + (stripHtml(content).length > 60 ? '...' : '');
                const imageUrl = extractImageFromHtml(content);
                const titleText = getText(item.title);
                const category = getCategoryFromTitle(titleText);

                return (
                    <div
                        key={idx}
                        onClick={(e) => url && handleClick(item, e, url)}
                        className={`
                            relative rounded-lg border transition-all duration-200 overflow-hidden
                            ${url ? 'cursor-pointer' : ''}
                            ${idx === 0
                                ? 'bg-primary/10 border-primary/30 hover:border-primary/50'
                                : 'bg-muted/30 border-border/50 hover:border-border'
                            }
                        `}
                    >
                        <div className="flex items-stretch">
                            {imageUrl && (
                                <div className="flex-shrink-0 w-24 overflow-hidden">
                                    <img
                                        src={imageUrl}
                                        alt={titleText}
                                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                                        style={{ minHeight: '80px' }}
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />
                                </div>
                            )}
                            <div className="flex-1 p-3 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <Badge
                                        variant={idx === 0 ? "default" : "secondary"}
                                        className="text-[10px] px-1.5 py-0 h-5"
                                    >
                                        {category}
                                    </Badge>
                                    {idx === 0 && (
                                        <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                                            <Sparkles className="h-3 w-3" />
                                            Nouveau
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto shrink-0">
                                        <Clock className="h-3 w-3" />
                                        {formatDate(item.updated)}
                                    </div>
                                </div>
                                <h3 className="text-sm font-medium line-clamp-1 mb-1 group-hover:text-primary">
                                    {titleText}
                                </h3>
                                {preview && (
                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                        {preview}
                                    </p>
                                )}
                            </div>
                            {url && (
                                <div className="flex items-center pr-3">
                                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
