# StarTrad FR - Version 3.1.0

## Nouveautes

### Discord Rich Presence
- Integration Discord : affichez votre activite StarTrad FR sur votre profil Discord
- Affichage automatique de l'etat (page en cours, version traduite, etc.)
- Activation/desactivation depuis les parametres

### Mode Hors-Ligne
- Nouveau systeme de cache des traductions pour fonctionner sans connexion internet
- Les 3 sources de traduction (SCFRA FR, SCFRA EN, Circuspes) sont automatiquement mises en cache
- Installation des traductions possible meme sans internet
- Indicateur visuel du mode hors-ligne dans la page Traduction
- Rafraichissement automatique du cache lors du retour en ligne

### Temps de Jeu
- Affichage du temps de jeu total sur la page d'accueil
- Calcul base sur les logs du jeu (dossier logbackups)
- Nombre de sessions detectees

### Export/Import des Preferences
- Export local : sauvegardez vos preferences (theme, sidebar, stats) dans un fichier JSON
- Import local : restaurez vos preferences depuis un fichier
- Sauvegarde cloud : synchronisez vos preferences avec votre compte (connexion requise)
- Restauration cloud : recuperez vos preferences sur un autre appareil

### Statistiques Utilisateur
- Suivi du nombre d'installations de traduction
- Suivi du nombre de nettoyages de cache
- Suivi des personnages telecharges
- Date de premiere utilisation de l'application

## Corrections

### Synchronisation Cloud des Preferences
- Correction de l'application du theme lors de la restauration des preferences depuis le cloud
- Le theme de couleur et le mode clair/sombre sont maintenant correctement appliques visuellement apres restauration
- Amelioration des libelles des boutons : "Sauvegarder" et "Restaurer" au lieu de "Cloud" avec fleches

## Ameliorations

### Interface Accueil
- Nouveau design moderne pour la section Patchnotes avec des cards individuelles
- Nouveau design moderne pour la section Actualites avec des cards individuelles
- Ajout de badges de categorie pour les actualites (Promo, Lettre, Hebdo, Patch, Live, ISC, Actu)
- Ajout du label "Nouveau" avec icone sur les elements les plus recents
- Dates relatives (Aujourd'hui, Hier, Il y a X jours) pour une meilleure lisibilite
- Mise en avant visuelle du premier element de chaque section

### Page Traduction
- Affichage de la date de derniere mise a jour pour chaque traduction
- Indicateur de source en cache disponible
- Meilleure gestion des erreurs reseau

### Fenetre
- Ajustement de la taille de la fenetre a 1294x1060 pour un meilleur confort visuel

## Checksums (SHA256)

```
StarTrad FR_3.1.0_x64_fr-FR.msi
9fd9f304760aa7e33f1627c0e2bddc307c43a697907e21909f8f67857072ccb7

StarTrad FR_3.1.0_x64-setup.exe
ee818c81c42999ee22ca62b322ab744a3ef942329c5e666913758f6a68403e47

startradfr.exe (Portable)
663a666225587f9d3e133f26ccb6cd3519bcb2c643bd9c87a84f86d916fa5bce
```

---
Date: 09/01/2026
