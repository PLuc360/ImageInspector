/**
 * Generates a PNG thumbnail (96x96) for an image.
 * @param filePath Absolute path to the image
 * @returns PNG Buffer
 */
async function generateThumbnailPNG(filePath: string): Promise<Buffer> {
  return await sharp(filePath)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 80 })
    .toBuffer();
}

/**
 * Prepares an array of GalleryImage with thumbnail for binary serialization.
 * @param images Array of objects {src, name, type, size, width, height, filePath}
 * @returns Array of objects {src, name, type, size, width, height, thumbnail}
 */
async function prepareGalleryImagesWithThumb(images: Array<{src: string, name: string, type: string, size: number, width: number, height: number, filePath: string}>): Promise<Array<{src: string, name: string, type: string, size: number, width: number, height: number, thumbnail: Buffer}>> {
  return await Promise.all(images.map(async img => {
    let thumbnail: Buffer;
    try {
      thumbnail = await generateThumbnailPNG(img.filePath);
    } catch {
      thumbnail = Buffer.alloc(0);
    }
    return {
      src: img.src,
      name: img.name,
      type: img.type,
      size: img.size,
      width: img.width,
      height: img.height,
      thumbnail
    };
  }));
}
/**
 * Binary structure for GalleryImage with PNG thumbnail.
 * src: 128 bytes (UTF-8, zero padding)
 * name: 64 bytes
 * type: 8 bytes
 * size: 4 bytes
 * width: 4 bytes
 * height: 4 bytes
 * thumbnailSize: 4 bytes
 * thumbnail: variable (PNG buffer)
 */
const GALLERY_IMAGE_BIN_STRUCT_THUMB = {
  srcLen: 128,
  nameLen: 64,
  typeLen: 8,
  sizeLen: 4,
  widthLen: 4,
  heightLen: 4,
  thumbSizeLen: 4,
};

/**
 * Serializes an array of GalleryImage with thumbnail to binary.
 * @param images Array of objects {src, name, type, size, width, height, thumbnail}
 * @returns Binary Buffer
 */
function serializeGalleryImagesBinWithThumb(images: Array<{src: string, name: string, type: string, size: number, width: number, height: number, thumbnail: Buffer}>): Buffer {
  const { srcLen, nameLen, typeLen, sizeLen, widthLen, heightLen, thumbSizeLen } = GALLERY_IMAGE_BIN_STRUCT_THUMB;
  // Compute total size
  let totalLen = 0;
  const thumbSizes = images.map(img => img.thumbnail.length);
  totalLen = images.reduce((acc, img, idx) => acc + srcLen + nameLen + typeLen + sizeLen + widthLen + heightLen + thumbSizeLen + thumbSizes[idx], 0);
  const buf = Buffer.alloc(totalLen);
  let offset = 0;
  images.forEach((img, idx) => {
    buf.fill(0, offset, offset + srcLen + nameLen + typeLen);
    buf.write(img.src.slice(0, srcLen), offset, srcLen, 'utf8');
    offset += srcLen;
    buf.write(img.name.slice(0, nameLen), offset, nameLen, 'utf8');
    offset += nameLen;
    buf.write(img.type.slice(0, typeLen), offset, typeLen, 'utf8');
    offset += typeLen;
    buf.writeUInt32LE(img.size, offset);
    offset += sizeLen;
    buf.writeUInt32LE(img.width, offset);
    offset += widthLen;
    buf.writeUInt32LE(img.height, offset);
    offset += heightLen;
    buf.writeUInt32LE(img.thumbnail.length, offset);
    offset += thumbSizeLen;
    img.thumbnail.copy(buf, offset, 0, img.thumbnail.length);
    offset += img.thumbnail.length;
  });
  return buf;
}

/**
 * Deserializes a binary Buffer into an array of GalleryImage with thumbnail.
 * @param buf Binary Buffer
 * @returns Array of objects {src, name, type, size, width, height, thumbnail}
 */
function deserializeGalleryImagesBinWithThumb(buf: Buffer): Array<{src: string, name: string, type: string, size: number, width: number, height: number, thumbnail: Buffer}> {
  const { srcLen, nameLen, typeLen, sizeLen, widthLen, heightLen, thumbSizeLen } = GALLERY_IMAGE_BIN_STRUCT_THUMB;
  const images = [];
  let offset = 0;
  while (offset + srcLen + nameLen + typeLen + sizeLen + widthLen + heightLen + thumbSizeLen <= buf.length) {
    const src = buf.toString('utf8', offset, offset + srcLen).replace(/\0+$/, '');
    const name = buf.toString('utf8', offset + srcLen, offset + srcLen + nameLen).replace(/\0+$/, '');
    const type = buf.toString('utf8', offset + srcLen + nameLen, offset + srcLen + nameLen + typeLen).replace(/\0+$/, '');
    const size = buf.readUInt32LE(offset + srcLen + nameLen + typeLen);
    const width = buf.readUInt32LE(offset + srcLen + nameLen + typeLen + sizeLen);
    const height = buf.readUInt32LE(offset + srcLen + nameLen + typeLen + sizeLen + widthLen);
    const thumbSize = buf.readUInt32LE(offset + srcLen + nameLen + typeLen + sizeLen + widthLen + heightLen);
    const thumbStart = offset + srcLen + nameLen + typeLen + sizeLen + widthLen + heightLen + thumbSizeLen;
    const thumbnail = buf.slice(thumbStart, thumbStart + thumbSize);
    images.push({ src, name, type, size, width, height, thumbnail });
    offset = thumbStart + thumbSize;
  }
  return images;
}
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import sharp from 'sharp';

/**
 * Generates a URI accessible by the webview for an image.
 * @param webview Target webview
 * @param filePath Absolute path to the image
 * @returns URI string
 */
