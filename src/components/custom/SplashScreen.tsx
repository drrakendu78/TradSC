import { useEffect } from 'react';
import { useTheme } from '@/components/utils/theme-provider';
import logoW from '@/assets/svg/logo-w.svg';
import logoB from '@/assets/svg/logo-b.svg';

interface SplashScreenProps {
    onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const { theme } = useTheme();

    const currentTheme = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    const logo = currentTheme === 'dark' ? logoW : logoB;

    useEffect(() => {
        const timer = setTimeout(onComplete, 3500);
        return () => clearTimeout(timer);
    }, [onComplete]);

    return (
        <>
            {/* Fond avec dégradé pour l'effet acrylique */}
            <div
                className="fixed inset-0 z-[9998] bg-gradient-to-br from-background via-background/80 to-background/60"
                style={{
                    background: 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 50%), linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--background)) 100%)',
                    animation: 'splashFade 3.5s ease-in-out forwards',
                }}
            />
            {/* Splash screen avec effet acrylique */}
            <div
                className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 text-foreground"
                style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    backdropFilter: 'blur(8px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(180%)',
                    animation: 'splashFade 3.5s ease-in-out forwards',
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

