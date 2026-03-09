import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import sharp from 'sharp';

import {
  buildCustomEditorWebview,
  buildErrorWebview,
  type IcoVariantViewModel,
  type ImageDetailsViewModel
} from './webview';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.ico', '.svg', '.heic', '.heif'];
const SUPPORTED_IMAGE_FILTER_EXTENSIONS = SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.replace('.', ''));

type IcoImageEntry = {
  width: number;
  height: number;
  bitCount: number;
  bytesInResource: number;
  imageOffset: number;
  isPng: boolean;
};

type IcoSource = string | Buffer;

type ZoomMessage = {
  type: 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'zoom-fit';
};

const MAX_CONVERTED_PREVIEW_CACHE_ENTRIES = 12;
const MAX_ICO_CACHE_ENTRIES = 24;
const DEFAULT_THEME_ACCENT_HEX = '#00C86E';

const convertedPreviewCache = new Map<string, string>();
const icoEntriesCache = new Map<string, IcoImageEntry[]>();
const icoGalleryCache = new Map<string, IcoVariantViewModel[]>();

/**
 * Builds a stable cache key for a file version.
 *
 * @param filePath Absolute file path.
 * @param size File size in bytes.
 * @param mtimeMs Last modified time in milliseconds.
 * @returns Cache key identifying one file version.
 */
function buildFileVersionKey(filePath: string, size: number, mtimeMs: number): string {
  return `${filePath}::${String(size)}::${String(Math.trunc(mtimeMs))}`;
}

/**
 * Resolves a cache key for the current version of a file.
 *
 * @param filePath Absolute file path.
 * @returns Cache key based on file size and mtime.
 */
async function getFileVersionKey(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return buildFileVersionKey(filePath, stats.size, stats.mtimeMs);
}

/**
 * Gets and touches a cache entry to keep it hot (LRU behavior).
 *
 * @param cache Cache map.
 * @param key Cache key.
 * @returns Cached value when present.
 */
function getCachedValue<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Inserts a value in a bounded cache and evicts oldest entries.
 *
 * @param cache Cache map.
 * @param key Cache key.
 * @param value Cached value.
 * @param maxEntries Maximum number of entries to keep.
 */
function setBoundedCachedValue<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }

    cache.delete(oldestKey);
  }
}

/**
 * Represents a readonly image document handled by the custom editor.
 */
class ImageCustomDocument implements vscode.CustomDocument {
  /**
   * Creates a custom image document.
   *
   * @param uri Document URI.
   */
  constructor(public readonly uri: vscode.Uri) {}

  /**
   * Disposes document resources.
   */
  dispose(): void {
    return;
  }
}

/**
 * Provides a readonly custom editor to render image preview and metadata.
 */
class ImageDetailsCustomEditorProvider implements vscode.CustomReadonlyEditorProvider<ImageCustomDocument> {
  static readonly viewType = 'imageInspector.previewEditor';
  private activePanel: vscode.WebviewPanel | undefined;
  private activeDocument: ImageCustomDocument | undefined;
  private readonly refreshDebounceTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Builds a stable key used to debounce refreshes per panel/document pair.
   *
   * @param document Document currently rendered.
   * @param webviewPanel Associated webview panel.
   * @returns Unique key for refresh timer tracking.
   */
  private getRefreshTimerKey(document: ImageCustomDocument, webviewPanel: vscode.WebviewPanel): string {
    return `${webviewPanel.viewType}${document.uri.toString()}`;
  }

  /**
   * Creates a provider instance.
   *
   * @param context Extension context used for subscription lifecycle.
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Opens the document associated with the custom editor.
   *
   * @param uri Resource URI.
   * @returns A custom document wrapper.
   */
  openCustomDocument(uri: vscode.Uri): ImageCustomDocument {
    return new ImageCustomDocument(uri);
  }

