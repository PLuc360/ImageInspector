// Cache size limits and in-memory stores.
const MAX_IMAGE_DETAILS_CACHE_ENTRIES = 32;
const MAX_ICO_CACHE_ENTRIES = 16;
const MAX_CONVERTED_PREVIEW_CACHE_ENTRIES = 16;
const MAX_GALLERY_THUMBNAIL_CACHE_ENTRIES = 128;
const MAX_PERSISTED_EDIT_UNDO_ENTRIES = 20;

const imageDetailsCache = new Map<string, ImageDetailsViewModel>();
const icoEntriesCache = new Map<string, IcoImageEntry[]>();
const icoGalleryCache = new Map<string, IcoVariantViewModel[]>();
const convertedPreviewCache = new Map<string, string>();
const galleryThumbnailCache = new Map<string, string>();

/**
 * Inserts a value into a cache, evicting the oldest entry when the size limit is reached.
 *
 * @param cache Target cache map.
 * @param key Cache key for the new entry.
 * @param value Value to store.
 * @param maxEntries Maximum allowed number of entries before eviction.
 */
function setBoundedCachedValue<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (cache.size >= maxEntries) {
    // Remove the oldest entry.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

/**
 * Resolves the lowercase file extension for a path.
 *
 * @param filePath Absolute or relative file path.
 * @returns Lowercase extension including the leading dot, or an empty string.
 */
function getLowercaseExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

interface ImageInspectorSettings {
  toolbarPosition: string;
  themeAccentRgb: string;
  previewBackgroundRgb: string;
  saveEditsToOriginalFile: boolean;
  pipetteLoupeDiameter: number;
  pipetteLoupeVirtualResolution: number;
  pipetteLoupeZoomAtMinImageZoom: number;
  pipetteLoupeZoomAtMaxImageZoom: number;
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
type RotationDirection = 'left' | 'right';
type MirrorAxis = 'horizontal' | 'vertical';
interface CropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ImageEditOperation =
  | { kind: 'rotate'; direction: RotationDirection }
  | { kind: 'mirror'; axis: MirrorAxis }
  | { kind: 'crop'; bounds: CropBounds };

/**
 * Validates and normalizes crop bounds received from the webview.
 *
 * @param bounds Candidate crop bounds payload.
 * @returns Sanitized crop bounds, or undefined when invalid.
 */
function sanitizeCropBounds(bounds: CropBounds | undefined): CropBounds | undefined {
  if (!bounds) {
    return undefined;
  }

  const left = Math.round(bounds.left);
  const top = Math.round(bounds.top);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  if (left < 0 || top < 0 || width <= 0 || height <= 0) {
    return undefined;
  }

  return { left, top, width, height };
}

/**
 * Minimal custom document implementation for the image preview editor.
 */
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
  private readonly editQueueByFilePath = new Map<string, Promise<void>>();
  private readonly persistedEditUndoStackByFilePath = new Map<string, Buffer[]>();
  private readonly persistedEditRedoStackByFilePath = new Map<string, Buffer[]>();
  private readonly galleryNavigationByPanel = new Map<vscode.WebviewPanel, { orderedFilePaths: string[]; currentPosition: number }>();
  private readonly pendingGalleryNavigationByUri = new Map<string, { orderedFilePaths: string[]; currentPosition: number }>();

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
      const pendingNavigationState = this.pendingGalleryNavigationByUri.get(document.uri.toString());
      if (pendingNavigationState) {
        this.galleryNavigationByPanel.set(webviewPanel, pendingNavigationState);
        this.pendingGalleryNavigationByUri.delete(document.uri.toString());
      } else {
        this.galleryNavigationByPanel.delete(webviewPanel);
      }

      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.file(path.dirname(document.uri.fsPath)),
          ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])
        ]
      };

      await this.renderPanelContent(webviewPanel, document.uri);

      const isNewPanel = !this.openPanels.has(webviewPanel);
      this.openPanels.set(webviewPanel, document.uri);
      this.activePanel = webviewPanel;

      if (isNewPanel) {
        webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
          if (!message || typeof message !== 'object' || !('type' in message)) {
            return;
          }

          const webviewMessage = message as { type: string; direction?: string; axis?: string; bounds?: CropBounds };
          const currentImageUri = this.openPanels.get(webviewPanel) ?? document.uri;
          if (webviewMessage.type === 'pick-compare-image') {
            void this.promptComparisonImageForPanel(webviewPanel, currentImageUri);
            return;
          }

          if (webviewMessage.type === 'rotate-image') {
            this.enqueueImageEditAndRefreshPanel(
              webviewPanel,
              currentImageUri,
              { kind: 'rotate', direction: webviewMessage.direction === 'left' ? 'left' : 'right' }
            );
            return;
          }

          if (webviewMessage.type === 'mirror-image') {
            this.enqueueImageEditAndRefreshPanel(
              webviewPanel,
              currentImageUri,
              { kind: 'mirror', axis: webviewMessage.axis === 'vertical' ? 'vertical' : 'horizontal' }
            );
            return;
          }

          if (webviewMessage.type === 'crop-image') {
            const cropBounds = sanitizeCropBounds(webviewMessage.bounds);
            if (!cropBounds) {
              return;
            }

            this.enqueueImageEditAndRefreshPanel(
              webviewPanel,
              currentImageUri,
              { kind: 'crop', bounds: cropBounds }
            );
            return;
          }

          if (webviewMessage.type === 'undo-image-edit') {
            this.enqueueUndoImageEditAndRefreshPanel(webviewPanel, currentImageUri);
            return;
          }

          if (webviewMessage.type === 'redo-image-edit') {
            this.enqueueRedoImageEditAndRefreshPanel(webviewPanel, currentImageUri);
            return;
          }

          if (webviewMessage.type === 'navigate-gallery-image') {
            void this.navigateGalleryImageForPanel(
              webviewPanel,
              currentImageUri,
              webviewMessage.direction === 'prev' ? 'prev' : 'next'
            );
          }
        });

        webviewPanel.onDidChangeViewState((event) => {
          if (event.webviewPanel.active) {
            this.activePanel = event.webviewPanel;
          }
        });

        webviewPanel.onDidDispose(() => {
          this.openPanels.delete(webviewPanel);
          this.galleryNavigationByPanel.delete(webviewPanel);
          if (this.activePanel === webviewPanel) {
            this.activePanel = undefined;
          }
        });
      }
    } catch (err) {
      webviewPanel.webview.html = buildErrorWebview(getImageLoadErrorMessage(document.uri.fsPath, err));
    }
  }

  /**
   * Queues image edit requests per file to prevent overlapping writes.
   *
   * Rapid successive toolbar clicks can trigger concurrent save attempts on the
   * same file, which may lead to transient file-lock errors on Windows.
   *
   * @param panel Source webview panel that triggered the action.
   * @param imageUri Image URI to edit.
   * @param operation Requested edit operation.
   */
  private enqueueImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri,
    operation: ImageEditOperation
  ): void {
    const filePath = imageUri.fsPath;
    const previousTask = this.editQueueByFilePath.get(filePath) ?? Promise.resolve();

    const nextTask = previousTask
      .catch(() => {
        // Keep queue alive even if a previous operation failed.
      })
      .then(async () => {
        await this.applyImageEditAndRefreshPanel(panel, imageUri, operation);
      })
      .finally(() => {
        if (this.editQueueByFilePath.get(filePath) === nextTask) {
          this.editQueueByFilePath.delete(filePath);
        }
      });

    this.editQueueByFilePath.set(filePath, nextTask);
  }

  /**
   * Queues persisted image undo requests per file to prevent overlapping writes.
   *
   * @param panel Source webview panel that triggered the undo action.
   * @param imageUri Image URI to restore.
   */
  private enqueueUndoImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri
  ): void {
    const filePath = imageUri.fsPath;
    const previousTask = this.editQueueByFilePath.get(filePath) ?? Promise.resolve();

    const nextTask = previousTask
      .catch(() => {
        // Keep queue alive even if a previous operation failed.
      })
      .then(async () => {
        await this.undoImageEditAndRefreshPanel(panel, imageUri);
      })
      .finally(() => {
        if (this.editQueueByFilePath.get(filePath) === nextTask) {
          this.editQueueByFilePath.delete(filePath);
        }
      });

    this.editQueueByFilePath.set(filePath, nextTask);
  }

  /**
   * Queues persisted image redo requests per file to prevent overlapping writes.
   *
   * @param panel Source webview panel that triggered the redo action.
   * @param imageUri Image URI to reapply.
   */
  private enqueueRedoImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri
  ): void {
    const filePath = imageUri.fsPath;
    const previousTask = this.editQueueByFilePath.get(filePath) ?? Promise.resolve();

    const nextTask = previousTask
      .catch(() => {
        // Keep queue alive even if a previous operation failed.
      })
      .then(async () => {
        await this.redoImageEditAndRefreshPanel(panel, imageUri);
      })
      .finally(() => {
        if (this.editQueueByFilePath.get(filePath) === nextTask) {
          this.editQueueByFilePath.delete(filePath);
        }
      });

    this.editQueueByFilePath.set(filePath, nextTask);
  }

  /**
   * Renders the image details webview HTML for a specific panel and image.
   *
   * @param panel Target webview panel.
   * @param imageUri Image URI to render.
   */
  private async renderPanelContent(panel: vscode.WebviewPanel, imageUri: vscode.Uri): Promise<void> {
    const filePath = imageUri.fsPath;
    const settings = getImageInspectorSettings();
    const galleryNavigationState = this.galleryNavigationByPanel.get(panel);
    const navigationPosition = galleryNavigationState
      ? galleryNavigationState.orderedFilePaths.findIndex((candidatePath) => candidatePath === filePath)
      : -1;
    const hasGalleryNavigation = !!galleryNavigationState
      && navigationPosition >= 0
      && galleryNavigationState.orderedFilePaths.length > 1;
    const icoVariants = getLowercaseExtension(filePath) === '.ico'
      ? await getIcoGalleryItems(filePath)
      : [];
    const fileVersionInfo = await getFileVersionInfo(filePath);
    const details = await getImageDetails(filePath, fileVersionInfo);
    const imageSrc = await getWebviewImageSource(
      filePath,
      fileVersionInfo.key
    );

    panel.webview.html = buildCustomEditorWebview(
      panel.webview,
      imageSrc,
      details,
      this.context.extensionUri,
      {
        toolbarPosition: settings.toolbarPosition,
        themeAccentRgb: settings.themeAccentRgb,
        saveEditsToOriginalFile: settings.saveEditsToOriginalFile,
        canUndoPersistedEdit: this.canUndoPersistedEdit(filePath),
        canRedoPersistedEdit: this.canRedoPersistedEdit(filePath),
        icoVariants,
        galleryNavigation: {
          enabled: hasGalleryNavigation,
          hasPrevious: hasGalleryNavigation && navigationPosition > 0,
          hasNext: hasGalleryNavigation && navigationPosition < galleryNavigationState.orderedFilePaths.length - 1,
          positionLabel: hasGalleryNavigation
            ? `${String(navigationPosition + 1)} / ${String(galleryNavigationState.orderedFilePaths.length)}`
            : ''
        },
        pipetteLoupeDiameter: settings.pipetteLoupeDiameter,
        pipetteLoupeVirtualResolution: settings.pipetteLoupeVirtualResolution,
        pipetteLoupeZoomAtMinImageZoom: settings.pipetteLoupeZoomAtMinImageZoom,
        pipetteLoupeZoomAtMaxImageZoom: settings.pipetteLoupeZoomAtMaxImageZoom
      }
    );
  }

  /**
   * Applies gallery navigation state to a panel.
   *
   * @param panel Target webview panel.
   * @param orderedFilePaths Gallery file paths ordered as rendered in the gallery.
   * @param currentPosition Current image position in the ordered list.
   */
  private setGalleryNavigationForPanel(
    panel: vscode.WebviewPanel,
    orderedFilePaths: string[],
    currentPosition: number
  ): void {
    const normalizedPaths = Array.from(new Set(
      orderedFilePaths
        .map((candidatePath) => String(candidatePath || '').trim())
        .filter((candidatePath) => candidatePath.length > 0)
    ));

    if (normalizedPaths.length <= 1 || currentPosition < 0 || currentPosition >= normalizedPaths.length) {
      this.galleryNavigationByPanel.delete(panel);
      return;
    }

    this.galleryNavigationByPanel.set(panel, {
      orderedFilePaths: normalizedPaths,
      currentPosition
    });
  }

  /**
   * Navigates to the previous or next image within current gallery order.
   *
   * @param panel Target webview panel.
   * @param currentImageUri Currently displayed image URI.
   * @param direction Navigation direction.
   */
  private async navigateGalleryImageForPanel(
    panel: vscode.WebviewPanel,
    currentImageUri: vscode.Uri,
    direction: 'prev' | 'next'
  ): Promise<void> {
    const navigationState = this.galleryNavigationByPanel.get(panel);
    if (!navigationState || navigationState.orderedFilePaths.length <= 1) {
      return;
    }

    const currentIndex = navigationState.orderedFilePaths.findIndex((filePath) => filePath === currentImageUri.fsPath);
    if (currentIndex < 0) {
      this.galleryNavigationByPanel.delete(panel);
      await this.renderPanelContent(panel, currentImageUri);
      this.openPanels.set(panel, currentImageUri);
      return;
    }

    const nextIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= navigationState.orderedFilePaths.length) {
      return;
    }

    const nextUri = vscode.Uri.file(navigationState.orderedFilePaths[nextIndex]);
    this.setGalleryNavigationForPanel(panel, navigationState.orderedFilePaths, nextIndex);
    this.openPanels.set(panel, nextUri);
    panel.title = path.basename(nextUri.fsPath);
    await this.renderPanelContent(panel, nextUri);
  }

  /**
   * Applies one image edit operation to the current file, then refreshes the panel.
   *
   * @param panel Source webview panel that triggered the action.
   * @param imageUri Image URI to edit.
   * @param operation Requested edit operation.
   */
  private async applyImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri,
    operation: ImageEditOperation
  ): Promise<void> {
    const settings = getImageInspectorSettings();
    if (!settings.saveEditsToOriginalFile) {
      return;
    }

    try {
      const originalBuffer = await fs.readFile(imageUri.fsPath);
      const editedBuffer = await this.getEditedImageBuffer(imageUri.fsPath, operation);
      this.pushPersistedUndoBuffer(imageUri.fsPath, originalBuffer);
      this.clearPersistedRedoBuffers(imageUri.fsPath);
      await this.writeEditedBufferToFile(imageUri.fsPath, editedBuffer);
      invalidateFileCaches(imageUri.fsPath);

      // Notify open gallery panels that this image has been modified.
      void ImageFolderGalleryPanel.notifyImageFileChanged(imageUri.fsPath);

      await this.renderPanelContent(panel, imageUri);
    } catch (error) {
      const errorMessage = getImageLoadErrorMessage(imageUri.fsPath, error);
      const osErrorCode = getNodeLikeErrorCode(error);
      const actionLabel = operation.kind === 'rotate'
        ? 'rotated'
        : operation.kind === 'mirror'
          ? operation.axis === 'horizontal'
            ? 'mirrored horizontally'
            : 'mirrored vertically'
          : 'cropped';
      void vscode.window.showErrorMessage(
        `Unable to save the ${actionLabel} image. ${errorMessage}${osErrorCode ? ` (code: ${osErrorCode})` : ''} Ensure the file is writable and not locked by another application.`
      );
    }
  }

  /**
   * Restores the previous persisted image state for the given file, then refreshes the panel.
   *
   * @param panel Source webview panel that triggered the undo action.
   * @param imageUri Image URI to restore.
   */
  private async undoImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri
  ): Promise<void> {
    const settings = getImageInspectorSettings();
    if (!settings.saveEditsToOriginalFile) {
      return;
    }

    const previousBuffer = this.popPersistedUndoBuffer(imageUri.fsPath);
    if (!previousBuffer) {
      return;
    }

    try {
      const currentBuffer = await fs.readFile(imageUri.fsPath);
      this.pushPersistedRedoBuffer(imageUri.fsPath, currentBuffer);
      await this.writeEditedBufferToFile(imageUri.fsPath, previousBuffer);
      invalidateFileCaches(imageUri.fsPath);

      // Notify open gallery panels that this image has been restored.
      void ImageFolderGalleryPanel.notifyImageFileChanged(imageUri.fsPath);

      await this.renderPanelContent(panel, imageUri);
    } catch (error) {
      this.pushPersistedUndoBuffer(imageUri.fsPath, previousBuffer);
      const errorMessage = getImageLoadErrorMessage(imageUri.fsPath, error);
      const osErrorCode = getNodeLikeErrorCode(error);
      void vscode.window.showErrorMessage(
        `Unable to undo the last saved image edit. ${errorMessage}${osErrorCode ? ` (code: ${osErrorCode})` : ''} Ensure the file is writable and not locked by another application.`
      );
    }
  }

  /**
   * Reapplies the next persisted image state for the given file, then refreshes the panel.
   *
   * @param panel Source webview panel that triggered the redo action.
   * @param imageUri Image URI to reapply.
   */
  private async redoImageEditAndRefreshPanel(
    panel: vscode.WebviewPanel,
    imageUri: vscode.Uri
  ): Promise<void> {
    const settings = getImageInspectorSettings();
    if (!settings.saveEditsToOriginalFile) {
      return;
    }

    const nextBuffer = this.popPersistedRedoBuffer(imageUri.fsPath);
    if (!nextBuffer) {
      return;
    }

    try {
      const currentBuffer = await fs.readFile(imageUri.fsPath);
      this.pushPersistedUndoBuffer(imageUri.fsPath, currentBuffer);
      await this.writeEditedBufferToFile(imageUri.fsPath, nextBuffer);
      invalidateFileCaches(imageUri.fsPath);

      // Notify open gallery panels that this image has been restored.
      void ImageFolderGalleryPanel.notifyImageFileChanged(imageUri.fsPath);

      await this.renderPanelContent(panel, imageUri);
    } catch (error) {
      this.pushPersistedRedoBuffer(imageUri.fsPath, nextBuffer);
      const errorMessage = getImageLoadErrorMessage(imageUri.fsPath, error);
      const osErrorCode = getNodeLikeErrorCode(error);
      void vscode.window.showErrorMessage(
        `Unable to redo the last saved image edit. ${errorMessage}${osErrorCode ? ` (code: ${osErrorCode})` : ''} Ensure the file is writable and not locked by another application.`
      );
    }
  }

  /**
   * Returns whether a persisted image edit can currently be undone for the given file.
   *
   * @param filePath Absolute image file path.
   * @returns True when an undo buffer is available.
   */
  private canUndoPersistedEdit(filePath: string): boolean {
    return (this.persistedEditUndoStackByFilePath.get(filePath)?.length ?? 0) > 0;
  }

  /**
   * Returns whether a persisted image edit can currently be redone for the given file.
   *
   * @param filePath Absolute image file path.
   * @returns True when a redo buffer is available.
   */
  private canRedoPersistedEdit(filePath: string): boolean {
    return (this.persistedEditRedoStackByFilePath.get(filePath)?.length ?? 0) > 0;
  }

  /**
   * Pushes a new undo buffer for a persisted edit, trimming the stack to its configured max size.
   *
   * @param filePath Absolute image file path.
   * @param buffer Previous file bytes to restore when undoing.
   */
  private pushPersistedUndoBuffer(filePath: string, buffer: Buffer): void {
    const existingStack = this.persistedEditUndoStackByFilePath.get(filePath) ?? [];
    existingStack.push(Buffer.from(buffer));
    if (existingStack.length > MAX_PERSISTED_EDIT_UNDO_ENTRIES) {
      existingStack.splice(0, existingStack.length - MAX_PERSISTED_EDIT_UNDO_ENTRIES);
    }

    this.persistedEditUndoStackByFilePath.set(filePath, existingStack);
  }

  /**
   * Pushes a new redo buffer for a persisted edit, trimming the stack to its configured max size.
   *
   * @param filePath Absolute image file path.
   * @param buffer Next file bytes to restore when redoing.
   */
  private pushPersistedRedoBuffer(filePath: string, buffer: Buffer): void {
    const existingStack = this.persistedEditRedoStackByFilePath.get(filePath) ?? [];
    existingStack.push(Buffer.from(buffer));
    if (existingStack.length > MAX_PERSISTED_EDIT_UNDO_ENTRIES) {
      existingStack.splice(0, existingStack.length - MAX_PERSISTED_EDIT_UNDO_ENTRIES);
    }

    this.persistedEditRedoStackByFilePath.set(filePath, existingStack);
  }

  /**
   * Clears persisted redo history for a file after a new edit branch is created.
   *
   * @param filePath Absolute image file path.
   */
  private clearPersistedRedoBuffers(filePath: string): void {
    this.persistedEditRedoStackByFilePath.delete(filePath);
  }

  /**
   * Pops the most recent persisted undo buffer for a file.
   *
   * @param filePath Absolute image file path.
   * @returns Previous file bytes, or undefined when no undo is available.
   */
  private popPersistedUndoBuffer(filePath: string): Buffer | undefined {
    const existingStack = this.persistedEditUndoStackByFilePath.get(filePath);
    if (!existingStack || existingStack.length === 0) {
      return undefined;
    }

    const previousBuffer = existingStack.pop();
    if (!previousBuffer) {
      return undefined;
    }

    if (existingStack.length === 0) {
      this.persistedEditUndoStackByFilePath.delete(filePath);
    } else {
      this.persistedEditUndoStackByFilePath.set(filePath, existingStack);
    }

    return previousBuffer;
  }

  /**
   * Pops the most recent persisted redo buffer for a file.
   *
   * @param filePath Absolute image file path.
   * @returns Redo file bytes, or undefined when no redo is available.
   */
  private popPersistedRedoBuffer(filePath: string): Buffer | undefined {
    const existingStack = this.persistedEditRedoStackByFilePath.get(filePath);
    if (!existingStack || existingStack.length === 0) {
      return undefined;
    }

    const nextBuffer = existingStack.pop();
    if (!nextBuffer) {
      return undefined;
    }

    if (existingStack.length === 0) {
      this.persistedEditRedoStackByFilePath.delete(filePath);
    } else {
      this.persistedEditRedoStackByFilePath.set(filePath, existingStack);
    }

    return nextBuffer;
  }

  /**
   * Builds edited image bytes while preserving the original file format semantics.
   *
   * Raster formats keep using Sharp, whereas SVG files are rewritten as SVG markup so
   * the saved file still matches its `.svg` extension.
   *
   * @param targetPath Absolute file path of the image to edit.
   * @param operation Requested edit operation.
   * @returns Edited image payload ready to be written back to disk.
   */
  private async getEditedImageBuffer(targetPath: string, operation: ImageEditOperation): Promise<Buffer> {
    if (getLowercaseExtension(targetPath) === '.svg') {
      if (operation.kind === 'crop') {
        throw new Error('Cropping SVG files is not supported when saving to the original file.');
      }

      return operation.kind === 'rotate'
        ? rotateSvgFile(targetPath, operation.direction)
        : mirrorSvgFile(targetPath, operation.axis);
    }

    const sharp = await getSharp();
    const sourceBuffer = await fs.readFile(targetPath);
    let sharpPipeline = sharp(sourceBuffer, { animated: true });

    if (operation.kind === 'rotate') {
      sharpPipeline = sharpPipeline.rotate(operation.direction === 'left' ? -90 : 90);
    } else if (operation.kind === 'mirror' && operation.axis === 'horizontal') {
      sharpPipeline = sharpPipeline.flop();
    } else if (operation.kind === 'mirror') {
      sharpPipeline = sharpPipeline.flip();
    } else {
      sharpPipeline = sharpPipeline.extract(operation.bounds);
    }

    return sharpPipeline.toBuffer();
  }

  /**
   * Writes an edited image buffer to disk using a temporary file replacement strategy.
   *
   * This avoids partial writes and reduces file locking issues on Windows when
   * the original file is being read by another process.
   *
  * @param targetPath Absolute path of the image file to overwrite.
  * @param buffer Edited image bytes.
   */
  private async writeEditedBufferToFile(targetPath: string, buffer: Buffer): Promise<void> {
    await cleanupStaleImageInspectorTempFiles(path.dirname(targetPath));

    const tempFilePath = path.join(
      path.dirname(targetPath),
      `.imageinspector-edit-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
    );

    // First try direct overwrite, which can succeed even when replace/delete is blocked.
    try {
      await this.writeFileWithRetries(targetPath, buffer);
      return;
    } catch {
      // Fallback to temp-file replacement strategy.
    }

    try {
      await fs.writeFile(tempFilePath, buffer);
      await this.replaceFileWithRetries(tempFilePath, targetPath);
      await cleanupStaleImageInspectorTempFiles(path.dirname(targetPath));
    } catch (error) {
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup failures.
      }

      throw error;
    }
  }

  /**
   * Writes a file with retries to tolerate transient lock/contention errors.
   *
   * @param targetPath Destination file path.
   * @param buffer File bytes to write.
   */
  private async writeFileWithRetries(targetPath: string, buffer: Buffer): Promise<void> {
    const retryDelaysMs = [80, 160, 320, 640, 1000];
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex += 1) {
      try {
        await fs.writeFile(targetPath, buffer);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableFileReplaceError(error) || attemptIndex === retryDelaysMs.length) {
          break;
        }

        await this.waitForMilliseconds(retryDelaysMs[attemptIndex]);
      }
    }

    throw lastError;
  }

  /**
   * Replaces a target file from a temporary file with retries for transient Windows locks.
   *
   * @param tempFilePath Path to the temporary file.
   * @param targetPath Path to the destination file.
   */
  private async replaceFileWithRetries(tempFilePath: string, targetPath: string): Promise<void> {
    const retryDelaysMs = [80, 160, 320, 640, 1000];
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex += 1) {
      try {
        await this.replaceFileOnce(tempFilePath, targetPath);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableFileReplaceError(error) || attemptIndex === retryDelaysMs.length) {
          break;
        }

        await this.waitForMilliseconds(retryDelaysMs[attemptIndex]);
      }
    }

    throw lastError;
  }

  /**
   * Performs one file replacement attempt using unlink + rename.
   *
   * @param tempFilePath Path to the temporary file.
   * @param targetPath Path to the destination file.
   */
  private async replaceFileOnce(tempFilePath: string, targetPath: string): Promise<void> {
    try {
      await fs.unlink(targetPath);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';

      if (code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.rename(tempFilePath, targetPath);
  }

  /**
   * Detects whether a file-replacement error is likely transient and worth retrying.
   *
   * @param error Caught error.
   * @returns True when retrying is relevant.
   */
  private isRetryableFileReplaceError(error: unknown): boolean {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

    return code === 'UNKNOWN'
      || code === 'EPERM'
      || code === 'EBUSY'
      || code === 'EACCES'
      || code === 'ENOTEMPTY';
  }

  /**
   * Waits for a short amount of time.
   *
   * @param milliseconds Delay duration.
   */
  private async waitForMilliseconds(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
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
  refreshActivePanelFromConfiguration(): void {
    const settings = getImageInspectorSettings();

    for (const panel of this.openPanels.keys()) {
      void panel.webview.postMessage({
        type: 'update-settings',
        settings
      });
    }
  }

  /**
   * Opens the primary image and loads the second image in comparison mode.
   * @param primaryImageUri Base image URI shown in the viewer.
   * @param comparisonImageUri Secondary image URI used for the comparison.
   * @param viewMode Comparison mode to activate.
   */
  async openComparisonForImages(
    primaryImageUri: vscode.Uri,
    comparisonImageUri: vscode.Uri,
    viewMode: CompareViewMode
  ): Promise<void> {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      primaryImageUri,
      ImageDetailsCustomEditorProvider.viewType
    );

    const panel = await this.waitForPanelForUri(primaryImageUri);
    if (!panel) {
      void vscode.window.showWarningMessage('Unable to open the selected image comparison.');
      return;
    }

    await this.setComparisonImageForPanel(panel, comparisonImageUri, viewMode);
  }

  /**
   * Opens an image and preserves gallery ordering to enable prev/next navigation.
   *
   * @param imageFiles Gallery items currently known by the host.
   * @param selectedIndex Index of the image to open.
   * @param navigationOrderIndexes Gallery indexes ordered as displayed in the webview.
   */
  async openImageFromGallery(
    imageFiles: Array<{ filePath: string }>,
    selectedIndex: number,
    navigationOrderIndexes: unknown[]
  ): Promise<void> {
    const safeSelectedIndex = Math.trunc(selectedIndex);
    if (safeSelectedIndex < 0 || safeSelectedIndex >= imageFiles.length) {
      return;
    }

    const normalizedOrder = Array.from(new Set(
      navigationOrderIndexes
        .filter((index): index is number => typeof index === 'number' && Number.isInteger(index))
        .map((index) => Math.trunc(index))
        .filter((index) => index >= 0 && index < imageFiles.length)
    ));

    const fallbackOrder = imageFiles.map((_, index) => index);
    const effectiveOrder = normalizedOrder.length > 1 ? normalizedOrder : fallbackOrder;
    const currentPosition = effectiveOrder.indexOf(safeSelectedIndex);
    if (currentPosition < 0) {
      return;
    }

    const orderedFilePaths = effectiveOrder
      .map((index) => imageFiles[index]?.filePath)
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0);

    const currentImageUri = vscode.Uri.file(imageFiles[safeSelectedIndex].filePath);
    this.pendingGalleryNavigationByUri.set(currentImageUri.toString(), {
      orderedFilePaths,
      currentPosition
    });

    await vscode.commands.executeCommand(
      'vscode.openWith',
      currentImageUri,
      ImageDetailsCustomEditorProvider.viewType
    );
  }

  /**
   * Synchronizes navigation order for opened Image Details panels in one folder.
   *
   * @param folderPath Absolute folder path owning the gallery.
   * @param imageFiles Current gallery image list.
   * @param navigationOrderIndexes Indexes in current gallery rendered order.
   */
  syncGalleryNavigationOrderForFolder(
    folderPath: string,
    imageFiles: Array<{ filePath: string }>,
    navigationOrderIndexes: unknown
  ): void {
    if (!Array.isArray(navigationOrderIndexes)) {
      return;
    }

    const normalizedOrder = Array.from(new Set(
      navigationOrderIndexes
        .filter((index): index is number => typeof index === 'number' && Number.isInteger(index))
        .map((index) => Math.trunc(index))
        .filter((index) => index >= 0 && index < imageFiles.length)
    ));

    const orderedFilePaths = Array.from(new Set(
      normalizedOrder
        .map((index) => imageFiles[index]?.filePath)
        .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    ));

    for (const [panel, openedUri] of this.openPanels.entries()) {
      if (path.dirname(openedUri.fsPath) !== folderPath) {
        continue;
      }

      const currentPosition = orderedFilePaths.findIndex((filePath) => filePath === openedUri.fsPath);
      const hasNavigation = currentPosition >= 0 && orderedFilePaths.length > 1;

      if (hasNavigation) {
        this.setGalleryNavigationForPanel(panel, orderedFilePaths, currentPosition);
      } else {
        this.galleryNavigationByPanel.delete(panel);
      }

      void panel.webview.postMessage({
        type: 'update-gallery-navigation',
        navigation: {
          enabled: hasNavigation,
          hasPrevious: hasNavigation && currentPosition > 0,
          hasNext: hasNavigation && currentPosition < orderedFilePaths.length - 1,
          positionLabel: hasNavigation ? `${String(currentPosition + 1)} / ${String(orderedFilePaths.length)}` : ''
        }
      });
    }
  }

  /**
   * Finds an opened image inspector panel for the given image URI.
   * @param imageUri Image URI associated with the panel.
   * @returns Matching webview panel when available.
   */
  private findPanelForUri(imageUri: vscode.Uri): vscode.WebviewPanel | undefined {
    for (const [panel, openedUri] of this.openPanels.entries()) {
      if (openedUri.toString() === imageUri.toString()) {
        return panel;
      }
    }

    return undefined;
  }

  /**
   * Waits briefly for the panel associated with the given URI to be ready.
   * @param imageUri Image URI associated with the panel.
   * @returns Resolved webview panel when it becomes available.
   */
  private async waitForPanelForUri(imageUri: vscode.Uri): Promise<vscode.WebviewPanel | undefined> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const panel = this.findPanelForUri(imageUri);
      if (panel) {
        return panel;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return undefined;
  }

  /**
   * Sends the comparison image to the target webview panel.
   * @param panel Target image inspector panel.
   * @param comparisonImageUri Comparison image URI.
   * @param viewMode Comparison mode to activate when provided.
   */
  private async setComparisonImageForPanel(
    panel: vscode.WebviewPanel,
    comparisonImageUri: vscode.Uri,
    viewMode?: CompareViewMode
  ): Promise<void> {
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

    const comparisonFileVersion = await getFileVersionInfo(comparisonImageUri.fsPath);

    await panel.webview.postMessage({
      type: 'set-compare-image',
      source: await getWebviewImageSource(
        comparisonImageUri.fsPath,
        comparisonFileVersion.key
      ),
      label: path.basename(comparisonImageUri.fsPath),
      ...(viewMode ? { mode: viewMode } : {})
    });
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

    await this.setComparisonImageForPanel(panel, comparisonImageUri);
  }
}
// Types and constants for gallery and inspector.
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.ico', '.svg', '.heic', '.heif'];
const SUPPORTED_IMAGE_FILTER_EXTENSIONS = SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.replace('.', ''));
const DEFAULT_THEME_ACCENT_HEX = '#00C86E';
const DEFAULT_IMAGE_DETAILS_BACKGROUND_HEX_DARK_THEME = '#F3F3F3';
const DEFAULT_IMAGE_DETAILS_BACKGROUND_HEX_LIGHT_THEME = '#202020';

type CompareViewMode = 'split' | 'side-by-side';

interface DuplicateGroupMessage {
  thumbnailSrc: string;
  fileNames: string[];
  filePaths: string[];
  fileCount: number;
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';

// Buffer is global in Node.js, but can be imported explicitly if needed.
import { Buffer } from 'buffer';
import * as vscode from 'vscode';
import {
  buildCustomEditorWebview,
  buildDuplicateResultsWebview,
  buildErrorWebview,
  buildFolderGalleryLoadingWebview,
  buildFolderGalleryWebview,
  type IcoVariantViewModel,
  type ImageDetailsViewModel
} from './webview';

type SharpModule = typeof import('sharp');

let sharpModulePromise: Promise<SharpModule> | undefined;

/**
 * Loads `sharp` lazily so the gallery can appear before native image processing starts.
 *
 * @returns The `sharp` image processing factory.
 */
async function getSharp(): Promise<SharpModule> {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp').then((module) => {
      const resolvedSharp = (module as unknown as { default?: SharpModule }).default
        ?? (module as unknown as SharpModule);
      return resolvedSharp;
    });
  }

  return sharpModulePromise;
}
// Utilities for file version management (cache and refresh).
type FileVersionInfo = {
  key: string;
  sizeBytes: number;
  mtimeMs: number;
};

/**
        previewBackgroundRgb: settings.previewBackgroundRgb,
 * Builds a stable cache key that encodes the file path, size and modification timestamp.
 *
 * @param filePath Absolute file path.
 * @param size File size in bytes.
 * @param mtimeMs Last-modified timestamp in milliseconds.
 * @returns Unique string key for caching purposes.
 */
function buildFileVersionKey(filePath: string, size: number, mtimeMs: number): string {
  return `${filePath}::${String(size)}::${String(mtimeMs)}`;
}

/**
 * Invalidates all in-memory caches associated with one file path.
 * @param filePath Absolute file path whose cached entries should be removed.
 */
function invalidateFileCaches(filePath: string): void {
  const cacheKeyPrefix = `${filePath}::`;
  deleteCachedEntriesByPrefix(imageDetailsCache, cacheKeyPrefix);
  deleteCachedEntriesByPrefix(icoEntriesCache, cacheKeyPrefix);
  deleteCachedEntriesByPrefix(icoGalleryCache, cacheKeyPrefix);
  deleteCachedEntriesByPrefix(convertedPreviewCache, cacheKeyPrefix);
  deleteCachedEntriesByPrefix(galleryThumbnailCache, cacheKeyPrefix);
}

/**
 * Deletes all cache entries whose key starts with the provided prefix.
 * @param cache Target cache map.
 * @param cacheKeyPrefix Prefix used to identify entries to remove.
 */
function deleteCachedEntriesByPrefix<T>(cache: Map<string, T>, cacheKeyPrefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(cacheKeyPrefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Reads file stats and returns a stable version key for caching.
 *
 * @param filePath Absolute file path.
 * @returns Version key string encoding path, size and mtime.
 */
async function getFileVersionKey(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return buildFileVersionKey(filePath, stats.size, stats.mtimeMs);
}

/**
 * Reads file stats and returns a structured version info object.
 *
 * @param filePath Absolute file path.
 * @returns Object containing the version key, size in bytes and mtime.
 */
async function getFileVersionInfo(filePath: string): Promise<FileVersionInfo> {
  const stats = await fs.stat(filePath);
  const sizeBytes = typeof stats.size === 'bigint' ? Number(stats.size) : stats.size;
  const mtimeMs = typeof stats.mtimeMs === 'number' && Number.isFinite(stats.mtimeMs)
    ? stats.mtimeMs
    : 0;
  return {
    key: buildFileVersionKey(filePath, sizeBytes, mtimeMs),
    sizeBytes,
    mtimeMs
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
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { sensitivity: 'base', numeric: true }));
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
  const cachedThumbnail = galleryThumbnailCache.get(resolvedFileVersion.key);
  if (cachedThumbnail) {
    return cachedThumbnail;
  }

  const sourceExtension = getLowercaseExtension(filePath);

  // ICO payloads are not always decodable by sharp on every platform/build.
  // Prefer an extracted ICO variant first to keep thumbnails available.
  if (sourceExtension === '.ico') {
    try {
      const icoVariants = await getIcoGalleryItems(filePath);
      if (icoVariants.length > 0) {
        const icoPreviewSource = getDefaultIcoVariantSource(icoVariants);
        setBoundedCachedValue(galleryThumbnailCache, resolvedFileVersion.key, icoPreviewSource, MAX_GALLERY_THUMBNAIL_CACHE_ENTRIES);
        return icoPreviewSource;
      }
    } catch {
      // Fall back to standard thumbnail generation below.
    }
  }

  try {
    const sharp = await getSharp();
    const sharpInput = await fs.readFile(filePath);
    const thumbnailBuffer = await sharp(sharpInput)
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
    if (sourceExtension === '.ico') {
      try {
        const icoBuffer = await fs.readFile(filePath);
        const icoSource = `data:image/x-icon;base64,${icoBuffer.toString('base64')}`;
        setBoundedCachedValue(galleryThumbnailCache, resolvedFileVersion.key, icoSource, MAX_GALLERY_THUMBNAIL_CACHE_ENTRIES);
        return icoSource;
      } catch {
        // Ignore fallback errors.
      }
    }

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
  private readonly folderUri: vscode.Uri;
  private readonly extensionUri: vscode.Uri;
  private readonly imageFiles: Array<{ src: string; thumbUrl?: string; filePath: string; name: string; type: string; size: number; width: number; height: number; mtimeMs: number }>;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private duplicateResultsPanel: vscode.WebviewPanel | undefined;
  private isDisposed = false;
  private deleteSelectionConfirmationInProgress = false;
  private refreshGeneration = 0;
  private duplicateScanGeneration = 0;
  private duplicateScanRunning = false;
  private duplicateScanProgress: { active: boolean; completed: number; total: number; label: string } = {
    active: false,
    completed: 0,
    total: 0,
    label: 'Scanning files...'
  };
  private duplicateScanStatus = 'Idle';
  private duplicateGroups: DuplicateGroupMessage[] = [];

  /**
   * Opens or reveals the gallery panel for the given folder.
   *
   * @param folderUri URI of the folder to display images from.
   * @param context Extension context.
   * @param provider Shared image details provider used to open comparisons.
   */
  static async open(
    folderUri: vscode.Uri,
    context: vscode.ExtensionContext,
    provider: ImageDetailsCustomEditorProvider
  ): Promise<void> {
    const folderPath = folderUri.fsPath;
    const existing = ImageFolderGalleryPanel.activePanels.get(folderPath);
    if (existing) {
      existing.panel.reveal();
      void existing.refreshFromSettings(getImageInspectorSettings());
      return;
    }

    const instance = new ImageFolderGalleryPanel(folderUri, context, provider);
    ImageFolderGalleryPanel.activePanels.set(folderPath, instance);

    try {
      await instance.initializeGalleryContent();
    } catch (error) {
      if (!instance.isDisposed) {
        instance.panel.title = `Gallery: ${path.basename(folderPath)}`;
        instance.panel.webview.html = buildErrorWebview(getImageLoadErrorMessage(folderPath, error));
      }
      ImageFolderGalleryPanel.activePanels.delete(folderPath);
    }
  }

  /**
   * Refreshes runtime settings for all opened gallery panels.
   */
  static refreshActivePanelsFromConfiguration(): void {
    const settings = getImageInspectorSettings();

    for (const panel of ImageFolderGalleryPanel.activePanels.values()) {
      void panel.refreshFromSettings(settings);
    }
  }

  /**
   * Requests deletion of selected images in the currently active gallery panel.
   * @returns True when a gallery panel was targeted.
   */
  static async requestDeleteSelectedInActivePanel(): Promise<boolean> {
    for (const galleryPanel of ImageFolderGalleryPanel.activePanels.values()) {
      if (!galleryPanel.panel.active || galleryPanel.isDisposed) {
        continue;
      }

      await galleryPanel.panel.webview.postMessage({ type: 'trigger-delete-selected' });
      return true;
    }

    return false;
  }

  /**
   * Notifies gallery panels that an image file has been modified.
   * Updates the thumbnail and metadata in any gallery panel showing the file's folder.
   *
   * @param changedFilePath Absolute path to the image file that was modified.
   */
  static async notifyImageFileChanged(changedFilePath: string): Promise<void> {
    const parentFolder = path.dirname(changedFilePath);
    const galleryPanel = ImageFolderGalleryPanel.activePanels.get(parentFolder);
    if (!galleryPanel || galleryPanel.isDisposed) {
      return;
    }

    try {
      const fileVersionInfo = await getFileVersionInfo(changedFilePath);
      const details = await getImageDetails(changedFilePath, fileVersionInfo);
      const thumbUrl = await getGalleryThumbnailSource(changedFilePath, fileVersionInfo);

      const currentIndex = galleryPanel.imageFiles.findIndex((img) => img.filePath === changedFilePath);
      if (currentIndex === -1) {
        return;
      }

      const updatedMeta = {
        src: '',
        thumbUrl,
        filePath: changedFilePath,
        name: details.fileName,
        type: details.format,
        size: details.sizeBytes,
        width: details.width,
        height: details.height,
        mtimeMs: fileVersionInfo.mtimeMs
      };

      galleryPanel.imageFiles[currentIndex] = updatedMeta;
      await galleryPanel.panel.webview.postMessage({
        type: 'update-image-meta',
        index: currentIndex,
        filePath: changedFilePath,
        meta: updatedMeta
      });
    } catch {
      // Silently ignore errors while notifying the gallery.
    }
  }

  /**
   * Loads the folder images and progressively enriches the gallery metadata.
   */
  private async initializeGalleryContent(): Promise<void> {
    const folderPath = this.folderUri.fsPath;
    const imagePaths = await scanFolderImages(folderPath);

    if (this.isDisposed) {
      return;
    }

    this.imageFiles.length = 0;
    this.imageFiles.push(...imagePaths.map((filePath) => ({
      src: '',
      thumbUrl: '',
      filePath,
      name: path.basename(filePath),
      type: 'Loading...',
      size: 0,
      width: 0,
      height: 0,
      mtimeMs: 0
    })));

    const settings = getImageInspectorSettings();
    this.panel.title = `Gallery: ${path.basename(folderPath)}`;
    this.panel.webview.html = buildFolderGalleryWebview(
      this.panel.webview,
      folderPath,
      this.imageFiles,
      this.extensionUri,
      {
        themeAccentRgb: settings.themeAccentRgb,
        initialProgress: {
          active: imagePaths.length > 0,
          completed: 0,
          total: imagePaths.length,
          label: 'Loading gallery metadata...'
        }
      }
    );

    const initialRefreshGeneration = this.refreshGeneration;
    const initialTotal = imagePaths.length;
    let initialCompleted = 0;
    const postInitialProgress = (force = false): void => {
      if (this.isDisposed || initialRefreshGeneration !== this.refreshGeneration) {
        return;
      }

      if (!force && initialCompleted < initialTotal && initialCompleted % 8 !== 0) {
        return;
      }

      void this.panel.webview.postMessage({
        type: 'gallery-load-progress',
        active: initialCompleted < initialTotal,
        completed: initialCompleted,
        total: initialTotal,
        label: 'Loading gallery metadata...'
      });
    };

    postInitialProgress(true);
    if (initialTotal === 0) {
      void this.panel.webview.postMessage({
        type: 'gallery-load-progress',
        active: false,
        completed: 0,
        total: 0,
        label: 'Loading gallery metadata...'
      });
      return;
    }

    void processWithConcurrencyLimit(imagePaths, 4, async (filePath) => {
      try {
        if (this.isDisposed || initialRefreshGeneration !== this.refreshGeneration) {
          return;
        }

        const fileVersionInfo = await getFileVersionInfo(filePath);
        const [details, thumbUrl] = await Promise.all([
          getImageDetails(filePath, fileVersionInfo),
          getGalleryThumbnailSource(filePath, fileVersionInfo)
        ]);

        if (this.isDisposed || initialRefreshGeneration !== this.refreshGeneration) {
          return;
        }

        const updatedMeta = {
          src: '',
          thumbUrl,
          filePath,
          name: details.fileName,
          type: details.format,
          size: details.sizeBytes,
          width: details.width,
          height: details.height,
          mtimeMs: fileVersionInfo.mtimeMs
        };
        const currentIndex = this.imageFiles.findIndex((img) => img.filePath === filePath);
        if (currentIndex === -1) {
          return;
        }

        this.imageFiles[currentIndex] = updatedMeta;
        void this.panel.webview.postMessage({
          type: 'update-image-meta',
          index: currentIndex,
          filePath,
          meta: updatedMeta
        });
      } catch {
        // On error, keep placeholder metadata.
      } finally {
        initialCompleted += 1;
        postInitialProgress(initialCompleted >= initialTotal);
      }
    });
  }

  /**
   * Sends runtime settings updates to the gallery webview.
   * @param settings Current extension settings.
   */
  private async refreshFromSettings(settings: ImageInspectorSettings): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'update-settings',
      settings: {
        themeAccentRgb: settings.themeAccentRgb
      }
    });

    if (this.duplicateResultsPanel) {
      await this.duplicateResultsPanel.webview.postMessage({
        type: 'update-settings',
        settings: {
          themeAccentRgb: settings.themeAccentRgb
        }
      });
    }
  }

  /**
   * Computes a deterministic SHA-1 hash for one file path.
   *
   * @param filePath Absolute path of the file to hash.
   * @returns Hexadecimal SHA-1 digest.
   */
  private async computeFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return createHash('sha1').update(fileBuffer).digest('hex');
  }

  /**
   * Posts a duplicate-related message to gallery and duplicate-results webviews.
   *
   * @param message Message payload to send.
   */
  private async postDuplicateMessage(message: Record<string, unknown>): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    await this.panel.webview.postMessage(message);
    if (this.duplicateResultsPanel) {
      await this.duplicateResultsPanel.webview.postMessage(message);
    }
  }

  /**
   * Sends the current duplicate scan state snapshot to the duplicate-results panel.
   */
  private async postDuplicatePanelState(): Promise<void> {
    if (!this.duplicateResultsPanel || this.isDisposed) {
      return;
    }

    await this.duplicateResultsPanel.webview.postMessage({
      type: 'duplicate-panel-state',
      state: {
        isRunning: this.duplicateScanRunning,
        status: this.duplicateScanStatus,
        progress: this.duplicateScanProgress,
        groups: this.duplicateGroups
      }
    });
  }

  /**
   * Opens or reveals the external duplicate-results panel.
   */
  private openDuplicateResultsPanel(): void {
    if (this.duplicateResultsPanel) {
      this.duplicateResultsPanel.reveal(vscode.ViewColumn.Beside, true);
      void this.refreshFromSettings(getImageInspectorSettings());
      void this.postDuplicatePanelState();
      return;
    }

    const folderName = path.basename(this.folderUri.fsPath);
    this.duplicateResultsPanel = vscode.window.createWebviewPanel(
      'imageInspector.duplicateResults',
      `Duplicates: ${folderName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
          vscode.Uri.file(this.folderUri.fsPath)
        ]
      }
    );

    const settings = getImageInspectorSettings();

    this.duplicateResultsPanel.webview.html = buildDuplicateResultsWebview(
      this.duplicateResultsPanel.webview,
      this.folderUri.fsPath,
      this.extensionUri,
      {
        themeAccentRgb: settings.themeAccentRgb
      }
    );

    this.panelDisposables.push(this.duplicateResultsPanel.webview.onDidReceiveMessage((rawMessage: unknown) => {
      if (!rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) {
        return;
      }

      const message = rawMessage as { type: string; filePaths?: string[]; direction?: string };
      if (message.type === 'duplicate-panel-ready') {
        void this.postDuplicatePanelState();
        return;
      }

      if (message.type === 'start-duplicate-search') {
        void this.startDuplicateSearch();
        return;
      }

      if (message.type === 'select-duplicate-group' && Array.isArray(message.filePaths)) {
        void this.panel.webview.postMessage({
          type: 'select-duplicate-group',
          filePaths: message.filePaths
        });
        return;
      }

      if (message.type === 'navigate-duplicate-group' && Array.isArray(message.filePaths)) {
        void this.panel.webview.postMessage({
          type: 'navigate-duplicate-group',
          filePaths: message.filePaths,
          direction: message.direction === 'prev' ? 'prev' : 'next'
        });
      }
    }));

    this.panelDisposables.push(this.duplicateResultsPanel.onDidDispose(() => {
      this.duplicateResultsPanel = undefined;
    }));
  }

  /**
   * Runs duplicate detection and streams progress/results to the webview.
   *
   * The scan first groups files by byte size, then hashes only files from size-colliding groups.
   */
  private async startDuplicateSearch(): Promise<void> {
    const scanGeneration = this.duplicateScanGeneration + 1;
    this.duplicateScanGeneration = scanGeneration;

    const snapshot = this.imageFiles.map((image) => ({
      filePath: image.filePath,
      name: image.name,
      thumbUrl: image.thumbUrl || image.src,
      size: image.size
    }));

    if (this.isDisposed) {
      return;
    }

    const postScanMessage = async (message: Record<string, unknown>): Promise<void> => {
      if (this.isDisposed || this.duplicateScanGeneration !== scanGeneration) {
        return;
      }

      await this.postDuplicateMessage(message);
    };

    try {
      this.duplicateGroups = [];
      this.duplicateScanRunning = true;
      this.duplicateScanStatus = 'Scanning...';
      this.duplicateScanProgress = {
        active: true,
        completed: 0,
        total: snapshot.length,
        label: 'Preparing duplicate scan...'
      };
      await postScanMessage({
        type: 'duplicate-scan-started',
        completed: 0,
        total: snapshot.length,
        label: 'Preparing duplicate scan...'
      });

      if (snapshot.length < 2) {
        this.duplicateScanRunning = false;
        this.duplicateScanStatus = 'Not enough images to compare.';
        this.duplicateScanProgress = {
          active: false,
          completed: 0,
          total: 0,
          label: 'Preparing duplicate scan...'
        };
        await postScanMessage({
          type: 'duplicate-scan-complete',
          total: 0,
          status: 'Not enough images to compare.'
        });
        return;
      }

      const imagesWithSize = await Promise.all(snapshot.map(async (image) => {
        if (typeof image.size === 'number' && image.size > 0) {
          return image;
        }

        try {
          const fileStats = await fs.stat(image.filePath);
          return {
            ...image,
            size: typeof fileStats.size === 'bigint' ? Number(fileStats.size) : fileStats.size
          };
        } catch {
          return {
            ...image,
            size: -1
          };
        }
      }));

      const groupsBySize = new Map<number, Array<{ filePath: string; name: string; thumbUrl: string; size: number }>>();
      for (const image of imagesWithSize) {
        if (!Number.isFinite(image.size) || image.size <= 0) {
          continue;
        }

        const group = groupsBySize.get(image.size) ?? [];
        group.push(image);
        groupsBySize.set(image.size, group);
      }

      const hashCandidates = Array.from(groupsBySize.values())
        .filter((group) => group.length > 1)
        .flat();

      const totalToHash = hashCandidates.length;
      if (totalToHash === 0) {
        this.duplicateScanRunning = false;
        this.duplicateScanStatus = 'No duplicates found.';
        this.duplicateScanProgress = {
          active: false,
          completed: 0,
          total: 0,
          label: 'Hashing candidate files...'
        };
        await postScanMessage({
          type: 'duplicate-scan-complete',
          total: 0,
          status: 'No duplicates found.'
        });
        return;
      }

      let completed = 0;
      await postScanMessage({
        type: 'duplicate-scan-progress',
        completed,
        total: totalToHash,
        label: 'Hashing candidate files...'
      });
      this.duplicateScanProgress = {
        active: true,
        completed,
        total: totalToHash,
        label: 'Hashing candidate files...'
      };

      const groupsByHash = new Map<string, Array<{ filePath: string; name: string; thumbUrl: string }>>();
      await processWithConcurrencyLimit(hashCandidates, 4, async (candidate) => {
        if (this.isDisposed || this.duplicateScanGeneration !== scanGeneration) {
          return;
        }

        try {
          const hash = await this.computeFileHash(candidate.filePath);
          const hashGroup = groupsByHash.get(hash) ?? [];
          hashGroup.push({
            filePath: candidate.filePath,
            name: candidate.name,
            thumbUrl: candidate.thumbUrl
          });
          groupsByHash.set(hash, hashGroup);
        } catch {
          // Ignore unreadable files and continue the scan.
        } finally {
          completed += 1;
          if (completed % 4 === 0 || completed >= totalToHash) {
            this.duplicateScanProgress = {
              active: true,
              completed,
              total: totalToHash,
              label: 'Hashing candidate files...'
            };
            await postScanMessage({
              type: 'duplicate-scan-progress',
              completed,
              total: totalToHash,
              label: 'Hashing candidate files...'
            });
          }
        }
      });

      if (this.isDisposed || this.duplicateScanGeneration !== scanGeneration) {
        return;
      }

      let duplicateGroupCount = 0;
      let duplicateFileCount = 0;
      const duplicateGroups = Array.from(groupsByHash.values())
        .filter((group) => group.length > 1)
        .sort((left, right) => left[0].name.localeCompare(right[0].name, undefined, { sensitivity: 'base', numeric: true }));

      for (const group of duplicateGroups) {
        duplicateGroupCount += 1;
        duplicateFileCount += group.length;
        const duplicateGroup: DuplicateGroupMessage = {
          thumbnailSrc: group[0].thumbUrl || '',
          fileNames: group.map((item) => item.name),
          filePaths: group.map((item) => item.filePath),
          fileCount: group.length
        };
        this.duplicateGroups.push(duplicateGroup);
        await postScanMessage({
          type: 'duplicate-group-found',
          group: duplicateGroup
        });
      }

      const completionStatus = duplicateGroupCount > 0
        ? `${String(duplicateGroupCount)} groups found (${String(duplicateFileCount)} files).`
        : 'No duplicates found.';
      this.duplicateScanRunning = false;
      this.duplicateScanStatus = completionStatus;
      this.duplicateScanProgress = {
        active: false,
        completed: totalToHash,
        total: totalToHash,
        label: 'Hashing candidate files...'
      };

      await postScanMessage({
        type: 'duplicate-scan-complete',
        total: totalToHash,
        status: completionStatus
      });
    } catch (error) {
      if (this.isDisposed || this.duplicateScanGeneration !== scanGeneration) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to scan for duplicates.';
      this.duplicateScanRunning = false;
      this.duplicateScanStatus = 'Scan failed';
      this.duplicateScanProgress = {
        active: false,
        completed: 0,
        total: 0,
        label: 'Hashing candidate files...'
      };
      await this.postDuplicateMessage({
        type: 'duplicate-scan-error',
        message
      });
    }
  }

  /**
   * Creates and wires up the gallery WebviewPanel.
   *
   * @param folderUri URI of the folder being displayed.
   * @param context Extension context.
   * @param provider Shared image details provider used to open comparisons.
   */
  private constructor(
    folderUri: vscode.Uri,
    context: vscode.ExtensionContext,
    provider: ImageDetailsCustomEditorProvider
  ) {
    this.folderUri = folderUri;
    this.extensionUri = context.extensionUri;
    this.imageFiles = [];
    const folderName = path.basename(folderUri.fsPath);
    const settings = getImageInspectorSettings();

    this.panel = vscode.window.createWebviewPanel(
      'imageInspector.folderGallery',
      `Gallery: ${folderName} — loading...`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.file(folderUri.fsPath)
        ]
      }
    );

    this.panel.webview.html = buildFolderGalleryLoadingWebview(
      this.panel.webview,
      folderUri.fsPath,
      context.extensionUri,
      {
        themeAccentRgb: settings.themeAccentRgb,
        title: 'Opening gallery...',
        message: 'Scanning the folder and preparing previews.'
      }
    );

    const messageDisposable = this.panel.webview.onDidReceiveMessage(
      async (rawMessage: unknown) => {
        if (this.isDisposed) {
          return;
        }

        if (!rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) {
          return;
        }

        const message = rawMessage as {
          type: string;
          index?: unknown;
          binPath?: string;
          indexes?: number[];
          mode?: unknown;
          navigationOrderIndexes?: unknown;
        };
        const normalizeGalleryIndexes = (rawIndexes: unknown): number[] => {
          if (!Array.isArray(rawIndexes)) {
            return [];
          }

          return Array.from(new Set(
            rawIndexes
              .filter((value): value is number => typeof value === 'number')
              .map((value) => Math.trunc(value))
              .filter((index) => index >= 0 && index < this.imageFiles.length)
          )).sort((left, right) => left - right);
        };

        const removeGalleryImagesByIndexes = async (indexes: number[]): Promise<void> => {
          if (indexes.length === 0) {
            return;
          }

          const deletedPaths = new Set<string>();

          await Promise.all(
            indexes.map(async (index) => {
              const img = this.imageFiles[index];
              if (!img || typeof img.filePath !== 'string') {
                return;
              }

              try {
                const openEditors = vscode.window.visibleTextEditors.filter((editor) => editor.document.uri.fsPath === img.filePath);
                for (const editor of openEditors) {
                  await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
                  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }

                await fs.unlink(img.filePath);
                deletedPaths.add(img.filePath);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[ImageInspector] Failed to delete image file', img.filePath, err);
              }
            })
          );

          if (this.isDisposed) {
            return;
          }

          if (deletedPaths.size > 0) {
            const remainingImages = this.imageFiles.filter((img) => !deletedPaths.has(img.filePath));
            this.imageFiles.length = 0;
            this.imageFiles.push(...remainingImages);
          }

          await this.panel.webview.postMessage({
            type: 'gallery-data',
            images: this.imageFiles,
            resetSelection: true
          });
        };

        // Handle explicit gallery data requests from the webview.
        if (message.type === 'request-gallery-data') {
          this.panel.webview.postMessage({
            type: 'gallery-data',
            images: this.imageFiles
          });
          return;
        }
        if (message.type === 'update-navigation-order') {
          provider.syncGalleryNavigationOrderForFolder(
            this.folderUri.fsPath,
            this.imageFiles,
            message.navigationOrderIndexes
          );
          return;
        }
        // Handle duplicate panel opening from the gallery toolbar.
        if (message.type === 'open-duplicate-panel') {
          this.openDuplicateResultsPanel();
          return;
        }
        // Handle duplicate search requests from gallery or duplicate panels.
        if (message.type === 'start-duplicate-search') {
          void this.startDuplicateSearch();
          return;
        }
        if (message.type === 'request-delete-selected') {
          if (this.deleteSelectionConfirmationInProgress) {
            return;
          }

          const indexes = normalizeGalleryIndexes(message.indexes);
          if (indexes.length === 0) {
            return;
          }

          this.deleteSelectionConfirmationInProgress = true;
          try {
            const confirmationAction = 'Delete';
            const confirmationMessage = indexes.length === 1
              ? 'Delete the selected image?'
              : `Delete ${indexes.length} selected images?`;
            const confirmedAction = await vscode.window.showWarningMessage(
              confirmationMessage,
              { modal: true },
              confirmationAction
            );

            if (confirmedAction !== confirmationAction) {
              return;
            }

            await removeGalleryImagesByIndexes(indexes);
          } finally {
            this.deleteSelectionConfirmationInProgress = false;
          }
          return;
        }
        // Handle image removal requests.
        if (message.type === 'remove-image' && Array.isArray(message.indexes)) {
          const indexes = normalizeGalleryIndexes(message.indexes);
          void removeGalleryImagesByIndexes(indexes);
          return;
        }
        // Handle comparison opening from the gallery toolbar.
        if (message.type === 'compare-images' && Array.isArray(message.indexes)) {
          const indexes = Array.from(new Set(
            message.indexes
              .filter((value): value is number => typeof value === 'number')
              .map((value) => Math.trunc(value))
              .filter((index) => index >= 0 && index < this.imageFiles.length)
          ));

          if (indexes.length !== 2) {
            void vscode.window.showInformationMessage('Select exactly 2 images in the gallery to compare them.');
            return;
          }

          const primaryImage = this.imageFiles[indexes[0]];
          const comparisonImage = this.imageFiles[indexes[1]];
          if (!primaryImage || !comparisonImage) {
            return;
          }

          const viewMode: CompareViewMode = message.mode === 'side-by-side' ? 'side-by-side' : 'split';
          void provider.openComparisonForImages(
            vscode.Uri.file(primaryImage.filePath),
            vscode.Uri.file(comparisonImage.filePath),
            viewMode
          );
          return;
        }

        // Handle image opening requests.
        if (message.type === 'open-image' && typeof message.index === 'number') {
          const index = Math.trunc(message.index);
          if (index < 0 || index >= this.imageFiles.length) {
            return;
          }
          const navigationOrderIndexes = Array.isArray(message.navigationOrderIndexes)
            ? message.navigationOrderIndexes
            : [];
          void provider.openImageFromGallery(this.imageFiles, index, navigationOrderIndexes);
        }
      }
    );
    this.panelDisposables.push(messageDisposable);

    const disposeDisposable = this.panel.onDidDispose(() => {
      this.isDisposed = true;
      this.refreshGeneration += 1;
      this.duplicateScanGeneration += 1;
      this.duplicateResultsPanel?.dispose();
      ImageFolderGalleryPanel.activePanels.delete(folderUri.fsPath);
      while (this.panelDisposables.length > 0) {
        const disposable = this.panelDisposables.pop();
        try {
          disposable?.dispose();
        } catch {
          // Ignore disposal errors during panel teardown.
        }
      }
    });
    this.panelDisposables.push(disposeDisposable);
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

    provider.refreshActivePanelFromConfiguration();
    ImageFolderGalleryPanel.refreshActivePanelsFromConfiguration();
  });

  const activeColorThemeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
    provider.refreshActivePanelFromConfiguration();
  });

  const openFolderGalleryDisposable = vscode.commands.registerCommand(
    'imageInspector.openFolderGallery',
    async (resource?: unknown, resources?: unknown) => {
      const folderUri = await resolveFolderUri(resource, resources);
      if (!folderUri) {
        void vscode.window.showInformationMessage('Select a folder in the explorer to open its gallery.');
        return;
      }

      await ImageFolderGalleryPanel.open(folderUri, context, provider);
    }
  );

  const deleteSelectedGalleryImagesDisposable = vscode.commands.registerCommand(
    'imageInspector.deleteSelectedGalleryImages',
    async () => {
      await ImageFolderGalleryPanel.requestDeleteSelectedInActivePanel();
    }
  );

  const pickThemeAccentColorDisposable = vscode.commands.registerCommand(
    'imageInspector.pickThemeAccentColor',
    () => {
      openThemeAccentColorPicker(context);
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
    activeColorThemeChangeDisposable,
    openFolderGalleryDisposable,
    deleteSelectedGalleryImagesDisposable,
    pickThemeAccentColorDisposable
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
    }
  }

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
  const extension = getLowercaseExtension(filePath);
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
  const extension = getLowercaseExtension(filePath);
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
 * Extracts a Node-style filesystem error code when available.
 *
 * @param error Caught error value.
 * @returns Error code such as EPERM/EACCES/EBUSY, or undefined.
 */
function getNodeLikeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/**
 * Extracts metadata from an image.
 * @param filePath Absolute file system path.
 * @returns Consolidated image details.
 */
async function getImageDetails(
  filePath: string,
  fileVersionInfo?: FileVersionInfo
): Promise<ImageDetailsViewModel> {
  const resolvedFileVersion = fileVersionInfo ?? await getFileVersionInfo(filePath);
  const detailsCacheKey = buildImageDetailsCacheKey(resolvedFileVersion.key);
  const cachedDetails = imageDetailsCache.get(detailsCacheKey);
  if (cachedDetails) {
    return cachedDetails;
  }

  try {
    const sharp = await getSharp();
    const sharpInput = await fs.readFile(filePath);
    const metadata = await sharp(sharpInput).metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

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
      density: metadata.density
    };

    setBoundedCachedValue(imageDetailsCache, detailsCacheKey, details, MAX_IMAGE_DETAILS_CACHE_ENTRIES);
    return details;
  } catch (error) {
    const extension = getLowercaseExtension(filePath);
    if (extension !== '.ico') {
      throw error;
    }

    // Extract the main variant.
    const buffer = await fs.readFile(filePath);
    const entries = await parseIcoEntries(buffer);
    const primaryEntry = entries.slice().sort((a, b) => (b.width * b.height - a.width * a.height) || (b.bitCount - a.bitCount))[0];
    const width = primaryEntry?.width ?? 0;
    const height = primaryEntry?.height ?? 0;
    const estimatedChannels = Math.max(1, Math.ceil((primaryEntry?.bitCount ?? 0) / 8));

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
      density: undefined
    };

    setBoundedCachedValue(imageDetailsCache, detailsCacheKey, details, MAX_IMAGE_DETAILS_CACHE_ENTRIES);
    return details;
  }
}

