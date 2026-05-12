import { useState, useEffect } from 'react';
import { SkipBack, SkipForward, Play, Pause, Volume2, VolumeX, Music2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MiniPlayerProps {
    className?: string;
}

export default function MiniPlayer({ className }: MiniPlayerProps) {
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('videoVolume');
        return saved ? parseFloat(saved) : 0.1;
    });
    const [isMuted, setIsMuted] = useState(() => localStorage.getItem('videoMuted') === 'true');
    const [isPlaying, setIsPlaying] = useState(() => localStorage.getItem('youtubePaused') !== 'true');
    const [trackTitle, setTrackTitle] = useState<string | null>(null);
    const [trackAuthor, setTrackAuthor] = useState<string | null>(null);

    const cleanTitle = (raw: string | null): string | null => {
        if (!raw) return raw;
        return raw.replace(/^\s*star\s*citizen\s*soundtrack\s*[-–—:]\s*/i, '').trim() || raw;
    };

    // Sync entre instances (control-menu ↔ mini-player) via storage + custom events
    useEffect(() => {
        const handleVolumeChange = (e: CustomEvent) => {
            if (typeof e.detail === 'number') setVolume(e.detail);
        };
        const handleMuteChange = (e: CustomEvent) => {
            if (typeof e.detail === 'boolean') setIsMuted(e.detail);
        };
        const handlePlayPause = (e: CustomEvent) => {
            if (typeof e.detail === 'boolean') setIsPlaying(e.detail);
        };
        const handleMetadata = (e: CustomEvent) => {
            const detail = e.detail || {};
            if (typeof detail.title === 'string' || detail.title === null) setTrackTitle(detail.title);
            if (typeof detail.author === 'string' || detail.author === null) setTrackAuthor(detail.author);
        };
        window.addEventListener('videoVolumeChange', handleVolumeChange as EventListener);
        window.addEventListener('videoMuteChange', handleMuteChange as EventListener);
        window.addEventListener('youtubePlayPause', handlePlayPause as EventListener);
        window.addEventListener('videoMetadata', handleMetadata as EventListener);

        // Demander la metadata actuelle (au cas où le PLAYING a été émis avant qu'on monte)
        const requestNow = () => window.dispatchEvent(new CustomEvent('requestVideoMetadata'));
        requestNow();
        const t1 = window.setTimeout(requestNow, 500);
        const t2 = window.setTimeout(requestNow, 1500);
        const t3 = window.setTimeout(requestNow, 3500);

        return () => {
            window.removeEventListener('videoVolumeChange', handleVolumeChange as EventListener);
            window.removeEventListener('videoMuteChange', handleMuteChange as EventListener);
            window.removeEventListener('youtubePlayPause', handlePlayPause as EventListener);
            window.removeEventListener('videoMetadata', handleMetadata as EventListener);
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            window.clearTimeout(t3);
        };
    }, []);

    const handlePrevious = () => {
        window.dispatchEvent(new CustomEvent('youtubePrevious'));
    };

    const handleNext = () => {
        window.dispatchEvent(new CustomEvent('youtubeNext'));
    };

    const togglePlayPause = () => {
        const newState = !isPlaying;
        setIsPlaying(newState);
        localStorage.setItem('youtubePaused', (!newState).toString());
        window.dispatchEvent(new CustomEvent('youtubePlayPause', { detail: newState }));
    };

    const toggleMute = () => {
        const newMuted = !isMuted;
        setIsMuted(newMuted);
        localStorage.setItem('videoMuted', newMuted.toString());
        window.dispatchEvent(new CustomEvent('videoMuteChange', { detail: newMuted }));
    };

    const handleVolumeChange = (values: number[]) => {
        const v = values[0] / 100;
        setVolume(v);
        localStorage.setItem('videoVolume', v.toString());
        window.dispatchEvent(new CustomEvent('videoVolumeChange', { detail: v }));
    };

    const iconButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground';
    const playButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary transition-all hover:scale-105 hover:bg-primary/25';

    return (
        <Card className={cn('border-border/40 bg-background/45 backdrop-blur-md', className)}>
            <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">
                        <Music2 className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold leading-tight truncate" title={trackTitle ?? undefined}>
                            {cleanTitle(trackTitle) || 'Lecteur ambiance'}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate" title={trackAuthor ?? undefined}>
                            {trackAuthor
                                ? `${trackAuthor} · ${isPlaying ? 'En lecture' : 'En pause'}`
                                : (isPlaying ? 'En lecture' : 'En pause')}
                        </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                        <button onClick={handlePrevious} className={iconButtonClass} title="Vidéo précédente" aria-label="Vidéo précédente">
                            <SkipBack className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={togglePlayPause} className={playButtonClass} title={isPlaying ? 'Pause' : 'Lecture'} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                        </button>
                        <button onClick={handleNext} className={iconButtonClass} title="Vidéo suivante" aria-label="Vidéo suivante">
                            <SkipForward className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={toggleMute} className={iconButtonClass} title={isMuted ? 'Activer le son' : 'Couper le son'} aria-label={isMuted ? 'Activer le son' : 'Couper le son'}>
                        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <Slider
                        value={[volume * 100]}
                        onValueChange={handleVolumeChange}
                        max={100}
                        min={0}
                        step={1}
                        className="flex-1"
                        disabled={isMuted}
                    />
                    <span className="w-8 text-right text-[10px] font-medium text-muted-foreground tabular-nums">
                        {Math.round(volume * 100)}%
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
