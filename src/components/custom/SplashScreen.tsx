import { useEffect, useState } from 'react';
import { useTheme } from '@/components/utils/theme-provider';
import logoW from '@/assets/svg/logo-w.svg';
import logoB from '@/assets/svg/logo-b.svg';

interface SplashScreenProps {
    onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const { theme } = useTheme();
    const [fadeOut, setFadeOut] = useState(false);

    const currentTheme = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    const logo = currentTheme === 'dark' ? logoW : logoB;

    useEffect(() => {
        const fadeTimer = setTimeout(() => setFadeOut(true), 3000);
        const doneTimer = setTimeout(onComplete, 3500);
        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(doneTimer);
        };
    }, [onComplete]);

    return (
        <div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
            style={{
                background: currentTheme === 'dark'
                    ? 'radial-gradient(ellipse at 50% 40%, rgba(56,189,248,0.06) 0%, transparent 60%), hsl(222 20% 6%)'
                    : 'radial-gradient(ellipse at 50% 40%, rgba(56,189,248,0.08) 0%, transparent 60%), hsl(210 20% 97%)',
                animation: fadeOut ? 'splash-out 0.5s ease-in forwards' : undefined,
            }}
            data-tauri-drag-region
        >
            {/* Logo */}
            <div
                style={{
                    animation: 'splash-logo-in 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards',
                }}
            >
                <img
                    src={logo}
                    alt="Logo StarTrad FR"
                    className="object-contain drop-shadow-2xl"
                    style={{ width: 160, height: 160 }}
                />
            </div>

            {/* Texte */}
            <div
                className="flex flex-col items-center text-center mt-5 gap-1"
                style={{ animation: 'splash-text-in 0.5s ease-out 0.5s both' }}
            >
                <h1
                    className="text-xl font-bold tracking-widest uppercase"
                    style={{ color: currentTheme === 'dark' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)', letterSpacing: '0.2em' }}
                >
                    StarTrad FR
                </h1>
                <p
                    className="text-xs tracking-wider"
                    style={{ color: currentTheme === 'dark' ? 'rgba(148,163,184,0.8)' : 'rgba(100,116,139,0.9)' }}
                >
                    Traduction Star Citizen&nbsp;
                    <span style={{ opacity: 0.6 }}>by</span>&nbsp;
                    <span className="font-semibold" style={{ color: currentTheme === 'dark' ? 'rgba(186,230,253,0.9)' : 'rgba(14,116,144,0.9)' }}>Drrakendu78</span>
                </p>
            </div>

            {/* Barre de chargement */}
            <div
                className="mt-8 overflow-hidden rounded-full"
                style={{
                    width: 140,
                    height: 2,
                    background: currentTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    animation: 'splash-text-in 0.4s ease-out 0.7s both',
                }}
            >
                <div
                    className="h-full rounded-full"
                    style={{
                        background: 'linear-gradient(90deg, rgba(56,189,248,0.6), rgba(99,102,241,0.7))',
                        animation: 'splash-bar-fill 2.8s cubic-bezier(0.4,0,0.2,1) 0.7s both',
                    }}
                />
            </div>

            {/* Dots */}
            <div
                className="flex items-center gap-1.5 mt-3"
                style={{ animation: 'splash-text-in 0.4s ease-out 0.9s both' }}
            >
                {[0, 1, 2].map((i) => (
                    <span
                        key={i}
                        className="rounded-full"
                        style={{
                            width: 4,
                            height: 4,
                            background: currentTheme === 'dark' ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.5)',
                            animation: `splash-dot 1.4s ease-in-out ${0.9 + i * 0.18}s infinite`,
                        }}
                    />
                ))}
            </div>
        </div>
    );
}
