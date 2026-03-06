import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Represents the metadata displayed in the custom image editor.
 */
export interface ImageDetailsViewModel {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  sizeText: string;
  width: number;
  height: number;
  megapixels: string;
  format: string;
  space: string;
  channels: number;
  hasAlpha: boolean;
  density?: number;
  dominantColorHex: string;
  dominantColorRgb: string;
}

/**
 * Represents one selectable ICO variant displayed in the gallery.
 */
export interface IcoVariantViewModel {
  id: string;
  label: string;
  width: number;
  height: number;
  imageSource: string;
}

/**
 * Builds the custom editor HTML combining image preview and metadata.
 *
 * @param webview Target webview instance.
 * @param imageUri Image URI to render.
 * @param details Extracted image details.
 * @param extensionUri Extension root URI.
 * @returns Complete HTML payload for the custom editor.
 */
/**
 * Builds the custom editor HTML combining image preview and metadata.
 *
 * @param webview Target webview instance.
 * @param imageSource Image URI to render.
 * @param details Extracted image details.
 * @param extensionUri Extension root URI.
 * @param options Options for rendering (e.g. toolbar position).
 * @returns Complete HTML payload for the custom editor.
 */
export function buildCustomEditorWebview(
  webview: vscode.Webview,
  imageSource: string,
  details: ImageDetailsViewModel,
  extensionUri: vscode.Uri,
  options?: {
    toolbarPosition?: string;
    icoVariants?: IcoVariantViewModel[];
    pipetteLoupeDiameter?: number;
    pipetteLoupeVirtualResolution?: number;
    pipetteLoupeZoomAtMinImageZoom?: number;
    pipetteLoupeZoomAtMaxImageZoom?: number;
  }
): string {
  const toolbarPosition = options?.toolbarPosition || 'top';
  const loupeDiameter = options?.pipetteLoupeDiameter ?? 96;
  const loupeVirtualResolution = options?.pipetteLoupeVirtualResolution ?? 25;
  const loupeZoomAtMinImageZoom = options?.pipetteLoupeZoomAtMinImageZoom ?? 6;
  const loupeZoomAtMaxImageZoom = options?.pipetteLoupeZoomAtMaxImageZoom ?? 1;
  const nonce = createNonce();
  const styleContent = loadWebviewStyleContent(extensionUri);
  const scriptContent = loadWebviewScriptContent(extensionUri);

  const rows = [
    ['Name', details.fileName],
    ['Format', details.format],
    ['Dimensions', `${details.width} × ${details.height}`],
    ['Megapixels', `${details.megapixels} MP`],
    ['Size', `${details.sizeText} (${details.sizeBytes} bytes)`],
    ['Color space', details.space],
    ['Channels', String(details.channels)],
    ['Alpha channel', details.hasAlpha ? 'Yes' : 'No'],
    ['DPI', details.density ? String(details.density) : 'N/A'],
    ['Dominant color', `${details.dominantColorHex} (${details.dominantColorRgb})`]
  ];

  const tableRows = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join('; ');

  // Extract file extension (with dot, lowercase)
  const fileExtension = details.fileName.includes('.')
    ? details.fileName.slice(details.fileName.lastIndexOf('.')).toLowerCase()
    : '';
  // Génère une classe CSS unique pour chaque extension, ex: badge-ext-png
  const extClass = fileExtension ? `badge-ext-${fileExtension.replace('.', '')}` : '';
  // Extension sans point et en majuscule pour affichage
  const extLabel = fileExtension ? fileExtension.replace('.', '').toUpperCase() : '';

  // Détermine la classe CSS selon la position de la toolbar
  const toolbarClass = `zoom-toolbar toolbar-pos-${toolbarPosition}`;
  const icoVariants = options?.icoVariants ?? [];
  const hasIcoGallery = icoVariants.length > 1;
  const initialIcoVariantLabel = hasIcoGallery ? icoVariants[0].label : '';
  const icoGalleryMarkup = hasIcoGallery
    ? `<div class="ico-gallery" aria-label="ICO variants gallery">${icoVariants.map((variant, index) => `
      <button
        type="button"
        class="ico-gallery-item${index === 0 ? ' is-active' : ''}"
        data-image-source="${escapeHtml(variant.imageSource)}"
        data-size-label="${escapeHtml(variant.label)}"
        title="${escapeHtml(variant.label)}"
        aria-label="Show ${escapeHtml(variant.label)} icon"
        aria-pressed="${index === 0 ? 'true' : 'false'}"
      >
        <img src="${escapeHtml(variant.imageSource)}" alt="${escapeHtml(variant.label)} thumbnail" />
        <span>${escapeHtml(variant.label)}</span>
      </button>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />
  <title>Image Details</title>
  <style>${styleContent}</style>
</head>
<body>
  <div class="layout" style="--dominant-color: ${escapeHtml(details.dominantColorHex)};">
    <section class="preview">
      <div class="${toolbarClass}" aria-label="Zoom controls">
        <button id="zoom-out" type="button" title="Zoom -" aria-label="Zoom -">
          <span class="icon" aria-hidden="true">−</span>
        </button>
        <button id="zoom-in" type="button" title="Zoom +" aria-label="Zoom +">
          <span class="icon" aria-hidden="true">＋</span>
        </button>
        <button id="zoom-reset" type="button" title="Zoom 100%" aria-label="Zoom 100%">
          <span class="icon" aria-hidden="true">◎</span>
        </button>
        <button id="zoom-fit" type="button" title="Fit to view" aria-label="Fit to view">
          <span class="icon" aria-hidden="true">⤢</span>
        </button>
        <button id="zoom-select" type="button" title="Zoom to selection" aria-label="Zoom to selection">
          <span class="icon" aria-hidden="true">▭</span>
        </button>
        <button id="pipette-tool" type="button" title="Color picker" aria-label="Color picker">
          <span class="icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle">
              <path d="M14.44 2.44a2.5 2.5 0 0 1 3.54 3.54l-1.13 1.13-3.54-3.54 1.13-1.13zm-2.2 2.2l3.54 3.54-9.19 9.19c-.2.2-.45.34-.72.4l-3.13.7a.5.5 0 0 1-.6-.6l.7-3.13c.06-.27.2-.52.4-.72l9.19-9.19z" fill="var(--vscode-icon-foreground)"/>
            </svg>
          </span>
        </button>
        <button id="info-toggle" type="button" title="Show/Hide info" aria-label="Show/Hide info">
          <span class="icon" aria-hidden="true">?</span>
        </button>
        <span id="zoom-label" class="zoom-label">Fit</span>
      </div>
      <aside id="info-overlay" class="info-overlay is-hidden" aria-label="Image information">
        <div id="info-overlay-handle" class="info-overlay-handle" title="Move">
          <span class="drag-icon" aria-hidden="true">⋮⋮</span>
          <span class="drag-title">Image info</span>
        </div>
        <div class="meta-row compact">
          <span><span class="color-chip"></span>${escapeHtml(details.dominantColorHex)}</span>
          <span class="badge ${extClass}">${extLabel}</span>
          <span class="badge">${details.width} × ${details.height}</span>
          ${hasIcoGallery ? `<span id="selected-ico-size" class="badge">Taille sélectionnée: ${escapeHtml(initialIcoVariantLabel)}</span>` : ''}
        </div>
        <div id="pipette-hover-info" class="pipette-hover-info is-hidden" aria-live="polite">
          <div class="pipette-hover-row">
            <span class="pipette-hover-label">Pixel</span>
            <span id="pipette-hover-position">—</span>
          </div>
          <div class="pipette-hover-row">
            <span class="pipette-hover-label">Color</span>
            <span id="pipette-hover-color">—</span>
            <span id="pipette-hover-swatch" class="pipette-hover-swatch" aria-hidden="true"></span>
          </div>
        </div>
        <table class="info-table">${tableRows}</table>
      </aside>
      <div class="preview-scroll">
        <div class="preview-body">
          <img id="preview-image" src="${imageSource}" alt="${escapeHtml(details.fileName)}" style="image-rendering: pixelated; image-rendering: crisp-edges; -ms-interpolation-mode: nearest-neighbor;" />
          <canvas id="pipette-canvas" style="display:none;"></canvas>
          <div id="pipette-color-result" style="display:none;position:absolute;z-index:10;background:#fff;padding:4px;border-radius:4px;border:1px solid #ccc;font-size:12px;"></div>
          <canvas id="pipette-zoom-loupe" width="64" height="64" data-loupe-diameter="${String(loupeDiameter)}" data-loupe-virtual-resolution="${String(loupeVirtualResolution)}" data-loupe-zoom-at-min-image-zoom="${String(loupeZoomAtMinImageZoom)}" data-loupe-zoom-at-max-image-zoom="${String(loupeZoomAtMaxImageZoom)}" style="display:none;position:fixed;pointer-events:none;z-index:20;filter:drop-shadow(0 2px 6px #0006);"></canvas>
        </div>
      </div>
      ${icoGalleryMarkup}
      <div id="zoom-selection-box" class="zoom-selection-box" aria-hidden="true"></div>
    </section>
  </div>
  <script nonce="${nonce}">${scriptContent}</script>
</body>
</html>`;
}

/**
 * Builds an error page HTML for the custom editor.
 *
 * @param message Error message to display.
 * @returns Complete HTML payload for error display.
 */
export function buildErrorWebview(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Image Details</title>
  <style>
    body {
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
  </style>
</head>
<body>
  <h1>Unable to load image</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`;
}

