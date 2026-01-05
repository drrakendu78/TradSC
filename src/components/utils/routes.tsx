import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  </Router>
);

export default AppRouter;