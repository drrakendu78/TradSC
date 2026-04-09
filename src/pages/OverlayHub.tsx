import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import {
    BookOpen,
    Calculator,
    Database,
    Hammer,
    Link2,
    Map,
    Package,
    PanelsTopLeft,
    Route,
    Search,
    Swords,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCustomLinksStore } from "@/stores/custom-links-store";
import { getOverlayHubItems } from "@/utils/overlay-hub-registry";
import type { OverlayHubItem } from "@/types/overlay-hub";

const HUB_TOP_OFFSET = 10;
const HUB_EXPANDED_HEIGHT = 74;
const ITEM_STAGGER_MS = 18;

const OverlayHub = () => {
    const [expanded, setExpanded] = useState(false);
    const hubWindow = useMemo(() => getCurrentWindow(), []);
    const geometryRunIdRef = useRef(0);
    const customLinks = useCustomLinksStore((state) => state.links);
    const { toast } = useToast();

    const baseAppUrl = `${window.location.origin}${window.location.pathname}`;
    const items = useMemo(() => getOverlayHubItems(customLinks, baseAppUrl), [customLinks, baseAppUrl]);
    const slots = items.length;
    const expandedWidth = useMemo(
        () => Math.min(980, Math.max(320, slots * 92 + 20)),
        [slots]
    );
    const expandedHeight = HUB_EXPANDED_HEIGHT;

    useEffect(() => {
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        const root = document.getElementById("root");
        if (root) root.style.background = "transparent";

        const style = document.createElement("style");
        style.id = "overlay-hub-transparent-style";
        style.textContent = "#root::before { display: none !important; }";
        document.head.appendChild(style);

        return () => {
            document.documentElement.style.background = "";
            document.body.style.background = "";
            if (root) root.style.background = "";
            style.remove();
        };
    }, []);

    useEffect(() => {
        const syncWindowGeometry = async () => {
            const runId = ++geometryRunIdRef.current;
            const width = expandedWidth;
            const height = expandedHeight;

            const monitor = await currentMonitor().catch(() => null);
            if (runId !== geometryRunIdRef.current) return;

            let targetPos: PhysicalPosition | null = null;
            if (monitor) {
                targetPos = new PhysicalPosition(
                    Math.round(monitor.position.x + (monitor.size.width - width) / 2),
                    Math.round(monitor.position.y + HUB_TOP_OFFSET)
                );
            } else {
                const currentPos = await hubWindow.outerPosition().catch(() => null);
                if (runId !== geometryRunIdRef.current) return;
                if (currentPos) {
                    targetPos = new PhysicalPosition(currentPos.x, Math.max(0, currentPos.y));
                }
            }

            await hubWindow.setSize(new PhysicalSize(width, height));
            if (runId !== geometryRunIdRef.current) return;

            if (targetPos) {
                await hubWindow.setPosition(targetPos);
            }
        };

        syncWindowGeometry().catch(console.error);
    }, [expandedWidth, expandedHeight, hubWindow]);

    const openOverlayItem = async (item: OverlayHubItem) => {
        try {
            if (item.kind === "webview") {
                await invoke("open_webview_overlay", {
                    id: item.id,
                    url: item.url,
                    width: item.width,
                    height: item.height,
                    opacity: item.opacity,
                });
            } else {
                await invoke("open_overlay", {
                    id: item.id,
                    url: item.url,
                    x: 100.0,
                    y: 100.0,
                    width: item.width,
                    height: item.height,
                    opacity: item.opacity,
                });
            }

            setExpanded(false);
        } catch (error) {
            console.error(error);
            toast({
                title: "Erreur overlay",
                description: `Impossible d'ouvrir ${item.label} en overlay.`,
                variant: "destructive",
            });
        }
    };

    const renderItemIcon = (item: OverlayHubItem) => {
        if (item.source === "custom") {
            return (
                <span className="text-[10px] font-bold leading-none">
                    {item.label.slice(0, 1).toUpperCase()}
                </span>
            );
        }

        switch (item.iconKey) {
            case "dps":
                return <Calculator className="h-3.5 w-3.5" />;
            case "shipmaps":
                return <Map className="h-3.5 w-3.5" />;
            case "finder":
                return <Search className="h-3.5 w-3.5" />;
            case "pvp":
                return <Swords className="h-3.5 w-3.5" />;
            case "cargo":
                return <Package className="h-3.5 w-3.5" />;
            case "verseguide":
                return <BookOpen className="h-3.5 w-3.5" />;
            case "scmdb":
                return <Database className="h-3.5 w-3.5" />;
            case "crafter":
                return <Hammer className="h-3.5 w-3.5" />;
            case "trading":
                return <Route className="h-3.5 w-3.5" />;
            default:
                return <Link2 className="h-3.5 w-3.5" />;
        }
    };

    const getItemLabel = (item: OverlayHubItem) => {
        switch (item.id) {
            case "erkul":
                return "DPS";
            case "finder":
                return "Finder";
            case "pvp":
                return "PVP";
            case "uexcorp":
                return "Routes";
            default:
                return item.label;
        }
    };

    return (
        <div className="w-full h-full bg-transparent pointer-events-none overflow-visible flex items-start justify-center">
            <div className="pt-1 flex flex-col items-center pointer-events-none">
                <button
                    type="button"
                    onClick={() => setExpanded((previous) => !previous)}
                    title={expanded ? "Replier hub overlay" : "Ouvrir hub overlay"}
                    className="pointer-events-auto h-6 w-6 rounded-full border border-sky-300/45 bg-[linear-gradient(180deg,rgba(22,38,56,0.84),rgba(13,24,36,0.84))] text-sky-100 shadow-[inset_0_1px_0_rgba(148,197,255,0.18),0_0_6px_rgba(56,189,248,0.2),0_1px_3px_rgba(0,0,0,0.4)] hover:bg-[linear-gradient(180deg,rgba(29,49,71,0.9),rgba(18,31,46,0.9))] transition-all flex items-center justify-center"
                >
                    <PanelsTopLeft className="h-3 w-3" />
                </button>

                <div
                    className={`mt-1 flex flex-col items-center origin-top transition-all duration-200 ease-out ${
                        expanded
                            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
                            : "opacity-0 -translate-y-1 scale-[0.98] pointer-events-none"
                    }`}
                >
                    <div className="flex items-center gap-1.5 overflow-x-auto px-1">
                        {items.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => openOverlayItem(item)}
                                className={`h-7 px-2.5 rounded-full border border-sky-300/35 bg-black/50 text-slate-100 transition-all duration-200 ease-out flex items-center gap-1.5 whitespace-nowrap backdrop-blur-md shadow-[inset_0_1px_0_rgba(148,197,255,0.2),0_0_8px_rgba(14,165,233,0.2)] hover:border-sky-200/55 hover:bg-black/62 hover:shadow-[inset_0_1px_0_rgba(186,230,253,0.25),0_0_12px_rgba(56,189,248,0.28)] ${
                                    expanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                                }`}
                                style={{ transitionDelay: expanded ? `${index * ITEM_STAGGER_MS}ms` : "0ms" }}
                                title={`Ouvrir ${item.label} en overlay`}
                            >
                                <span className="h-4 w-4 rounded-full bg-sky-300/18 text-sky-100 flex items-center justify-center">
                                    {renderItemIcon(item)}
                                </span>
                                <span className="text-[10px] font-semibold tracking-[0.03em] uppercase">{getItemLabel(item)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverlayHub;
