import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { XMLParser } from "fast-xml-parser";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

const RSS_URL = "https://leonick.se/feeds/rsi/atom";

interface RssItem {
    title: string;
    link: any;
    updated: string;
    content: {
        "#text": string;
    };
    id?: string;
    summary?: string;
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
    // Chercher une balise img
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch && imgMatch[1]) {
        return imgMatch[1];
    }
    // Chercher dans les attributs data-src ou data-lazy-src (images lazy-load)
    const dataSrcMatch = html.match(/<img[^>]+(?:data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i);
    if (dataSrcMatch && dataSrcMatch[1]) {
        return dataSrcMatch[1];
    }
    return null;
}

export default function Actualites() {
    const [items, setItems] = useState<RssItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawXml, setRawXml] = useState<string>("");

    const fetchRss = async () => {
        try {
            setLoading(true);
            setError(null);
            const text = await fetchRssData();
            setRawXml(text);
            
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_"
            });
            const xml = parser.parse(text);
            
            if (!xml.feed?.entry) {
                throw new Error('Invalid RSS feed format');
            }
            const entries = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
            setItems(entries);
        } catch (err) {
            console.error('RSS fetch error:', err);
            setError(err instanceof Error ? err.message : "Failed to load RSS feed");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRss();
    }, []);

    const handleClick = async (item: RssItem, e: React.MouseEvent, url?: string) => {
        console.log('handleClick called with URL:', url);
        e.preventDefault();
        e.stopPropagation();
        
        // Si l'URL n'est pas fournie, essayer de l'extraire
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
        
        if (!finalUrl) {
            console.error('No URL provided for item:', item);
            console.error('Item data:', item);
            return;
        }
        
        console.log('Opening URL:', finalUrl);
        console.log('URL type:', typeof finalUrl);
        console.log('URL length:', finalUrl?.length);
        
        if (!finalUrl || typeof finalUrl !== 'string' || finalUrl.trim() === '') {
            console.error('Invalid URL:', finalUrl);
            return;
        }
        
        try {
            // Utiliser invoke comme dans la V1, mais adapté pour Tauri v2
            const result = await invoke("open_external", { url: finalUrl.trim() });
            console.log('Invoke result:', result);
            console.log('URL opened successfully');
        } catch (error) {
            console.error('Error opening URL with invoke:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
            // Fallback: utiliser le plugin shell directement
            try {
                const { open } = await import("@tauri-apps/plugin-shell");
                await open(finalUrl.trim());
                console.log('URL opened with shell plugin');
            } catch (shellError) {
                console.error('Error with shell plugin:', shellError);
                // Dernier fallback: ouvrir dans une nouvelle fenêtre
                try {
                    window.open(finalUrl.trim(), '_blank', 'noopener,noreferrer');
                    console.log('URL opened with window.open');
                } catch (windowError) {
                    console.error('Error with window.open:', windowError);
                }
            }
        }
    };

    if (loading) {
        return (
            <motion.div
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
                className="flex w-full h-full flex-col gap-4 p-2 pr-3"
            >
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold">Actualités Star Citizen</h1>
                </div>
                <div className="space-y-4">
                    <Skeleton className="h-[200px] w-full" />
                    <Skeleton className="h-[200px] w-full" />
                    <Skeleton className="h-[200px] w-full" />
                </div>
            </motion.div>
        );
    }

    if (error) {
        return (
            <motion.div
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
                className="flex w-full h-full flex-col gap-4 p-2 pr-3"
            >
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold">Actualités Star Citizen</h1>
                </div>
                <Card className="bg-background/40 p-4 border-red-500/50">
                    <CardContent>
                        <h3 className="text-red-700 dark:text-red-400 font-semibold mb-2">Erreur lors du chargement du flux RSS</h3>
                        <p className="text-red-600 dark:text-red-300 mb-4">{error}</p>
                        <Button 
                            onClick={fetchRss}
                            variant="outline"
                            className="gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Réessayer
                        </Button>
                    </CardContent>
                </Card>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
            className="flex w-full h-full flex-col gap-4 p-2 pr-3"
        >
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Actualités Star Citizen</h1>
                <Button 
                    onClick={fetchRss}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={loading}
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Actualiser
                </Button>
            </div>
            
            <div className="space-y-4 max-h-[calc(100vh-130px)] overflow-y-auto pr-3">
                {items.length === 0 ? (
                    <Card className="bg-background/40 p-4">
                        <CardContent>
                            <p className="text-muted-foreground">Aucune actualité disponible.</p>
                        </CardContent>
                    </Card>
                ) : (
                    items.map((item, i) => {
                        // Extraire le XML brut de l'item pour le fallback
                        let itemXml = undefined;
                        const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
                        if (rawXml) {
                            const entryRegex = new RegExp(`<entry[\\s\\S]*?<title>${title}<\\/title>[\\s\\S]*?<\\/entry>`, 'i');
                            const found = rawXml.match(entryRegex);
                            itemXml = found ? found[0] : undefined;
                        }
                        
                        const url = getItemUrl(item, itemXml);
                        const content = getText(item.content?.["#text"] || item.summary || "");
                        const preview = stripHtml(content).substring(0, 200) + (stripHtml(content).length > 200 ? '...' : '');
                        const imageUrl = extractImageFromHtml(content);
                        
                        console.log(`Item ${i} URL:`, url);
                        
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
                            className: "block bg-background/40 rounded-lg shadow hover:bg-background/60 transition-all duration-200 cursor-pointer border border-border hover:border-primary/50 group overflow-hidden no-underline"
                        } : {
                            className: "bg-background/40 rounded-lg shadow hover:bg-background/60 transition-all duration-200 border border-border group overflow-hidden"
                        };

                        return (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: i * 0.1 }}
                            >
                                <CardWrapper {...wrapperProps}>
                                    <div className="p-0">
                                        <div className="flex items-stretch gap-0">
                                            {imageUrl && (
                                                <div className="flex-shrink-0 w-48 overflow-hidden rounded-l-lg">
                                                    <img 
                                                        src={imageUrl} 
                                                        alt={getText(item.title)}
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                        }}
                                                    />
                                                </div>
                                            )}
                                            <div className="flex-1 p-4 space-y-3 min-h-[128px]">
                                                <div className="flex items-start justify-between gap-4">
                                                    <h3 className="font-semibold text-lg hover:text-primary transition-colors group-hover:text-primary flex-1">
                                                        {getText(item.title)}
                                                    </h3>
                                                    {url && (
                                                        <ExternalLink className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
                                                    )}
                                                </div>
                                                <time className="text-xs text-muted-foreground block">
                                                    {new Date(item.updated).toLocaleString('fr-FR', {
                                                        day: 'numeric',
                                                        month: 'long',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </time>
                                                {preview && (
                                                    <p className="text-sm text-muted-foreground line-clamp-3">
                                                        {preview}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </CardWrapper>
                            </motion.div>
                        );
                    })
                )}
            </div>
        </motion.div>
    );
}

