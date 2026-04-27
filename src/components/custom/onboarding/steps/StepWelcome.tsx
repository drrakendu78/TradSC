// Step 1 — Bienvenue + bloc sécurité (recycle le contenu du SecurityWarning).
// DA alignée sur la page Paramètres : glassmorphism + radial gradients
// primary, badges arrondis et bordures border/35.

import { BadgeCheck, Code, Github, Heart, Shield, Sparkles, Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function StepWelcome() {
    return (
        <div className="space-y-5">
            {/* Hero glass façon header Settings */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-6 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%),radial-gradient(100%_80%_at_0%_100%,hsl(var(--primary)/0.08),transparent_58%)]" />
                <div className="relative flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                        <Sparkles className="h-6 w-6" />
                    </div>
                    <div className="space-y-1.5">
                        <h1 className="font-exo text-3xl font-semibold tracking-tight">
                            Bienvenue dans StarTrad FR
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Application open-source gratuite avec un modèle de sécurité transparent. Avant de commencer, voici ce que tu dois savoir.
                        </p>
                    </div>
                </div>
            </section>

            {/* 2 cards comme la page Traduction : warning + garanties */}
            <div className="grid grid-cols-2 gap-4">
                <Card className="group relative overflow-hidden rounded-2xl border border-sky-500/30 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,rgba(14,165,233,0.12),transparent_58%)] opacity-60" />
                    <CardHeader className="relative pb-2">
                        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
                            <BadgeCheck className="h-5 w-5 text-sky-500" />
                            Application signée Microsoft Store
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="relative space-y-3 pt-0">
                        <p className="text-sm leading-relaxed text-foreground/85">
                            Cette version est distribuée et signée via le Microsoft Store. Aucune
                            alerte SmartScreen, aucun blocage antivirus : l'app est validée par
                            Microsoft à chaque mise à jour.
                        </p>
                        <div className="rounded-xl border border-sky-500/25 bg-sky-500/8 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                                <Store className="h-3 w-3" />
                                Mises à jour automatiques
                            </p>
                            <ol className="space-y-0.5 text-xs text-sky-700/90 dark:text-sky-300/90">
                                <li>• Gérées directement par le Microsoft Store</li>
                                <li>• Vérifiées et signées par Microsoft</li>
                            </ol>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,rgba(16,185,129,0.12),transparent_58%)] opacity-60" />
                    <CardHeader className="relative pb-2">
                        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
                            <Shield className="h-5 w-5 text-emerald-500" />
                            Garanties de sécurité
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="relative space-y-2 pt-0">
                        <GuaranteeRow
                            icon={<Code className="h-4 w-4 text-emerald-500" />}
                            title="Code source ouvert"
                            desc="Entièrement auditable sur GitHub."
                        />
                        <GuaranteeRow
                            icon={<Github className="h-4 w-4 text-emerald-500" />}
                            title="Build reproductible"
                            desc="Workflow GitHub Actions public."
                        />
                        <GuaranteeRow
                            icon={<Heart className="h-4 w-4 text-emerald-500" />}
                            title="Aucune collecte"
                            desc="Aucune donnée envoyée, pas de pub."
                        />
                    </CardContent>
                </Card>
            </div>

            <div className="flex items-center justify-center gap-2">
                <Badge
                    variant="outline"
                    className="h-6 gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-600 dark:text-emerald-400"
                >
                    <Heart className="h-3 w-3" />
                    100 % gratuit
                </Badge>
                <Badge
                    variant="outline"
                    className="h-6 gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 text-[11px] text-blue-600 dark:text-blue-400"
                >
                    <Github className="h-3 w-3" />
                    Open-source
                </Badge>
            </div>
        </div>
    );
}

function GuaranteeRow({
    icon,
    title,
    desc,
}: {
    icon: React.ReactNode;
    title: string;
    desc: string;
}) {
    return (
        <div className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-[hsl(var(--background)/0.26)] px-3 py-2">
            <div className="mt-0.5 flex-shrink-0">{icon}</div>
            <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight text-foreground/95">{title}</p>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
        </div>
    );
}