/**
 * Escapes an arbitrary string so it can be safely injected into HTML.
 *
 * @param value Raw string value.
 * @returns Escaped HTML-safe string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Creates a random nonce value for CSP script authorization.
 *
 * @returns Nonce string.
 */
function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    nonce += alphabet[randomIndex];
  }

  return nonce;
}

/**
 * Loads the webview JavaScript from the extension media folder.
 *
 * @param extensionUri Extension root URI.
 * @returns Script content safe for inline injection.
 */
function loadWebviewScriptContent(extensionUri: vscode.Uri): string {
  const scriptPath = path.join(extensionUri.fsPath, 'media', 'imageDetails.js');

  try {
    const script = fs.readFileSync(scriptPath, 'utf8');
    return script.replace(/<\/script>/gi, '<\\/script>');
  } catch {
    return '';
  }
}

/**
 * Loads the webview stylesheet from the extension media folder.
 *
 * @param extensionUri Extension root URI.
 * @returns Stylesheet content safe for inline injection.
 */
function loadWebviewStyleContent(extensionUri: vscode.Uri): string {
  const stylePath = path.join(extensionUri.fsPath, 'media', 'imageDetails.css');

  try {
    return fs.readFileSync(stylePath, 'utf8');
  } catch {
    return '';
  }
}
