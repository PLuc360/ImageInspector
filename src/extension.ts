// Caches and cache utilities
const MAX_IMAGE_DETAILS_CACHE_ENTRIES = 32;
const MAX_ICO_CACHE_ENTRIES = 16;
const MAX_CONVERTED_PREVIEW_CACHE_ENTRIES = 16;
const MAX_GALLERY_THUMBNAIL_CACHE_ENTRIES = 128;

const imageDetailsCache = new Map<string, ImageDetailsViewModel>();
const icoEntriesCache = new Map<string, any>();
const icoGalleryCache = new Map<string, any>();
const convertedPreviewCache = new Map<string, string>();
const galleryThumbnailCache = new Map<string, string>();

function getCachedValue<T>(cache: Map<string, T>, key: string): T | undefined {
  return cache.get(key);
}

function setBoundedCachedValue<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (cache.size >= maxEntries) {
    // Remove oldest entry
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

// Missing option types
interface GetImageDetailsOptions {
  includeDominantColor?: boolean;
  dominantColorQuality?: DominantColorQuality;
  dominantColorFastSampleSize?: number;
}

interface ImageInspectorSettings {
  toolbarPosition: string;
  themeAccentRgb: string;
  pipetteLoupeDiameter: number;
  pipetteLoupeVirtualResolution: number;
  pipetteLoupeZoomAtMinImageZoom: number;
  pipetteLoupeZoomAtMaxImageZoom: number;
  dominantColorQuality: DominantColorQuality;
  dominantColorFastSampleSize: number;
}

interface IcoImageEntry {
  width: number;
  height: number;
  bitCount: number;
  bytesInResource: number;
  imageOffset: number;
  isPng: boolean;
}

type IcoSource = string | Buffer;

// Minimal provider for custom editor
class ImageCustomDocument implements vscode.CustomDocument {
  uri: vscode.Uri;
  constructor(uri: vscode.Uri) {
    this.uri = uri;
  }
  dispose(): void {}
}

class ImageDetailsCustomEditorProvider implements vscode.CustomReadonlyEditorProvider<ImageCustomDocument> {
  public static readonly viewType = 'imageInspector.previewEditor';
  private readonly context: vscode.ExtensionContext;
  private activePanel: vscode.WebviewPanel | undefined;
  private readonly openPanels = new Map<vscode.WebviewPanel, vscode.Uri>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken
  ): Promise<ImageCustomDocument> {
    return new ImageCustomDocument(uri);
  }

  /**
   * Resolves and displays the custom editor for an image file.
   * @param document The custom document representing the image.
   * @param webviewPanel The webview panel to display content.
   * @param token Cancellation token.
   */
  async resolveCustomEditor(
    document: ImageCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    try {
      const filePath = document.uri.fsPath;
      const settings = getImageInspectorSettings();
      const icoVariants = path.extname(filePath).toLowerCase() === '.ico'
        ? await getIcoGalleryItems(filePath)
        : [];

      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.file(path.dirname(filePath)),
          ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])
        ]
      };

      const details = await getImageDetails(filePath, undefined, {
        includeDominantColor: true,
        dominantColorQuality: settings.dominantColorQuality,
        dominantColorFastSampleSize: settings.dominantColorFastSampleSize
      });
      const imageSrc = getWebviewImageSrc(webviewPanel.webview, filePath);
      webviewPanel.webview.html = buildCustomEditorWebview(
        webviewPanel.webview,
        imageSrc,
        details,
        this.context.extensionUri,
        {
          toolbarPosition: settings.toolbarPosition,
          themeAccentRgb: settings.themeAccentRgb,
          icoVariants,
          pipetteLoupeDiameter: settings.pipetteLoupeDiameter,
          pipetteLoupeVirtualResolution: settings.pipetteLoupeVirtualResolution,
          pipetteLoupeZoomAtMinImageZoom: settings.pipetteLoupeZoomAtMinImageZoom,
          pipetteLoupeZoomAtMaxImageZoom: settings.pipetteLoupeZoomAtMaxImageZoom
        }
      );

      const isNewPanel = !this.openPanels.has(webviewPanel);
      this.openPanels.set(webviewPanel, document.uri);
      this.activePanel = webviewPanel;

      if (isNewPanel) {
        webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
          if (!message || typeof message !== 'object' || !('type' in message)) {
            return;
          }

          const webviewMessage = message as { type: string };
          if (webviewMessage.type === 'pick-compare-image') {
            void this.promptComparisonImageForPanel(webviewPanel, document.uri);
          }
        });

        webviewPanel.onDidChangeViewState((event) => {
          if (event.webviewPanel.active) {
            this.activePanel = event.webviewPanel;
          }
        });

        webviewPanel.onDidDispose(() => {
          this.openPanels.delete(webviewPanel);
          if (this.activePanel === webviewPanel) {
            this.activePanel = undefined;
          }
        });
      }
    } catch (err) {
      webviewPanel.webview.html = `<html><body><h2>Erreur lors du chargement de l'image</h2><pre>${String(err)}</pre></body></html>`;
    }
  }

  /**
   * Sends a message to the currently active image inspector panel.
   * @param message Message payload consumed by the webview.
   */
  async sendZoomMessage(message: { type: string }): Promise<void> {
    if (!this.activePanel) {
      return;
    }

    await this.activePanel.webview.postMessage(message);
  }

  /**
   * Opens a picker to choose a comparison image for the active panel.
   */
  async promptComparisonImageForActivePanel(): Promise<void> {
    if (!this.activePanel) {
      void vscode.window.showInformationMessage('Open an image in Image Inspector before selecting a comparison image.');
      return;
    }

    const currentImageUri = this.openPanels.get(this.activePanel);
    if (!currentImageUri) {
      return;
    }

    await this.promptComparisonImageForPanel(this.activePanel, currentImageUri);
  }

  /**
   * Refreshes runtime settings for all opened image inspector panels.
   */
  refreshActivePanelFromConfiguration(_event: vscode.ConfigurationChangeEvent): void {
    const settings = getImageInspectorSettings();

    for (const panel of this.openPanels.keys()) {
      void panel.webview.postMessage({
        type: 'update-settings',
        settings
      });
    }
  }

  /**
   * Prompts the user for a comparison image and sends it to the target webview.
   * @param panel Target image inspector panel.
   * @param currentImageUri URI of the currently displayed image.
   */
  private async promptComparisonImageForPanel(
    panel: vscode.WebviewPanel,
    currentImageUri: vscode.Uri
  ): Promise<void> {
    const selectedUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(path.dirname(currentImageUri.fsPath)),
      openLabel: 'Select comparison image',
      filters: {
        Images: SUPPORTED_IMAGE_FILTER_EXTENSIONS
      }
    });

    const comparisonImageUri = selectedUris?.[0];
    if (!comparisonImageUri) {
      return;
    }

    const localResourceRoots = new Map<string, vscode.Uri>();
    for (const resourceRoot of panel.webview.options.localResourceRoots ?? []) {
      localResourceRoots.set(resourceRoot.toString(), resourceRoot);
    }
    localResourceRoots.set(
      vscode.Uri.file(path.dirname(comparisonImageUri.fsPath)).toString(),
      vscode.Uri.file(path.dirname(comparisonImageUri.fsPath))
    );

    panel.webview.options = {
      ...panel.webview.options,
      localResourceRoots: Array.from(localResourceRoots.values())
    };

    await panel.webview.postMessage({
      type: 'set-compare-image',
      source: getWebviewImageSrc(panel.webview, comparisonImageUri.fsPath),
      label: path.basename(comparisonImageUri.fsPath)
    });
  }
}
// Types and constants for gallery and inspector
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.ico', '.svg', '.heic', '.heif'];
const SUPPORTED_IMAGE_FILTER_EXTENSIONS = SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.replace('.', ''));
const DEFAULT_DOMINANT_COLOR_QUALITY = 'full';
const DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE = 64;
const DEFAULT_THEME_ACCENT_HEX = '#00C86E';

