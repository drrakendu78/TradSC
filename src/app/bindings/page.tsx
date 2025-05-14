"use client";

import { Button } from "@/components/ui/button";
import { open } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import type { Binding } from "./columns";
import ActionsMenu from "./actions";
import { Plus } from "lucide-react";
import { motion } from "framer-motion";
import { Separator } from "@/components/ui/separator";

interface BindingFile {
  name: string;
  path: string;
}

export default function BindingsPage() {
  const { toast } = useToast();
  const [bindings, setBindings] = useState<BindingFile[]>([]);

  const loadBindings = async () => {
    try {
      const files = await invoke<BindingFile[]>("list_bindings_files");
      setBindings(files);
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de charger la liste des bindings",
        success: false,
        duration: 3000,
      });
    }
  };

  const handleImportBindings = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Bindings", extensions: ["xml"] }]
      });

      if (!selected) {
        return;
      }

      await invoke("import_bindings_file", { sourcePath: selected });
      
      toast({
        title: "Succès",
        description: "Les bindings ont été importés avec succès !",
        success: true,
        duration: 3000,
      });

      // Recharger la liste après l'import
      loadBindings();
    } catch (error: unknown) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Une erreur inattendue s'est produite.",
        success: false,
        duration: 3000,
      });
    }
  };

  useEffect(() => {
    loadBindings();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: [0, 0.71, 0.2, 1.01] }}
      className="flex h-full max-h-screen flex-col max-w-full p-6"
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Gestion des Bindings</h1>
          <p className="text-muted-foreground mt-2">
            Gérez vos fichiers de configuration des contrôles de Star Citizen.
          </p>
        </div>
        <Separator />
        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <Button onClick={handleImportBindings}>
              <Plus className="mr-2 h-4 w-4" />
              Importer des bindings
            </Button>
            <ActionsMenu updateBindings={loadBindings} />
          </div>
        </div>
        <div className="h-[calc(100vh-12rem)]">
          <DataTable columns={columns(toast, loadBindings)} data={bindings} />
        </div>
      </div>
    </motion.div>
  );
}
