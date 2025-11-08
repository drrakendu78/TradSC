import React, { useState } from "react";
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

function App() {
  const [showSplash, setShowSplash] = useState(true);

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
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
