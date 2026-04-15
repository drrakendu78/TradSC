import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertTriangle, Info, AlertCircle } from "lucide-react"

const variantConfig = {
  destructive: {
    Icon: AlertCircle,
    iconClass: "text-red-400",
    lineClass: "via-red-500/60",
  },
  success: {
    Icon: CheckCircle2,
    iconClass: "text-green-400",
    lineClass: "via-green-500/60",
  },
  warning: {
    Icon: AlertTriangle,
    iconClass: "text-yellow-400",
    lineClass: "via-yellow-500/60",
  },
  default: {
    Icon: Info,
    iconClass: "text-primary/80",
    lineClass: "via-primary/50",
  },
} as const

type ToastVariant = keyof typeof variantConfig

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const variant = (props.variant as ToastVariant) ?? "default"
        const { Icon, iconClass, lineClass } = variantConfig[variant] ?? variantConfig.default

        return (
          <Toast key={id} {...props}>
            {/* Luminous top line */}
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${lineClass} to-transparent`} />

            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />

            <div className="flex min-w-0 flex-1 flex-col">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>

            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
