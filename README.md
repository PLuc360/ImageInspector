# Image Inspector (English)

Image Inspector is a VS Code extension that opens images in a dedicated custom editor to inspect visual content and metadata side by side.

Current version: 1.7.0

## Highlights

- Integrated image preview in a VS Code custom editor
- Key metadata: dimensions, file size, format, color space, channels, alpha, DPI, dominant color
- Advanced zoom workflow: toolbar, keyboard shortcuts, wheel zoom, fit mode, selection zoom
- Color picker tool with pixel loupe and live pixel info (position + color)
- Overview minimap with current viewport rectangle and click/drag recentering
- Before/after comparison mode with an interactive split divider
- Side-by-side comparison mode with visual difference detection overlays
- Advanced ICO support with internal variant gallery when available
- Automatic webview refresh when the source image file changes
- User customization options (toolbar position, accent color, loupe settings)
- Gallery view for browsing images in a folder

## Supported formats

Supported extensions:

- png
- jpg
- jpeg
- webp
- gif
- bmp
- tif
- tiff
- avif
- ico
- svg
- heic
- heif

Compatibility notes:

- tif/tiff/heic/heif files are converted to PNG for webview rendering.
- HEIC/HEIF decoding depends on native sharp support available on your environment.

## Installation

### From source

1. Clone the repository:

```sh
git clone https://github.com/PLuc360/ImageInspector.git
cd ImageInspector
```

2. Install dependencies:

```sh
npm install
```

3. Build the extension:

```sh
npm run compile
```

4. Press F5 in VS Code to start an Extension Development Host.

### From local VSIX package

The workspace also includes a local VSIX package (example: image-inspector-1.6.0.vsix) that can be installed directly from VS Code.

## Usage

1. Open a supported image from the VS Code Explorer.
2. The Image Inspector custom editor opens by default.
3. Use the toolbar to zoom, enable the color picker, toggle the info panel, or compare with another image.

Main command:

- Image Inspector: Open with Details

## Available commands

- Image Inspector: Open with Details
- Image Inspector: Zoom +
- Image Inspector: Zoom -
- Image Inspector: Zoom 100%
- Image Inspector: Zoom Fit
- Image Inspector: Set Comparison Image

## Keyboard shortcuts

Active when the Image Inspector custom editor is focused:

- Ctrl/Cmd + = or Numpad Add: zoom in
- Ctrl/Cmd + - or Numpad Subtract: zoom out
- Ctrl/Cmd + 0: reset zoom to 100%

Webview shortcut:

- F: return to fit mode

## Detailed features

### Zoom and navigation

- Incremental zoom with + and - controls
- Press-and-hold on + and - for continuous zoom
- Panning when zoom exceeds visible area
- Rectangle-based zoom selection
- Fit / Reset 100%

### Info panel

- Draggable metadata panel
- Local persistence for panel visibility and position
- Overview minimap of visible image area

### Color picker

- Reads pixel color under cursor
- Magnified loupe around pointer
- Live display of coordinates (x, y) and picked color

### Before/after comparison

- Pick a comparison image from the toolbar or dedicated command
- Interactive split slider
- Vertical/horizontal split orientation
- Dedicated side-by-side mode in the toolbar
- Automatic difference region detection with visual bounding boxes
- Difference navigation controls (previous/next, one region at a time)
- Difference overlay target control (left image, right image, both)
- Optional auto-center on selected difference
- Safety check: comparison requires matching width and height

### ICO handling

- ICO entry parsing support
- Variant gallery when ICO internal entries are PNG payloads
- Variant selection updates the main preview

## Configuration

Available user settings:

- imageInspector.toolbarPosition
  - Values: top, bottom, left, right
  - Default: top
- imageInspector.themeAccentColor
  - Format: #RRGGBB
  - Default: #00C86E
- imageInspector.pipetteLoupeDiameter
  - Default: 96
  - Min/Max: 48 / 256
