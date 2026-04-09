# Plan : Overlay In-Game StarTrad FR

## Concept
Fenêtre(s) semi-transparente(s) toujours au premier plan, affichant du contenu web (scmdb.net, etc.).
- **Pas d'injection** → simple fenêtre OS always-on-top (comme Discord)
- **Toujours cliquable** → pas de click-through, pas de hotkey
- **Bouton masquer/afficher** → réduit l'overlay à un petit bouton discret, un clic le réaffiche
- **Zéro risque anti-triche** (EAC ne détecte pas les fenêtres OS)

---

## Architecture

### Côté Rust (src-tauri)

#### 1. Nouveau module `src-tauri/src/scripts/overlay.rs`
- **Commande `open_overlay`** : crée un `WebviewWindow` avec :
  - `transparent: true`
  - `decorations: false` (pas de barre de titre)
  - `always_on_top: true`
  - `skip_taskbar: true` (pas visible dans la barre des tâches)
  - URL configurable (scmdb.net, verseguide, etc.)
  - Position/taille sauvegardées
- **Commande `close_overlay`** : ferme une fenêtre overlay par label
- **Commande `update_overlay_config`** : met à jour opacité, position, taille, URL
- **Commande `list_overlays`** : retourne la liste des overlays actifs
- **Commande `toggle_overlay_visibility`** : masque/affiche le contenu (réduit à un petit bouton)
- **Commande `resize_overlay`** : redimensionne la fenêtre (taille complète ↔ bouton réduit)

#### 2. Persistance config
- Fichier JSON dans app_data : `overlay_config.json`
  ```json
  {
    "hotkey": "F2",
    "overlays": [
      {
        "id": "scmdb",
        "label": "SCMDB",
        "url": "https://scmdb.net/",
        "x": 100,
        "y": 100,
        "width": 400,
        "height": 600,
        "opacity": 0.7,
        "enabled": true
      }
    ]
  }
  ```

### Côté Frontend

#### 4. Page de configuration `src/pages/OverlaySettings.tsx`
- Liste des overlays configurés (ajouter/supprimer/modifier)
- Pour chaque overlay :
  - URL (input ou sélection parmi les sites intégrés : SCMDB, VerseGuide, etc.)
  - Opacité (slider 10% → 100%)
  - Taille (width × height)
  - Position (x, y) — ou bouton "Positionner" qui permet de drag la fenêtre
  - Toggle actif/inactif
- Configuration du hotkey global
- Bouton "Tester" → ouvre l'overlay sans lancer le jeu

#### 5. Contenu overlay `src/pages/OverlayView.tsx`
- Page chargée dans la fenêtre overlay
- **AUCUNE bordure, aucun cadre, aucune ombre** → doit ressembler à un vrai overlay injecté
- Iframe du site configuré, bords à bords
- Petits boutons flottants discrets en haut à droite (semi-transparents, apparaissent au hover) :
  - Drag (pour déplacer)
  - Masquer (réduit à un micro-bouton flottant)
  - Fermer
- Mode réduit : micro-bouton quasi invisible (petit rond semi-transparent) → un clic réaffiche l'overlay
- Fond transparent, pas de padding, pas de margin, pas de border-radius

#### 6. Sidebar
- Nouvelle entrée dans la sidebar : "Overlay" avec icône `IconLayersIntersect` ou similaire
- Sous la section Outils SC

#### 7. System Tray
- Ajouter dans le menu tray : "Overlays" → toggle on/off global

---

## Étapes d'implémentation

### Phase 1 : MVP (fenêtre overlay basique)
1. [ ] Créer `overlay.rs` avec `open_overlay` / `close_overlay`
2. [ ] Fenêtre WebviewWindow transparent + always_on_top + decorations off
3. [ ] Créer `OverlayView.tsx` (iframe + barre de contrôle : drag, masquer, fermer)
4. [ ] Bouton masquer/afficher (réduit à un petit bouton flottant)
5. [ ] Tester avec scmdb.net en always-on-top

### Phase 2 : Configuration & persistance
6. [ ] Créer `overlay_config.json` (load/save)
7. [ ] Créer `OverlaySettings.tsx` (UI de configuration)
8. [ ] Slider opacité, position, taille
9. [ ] Choix du site (tous les sites intégrés + URL custom)
10. [ ] Ajouter route + entrée sidebar

### Phase 3 : Multi-overlay & polish
11. [ ] Support multi-overlay (plusieurs fenêtres simultanées)
12. [ ] Presets de sites (SCMDB, VerseGuide, Finder, etc.)
13. [ ] Intégration system tray (toggle global)
14. [ ] Sauvegarde position après drag
15. [ ] Profils (ex: "Mining", "Trading" avec overlays différents)

---

## Dépendances Tauri
- API existantes : `WebviewWindow`, `set_always_on_top`, `set_opacity`

## Risques & Notes
- **Anti-triche** : Aucun risque. C'est une fenêtre OS standard, pas d'injection. Discord/Steam font pareil.
- **Performance** : L'iframe consomme de la RAM. Prévoir un bouton pour activer/désactiver chaque overlay.
- **Opacité** : `set_opacity()` sur la window Tauri (0.0 à 1.0)
- **Multi-écran** : Tauri gère nativement les positions multi-écran
- **Jeu en Fullscreen** : Fonctionne en mode **Borderless Windowed** (pas en Fullscreen Exclusif). Star Citizen tourne en Borderless par défaut → OK.