type DominantColorQuality = 'fast' | 'full';

function getWebviewImageSrc(webview: vscode.Webview, filePath: string): string {
  return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
}
import * as fs from 'fs/promises';
import * as path from 'path';

import sharp from 'sharp';

// Buffer is global in Node.js, but can be imported explicitly if needed
import { Buffer } from 'buffer';
import * as vscode from 'vscode';
import {
  buildCustomEditorWebview,
  buildErrorWebview,
  buildFolderGalleryWebview,
  type IcoVariantViewModel,
  type ImageDetailsViewModel
} from './webview';
// Utilities for file version management (cache, refresh)
type FileVersionInfo = {
  key: string;
  sizeBytes: number;
};

function buildFileVersionKey(filePath: string, size: number, mtimeMs: number): string {
  return `${filePath}::${String(size)}::${String(Math.trunc(mtimeMs))}`;
}

async function getFileVersionKey(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return buildFileVersionKey(filePath, stats.size, stats.mtimeMs);
}

async function getFileVersionInfo(filePath: string): Promise<FileVersionInfo> {
  const stats = await fs.stat(filePath);
  const sizeBytes = typeof stats.size === 'bigint' ? Number(stats.size) : stats.size;
  return {
    key: buildFileVersionKey(filePath, sizeBytes, stats.mtimeMs),
    sizeBytes
  };
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
    .filter((entry: any) => entry.isFile() && isSupportedImage(entry.name))
    .map((entry: any) => path.join(folderPath, entry.name))
    .sort((a: string, b: string) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * Builds a lightweight gallery thumbnail for one image file.
 *
 * @param filePath Absolute path to the source image.
 * @param fileVersionInfo Optional precomputed file version information.
 * @returns Data URI of the generated thumbnail, or an empty string on fallback.
 */
async function getGalleryThumbnailSource(
  filePath: string,
  fileVersionInfo?: FileVersionInfo
): Promise<string> {
  const resolvedFileVersion = fileVersionInfo ?? await getFileVersionInfo(filePath);
  const cachedThumbnail = getCachedValue(galleryThumbnailCache, resolvedFileVersion.key);
  if (cachedThumbnail) {
    return cachedThumbnail;
  }

  try {
    const thumbnailBuffer = await sharp(filePath)
      .rotate()
      .resize({
        width: 320,
        height: 320,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 72 })
      .toBuffer();

    const thumbnailSource = `data:image/webp;base64,${thumbnailBuffer.toString('base64')}`;
    setBoundedCachedValue(galleryThumbnailCache, resolvedFileVersion.key, thumbnailSource, MAX_GALLERY_THUMBNAIL_CACHE_ENTRIES);
    return thumbnailSource;
  } catch {
    return '';
  }
}

/**
 * Processes asynchronous tasks with a small concurrency cap.
 *
 * @param items Items to process.
 * @param concurrency Maximum number of parallel workers.
 * @param worker Async callback executed for each item.
 */
async function processWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }));
}

