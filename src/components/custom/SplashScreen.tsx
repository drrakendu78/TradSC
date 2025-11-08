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
        <div
            className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-[#e2e8f0] dark:bg-[#18181b] text-black dark:text-white transition-all duration-500 ${
                isVisible ? 'opacity-100' : 'opacity-0'
            }`}
            data-tauri-drag-region
        >
            <img
                src={logo}
                alt="Logo StarTrad FR"
                width={500}
                height={500}
                className="transition-all duration-300"
            />
            <div className="flex flex-col items-center text-center">
                <h1 className="text-5xl font-bold tracking-wide mb-2 transition-all duration-300">
                    StarTrad FR
                </h1>
                <p className="text-2xl text-muted-foreground tracking-wider transition-all duration-300">
                    Traduction Star Citizen <span className="opacity-75">by</span> <span className="font-semibold">Drrakendu78</span>
                </p>
            </div>
        </div>
    );
}

