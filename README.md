# Image Inspector (VS Code Extension)

Displays the image and its key information in the same VS Code view:

- dimensions (width × height)
- file size
- format
- color space
- alpha channel presence
- dominant color

## Usage

1. Open an image (`png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `tif`, `tiff`, `avif`, `svg`, `heic`, `heif`).
2. The custom editor opens by default with the image on the left and details on the right.

Also available command: **Image Inspector: Open with Details**.

## Zoom

- Toolbar buttons: `+`, `-`, `100%`, `Fit`
- Selection zoom: click the `▭` button, then drag a region on the image
- Mouse wheel + `Ctrl`: zoom in/out
- Keyboard: `Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`
- `F` key: return to `Fit` mode

## Development

```bash
npm install
npm run compile
```

Then press `F5` to launch an Extension Development Host window.
