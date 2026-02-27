# ImageInspector

VS Code extension to inspect images directly in the editor.

## Main Features
- Display image metadata (dimensions, size, format, color space, alpha, dominant color)
- Quick preview in an integrated webview
- Advanced zoom (toolbar, selection, keyboard shortcuts)
- Generate test images via a Node.js script

## Installation
1. Clone the repository:
	```sh
	git clone <repo-url>
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
4. Open in VS Code and launch the extension in development mode (`F5`).

## Usage
1. Open a supported image (`png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `tif`, `tiff`, `avif`, `svg`, `heic`, `heif`).
2. The custom editor opens by default with the image on the left and details on the right.

Available command: **Image Inspector: Open with Details**.

## Zoom
- Toolbar buttons: `+`, `-`, `100%`, `Fit`
- Selection zoom: click the `▭` button then drag a region
- Mouse wheel + `Ctrl`: zoom in/out
- Keyboard shortcuts: `Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`
- `F` key: return to `Fit` mode

## Generate test images
A script is provided to generate test images in the `test-images/` folder:
```sh
node scripts/generate-test-images.mjs
```

## Project structure
- `src/extension.ts`: extension entry point
- `src/webview/`: webview logic (display, HTML builders)
- `media/`: static resources (JS, CSS)
- `assets/`: other resources
- `scripts/`: utility scripts (image generation)
- `test-images/`: test images

## Development
```sh
npm install
npm run compile
```
Then press `F5` to launch an Extension Development Host window.

## License
See LICENSE file.