  /**
   * Resolves the custom editor webview content for a document.
   *
   * @param document Custom document instance.
   * @param webviewPanel Target webview panel.
   */
  async resolveCustomEditor(document: ImageCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    this.activePanel = webviewPanel;
    this.activeDocument = document;
    const fileWatcher = this.createDocumentFileWatcher(document, webviewPanel);

    webviewPanel.onDidDispose(() => {
      if (this.activePanel === webviewPanel) {
        this.activePanel = undefined;
        this.activeDocument = undefined;
      }

      const timerKey = this.getRefreshTimerKey(document, webviewPanel);
      const refreshTimer = this.refreshDebounceTimers.get(timerKey);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        this.refreshDebounceTimers.delete(timerKey);
      }

      fileWatcher.dispose();
    }, undefined, this.context.subscriptions);

    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activePanel = event.webviewPanel;
        this.activeDocument = document;
      }
    }, undefined, this.context.subscriptions);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.file(path.dirname(document.uri.fsPath))
      ]
    };

    await this.renderDocument(document, webviewPanel);
  }

  /**
   * Renders the webview for a specific image document.
   *
   * @param document Custom document instance.
   * @param webviewPanel Target webview panel.
   */
  private async renderDocument(document: ImageCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const cacheBuster = Date.now();

    try {
      const details = await getImageDetails(document.uri.fsPath);
      let imageSource = await getWebviewImageSource(document.uri.fsPath, document.uri, webviewPanel.webview, cacheBuster);
      const extension = path.extname(document.uri.fsPath).toLowerCase();
      const icoVariants = extension === '.ico' ? await getIcoGalleryItems(document.uri.fsPath) : [];

      if (icoVariants.length > 0) {
        imageSource = getDefaultIcoVariantSource(icoVariants);
      }

      webviewPanel.title = details.fileName;
      const imageInspectorConfig = vscode.workspace.getConfiguration('imageInspector');
      const toolbarPosition = imageInspectorConfig.get<string>('toolbarPosition', 'top');
      const themeAccentColor = imageInspectorConfig.get<string>('themeAccentColor', DEFAULT_THEME_ACCENT_HEX);
      const themeAccentRgb = resolveThemeAccentRgb(themeAccentColor);
      const pipetteLoupeDiameter = imageInspectorConfig.get<number>('pipetteLoupeDiameter', 96);
      const pipetteLoupeVirtualResolution = imageInspectorConfig.get<number>('pipetteLoupeVirtualResolution', 25);
      const pipetteLoupeZoomAtMinImageZoom = imageInspectorConfig.get<number>('pipetteLoupeZoomAtMinImageZoom', 6);
      const pipetteLoupeZoomAtMaxImageZoom = imageInspectorConfig.get<number>('pipetteLoupeZoomAtMaxImageZoom', 1);
      webviewPanel.webview.html = buildCustomEditorWebview(
        webviewPanel.webview,
        imageSource,
        details,
        this.context.extensionUri,
        {
          toolbarPosition,
          themeAccentRgb,
          icoVariants,
          pipetteLoupeDiameter,
          pipetteLoupeVirtualResolution,
          pipetteLoupeZoomAtMinImageZoom,
          pipetteLoupeZoomAtMaxImageZoom
        }
      );
    } catch (error) {
      const message = getImageLoadErrorMessage(document.uri.fsPath, error);
      webviewPanel.webview.html = buildErrorWebview(message);
    }
  }

  /**
   * Creates a file watcher to refresh a webview when its image changes externally.
   *
   * @param document Custom document being displayed.
   * @param webviewPanel Associated webview panel.
   * @returns Disposable watcher.
   */
  private createDocumentFileWatcher(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): vscode.Disposable {
    const fileName = path.basename(document.uri.fsPath);
    const parentFolder = path.dirname(document.uri.fsPath);
    const filePattern = new vscode.RelativePattern(parentFolder, fileName);
    const watcher = vscode.workspace.createFileSystemWatcher(filePattern);

    const scheduleRefresh = () => {
      const timerKey = this.getRefreshTimerKey(document, webviewPanel);
      const existingTimer = this.refreshDebounceTimers.get(timerKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const refreshTimer = setTimeout(() => {
        this.refreshDebounceTimers.delete(timerKey);
        void this.renderDocument(document, webviewPanel);
      }, 150);

      this.refreshDebounceTimers.set(timerKey, refreshTimer);
    };

    watcher.onDidChange(scheduleRefresh, undefined, this.context.subscriptions);
    watcher.onDidCreate(scheduleRefresh, undefined, this.context.subscriptions);
    watcher.onDidDelete(scheduleRefresh, undefined, this.context.subscriptions);

    return watcher;
  }

  /**
   * Sends a zoom action to the currently active custom editor panel.
   *
   * @param message Zoom message payload.
   */
  async sendZoomMessage(message: ZoomMessage): Promise<void> {
    if (!this.activePanel) {
      return;
    }

    await this.activePanel.webview.postMessage(message);
  }

  /**
   * Re-renders the active custom editor panel after configuration updates.
   */
  async refreshActivePanelFromConfiguration(): Promise<void> {
    if (!this.activePanel || !this.activeDocument) {
      return;
    }

    await this.renderDocument(this.activeDocument, this.activePanel);
  }
}