- imageInspector.pipetteLoupeVirtualResolution
  - Default: 25
  - Min/Max: 5 / 101
- imageInspector.pipetteLoupeZoomAtMinImageZoom
  - Default: 6
- imageInspector.pipetteLoupeZoomAtMaxImageZoom
  - Default: 1

## Project architecture

- src/extension.ts
  - Extension activation
  - Custom editor and command registration
  - Image metadata extraction via sharp
  - Runtime preview conversion for specific formats
  - Bounded runtime caches (converted previews and ICO data)
- src/webview/htmlBuilders.ts
  - Webview HTML builders
- media/imageDetails.js
  - UI interactions (zoom, picker, comparison, minimap, overlay)
- media/imageDetails.css
  - Webview styles

## Development

Prerequisites:

- Node.js (version compatible with project dependencies)
- VS Code 1.90.0+

Scripts:

```sh
npm run compile
npm run watch
npm run lint
```

Recommended flow:

1. npm install
2. npm run compile
3. Press F5 in VS Code to start Extension Development Host

## Recent updates

Version 1.6.0 notably includes:

- side-by-side comparison mode
- visual difference detection overlays with one-at-a-time navigation
- difference overlay target selector (left/right/both)
- optional auto-center on selected difference
- improved comparison detection pipeline (nested-region filtering and nearby-region merge)
- improved fit and pan behavior in side-by-side mode for large landscape images

See CHANGELOG.md for full release notes.

## License

This project is distributed under the MIT License. See LICENSE.

---

# Image Inspector

Image Inspector est une extension VS Code qui ouvre les images dans un éditeur personnalisé pour inspecter visuellement les fichiers et leurs métadonnées.

Version actuelle: 1.7.0

## Points forts

