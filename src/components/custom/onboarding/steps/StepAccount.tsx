// Step 5 — Connexion Supabase optionnelle. Réutilise le `AuthDialog` global.
// DA alignée : hero glass + Card avec radial primary.

import { CheckCircle, Cloud, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StepAccountProps {
    connected: boolean;
    onConnect: () => void;
}

export function StepAccount({ connected, onConnect }: StepAccountProps) {
    return (
        <div className="space-y-5">
            {/* Hero glass */}
            <section className="relative overflow-hidden rounded-2xl border border-border/55 bg-[hsl(var(--background)/0.30)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_100%_0%,hsl(var(--primary)/0.16),transparent_62%)]" />
                <div className="relative flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                        <Cloud className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="font-exo text-2xl font-semibold tracking-tight">
                            Sauvegarde cloud (optionnel)
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Connecte un compte StarTrad FR pour sauvegarder tes presets persos et tes préférences dans le cloud.
                        </p>
                    </div>
                </div>
            </section>

            <Card className="relative overflow-hidden rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.14)] shadow-[0_6px_16px_rgba(0,0,0,0.10)] backdrop-blur-md">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_100%_0%,hsl(var(--primary)/0.10),transparent_58%)] opacity-45" />
                <CardContent className="relative space-y-4 p-6">
                    {connected ? (
                        <div className="flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-500">
                                <CheckCircle className="h-6 w-6" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[15px] font-semibold">Compte connecté</p>
                                <p className="mt-0.5 text-[12px] text-muted-foreground">
                                    Tes presets et préférences sont synchronisés. Tu peux passer à l'étape suivante.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-2">
                                <Feature label="Presets persos" />
                                <Feature label="Préférences" />
                                <Feature label="Multi-PC" />
                            </div>
                            <Button
                                onClick={onConnect}
                                size="lg"
                                className="h-12 w-full gap-2 rounded-xl text-[14px] font-semibold"
                            >
                                <UserCircle className="h-4 w-4" />
                                Se connecter / créer un compte
                            </Button>
                            <p className="text-center text-[11px] text-muted-foreground">
                                Ou clique sur Suivant pour passer cette étape.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Feature({ label }: { label: string }) {
    return (
        <Badge
            variant="outline"
            className="h-9 w-full justify-center rounded-xl border-border/60 bg-[hsl(var(--background)/0.26)] text-[12px] font-semibold"
        >
            {label}
        </Badge>
    );
}
