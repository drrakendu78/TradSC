"use client";

import { useToast } from "@/hooks/use-toast";
import {
    Toast,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
} from "@/components/ui/toast";
import { CircleCheck, CircleX } from "lucide-react";

export function Toaster() {
    const { toasts } = useToast();

    return (
        <ToastProvider>
            {toasts.map(function ({
                id,
                title,
                description,
                action,
                success,
                ...props
            }) {
                return (
                    <Toast key={id} {...props}>
                        <div className="grid gap-1">
                            {title && (
                                <ToastTitle>
                                    {success ? (
                                        <CircleCheck className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <CircleX className="w-4 h-4 text-red-500" />
                                    )}
                                    {title}
                                </ToastTitle>
                            )}
                            {description && (
                                <ToastDescription>
                                    {description}
                                </ToastDescription>
                            )}
                        </div>
                        {action}
                        <ToastClose />
                    </Toast>
                );
            })}
            <ToastViewport />
        </ToastProvider>
    );
}