/**
 * Builds a cache key for image details according to the file version.
 * @param fileVersionKey Stable file version key.
 * @returns Cache key.
 */
function buildImageDetailsCacheKey(fileVersionKey: string): string {
  return `${fileVersionKey}::details::meta`;
}

/**
 * Opens a small webview panel containing an HTML color picker to let the user
 * visually choose the theme accent color and save it to the extension settings.
 * @param context Extension context used to create the webview panel.
 */
function openThemeAccentColorPicker(context: vscode.ExtensionContext): void {
  const currentColor = vscode.workspace
    .getConfiguration('imageInspector')
    .get<string>('themeAccentColor', DEFAULT_THEME_ACCENT_HEX);

  const panel = vscode.window.createWebviewPanel(
    'imageInspector.accentColorPicker',
    'Accent Color',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );

  panel.webview.html = buildAccentColorPickerHtml(currentColor);

  panel.webview.onDidReceiveMessage(
    async (message: { command: string; color: string }) => {
      if (message.command === 'applyColor') {
        const hex = message.color?.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          await vscode.workspace
            .getConfiguration('imageInspector')
            .update('themeAccentColor', hex, vscode.ConfigurationTarget.Global);
          panel.dispose();
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

/**
 * Builds the HTML content for the accent color picker webview.
 * @param currentColor Current accent color in #RRGGBB format.
 * @returns Full HTML string for the webview.
 */
function buildAccentColorPickerHtml(currentColor: string): string {
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(currentColor) ? currentColor : DEFAULT_THEME_ACCENT_HEX;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      gap: 20px;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      opacity: 0.85;
    }
    .picker-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    input[type="color"] {
      width: 64px;
      height: 64px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      padding: 2px;
      background: transparent;
    }
    input[type="text"] {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 14px;
      width: 90px;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      text-align: center;
    }
    button {
      padding: 7px 20px;
      border: none;
      border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 13px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .preview {
      width: 180px;
      height: 10px;
      border-radius: 5px;
      background: ${safeColor};
    }
  </style>
</head>
<body>
  <h2>Theme Accent Color</h2>
  <div class="preview" id="preview"></div>
  <div class="picker-row">
    <input type="color" id="colorPicker" value="${safeColor}">
    <input type="text" id="hexInput" maxlength="7" value="${safeColor}" spellcheck="false">
  </div>
  <button id="applyBtn">Apply</button>
  <script>
    const vscode = acquireVsCodeApi();
    const picker = document.getElementById('colorPicker');
    const hexInput = document.getElementById('hexInput');
    const preview = document.getElementById('preview');
    const applyBtn = document.getElementById('applyBtn');

    function syncFromPicker() {
      hexInput.value = picker.value;
      preview.style.background = picker.value;
    }

    function syncFromHex() {
      const val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        picker.value = val;
        preview.style.background = val;
      }
    }

    picker.addEventListener('input', syncFromPicker);
    hexInput.addEventListener('input', syncFromHex);

    applyBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'applyColor', color: picker.value });
    });
  </script>