/**
 * Activates the extension and registers commands and providers.
 *
 * @param context Extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ImageDetailsCustomEditorProvider(context);

  const providerDisposable = vscode.window.registerCustomEditorProvider(
    ImageDetailsCustomEditorProvider.viewType,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  const zoomInDisposable = vscode.commands.registerCommand('imageInspector.zoomIn', async () => {
    await provider.sendZoomMessage({ type: 'zoom-in' });
  });

  const zoomOutDisposable = vscode.commands.registerCommand('imageInspector.zoomOut', async () => {
    await provider.sendZoomMessage({ type: 'zoom-out' });
  });

  const zoomResetDisposable = vscode.commands.registerCommand('imageInspector.zoomReset', async () => {
    await provider.sendZoomMessage({ type: 'zoom-reset' });
  });

  const zoomFitDisposable = vscode.commands.registerCommand('imageInspector.zoomFit', async () => {
    await provider.sendZoomMessage({ type: 'zoom-fit' });
  });

  const showImageDetailsDisposable = vscode.commands.registerCommand(
    'imageInspector.showImageDetails',
    async (resource?: vscode.Uri) => {
      const imageUri = await resolveImageUri(resource);
      if (!imageUri) {
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.openWith',
        imageUri,
        ImageDetailsCustomEditorProvider.viewType
      );
    }
  );

  const configurationChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('imageInspector')) {
      return;
    }

    void provider.refreshActivePanelFromConfiguration();
  });

  context.subscriptions.push(
    providerDisposable,
    showImageDetailsDisposable,
    zoomInDisposable,
    zoomOutDisposable,
    zoomResetDisposable,
    zoomFitDisposable,
    configurationChangeDisposable
  );
}

/**
 * Resolves a target image URI from command input, current editor, or picker.
 *
 * @param resource Optional URI provided by command invocation.
 * @returns Resolved image URI or undefined when selection is canceled.
 */
async function resolveImageUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resource && isSupportedImage(resource.fsPath)) {
    return resource;
  }

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri && editorUri.scheme === 'file' && isSupportedImage(editorUri.fsPath)) {
    return editorUri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Analyze image',
    filters: {
      Images: SUPPORTED_IMAGE_FILTER_EXTENSIONS
    }
  });

  return selected?.[0];
}

/**
 * Checks whether a file path uses a supported image extension.
 *
 * @param filePath File system path.
 * @returns True when the file extension is supported.
 */
function isSupportedImage(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(extension);
}

/**
 * Builds a user-friendly image loading error message.
 *
 * @param filePath Absolute image path.
 * @param error Caught error object.
 * @returns Human-readable error message.
 */
function getImageLoadErrorMessage(filePath: string, error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const extension = path.extname(filePath).toLowerCase();
  const isHeifFamily = extension === '.heic' || extension === '.heif';

  if (!isHeifFamily) {
    return rawMessage;
  }

  return [
    'Unable to decode this HEIC/HEIF image in this environment.',
    'HEIC/HEIF support depends on native libraries available to sharp.',
    `Technical detail: ${rawMessage}`
  ].join(' ');
}

/**
 * Extracts metadata and dominant color information from an image.
 *
 * @param filePath Absolute file system path.
 * @returns Consolidated image details.
 */
