import { m } from 'framer-motion';
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { RemoteCharactersPresetsList, Row } from "@/types/charactersList";
import { CharacterCard } from '@/components/custom/character-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Search, TrendingUp, Clock, Loader2, ExternalLink, Globe2 } from 'lucide-react';
import logger from "@/utils/logger";
import openExternal from "@/utils/external";
import { GamePaths, isGamePaths } from "@/types/translation";

function CharactersPresetsList() {
    const { toast } = useToast();
    const [gamePaths, setGamePaths] = useState<GamePaths | null>(null);
    const [gameCheckDone, setGameCheckDone] = useState(false);
    const [charactersPresets, setCharactersPresets] = useState<Row[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [sort, setSort] = useState<"latest" | "download">("latest");
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const hasInitialized = useRef(false);
    const orderRef = useRef<"latest" | "download">("latest");
    const lastSearchTerm = useRef<string>("");
    const loadedCount = charactersPresets.length;

    useEffect(() => {
        const checkGame = async () => {
            try {
                const versions = await invoke("get_star_citizen_versions");
                if (isGamePaths(versions) && Object.keys(versions.versions).length > 0) {
                    setGamePaths(versions);
                }
            } catch (error) {
                logger.error("Erreur lors de la verification du jeu:", error);
            } finally {
                setGameCheckDone(true);
            }
        };
        checkGame();
    }, []);

    const getCharacters = useCallback(
        async (
            nextPage?: number,
            newSearchTerm?: string,
            force = false
        ) => {
            if ((isLoading && !force) || (!hasMore && !force)) return;
            setIsLoading(true);
            const pageToFetch = nextPage || page;
            const search = typeof newSearchTerm === "string" ? newSearchTerm : debouncedSearch;
            const orderToUse = orderRef.current;
            try {
                const result: any = await invoke("get_characters", {
                    page: pageToFetch,
                    orderType: orderRef.current,
                    search: search && search.length > 0 ? search : undefined,
                });
                logger.log('ORDER USED =>', orderToUse);
                logger.log("RESULT : Fetching characters presets...");
                logger.log(result);
                if (result?.tauriDebug) {
                    logger.log('TAURI DEBUG =>', result.tauriDebug);
                }
                const newRows = (result as RemoteCharactersPresetsList).body.rows;
                if (newRows.length === 0) {
                    setHasMore(false);
                } else {
                    setCharactersPresets(prev => {
                        const existingIds = new Set(prev.map((c) => c.id));
                        const filtered = newRows.filter((c) => !existingIds.has(c.id));
                        return [...prev, ...filtered];
                    });
                    setPage(prev => nextPage !== undefined ? nextPage + 1 : prev + 1);
                    setHasMore(true);
                }
            } catch (error) {
                logger.error("Error fetching characters presets:", error);
                toast({
                    title: "Erreur de chargement",
                    description: "Impossible de recuperer les personnages. Veuillez reessayer plus tard.",
                    variant: "destructive",
                });
            } finally {
                setIsLoading(false);
            }
        },
        [hasMore, page, debouncedSearch, isLoading]
    );

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 400);
        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm]);

    useEffect(() => {
        const isInitialLoad = !hasInitialized.current && charactersPresets.length === 0 && !isLoading;
        const isSearchChanged = lastSearchTerm.current !== debouncedSearch;
        const isSearchCleared = debouncedSearch === "" && lastSearchTerm.current !== "";
        if (isInitialLoad || isSearchChanged || isSearchCleared) {
            hasInitialized.current = true;
            lastSearchTerm.current = debouncedSearch;
            setCharactersPresets([]);
            setPage(1);
            setHasMore(true);
            getCharacters(1, debouncedSearch);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const gridRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleScroll = () => {
            const el = gridRef.current;
            if (!el || isLoading || !hasMore) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
                getCharacters();
            }
        };
        const el = gridRef.current;
        if (el) {
            el.addEventListener("scroll", handleScroll, { passive: true });
        }
        return () => {
            if (el) el.removeEventListener("scroll", handleScroll);
        };
    }, [getCharacters, hasMore, isLoading]);

    useEffect(() => {
        const el = gridRef.current;
        if (!el || isLoading || !hasMore) return;
        if (el.scrollHeight <= el.clientHeight && charactersPresets.length > 0) {
            getCharacters();
        }
    }, [charactersPresets.length, hasMore, isLoading, getCharacters]);

    if (!gameCheckDone) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                <div className="rounded-full bg-muted p-4 animate-pulse">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Recherche des installations de Star Citizen...</p>
            </div>
        );
    }

    if (!gamePaths) {
        return (
            <div className="flex h-full w-full items-center justify-center p-4">
                <section className="w-full max-w-xl rounded-2xl border border-border/60 bg-[hsl(var(--background)/0.28)] p-7 text-center shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border/55 bg-background/45">
                        <Globe2 className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-1.5">
                        <h2 className="text-xl font-bold tracking-tight">Aucune version detectee</h2>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Lancez Star Citizen au moins une fois, puis rechargez cette page avec
                            <kbd className="mx-2 rounded border border-border/55 bg-background/60 px-2 py-1 text-xs">CTRL + R</kbd>
                        </p>
                    </div>
                </section>
            </div>
        );
    }

    const sortButtonBase =
        "h-8 gap-2 rounded-lg border px-3 text-xs font-medium transition-colors";
    const isLatest = sort === "latest";
    const isPopular = sort === "download";
    const showEmptyState = loadedCount === 0 && !isLoading && hasInitialized.current;

    return (
        <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-full w-full flex-col overflow-hidden px-1 pb-1 pt-0"
        >
            <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
                <section className="relative px-1 pt-1.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                                <Download className="h-4 w-4 text-cyan-500" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[1.28rem] font-semibold leading-none tracking-tight">Presets en ligne</h1>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        {loadedCount} charge{loadedCount > 1 ? "s" : ""}
                                    </Badge>
                                    <Badge variant="outline" className="h-5 rounded-md border-border/40 bg-background/20 px-1.5 text-[10px]">
                                        Tri: {isLatest ? "Recents" : "Populaires"}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground/90">Telechargez des presets depuis la communaute SC Characters</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await openExternal("https://www.star-citizen-characters.com/");
                                } catch {
                                    window.open("https://www.star-citizen-characters.com/", "_blank", "noopener,noreferrer");
                                }
                            }}
                            className="h-8 gap-2 rounded-lg border-border/45 bg-background/20 px-3 text-xs"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ouvrir le site
                        </Button>
                    </div>
                    <div className="mt-3 h-px w-full bg-gradient-to-r from-cyan-500/25 via-border/40 to-transparent" />
                </section>

                <section className="relative overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,hsl(var(--primary)/0.11),transparent_62%)]" />
                    <div className="relative grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="relative w-full">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                id="character-search-input"
                                name="character-search"
                                type="text"
                                placeholder="Rechercher un preset, un auteur..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="h-9 rounded-lg border-border/45 bg-background/25 pl-10 text-sm"
                            />
                        </div>

                        <div className="inline-flex w-fit items-center gap-1 rounded-xl border border-border/55 bg-[hsl(var(--background)/0.24)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    orderRef.current = 'latest';
                                    setSort('latest');
                                    setCharactersPresets([]);
                                    setPage(1);
                                    setHasMore(true);
                                    getCharacters(1, debouncedSearch, true);
                                }}
                                className={`${sortButtonBase} ${
                                    isLatest
                                        ? "border-primary/45 bg-[hsl(var(--primary)/0.12)] text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]"
                                        : "border-transparent text-muted-foreground hover:border-primary/30 hover:bg-primary/8 hover:text-foreground"
                                }`}
                            >
                                <Clock className="h-3.5 w-3.5" />
                                Recents
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    orderRef.current = 'download';
                                    setSort('download');
                                    setCharactersPresets([]);
                                    setPage(1);
                                    setHasMore(true);
                                    getCharacters(1, debouncedSearch, true);
                                }}
                                className={`${sortButtonBase} ${
                                    isPopular
                                        ? "border-primary/45 bg-[hsl(var(--primary)/0.12)] text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]"
                                        : "border-transparent text-muted-foreground hover:border-primary/30 hover:bg-primary/8 hover:text-foreground"
                                }`}
                            >
                                <TrendingUp className="h-3.5 w-3.5" />
                                Populaires
                            </Button>
                        </div>
                    </div>
                </section>

                <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[0_10px_26px_rgba(0,0,0,0.10)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_100%,hsl(var(--primary)/0.08),transparent_64%)]" />

                    <div className="relative border-b border-border/35 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <p>
                                {debouncedSearch
                                    ? `Resultats pour "${debouncedSearch}"`
                                    : "Catalogue communautaire de presets"}
                            </p>
                            <p>{hasMore ? "Scroll pour charger plus" : "Tous les presets ont ete charges"}</p>
                        </div>
                    </div>

                    <div
                        ref={gridRef}
                        className="modern-scrollbar relative flex-1 overflow-y-auto p-3"
                    >
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                            {loadedCount === 0 && isLoading && Array.from({ length: 10 }).map((_, i) => (
                                <div key={`skeleton-${i}`} className="aspect-[4/5] overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.20)]">
                                    <div className="h-full w-full animate-pulse bg-[linear-gradient(110deg,hsl(var(--background)/0.25),hsl(var(--background)/0.45),hsl(var(--background)/0.25))] bg-[length:200%_100%]" />
                                </div>
                            ))}

                            {charactersPresets.map((character, index) => {
                                const batchSize = 10;
                                const batchIndex = index % batchSize;
                                return (
                                    <m.div
                                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        transition={{ duration: 0.28, delay: 0.02 * batchIndex }}
                                        className="aspect-[4/5]"
                                        key={character.id}
                                    >
                                        <CharacterCard
                                            url={character.previewUrl}
                                            name={character.title}
                                            owner={character.user.name}
                                            characterid={character.id}
                                            downloads={character._count.characterDownloads}
                                            likes={character._count.characterLikes}
                                            dnaurl={character.dnaUrl}
                                        />
                                    </m.div>
                                );
                            })}
                        </div>

                        {showEmptyState && (
                            <div className="flex h-full min-h-[220px] items-center justify-center">
                                <div className="w-full max-w-md rounded-xl border border-border/40 bg-[hsl(var(--background)/0.20)] px-4 py-5 text-center">
                                    <p className="text-sm font-medium text-foreground/90">Aucun preset trouve</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Ajuste ta recherche ou change le tri pour afficher d'autres resultats.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="relative border-t border-border/35 px-3 py-2">
                        {isLoading && loadedCount > 0 && (
                            <div className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Chargement...</span>
                            </div>
                        )}
                        {!hasMore && loadedCount > 0 && (
                            <div className="text-center">
                                <span className="text-xs text-muted-foreground">Fin de la liste</span>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </m.div>
    );
}

export default CharactersPresetsList;

