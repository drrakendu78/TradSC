import { useEffect, useState } from 'react';
import { useTheme } from '@/components/utils/theme-provider';
import logoW from '@/assets/svg/logo-w.svg';
import logoB from '@/assets/svg/logo-b.svg';

interface SplashScreenProps {
    onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const [isVisible, setIsVisible] = useState(true);
    const { theme } = useTheme();
    const [logo, setLogo] = useState<string>(logoW);

    useEffect(() => {
        // Déterminer le logo selon le thème
        const currentTheme = theme === 'system' 
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : theme;
        
        if (currentTheme === 'dark') {
            setLogo(logoW);
        } else {
            setLogo(logoB);
        }
    }, [theme]);

    useEffect(() => {
        // Afficher le splash pendant 3 secondes minimum, puis le faire disparaître
        const timer = setTimeout(() => {
            setIsVisible(false);
            // Attendre la fin de l'animation de fade out avant d'appeler onComplete
            setTimeout(() => {
                onComplete();
            }, 500);
        }, 3000);

        return () => clearTimeout(timer);
    }, [onComplete]);

    if (!isVisible) {
        return null;
    }

    return (
        <>
            {/* Fond avec dégradé pour l'effet acrylique */}
            <div 
                className="fixed inset-0 z-[9998] bg-gradient-to-br from-background via-background/80 to-background/60"
                style={{
                    background: 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 50%), linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--background)) 100%)',
                }}
            />
            {/* Splash screen avec effet acrylique */}
            <div
                className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 text-foreground transition-all duration-500 ${
                    isVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                }}
                data-tauri-drag-region
            >
                <img
                    src={logo}
                    alt="Logo StarTrad FR"
                    className="w-[900px] h-[900px] max-w-[90vw] max-h-[90vh] object-contain transition-all duration-300 drop-shadow-2xl"
                />
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-lg font-bold tracking-wide mb-1 transition-all duration-300 drop-shadow-lg">
                        StarTrad FR
                    </h1>
                    <p className="text-sm text-muted-foreground tracking-wider transition-all duration-300 drop-shadow-md">
                        Traduction Star Citizen <span className="opacity-75">by</span> <span className="font-semibold">Drrakendu78</span>
                    </p>
                </div>
            </div>
        </>
    );
}

