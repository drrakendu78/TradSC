import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getBuildInfo } from "@/utils/buildInfo";
import openExternal from "@/utils/external";
import {
    migrateToStelliverse,
    STELLIVERSE_GITLAB_URL,
    STELLIVERSE_RELEASES_URL,
} from "@/utils/migration";

// ─────────────────────────────────────────────────────────────────────────────
// MigrationGate — overlay d'adieu de StarTrad. L'app a été réécrite et rebaptisée
// « Stelliverse ». Cette build finale verrouille l'app derrière un popup BLOQUANT
// (non fermable, façon BanGate) avec un bouton qui télécharge + installe la
// dernière Stelliverse depuis GitLab.
//
// Exception Microsoft Store : on ne peut pas pousser d'install externe (règles du
// Store) → variante sobre, SANS bouton de téléchargement, qui explique et renvoie
// vers le lien. Elle reste fermable (l'app Store doit rester utilisable).
// ─────────────────────────────────────────────────────────────────────────────

const FONTS_HREF =
    "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Rajdhani:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap";

const CSS = `
.mig-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;
  background:rgba(5,8,15,.93);backdrop-filter:blur(4px);font-family:'Rajdhani',sans-serif;color:#eaf2ff;user-select:none}
.mig-card{position:relative;width:480px;max-width:100%;overflow:hidden;border-radius:18px;
  background:linear-gradient(180deg,rgba(16,23,37,.98),rgba(8,13,22,.98));
  border:1px solid rgba(132,176,224,.32);box-shadow:0 30px 80px rgba(2,6,14,.7)}
.mig-card::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#54e6ff,transparent);opacity:.8}
.mig-inner{padding:30px 30px 26px;text-align:center}
.mig-eyebrow{font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#54e6ff}
.mig-rename{display:flex;align-items:center;justify-content:center;gap:14px;margin:16px 0 6px;flex-wrap:wrap}
.mig-old{font-family:'Oswald',sans-serif;font-weight:500;font-size:21px;color:#5d6f88;text-decoration:line-through;text-decoration-color:rgba(255,122,122,.55);text-decoration-thickness:2px}
.mig-arr{color:#5d6f88;font-size:18px}
.mig-new{font-family:'Oswald',sans-serif;font-weight:700;font-size:34px;color:#fff;line-height:1}
.mig-new b{color:#54e6ff}
.mig-h1{font-family:'Oswald',sans-serif;font-weight:300;font-size:25px;color:#fff;margin-top:14px}
.mig-h1 b{font-weight:600}
.mig-body{margin-top:12px;font-size:14.5px;line-height:1.6;color:#9fb2cc}
.mig-body b{color:#eaf2ff;font-weight:600}
.mig-body .mig-hl{color:#54e6ff;font-weight:600}
.mig-assure{margin-top:16px;display:flex;align-items:flex-start;gap:10px;text-align:left;
  background:rgba(84,230,255,.05);border:1px solid rgba(84,230,255,.18);border-radius:12px;padding:12px 14px}
.mig-assure svg{flex:none;width:18px;height:18px;stroke:#54e6ff;stroke-width:1.8;fill:none;margin-top:1px}
.mig-assure .mig-t{font-size:13px;line-height:1.5;color:#9fb2cc}
.mig-assure .mig-t b{color:#fff;font-weight:600}
.mig-btn{margin-top:22px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;
  font-family:'Oswald',sans-serif;font-weight:600;font-size:16px;letter-spacing:.04em;text-transform:uppercase;
  color:#04121a;background:linear-gradient(180deg,#5ce0ff,#21bdec);border:none;border-radius:12px;padding:15px 20px;transition:.15s}
.mig-btn:hover{filter:brightness(1.06)}
.mig-btn:disabled{opacity:.7;cursor:default}
.mig-btn svg{width:18px;height:18px;stroke:#04121a;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.mig-foot{margin-top:13px;font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:.07em;color:#5d6f88}
.mig-brand{margin-top:20px;padding-top:16px;border-top:1px solid rgba(132,176,224,.16);font-family:'Geist Mono',monospace;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:#5d6f88}
.mig-link{color:#54e6ff;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
/* variante Store (sobre) */
.mig-card.mig-store{width:430px;border-color:rgba(132,176,224,.22)}
.mig-card.mig-store::before{background:linear-gradient(90deg,transparent,#5d6f88,transparent);opacity:.5}
.mig-store .mig-new b{color:#9fb2cc}
.mig-store-close{margin-top:20px;font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:#9fb2cc;cursor:pointer;background:none;border:1px solid rgba(132,176,224,.3);border-radius:9px;padding:9px 18px;transition:.15s}
.mig-store-close:hover{color:#fff;border-color:#9fb2cc}
`;