/**
 * Manages WebviewPanel instances for folder image galleries.
 * One panel is kept alive per folder path.
 */
class ImageFolderGalleryPanel {
  private static readonly activePanels = new Map<string, ImageFolderGalleryPanel>();
  private readonly panel: vscode.WebviewPanel;
  private readonly imageFiles: Array<{ src: string; thumbUrl?: string; filePath: string; name: string; type: string; size: number; width: number; height: number; dominantColorHex: string; dominantColorRgb: string }>;
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
    // Simple gallery construction without binary
    const galleryImageMeta = imageFiles.map((filePath) => ({
      src: '',
      thumbUrl: '',
      filePath,
      name: path.basename(filePath),
      type: 'Loading...',
      size: 0,
      width: 0,
      height: 0,
      dominantColorHex: '#cccccc',
      dominantColorRgb: 'rgb(204, 204, 204)'
    }));

    const instance = new ImageFolderGalleryPanel(folderUri, galleryImageMeta, context);
    instance.imageFiles.forEach(img => {
      img.src = getWebviewImageSrc(instance.panel.webview, img.filePath);
    });
    ImageFolderGalleryPanel.activePanels.set(folderPath, instance);

    // Progressive metadata generation and update with bounded concurrency.
    void processWithConcurrencyLimit(imageFiles, 4, async (filePath, index) => {
      try {
        const fileVersionInfo = await getFileVersionInfo(filePath);
        const [details, thumbUrl] = await Promise.all([
          getImageDetails(filePath, fileVersionInfo, {
            includeDominantColor: true,
            dominantColorQuality: DEFAULT_DOMINANT_COLOR_QUALITY,
            dominantColorFastSampleSize: DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
          }),
          getGalleryThumbnailSource(filePath, fileVersionInfo)
        ]);
        instance.imageFiles[index] = {
          src: getWebviewImageSrc(instance.panel.webview, filePath),
          thumbUrl,
          filePath,
          name: details.fileName,
          type: details.format,
          size: details.sizeBytes,
          width: details.width,
          height: details.height,
          dominantColorHex: details.dominantColorHex,
          dominantColorRgb: details.dominantColorRgb
        };
        void instance.panel.webview.postMessage({
          type: 'update-image-meta',
          index,
          meta: instance.imageFiles[index]
        });
        await context.workspaceState.update(storageKey, instance.imageFiles);
      } catch {
        // On error, keep placeholder metadata.
      }
    });
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
    galleryImageMeta: Array<{ filePath: string; name: string; type: string; size: number; width: number; height: number; dominantColorHex: string; dominantColorRgb: string; thumbUrl?: string }>,
    context: vscode.ExtensionContext
  ) {
    this.imageFiles = galleryImageMeta.map(img => ({
      ...img,
      src: '', // will be updated after
      thumbUrl: img.thumbUrl ?? ''
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

        const message = rawMessage as { type: string; index?: unknown; binPath?: string; indexes?: number[] };
        // Handler for explicit gallery data request (webview refresh)
        if (message.type === 'request-gallery-data') {
          this.panel.webview.postMessage({
            type: 'gallery-data',
            images: this.imageFiles
          });
          return;
        }
        // Handler for image removal
        if (message.type === 'remove-image' && Array.isArray(message.indexes)) {
          // eslint-disable-next-line no-console
          console.log('[ImageInspector] Message remove-image reçu côté extension', message.indexes);
          // Actual deletion of selected image files
          const toDelete = message.indexes
            .map(idx => this.imageFiles[idx])
            .filter(img => img && typeof img.filePath === 'string');
          Promise.all(
            toDelete.map(async img => {
              try {
                // Close VS Code editor if file is open
                const docUri = vscode.Uri.file(img.filePath);
                const openEditors = vscode.window.visibleTextEditors.filter(e => e.document.uri.fsPath === img.filePath);
                for (const editor of openEditors) {
                  await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
                  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
                await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
                await fs.unlink(img.filePath);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[ImageInspector] Erreur suppression fichier', img.filePath, err);
              }
            })
          ).then(async () => {
            // Rescan folder and rebuild image list from present files
            const files = await fs.readdir(folderUri.fsPath);
            const imageFiles = files
              .filter((f: string) => /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(f))
              .map((f: string) => path.join(folderUri.fsPath, f));
            // Mettre à jour la liste des images en mémoire
            this.imageFiles.length = 0;
            for (const filePath of imageFiles) {
              try {
                const details = await getImageDetails(filePath, undefined, {
                  includeDominantColor: true,
                  dominantColorQuality: DEFAULT_DOMINANT_COLOR_QUALITY,
                  dominantColorFastSampleSize: DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
                });
                this.imageFiles.push({
                  src: getWebviewImageSrc(this.panel.webview, filePath),
                  thumbUrl: await getGalleryThumbnailSource(filePath),
                  filePath,
                  name: details.fileName,
                  type: details.format,
                  size: details.sizeBytes,
                  width: details.width,
                  height: details.height,
                  dominantColorHex: details.dominantColorHex,
                  dominantColorRgb: details.dominantColorRgb
                });
              } catch {
                // Ignore unreadable files
              }
            }
            // Explicitly regenerate gallery HTML (without JS reload)
            try {
              const html = buildFolderGalleryWebview(
                this.panel.webview,
                folderUri.fsPath,
                this.imageFiles,
                context.extensionUri
              );
              this.panel.webview.html = html;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('Error during gallery HTML regeneration:', err);
            }
          });
          return;
        }
        // Handler for image opening
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
 * @param filePath File system path.
 * @returns True when the file extension is supported.
 */
function isSupportedImage(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(extension);
}

/**
 * Builds a user-friendly image loading error message.
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
        resolvedOptions.dominantColorQuality ?? DEFAULT_DOMINANT_COLOR_QUALITY,
        resolvedOptions.dominantColorFastSampleSize ?? DEFAULT_DOMINANT_COLOR_FAST_SAMPLE_SIZE
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
 * @param buffer PNG payload.
 * @returns Data URI string.
 */
function toPngDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Chooses the default ICO variant source for initial preview.
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
