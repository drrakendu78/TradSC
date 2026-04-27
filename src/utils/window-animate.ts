import {
    currentMonitor,
    getCurrentWindow,
    LogicalSize,
    PhysicalPosition,
    PhysicalSize,
} from "@tauri-apps/api/window";

// Taille par défaut de la fenêtre principale, alignée sur tauri.conf.json.
// Sert de fallback quand le snapshot capturé est suspect (ex. l'app a été
// fermée alors que le wizard était actif, donc au prochain démarrage on
// snapshot la taille du wizard et pas la taille de base).
export const DEFAULT_WINDOW_LOGICAL_WIDTH = 1294;
export const DEFAULT_WINDOW_LOGICAL_HEIGHT = 1060;

// Easing Apple-style (cubic-bezier(0.32, 0.72, 0, 1)).
// Approxime via une fonction analytique : decel out smooth.
function appleEase(t: number): number {
    // cubic-bezier(0.32, 0.72, 0, 1) ≈ ease-out cubic décéléré.
    // On utilise easeOutCubic comme bonne approximation (perceptuellement
    // identique à l'œil humain sur 400ms).
    const u = 1 - t;
    return 1 - u * u * u;
}

export interface WindowSnapshot {
    width: number;
    height: number;
    x: number;
    y: number;
    maximized: boolean;
}

/**
 * Capture l'état actuel de la fenêtre principale pour pouvoir le restaurer
 * plus tard. Lit la taille extérieure (incluant les bordures), la position,
 * et l'état maximisé. Toutes les valeurs sont en pixels physiques.
 */
export async function snapshotWindow(): Promise<WindowSnapshot> {
    const win = getCurrentWindow();
    const [size, pos, maximized] = await Promise.all([
        win.outerSize(),
        win.outerPosition(),
        win.isMaximized().catch(() => false),
    ]);
    return {
        width: size.width,
        height: size.height,
        x: pos.x,
        y: pos.y,
        maximized,
    };
}

/**
 * Calcule la taille cible pour le wizard, capée par la zone visible du
 * moniteur courant (avec marge). Préfère la taille demandée mais ne dépasse
 * jamais le moniteur, ce qui éviterait d'avoir le wizard plus grand que
 * l'écran et donc tronqué.
 */
export async function computeWizardSize(
    desiredWidth: number,
    desiredHeight: number,
    margin: number = 60
): Promise<{ width: number; height: number }> {
    try {
        const monitor = await currentMonitor();
        if (!monitor) {
            return { width: desiredWidth, height: desiredHeight };
        }
        const maxW = Math.max(640, monitor.size.width - margin);
        const maxH = Math.max(480, monitor.size.height - margin);
        return {
            width: Math.min(desiredWidth, maxW),
            height: Math.min(desiredHeight, maxH),
        };
    } catch {
        return { width: desiredWidth, height: desiredHeight };
    }
}

/**
 * Anime la fenêtre Tauri d'une taille à l'autre via lerp frame-par-frame.
 * Windows n'a pas d'API native d'animation de redimensionnement (contrairement
 * à NSWindow.setFrame:display:animate: sur macOS), donc on simule via rAF en
 * appelant `setSize()` ~24 fois pendant la durée. À 60fps c'est fluide ; en
 * dessous (machine peu perf), on perd quelques frames mais ça reste correct.
 *
 * Re-centre aussi la fenêtre pour que le grow se fasse depuis le centre
 * (sinon Windows agrandit en gardant le coin haut-gauche fixe, ce qui rend
 * mal sur écran).
 */
export async function animateWindowResize(
    targetWidth: number,
    targetHeight: number,
    duration: number = 400,
    centerOnMonitor: boolean = true
): Promise<void> {
    const win = getCurrentWindow();

    // Si la fenêtre est maximisée, le démaximiser AVANT de tenter un setSize
    // (sinon Windows ignore le setSize sur une fenêtre maximisée).
    if (await win.isMaximized().catch(() => false)) {
        await win.unmaximize().catch(() => {});
    }

    const start = await win.outerSize();
    const startW = start.width;
    const startH = start.height;
    const dW = targetWidth - startW;
    const dH = targetHeight - startH;

    // Pré-calcule la position de centrage sur le moniteur courant si demandé.
    let centerOriginX: number | null = null;
    let centerOriginY: number | null = null;
    if (centerOnMonitor) {
        try {
            const monitor = await currentMonitor();
            if (monitor) {
                centerOriginX = monitor.position.x + Math.round(monitor.size.width / 2);
                centerOriginY = monitor.position.y + Math.round(monitor.size.height / 2);
            }
        } catch {
            /* fallback : pas de re-centrage */
        }
    }

    const startTime = performance.now();

    return new Promise<void>((resolve) => {
        function frame() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = appleEase(t);

            const w = Math.round(startW + dW * eased);
            const h = Math.round(startH + dH * eased);

            // Set size + reposition pour centrer (en parallèle, pas await pour
            // pas attendre 2 round-trips IPC par frame).
            win.setSize(new PhysicalSize(w, h)).catch(() => {});
            if (centerOriginX !== null && centerOriginY !== null) {
                win.setPosition(
                    new PhysicalPosition(
                        centerOriginX - Math.round(w / 2),
                        centerOriginY - Math.round(h / 2)
                    )
                ).catch(() => {});
            }

            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                // Set final size de manière synchronisée pour garantir l'arrivée
                // pile à la taille demandée.
                win.setSize(new PhysicalSize(targetWidth, targetHeight))
                    .catch(() => {})
                    .finally(() => resolve());
            }
        }
        requestAnimationFrame(frame);
    });
}

