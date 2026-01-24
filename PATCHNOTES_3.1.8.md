# StarTrad FR v3.1.8 - Correction du système de mise à jour

## Corrections

### Système de mise à jour automatique
- Correction de l'endpoint pour `tauri-plugin-updater`
- Ajout de la génération automatique de `latest.json` dans le workflow
- Meilleure gestion des erreurs avec logs détaillés
- La page "Mises à jour" utilise maintenant le nouveau service

### Workflow GitHub Actions
- Support des tags avec et sans préfixe `v`
- Génération du fichier `latest.json` pour l'auto-updater
- Création automatique du `.nsis.zip` pour les mises à jour

### Types TypeScript
- Ajout du type `portable` pour la distribution

## Notes techniques
Cette version corrige le système de mise à jour automatique introduit en v3.1.7. Les utilisateurs de la v3.1.7 pourront maintenant recevoir les mises à jour automatiquement.