</body>
</html>`;
}

/**
 * Reads extension settings used by the webview.
 * @returns Normalized extension settings.
 */
function getImageInspectorSettings(): ImageInspectorSettings {
  const imageInspectorConfig = vscode.workspace.getConfiguration('imageInspector');
  const themeAccentColor = imageInspectorConfig.get<string>('themeAccentColor', DEFAULT_THEME_ACCENT_HEX);
  const imageDetailsBackgroundColor = imageInspectorConfig.get<string>('imageDetailsBackgroundColor', '');

  return {
    toolbarPosition: imageInspectorConfig.get<string>('toolbarPosition', 'top'),
    themeAccentRgb: resolveThemeAccentRgb(themeAccentColor),
    previewBackgroundRgb: resolvePreviewBackgroundRgb(imageDetailsBackgroundColor),
    saveEditsToOriginalFile: imageInspectorConfig.get<boolean>('saveEditsToOriginalFile', true),
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

interface SvgLengthValue {
  rawValue: string;
  numericValue: number;
}

/**
 * Rotates an SVG file by rewriting its markup instead of rasterizing it.
 * @param filePath Absolute SVG file path.
 * @param direction Rotation direction (`left` or `right`).
 * @returns Rotated SVG bytes.
 */
async function rotateSvgFile(filePath: string, direction: 'left' | 'right'): Promise<Buffer> {
  const svgContent = await fs.readFile(filePath, 'utf8');
  const rotatedSvgContent = rotateSvgMarkup(svgContent, direction);
  return Buffer.from(rotatedSvgContent, 'utf8');
}

/**
 * Mirrors an SVG file by rewriting its markup instead of rasterizing it.
 * @param filePath Absolute SVG file path.
 * @param axis Mirror axis (`horizontal` or `vertical`).
 * @returns Mirrored SVG bytes.
 */
async function mirrorSvgFile(filePath: string, axis: 'horizontal' | 'vertical'): Promise<Buffer> {
  const svgContent = await fs.readFile(filePath, 'utf8');
  const mirroredSvgContent = mirrorSvgMarkup(svgContent, axis);
  return Buffer.from(mirroredSvgContent, 'utf8');
}

/**
 * Rotates raw SVG markup by wrapping the current content in a transformed group.
 * @param svgContent Original SVG markup.
 * @param direction Rotation direction (`left` or `right`).
 * @returns Updated SVG markup.
 */
function rotateSvgMarkup(svgContent: string, direction: 'left' | 'right'): string {
  const openingTagMatch = svgContent.match(/<svg\b[^>]*>/i);
  const closingTagIndex = svgContent.toLowerCase().lastIndexOf('</svg>');

  if (!openingTagMatch || closingTagIndex < 0) {
    throw new Error('Unsupported SVG markup.');
  }

  const openingTag = openingTagMatch[0];
  const openingTagStart = openingTagMatch.index ?? 0;
  const openingTagEnd = openingTagStart + openingTag.length;
  const prefix = svgContent.slice(0, openingTagStart);
  const innerMarkup = svgContent.slice(openingTagEnd, closingTagIndex);
  const suffix = svgContent.slice(closingTagIndex);

  const viewBoxMatch = openingTag.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
  const widthMatch = readSvgLengthAttribute(openingTag, 'width');
  const heightMatch = readSvgLengthAttribute(openingTag, 'height');

  const parsedViewBox = parseSvgViewBox(viewBoxMatch?.[2]);
  const sourceWidth = parsedViewBox?.width ?? widthMatch?.numericValue;
  const sourceHeight = parsedViewBox?.height ?? heightMatch?.numericValue;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Unable to determine SVG dimensions for rotation.');
  }

  const sourceMinX = parsedViewBox?.minX ?? 0;
  const sourceMinY = parsedViewBox?.minY ?? 0;
  const rotatedWidth = sourceHeight;
  const rotatedHeight = sourceWidth;
  const transform = direction === 'left'
    ? `translate(0 ${formatSvgNumber(sourceWidth)}) rotate(-90) translate(${formatSvgNumber(-sourceMinX)} ${formatSvgNumber(-sourceMinY)})`
    : `translate(${formatSvgNumber(sourceHeight)} 0) rotate(90) translate(${formatSvgNumber(-sourceMinX)} ${formatSvgNumber(-sourceMinY)})`;

  let updatedOpeningTag = setSvgAttribute(openingTag, 'viewBox', `0 0 ${formatSvgNumber(rotatedWidth)} ${formatSvgNumber(rotatedHeight)}`);

  if (widthMatch && heightMatch) {
    updatedOpeningTag = setSvgAttribute(updatedOpeningTag, 'width', heightMatch.rawValue);
    updatedOpeningTag = setSvgAttribute(updatedOpeningTag, 'height', widthMatch.rawValue);
  }

  const rotatedInnerMarkup = `<g transform="${transform}">${innerMarkup}</g>`;
  return `${prefix}${updatedOpeningTag}${rotatedInnerMarkup}${suffix}`;
}

/**
 * Mirrors raw SVG markup by wrapping the current content in a transformed group.
 * @param svgContent Original SVG markup.
 * @param axis Mirror axis (`horizontal` or `vertical`).
 * @returns Updated SVG markup.
 */
function mirrorSvgMarkup(svgContent: string, axis: 'horizontal' | 'vertical'): string {
  const openingTagMatch = svgContent.match(/<svg\b[^>]*>/i);
  const closingTagIndex = svgContent.toLowerCase().lastIndexOf('</svg>');

  if (!openingTagMatch || closingTagIndex < 0) {
    throw new Error('Unsupported SVG markup.');
  }

  const openingTag = openingTagMatch[0];
  const openingTagStart = openingTagMatch.index ?? 0;
  const openingTagEnd = openingTagStart + openingTag.length;
  const prefix = svgContent.slice(0, openingTagStart);
  const innerMarkup = svgContent.slice(openingTagEnd, closingTagIndex);
  const suffix = svgContent.slice(closingTagIndex);

  const viewBoxMatch = openingTag.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
  const widthMatch = readSvgLengthAttribute(openingTag, 'width');
  const heightMatch = readSvgLengthAttribute(openingTag, 'height');

  const parsedViewBox = parseSvgViewBox(viewBoxMatch?.[2]);
  const sourceWidth = parsedViewBox?.width ?? widthMatch?.numericValue;
  const sourceHeight = parsedViewBox?.height ?? heightMatch?.numericValue;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Unable to determine SVG dimensions for mirroring.');
  }

  const sourceMinX = parsedViewBox?.minX ?? 0;
  const sourceMinY = parsedViewBox?.minY ?? 0;
  const mirrorTranslateX = (sourceMinX * 2) + sourceWidth;
  const mirrorTranslateY = (sourceMinY * 2) + sourceHeight;
  const transform = axis === 'horizontal'
    ? `translate(${formatSvgNumber(mirrorTranslateX)} 0) scale(-1 1)`
    : `translate(0 ${formatSvgNumber(mirrorTranslateY)}) scale(1 -1)`;

  const mirroredInnerMarkup = `<g transform="${transform}">${innerMarkup}</g>`;
  return `${prefix}${openingTag}${mirroredInnerMarkup}${suffix}`;
}

/**
 * Reads a numeric SVG length attribute when available.
 * @param openingTag Raw `<svg ...>` opening tag.
 * @param attributeName Attribute name to read.
 * @returns Parsed attribute data when numeric.
 */
function readSvgLengthAttribute(openingTag: string, attributeName: string): SvgLengthValue | undefined {
  const attributePattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])([^"']+)\\1`, 'i');
  const attributeMatch = openingTag.match(attributePattern);
  if (!attributeMatch) {
    return undefined;
  }

  const rawValue = attributeMatch[2].trim();
  const numericMatch = rawValue.match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:px)?$/i);
  if (!numericMatch) {
    return undefined;
  }

  const numericValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return {
    rawValue,
    numericValue
  };
}

