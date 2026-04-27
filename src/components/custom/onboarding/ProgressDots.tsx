// Indicateur de progression du wizard. Le dot actif s'élargit (pill style),
// les dots passés sont teintés primaire/60, les dots à venir sont muted.

interface ProgressDotsProps {
    stepIndex: number;
    total: number;
}

export function ProgressDots({ stepIndex, total }: ProgressDotsProps) {
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: total }, (_, i) => (
                <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                        i === stepIndex
                            ? "w-8 bg-primary"
                            : i < stepIndex
                                ? "w-1.5 bg-primary/60"
                                : "w-1.5 bg-muted"
                    }`}
                />
            ))}
        </div>
    );
}