- Aperçu image intégré dans un custom editor VS Code
- Métadonnées principales: dimensions, taille, format, espace colorimétrique, canaux, alpha, DPI, couleur dominante
- Zoom avancé: boutons, raccourcis clavier, molette, fit, zoom de sélection
- Outil pipette avec loupe pixel et informations en direct (coordonnées + couleur)
- Mini-carte (overview) avec rectangle de viewport et recentrage par clic/glisser
- Mode comparaison avant/après avec séparateur interactif
- Mode comparaison côte à côte avec détection visuelle des différences
- Support ICO avancé: galerie des variantes internes quand disponibles
- Rafraîchissement automatique du webview lors de la modification du fichier image
- Paramètres de personnalisation (position toolbar, couleur d'accent, réglages de loupe)
- Galerie de navigation pour les images d'un même dossier

## Formats supportés

Extensions prises en charge:

- png
- jpg
- jpeg
- webp
- gif
- bmp
- tif
- tiff
- avif
- ico
- svg
- heic
- heif

Notes de compatibilité:

- Les fichiers tif/tiff/heic/heif sont convertis en PNG pour l'aperçu webview.
- Le décodage HEIC/HEIF dépend des bibliothèques natives disponibles pour sharp selon l'environnement.

## Installation

### Depuis les sources

1. Cloner le dépôt:

```sh
git clone https://github.com/PLuc360/ImageInspector.git
cd ImageInspector
```

2. Installer les dépendances:

```sh
npm install
```

3. Compiler:

```sh
npm run compile
```

4. Lancer en mode développement dans VS Code avec F5.

### Depuis un package VSIX local

Le projet contient aussi un package VSIX local (exemple: image-inspector-1.6.0.vsix) qui peut être installé via VS Code.

## Utilisation

1. Ouvrir une image supportée depuis l'explorateur VS Code.
2. L'éditeur personnalisé Image Inspector s'ouvre (priorité par défaut).
3. Utiliser la toolbar pour zoomer, activer la pipette, afficher/masquer le panneau info, ou comparer deux images.

Commande principale:

- Image Inspector: Open with Details

## Commandes disponibles

- Image Inspector: Open with Details
- Image Inspector: Zoom +
- Image Inspector: Zoom -
- Image Inspector: Zoom 100%
- Image Inspector: Zoom Fit
- Image Inspector: Set Comparison Image

## Raccourcis clavier

Actifs quand le custom editor Image Inspector est focus:

- Ctrl/Cmd + = ou Numpad Add: zoom avant
- Ctrl/Cmd + - ou Numpad Subtract: zoom arrière
- Ctrl/Cmd + 0: zoom 100%

Raccourcis dans le webview:

- F: retour en mode Fit

## Fonctionnalités détaillées

### Zoom et navigation

- Zoom progressif avec boutons + et -
- Press-and-hold sur + et - pour zoom continu
- Pan (déplacement) dans l'image quand le zoom dépasse la zone visible
- Zoom de sélection via rectangle
- Fit / Reset 100%

### Panneau d'information

- Panneau draggable affichant les métadonnées
- Mémorisation locale de la visibilité et de la position du panneau
- Aperçu mini-carte de la zone visible (overview map)

### Pipette

- Lecture couleur pixel sous le curseur
- Loupe zoomée autour du curseur
- Affichage en direct de la position (x, y) et de la valeur couleur

### Comparaison avant/après

- Sélection d'une image de comparaison depuis la toolbar ou la commande dédiée
- Slider de séparation interactif
- Orientation verticale ou horizontale
- Mode côte à côte dédié dans la toolbar
- Détection automatique des zones de différences avec encadrement visuel
- Navigation des différences (précédente/suivante, une zone à la fois)
- Cible d'affichage des différences (image gauche, image droite, les deux)
- Option d'auto-centrage sur la différence sélectionnée
- Vérification de sécurité: dimensions identiques requises entre image principale et image de comparaison

### Gestion ICO

- Détection des entrées ICO
- Galerie des variantes quand les entrées internes sont en PNG
- Sélection de variante avec mise à jour de l'aperçu

## Configuration

Paramètres utilisateur disponibles:

- imageInspector.toolbarPosition
  - Valeurs: top, bottom, left, right
  - Défaut: top
- imageInspector.themeAccentColor
  - Format: #RRGGBB
  - Défaut: #00C86E
- imageInspector.pipetteLoupeDiameter
  - Défaut: 96
  - Min/Max: 48 / 256
- imageInspector.pipetteLoupeVirtualResolution
  - Défaut: 25
  - Min/Max: 5 / 101
- imageInspector.pipetteLoupeZoomAtMinImageZoom
  - Défaut: 6
- imageInspector.pipetteLoupeZoomAtMaxImageZoom
  - Défaut: 1

## Architecture du projet

- src/extension.ts
  - Activation de l'extension
  - Enregistrement du custom editor et des commandes
  - Lecture des métadonnées image via sharp
  - Conversion d'aperçu pour certains formats
  - Mise en cache bornée (aperçus convertis et données ICO)
- src/webview/htmlBuilders.ts
  - Construction HTML du webview
- media/imageDetails.js
  - Interactions UI (zoom, pipette, comparaison, minimap, overlay)
- media/imageDetails.css
  - Styles du webview

## Développement

Prérequis:

- Node.js (version compatible avec les dépendances du projet)
- VS Code 1.90.0 ou plus

Scripts:

```sh
npm run compile
npm run watch
npm run lint
```

Cycle recommandé:

1. npm install
2. npm run compile
3. F5 dans VS Code pour ouvrir un Extension Development Host

## Historique récent

La version 1.6.0 apporte notamment:

- mode comparaison côte à côte
- détection visuelle des différences avec navigation zone par zone
- sélecteur de cible d'overlay des différences (gauche/droite/les deux)
- auto-centrage optionnel sur la différence sélectionnée
- amélioration de la détection (filtrage des zones imbriquées et fusion des zones proches)
- amélioration du fit/pan en comparaison côte à côte sur images larges

Consulter CHANGELOG.md pour le détail complet.

## Licence

Ce projet est distribué sous licence MIT. Voir LICENSE.
