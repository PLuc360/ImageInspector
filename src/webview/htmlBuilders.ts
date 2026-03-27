/**
 * Formats a file size in bytes to a human-readable string with dynamic unit.
 * @param size File size in bytes.
 * @returns Formatted string (e.g. '512 bytes', '1.2 KB', '3.4 MB').
 */
function formatFileSize(size: number | undefined): string {
  if (typeof size !== 'number' || isNaN(size) || size < 0) return 'N/A';
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
import * as path from 'node:path';
import * as vscode from 'vscode';

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
  dominantColorHex: string;
  dominantColorRgb: string;
}

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
    themeAccentRgb?: string;
    icoVariants?: IcoVariantViewModel[];
    comparisonImageSource?: string;
    comparisonImageLabel?: string;
    pipetteLoupeDiameter?: number;
    pipetteLoupeVirtualResolution?: number;
    pipetteLoupeZoomAtMinImageZoom?: number;
    pipetteLoupeZoomAtMaxImageZoom?: number;
  }
): string {
  const toolbarPosition = options?.toolbarPosition || 'top';
  const themeAccentRgb = options?.themeAccentRgb ?? '0,200,110';
  const loupeDiameter = options?.pipetteLoupeDiameter ?? 96;
  const loupeVirtualResolution = options?.pipetteLoupeVirtualResolution ?? 25;
  const loupeZoomAtMinImageZoom = options?.pipetteLoupeZoomAtMinImageZoom ?? 6;
  const loupeZoomAtMaxImageZoom = options?.pipetteLoupeZoomAtMaxImageZoom ?? 1;
  const comparisonImageSource = options?.comparisonImageSource ?? '';
  const comparisonImageLabel = options?.comparisonImageLabel ?? '';
  const hasComparisonImage = comparisonImageSource.length > 0;
  const mediaRootUri = vscode.Uri.joinPath(extensionUri, 'media');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'imageDetails.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'imageDetails.js'));

  const rows = [
     ['Name', details.fileName],
     ['Type', details.format],
     ['Dimensions', details.width && details.height ? `${details.width} × ${details.height}` : 'N/A'],
     ['Megapixels', details.width && details.height ? `${details.megapixels} MP` : 'N/A'],
     ['Size', details.sizeBytes ? `${details.sizeText} (${details.sizeBytes} bytes)` : 'N/A'],
     ['Color space', details.space],
     ['Channels', String(details.channels)],
     ['Alpha channel', details.hasAlpha ? 'Yes' : 'No'],
     ['DPI', details.density ? String(details.density) : 'N/A']
  ];

  const tableRows = `${rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}<tr><th>Dominant color</th><td id="dominant-color-table">${escapeHtml(details.dominantColorHex)} (${escapeHtml(details.dominantColorRgb)})</td></tr>`;

  // Génère un nonce sécurisé pour les scripts
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`
  ].join('; ');

  // Extract the file extension with a leading dot (lowercase).
  const fileExtension = details.fileName.includes('.')
    ? details.fileName.slice(details.fileName.lastIndexOf('.')).toLowerCase()
    : '';
  // Build a CSS class per extension, for example: badge-ext-png.
  const extClass = fileExtension ? `badge-ext-${fileExtension.replace('.', '')}` : '';
  // User-facing extension label without dot, uppercased.
  const extLabel = fileExtension ? fileExtension.replace('.', '').toUpperCase() : '';

  // Resolve toolbar placement class.
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
        data-dominant-color-hex="${escapeHtml(variant.dominantColorHex)}"
        data-dominant-color-rgb="${escapeHtml(variant.dominantColorRgb)}"
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
  <link rel="stylesheet" href="${escapeHtml(styleUri.toString())}" />
  <link rel="stylesheet" href="${escapeHtml(webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'badge.css')).toString())}" />
  <script src="${escapeHtml(webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'badge.js')).toString())}" nonce="${nonce}"></script>
</head>
<body>
  <div
    class="layout"
    style="--dominant-color: ${escapeHtml(details.dominantColorHex)}; --toolbar-green-accent-rgb: ${escapeHtml(themeAccentRgb)};"
    data-loupe-diameter="${String(loupeDiameter)}"
    data-loupe-virtual-resolution="${String(loupeVirtualResolution)}"
    data-loupe-zoom-at-min-image-zoom="${String(loupeZoomAtMinImageZoom)}"
    data-loupe-zoom-at-max-image-zoom="${String(loupeZoomAtMaxImageZoom)}"
  >
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
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle">
              <path d="M14.44 2.44a2.5 2.5 0 0 1 3.54 3.54l-1.13 1.13-3.54-3.54 1.13-1.13zm-2.2 2.2l3.54 3.54-9.19 9.19c-.2.2-.45.34-.72.4l-3.13.7a.5.5 0 0 1-.6-.6l.7-3.13c.06-.27.2-.52.4-.72l9.19-9.19z" fill="var(--vscode-icon-foreground)"/>
            </svg>
          </span>
        </button>
        <button id="info-toggle" type="button" title="Show/Hide info" aria-label="Show/Hide info">
          <span class="icon" aria-hidden="true">?</span>
        </button>
        <button id="compare-tool" type="button" title="Before/after compare" aria-label="Before/after compare" aria-pressed="false">
          <span class="icon" aria-hidden="true">⇆</span>
        </button>
        <button id="compare-side-by-side" type="button" title="Side-by-side compare" aria-label="Side-by-side compare" aria-pressed="false">
          <span class="icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle">
              <rect x="2.5" y="4" width="6.5" height="11" rx="1.4" stroke="currentColor" stroke-width="1.4"/>
              <rect x="11" y="4" width="6.5" height="11" rx="1.4" stroke="currentColor" stroke-width="1.4"/>
              <path d="M10 5.2v8.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1.8 1.8"/>
              <path d="M9.2 2.7l.65 1.35 1.5.18-1.1 1.02.3 1.47-1.35-.72-1.35.72.3-1.47-1.1-1.02 1.5-.18.65-1.35z" fill="currentColor"/>
            </svg>
          </span>
        </button>
        <span id="zoom-label" class="zoom-label">Fit</span>
      </div>
      <div id="compare-controls" class="compare-controls${hasComparisonImage ? '' : ' is-hidden'}" aria-label="Comparison controls">
        <button id="compare-pick" type="button" class="compare-pick-button" aria-label="Choose comparison image">
          <span class="icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle">
              <path d="M3.25 5.75a1.5 1.5 0 0 1 1.5-1.5h4.1l1.2 1.5h5.2a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5v-8.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
              <path d="M10 8.1v4M8 10.1h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </span>
        </button>
        <button id="compare-orientation" type="button" class="compare-orientation-button" aria-label="Switch to horizontal split" data-orientation="vertical">
          <span class="icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle">
              <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M10 4v12" stroke="currentColor" stroke-width="1.4"/>
            </svg>
          </span>
        </button>
        <input id="compare-slider" type="range" min="0" max="100" value="50" step="1" aria-label="Comparison split" />
        <button id="compare-diff-prev" type="button" class="compare-diff-nav compare-diff-prev" aria-label="Previous difference" title="Previous difference">
          <span class="icon" aria-hidden="true">◀</span>
        </button>
        <span id="compare-diff-index" class="compare-diff-nav compare-diff-index" aria-live="polite">0/0</span>
        <button id="compare-diff-next" type="button" class="compare-diff-nav compare-diff-next" aria-label="Next difference" title="Next difference">
          <span class="icon" aria-hidden="true">▶</span>
        </button>
        <button id="compare-diff-target" type="button" class="compare-diff-nav compare-diff-target" aria-label="Show differences on left image" title="Show differences on left image" data-target="left">
          <span class="icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle">
              <rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2"/>
              <rect x="10" y="3.5" width="7.5" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>
        </button>
        <button id="compare-diff-autocenter" type="button" class="compare-diff-nav compare-diff-autocenter" aria-label="Auto-center selected difference" title="Auto-center selected difference" aria-pressed="false">
          <span class="icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle">
              <circle cx="10" cy="10" r="5.2" stroke="currentColor" stroke-width="1.2"/>
              <circle cx="10" cy="10" r="1.6" fill="currentColor"/>
              <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </span>
        </button>
        <span id="compare-image-label" class="compare-image-label">${hasComparisonImage ? escapeHtml(comparisonImageLabel) : 'No comparison image'}</span>
      </div>
      <canvas id="compare-diff-overlay" class="compare-diff-overlay is-hidden" aria-hidden="true"></canvas>
      <canvas id="compare-diff-overlay-secondary" class="compare-diff-overlay is-hidden" aria-hidden="true"></canvas>
      <aside id="info-overlay" class="info-overlay is-hidden" aria-label="Image information">
        <div id="info-overlay-handle" class="info-overlay-handle" title="Move">
          <span class="drag-icon" aria-hidden="true">⋮⋮</span>
          <span class="drag-title">Image info</span>
        </div>
        <div class="meta-row compact">
          <span><span class="color-chip"></span><span id="dominant-color-meta">${escapeHtml(details.dominantColorHex)}</span></span>
          <span class="badge ${extClass}">${extLabel}</span>
          <span class="badge">${details.width} × ${details.height}</span>
          ${hasIcoGallery ? `<span id="selected-ico-size" class="badge">Selected size: ${escapeHtml(initialIcoVariantLabel)}</span>` : ''}
        </div>
        <div class="overview-map" aria-label="Image overview">
          <img id="overview-map-image" src="${imageSource}" alt="Image overview thumbnail" />
          <div id="overview-map-viewport" class="overview-map-viewport" aria-hidden="true"></div>
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
          <img id="preview-image" src="${imageSource}" alt="${escapeHtml(details.fileName)}" class="img-pixelated" />
          <img id="compare-image" class="compare-image${hasComparisonImage ? '' : ' is-hidden'} img-pixelated" src="${hasComparisonImage ? escapeHtml(comparisonImageSource) : ''}" alt="Comparison image" />
          <div id="compare-divider" class="compare-divider${hasComparisonImage ? '' : ' is-hidden'}" aria-hidden="true"></div>
          <canvas id="pipette-canvas" class="canvas-hidden"></canvas>
          <div id="pipette-color-result" class="pipette-color-result"></div>
          <canvas id="pipette-zoom-loupe" width="64" height="64" class="pipette-zoom-loupe"></canvas>
        </div>
      </div>
      ${icoGalleryMarkup}
      <div id="zoom-selection-box" class="zoom-selection-box" aria-hidden="true"></div>
    </section>
  </div>
  <script src="${escapeHtml(scriptUri.toString())}" nonce="${nonce}"></script>
</body>
</html>`;
}