function injectAssets() {
    if (typeof document === "undefined") return;
    if (!document.getElementById("mig-fonts")) {
        const link = document.createElement("link");
        link.id = "mig-fonts";
        link.rel = "stylesheet";
        link.href = FONTS_HREF;
        document.head.appendChild(link);
    }
    if (!document.getElementById("mig-style")) {
        const style = document.createElement("style");
        style.id = "mig-style";
        style.textContent = CSS;
        document.head.appendChild(style);
    }
}

export function MigrationGate() {
    const [isStore, setIsStore] = useState<boolean | null>(null);
    const [storeDismissed, setStoreDismissed] = useState(false);
    const [migrating, setMigrating] = useState(false);

    useEffect(() => {
        injectAssets();
        let cancelled = false;
        getBuildInfo()
            .then((info) => {
                if (!cancelled) setIsStore(info.distribution === "microsoft-store");
            })
            .catch(() => {
                if (!cancelled) setIsStore(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Tant qu'on ne sait pas (build info en cours), on n'affiche rien.
    if (isStore === null) return null;

    const onMigrate = async () => {
        setMigrating(true);
        try {
            await migrateToStelliverse();
        } finally {
            // si on est toujours là (échec / fallback navigateur), on réactive le bouton
            setMigrating(false);
        }
    };

    // ── Variante Microsoft Store : sobre, sans bouton de téléchargement, fermable ──
    if (isStore) {
        if (storeDismissed) return null;
        return createPortal(
            <div className="mig-gate" onContextMenu={(e) => e.preventDefault()}>
                <div className="mig-card mig-store">
                    <div className="mig-inner">
                        <div className="mig-eyebrow">Changement de nom</div>
                        <div className="mig-rename">
                            <span className="mig-old">StarTrad FR</span>
                            <span className="mig-arr">→</span>
                            <span className="mig-new">
                                Stelli<b>verse</b>
                            </span>
                        </div>
                        <h1 className="mig-h1">
                            StarTrad devient <b>Stelliverse</b>
                        </h1>
                        <div className="mig-body">
                            L'app a été réécrite et rebaptisée <span className="mig-hl">Stelliverse</span>.
                            La version Microsoft Store ne peut pas l'installer à ta place — tu la
                            retrouveras en cherchant{" "}
                            <b>« Stelliverse »</b> dans le Microsoft Store, ou ici :
                            <br />
                            <span
                                className="mig-link"
                                onClick={() => openExternal(STELLIVERSE_GITLAB_URL)}
                            >
                                gitlab.com/drrakendu78/Stelliverse
                            </span>
                        </div>
                        <button className="mig-store-close" onClick={() => setStoreDismissed(true)}>
                            J'ai compris
                        </button>
                        <div className="mig-brand">Stelliverse · par Djamel Lazreg</div>
                    </div>
                </div>
            </div>,
            document.body
        );
    }

    // ── Variante normale : popup BLOQUANT (non fermable) + bouton de migration ──
    return createPortal(
        <div className="mig-gate" onContextMenu={(e) => e.preventDefault()}>
            <div className="mig-card">
                <div className="mig-inner">
                    <div className="mig-eyebrow">Changement de nom</div>
                    <div className="mig-rename">
                        <span className="mig-old">StarTrad FR</span>
                        <span className="mig-arr">→</span>
                        <span className="mig-new">
                            Stelli<b>verse</b>
                        </span>
                    </div>
                    <h1 className="mig-h1">
                        StarTrad devient <b>Stelliverse</b>
                    </h1>
                    <div className="mig-body">
                        L'app a été <b>entièrement réécrite et modernisée</b>, puis rebaptisée{" "}
                        <span className="mig-hl">Stelliverse</span>. Cette version est la{" "}
                        <b>toute dernière de StarTrad</b> — la suite se passe sur Stelliverse.
                    </div>
                    <div className="mig-assure">
                        <svg viewBox="0 0 24 24">
                            <path d="M9 12l2 2 4-4" />
                            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                        </svg>
                        <div className="mig-t">
                            <b>Rien n'est perdu.</b> Ton compte et tes sauvegardes sont conservés : tu
                            te reconnectes avec le même Discord et tout est là.
                        </div>
                    </div>
                    <button className="mig-btn" onClick={onMigrate} disabled={migrating}>
                        {migrating ? (
                            "Téléchargement…"
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <path d="M7 10l5 5 5-5" />
                                    <path d="M12 15V3" />
                                </svg>
                                Télécharger Stelliverse
                            </>
                        )}
                    </button>
                    <div className="mig-foot">
                        Téléchargement &amp; installation automatiques · puis Stelliverse se lance
                    </div>
                    <div className="mig-brand">
                        <span
                            className="mig-link"
                            onClick={() => openExternal(STELLIVERSE_RELEASES_URL)}
                        >
                            Ou télécharger manuellement
                        </span>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

export default MigrationGate;
