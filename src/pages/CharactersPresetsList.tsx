import { motion } from 'framer-motion';
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { RemoteCharactersPresetsList, Row } from "@/types/charactersList";
import { CharacterCard } from '@/components/custom/character-card';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Download, Search, TrendingUp, Clock, Loader2 } from 'lucide-react';
import logger from "@/utils/logger";

function CharactersPresetsList() {
    const { toast } = useToast();
    const [charactersPresets, setCharactersPresets] = useState<Row[]>([]);
    const [page, setPage] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const hasInitialized = useRef(false);
    const [hasMore, setHasMore] = useState(true);
    const [sort, setSort] = useState<"latest" | "download">("latest");
    const orderRef = useRef<"latest" | "download">("latest");
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const lastSearchTerm = useRef<string>("");

    const getCharacters = useCallback(
        async (
            nextPage?: number,
            newSearchTerm?: string,
            force = false
        ) => {
            if ((isLoading && !force) || !hasMore) return;
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
                        const existingIds = new Set(prev.map(c => c.id));
                        const filtered = newRows.filter(c => !existingIds.has(c.id));
                        return [...prev, ...filtered];
                    });
                    setPage(pageToFetch + 1);
                }
            } catch (error) {
                logger.error("Error fetching characters presets:", error);
                toast({
                    title: "Erreur de chargement",
                    description: "Impossible de récupérer les personnages. Veuillez réessayer plus tard.",
                    variant: "destructive",
                });
            } finally {
                setIsLoading(false);
            }
        },
        [hasMore, page, debouncedSearch, isLoading]
    );
    // Debounce de la recherche
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 400);
        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm]);

    // Initial fetch ou changement de filtre
    useEffect(() => {
        // Refactor de la condition complexe pour plus de lisibilité
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
            el.addEventListener("scroll", handleScroll);
        }
        return () => {
            if (el) el.removeEventListener("scroll", handleScroll);
        };
    }, [getCharacters, hasMore, isLoading]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col w-full h-full p-4 overflow-hidden"
        >
            <div className="flex flex-col gap-4 h-full">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/10">
                            <Download className="h-6 w-6 text-cyan-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Presets en Ligne</h1>
                            <p className="text-sm text-muted-foreground">Téléchargez des presets de la communauté SC Characters</p>
                        </div>
                    </div>
                </div>

                {/* Search & Filter */}
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="character-search-input"
                            name="character-search"
                            type="text"
                            placeholder="Rechercher un personnage..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant={sort === 'latest' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                                orderRef.current = 'latest';
                                setSort('latest');
                                setCharactersPresets([]);
                                setPage(1);
                                setHasMore(true);
                                getCharacters(1, debouncedSearch, true);
                            }}
                            className="gap-2"
                        >
                            <Clock className="h-4 w-4" />
                            Récents
                        </Button>
                        <Button
                            variant={sort === 'download' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                                orderRef.current = 'download';
                                setSort('download');
                                setCharactersPresets([]);
                                setPage(1);
                                setHasMore(true);
                                getCharacters(1, debouncedSearch, true);
                            }}
                            className="gap-2"
                        >
                            <TrendingUp className="h-4 w-4" />
                            Populaires
                        </Button>
                    </div>
                </div>

                {/* Grid */}
                <div
                    ref={gridRef}
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 flex-1 overflow-y-auto pr-2"
                >
                    {charactersPresets.length === 0 && isLoading && Array.from({ length: 10 }).map((_, i) => (
                        <div key={`skeleton-${i}`} className="aspect-[3/4] rounded-xl bg-muted/30 animate-pulse" />
                    ))}
                    {charactersPresets.map((character, index) => {
                        const batchSize = 10;
                        const batchIndex = index % batchSize;
                        return (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.3, delay: 0.03 * batchIndex }}
                                className="aspect-[3/4]"
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
                            </motion.div>
                        );
                    })}
                </div>

                {/* Loading / End indicators */}
                {isLoading && charactersPresets.length > 0 && (
                    <div className="flex items-center justify-center py-4 gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Chargement...</span>
                    </div>
                )}
                {!hasMore && charactersPresets.length > 0 && (
                    <div className="text-center py-4">
                        <span className="text-sm text-muted-foreground">🎉 Fin de la liste</span>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

export default CharactersPresetsList;