/**
 * Builds the image gallery HTML for a folder.
 *
 * @param webview Target webview instance.
 * @param folderPath Absolute path to the scanned folder.
 * @param imageFiles Absolute paths of images found directly in the folder.
 * @param extensionUri Extension root URI.
 * @returns Complete HTML payload for the gallery webview.
 */
export function buildFolderGalleryWebview(
  webview: vscode.Webview,
  folderPath: string,
  imageFiles: Array<{ filePath: string; name: string; type: string; size: number; width: number; height: number; dominantColorHex: string; dominantColorRgb: string }>,
  extensionUri: vscode.Uri
): string {
  const mediaRootUri = vscode.Uri.joinPath(extensionUri, 'media');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'imageGallery.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'imageGallery.js'));

  const folderName = path.basename(folderPath);
  const imageCount = imageFiles.length;
  const countLabel = imageCount === 1 ? '1 image' : `${String(imageCount)} images`;

  // On ne génère plus les miniatures côté HTML initial : la grille est vide, le JS s'en charge après chargement binaire
  const contentBody = imageFiles.length > 0
    ? `<div class="gallery-grid"></div>`
    : `<div class="gallery-empty"><p>No images found in this folder.</p></div>`;

  // Génère un nonce sécurisé pour les scripts
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`
  ].join('; ');

  const badgeCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'badge.css')).toString();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />
  <title>Gallery \u2013 ${escapeHtml(folderName)}</title>
  <link rel="stylesheet" href="${escapeHtml(styleUri.toString())}" />
  <link rel="stylesheet" href="${escapeHtml(badgeCssUri)}" />
</head>
<body data-badge-css-uri="${escapeHtml(badgeCssUri)}">
  ${contentBody}
  <script src="${escapeHtml(scriptUri.toString())}" nonce="${nonce}"></script>
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

