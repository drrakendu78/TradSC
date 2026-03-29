import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import Home from '@/pages/Home';
import Traduction from '@/pages/Traduction';
import Layout from '@/components/custom/layout';
import ClearCache from '@/pages/ClearCache';
import LocalCharactersPresets from '@/pages/LocalCharactersPresets';
import CharactersPresetsList from '@/pages/CharactersPresetsList';
import UpdatesPage from '@/pages/UpdatesPage';
import PatchNotes from '@/pages/PatchNotes';
import Actualites from '@/pages/Actualites';
import Bindings from '@/pages/Bindings';
import DpsCalculator from '@/pages/DpsCalculator';
import GraphicsSettings from '@/pages/GraphicsSettings';
import ShipMaps from '@/pages/ShipMaps';
import Finder from '@/pages/Finder';
import Pvp from '@/pages/Pvp';
import Cargo from '@/pages/Cargo';
import VerseGuide from '@/pages/VerseGuide';


const ScrollToTop = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Nettoyer l'URL si elle contient des paramètres OAuth (comme /access_token=...)
    if (pathname.includes('access_token') || pathname.includes('error=') || pathname.includes('code=')) {
      // Rediriger vers la page d'accueil et nettoyer l'URL
      navigate('/', { replace: true });
      return;
    }

    const el = document.querySelector('.app-scroll-root');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname, navigate]);

  // Écouter les événements de navigation depuis le system tray
  useEffect(() => {
    const unlisten = listen<string>('tray-navigate', (event) => {
      navigate(event.payload, { replace: true });
    });
    return () => { unlisten.then(fn => fn()); };
  }, [navigate]);

  // Sync l'état des services dans le tray au démarrage
  useEffect(() => {
    const syncTray = async () => {
      const discord = localStorage.getItem('discordRPCEnabled') === 'true';
      const video = localStorage.getItem('backgroundVideoEnabled') !== 'false';
      await invoke('update_tray_service', { service: 'discord', enabled: discord }).catch(() => {});
      await invoke('update_tray_service', { service: 'video', enabled: video }).catch(() => {});
      invoke<{ enabled: boolean }>('get_background_service_config').then(config => {
        invoke('update_tray_service', { service: 'bg_service', enabled: config.enabled }).catch(() => {});
      }).catch(() => {});
      invoke<boolean>('is_auto_startup_enabled').then(enabled => {
        invoke('update_tray_service', { service: 'auto_startup', enabled }).catch(() => {});
      }).catch(() => {});
    };
    syncTray();
  }, []);

  // Écouter les toggles de services depuis le system tray
  useEffect(() => {
    const unlisten = listen<string>('tray-toggle', (event) => {
      const service = event.payload;
      if (service === 'video') {
        const current = localStorage.getItem('backgroundVideoEnabled') !== 'false';
        const next = !current;
        localStorage.setItem('backgroundVideoEnabled', String(next));
        window.dispatchEvent(new CustomEvent('backgroundVideoToggle', { detail: next }));
        invoke('update_tray_service', { service: 'video', enabled: next }).catch(() => {});
      } else if (service === 'discord') {
        const current = localStorage.getItem('discordRPCEnabled') === 'true';
        if (current) {
          invoke('disconnect_discord').catch(console.error);
          localStorage.setItem('discordRPCEnabled', 'false');
          invoke('update_tray_service', { service: 'discord', enabled: false }).catch(() => {});
        } else {
          invoke('connect_discord').catch(console.error);
          localStorage.setItem('discordRPCEnabled', 'true');
          invoke('update_tray_service', { service: 'discord', enabled: true }).catch(() => {});
        }
      } else if (service === 'bg_service') {
        invoke<{ enabled: boolean }>('get_background_service_config').then(async (config) => {
          const next = !config.enabled;
          const newConfig = { ...config, enabled: next };
          await invoke('save_background_service_config', { config: newConfig }).catch(console.error);
          await invoke('set_background_service_config', { config: newConfig }).catch(console.error);
          if (next) {
            await invoke('start_background_service').catch(console.error);
          } else {
            await invoke('stop_background_service').catch(console.error);
          }
          invoke('update_tray_service', { service: 'bg_service', enabled: next }).catch(() => {});
        }).catch(console.error);
      } else if (service === 'auto_startup') {
        invoke<boolean>('is_auto_startup_enabled').then(async (current) => {
          if (current) {
            await invoke('disable_auto_startup').catch(console.error);
          } else {
            await invoke('enable_auto_startup').catch(console.error);
          }
          invoke('update_tray_service', { service: 'auto_startup', enabled: !current }).catch(() => {});
        }).catch(console.error);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  return null;
};

// Composant pour gérer les routes non trouvées (comme les callbacks OAuth)
const NotFound = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Rediriger vers la page d'accueil si on arrive sur une route inconnue
    navigate('/', { replace: true });
  }, [navigate]);
  
  return null;
};

const AppRouter = () => (
  <Router>
    <Layout>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/traduction" element={<Traduction />} />
        <Route path="/cache" element={<ClearCache />} />
        <Route path="/presets-local" element={<LocalCharactersPresets />} />
        <Route path='/presets-remote' element={<CharactersPresetsList />} />
        <Route path='/updates' element={<UpdatesPage />} />
        <Route path='/patchnotes' element={<PatchNotes />} />
        <Route path='/actualites' element={<Actualites />} />
        <Route path='/dps-calculator' element={<DpsCalculator />} />
        <Route path='/bindings' element={<Bindings />} />
        <Route path='/graphics-settings' element={<GraphicsSettings />} />
        <Route path='/ship-maps' element={<ShipMaps />} />
        <Route path='/finder' element={<Finder />} />
        <Route path='/pvp' element={<Pvp />} />
        <Route path='/cargo' element={<Cargo />} />
        <Route path='/verseguide' element={<VerseGuide />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  </Router>
);

export default AppRouter;