import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { XMLParser } from "fast-xml-parser";
import { ExternalLink } from "lucide-react";

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

    if (items === null) {
        return <Skeleton className="h-[160px] w-full" />;
    }

    return (
        <div className="flex flex-col gap-3 flex-1">
            <ul className="space-y-3 flex-1">
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
                    const preview = stripHtml(content).substring(0, 80) + (stripHtml(content).length > 80 ? '...' : '');
                    const imageUrl = extractImageFromHtml(content);
                    
                    const CardWrapper = url ? 'a' : 'div';
                    const wrapperProps = url ? {
                        href: url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        onClick: async (e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (url) {
                                await handleClick(item, e, url).catch(err => {
                                    console.error('Error in handleClick:', err);
                                });
                            }
                        },
                        className: "block rounded-lg shadow hover:bg-background/60 transition-all duration-200 cursor-pointer border border-border hover:border-primary/50 group overflow-hidden no-underline"
                    } : {
                        className: "rounded-lg shadow hover:bg-background/60 transition-all duration-200 border border-border group overflow-hidden"
                    };
                    
                    return (
                        <li key={idx}>
                            <CardWrapper {...wrapperProps}>
                                <div className="flex items-stretch gap-0">
                                    {imageUrl && (
                                        <div className="flex-shrink-0 w-20 overflow-hidden rounded-l-lg">
                                            <img 
                                                src={imageUrl} 
                                                alt={getText(item.title)}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', minHeight: '60px' }}
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div className="flex-1 p-2 space-y-1 min-h-[60px]">
                                        <div className="flex items-start justify-between gap-2">
                                            <h3 className="font-semibold text-xs hover:text-primary transition-colors group-hover:text-primary flex-1 line-clamp-2">
                                                {getText(item.title)}
                                            </h3>
                                            {url && (
                                                <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                                            )}
                                        </div>
                                        {preview && (
                                            <p className="text-xs text-muted-foreground line-clamp-1">
                                                {preview}
                                            </p>
                                        )}
                                        <time className="text-xs text-muted-foreground block">
                                            {new Date(item.updated).toLocaleString('fr-FR', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </time>
                                    </div>
                                </div>
                            </CardWrapper>
                        </li>
                    );
                })}
            </ul>
            <div className="mt-auto">
                <Link to="/actualites">
                    <Button variant="secondary" size="sm" className="hover:scale-[1.01] transition">Voir toutes les actualités</Button>
                </Link>
            </div>
        </div>
    );
}

