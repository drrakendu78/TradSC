import { m } from "framer-motion";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { XMLParser } from "fast-xml-parser";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Newspaper, AlertCircle, Clock, ArrowUpRight } from "lucide-react";

const RSS_URL = "https://leonick.se/feeds/rsi/atom";

interface RssItem {
    title: string;
    link: unknown;
    updated: string;
    content: { "#text": string };
    id?: string;
    summary?: string;
}

function extractLinkFromXml(xml: string): string | undefined {
    const match = xml.match(/<link[^>]*type=["']text\/html["'][^>]*href=["']([^"']+)["'][^>]*\/?\s*>/);
    return match ? match[1] : undefined;
}

function getItemUrl(item: RssItem, rawXml?: string): string | undefined {
    if (Array.isArray(item.link)) {
        const found = (item.link as Array<Record<string, string>>).find(l => l && l["@_type"] === "text/html" && l["@_href"]);
        if (found) return found["@_href"];
    }
    if (typeof item.link === "object" && item.link !== null) {
        const l = item.link as Record<string, string>;
        if (l["@_type"] === "text/html" && l["@_href"]) return l["@_href"];
        if (l["@_href"]) return l["@_href"];
    }
    if (typeof item.link === "string" && item.link.trim() !== "") return item.link;
    if (item.id && typeof item.id === "string" && item.id.startsWith("http")) return item.id;
    const html = item.content?.["#text"] || item.summary || "";
    const match = html.match(/href="([^"]+)"/);
    if (match) return match[1];
    if (rawXml) {
        const extracted = extractLinkFromXml(rawXml);
        if (extracted) return extracted;
    }
    return undefined;
}

async function fetchRssData(): Promise<string> {
    try {
        return await invoke("fetch_rss");
    } catch {
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(RSS_URL);
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    }
}

function getText(val: unknown): string {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && '#text' in val) return (val as Record<string, string>)['#text'];
    return '';
}

function stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function extractImageFromHtml(html: string): string | null {
    if (!html) return null;
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch?.[1]) return imgMatch[1];
    const dataSrcMatch = html.match(/<img[^>]+(?:data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i);
    if (dataSrcMatch?.[1]) return dataSrcMatch[1];
    return null;
}

function formatRelativeDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) return diffMins <= 1 ? "À l'instant" : `Il y a ${diffMins} min`;
        if (diffHours < 24) return `Il y a ${diffHours}h`;
        if (diffDays === 1) return "Hier";
        if (diffDays < 7) return `Il y a ${diffDays} jours`;
        return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return '';
    }
}

async function openUrl(url: string) {
    try {
        await invoke("open_external", { url: url.trim() });
    } catch {
        try {
            const { open } = await import("@tauri-apps/plugin-shell");
            await open(url.trim());
        } catch {
            window.open(url.trim(), '_blank', 'noopener,noreferrer');
        }
    }
}