async function getImageDetails(filePath: string): Promise<ImageDetailsViewModel> {
  const stats = await fs.stat(filePath);

  try {
    const [metadata, imageStats] = await Promise.all([
      sharp(filePath).metadata(),
      sharp(filePath).stats()
    ]);

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const dominant = imageStats.dominant;
    const dominantColorHex = rgbToHex(dominant.r, dominant.g, dominant.b);
    const dominantColorRgb = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;

    return {
      fileName: path.basename(filePath),
      absolutePath: filePath,
      sizeBytes: stats.size,
      sizeText: formatBytes(stats.size),
      width,
      height,
      megapixels: ((width * height) / 1_000_000).toFixed(2),
      format: metadata.format?.toUpperCase() ?? 'Unknown',
      space: metadata.space ?? 'Unknown',
      channels: metadata.channels ?? 0,
      hasAlpha: Boolean(metadata.hasAlpha),
      density: metadata.density,
      dominantColorHex,
      dominantColorRgb
    };
  } catch (error) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.ico') {
      throw error;
    }

    const icoEntry = await getIcoPrimaryEntry(filePath);
    const width = icoEntry?.width ?? 0;
    const height = icoEntry?.height ?? 0;
    const estimatedChannels = Math.max(1, Math.ceil((icoEntry?.bitCount ?? 0) / 8));

    return {
      fileName: path.basename(filePath),
      absolutePath: filePath,
      sizeBytes: stats.size,
      sizeText: formatBytes(stats.size),
      width,
      height,
      megapixels: ((width * height) / 1_000_000).toFixed(2),
      format: 'ICO',
      space: 'Unknown',
      channels: estimatedChannels,
      hasAlpha: (icoEntry?.bitCount ?? 0) >= 32,
      density: undefined,
      dominantColorHex: '#808080',
      dominantColorRgb: 'rgb(128, 128, 128)'
    };
  }
}

/**
 * Reads an ICO header and returns the most relevant icon entry.
 *
 * @param filePath Absolute ICO file path.
 * @returns Largest icon entry when available.
 */
async function getIcoPrimaryEntry(filePath: string): Promise<IcoImageEntry | undefined> {
  const entries = await parseIcoEntries(filePath);

  if (entries.length === 0) {
    return undefined;
  }

  return entries.slice().sort((entryA, entryB) => {
    const areaDifference = entryB.width * entryB.height - entryA.width * entryA.height;
    if (areaDifference !== 0) {
      return areaDifference;
    }

    return entryB.bitCount - entryA.bitCount;
  })[0];
}

/**
 * Parses ICO directory entries from a file.
 *
 * @param source Absolute ICO file path or preloaded ICO buffer.
 * @returns Parsed icon entries in file order.
 */
async function parseIcoEntries(source: IcoSource): Promise<IcoImageEntry[]> {
  if (typeof source === 'string') {
    const cacheKey = await getFileVersionKey(source);
    const cachedEntries = getCachedValue(icoEntriesCache, cacheKey);
    if (cachedEntries) {
      return cachedEntries;
    }

    const buffer = await fs.readFile(source);
    const parsedEntries = await parseIcoEntries(buffer);
    setBoundedCachedValue(icoEntriesCache, cacheKey, parsedEntries, MAX_ICO_CACHE_ENTRIES);
    return parsedEntries;
  }

  const buffer = source;

  if (buffer.length < 6) {
    return [];
  }

  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);

  if (reserved !== 0 || type !== 1 || count === 0) {
    return [];
  }

  const entries: IcoImageEntry[] = [];
  const directoryOffset = 6;
  const entryLength = 16;

  for (let index = 0; index < count; index += 1) {
    const entryOffset = directoryOffset + index * entryLength;
    if (entryOffset + entryLength > buffer.length) {
      break;
    }

    const widthByte = buffer.readUInt8(entryOffset);
    const heightByte = buffer.readUInt8(entryOffset + 1);
    const bitCount = buffer.readUInt16LE(entryOffset + 6);
    const bytesInResource = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);

    const imageEndOffset = imageOffset + bytesInResource;
    const imageBuffer = imageOffset < buffer.length && imageEndOffset <= buffer.length
      ? buffer.subarray(imageOffset, imageEndOffset)
      : Buffer.alloc(0);

    entries.push({
      width: widthByte === 0 ? 256 : widthByte,
      height: heightByte === 0 ? 256 : heightByte,
      bitCount,
      bytesInResource,
      imageOffset,
      isPng: isPngBuffer(imageBuffer)
    });
  }

  return entries;
}

/**
 * Builds gallery variants for ICO files when entries contain PNG payloads.
 *
 * @param filePath Absolute ICO file path.
 * @returns Clickable icon variants for webview display.
 */