/**
 * Convertit la taille par défaut (logical, depuis tauri.conf.json) en pixels
 * physiques, en tenant compte du DPR du moniteur courant. Si on échoue à
 * lire le moniteur, on assume DPR = 1.
 */
async function defaultPhysicalSize(): Promise<{ width: number; height: number }> {
    try {
        const win = getCurrentWindow();
        const factor = await win.scaleFactor();
        const logical = new LogicalSize(
            DEFAULT_WINDOW_LOGICAL_WIDTH,
            DEFAULT_WINDOW_LOGICAL_HEIGHT
        );
        const physical = logical.toPhysical(factor);
        return { width: physical.width, height: physical.height };
    } catch {
        return {
            width: DEFAULT_WINDOW_LOGICAL_WIDTH,
            height: DEFAULT_WINDOW_LOGICAL_HEIGHT,
        };
    }
}

/**
 * Heuristique : un snapshot est suspect s'il a la taille du wizard (≈1100×820)
 * ou plus petit qu'une fenêtre raisonnable. Cela arrive quand l'app a été
 * fermée pendant que le wizard tournait : au redémarrage suivant, le snapshot
 * capture la taille héritée du wizard plutôt que la taille de base.
 */
function isSuspectSnapshot(snap: WindowSnapshot): boolean {
    if (snap.width < 1000 || snap.height < 700) return true;
    // Très proche de la taille cible du wizard (1100×820) → probablement
    // un état hérité.
    if (Math.abs(snap.width - 1100) < 40 && Math.abs(snap.height - 820) < 40) {
        return true;
    }
    return false;
}

/**
 * Restaure la fenêtre depuis un snapshot capturé via `snapshotWindow()`.
 * Anime aussi le retour à la taille originale, sauf si la fenêtre était
 * maximisée — auquel cas on remaximise sans animation. Si le snapshot est
 * suspect, on retombe sur la taille par défaut (cf. tauri.conf.json).
 */
export async function restoreWindow(
    snapshot: WindowSnapshot,
    duration: number = 400
): Promise<void> {
    const win = getCurrentWindow();

    if (snapshot.maximized) {
        await win.maximize().catch(() => {});
        return;
    }

    // Si le snapshot est suspect, on remplace par la taille de base et on
    // re-centre. Évite de rester coincé à la taille du wizard.
    if (isSuspectSnapshot(snapshot)) {
        const def = await defaultPhysicalSize();
        let cx = snapshot.x;
        let cy = snapshot.y;
        try {
            const monitor = await currentMonitor();
            if (monitor) {
                cx = monitor.position.x + Math.round((monitor.size.width - def.width) / 2);
                cy = monitor.position.y + Math.round((monitor.size.height - def.height) / 2);
            }
        } catch {
            /* fallback : conserve les coords du snapshot */
        }
        snapshot = {
            width: def.width,
            height: def.height,
            x: cx,
            y: cy,
            maximized: false,
        };
    }

    // Anim retour à la taille initiale.
    const start = await win.outerSize();
    const startW = start.width;
    const startH = start.height;
    const dW = snapshot.width - startW;
    const dH = snapshot.height - startH;

    const startPos = await win.outerPosition();
    const dX = snapshot.x - startPos.x;
    const dY = snapshot.y - startPos.y;

    const startTime = performance.now();

    return new Promise<void>((resolve) => {
        function frame() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = appleEase(t);

            const w = Math.round(startW + dW * eased);
            const h = Math.round(startH + dH * eased);
            const x = Math.round(startPos.x + dX * eased);
            const y = Math.round(startPos.y + dY * eased);

            win.setSize(new PhysicalSize(w, h)).catch(() => {});
            win.setPosition(new PhysicalPosition(x, y)).catch(() => {});

            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                Promise.all([
                    win.setSize(new PhysicalSize(snapshot.width, snapshot.height)),
                    win.setPosition(new PhysicalPosition(snapshot.x, snapshot.y)),
                ])
                    .catch(() => {})
                    .finally(() => resolve());
            }
        }
        requestAnimationFrame(frame);
    });
}
