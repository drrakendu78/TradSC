import React from "react";
import { Circle } from "lucide-react";

interface DotLineProps {
    count?: number;
}

const DotLine: React.FC<DotLineProps> = ({ count = 50 }) => {
    return (
        <div className="flex justify-center">
            {Array.from({ length: count }).map((_, index) => (
                <Circle
                    key={index}
                    size={4}
                    fill="currentColor"
                    style={{
                        opacity: 0.3,
                    }}
                />
            ))}
        </div>
    );
};

interface DotPatternProps {
    rows?: number;
    dotsPerRow?: number;
}

export const DotPattern: React.FC<DotPatternProps> = ({
    rows = 3,
    dotsPerRow = 50,
}) => {
    return (
        <div className="flex flex-col items-center">
            {Array.from({ length: rows }).map((_, index) => (
                <DotLine key={index} count={dotsPerRow} />
            ))}
        </div>
    );
};