function getWebviewImageSrc(webview: vscode.Webview, filePath: string): string {
  return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
}
/**
 * Compact binary structure for GalleryImage.
 * src: 128 bytes (UTF-8, zero padding)
 * name: 64 bytes (UTF-8, zero padding)
 * type: 8 bytes (UTF-8, zero padding)
 * size: 4 bytes (uint32)
 * width: 4 bytes (uint32)
 * height: 4 bytes (uint32)
 * Total: 212 bytes per image.
 */

const GALLERY_IMAGE_BIN_STRUCT = {
  srcLen: 128,
  nameLen: 64,
  typeLen: 8,
  sizeLen: 4,
  widthLen: 4,
  heightLen: 4,
  totalLen: 128 + 64 + 8 + 4 + 4 + 4
};

/**
 * Serializes an array of GalleryImage to binary.
 * @param images Array of GalleryImage objects
 * @returns Binary Buffer
 */
function serializeGalleryImagesBin(images: Array<{src: string, name: string, type: string, size: number, width: number, height: number}>): Buffer {
  const { srcLen, nameLen, typeLen, sizeLen, widthLen, heightLen, totalLen } = GALLERY_IMAGE_BIN_STRUCT;
  const buf = Buffer.alloc(totalLen * images.length);
  images.forEach((img, idx) => {
    let offset = idx * totalLen;
    buf.fill(0, offset, offset + totalLen);
    buf.write(img.src.slice(0, srcLen), offset, srcLen, 'utf8');
    offset += srcLen;
    buf.write(img.name.slice(0, nameLen), offset, nameLen, 'utf8');
    offset += nameLen;
    buf.write(img.type.slice(0, typeLen), offset, typeLen, 'utf8');
    offset += typeLen;
    buf.writeUInt32LE(img.size, offset);
    offset += sizeLen;
    buf.writeUInt32LE(img.width, offset);
    offset += widthLen;
    buf.writeUInt32LE(img.height, offset);
  });
  return buf;
}

/**
 * Deserializes a binary Buffer into an array of GalleryImage.
 * @param buf Binary Buffer
 * @returns Array of GalleryImage objects
 */
function deserializeGalleryImagesBin(buf: Buffer): Array<{src: string, name: string, type: string, size: number, width: number, height: number}> {
  const { srcLen, nameLen, typeLen, sizeLen, widthLen, heightLen, totalLen } = GALLERY_IMAGE_BIN_STRUCT;
  const images = [];
  for (let offset = 0; offset + totalLen <= buf.length; offset += totalLen) {
    const src = buf.toString('utf8', offset, offset + srcLen).replace(/\0+$/, '');
    const name = buf.toString('utf8', offset + srcLen, offset + srcLen + nameLen).replace(/\0+$/, '');
    const type = buf.toString('utf8', offset + srcLen + nameLen, offset + srcLen + nameLen + typeLen).replace(/\0+$/, '');
    const size = buf.readUInt32LE(offset + srcLen + nameLen + typeLen);
    const width = buf.readUInt32LE(offset + srcLen + nameLen + typeLen + sizeLen);
    const height = buf.readUInt32LE(offset + srcLen + nameLen + typeLen + sizeLen + widthLen);
    images.push({ src, name, type, size, width, height });
  }
  return images;
}

/**
 * Writes the binary metadata file at the root of the folder.
 * @param folderPath Folder path
 * @param images Array of GalleryImage
 */
async function writeGalleryMetaBin(folderPath: string, images: Array<{src: string, name: string, type: string, size: number, width: number, height: number}>): Promise<void> {
  const binPath = path.join(folderPath, 'imageGalleryMeta.bin');
  // Add filePath if missing
  const imagesWithFilePath = images.map(img => ({
    ...img,
    filePath: typeof img.src === 'string' ? img.src : ''
  }));
  // Prepare images with thumbnails
  const imagesWithThumb = await prepareGalleryImagesWithThumb(imagesWithFilePath);
  const buf = serializeGalleryImagesBinWithThumb(imagesWithThumb);
  await fs.writeFile(binPath, buf);
}

/**
 * Reads the binary metadata file at the root of the folder.
 * @param folderPath Folder path
 * @returns Array of GalleryImage
 */