async function getIcoGalleryItems(filePath: string): Promise<IcoVariantViewModel[]> {
  const cacheKey = await getFileVersionKey(filePath);
  const cachedGalleryItems = getCachedValue(icoGalleryCache, cacheKey);
  if (cachedGalleryItems) {
    return cachedGalleryItems;
  }

  const buffer = await fs.readFile(filePath);
  const entries = await parseIcoEntries(buffer);

  const variants = entries
    .map((entry, index) => {
      const imageEndOffset = entry.imageOffset + entry.bytesInResource;
      if (!entry.isPng || entry.imageOffset >= buffer.length || imageEndOffset > buffer.length) {
        return undefined;
      }

      const imageBuffer = buffer.subarray(entry.imageOffset, imageEndOffset);
      const label = `${entry.width}x${entry.height}`;

      return {
        id: `ico-variant-${String(index + 1)}`,
        label,
        width: entry.width,
        height: entry.height,
        imageSource: toPngDataUri(imageBuffer)
      } satisfies IcoVariantViewModel;
    })
    .filter((variant): variant is IcoVariantViewModel => Boolean(variant));

  setBoundedCachedValue(icoGalleryCache, cacheKey, variants, MAX_ICO_CACHE_ENTRIES);
  return variants;
}

/**
 * Detects whether a buffer starts with a PNG signature.
 *
 * @param buffer Binary payload to inspect.
 * @returns True when buffer contains a PNG image.
 */
function isPngBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) {
    return false;
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return pngSignature.every((byte, index) => buffer[index] === byte);
}

/**
 * Converts a PNG buffer to a webview-compatible data URI.
 *
 * @param buffer PNG payload.
 * @returns Data URI string.
 */
function toPngDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Chooses the default ICO variant source for initial preview.
 *
 * @param variants Parsed ICO variants.
 * @returns Source URL for the preferred initial variant.
 */
function getDefaultIcoVariantSource(variants: IcoVariantViewModel[]): string {
  const preferred = variants
    .slice()
    .sort((variantA, variantB) => {
      const areaDifference = variantB.width * variantB.height - variantA.width * variantA.height;
      if (areaDifference !== 0) {
        return areaDifference;
      }

      return variantB.label.localeCompare(variantA.label, undefined, { numeric: true, sensitivity: 'base' });
    })[0];

  return preferred?.imageSource ?? variants[0].imageSource;
}

/**
 * Resolves a webview image source compatible with browser rendering.
 *
 * @param filePath Absolute file path.
 * @param originalUri Original file URI.
 * @param webview Target webview.
 * @returns Image source URL or data URI.
 */
async function getWebviewImageSource(
  filePath: string,
  originalUri: vscode.Uri,
  webview: vscode.Webview,
  cacheBuster: number
): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  const needsConversion = extension === '.tif' || extension === '.tiff' || extension === '.heic' || extension === '.heif';

  if (!needsConversion) {
    return `${webview.asWebviewUri(originalUri).toString()}?t=${cacheBuster}`;
  }

  const cacheKey = await getFileVersionKey(filePath);
  const cachedPreviewSource = getCachedValue(convertedPreviewCache, cacheKey);
  if (cachedPreviewSource) {
    return cachedPreviewSource;
  }

  const previewBuffer = await sharp(filePath)
    .png()
    .toBuffer();
  const previewSource = `data:image/png;base64,${previewBuffer.toString('base64')}`;
  setBoundedCachedValue(convertedPreviewCache, cacheKey, previewSource, MAX_CONVERTED_PREVIEW_CACHE_ENTRIES);
  return previewSource;
}

/**
 * Formats a byte size into a human-readable unit string.
 *
 * @param bytes Raw file size in bytes.
 * @returns Formatted size string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

/**
 * Converts RGB numeric values to an uppercase hexadecimal color string.
 *
 * @param r Red component.
 * @param g Green component.
 * @param b Blue component.
 * @returns Hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Resolves a user-provided accent color to a safe RGB tuple string.
 *
 * @param candidateColor Hex color candidate from settings (#RRGGBB).
 * @returns RGB tuple string usable in CSS variables (e.g. "0,200,110").
 */
function resolveThemeAccentRgb(candidateColor: string): string {
  const normalizedColor = candidateColor.trim();
  const colorPattern = /^#([0-9a-fA-F]{6})$/;
  const match = colorPattern.exec(normalizedColor);

  if (!match) {
    return hexColorToRgbTuple(DEFAULT_THEME_ACCENT_HEX);
  }

  return hexColorToRgbTuple(`#${match[1].toUpperCase()}`);
}

/**
 * Converts a hex color (#RRGGBB) to an RGB tuple string.
 *
 * @param hexColor Hex color value.
 * @returns RGB tuple string (e.g. "255,0,0").
 */
function hexColorToRgbTuple(hexColor: string): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `${String(red)},${String(green)},${String(blue)}`;
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {
  return;
}
