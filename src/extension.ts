import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import sharp from 'sharp';

import {
  buildCustomEditorWebview,
  buildErrorWebview,
  type ImageDetailsViewModel
} from './webview';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.svg', '.heic', '.heif'];
const SUPPORTED_IMAGE_FILTER_EXTENSIONS = SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.replace('.', ''));

type ZoomMessage = {
  type: 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'zoom-fit';
};

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
  private readonly refreshDebounceTimers = new Map<string, NodeJS.Timeout>();

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
    const fileWatcher = this.createDocumentFileWatcher(document, webviewPanel);

    webviewPanel.onDidDispose(() => {
      if (this.activePanel === webviewPanel) {
        this.activePanel = undefined;
      }

      const refreshTimer = this.refreshDebounceTimers.get(webviewPanel.viewType + document.uri.toString());
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        this.refreshDebounceTimers.delete(webviewPanel.viewType + document.uri.toString());
      }

      fileWatcher.dispose();
    }, undefined, this.context.subscriptions);

    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activePanel = event.webviewPanel;
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
      const imageSource = await getWebviewImageSource(document.uri.fsPath, document.uri, webviewPanel.webview, cacheBuster);
      webviewPanel.title = details.fileName;
      // Lecture de la config pour la position de la toolbar
      const toolbarPosition = vscode.workspace.getConfiguration('imageInspector').get<string>('toolbarPosition', 'top');
      webviewPanel.webview.html = buildCustomEditorWebview(
        webviewPanel.webview,
        imageSource,
        details,
        this.context.extensionUri,
        { toolbarPosition }
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
      const timerKey = webviewPanel.viewType + document.uri.toString();
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

    watcher.onDidChange(() => {
      scheduleRefresh();
    }, undefined, this.context.subscriptions);

    watcher.onDidCreate(() => {
      scheduleRefresh();
    }, undefined, this.context.subscriptions);

    watcher.onDidDelete(() => {
      scheduleRefresh();
    }, undefined, this.context.subscriptions);

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
    provider
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

  context.subscriptions.push(
    providerDisposable,
    zoomInDisposable,
    zoomOutDisposable,
    zoomResetDisposable,
    zoomFitDisposable
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
  const [stats, metadata, imageStats] = await Promise.all([
    fs.stat(filePath),
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

  const previewBuffer = await sharp(filePath)
    .png()
    .toBuffer();

  return `data:image/png;base64,${previewBuffer.toString('base64')}`;
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
 * Deactivates the extension.
 */
export function deactivate(): void {
  return;
}
