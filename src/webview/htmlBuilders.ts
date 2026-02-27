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
 * Builds the custom editor HTML combining image preview and metadata.
 *
 * @param webview Target webview instance.
 * @param imageUri Image URI to render.
 * @param details Extracted image details.
 * @param extensionUri Extension root URI.
 * @returns Complete HTML payload for the custom editor.
 */
export function buildCustomEditorWebview(
  webview: vscode.Webview,
  imageSource: string,
  details: ImageDetailsViewModel,
  extensionUri: vscode.Uri
): string {
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
      <div class="zoom-toolbar" aria-label="Zoom controls">
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
        </div>
        <table class="info-table">${tableRows}</table>
      </aside>
      <div class="preview-scroll">
        <div class="preview-body">
          <img id="preview-image" src="${imageSource}" alt="${escapeHtml(details.fileName)}" />
        </div>
      </div>
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
