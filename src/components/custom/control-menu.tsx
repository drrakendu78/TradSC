import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Minus, Volume2, VolumeX, SkipBack, SkipForward } from "lucide-react";
import { useState, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';

export default function ControlMenu() {
    const appWindow = getCurrentWindow();
    const [volume, setVolume] = useState(0.5); // Volume par défaut à 50%
    const [isMuted, setIsMuted] = useState(false);

    const minimize = async () => await appWindow?.minimize();
    const close = async () => await appWindow?.close();

    // Charger le volume sauvegardé depuis localStorage
    useEffect(() => {
        const savedVolume = localStorage.getItem('videoVolume');
        if (savedVolume) {
            const vol = parseFloat(savedVolume);
            setVolume(vol);
        }
    }, []);

    // Sauvegarder le volume et émettre l'événement
    useEffect(() => {
        localStorage.setItem('videoVolume', volume.toString());
        window.dispatchEvent(new CustomEvent('videoVolumeChange', { detail: volume }));
    }, [volume]);

    const toggleMute = () => {
        const newMutedState = !isMuted;
        setIsMuted(newMutedState);
        window.dispatchEvent(new CustomEvent('videoMuteChange', { detail: newMutedState }));
    };

    const handlePreviousVideo = () => {
        window.dispatchEvent(new CustomEvent('youtubePrevious'));
    };

    const handleNextVideo = () => {
        window.dispatchEvent(new CustomEvent('youtubeNext'));
    };

    return (
        <div className='flex flex-row gap-2 fixed right-4 top-4 z-[100] items-center pointer-events-auto'>
            {/* Contrôle de volume et navigation */}
            <div className='flex items-center gap-2 bg-background/70 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-border/50 shadow-md'>
                {/* Boutons précédent/suivant */}
                <button 
                    onClick={handlePreviousVideo}
                    className='hover:opacity-70 transition-opacity'
                    title="Vidéo précédente"
                >
                    <SkipBack className='h-4 w-4 text-muted-foreground' />
                </button>
                <button 
                    onClick={handleNextVideo}
                    className='hover:opacity-70 transition-opacity'
                    title="Vidéo suivante"
                >
                    <SkipForward className='h-4 w-4 text-muted-foreground' />
                </button>
                
                {/* Séparateur */}
                <div className='h-4 w-px bg-border/50 mx-1' />
                
                {/* Contrôle de volume */}
                <button 
                    onClick={toggleMute}
                    className='hover:opacity-70 transition-opacity'
                    title={isMuted ? "Activer le son" : "Couper le son"}
                >
                    {isMuted ? (
                        <VolumeX className='h-4 w-4 text-muted-foreground' />
                    ) : (
                        <Volume2 className='h-4 w-4 text-muted-foreground' />
                    )}
                </button>
                <Slider
                    value={[volume * 100]}
                    onValueChange={(value: number[]) => setVolume(value[0] / 100)}
                    max={100}
                    min={0}
                    step={1}
                    className="w-24"
                    disabled={isMuted}
                />
                <span className='text-xs text-muted-foreground w-8 text-right'>
                    {Math.round(volume * 100)}%
                </span>
            </div>
            
            <button onClick={minimize} 
                className='bg-gray-500 hover:bg-yellow-400 rounded-full flex justify-center items-center p-0.5 group shrink-0 pointer-events-auto relative z-[100]'>
                <Minus strokeWidth={2} className='h-2.5 w-2.5 text-gray-100 group-hover:text-background' />
            </button>
            <button onClick={close} 
                className='bg-gray-500 hover:bg-red-400 rounded-full flex justify-center items-center p-0.5 group shrink-0 pointer-events-auto relative z-[100]'>
                <X strokeWidth={2} className='h-2.5 w-2.5 text-gray-100 group-hover:text-background'/>
            </button>
        </div>
    )
}