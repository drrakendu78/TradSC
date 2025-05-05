import React, { useEffect, useState } from "react";
import { XMLParser } from "fast-xml-parser";

// Ajout pour TypeScript : déclaration de la propriété globale
declare global {
    interface Window {
        __RSS_RAW_XML__?: string;
    }
}

const RSS_URL = "https://leonick.se/feeds/rsi/atom";

interface RssItem {
    title: string;
    link: any; // Peut être tableau, objet ou string
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
    // Si link est un tableau
    if (Array.isArray(item.link)) {
        const found = item.link.find((l: any) => l && l["@_type"] === "text/html" && l["@_href"]);
        if (found) return found["@_href"];
    }
    // Si link est un objet
    if (typeof item.link === "object" && item.link !== null) {
        if (item.link["@_type"] === "text/html" && item.link["@_href"]) {
            return item.link["@_href"];
        }
        if (item.link["@_href"]) {
            return item.link["@_href"];
        }
    }
    // Si link est une string non vide
    if (typeof item.link === "string" && item.link.trim() !== "") {
        return item.link;
    }
    // Parfois le lien est dans une autre propriété (rare)
    if (item.id && typeof item.id === "string" && item.id.startsWith("http")) {
        return item.id;
    }
    // Fallback : chercher un lien dans le contenu HTML
    const html = item.content?.["#text"] || item.summary || "";
    const match = html.match(/href="([^"]+)"/);
    if (match) {
        return match[1];
    }
    // Fallback ultime : regex sur le XML brut de l'item
    if (rawXml) {
        const extracted = extractLinkFromXml(rawXml);
        if (extracted) return extracted;
    }
    return undefined;
}

async function fetchRssData(): Promise<string> {
    try {
        const tauriModule = await import('@tauri-apps/api');
        return await tauriModule.invoke('fetch_rss');
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

async function openLink(url: string) {
    console.log('Attempting to open URL:', url);
    
    try {
        const { invoke } = await import('@tauri-apps/api');
        const { appWindow } = await import('@tauri-apps/api/window');
        console.log('Using Tauri invoke');
        await invoke('open_external', { url, scope: appWindow });
    } catch (e) {
        console.error('Error opening link:', e);
        // Fallback en cas d'erreur
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

// Utilitaire pour extraire le texte d'une string ou d'un objet {#text, ...}
function getText(val: any): string {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && '#text' in val) return val['#text'];
    return '';
}

export default function RssFeed() {
    const [items, setItems] = useState<RssItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchRss() {
            try {
                const text = await fetchRssData();
                // On stocke le XML brut pour le fallback regex
                if (typeof window !== 'undefined') {
                    window.__RSS_RAW_XML__ = text;
                }
                const parser = new XMLParser({
                    ignoreAttributes: false,
                    attributeNamePrefix: "@_"
                });
                const xml = parser.parse(text);
                console.log('Raw XML data:', xml);
                
                if (!xml.feed?.entry) {
                    throw new Error('Invalid RSS feed format');
                }
                const entries = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
                
                // Log détaillé de chaque entrée
                entries.forEach((entry: RssItem, index: number) => {
                    // On tente d'extraire le XML brut de l'item pour le fallback
                    let rawXml = undefined;
                    const title = typeof entry.title === 'string' ? entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
                    if (typeof text === 'string') {
                        // On cherche le bloc <entry>...</entry> correspondant au titre
                        const entryRegex = new RegExp(`<entry[\s\S]*?<title>${title}<\\/title>[\s\S]*?<\\/entry>`, 'i');
                        const found = text.match(entryRegex);
                        rawXml = found ? found[0] : undefined;
                    }
                    console.log(`Entry ${index}:`, JSON.stringify(entry, null, 2));
                    console.log(`URL extrait:`, getItemUrl(entry, rawXml));
                });
                
                setItems(entries);
            } catch (err) {
                console.error('RSS fetch error:', err);
                setError(err instanceof Error ? err.message : "Failed to load RSS feed");
            } finally {
                setLoading(false);
            }
        }
        fetchRss();
    }, []);

    const handleClick = async (item: RssItem, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // On tente d'extraire le XML brut de l'item pour le fallback
        let rawXml = undefined;
        const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        if (typeof window !== 'undefined' && window.__RSS_RAW_XML__) {
            const entryRegex = new RegExp(`<entry[\s\S]*?<title>${title}<\\/title>[\s\S]*?<\\/entry>`, 'i');
            const found = window.__RSS_RAW_XML__.match(entryRegex);
            rawXml = found ? found[0] : undefined;
        }
        const url = getItemUrl(item, rawXml);
        if (!url) {
            console.error('No URL provided for item:', item);
            return;
        }
        console.log('Clicked link with URL:', url);
        await openLink(url);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 border border-red-500 rounded-lg bg-red-50 dark:bg-red-900/10">
                <h3 className="text-red-700 dark:text-red-400 font-semibold">Error loading RSS feed</h3>
                <p className="text-red-600 dark:text-red-300">{error}</p>
                <button 
                    onClick={() => window.location.reload()} 
                    className="mt-2 px-4 py-2 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/30 transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">
            <h2 className="text-2xl font-bold text-primary">Star Citizen News</h2>
            <div className="space-y-6">
                {items.map((item, i) => (
                    <article 
                        key={i} 
                        className="border border-border rounded-lg p-4 hover:bg-accent/10 transition-colors cursor-pointer"
                        onClick={(e) => handleClick(item, e)}
                    >
                        <div className="block space-y-2">
                            <h3 className="text-lg font-semibold hover:text-primary transition-colors group flex items-center">
                                {getText(item.title)}
                                <svg 
                                    className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    viewBox="0 0 24 24"
                                >
                                    <path 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        strokeWidth={2} 
                                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" 
                                    />
                                </svg>
                            </h3>
                            <time className="text-sm text-muted-foreground">
                                {new Date(item.updated).toLocaleDateString()}
                            </time>
                            <div 
                                className="prose prose-sm dark:prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ 
                                    __html: item.content?.["#text"] || "" 
                                }} 
                            />
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
} 