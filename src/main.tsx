import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./components/utils/routes";
import './index.css';
import { ThemeProvider } from "@/components/utils/theme-provider";
import ControlMenu from "@/components/custom/control-menu";
import { BorderBeam } from "@/components/magicui/border-beam";
import { SecurityWarning } from "@/components/custom/SecurityWarning";
import AdminElevateButton from "@/components/custom/AdminElevateButton";
import { ErrorBoundary } from "@/components/custom/ErrorBoundary";
import { SplashScreen } from "@/components/custom/SplashScreen";
import { UpdateModal } from "@/components/custom/UpdateModal";
import { updateService } from "@/services/updateService";
import { invoke } from "@tauri-apps/api/core";

// Helper pour détecter si on est dans Tauri ou dans un navigateur web
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Helper pour détecter si on est sur Vercel (navigateur web direct)
export const isVercelWeb = (): boolean => {
  return import.meta.env.VITE_IS_VERCEL === true || import.meta.env.VITE_IS_VERCEL === 'true';
};

function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Initialisation du service de mise à jour automatique
  useEffect(() => {
    console.log('[AutoUpdate] Initialisation du service de mise à jour...');

    // On essaie directement l'invoke - si ça échoue, on n'est pas dans Tauri
    invoke<boolean>('is_minimized_start')
      .then((isMinimizedStart) => {
        console.log('[AutoUpdate] Mode démarrage minimisé:', isMinimizedStart);
        updateService.setMinimizedStart(isMinimizedStart);

        const delay = isMinimizedStart ? 10000 : 3000;
        console.log(`[AutoUpdate] Vérification dans ${delay / 1000}s...`);

        setTimeout(() => {
          console.log('[AutoUpdate] Lancement de autoUpdate()...');
          updateService.autoUpdate()
            .then(() => console.log('[AutoUpdate] autoUpdate() terminé'))
            .catch((err) => console.error('[AutoUpdate] Erreur autoUpdate:', err));
        }, delay);
      })
      .catch((err) => {
        // Si invoke échoue, on n'est probablement pas dans Tauri (mode web)
        console.log('[AutoUpdate] Pas dans Tauri ou erreur invoke:', err);
      });
  }, []);

  // Détecter et traiter les tokens OAuth dans l'URL au démarrage
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && (hash.includes('access_token') || hash.includes('error=') || hash.includes('code='))) {
      // Laisser Supabase détecter automatiquement le token (avec detectSessionInUrl: true)
      // Attendre un peu pour que Supabase traite le token, puis nettoyer l'URL
      setTimeout(() => {
        // Nettoyer le hash après que Supabase ait traité le token
        if (window.location.hash.includes('access_token') || window.location.hash.includes('code=')) {
          window.location.hash = '#/';
        }
      }, 1000); // Attendre 1 seconde pour que Supabase traite le token
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
          <UpdateModal autoShow={true} />
          <BorderBeam duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />
          <BorderBeam delay={4} duration={8} size={150} colorFrom="#FAFAFA" colorTo="#FAFAFA" />
        </>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
