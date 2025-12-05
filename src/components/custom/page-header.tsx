import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    icon?: LucideIcon;
    title: string;
    description?: string;
    children?: React.ReactNode;
}

export function PageHeader({ icon: Icon, title, description, children }: PageHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4 mb-6"
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {Icon && (
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Icon className="h-6 w-6 text-primary" />
                        </div>
                    )}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                        {description && (
                            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                        )}
                    </div>
                </div>
                {children && (
                    <div className="flex items-center gap-2">
                        {children}
                    </div>
                )}
            </div>
        </motion.div>
    );
}

interface InfoBoxProps {
    children: React.ReactNode;
    variant?: 'default' | 'warning' | 'success' | 'error';
}

export function InfoBox({ children, variant = 'default' }: InfoBoxProps) {
    const variants = {
        default: 'bg-muted/30 border-muted text-muted-foreground',
        warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400',
        success: 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400',
        error: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className={`p-4 rounded-lg border ${variants[variant]}`}
        >
            <p className="text-sm leading-relaxed">{children}</p>
        </motion.div>
    );
}

interface PageContainerProps {
    children: React.ReactNode;
    className?: string;
}

export function PageContainer({ children, className = '' }: PageContainerProps) {
    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`flex flex-col w-full h-full p-4 overflow-hidden ${className}`}
        >
            {children}
        </motion.div>
    );
}