async function readGalleryMetaBin(folderPath: string): Promise<Array<{src: string, name: string, type: string, size: number, width: number, height: number}>> {
  const binPath = path.join(folderPath, 'imageGalleryMeta.bin');
  try {
    const buf = await fs.readFile(binPath);
    return deserializeGalleryImagesBin(buf);
  } catch {
    return [];
  }
}
import {
  buildCustomEditorWebview,
  buildErrorWebview,
  buildFolderGalleryWebview,
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

type WebviewInboundMessage = {
  type: 'pick-compare-image';
} | {
  type: 'clear-compare-image';
};

type WebviewOutboundMessage =
  | ZoomMessage
  | {
    type: 'set-compare-image';
    source: string;
    label: string;
  }
  | {
    type: 'clear-compare-image';
  }
  | {
    type: 'set-dominant-color';
    hexColor: string;
    rgbColor: string;
  }
  | {
    type: 'update-settings';
    settings: ImageInspectorSettings;
  };

type DominantColorQuality = 'fast' | 'full';

type ImageInspectorSettings = {
  toolbarPosition: string;
  themeAccentRgb: string;
  pipetteLoupeDiameter: number;
  pipetteLoupeVirtualResolution: number;
  pipetteLoupeZoomAtMinImageZoom: number;
  pipetteLoupeZoomAtMaxImageZoom: number;
  dominantColorQuality: DominantColorQuality;
  dominantColorFastSampleSize: number;
};

type GetImageDetailsOptions = {
  includeDominantColor: boolean;
  dominantColorQuality: DominantColorQuality;
  dominantColorFastSampleSize: number;
};

const MAX_CONVERTED_PREVIEW_CACHE_ENTRIES = 12;
const MAX_ICO_CACHE_ENTRIES = 24;
const MAX_IMAGE_DETAILS_CACHE_ENTRIES = 32;
const DEFAULT_THEME_ACCENT_HEX = '#00C86E';
const DEFAULT_DOMINANT_COLOR_QUALITY: DominantColorQuality = 'full';
const DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE = 64;

const convertedPreviewCache = new Map<string, string>();
const icoEntriesCache = new Map<string, IcoImageEntry[]>();
const icoGalleryCache = new Map<string, IcoVariantViewModel[]>();
const imageDetailsCache = new Map<string, ImageDetailsViewModel>();

type FileVersionInfo = {
  key: string;
  sizeBytes: number;
};

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
 * Resolves file stats and a version key in one pass.
 *
 * @param filePath Absolute file path.
 * @returns File stats and corresponding cache key.
 */
async function getFileVersionInfo(filePath: string): Promise<FileVersionInfo> {
  const stats = await fs.stat(filePath);
  const sizeBytes = typeof stats.size === 'bigint' ? Number(stats.size) : stats.size;
  return {
    key: buildFileVersionKey(filePath, sizeBytes, stats.mtimeMs),
    sizeBytes
  };
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
  private readonly comparisonImageByDocumentUri = new Map<string, vscode.Uri>();
  private readonly renderSequenceByViewKey = new Map<string, number>();

  /**
   * Builds a stable key used to debounce refreshes per panel/document pair.
   *
   * @param document Document currently rendered.
   * @param webviewPanel Associated webview panel.
   * @returns Unique key for refresh timer tracking.
   */
  private getRefreshTimerKey(document: ImageCustomDocument, webviewPanel: vscode.WebviewPanel): string {
    // Avoid accessing viewType if webviewPanel is disposed
    try {
      return `${webviewPanel.viewType}${document.uri.toString()}`;
    } catch (e) {
      // Panel is disposed, return a neutral key
      return `disposed${document.uri.toString()}`;
    }
  }

  /**
   * Starts a new render sequence for one panel/document pair.
   *
   * @param viewKey Stable panel/document key.
   * @returns Sequence number for this render request.
   */
  private beginRenderSequence(viewKey: string): number {
    const nextSequence = (this.renderSequenceByViewKey.get(viewKey) ?? 0) + 1;
    this.renderSequenceByViewKey.set(viewKey, nextSequence);
    return nextSequence;
  }

  /**
   * Checks whether a render request is still current.
   *
   * @param viewKey Stable panel/document key.
   * @param sequence Sequence number to validate.
   * @returns True when the sequence is still the latest one.
   */
  private isRenderSequenceCurrent(viewKey: string, sequence: number): boolean {
    return this.renderSequenceByViewKey.get(viewKey) === sequence;
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

      this.renderSequenceByViewKey.delete(timerKey);

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
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        vscode.Uri.file(path.parse(document.uri.fsPath).root)
      ]
    };

    webviewPanel.webview.onDidReceiveMessage((rawMessage: unknown) => {
      if (!rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) {
        return;
      }

      const message = rawMessage as WebviewInboundMessage;
      void this.handleWebviewMessage(document, webviewPanel, message);
    }, undefined, this.context.subscriptions);

    await this.renderDocument(document, webviewPanel);
  }

  /**
   * Renders the webview for a specific image document.
   *
   * @param document Custom document instance.
   * @param webviewPanel Target webview panel.
   */
  private async renderDocument(document: ImageCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const viewKey = this.getRefreshTimerKey(document, webviewPanel);
    const renderSequence = this.beginRenderSequence(viewKey);

    try {
      const imageInspectorSettings = getImageInspectorSettings();
      const primaryFileVersion = await getFileVersionInfo(document.uri.fsPath);
      const details = await getImageDetails(
        document.uri.fsPath,
        primaryFileVersion,
        {
          includeDominantColor: false,
          dominantColorQuality: imageInspectorSettings.dominantColorQuality,
          dominantColorFastSampleSize: imageInspectorSettings.dominantColorFastSampleSize
        }
      );

      if (!this.isRenderSequenceCurrent(viewKey, renderSequence)) {
        return;
      }

      let imageSource = await getWebviewImageSource(
        document.uri.fsPath,
        document.uri,
        webviewPanel.webview,
        primaryFileVersion.key
      );
      const comparisonImageUri = this.comparisonImageByDocumentUri.get(document.uri.toString());
      const extension = path.extname(document.uri.fsPath).toLowerCase();
      const icoVariants = extension === '.ico' ? await getIcoGalleryItems(document.uri.fsPath) : [];
      let comparisonImageSource = '';
      let comparisonImageLabel = '';

      if (icoVariants.length > 0) {
        imageSource = getDefaultIcoVariantSource(icoVariants);
      }

      if (comparisonImageUri) {
        const comparisonFileVersion = await getFileVersionInfo(comparisonImageUri.fsPath);
        comparisonImageSource = await getWebviewImageSource(
          comparisonImageUri.fsPath,
          comparisonImageUri,
          webviewPanel.webview,
          comparisonFileVersion.key
        );
        comparisonImageLabel = path.basename(comparisonImageUri.fsPath);
      }

      if (!this.isRenderSequenceCurrent(viewKey, renderSequence)) {
        return;
      }

      webviewPanel.title = details.fileName;
      webviewPanel.webview.html = buildCustomEditorWebview(
        webviewPanel.webview,
        imageSource,
        details,
        this.context.extensionUri,
        {
          toolbarPosition: imageInspectorSettings.toolbarPosition,
          themeAccentRgb: imageInspectorSettings.themeAccentRgb,
          icoVariants,
          comparisonImageSource,
          comparisonImageLabel,
          pipetteLoupeDiameter: imageInspectorSettings.pipetteLoupeDiameter,
          pipetteLoupeVirtualResolution: imageInspectorSettings.pipetteLoupeVirtualResolution,
          pipetteLoupeZoomAtMinImageZoom: imageInspectorSettings.pipetteLoupeZoomAtMinImageZoom,
          pipetteLoupeZoomAtMaxImageZoom: imageInspectorSettings.pipetteLoupeZoomAtMaxImageZoom
        }
      );

      void this.pushDominantColorUpdate(
        document,
        webviewPanel,
        viewKey,
        renderSequence,
        primaryFileVersion,
        imageInspectorSettings
      );
    } catch (error) {
      if (!this.isRenderSequenceCurrent(viewKey, renderSequence)) {
        return;
      }

      const message = getImageLoadErrorMessage(document.uri.fsPath, error);
      webviewPanel.webview.html = buildErrorWebview(message);
    }
  }

  /**
   * Computes and sends dominant color update asynchronously.
   *
   * @param document Active document.
   * @param webviewPanel Target panel.
   * @param viewKey Stable panel/document key.
   * @param renderSequence Render sequence to validate.
   * @param knownFileVersion Optional file version info reused from render.
   * @param settings Current extension settings.
   */
  private async pushDominantColorUpdate(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    viewKey: string,
    renderSequence: number,
    knownFileVersion: FileVersionInfo | undefined,
    settings: ImageInspectorSettings
  ): Promise<void> {
    const resolvedFileVersion = knownFileVersion ?? await getFileVersionInfo(document.uri.fsPath);
    const details = await getImageDetails(
      document.uri.fsPath,
      resolvedFileVersion,
      {
        includeDominantColor: true,
        dominantColorQuality: settings.dominantColorQuality,
        dominantColorFastSampleSize: settings.dominantColorFastSampleSize
      }
    );

    if (!this.isRenderSequenceCurrent(viewKey, renderSequence)) {
      return;
    }

    const outboundMessage: WebviewOutboundMessage = {
      type: 'set-dominant-color',
      hexColor: details.dominantColorHex,
      rgbColor: details.dominantColorRgb
    };

    await webviewPanel.webview.postMessage(outboundMessage);
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
   * Prompts the user to pick a comparison image for the active custom editor.
   */
  async promptComparisonImageForActivePanel(): Promise<void> {
    if (!this.activePanel || !this.activeDocument) {
      void vscode.window.showInformationMessage('Open an image in Image Inspector first.');
      return;
    }

    await this.pickComparisonImage(this.activeDocument, this.activePanel);
  }

  /**
   * Handles webview-to-extension messages.
   *
   * @param document Active custom document.
   * @param webviewPanel Active webview panel.
   * @param message Inbound message payload.
   */
  private async handleWebviewMessage(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    message: WebviewInboundMessage
  ): Promise<void> {
    if (message.type === 'pick-compare-image') {
      await this.pickComparisonImage(document, webviewPanel);
      return;
    }

    if (message.type === 'clear-compare-image') {
      await this.clearComparisonImage(document, webviewPanel);
    }
  }

  /**
   * Opens a picker and sends a comparison image source to the webview.
   *
   * @param document Active custom document.
   * @param webviewPanel Active webview panel.
   */
  private async pickComparisonImage(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Choose comparison image',
      filters: {
        Images: SUPPORTED_IMAGE_FILTER_EXTENSIONS
      }
    });

    const comparisonUri = selected?.[0];
    if (!comparisonUri) {
      return;
    }

    const [primaryFileVersion, comparisonFileVersion] = await Promise.all([
      getFileVersionInfo(document.uri.fsPath),
      getFileVersionInfo(comparisonUri.fsPath)
    ]);

    const [primaryDetails, comparisonDetails] = await Promise.all([
      getImageDetails(document.uri.fsPath, primaryFileVersion, {
        includeDominantColor: false,
        dominantColorQuality: DEFAULT_DOMINANT_COLOR_QUALITY,
        dominantColorFastSampleSize: DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
      }),
      getImageDetails(comparisonUri.fsPath, comparisonFileVersion, {
        includeDominantColor: false,
        dominantColorQuality: DEFAULT_DOMINANT_COLOR_QUALITY,
        dominantColorFastSampleSize: DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
      })
    ]);

    if (primaryDetails.width !== comparisonDetails.width || primaryDetails.height !== comparisonDetails.height) {
      const primarySize = `${String(primaryDetails.width)}x${String(primaryDetails.height)}`;
      const compareSize = `${String(comparisonDetails.width)}x${String(comparisonDetails.height)}`;
      void vscode.window.showWarningMessage(
        `Comparison requires matching dimensions. Current: ${primarySize}, selected: ${compareSize}.`
      );
      return;
    }

    const comparisonSource = await getWebviewImageSource(
      comparisonUri.fsPath,
      comparisonUri,
      webviewPanel.webview,
      comparisonFileVersion.key
    );

    this.comparisonImageByDocumentUri.set(document.uri.toString(), comparisonUri);

    const outboundMessage: WebviewOutboundMessage = {
      type: 'set-compare-image',
      source: comparisonSource,
      label: path.basename(comparisonUri.fsPath)
    };

    await webviewPanel.webview.postMessage(outboundMessage);
  }

  /**
   * Clears any currently selected comparison image for one document.
   *
   * @param document Active custom document.
   * @param webviewPanel Active webview panel.
   */
  private async clearComparisonImage(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    this.comparisonImageByDocumentUri.delete(document.uri.toString());

    const outboundMessage: WebviewOutboundMessage = {
      type: 'clear-compare-image'
    };

    await webviewPanel.webview.postMessage(outboundMessage);
  }

  /**
   * Re-renders the active custom editor panel after configuration updates.
   */
  async refreshActivePanelFromConfiguration(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!this.activePanel || !this.activeDocument) {
      return;
    }

    const settings = getImageInspectorSettings();
    const settingsMessage: WebviewOutboundMessage = {
      type: 'update-settings',
      settings
    };
    await this.activePanel.webview.postMessage(settingsMessage);

    if (
      event.affectsConfiguration('imageInspector.dominantColorQuality')
      || event.affectsConfiguration('imageInspector.dominantColorFastSampleSize')
    ) {
      const viewKey = this.getRefreshTimerKey(this.activeDocument, this.activePanel);
      const renderSequence = this.renderSequenceByViewKey.get(viewKey) ?? 0;
      void this.pushDominantColorUpdate(
        this.activeDocument,
        this.activePanel,
        viewKey,
        renderSequence,
        undefined,
        settings
      );
    }
  }
}

