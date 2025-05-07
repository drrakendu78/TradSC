import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function Skeleton({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-zinc-800 flex items-center justify-center",
                className,
            )}
            {...props}
        >
            <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
        </div>
    );
}

export { Skeleton };