// Card hero (premier article) — image pleine avec texte superposé
function HeroCard({ item, rawXml, showBadge = true }: { item: RssItem; rawXml: string; showBadge?: boolean }) {
    const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    let itemXml: string | undefined;
    if (rawXml) {
        const r = new RegExp(`<entry[\\s\\S]*?<title>${title}<\\/title>[\\s\\S]*?<\\/entry>`, 'i');
        const found = rawXml.match(r);
        itemXml = found?.[0];
    }
    const url = getItemUrl(item, itemXml);
    const content = getText(item.content?.["#text"] || item.summary || "");
    const preview = stripHtml(content).substring(0, 320) + (stripHtml(content).length > 320 ? '…' : '');
    const imageUrl = extractImageFromHtml(content);

    return (
        <button
            type="button"
            onClick={() => url && openUrl(url)}
            disabled={!url}
            className="group relative w-full overflow-hidden rounded-xl border border-primary/30 text-left transition-all hover:border-primary/50 hover:shadow-[0_16px_40px_rgba(0,0,0,0.28)] disabled:cursor-default"
        >
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

            {/* Image pleine carte avec overlay */}
            {imageUrl ? (
                <div className="relative min-h-[260px]">
                    <img
                        src={imageUrl}
                        alt={getText(item.title)}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                    {/* Gradient overlay fort sur le bas */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/45 to-black/10" />

                    {/* Badge + contenu superposés */}
                    <div className="relative z-10 flex h-full min-h-[260px] flex-col justify-between p-4">
                        <div className="flex items-start justify-between gap-2">
                            {showBadge && (
                                <Badge className="gap-1 rounded-md bg-primary/75 px-1.5 text-[9px] font-semibold backdrop-blur-sm">
                                    Nouveau
                                </Badge>
                            )}
                            {url && (
                                <ArrowUpRight className="h-4 w-4 text-white/60 transition-all group-hover:text-white group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                                <Clock className="h-2.5 w-2.5" />
                                {formatRelativeDate(item.updated)}
                            </div>
                            <h2 className="text-[17px] font-bold leading-snug tracking-tight text-white drop-shadow-md group-hover:text-primary/90 transition-colors">
                                {getText(item.title)}
                            </h2>
                            {preview && (
                                <p className="line-clamp-2 text-[12px] leading-relaxed text-white/65">
                                    {preview}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                /* Fallback sans image */
                <div className="space-y-2 rounded-xl border border-primary/30 bg-[hsl(var(--background)/0.10)] p-4 backdrop-blur-md">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {showBadge && <Badge className="gap-1 rounded-md bg-primary/15 px-1.5 text-[9px] font-semibold text-primary">Nouveau</Badge>}
                            <Clock className="h-2.5 w-2.5" />
                            {formatRelativeDate(item.updated)}
                        </div>
                        {url && <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:text-primary" />}
                    </div>
                    <h2 className="text-[16px] font-bold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {getText(item.title)}
                    </h2>
                    {preview && (
                        <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground/85">{preview}</p>
                    )}
                </div>
            )}
        </button>
    );
}

// Card standard — style magazine (image en haut)
function NewsCard({ item, rawXml, index }: { item: RssItem; rawXml: string; index: number }) {
    const title = typeof item.title === 'string' ? item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    let itemXml: string | undefined;
    if (rawXml) {
        const r = new RegExp(`<entry[\\s\\S]*?<title>${title}<\\/title>[\\s\\S]*?<\\/entry>`, 'i');
        const found = rawXml.match(r);
        itemXml = found?.[0];
    }
    const url = getItemUrl(item, itemXml);
    const content = getText(item.content?.["#text"] || item.summary || "");
    const preview = stripHtml(content).substring(0, 160) + (stripHtml(content).length > 160 ? '…' : '');
    const imageUrl = extractImageFromHtml(content);

    return (
        <m.button
            type="button"
            onClick={() => url && openUrl(url)}
            disabled={!url}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4) }}
            className="group relative w-full overflow-hidden rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] text-left backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-[0_8px_20px_rgba(0,0,0,0.18)] disabled:cursor-default"
        >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

            {imageUrl && (
                <div className="relative h-44 w-full overflow-hidden">
                    <img
                        src={imageUrl}
                        alt={getText(item.title)}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
            )}

            <div className="flex items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {!imageUrl && (
                        <div className="mb-1 flex h-10 w-full items-center justify-center rounded-lg border border-border/20 bg-background/20">
                            <Newspaper className="h-5 w-5 text-muted-foreground/25" />
                        </div>
                    )}
                    <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground/95 transition-colors group-hover:text-primary">
                        {getText(item.title)}
                    </h3>
                    {preview && (
                        <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/65">
                            {preview}
                        </p>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                        <Clock className="h-3 w-3" />
                        {formatRelativeDate(item.updated)}
                    </div>
                </div>
                {url && (
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                )}
            </div>
        </m.button>
    );
}

export default function Actualites() {
    const [items, setItems] = useState<RssItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawXml, setRawXml] = useState("");

    const fetchRss = async () => {
        setLoading(true);
        setError(null);
        try {
            const text = await fetchRssData();
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
            const xml = parser.parse(text);
            if (!xml.feed?.entry) throw new Error('Invalid RSS feed format');
            const entries = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
            setItems(entries as RssItem[]);
            setRawXml(text);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible de charger le flux RSS");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRss(); }, []);

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                {/* Header */}
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                                <Newspaper className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Actualités Star Citizen</h1>
                                    {!loading && !error && items.length > 0 && (
                                        <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                            {items.length} articles
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Dernières nouvelles officielles de RSI</p>
                            </div>
                        </div>
                        <button
                            onClick={fetchRss}
                            disabled={loading}
                            className="group flex h-8 items-center gap-1.5 rounded-full border border-border/30 bg-background/20 px-3 text-[11.5px] text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3 w-3 transition-transform ${loading ? 'animate-spin' : 'group-hover:rotate-180 duration-500'}`} />
                            Actualiser
                        </button>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/25 via-border/40 to-transparent" />
                </section>

                {/* Loading */}
                {loading && (
                    <div className="space-y-3">
                        <Skeleton className="h-[260px] w-full rounded-xl" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-24 w-full rounded-xl" />
                            ))}
                        </div>
                    </div>
                )}

                {/* Error */}
                {!loading && error && (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center backdrop-blur-md">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10">
                                <AlertCircle className="h-5 w-5 text-destructive" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">Impossible de charger les actualités</p>
                                <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                            </div>
                            <Button onClick={fetchRss} size="sm" variant="outline" className="gap-2 rounded-lg border-border/40 bg-background/30">
                                <RefreshCw className="h-3.5 w-3.5" />
                                Réessayer
                            </Button>
                        </div>
                    </div>
                )}

                {/* Content */}
                {!loading && !error && (
                    items.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/30 bg-[hsl(var(--background)/0.10)] p-6 text-center backdrop-blur-md">
                                <Newspaper className="h-8 w-8 text-muted-foreground/40" />
                                <p className="text-sm text-muted-foreground">Aucune actualité disponible.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 pb-2">
                            {/* Hero — premier article */}
                            <m.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <HeroCard item={items[0]} rawXml={rawXml} />
                            </m.div>

                            {/* Grille 2 colonnes — tous les autres */}
                            {items.length > 1 && (
                                <div className="grid grid-cols-2 gap-3">
                                    {items.slice(1).map((item, i, arr) => {
                                        const isLastOdd = i === arr.length - 1 && arr.length % 2 !== 0;
                                        return isLastOdd ? (
                                            <div key={getText(item.title) || i} className="col-span-2">
                                                <HeroCard item={item} rawXml={rawXml} showBadge={false} />
                                            </div>
                                        ) : (
                                            <NewsCard
                                                key={getText(item.title) || i}
                                                item={item}
                                                rawXml={rawXml}
                                                index={i}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex justify-center py-2">
                                <span className="text-[11px] text-muted-foreground/50">— {items.length} articles chargés —</span>
                            </div>
                        </div>
                    )
                )}
            </div>
        </m.div>
    );
}