/**
 * Parses an SVG viewBox attribute into numeric coordinates.
 * @param value Raw viewBox value.
 * @returns Parsed viewBox numbers when valid.
 */
function parseSvgViewBox(value: string | undefined): { minX: number; minY: number; width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  return {
    minX: parts[0],
    minY: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

/**
 * Replaces or inserts a single SVG attribute on the root `<svg>` tag.
 * @param openingTag Raw `<svg ...>` opening tag.
 * @param attributeName Attribute name to update.
 * @param attributeValue Attribute value to set.
 * @returns Updated opening tag.
 */
function setSvgAttribute(openingTag: string, attributeName: string, attributeValue: string): string {
  const attributePattern = new RegExp(`(\\b${attributeName}\\s*=\\s*)(["'])[^"']*\\2`, 'i');
  if (attributePattern.test(openingTag)) {
    return openingTag.replace(attributePattern, `$1"${attributeValue}"`);
  }

  return openingTag.replace(/>$/, ` ${attributeName}="${attributeValue}">`);
}

/**
 * Formats numeric SVG values without trailing decimal noise.
 * @param value Number to format.
 * @returns Compact SVG-friendly number string.
 */
function formatSvgNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return Number.parseFloat(value.toFixed(6)).toString();
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
    const cachedEntries = icoEntriesCache.get(cacheKey);
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
  const cachedGalleryItems = icoGalleryCache.get(cacheKey);
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

    return {
      id: `ico-variant-${String(index + 1)}`,
      label,
      width: entry.width,
      height: entry.height,
      imageSource: toPngDataUri(imageBuffer)
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
 * @returns Image source data URI.
 */
async function getWebviewImageSource(
  filePath: string,
  fileVersionKey: string
): Promise<string> {
  const extension = getLowercaseExtension(filePath);
  const needsConversion = extension === '.tif' || extension === '.tiff' || extension === '.heic' || extension === '.heif';

  const cachedPreviewSource = convertedPreviewCache.get(fileVersionKey);
  if (cachedPreviewSource) {
    return cachedPreviewSource;
  }

  let previewSource = '';
  if (needsConversion) {
    const sharp = await getSharp();
    const sourceBuffer = await fs.readFile(filePath);
    const previewBuffer = await sharp(sourceBuffer)
      .png()
      .toBuffer();
    previewSource = toPngDataUri(previewBuffer);
  } else {
    const imageBuffer = await fs.readFile(filePath);
    const mimeType = resolveImageMimeTypeFromExtension(extension);
    previewSource = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  }

  setBoundedCachedValue(convertedPreviewCache, fileVersionKey, previewSource, MAX_CONVERTED_PREVIEW_CACHE_ENTRIES);
  return previewSource;
}

/**
 * Resolves the MIME type from an image file extension.
 * @param extension Lowercase extension including leading dot.
 * @returns MIME type used for data URI rendering.
 */
function resolveImageMimeTypeFromExtension(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Cleans stale temporary files left by interrupted edit operations.
 *
 * @param directoryPath Directory to scan.
 */
async function cleanupStaleImageInspectorTempFiles(directoryPath: string): Promise<void> {
  const prefix = '.imageinspector-edit-';

  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const staleTempFiles = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => path.join(directoryPath, entry.name));

    for (const staleFilePath of staleTempFiles) {
      try {
        await fs.unlink(staleFilePath);
      } catch {
        // Best-effort cleanup only.
      }
    }
  } catch {
    // Ignore directory read errors during cleanup.
  }
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
 * Resolves the preview background RGB tuple, falling back to a theme-adaptive default.
 * @param candidateColor Hex color candidate from settings (#RRGGBB) or empty string.
 * @returns RGB tuple string usable in CSS variables (e.g. "243,243,243").
 */
function resolvePreviewBackgroundRgb(candidateColor: string): string {
  const normalizedColor = candidateColor.trim();
  if (normalizedColor.length === 0) {
    return hexColorToRgbTuple(getDefaultImageDetailsBackgroundHex());
  }

  return resolveThemeAccentRgb(normalizedColor);
}

/**
 * Returns the theme-adaptive default preview background color.
 * @returns Hex color string used when the preview background setting is empty.
 */
function getDefaultImageDetailsBackgroundHex(): string {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return DEFAULT_IMAGE_DETAILS_BACKGROUND_HEX_LIGHT_THEME;
    default:
      return DEFAULT_IMAGE_DETAILS_BACKGROUND_HEX_DARK_THEME;
  }
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
