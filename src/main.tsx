import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./components/utils/routes";
import { LazyMotion, domAnimation, MotionConfig, useReducedMotion } from "framer-motion";
import './index.css';
import { ThemeProvider } from "@/components/utils/theme-provider";
import ControlMenu from "@/components/custom/control-menu";
import { BorderBeam } from "@/components/magicui/border-beam";
import { SecurityWarning } from "@/components/custom/SecurityWarning";
import AdminElevateButton from "@/components/custom/AdminElevateButton";
import { ErrorBoundary } from "@/components/custom/ErrorBoundary";
import { SplashScreen } from "@/components/custom/SplashScreen";


// Helper pour détecter si on est dans Tauri ou dans un navigateur web
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Helper pour détecter si on est sur Vercel (navigateur web direct)
export const isVercelWeb = (): boolean => {
  return import.meta.env.VITE_IS_VERCEL === true || import.meta.env.VITE_IS_VERCEL === 'true';
};

function App() {
  useReducedMotion();
  const [showSplash, setShowSplash] = useState(true);

  // Détecter et traiter les tokens OAuth dans l'URL au démarrage
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && (hash.includes('access_token') || hash.includes('error=') || hash.includes('code='))) {
      // Supabase détecte le token automatiquement (detectSessionInUrl: true)
      // Nettoyer immédiatement l'URL pour ne pas exposer le token
      window.history.replaceState(null, '', window.location.pathname + '#/');
    }
  }, []);

  return (
    <>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      {!showSplash && (
        <>
          <SecurityWarning onContinue={() => { }} />
          <ControlMenu />
          <AppRouter />
          <AdminElevateButton />
          <BorderBeam duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />
          <BorderBeam delay={4} duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />
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