/**
 * Scans a folder for supported image files (non-recursive).
 *
 * @param folderPath Absolute path to the folder.
 * @returns Sorted list of absolute image file paths found directly in the folder.
 */
async function scanFolderImages(folderPath: string): Promise<string[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * Manages WebviewPanel instances for folder image galleries.
 * One panel is kept alive per folder path.
 */
class ImageFolderGalleryPanel {
  private static readonly activePanels = new Map<string, ImageFolderGalleryPanel>();
  private readonly panel: vscode.WebviewPanel;
  private readonly imageFiles: Array<{ src: string; filePath: string; name: string; type: string; size: number; width: number; height: number; dominantColorHex: string; dominantColorRgb: string }>;
  private readonly storageKey: string;

  /**
   * Opens or reveals the gallery panel for the given folder.
   *
   * @param folderUri URI of the folder to display images from.
   * @param context Extension context.
   */
  static async open(folderUri: vscode.Uri, context: vscode.ExtensionContext): Promise<void> {
    const folderPath = folderUri.fsPath;
    const storageKey = `galleryMeta:${folderPath}`;
    const existing = ImageFolderGalleryPanel.activePanels.get(folderPath);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const imageFiles = await scanFolderImages(folderPath);
    let galleryImageMeta;
    // Try to read the binary file with thumbnails
    let binImages: Array<{src: string, name: string, type: string, size: number, width: number, height: number, thumbnail: Buffer}> = [];
    try {
      const binPath = path.join(folderPath, 'imageGalleryMeta.bin');
      const buf = await fs.readFile(binPath);
      binImages = deserializeGalleryImagesBinWithThumb(buf);
    } catch {}
    // Progressive display: show the gallery immediately with available info
    galleryImageMeta = [];
    if (binImages.length === imageFiles.length) {
      // If binary cache is complete, use it
      galleryImageMeta = binImages.map((img, idx) => ({
        src: '',
        filePath: imageFiles[idx],
        name: img.name,
        type: img.type,
        size: img.size,
        width: img.width,
        height: img.height,
        dominantColorHex: '#cccccc',
        dominantColorRgb: 'rgb(204, 204, 204)',
        thumbnail: img.thumbnail
      }));
    } else {
      // Otherwise, show the gallery with placeholders
      galleryImageMeta = imageFiles.map((filePath) => ({
        src: '',
        filePath,
        name: path.basename(filePath),
        type: 'Loading...',
        size: 0,
        width: 0,
        height: 0,
        dominantColorHex: '#cccccc',
        dominantColorRgb: 'rgb(204, 204, 204)'
      }));
    }

    const instance = new ImageFolderGalleryPanel(folderUri, galleryImageMeta, context);
    instance.imageFiles.forEach(img => {
      img.src = getWebviewImageSrc(instance.panel.webview, img.filePath);
    });
    ImageFolderGalleryPanel.activePanels.set(folderPath, instance);

    // Progressive display: update each image as soon as its info is ready
    if (binImages.length === imageFiles.length) {
      // If cache, send info immediately
      instance.imageFiles.forEach((img, index) => {
        img.src = getWebviewImageSrc(instance.panel.webview, img.filePath);
        instance.panel.webview.postMessage({
          type: 'update-image-meta',
          index,
          meta: instance.imageFiles[index]
        });
      });
    } else {
      // Otherwise, generate and update as info becomes available
      await Promise.all(imageFiles.map(async (filePath, index) => {
        try {
          const details = await getImageDetails(filePath, undefined, {
            includeDominantColor: true,
            dominantColorQuality: DEFAULT_DOMINANT_COLOR_QUALITY,
            dominantColorFastSampleSize: DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
          });
          instance.imageFiles[index] = {
            src: getWebviewImageSrc(instance.panel.webview, filePath),
            filePath,
            name: details.fileName,
            type: details.format,
            size: details.sizeBytes,
            width: details.width,
            height: details.height,
            dominantColorHex: details.dominantColorHex,
            dominantColorRgb: details.dominantColorRgb
          };
          instance.panel.webview.postMessage({
            type: 'update-image-meta',
            index,
            meta: instance.imageFiles[index]
          });
          await context.workspaceState.update(storageKey, instance.imageFiles);
        } catch {
          // In case of error, keep the placeholder
        }
      }));
      // Generate thumbnails and write binary file in background
      prepareGalleryImagesWithThumb(instance.imageFiles.map(img => ({ ...img, filePath: img.filePath })))
        .then(imagesWithThumb => {
          const buf = serializeGalleryImagesBinWithThumb(imagesWithThumb);
          return fs.writeFile(path.join(folderPath, 'imageGalleryMeta.bin'), buf);
        })
        .catch(err => {
          console.error('Error while writing gallery binary file:', err);
        });
    }
  }

  /**
   * Creates and wires up the gallery WebviewPanel.
   *
   * @param folderUri URI of the folder being displayed.
   * @param imageFiles Absolute paths of images found in the folder.
   * @param context Extension context.
   */
  private constructor(
    folderUri: vscode.Uri,
    galleryImageMeta: Array<{ filePath: string; name: string; type: string; size: number; width: number; height: number; dominantColorHex: string; dominantColorRgb: string }>,
    context: vscode.ExtensionContext
  ) {
    this.imageFiles = galleryImageMeta.map(img => ({
      ...img,
      src: '' // will be updated after
    }));
    const folderName = path.basename(folderUri.fsPath);
    // Panel initialization
    this.panel = vscode.window.createWebviewPanel(
      'imageInspector.folderGallery',
      `Gallery : ${folderName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.file(folderUri.fsPath)
        ]
      }
    );
    // Update src after panel creation
    this.imageFiles.forEach(img => {
      img.src = getWebviewImageSrc(this.panel.webview, img.filePath);
    });
    this.storageKey = `galleryMeta:${folderUri.fsPath}`;

    this.panel.webview.html = buildFolderGalleryWebview(
      this.panel.webview,
      folderUri.fsPath,
      galleryImageMeta,
      context.extensionUri
    );

    this.panel.webview.onDidReceiveMessage(
      (rawMessage: unknown) => {
        if (!rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) {
          return;
        }

        const message = rawMessage as { type: string; index?: unknown; binPath?: string };
        // Handler for gallery binary file request
        if (message.type === 'request-gallery-meta-bin' && typeof message.binPath === 'string') {
          // Lecture du fichier binaire avec miniatures
          const binPath = path.join(folderUri.fsPath, message.binPath);
          fs.readFile(binPath).then(buf => {
            const images = deserializeGalleryImagesBinWithThumb(buf).map(img => ({
              ...img,
              thumbnail: img.thumbnail.length > 0 ? img.thumbnail.toString('base64') : undefined
            }));
            this.panel.webview.postMessage({
              type: 'response-gallery-meta-bin',
              binPath: message.binPath,
              images
            });
          }).catch((err) => {
            this.panel.webview.postMessage({
              type: 'response-gallery-meta-bin',
              binPath: message.binPath,
              images: []
            });
          });
          return;
        }
        // Handler pour ouverture d'image
        if (message.type === 'open-image' && typeof message.index === 'number') {
          const index = Math.trunc(message.index);
          if (index < 0 || index >= this.imageFiles.length) {
            return;
          }
          const imageUri = vscode.Uri.file(this.imageFiles[index].filePath);
          void vscode.commands.executeCommand(
            'vscode.openWith',
            imageUri,
            ImageDetailsCustomEditorProvider.viewType
          );
        }
      },
      undefined,
      context.subscriptions
    );

    this.panel.onDidDispose(() => {
      // Final metadata save
      context.workspaceState.update(this.storageKey, this.imageFiles);
      ImageFolderGalleryPanel.activePanels.delete(folderUri.fsPath);
    }, undefined, context.subscriptions);
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

  const selectComparisonImageDisposable = vscode.commands.registerCommand(
    'imageInspector.selectComparisonImage',
    async () => {
      await provider.promptComparisonImageForActivePanel();
    }
  );

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

    void provider.refreshActivePanelFromConfiguration(event);
  });

  const openFolderGalleryDisposable = vscode.commands.registerCommand(
    'imageInspector.openFolderGallery',
    async (resource?: unknown, resources?: unknown) => {
      const folderUri = await resolveFolderUri(resource, resources);
      if (!folderUri) {
        void vscode.window.showInformationMessage('Select a folder in the explorer to open its gallery.');
        return;
      }

      await ImageFolderGalleryPanel.open(folderUri, context);
    }
  );

  context.subscriptions.push(
    providerDisposable,
    showImageDetailsDisposable,
    zoomInDisposable,
    zoomOutDisposable,
    zoomResetDisposable,
    zoomFitDisposable,
    selectComparisonImageDisposable,
    configurationChangeDisposable,
    openFolderGalleryDisposable
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
 * Resolves a folder URI from command input, current editor, or picker.
 *
 * @param resource Optional value provided by command invocation.
 * @param resources Optional list of selected values from explorer context.
 * @returns Resolved folder URI or undefined when selection is canceled.
 */
async function resolveFolderUri(resource?: unknown, resources?: unknown): Promise<vscode.Uri | undefined> {
  const explicitCandidates = collectUriCandidates(resources, resource);
  const selectionCandidate = await findFirstDirectoryUri(explicitCandidates);
  if (selectionCandidate) {
    return selectionCandidate;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 1) {
    const soleWorkspaceUri = workspaceFolders[0]?.uri;
    if (soleWorkspaceUri && await isDirectoryUri(soleWorkspaceUri)) {
      return soleWorkspaceUri;
    }
  }

  if (workspaceFolders.length > 1) {
    const workspaceItems = workspaceFolders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      uri: workspaceFolder.uri
    }));

    const selectedWorkspace = await vscode.window.showQuickPick(workspaceItems, {
      placeHolder: 'Select the workspace folder to open in gallery'
    });

    if (selectedWorkspace?.uri && await isDirectoryUri(selectedWorkspace.uri)) {
      return selectedWorkspace.uri;
          // Écriture du fichier binaire de galerie (avec miniatures)
    }
  }
        // Écriture du fichier binaire de galerie (avec miniatures)

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (workspaceFolders.length === 0 && editorUri?.scheme === 'file') {
    const editorDirectoryUri = vscode.Uri.file(path.dirname(editorUri.fsPath));
    if (await isDirectoryUri(editorDirectoryUri)) {
      return editorDirectoryUri;
    }
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Open image gallery'
  });

  const selectedFolderUri = selected?.[0];
  if (selectedFolderUri && await isDirectoryUri(selectedFolderUri)) {
    return selectedFolderUri;
  }

  return undefined;
}

/**
 * Finds the first directory URI from an optional list of URIs.
 *
 * @param uris Candidate URIs.
 * @returns First URI that points to an existing directory.
 */
async function findFirstDirectoryUri(uris?: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  if (!uris || uris.length === 0) {
    return undefined;
  }

  for (const uri of uris) {
    if (await isDirectoryUri(uri)) {
      return uri;
    }
  }

  return undefined;
}

/**
 * Collects URI candidates from unknown command arguments.
 *
 * @param resources Value that may contain multiple selected entries.
 * @param resource Value that may contain a single selected entry.
 * @returns Normalized URI candidates.
 */
function collectUriCandidates(resources: unknown, resource: unknown): vscode.Uri[] {
  const result: vscode.Uri[] = [];

  if (Array.isArray(resources)) {
    for (const entry of resources) {
      const candidate = tryParseUriCandidate(entry);
      if (candidate) {
        result.push(candidate);
      }
    }
  }

  const singleCandidate = tryParseUriCandidate(resource);
  if (singleCandidate) {
    result.push(singleCandidate);
  }

  return result;
}

/**
 * Tries to parse an unknown command argument into a URI.
 *
 * @param value Potential URI-like value.
 * @returns Parsed URI when successful.
 */
function tryParseUriCandidate(value: unknown): vscode.Uri | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof vscode.Uri) {
    return value;
  }

  if (typeof value === 'string') {
    return vscode.Uri.file(value);
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  if ('uri' in value) {
    const nestedUri = (value as { uri?: unknown }).uri;
    return tryParseUriCandidate(nestedUri);
  }

  if ('scheme' in value && 'path' in value) {
    try {
      return vscode.Uri.from(value as {
        scheme: string;
        authority?: string;
        path?: string;
        query?: string;
        fragment?: string;
      });
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Checks whether a URI points to an existing directory.
 *
 * @param uri URI to validate.
 * @returns True when URI targets an existing directory.
 */
async function isDirectoryUri(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme !== 'file') {
    return false;
  }

  try {
    const stats = await fs.stat(uri.fsPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
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
async function getImageDetails(
  filePath: string,
  fileVersionInfo?: FileVersionInfo,
  options?: GetImageDetailsOptions
): Promise<ImageDetailsViewModel> {
  const resolvedFileVersion = fileVersionInfo ?? await getFileVersionInfo(filePath);
  const resolvedOptions = resolveImageDetailsOptions(options);
  const detailsCacheKey = buildImageDetailsCacheKey(resolvedFileVersion.key, resolvedOptions);
  const cachedDetails = getCachedValue(imageDetailsCache, detailsCacheKey);
  if (cachedDetails) {
    return cachedDetails;
  }

  try {
    const metadata = await sharp(filePath).metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    let dominantColorHex = '#808080';
    let dominantColorRgb = 'rgb(128, 128, 128)';

    if (resolvedOptions.includeDominantColor) {
      const dominant = await computeDominantColor(
        filePath,
        resolvedOptions.dominantColorQuality,
        resolvedOptions.dominantColorFastSampleSize
      );
      dominantColorHex = rgbToHex(dominant.r, dominant.g, dominant.b);
      dominantColorRgb = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;
    }

    const details: ImageDetailsViewModel = {
      fileName: path.basename(filePath),
      absolutePath: filePath,
      sizeBytes: resolvedFileVersion.sizeBytes,
      sizeText: formatBytes(resolvedFileVersion.sizeBytes),
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

    setBoundedCachedValue(imageDetailsCache, detailsCacheKey, details, MAX_IMAGE_DETAILS_CACHE_ENTRIES);
    return details;
  } catch (error) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.ico') {
      throw error;
    }

    // Extract main variant
    const buffer = await fs.readFile(filePath);
    const entries = await parseIcoEntries(buffer);
    const primaryEntry = entries.slice().sort((a, b) => (b.width * b.height - a.width * a.height) || (b.bitCount - a.bitCount))[0];
    const width = primaryEntry?.width ?? 0;
    const height = primaryEntry?.height ?? 0;
    const estimatedChannels = Math.max(1, Math.ceil((primaryEntry?.bitCount ?? 0) / 8));

    let dominantColorHex = '#808080';
    let dominantColorRgb = 'rgb(128, 128, 128)';

    if (resolvedOptions?.includeDominantColor && primaryEntry) {
      const imageEndOffset = primaryEntry.imageOffset + primaryEntry.bytesInResource;
      if (primaryEntry.isPng && primaryEntry.imageOffset < buffer.length && imageEndOffset <= buffer.length) {
        const imageBuffer = buffer.subarray(primaryEntry.imageOffset, imageEndOffset);
        try {
          const stats = await sharp(imageBuffer).stats();
          const dominant = stats.dominant;
          dominantColorHex = rgbToHex(dominant.r, dominant.g, dominant.b);
          dominantColorRgb = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;
        } catch (e) {
          // fallback to gray color
        }
      }
    }

    const details: ImageDetailsViewModel = {
      fileName: path.basename(filePath),
      absolutePath: filePath,
      sizeBytes: resolvedFileVersion.sizeBytes,
      sizeText: formatBytes(resolvedFileVersion.sizeBytes),
      width,
      height,
      megapixels: ((width * height) / 1_000_000).toFixed(2),
      format: 'ICO',
      space: 'Unknown',
      channels: estimatedChannels,
      hasAlpha: (primaryEntry?.bitCount ?? 0) >= 32,
      density: undefined,
      dominantColorHex,
      dominantColorRgb
    };

    setBoundedCachedValue(imageDetailsCache, detailsCacheKey, details, MAX_IMAGE_DETAILS_CACHE_ENTRIES);
    return details;
  }
}

/**
 * Resolves image details options with safe defaults.
 *
 * @param options Candidate options.
 * @returns Normalized options.
 */
function resolveImageDetailsOptions(options?: GetImageDetailsOptions): GetImageDetailsOptions {
  return {
    includeDominantColor: options?.includeDominantColor ?? true,
    dominantColorQuality: options?.dominantColorQuality ?? DEFAULT_DOMINANT_COLOR_QUALITY,
    dominantColorFastSampleSize: clampInteger(
      options?.dominantColorFastSampleSize ?? DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE,
      16,
      512
    )
  };
}

/**
 * Builds a cache key for image details according to extraction options.
 *
 * @param fileVersionKey Stable file version key.
 * @param options Normalized extraction options.
 * @returns Cache key.
 */
function buildImageDetailsCacheKey(fileVersionKey: string, options: GetImageDetailsOptions): string {
  if (!options.includeDominantColor) {
    return `${fileVersionKey}::details::meta`;
  }

  return `${fileVersionKey}::details::dominant::${options.dominantColorQuality}::${String(options.dominantColorFastSampleSize)}`;
}

/**
 * Computes dominant color for one image using full or fast mode.
 *
 * @param filePath Absolute image path.
 * @param quality Dominant color quality mode.
 * @param fastSampleSize Sampled size used in fast mode.
 * @returns Dominant color channels.
 */
async function computeDominantColor(
  filePath: string,
  quality: DominantColorQuality,
  fastSampleSize: number
): Promise<{ r: number; g: number; b: number }> {
  const imagePipeline = sharp(filePath, { limitInputPixels: false });
  const stats = quality === 'fast'
    ? await imagePipeline
      .resize(fastSampleSize, fastSampleSize, { fit: 'inside', withoutEnlargement: true })
      .stats()
    : await imagePipeline.stats();

  return stats.dominant;
}

/**
 * Reads extension settings used by the webview and image analysis pipeline.
 *
 * @returns Normalized extension settings.
 */
function getImageInspectorSettings(): ImageInspectorSettings {
  const imageInspectorConfig = vscode.workspace.getConfiguration('imageInspector');
  const themeAccentColor = imageInspectorConfig.get<string>('themeAccentColor', DEFAULT_THEME_ACCENT_HEX);

  const dominantColorQualityCandidate = imageInspectorConfig.get<string>(
    'dominantColorQuality',
    DEFAULT_DOMINANT_COLOR_QUALITY
  );
  const dominantColorQuality: DominantColorQuality = dominantColorQualityCandidate === 'fast'
    ? 'fast'
    : DEFAULT_DOMINANT_COLOR_QUALITY;

  return {
    toolbarPosition: imageInspectorConfig.get<string>('toolbarPosition', 'top'),
    themeAccentRgb: resolveThemeAccentRgb(themeAccentColor),
    pipetteLoupeDiameter: clampInteger(imageInspectorConfig.get<number>('pipetteLoupeDiameter', 96), 48, 256),
    pipetteLoupeVirtualResolution: clampInteger(
      imageInspectorConfig.get<number>('pipetteLoupeVirtualResolution', 25),
      5,
      101
    ),
    pipetteLoupeZoomAtMinImageZoom: clampNumber(
      imageInspectorConfig.get<number>('pipetteLoupeZoomAtMinImageZoom', 6),
      0.25,
      100
    ),
    pipetteLoupeZoomAtMaxImageZoom: clampNumber(
      imageInspectorConfig.get<number>('pipetteLoupeZoomAtMaxImageZoom', 1),
      0.25,
      100
    ),
    dominantColorQuality,
    dominantColorFastSampleSize: clampInteger(
      imageInspectorConfig.get<number>('dominantColorFastSampleSize', DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE),
      16,
      512
    )
  };
}

/**
 * Clamps a numeric value to a min/max range.
 *
 * @param value Candidate value.
 * @param min Minimum allowed value.
 * @param max Maximum allowed value.
 * @returns Clamped value.
 */
function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamps and rounds a numeric value to an integer range.
 *
 * @param value Candidate value.
 * @param min Minimum allowed value.
 * @param max Maximum allowed value.
 * @returns Clamped integer value.
 */
function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
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

  const variantPromises = entries.map(async (entry, index) => {
    const imageEndOffset = entry.imageOffset + entry.bytesInResource;
    if (!entry.isPng || entry.imageOffset >= buffer.length || imageEndOffset > buffer.length) {
      return undefined;
    }

    const imageBuffer = buffer.subarray(entry.imageOffset, imageEndOffset);
    const label = `${entry.width}x${entry.height}`;

    let dominantColorHex = '#808080';
    let dominantColorRgb = 'rgb(128, 128, 128)';
    try {
      const stats = await sharp(imageBuffer).stats();
      const dominant = stats.dominant;
      dominantColorHex = rgbToHex(dominant.r, dominant.g, dominant.b);
      dominantColorRgb = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;
    } catch (e) {
      // fallback couleur grise
    }

    return {
      id: `ico-variant-${String(index + 1)}`,
      label,
      width: entry.width,
      height: entry.height,
      imageSource: toPngDataUri(imageBuffer),
      dominantColorHex,
      dominantColorRgb
    } as IcoVariantViewModel;
  });
  const variantsRaw = await Promise.all(variantPromises);
  const variants: IcoVariantViewModel[] = variantsRaw.filter((variant): variant is IcoVariantViewModel => Boolean(variant));

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
  fileVersionKey: string
): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  const needsConversion = extension === '.tif' || extension === '.tiff' || extension === '.heic' || extension === '.heif';

  if (!needsConversion) {
    return `${webview.asWebviewUri(originalUri).toString()}?v=${encodeURIComponent(fileVersionKey)}`;
  }

  const cachedPreviewSource = getCachedValue(convertedPreviewCache, fileVersionKey);
  if (cachedPreviewSource) {
    return cachedPreviewSource;
  }

  const previewBuffer = await sharp(filePath)
    .png()
    .toBuffer();
  const previewSource = `data:image/png;base64,${previewBuffer.toString('base64')}`;
  setBoundedCachedValue(convertedPreviewCache, fileVersionKey, previewSource, MAX_CONVERTED_PREVIEW_CACHE_ENTRIES);
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
