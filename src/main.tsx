import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import AppRouter from "./components/utils/routes";
import { LazyMotion, domAnimation, MotionConfig, useReducedMotion } from "framer-motion";
import "./index.css";
import { ThemeProvider } from "@/components/utils/theme-provider";
import { BorderBeam } from "@/components/magicui/border-beam";
import { SecurityWarning } from "@/components/custom/SecurityWarning";
import AdminElevateButton from "@/components/custom/AdminElevateButton";
import { ErrorBoundary } from "@/components/custom/ErrorBoundary";
import { SplashScreen } from "@/components/custom/SplashScreen";
import OnboardingWizard from "@/components/custom/onboarding/OnboardingWizard";
import { CacheCleanupPrompt } from "@/components/custom/cache-cleanup-prompt";
import { useCompanionBridge } from "@/hooks/useCompanionBridge";
import { ensureLegacyCacheMigration, useShaderCacheAutoCleanOnBoot } from "@/hooks/useShaderCacheAutoClean";
import { isTauri } from "@/utils/tauri-helpers";

const COMPANION_ENABLED_KEY = "companionServerEnabled";
const DEFAULT_COMPANION_PORT = 47823;

function setCompanionEnabledState(next: boolean) {
  window.localStorage.setItem(COMPANION_ENABLED_KEY, String(next));
  window.dispatchEvent(
    new CustomEvent("companion-enabled-changed", {
      detail: { enabled: next },
    })
  );
}

function App() {
  useReducedMotion();
  const [showSplash, setShowSplash] = useState(true);
  // `null` = pas encore vérifié ; `true/false` = état chargé.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && (hash.includes("access_token") || hash.includes("error=") || hash.includes("code="))) {
      window.history.replaceState(null, "", window.location.pathname + "#/");
    }
  }, []);

  // Check de l'état d'onboarding une fois la fenêtre principale prête.
  // On ne le fait pas dans les overlays (fenêtres secondaires).
  useEffect(() => {
    const isOverlayWin =
      window.location.hash.includes("/overlay-view") ||
      window.location.hash.includes("/overlay-control") ||
      window.location.hash.includes("/pvp-overlay") ||
      window.location.hash.includes("/overlay-hub") ||
      window.location.hash.includes("/overlay-webview-bar") ||
      window.location.hash.includes("/overlay-hub-preset-picker");
    if (isOverlayWin || !isTauri()) {
      setShowOnboarding(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // Await la migration mtime-based AVANT de check l'onboarding state :
      // sinon `get_onboarding_state` lit le `onboarding.json` legacy avant
      // qu'il soit wipe, et le wizard ne se relance pas après une fresh install.
      await ensureLegacyCacheMigration();
      if (cancelled) return;
      try {
        const s = await invoke<{ onboarding_done: boolean; attempts: number }>("get_onboarding_state");
        if (cancelled) return;
        setShowOnboarding(!s.onboarding_done);
      } catch {
        if (!cancelled) setShowOnboarding(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isOverlay =
    window.location.hash.includes("/overlay-view") ||
    window.location.hash.includes("/overlay-control") ||
    window.location.hash.includes("/pvp-overlay") ||
    window.location.hash.includes("/overlay-hub") ||
    window.location.hash.includes("/overlay-webview-bar");

  useCompanionBridge(!isOverlay);
  useShaderCacheAutoCleanOnBoot();

  useEffect(() => {
    if (isOverlay || !isTauri()) return;

    const enabled = window.localStorage.getItem(COMPANION_ENABLED_KEY) === "true";
    if (!enabled) return;

    let cancelled = false;

    const startCompanionWithRetry = async () => {
      let lastError: unknown = null;

      for (const delay of [0, 450, 1200]) {
        if (cancelled) return;

        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }

        try {
          await invoke("start_companion_server", { port: DEFAULT_COMPANION_PORT });
          if (!cancelled) {
            setCompanionEnabledState(true);
          }
          return;
        } catch (error) {
          lastError = error;
        }
      }

      console.error("Impossible de relancer Companion LAN au demarrage:", lastError);
      if (!cancelled) {
        setCompanionEnabledState(false);
      }
    };

    startCompanionWithRetry().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [isOverlay]);

  return (
    <>
      {showSplash && !isOverlay && <SplashScreen onComplete={() => setShowSplash(false)} />}
      {(isOverlay || !showSplash) && (
        <>
          {/* Wizard d'onboarding : remplace SecurityWarning au tout 1er lancement.
              Quand actif, prend toute la fenêtre. À la fin, marque le flag et
              démonte ; SecurityWarning reste là pour les utilisateurs déjà
              onboardés mais sera court-circuité par son propre flag localStorage. */}
          {showOnboarding === true && !isOverlay && (
            <OnboardingWizard onClose={() => setShowOnboarding(false)} />
          )}
          {!isOverlay && showOnboarding === false && (
            <SecurityWarning onContinue={() => {}} />
          )}
          <AppRouter />
          {/* On masque les widgets fixed (admin button, BorderBeam) quand le
              wizard est actif : ils s'affichent par-dessus et bloquent les
              clics sur le footer du wizard ("Suivant"). */}
          {!isOverlay && showOnboarding === false && <AdminElevateButton />}
          {!isOverlay && showOnboarding === false && <BorderBeam duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />}
          {!isOverlay && showOnboarding === false && <BorderBeam delay={4} duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />}
          {!isOverlay && showOnboarding === false && <CacheCleanupPrompt />}
        </>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ThemeProvider>
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
