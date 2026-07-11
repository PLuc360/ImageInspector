/**
 * Webview script for image details interactions: zoom, compare, navigation, and pipette.
 */
/**
 * Dynamically injects the shared badge stylesheet into the document head.
 *
 * @param {string} uri URI of the badge CSS file to inject.
 */
function setBadgeCssUri(uri) {
  window.badgeCssUri = uri;
  const badgeStyle = document.createElement('link');
  badgeStyle.rel = 'stylesheet';
  badgeStyle.href = uri;
  document.head.appendChild(badgeStyle);
}

if (window.badgeCssUri) {
  setBadgeCssUri(window.badgeCssUri);
}
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const layoutElement = document.querySelector('.layout');
const pipetteZoomLoupe = document.getElementById('pipette-zoom-loupe');
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32;
const HOLD_REPEAT_DELAY_MS = 250;
const HOLD_REPEAT_INTERVAL_MS = 90;
const DEFAULT_LOUPE_DIAMETER = 96;
const DEFAULT_LOUPE_VIRTUAL_RESOLUTION = 25;
const DEFAULT_LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM = 6;
const DEFAULT_LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM = 1;
const TOOLBAR_POSITION_CLASSES = ['toolbar-pos-top', 'toolbar-pos-bottom', 'toolbar-pos-left', 'toolbar-pos-right'];

let loupeDiameter = DEFAULT_LOUPE_DIAMETER;
let loupeVirtualResolution = DEFAULT_LOUPE_VIRTUAL_RESOLUTION;
let loupeZoomAtMinImageZoom = DEFAULT_LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM;
let loupeZoomAtMaxImageZoom = DEFAULT_LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM;
let loupeDynamicZoomMin = Math.min(loupeZoomAtMinImageZoom, loupeZoomAtMaxImageZoom);
let loupeDynamicZoomMax = Math.max(loupeZoomAtMinImageZoom, loupeZoomAtMaxImageZoom);
let virtualLoupeCanvas = null;
let virtualLoupeCtx = null;
let pipetteImageCtx = null;

const image = document.getElementById('preview-image');
const previewContainer = document.querySelector('.preview');
const preview = document.querySelector('.preview-scroll');
const previewBody = document.querySelector('.preview-body');
const zoomToolbar = document.querySelector('.zoom-toolbar');
const infoOverlay = document.getElementById('info-overlay');
const infoOverlayHandle = document.getElementById('info-overlay-handle');
const zoomLabel = document.getElementById('zoom-label');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomResetButton = document.getElementById('zoom-reset');
const zoomFitButton = document.getElementById('zoom-fit');
const customBackgroundToggleButton = document.getElementById('custom-background-toggle');
const galleryNavPrevButton = document.getElementById('gallery-nav-prev');
const galleryNavNextButton = document.getElementById('gallery-nav-next');
const galleryNavPositionLabel = document.getElementById('gallery-nav-position');
const rotateLeftButton = document.getElementById('rotate-left');
const rotateRightButton = document.getElementById('rotate-right');
const mirrorHorizontalButton = document.getElementById('mirror-horizontal');
const mirrorVerticalButton = document.getElementById('mirror-vertical');
const zoomSelectButton = document.getElementById('zoom-select');
const infoToggleButton = document.getElementById('info-toggle');
const compareToolButton = document.getElementById('compare-tool');
const compareSideBySideButton = document.getElementById('compare-side-by-side');
const comparePickButton = document.getElementById('compare-pick');
const compareOrientationButton = document.getElementById('compare-orientation');
const compareControls = document.getElementById('compare-controls');
const compareSlider = document.getElementById('compare-slider');
const compareDiffPrevButton = document.getElementById('compare-diff-prev');
const compareDiffNextButton = document.getElementById('compare-diff-next');
const compareDiffIndexLabel = document.getElementById('compare-diff-index');
const compareDiffTargetButton = document.getElementById('compare-diff-target');
const compareDiffAllButton = document.getElementById('compare-diff-all');
const compareDiffAutoCenterButton = document.getElementById('compare-diff-autocenter');
const compareDiffSensitivitySlider = document.getElementById('compare-diff-sensitivity');
const compareDiffSensitivityValue = document.getElementById('compare-diff-sensitivity-value');
const compareImageLabel = document.getElementById('compare-image-label');
const compareImage = document.getElementById('compare-image');
const compareDivider = document.getElementById('compare-divider');
const compareDiffOverlay = document.getElementById('compare-diff-overlay');
const compareDiffOverlaySecondary = document.getElementById('compare-diff-overlay-secondary');
const zoomSelectionBox = document.getElementById('zoom-selection-box');
const pipetteButton = document.getElementById('pipette-tool');
const pipetteCanvas = document.getElementById('pipette-canvas');
const pipetteColorResult = document.getElementById('pipette-color-result');
const pipetteHoverInfo = document.getElementById('pipette-hover-info');
const pipetteHoverPosition = document.getElementById('pipette-hover-position');
const pipetteHoverColor = document.getElementById('pipette-hover-color');
const pipetteHoverSwatch = document.getElementById('pipette-hover-swatch');
const overviewMapImage = document.getElementById('overview-map-image');
const overviewMapViewport = document.getElementById('overview-map-viewport');
const PIPETTE_RESULT_VISIBLE_DURATION_MS = 500;
const PIPETTE_RESULT_FADE_DURATION_MS = 260;
const selectedIcoSizeBadge = document.getElementById('selected-ico-size');
let icoGalleryItems = [];
let isDraggingOverviewMap = false;
let overviewMapDragPointerId = null;
let overviewMapViewportFrameId = null;
let pipetteMode = false;
let pipetteResultFadeTimeoutId = null;
let pipetteResultHideTimeoutId = null;
let customBackgroundEnabled = false;
const INFO_OVERLAY_STORAGE_KEY = 'imageDetails.infoOverlayVisible';
const INFO_OVERLAY_POSITION_STORAGE_KEY = 'imageDetails.infoOverlayPosition';
const COMPARE_DIFF_SENSITIVITY_STORAGE_KEY = 'imageDetails.compareDiffSensitivity';
const CUSTOM_BACKGROUND_ENABLED_STORAGE_KEY = 'imageDetails.customBackgroundEnabled';
const DIFF_ANALYSIS_MAX_DIMENSION_MIN = 2048;
const DIFF_ANALYSIS_MAX_DIMENSION_MAX = 8192;
const DIFF_PIXEL_THRESHOLD_MIN = 0.08;
const DIFF_PIXEL_THRESHOLD_MAX = 20;
const DIFF_REGION_MIN_PIXELS = 2;
const DIFF_REGION_MAX_ITEMS_MIN = 48;
const DIFF_REGION_MAX_ITEMS_MAX = 2000;
const DIFF_REGION_MERGE_GAP_PX_MIN = 0;
const DIFF_REGION_MERGE_GAP_PX_MAX = 6;
const DEFAULT_COMPARE_DIFF_SENSITIVITY = 10;

let zoom = 1;
let fitMode = false;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartScrollLeft = 0;
let dragStartScrollTop = 0;
let isDraggingOverlay = false;
let overlayPointerOffsetX = 0;
let overlayPointerOffsetY = 0;
let overlayDragPointerId = null;
let fitReflowFrameId = null;
let selectionMode = false;
let isSelectingZoomArea = false;
let selectionPointerId = null;
let selectionStartClientX = 0;
let selectionStartClientY = 0;
let compareEnabled = false;
let compareSplitPercent = 50;
let compareOrientation = 'vertical';
let compareViewMode = 'split';
let isDraggingCompareDivider = false;
let compareDividerPointerId = null;
let compareDividerDragFrameId = null;
let pendingCompareDragClientX = null;
let pendingCompareDragClientY = null;
let enableSideBySideOnNextComparePick = false;
let compareDiffAnalysisToken = 0;
let compareDiffOverlayCtx = null;
let compareDiffOverlaySecondaryCtx = null;
let compareDiffRegions = [];
let compareDiffCurrentIndex = -1;
let compareDiffOverlayTarget = 'left';
let compareDiffShowAllEnabled = false;
let compareDiffAutoCenterEnabled = false;
let compareDiffSensitivity = DEFAULT_COMPARE_DIFF_SENSITIVITY;
let originalImageSource = image?.getAttribute('src') || '';
let originalCompareImageSource = compareImage?.getAttribute('src') || '';
let imageTransformRenderToken = 0;
let imageTransformOperations = [];
let saveEditsToOriginalFile = false;
let galleryNavigationEnabled = false;
let galleryNavigationHasPrevious = false;
let galleryNavigationHasNext = false;
let galleryNavigationPositionLabelText = '';
let initialViewModeDecisionToken = 0;
const COMPARE_ORIENTATION_VERTICAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M10 4v12" stroke="currentColor" stroke-width="1.4"/></svg>';
const COMPARE_ORIENTATION_HORIZONTAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 10h12" stroke="currentColor" stroke-width="1.4"/></svg>';
const COMPARE_DIFF_TARGET_LEFT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2"/></svg>';
const COMPARE_DIFF_TARGET_RIGHT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2"/></svg>';
const COMPARE_DIFF_TARGET_BOTH_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg-inline-middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2"/></svg>';

/**
 * Parses a value to a floating-point number clamped within [min, max].
 *
 * @param {*} value Candidate value to parse.
 * @param {number} min Minimum allowed value.
 * @param {number} max Maximum allowed value.
 * @param {number} fallbackValue Value returned when parsing fails.
 * @returns {number} Clamped numeric value.
 */
function toClampedNumber(value, min, max, fallbackValue) {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return clamp(numericValue, min, max);
}

/**
 * Parses a value to an integer clamped within [min, max].
 *
 * @param {*} value Candidate value to parse.
 * @param {number} min Minimum allowed value.
 * @param {number} max Maximum allowed value.
 * @param {number} fallbackValue Value returned when parsing fails.
 * @returns {number} Clamped integer value.
 */
function toClampedInteger(value, min, max, fallbackValue) {
  return Math.round(toClampedNumber(value, min, max, fallbackValue));
}

/**
 * Converts a generic runtime value to a boolean flag.
 *
 * @param value Candidate value.
 * @param fallbackValue Fallback value when parsing fails.
 * @returns Parsed boolean flag.
 */
function toBooleanFlag(value, fallbackValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return fallbackValue;
}

/**
 * Indicates whether gallery navigation shortcuts should be ignored for the current target.
 *
 * @param {EventTarget | null} target Event target.
 * @returns {boolean} True when shortcuts should be ignored.
 */
function shouldIgnoreGalleryNavigationTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

/**
 * Applies gallery navigation state and updates UI affordances.
 *
 * @param {{ enabled?: unknown; hasPrevious?: unknown; hasNext?: unknown; positionLabel?: unknown }} navigationState
 */
function applyGalleryNavigationState(navigationState) {
  galleryNavigationEnabled = toBooleanFlag(navigationState?.enabled, false);
  galleryNavigationHasPrevious = galleryNavigationEnabled && toBooleanFlag(navigationState?.hasPrevious, false);
  galleryNavigationHasNext = galleryNavigationEnabled && toBooleanFlag(navigationState?.hasNext, false);
  galleryNavigationPositionLabelText = typeof navigationState?.positionLabel === 'string'
    ? navigationState.positionLabel.trim()
    : '';

  const visibilityClassAction = galleryNavigationEnabled ? 'remove' : 'add';
  galleryNavPrevButton?.classList[visibilityClassAction]('is-hidden');
  galleryNavNextButton?.classList[visibilityClassAction]('is-hidden');
  galleryNavPositionLabel?.classList[visibilityClassAction]('is-hidden');

  if (galleryNavPrevButton instanceof HTMLButtonElement) {
    galleryNavPrevButton.disabled = !galleryNavigationHasPrevious;
  }

  if (galleryNavNextButton instanceof HTMLButtonElement) {
    galleryNavNextButton.disabled = !galleryNavigationHasNext;
  }

  if (galleryNavPositionLabel instanceof HTMLElement) {
    galleryNavPositionLabel.textContent = galleryNavigationPositionLabelText;
  }
}

/**
 * Requests gallery navigation from the extension host.
 *
 * @param {'prev' | 'next'} direction Navigation direction.
 */
function requestGalleryNavigation(direction) {
  if (!galleryNavigationEnabled) {
    return;
  }

  if (direction === 'prev' && !galleryNavigationHasPrevious) {
    return;
  }

  if (direction === 'next' && !galleryNavigationHasNext) {
    return;
  }

  vscode?.postMessage({ type: 'navigate-gallery-image', direction });
}

/**
 * Initializes gallery navigation state from layout dataset values.
 */
function initializeGalleryNavigationFromDom() {
  applyGalleryNavigationState({
    enabled: layoutElement?.dataset?.galleryNavigationEnabled,
    hasPrevious: layoutElement?.dataset?.galleryNavigationHasPrevious,
    hasNext: layoutElement?.dataset?.galleryNavigationHasNext,
    positionLabel: layoutElement?.dataset?.galleryNavigationPositionLabel
  });

  applyGalleryNavigationBadgePositionForToolbar(getCurrentToolbarPosition());
}

/**
 * Applies the gallery navigation badge anchor according to toolbar position.
 *
 * When the toolbar is at the top, the badge is shown at the bottom.
 * When the toolbar is at the bottom, the badge is shown at the top.
 *
 * @param {string} toolbarPosition Position identifier: 'top', 'bottom', 'left' or 'right'.
 */
function applyGalleryNavigationBadgePositionForToolbar(toolbarPosition) {
  if (!(galleryNavPositionLabel instanceof HTMLElement)) {
    return;
  }

  galleryNavPositionLabel.classList.remove('gallery-nav-position-top', 'gallery-nav-position-bottom');

  if (toolbarPosition === 'top') {
    galleryNavPositionLabel.classList.add('gallery-nav-position-bottom');
    return;
  }

  if (toolbarPosition === 'bottom') {
    galleryNavPositionLabel.classList.add('gallery-nav-position-top');
    return;
  }

  galleryNavPositionLabel.classList.add('gallery-nav-position-top');
}

/**
 * Resolves the current toolbar position from CSS classes.
 *
 * @returns {string} Current toolbar position token.
 */
function getCurrentToolbarPosition() {
  if (!(zoomToolbar instanceof HTMLElement)) {
    return 'top';
  }

  if (zoomToolbar.classList.contains('toolbar-pos-bottom')) {
    return 'bottom';
  }

  if (zoomToolbar.classList.contains('toolbar-pos-left')) {
    return 'left';
  }

  if (zoomToolbar.classList.contains('toolbar-pos-right')) {
    return 'right';
  }

  return 'top';
}

/**
 * Normalizes quarter-turn values to a value in the [0..3] range.
 *
 * @param quarterTurns Requested quarter-turn count.
 * @returns Normalized quarter-turn count.
 */
function normalizeQuarterTurns(quarterTurns) {
  const normalizedTurns = Number.parseInt(String(quarterTurns), 10);
  if (!Number.isFinite(normalizedTurns)) {
    return 0;
  }

  return ((normalizedTurns % 4) + 4) % 4;
}

/**
 * Loads an image source in memory so it can be drawn to a canvas.
 *
 * @param source Image source URI.
 * @returns Promise resolved with the loaded image element.
 */
function loadImageForTransform(source) {
  return new Promise((resolve, reject) => {
    const sourceImage = new Image();
    sourceImage.addEventListener('load', () => resolve(sourceImage), { once: true });
    sourceImage.addEventListener('error', () => reject(new Error('Unable to load image for transform.')), { once: true });
    sourceImage.src = source;
  });
}

/**
 * Computes the net quarter-turn count from the current transform operation stack.
 *
 * @param {Array<{ kind: 'rotate' | 'mirror'; quarterTurnDelta?: number }>} operations Transform operations.
 * @returns {number} Normalized quarter-turn count.
 */
function getNormalizedQuarterTurnsFromOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return 0;
  }

  let quarterTurnSum = 0;
  for (const operation of operations) {
    if (operation?.kind !== 'rotate') {
      continue;
    }

    const parsedDelta = Number.parseInt(String(operation.quarterTurnDelta), 10);
    if (!Number.isFinite(parsedDelta)) {
      continue;
    }

    quarterTurnSum += parsedDelta;
  }

  return normalizeQuarterTurns(quarterTurnSum);
}

/**
 * Builds a transformed image source from a base source.
 *
 * @param source Base image source URI.
 * @param {Array<{ kind: 'rotate' | 'mirror'; quarterTurnDelta?: number; axis?: 'horizontal' | 'vertical' }>} operations
 *   Transform operations to apply in order.
 * @returns Promise resolved with the transformed source URI.
 */
async function buildTransformedImageSource(source, operations) {
  if (typeof source !== 'string' || source.length === 0) {
    return source;
  }

  if (!Array.isArray(operations) || operations.length === 0) {
    return source;
  }

  try {
    const sourceImage = await loadImageForTransform(source);
    const canvas = document.createElement('canvas');
    const normalizedTurns = getNormalizedQuarterTurnsFromOperations(operations);
    const quarterTurnIsOdd = normalizedTurns % 2 === 1;
    canvas.width = quarterTurnIsOdd ? sourceImage.naturalHeight : sourceImage.naturalWidth;
    canvas.height = quarterTurnIsOdd ? sourceImage.naturalWidth : sourceImage.naturalHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return source;
    }

    context.translate(canvas.width / 2, canvas.height / 2);

    for (const operation of operations) {
      if (operation?.kind === 'rotate') {
        const normalizedDelta = Number.parseInt(String(operation.quarterTurnDelta), 10);
        if (Number.isFinite(normalizedDelta) && normalizedDelta !== 0) {
          context.rotate(normalizedDelta * (Math.PI / 2));
        }
        continue;
      }

      if (operation?.kind !== 'mirror') {
        continue;
      }

      if (operation.axis === 'horizontal') {
        context.scale(-1, 1);
      } else if (operation.axis === 'vertical') {
        context.scale(1, -1);
      }
    }

    context.drawImage(sourceImage, -sourceImage.naturalWidth / 2, -sourceImage.naturalHeight / 2);
    return canvas.toDataURL('image/png');
  } catch {
    return source;
  }
}

/**
 * Applies the current transform stack to the main and comparison preview images.
 *
 * @returns Promise resolved when sources are updated.
 */
async function applyImageTransformToPreview() {
  if (!image) {
    return;
  }

  const nextRenderToken = imageTransformRenderToken + 1;
  imageTransformRenderToken = nextRenderToken;

  const nextMainSource = await buildTransformedImageSource(originalImageSource, imageTransformOperations);
  const nextCompareSource = originalCompareImageSource
    ? await buildTransformedImageSource(originalCompareImageSource, imageTransformOperations)
    : '';

  if (nextRenderToken !== imageTransformRenderToken) {
    return;
  }

  if (nextMainSource) {
    image.setAttribute('src', nextMainSource);
  }

  if (compareImage) {
    if (nextCompareSource) {
      compareImage.setAttribute('src', nextCompareSource);
    } else {
      compareImage.removeAttribute('src');
    }
  }
}

/**
 * Rotates the preview image by 90-degree increments.
 *
 * @param quarterTurnDelta Rotation delta in quarter-turns.
 */
function rotatePreviewImage(quarterTurnDelta) {
  imageTransformOperations.push({ kind: 'rotate', quarterTurnDelta });
  void applyImageTransformToPreview();
}

/**
 * Mirrors the preview image around the vertical axis (left/right swap).
 */
function mirrorPreviewImageHorizontally() {
  imageTransformOperations.push({ kind: 'mirror', axis: 'horizontal' });
  void applyImageTransformToPreview();
}

/**
 * Mirrors the preview image around the horizontal axis (top/bottom swap).
 */
function mirrorPreviewImageVertically() {
  imageTransformOperations.push({ kind: 'mirror', axis: 'vertical' });
  void applyImageTransformToPreview();
}

/**
 * Applies loupe (magnifier) configuration settings and reinitializes the virtual canvas if needed.
 *
 * @param {object} nextSettings Settings object with optional diameter, virtualResolution,
 *   zoomAtMinImageZoom and zoomAtMaxImageZoom properties.
 */
function applyLoupeSettings(nextSettings) {
  const nextDiameter = toClampedInteger(nextSettings?.diameter, 48, 256, DEFAULT_LOUPE_DIAMETER);
  const nextVirtualResolutionCandidate = toClampedInteger(nextSettings?.virtualResolution, 5, 101, DEFAULT_LOUPE_VIRTUAL_RESOLUTION);
  const nextVirtualResolution = nextVirtualResolutionCandidate % 2 === 0
    ? nextVirtualResolutionCandidate - 1
    : nextVirtualResolutionCandidate;
  const nextZoomAtMin = toClampedNumber(nextSettings?.zoomAtMinImageZoom, 0.25, 100, DEFAULT_LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM);
  const nextZoomAtMax = toClampedNumber(nextSettings?.zoomAtMaxImageZoom, 0.25, 100, DEFAULT_LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM);

  const didResolutionChange = loupeVirtualResolution !== nextVirtualResolution;
  loupeDiameter = nextDiameter;
  loupeVirtualResolution = nextVirtualResolution;
  loupeZoomAtMinImageZoom = nextZoomAtMin;
  loupeZoomAtMaxImageZoom = nextZoomAtMax;
  loupeDynamicZoomMin = Math.min(loupeZoomAtMinImageZoom, loupeZoomAtMaxImageZoom);
  loupeDynamicZoomMax = Math.max(loupeZoomAtMinImageZoom, loupeZoomAtMaxImageZoom);

  if (didResolutionChange || virtualLoupeCanvas === null || virtualLoupeCtx === null) {
    virtualLoupeCanvas = document.createElement('canvas');
    virtualLoupeCanvas.width = loupeVirtualResolution;
    virtualLoupeCanvas.height = loupeVirtualResolution;
    virtualLoupeCtx = virtualLoupeCanvas.getContext('2d');
  }
}

/**
 * Reads loupe settings from layout element data attributes and applies them.
 */
function initializeLoupeSettingsFromDom() {
  applyLoupeSettings({
    diameter: layoutElement?.dataset.loupeDiameter,
    virtualResolution: layoutElement?.dataset.loupeVirtualResolution,
    zoomAtMinImageZoom: layoutElement?.dataset.loupeZoomAtMinImageZoom,
    zoomAtMaxImageZoom: layoutElement?.dataset.loupeZoomAtMaxImageZoom
  });
}

/**
 * Reads the toolbar accent color from the layout element data attributes and applies it.
 */
function initializeThemeFromDom() {
  if (!layoutElement) {
    return;
  }

  const accentRgb = layoutElement.dataset.toolbarGreenAccentRgb;
  if (typeof accentRgb === 'string' && accentRgb.trim().length > 0) {
    applyThemeAccentRgb(accentRgb);
  }
}

/**
 * Reads the configured preview background color from the layout element data attributes and applies it.
 */
function initializePreviewBackgroundFromDom() {
  if (!layoutElement) {
    return;
  }

  const previewBackgroundRgb = layoutElement.dataset.previewBackgroundRgb;
  if (typeof previewBackgroundRgb === 'string' && previewBackgroundRgb.trim().length > 0) {
    applyPreviewBackgroundRgb(previewBackgroundRgb);
  }
}

/**
 * Restores the custom preview background toggle state from local storage.
 */
function initializeCustomBackgroundToggleState() {
  let nextEnabled = false;

  try {
    const storedValue = localStorage.getItem(CUSTOM_BACKGROUND_ENABLED_STORAGE_KEY);
    if (storedValue !== null) {
      nextEnabled = toBooleanFlag(storedValue, nextEnabled);
    }
  } catch {
    // Ignore storage errors and keep default value.
  }

  setCustomBackgroundEnabled(nextEnabled);
}

/**
 * Initializes edit persistence behavior from webview data attributes.
 */
function initializeEditPersistenceSettingsFromDom() {
  if (!layoutElement) {
    return;
  }

  saveEditsToOriginalFile = toBooleanFlag(
    layoutElement.dataset.saveEditsToOriginalFile,
    saveEditsToOriginalFile
  );
}

/**
 * Applies a new diff sensitivity value and updates the slider and label UI.
 *
 * @param {*} nextSensitivity Candidate sensitivity value (1–100).
 */
function applyCompareDiffSensitivity(nextSensitivity) {
  compareDiffSensitivity = toClampedInteger(
    nextSensitivity,
    1,
    100,
    DEFAULT_COMPARE_DIFF_SENSITIVITY
  );

  if (compareDiffSensitivitySlider instanceof HTMLInputElement) {
    compareDiffSensitivitySlider.value = String(compareDiffSensitivity);
    compareDiffSensitivitySlider.setAttribute('aria-valuenow', String(compareDiffSensitivity));
  }

  if (compareDiffSensitivityValue) {
    compareDiffSensitivityValue.textContent = String(compareDiffSensitivity);
  }
}

/**
 * Reads the stored diff sensitivity from localStorage and applies it.
 */
function initializeCompareDiffSettingsFromDom() {
  let nextSensitivity = DEFAULT_COMPARE_DIFF_SENSITIVITY;

  try {
    const storedValue = localStorage.getItem(COMPARE_DIFF_SENSITIVITY_STORAGE_KEY);
    if (storedValue !== null) {
      nextSensitivity = toClampedInteger(storedValue, 1, 100, nextSensitivity);
    }
  } catch {
    // Ignore storage errors and keep default value.
  }

  applyCompareDiffSensitivity(nextSensitivity);
}

/**
 * Returns the 2D canvas context for the pipette buffer canvas, creating it if necessary.
 *
 * @returns {CanvasRenderingContext2D | null} The buffer context, or null when unavailable.
 */
function ensurePipetteBufferContext() {
  if (!pipetteCanvas) {
    return null;
  }

  if (!pipetteImageCtx) {
    pipetteImageCtx = pipetteCanvas.getContext('2d');
  }

  return pipetteImageCtx;
}

/**
 * Redraws the current preview image into the off-screen pipette buffer canvas.
 */
function refreshPipetteImageBuffer() {
  if (!image || !pipetteCanvas) {
    return;
  }

  const bufferContext = ensurePipetteBufferContext();
  if (!bufferContext || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return;
  }

  pipetteCanvas.width = image.naturalWidth;
  pipetteCanvas.height = image.naturalHeight;
  pipetteCanvas.style.display = 'none';
  bufferContext.clearRect(0, 0, pipetteCanvas.width, pipetteCanvas.height);
  bufferContext.drawImage(image, 0, 0);
}

/**
 * Applies a toolbar position class to the zoom toolbar element.
 *
 * @param {string} toolbarPosition Position identifier: 'top', 'bottom', 'left' or 'right'.
 */
function applyToolbarPosition(toolbarPosition) {
  if (!zoomToolbar) {
    return;
  }

  for (const toolbarClass of TOOLBAR_POSITION_CLASSES) {
    zoomToolbar?.classList.remove(toolbarClass);
  }

  if (TOOLBAR_POSITION_CLASSES.includes(`toolbar-pos-${toolbarPosition}`)) {
    zoomToolbar?.classList.add(`toolbar-pos-${toolbarPosition}`);
  }

  applyGalleryNavigationBadgePositionForToolbar(toolbarPosition);
}

/**
 * Sets the toolbar green accent color via a CSS custom property on the layout element.
 *
 * @param {string} accentRgb RGB value string, e.g. '120,200,80'.
 */
function applyThemeAccentRgb(accentRgb) {
  if (!layoutElement || typeof accentRgb !== 'string' || accentRgb.trim().length === 0) {
    return;
  }

  layoutElement.style.setProperty('--toolbar-green-accent-rgb', accentRgb.trim());
}

/**
 * Sets the custom preview background color via a CSS custom property on the layout element.
 *
 * @param {string} backgroundRgb RGB value string, e.g. '32,32,32'.
 */
function applyPreviewBackgroundRgb(backgroundRgb) {
  if (!layoutElement || typeof backgroundRgb !== 'string' || backgroundRgb.trim().length === 0) {
    return;
  }

  layoutElement.style.setProperty('--image-details-custom-background-rgb', backgroundRgb.trim());
}

/**
 * Synchronizes the custom preview background toggle appearance and preview state.
 */
function updateCustomBackgroundToggleUi() {
  if (!layoutElement || !customBackgroundToggleButton) {
    return;
  }

  layoutElement.classList.toggle('custom-preview-background-enabled', customBackgroundEnabled);
  customBackgroundToggleButton.classList.toggle('is-active', customBackgroundEnabled);

  const nextLabel = customBackgroundEnabled
    ? 'Use theme background'
    : 'Use custom background';

  customBackgroundToggleButton.setAttribute('aria-pressed', customBackgroundEnabled ? 'true' : 'false');
  customBackgroundToggleButton.setAttribute('aria-label', nextLabel);
  customBackgroundToggleButton.setAttribute('title', nextLabel);
}

/**
 * Enables or disables the custom preview background and persists the current choice.
 *
 * @param {boolean} isEnabled Whether the custom preview background should be enabled.
 */
function setCustomBackgroundEnabled(isEnabled) {
  customBackgroundEnabled = Boolean(isEnabled);
  updateCustomBackgroundToggleUi();

  try {
    localStorage.setItem(CUSTOM_BACKGROUND_ENABLED_STORAGE_KEY, String(customBackgroundEnabled));
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Syncs the selection-mode CSS classes and aria attributes to match the current state.
 */
function updateSelectionModeUi() {
  if (!preview || !zoomSelectButton) {
    return;
  }

  previewContainer?.classList.toggle('selection-mode', selectionMode);
  zoomSelectButton?.classList.toggle('is-active', selectionMode);
  zoomSelectButton.setAttribute('aria-pressed', selectionMode ? 'true' : 'false');
}

/**
 * Enables or disables the area-zoom selection mode.
 *
 * @param {boolean} isEnabled Whether selection mode should be active.
 */
function setSelectionMode(isEnabled) {
  selectionMode = isEnabled;

  if (!selectionMode) {
    hideSelectionBox();
  }

  updateSelectionModeUi();
}

/**
 * Returns true when a comparison image is currently loaded.
 *
 * @returns {boolean} True when a comparison image source is available.
 */
function hasComparisonImage() {
  return Boolean(compareImage?.getAttribute('src'));
}

/**
 * Returns true when side-by-side compare mode is active and a comparison image is loaded.
 *
 * @returns {boolean} True when side-by-side compare mode is currently active.
 */
function isSideBySideCompareActive() {
  return compareViewMode === 'side-by-side' && hasComparisonImage();
}

/**
 * Returns the 2D canvas context for the primary diff overlay, creating it if necessary.
 *
 * @returns {CanvasRenderingContext2D | null} The primary diff overlay context, or null.
 */
function ensureCompareDiffOverlayContext() {
  if (!compareDiffOverlay) {
    return null;
  }

  if (!compareDiffOverlayCtx) {
    compareDiffOverlayCtx = compareDiffOverlay.getContext('2d');
  }

  return compareDiffOverlayCtx;
}

/**
 * Returns the 2D canvas context for the secondary diff overlay, creating it if necessary.
 *
 * @returns {CanvasRenderingContext2D | null} The secondary diff overlay context, or null.
 */
function ensureCompareDiffOverlaySecondaryContext() {
  if (!compareDiffOverlaySecondary) {
    return null;
  }

  if (!compareDiffOverlaySecondaryCtx) {
    compareDiffOverlaySecondaryCtx = compareDiffOverlaySecondary.getContext('2d');
  }

  return compareDiffOverlaySecondaryCtx;
}

/**
 * Returns the icon, title and label for a given diff overlay target side.
 *
 * @param {'left'|'right'|'both'} target Which image(s) to highlight differences on.
 * @returns {{ iconSvg: string, title: string, label: string }}
 */
function getCompareDiffTargetPresentation(target) {
  if (target === 'right') {
    return {
      iconSvg: COMPARE_DIFF_TARGET_RIGHT_ICON_SVG,
      title: 'Show differences on right image',
      label: 'right'
    };
  }

  if (target === 'both') {
    return {
      iconSvg: COMPARE_DIFF_TARGET_BOTH_ICON_SVG,
      title: 'Show differences on both images',
      label: 'both'
    };
  }

  return {
    iconSvg: COMPARE_DIFF_TARGET_LEFT_ICON_SVG,
    title: 'Show differences on left image',
    label: 'left'
  };
}

/**
 * Updates the diff navigation buttons (prev, next, all, auto-center, target) to reflect the
 * current diff regions and active index.
 */
function updateCompareDiffNavigationUi() {
  const regionCount = compareDiffRegions.length;
  const hasRegions = regionCount > 0;
  const sideBySideActive = isSideBySideCompareActive();
  const isShowingAllDifferences = compareDiffShowAllEnabled && hasRegions;

  if (compareDiffIndexLabel) {
    if (!hasRegions) {
      compareDiffIndexLabel.textContent = '0/0';
    } else if (isShowingAllDifferences) {
      compareDiffIndexLabel.textContent = `All (${String(regionCount)})`;
    } else {
      compareDiffIndexLabel.textContent = compareDiffCurrentIndex >= 0
        ? `${String(compareDiffCurrentIndex + 1)}/${String(regionCount)}`
        : '0/0';
    }
  }

  if (compareDiffPrevButton) {
    compareDiffPrevButton.disabled = !sideBySideActive || !hasRegions || isShowingAllDifferences || compareDiffCurrentIndex <= 0;
  }

  if (compareDiffNextButton) {
    compareDiffNextButton.disabled = !sideBySideActive || !hasRegions || isShowingAllDifferences || compareDiffCurrentIndex >= regionCount - 1;
  }

  if (compareDiffTargetButton) {
    const targetPresentation = getCompareDiffTargetPresentation(compareDiffOverlayTarget);
    compareDiffTargetButton.dataset.target = targetPresentation.label;
    compareDiffTargetButton.setAttribute('title', targetPresentation.title);
    compareDiffTargetButton.setAttribute('aria-label', targetPresentation.title);
    compareDiffTargetButton.disabled = !sideBySideActive;

    const iconElement = compareDiffTargetButton.querySelector('.icon');
    if (iconElement) {
      iconElement.innerHTML = targetPresentation.iconSvg;
    }
  }

  if (compareDiffAllButton) {
    compareDiffAllButton.disabled = !sideBySideActive || !hasRegions;
    compareDiffAllButton?.classList.toggle('is-active', isShowingAllDifferences);
    compareDiffAllButton.setAttribute('aria-pressed', isShowingAllDifferences ? 'true' : 'false');
    compareDiffAllButton.setAttribute('title', isShowingAllDifferences ? 'Show selected difference only' : 'Show all differences');
    compareDiffAllButton.setAttribute('aria-label', isShowingAllDifferences ? 'Show selected difference only' : 'Show all differences');
  }

  if (compareDiffAutoCenterButton) {
    compareDiffAutoCenterButton.disabled = !sideBySideActive || !hasRegions;
    compareDiffAutoCenterButton?.classList.toggle('is-active', compareDiffAutoCenterEnabled);
    compareDiffAutoCenterButton.setAttribute('aria-pressed', compareDiffAutoCenterEnabled ? 'true' : 'false');
  }
}

/**
 * Scrolls the preview so that the currently active diff region is centered in the viewport.
 */
function centerPreviewOnActiveDifference() {
  if (!preview || compareDiffCurrentIndex < 0 || compareDiffCurrentIndex >= compareDiffRegions.length) {
    return;
  }

  const activeRegion = compareDiffRegions[compareDiffCurrentIndex];
  const targetImage = compareDiffOverlayTarget === 'right' ? compareImage : image;
  if (!targetImage) {
    return;
  }

  const targetRect = targetImage.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0 || previewRect.width <= 0 || previewRect.height <= 0) {
    return;
  }

  const targetCenterX = targetRect.left + ((activeRegion.minXRatio + activeRegion.maxXRatio) / 2) * targetRect.width;
  const targetCenterY = targetRect.top + ((activeRegion.minYRatio + activeRegion.maxYRatio) / 2) * targetRect.height;
  const viewportCenterX = previewRect.left + preview.clientWidth / 2;
  const viewportCenterY = previewRect.top + preview.clientHeight / 2;

  preview.scrollLeft += targetCenterX - viewportCenterX;
  preview.scrollTop += targetCenterY - viewportCenterY;
}

/**
 * Scrolls the preview to the active diff region when auto-center is enabled.
 */
function centerPreviewOnActiveDifferenceIfEnabled() {
  if (!compareDiffAutoCenterEnabled || !isSideBySideCompareActive()) {
    return;
  }

  requestAnimationFrame(() => {
    centerPreviewOnActiveDifference();
    renderCompareDifferenceOverlay();
  });
}

/**
 * Draws a single diff region rectangle with a numbered label on a canvas overlay.
 *
 * @param {HTMLCanvasElement} overlayElement The target overlay canvas.
 * @param {CanvasRenderingContext2D} overlayContext The 2D context of the overlay.
 * @param {HTMLImageElement} targetImage The image element the overlay is positioned over.
 * @param {{ minXRatio: number, minYRatio: number, maxXRatio: number, maxYRatio: number }} region
 *   Normalized region bounds (0–1).
 * @param {number} regionIndex Zero-based index used for the 'D#' label.
 * @param {{ clearCanvas?: boolean, isActiveRegion?: boolean }} [options] Drawing options.
 */
function drawCompareDifferenceRegionOnOverlay(overlayElement, overlayContext, targetImage, region, regionIndex, options = {}) {
  const targetRect = targetImage.getBoundingClientRect();
  const previewRect = previewContainer?.getBoundingClientRect();
  const renderedWidth = Math.round(targetRect.width);
  const renderedHeight = Math.round(targetRect.height);
  const clearCanvas = options.clearCanvas ?? true;
  const isActiveRegion = options.isActiveRegion ?? false;

  if (renderedWidth <= 0 || renderedHeight <= 0) {
    overlayContext.clearRect(0, 0, overlayElement.width, overlayElement.height);
    overlayElement?.classList.add('is-hidden');
    return;
  }

  if (!previewRect) {
    overlayContext.clearRect(0, 0, overlayElement.width, overlayElement.height);
    overlayElement?.classList.add('is-hidden');
    return;
  }

  overlayElement.style.left = `${String(Math.round(targetRect.left - previewRect.left))}px`;
  overlayElement.style.top = `${String(Math.round(targetRect.top - previewRect.top))}px`;
  overlayElement?.classList.remove('is-hidden');

  const shouldResetCanvasDimensions = clearCanvas
    || overlayElement.width !== renderedWidth
    || overlayElement.height !== renderedHeight;

  if (shouldResetCanvasDimensions) {
    overlayElement.width = renderedWidth;
    overlayElement.height = renderedHeight;
    overlayElement.style.width = `${String(renderedWidth)}px`;
    overlayElement.style.height = `${String(renderedHeight)}px`;
  }

  if (clearCanvas || shouldResetCanvasDimensions) {
    overlayContext.clearRect(0, 0, renderedWidth, renderedHeight);
  }

  overlayContext.lineJoin = 'round';
  overlayContext.font = '600 11px var(--vscode-font-family)';
  overlayContext.textBaseline = 'top';

  const x = Math.round(region.minXRatio * renderedWidth);
  const y = Math.round(region.minYRatio * renderedHeight);
  const width = Math.max(2, Math.round((region.maxXRatio - region.minXRatio) * renderedWidth));
  const height = Math.max(2, Math.round((region.maxYRatio - region.minYRatio) * renderedHeight));

  overlayContext.strokeStyle = isActiveRegion ? 'rgba(255, 74, 87, 0.98)' : 'rgba(255, 130, 142, 0.9)';
  overlayContext.lineWidth = isActiveRegion ? 2 : 1.5;
  overlayContext.strokeRect(x, y, width, height);

  const label = `D${String(regionIndex + 1)}`;
  const labelWidth = overlayContext.measureText(label).width + 8;
  const labelHeight = 16;
  const labelX = x;
  const labelY = Math.max(0, y - labelHeight);

  overlayContext.fillStyle = isActiveRegion ? 'rgba(255, 74, 87, 0.95)' : 'rgba(255, 130, 142, 0.9)';
  overlayContext.fillRect(labelX, labelY, labelWidth, labelHeight);
  overlayContext.fillStyle = '#ffffff';
  overlayContext.fillText(label, labelX + 4, labelY + 2);
}

/**
 * Clears the diff overlay canvases. Optionally resets the stored regions and current index.
 *
 * @param {boolean} [clearRegions=false] When true, resets regions and index.
 */
function clearCompareDifferenceOverlay(clearRegions = false) {
  if (clearRegions) {
    compareDiffRegions = [];
    compareDiffCurrentIndex = -1;
    compareDiffShowAllEnabled = false;
  }

  const primaryOverlayContext = ensureCompareDiffOverlayContext();
  if (compareDiffOverlay && primaryOverlayContext) {
    primaryOverlayContext.clearRect(0, 0, compareDiffOverlay.width, compareDiffOverlay.height);
    compareDiffOverlay?.classList.add('is-hidden');
  }

  const secondaryOverlayContext = ensureCompareDiffOverlaySecondaryContext();
  if (compareDiffOverlaySecondary && secondaryOverlayContext) {
    secondaryOverlayContext.clearRect(0, 0, compareDiffOverlaySecondary.width, compareDiffOverlaySecondary.height);
    compareDiffOverlaySecondary?.classList.add('is-hidden');
  }

  updateCompareDiffNavigationUi();
}

/**
 * Redraws the diff overlay canvases to reflect the current regions and active index.
 */
function renderCompareDifferenceOverlay() {
  if (!image || !compareImage || !isSideBySideCompareActive()) {
    clearCompareDifferenceOverlay(false);
    return;
  }

  const hasRegions = compareDiffRegions.length > 0;
  const showAllRegions = compareDiffShowAllEnabled && hasRegions;
  const activeRegion = compareDiffCurrentIndex >= 0
    ? compareDiffRegions[compareDiffCurrentIndex]
    : undefined;

  if (!showAllRegions && !activeRegion) {
    clearCompareDifferenceOverlay(false);
    return;
  }

  const regionsToRender = showAllRegions ? compareDiffRegions : [activeRegion];

  const primaryOverlayContext = ensureCompareDiffOverlayContext();
  if (compareDiffOverlay && primaryOverlayContext) {
    if (compareDiffOverlayTarget === 'left' || compareDiffOverlayTarget === 'both') {
      for (let regionIndex = 0; regionIndex < regionsToRender.length; regionIndex += 1) {
        const region = regionsToRender[regionIndex];
        if (!region) {
          continue;
        }

        const absoluteRegionIndex = showAllRegions ? regionIndex : compareDiffCurrentIndex;
        drawCompareDifferenceRegionOnOverlay(
          compareDiffOverlay,
          primaryOverlayContext,
          image,
          region,
          absoluteRegionIndex,
          {
            clearCanvas: regionIndex === 0,
            isActiveRegion: absoluteRegionIndex === compareDiffCurrentIndex
          }
        );
      }
    } else {
      primaryOverlayContext.clearRect(0, 0, compareDiffOverlay.width, compareDiffOverlay.height);
      compareDiffOverlay?.classList.add('is-hidden');
    }
  }

  const secondaryOverlayContext = ensureCompareDiffOverlaySecondaryContext();
  if (compareDiffOverlaySecondary && secondaryOverlayContext) {
    if (compareDiffOverlayTarget === 'right' || compareDiffOverlayTarget === 'both') {
      for (let regionIndex = 0; regionIndex < regionsToRender.length; regionIndex += 1) {
        const region = regionsToRender[regionIndex];
        if (!region) {
          continue;
        }

        const absoluteRegionIndex = showAllRegions ? regionIndex : compareDiffCurrentIndex;
        drawCompareDifferenceRegionOnOverlay(
          compareDiffOverlaySecondary,
          secondaryOverlayContext,
          compareImage,
          region,
          absoluteRegionIndex,
          {
            clearCanvas: regionIndex === 0,
            isActiveRegion: absoluteRegionIndex === compareDiffCurrentIndex
          }
        );
      }
    } else {
      secondaryOverlayContext.clearRect(0, 0, compareDiffOverlaySecondary.width, compareDiffOverlaySecondary.height);
      compareDiffOverlaySecondary?.classList.add('is-hidden');
    }
  }

  updateCompareDiffNavigationUi();
}

/**
 * Performs a pixel-level diff analysis between the two loaded images and populates compareDiffRegions.
 *
 * @param {number} token Analysis token used to discard stale results when a newer analysis starts.
 */
function runCompareDifferenceAnalysis(token) {
  if (!image || !compareImage) {
    return;
  }

  const baseWidth = image.naturalWidth;
  const baseHeight = image.naturalHeight;
  const compareWidth = compareImage.naturalWidth;
  const compareHeight = compareImage.naturalHeight;

  if (baseWidth <= 0 || baseHeight <= 0 || compareWidth <= 0 || compareHeight <= 0) {
    clearCompareDifferenceOverlay(true);
    return;
  }

  if (baseWidth !== compareWidth || baseHeight !== compareHeight) {
    clearCompareDifferenceOverlay(true);
    return;
  }

  const sensitivityRatio = clamp(compareDiffSensitivity, 1, 100) / 100;
  const analysisMaxDimension = Math.round(
    DIFF_ANALYSIS_MAX_DIMENSION_MIN
    + (sensitivityRatio ** 2) * (DIFF_ANALYSIS_MAX_DIMENSION_MAX - DIFF_ANALYSIS_MAX_DIMENSION_MIN)
  );
  const maxDimension = Math.max(baseWidth, baseHeight);
  const scale = Math.min(1, analysisMaxDimension / maxDimension);
  const analysisWidth = Math.max(1, Math.round(baseWidth * scale));
  const analysisHeight = Math.max(1, Math.round(baseHeight * scale));

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = analysisWidth;
  baseCanvas.height = analysisHeight;
  const compareCanvas = document.createElement('canvas');
  compareCanvas.width = analysisWidth;
  compareCanvas.height = analysisHeight;

  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  const compareContext = compareCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseContext || !compareContext) {
    clearCompareDifferenceOverlay(true);
    return;
  }

  // Keep nearest-neighbor sampling to preserve tiny per-pixel differences when downscaling.
  baseContext.imageSmoothingEnabled = false;
  compareContext.imageSmoothingEnabled = false;

  baseContext.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  compareContext.drawImage(compareImage, 0, 0, analysisWidth, analysisHeight);

  const basePixels = baseContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const comparePixels = compareContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const pixelCount = analysisWidth * analysisHeight;
  const diffMask = new Uint8Array(pixelCount);
  const diffStrength = new Float32Array(pixelCount);

  const sensitivityCurve = (1 - sensitivityRatio) ** 2;
  const defaultPixelThreshold = DIFF_PIXEL_THRESHOLD_MIN
    + sensitivityCurve * (DIFF_PIXEL_THRESHOLD_MAX - DIFF_PIXEL_THRESHOLD_MIN);

  let changedPixels = 0;
  let activePixelThreshold = defaultPixelThreshold;

  const fillDiffMask = (pixelThreshold) => {
    changedPixels = 0;

    for (let index = 0; index < pixelCount; index += 1) {
      const pixelOffset = index * 4;
      const deltaRed = Math.abs(basePixels[pixelOffset] - comparePixels[pixelOffset]);
      const deltaGreen = Math.abs(basePixels[pixelOffset + 1] - comparePixels[pixelOffset + 1]);
      const deltaBlue = Math.abs(basePixels[pixelOffset + 2] - comparePixels[pixelOffset + 2]);
      const deltaAlpha = Math.abs(basePixels[pixelOffset + 3] - comparePixels[pixelOffset + 3]);
      const colorDelta = (deltaRed + deltaGreen + deltaBlue) / 3;
      const weightedDelta = colorDelta * 0.85 + deltaAlpha * 0.15;

      if (weightedDelta >= pixelThreshold) {
        diffMask[index] = 1;
        diffStrength[index] = weightedDelta;
        changedPixels += 1;
      } else {
        diffMask[index] = 0;
        diffStrength[index] = 0;
      }
    }
  };

  fillDiffMask(activePixelThreshold);

  if (changedPixels === 0) {
    activePixelThreshold = Math.max(DIFF_PIXEL_THRESHOLD_MIN, defaultPixelThreshold * 0.7);
    fillDiffMask(activePixelThreshold);
  }

  if (token !== compareDiffAnalysisToken) {
    return;
  }

  if (changedPixels === 0) {
    compareDiffRegions = [];
    compareDiffCurrentIndex = -1;
    renderCompareDifferenceOverlay();
    return;
  }

  const sensitivityAdjustedMinPixels = Math.max(
    1,
    Math.ceil(DIFF_REGION_MIN_PIXELS * (1 - 0.75 * sensitivityRatio))
  );
  const minimumRegionPixels = Math.max(1, Math.round(sensitivityAdjustedMinPixels * scale * scale));

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const regions = [];

  for (let rootIndex = 0; rootIndex < pixelCount; rootIndex += 1) {
    if (diffMask[rootIndex] === 0 || visited[rootIndex] === 1) {
      continue;
    }

    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = rootIndex;
    queueEnd += 1;
    visited[rootIndex] = 1;

    let regionPixels = 0;
    let minX = analysisWidth;
    let minY = analysisHeight;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    let regionStrength = 0;

    while (queueStart < queueEnd) {
      const currentIndex = queue[queueStart];
      queueStart += 1;
      const x = currentIndex % analysisWidth;

      regionPixels += 1;
      sumX += x;
      sumY += Math.floor(currentIndex / analysisWidth);
      regionStrength += diffStrength[currentIndex];
      minX = Math.min(minX, x);
      minY = Math.min(minY, Math.floor(currentIndex / analysisWidth));
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, Math.floor(currentIndex / analysisWidth));

      const leftNeighbor = currentIndex - 1;
      const rightNeighbor = currentIndex + 1;
      const topNeighbor = currentIndex - analysisWidth;
      const bottomNeighbor = currentIndex + analysisWidth;

      if (x > 0 && diffMask[leftNeighbor] === 1 && visited[leftNeighbor] === 0) {
        visited[leftNeighbor] = 1;
        queue[queueEnd] = leftNeighbor;
        queueEnd += 1;
      }

      if (x < analysisWidth - 1 && diffMask[rightNeighbor] === 1 && visited[rightNeighbor] === 0) {
        visited[rightNeighbor] = 1;
        queue[queueEnd] = rightNeighbor;
        queueEnd += 1;
      }

      if (topNeighbor >= 0 && diffMask[topNeighbor] === 1 && visited[topNeighbor] === 0) {
        visited[topNeighbor] = 1;
        queue[queueEnd] = topNeighbor;
        queueEnd += 1;
      }

      if (bottomNeighbor < pixelCount && diffMask[bottomNeighbor] === 1 && visited[bottomNeighbor] === 0) {
        visited[bottomNeighbor] = 1;
        queue[queueEnd] = bottomNeighbor;
        queueEnd += 1;
      }
    }

    if (regionPixels < minimumRegionPixels) {
      continue;
    }

    regions.push({
      pixelCount: regionPixels,
      meanStrength: regionStrength / regionPixels,
      minXRatio: minX / analysisWidth,
      minYRatio: minY / analysisHeight,
      maxXRatio: (maxX + 1) / analysisWidth,
      maxYRatio: (maxY + 1) / analysisHeight
    });
  }

  if (token !== compareDiffAnalysisToken) {
    return;
  }

  const previouslySelectedIndex = compareDiffCurrentIndex;

  const sortedRegions = regions
    .sort((leftRegion, rightRegion) => rightRegion.pixelCount - leftRegion.pixelCount);

  const containmentTolerance = 1 / Math.max(analysisWidth, analysisHeight);
  const filteredRegions = [];

  for (const candidateRegion of sortedRegions) {
    const isContainedInExistingRegion = filteredRegions.some((keptRegion) => {
      return (
        candidateRegion.minXRatio >= keptRegion.minXRatio - containmentTolerance
        && candidateRegion.minYRatio >= keptRegion.minYRatio - containmentTolerance
        && candidateRegion.maxXRatio <= keptRegion.maxXRatio + containmentTolerance
        && candidateRegion.maxYRatio <= keptRegion.maxYRatio + containmentTolerance
      );
    });

    if (isContainedInExistingRegion) {
      continue;
    }

    filteredRegions.push(candidateRegion);
  }

  const mergeGapPixels = DIFF_REGION_MERGE_GAP_PX_MAX
    - sensitivityRatio * (DIFF_REGION_MERGE_GAP_PX_MAX - DIFF_REGION_MERGE_GAP_PX_MIN);
  const mergeGapXRatio = mergeGapPixels / analysisWidth;
  const mergeGapYRatio = mergeGapPixels / analysisHeight;
  const mergedRegions = filteredRegions.map((region) => ({ ...region }));

  let didMerge = true;
  while (didMerge) {
    didMerge = false;

    for (let leftIndex = 0; leftIndex < mergedRegions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < mergedRegions.length; rightIndex += 1) {
        const leftRegion = mergedRegions[leftIndex];
        const rightRegion = mergedRegions[rightIndex];

        const overlapsOrNearHorizontally = leftRegion.minXRatio <= rightRegion.maxXRatio + mergeGapXRatio
          && leftRegion.maxXRatio >= rightRegion.minXRatio - mergeGapXRatio;
        const overlapsOrNearVertically = leftRegion.minYRatio <= rightRegion.maxYRatio + mergeGapYRatio
          && leftRegion.maxYRatio >= rightRegion.minYRatio - mergeGapYRatio;

        if (!overlapsOrNearHorizontally || !overlapsOrNearVertically) {
          continue;
        }

        const mergedPixelCount = leftRegion.pixelCount + rightRegion.pixelCount;
        const mergedMeanStrength = mergedPixelCount > 0
          ? ((leftRegion.meanStrength * leftRegion.pixelCount) + (rightRegion.meanStrength * rightRegion.pixelCount)) / mergedPixelCount
          : leftRegion.meanStrength;

        mergedRegions[leftIndex] = {
          pixelCount: mergedPixelCount,
          meanStrength: mergedMeanStrength,
          minXRatio: Math.min(leftRegion.minXRatio, rightRegion.minXRatio),
          minYRatio: Math.min(leftRegion.minYRatio, rightRegion.minYRatio),
          maxXRatio: Math.max(leftRegion.maxXRatio, rightRegion.maxXRatio),
          maxYRatio: Math.max(leftRegion.maxYRatio, rightRegion.maxYRatio)
        };

        mergedRegions.splice(rightIndex, 1);
        didMerge = true;
        break;
      }

      if (didMerge) {
        break;
      }
    }
  }

  const maxRegionItems = Math.round(
    DIFF_REGION_MAX_ITEMS_MIN
    + sensitivityRatio * (DIFF_REGION_MAX_ITEMS_MAX - DIFF_REGION_MAX_ITEMS_MIN)
  );

  compareDiffRegions = mergedRegions
    .sort((leftRegion, rightRegion) => rightRegion.pixelCount - leftRegion.pixelCount)
    .slice(0, maxRegionItems);

  if (compareDiffRegions.length === 0) {
    compareDiffCurrentIndex = -1;
  } else if (previouslySelectedIndex < 0) {
    compareDiffCurrentIndex = 0;
  } else {
    compareDiffCurrentIndex = clamp(previouslySelectedIndex, 0, compareDiffRegions.length - 1);
  }

  renderCompareDifferenceOverlay();
}

/**
 * Schedules a fresh diff analysis asynchronously and clears any previous results.
 */
function scheduleCompareDifferenceAnalysis() {
  compareDiffAnalysisToken += 1;
  const token = compareDiffAnalysisToken;
  clearCompareDifferenceOverlay(false);

  window.setTimeout(() => {
    if (token !== compareDiffAnalysisToken) {
      return;
    }

    runCompareDifferenceAnalysis(token);
  }, 0);
}

/**
 * Returns the icon SVG and tooltip title for the compare orientation toggle button.
 *
 * @returns {{ iconSvg: string, title: string }}
 */
function getCompareOrientationButtonState() {
  if (compareOrientation === 'vertical') {
    return {
      iconSvg: COMPARE_ORIENTATION_VERTICAL_ICON_SVG,
      title: 'Switch to horizontal split'
    };
  }

  return {
    iconSvg: COMPARE_ORIENTATION_HORIZONTAL_ICON_SVG,
    title: 'Switch to vertical split'
  };
}

/**
 * Syncs the visibility, active state and disabled state of all compare toolbar controls
 * to match the current compare mode.
 */
function updateCompareControlsUi() {
  const available = hasComparisonImage();
  const shouldShowControls = available || compareEnabled;
  const sideBySideActive = isSideBySideCompareActive();
  compareControls?.classList.toggle('is-hidden', !shouldShowControls);
  compareControls?.classList.toggle('is-side-by-side', sideBySideActive);

  if (compareToolButton) {
    const splitActive = compareEnabled && !sideBySideActive;
    compareToolButton?.classList.toggle('is-active', splitActive);
    compareToolButton.setAttribute('aria-pressed', splitActive ? 'true' : 'false');
  }

  if (compareSideBySideButton) {
    compareSideBySideButton?.classList.toggle('is-active', sideBySideActive);
    compareSideBySideButton.setAttribute('aria-pressed', sideBySideActive ? 'true' : 'false');
  }

  if (compareOrientationButton) {
    const orientationButtonState = getCompareOrientationButtonState();
    compareOrientationButton.dataset.orientation = compareOrientation;
    compareOrientationButton.setAttribute('aria-label', orientationButtonState.title);
    compareOrientationButton?.classList.toggle('is-active', compareOrientation === 'horizontal');

    const iconElement = compareOrientationButton.querySelector('.icon');
    if (iconElement) {
      iconElement.innerHTML = orientationButtonState.iconSvg;
    }

    compareOrientationButton.disabled = sideBySideActive || !available;
  }

  if (compareSlider) {
    compareSlider.disabled = sideBySideActive || !available;
  }

  updateCompareDiffNavigationUi();
}

/**
 * Positions the compare overlay image and divider according to the current split percentage
 * and orientation, or switches to side-by-side layout when that mode is active.
 */
function applyCompareSplit() {
  if (!compareImage || !compareDivider || !previewBody || !image || !hasComparisonImage()) {
    previewBody?.classList.remove('side-by-side-mode');
    clearCompareDifferenceOverlay(false);
    return;
  }

  const sideBySideActive = isSideBySideCompareActive();
  previewBody?.classList.toggle('side-by-side-mode', sideBySideActive);

  if (sideBySideActive) {
    compareImage?.classList.remove('is-hidden');
    compareDivider?.classList.add('is-hidden');
    compareDivider.classList.remove('is-horizontal');
    compareImage.style.clipPath = 'none';
    compareImage.style.left = '';
    compareImage.style.top = '';

    // Keep both previews at the exact same rendered size in side-by-side mode.
    const renderedWidth = image.clientWidth;
    const renderedHeight = image.clientHeight;
    if (renderedWidth > 0 && renderedHeight > 0) {
      compareImage.style.width = `${String(renderedWidth)}px`;
      compareImage.style.height = `${String(renderedHeight)}px`;
    } else {
      compareImage.style.width = '';
      compareImage.style.height = '';
    }

    renderCompareDifferenceOverlay();
    return;
  }

  clearCompareDifferenceOverlay(false);

  if (!compareEnabled) {
    compareImage.classList.add('is-hidden');
    compareDivider.classList.add('is-hidden');
    return;
  }

  compareImage.classList.remove('is-hidden');
  compareDivider.classList.remove('is-hidden');
  compareDivider.classList.toggle('is-horizontal', compareOrientation === 'horizontal');

  const renderedWidth = image.clientWidth;
  const renderedHeight = image.clientHeight;
  if (renderedWidth <= 0 || renderedHeight <= 0) {
    return;
  }

  compareImage.style.left = `${String(image.offsetLeft)}px`;
  compareImage.style.top = `${String(image.offsetTop)}px`;
  compareImage.style.width = `${String(renderedWidth)}px`;
  compareImage.style.height = `${String(renderedHeight)}px`;

  const clampedSplit = clamp(compareSplitPercent, 0, 100);
  const dividerHitSize = 8;
  const halfDividerHitSize = dividerHitSize / 2;
  const splitX = image.offsetLeft + (renderedWidth * clampedSplit) / 100;
  const splitY = image.offsetTop + (renderedHeight * clampedSplit) / 100;

  if (compareOrientation === 'vertical') {
    compareImage.style.clipPath = `inset(0 ${String(100 - clampedSplit)}% 0 0)`;
    compareDivider.style.left = `${String(splitX - halfDividerHitSize)}px`;
    compareDivider.style.top = `${String(image.offsetTop)}px`;
    compareDivider.style.height = `${String(renderedHeight)}px`;
    compareDivider.style.width = `${String(dividerHitSize)}px`;
  } else {
    compareImage.style.clipPath = `inset(0 0 ${String(100 - clampedSplit)}% 0)`;
    compareDivider.style.top = `${String(splitY - halfDividerHitSize)}px`;
    compareDivider.style.left = `${String(image.offsetLeft)}px`;
    compareDivider.style.width = `${String(renderedWidth)}px`;
    compareDivider.style.height = `${String(dividerHitSize)}px`;
  }
}

/**
 * Writes the current compareSplitPercent value to the slider input element.
 */
function syncCompareSliderToSplitPercent() {
  if (!compareSlider) {
    return;
  }

  compareSlider.value = String(Math.round(clamp(compareSplitPercent, 0, 100)));
}

/**
 * Recalculates the split percentage from a pointer client position and redraws the split.
 *
 * @param {number} clientX Pointer X position in viewport coordinates.
 * @param {number} clientY Pointer Y position in viewport coordinates.
 */
function updateCompareSplitFromClientPosition(clientX, clientY) {
  if (!image || !compareEnabled || !hasComparisonImage()) {
    return;
  }

  const imageRect = image.getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    return;
  }

  let nextSplitPercent = compareSplitPercent;
  if (compareOrientation === 'vertical') {
    nextSplitPercent = ((clientX - imageRect.left) / imageRect.width) * 100;
  } else {
    nextSplitPercent = ((clientY - imageRect.top) / imageRect.height) * 100;
  }

  compareSplitPercent = clamp(nextSplitPercent, 0, 100);
  syncCompareSliderToSplitPercent();
  applyCompareSplit();
}

/**
 * Schedules a rAF-throttled update of the compare split position during divider drag.
 *
 * @param {number} clientX Pointer X position in viewport coordinates.
 * @param {number} clientY Pointer Y position in viewport coordinates.
 */
function scheduleCompareDividerSplitUpdate(clientX, clientY) {
  pendingCompareDragClientX = clientX;
  pendingCompareDragClientY = clientY;

  if (compareDividerDragFrameId !== null) {
    return;
  }

  compareDividerDragFrameId = requestAnimationFrame(() => {
    compareDividerDragFrameId = null;

    if (pendingCompareDragClientX === null || pendingCompareDragClientY === null) {
      return;
    }

    updateCompareSplitFromClientPosition(pendingCompareDragClientX, pendingCompareDragClientY);
    pendingCompareDragClientX = null;
    pendingCompareDragClientY = null;
  });
}

/**
 * Cancels any pending rAF compare-divider drag update.
 */
function clearPendingCompareDividerSplitUpdate() {
  if (compareDividerDragFrameId !== null) {
    cancelAnimationFrame(compareDividerDragFrameId);
    compareDividerDragFrameId = null;
  }

  pendingCompareDragClientX = null;
  pendingCompareDragClientY = null;
}

/**
 * Ends an in-progress compare divider drag, releasing pointer capture.
 *
 * @param {number} [pointerId] The pointer ID to release; if omitted, forces end regardless of ID.
 */
function endCompareDividerDrag(pointerId) {
  if (!isDraggingCompareDivider) {
    return;
  }

  if (compareDividerPointerId !== null && compareDivider?.hasPointerCapture(compareDividerPointerId)) {
    compareDivider.releasePointerCapture(compareDividerPointerId);
  }

  if (pointerId !== undefined && compareDividerPointerId !== pointerId) {
    return;
  }

  isDraggingCompareDivider = false;
  compareDividerPointerId = null;
  clearPendingCompareDividerSplitUpdate();
}

/**
 * Enables or disables the split-compare mode.
 *
 * @param {boolean} isEnabled Whether split-compare should be active.
 */
function setCompareEnabled(isEnabled) {
  if (!hasComparisonImage()) {
    compareEnabled = false;
    compareViewMode = 'split';
    updateCompareControlsUi();
    applyCompareSplit();
    return;
  }

  if (isEnabled) {
    compareViewMode = 'split';
  }

  compareEnabled = isEnabled;
  updateCompareControlsUi();
  applyCompareSplit();
}

/**
 * Switches the compare view mode between 'split' and 'side-by-side'.
 *
 * @param {'split'|'side-by-side'} nextMode The desired view mode.
 */
function setCompareViewMode(nextMode) {
  compareViewMode = nextMode === 'side-by-side' ? 'side-by-side' : 'split';

  if (!hasComparisonImage()) {
    compareEnabled = false;
  } else if (compareViewMode === 'side-by-side') {
    compareEnabled = false;
    endCompareDividerDrag();
    clearPendingCompareDividerSplitUpdate();
  } else {
    compareEnabled = true;
  }

  updateCompareControlsUi();
  applyCompareSplit();

  if (isSideBySideCompareActive()) {
    scheduleCompareDifferenceAnalysis();
  } else {
    clearCompareDifferenceOverlay(false);
  }
}

/**
 * Loads a new comparison image source and activates compare mode.
 *
 * @param {string} source URI of the comparison image.
 * @param {string} [label] Human-readable label shown in the UI.
 */
function setComparisonImage(source, label) {
  if (!compareImage || !compareImageLabel) {
    return;
  }

  originalCompareImageSource = source;
  // Set a synchronous source first so comparison UI can become visible immediately.
  compareImage.setAttribute('src', source);
  void applyImageTransformToPreview();
  compareImageLabel.textContent = label || 'Comparison image';

  const shouldEnableSideBySide = enableSideBySideOnNextComparePick || compareViewMode === 'side-by-side';
  enableSideBySideOnNextComparePick = false;

  if (shouldEnableSideBySide) {
    setCompareViewMode('side-by-side');
    return;
  }

  setCompareEnabled(true);
}

/**
 * Removes the comparison image and resets all compare state to defaults.
 */
function clearComparisonImage() {
  if (!compareImage || !compareImageLabel) {
    return;
  }

  originalCompareImageSource = '';
  compareImage.removeAttribute('src');
  compareImage.style.clipPath = '';
  compareImage.classList.add('is-hidden');
  compareDivider?.classList.add('is-hidden');
  previewBody?.classList.remove('side-by-side-mode');
  endCompareDividerDrag();
  compareImageLabel.textContent = 'No comparison image';
  compareEnabled = false;
  compareViewMode = 'split';
  enableSideBySideOnNextComparePick = false;
  clearPendingCompareDividerSplitUpdate();
  updateCompareControlsUi();
  clearCompareDifferenceOverlay(true);
}

/**
 * Activates or deactivates the pipette (color-picker) mode.
 *
 * @param {boolean} isEnabled Whether pipette mode should be active.
 */
function setPipetteMode(isEnabled) {
  pipetteMode = isEnabled;
  if (pipetteButton) {
    pipetteButton.classList.toggle('is-active', pipetteMode);
    pipetteButton.setAttribute('aria-pressed', pipetteMode ? 'true' : 'false');
  }
  if (pipetteMode) {
    refreshPipetteImageBuffer();
    if (previewBody) {
      previewBody.classList.add('is-none');
    }
    if (pipetteZoomLoupe) {
      pipetteZoomLoupe.classList.remove('is-hidden');
      pipetteZoomLoupe.classList.add('is-visible');
    }
    setPipetteHoverInfoVisible(true);
    resetPipetteHoverInfo();
  } else {
    if (previewBody) {
      previewBody.classList.remove('is-none');
    }
    hidePipetteColorResult(true);
    if (pipetteZoomLoupe) {
      pipetteZoomLoupe.classList.add('is-hidden');
      pipetteZoomLoupe.classList.remove('is-visible');
    }
    setPipetteHoverInfoVisible(false);
    resetPipetteHoverInfo();
  }
}

/**
 * Formats red, green and blue channel values (0–255) to a CSS hex color string.
 *
 * @param {number} red Red channel value (0–255).
 * @param {number} green Green channel value (0–255).
 * @param {number} blue Blue channel value (0–255).
 * @returns {string} Hex color string, e.g. '#ff8040'.
 */
function formatHexColor(red, green, blue) {
  return '#' + [red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Shows or hides the pipette hover info panel.
 *
 * @param {boolean} isVisible Whether the panel should be visible.
 */
function setPipetteHoverInfoVisible(isVisible) {
  if (!pipetteHoverInfo) {
    return;
  }

  pipetteHoverInfo.classList.toggle('is-hidden', !isVisible);
}

/**
 * Resets the pipette hover position, color text and swatch to their empty state.
 */
function resetPipetteHoverInfo() {
  if (pipetteHoverPosition) {
    pipetteHoverPosition.textContent = '—';
  }

  if (pipetteHoverColor) {
    pipetteHoverColor.textContent = '—';
  }

  if (pipetteHoverSwatch) {
    pipetteHoverSwatch.classList.add('pipette-hover-swatch-transparent');
  }
}

/**
 * Updates the pipette hover info panel with the pixel position and color under the pointer.
 *
 * @param {number} x Pixel X coordinate in image space.
 * @param {number} y Pixel Y coordinate in image space.
 * @param {Uint8ClampedArray} pixelData RGBA pixel data array from getImageData.
 */
function updatePipetteHoverInfo(x, y, pixelData) {
  if (!pipetteHoverPosition || !pipetteHoverColor || !pipetteHoverSwatch) {
    return;
  }

  const hexColor = formatHexColor(pixelData[0], pixelData[1], pixelData[2]);
  pipetteHoverPosition.textContent = `${String(x)}, ${String(y)}`;
  pipetteHoverColor.textContent = hexColor;
  pipetteHoverSwatch.classList.remove('pipette-hover-swatch-transparent');
  pipetteHoverSwatch.style.background = hexColor;
}

/**
 * Cancels any pending fade/hide timeouts for the pipette color result bubble.
 */
function clearPipetteColorResultTimers() {
  if (pipetteResultFadeTimeoutId !== null) {
    clearTimeout(pipetteResultFadeTimeoutId);
    pipetteResultFadeTimeoutId = null;
  }

  if (pipetteResultHideTimeoutId !== null) {
    clearTimeout(pipetteResultHideTimeoutId);
    pipetteResultHideTimeoutId = null;
  }
}

/**
 * Hides the pipette color result bubble, optionally with an immediate (no-fade) removal.
 *
 * @param {boolean} [immediate=false] When true, hides instantly without fade animation.
 */
function hidePipetteColorResult(immediate = false) {
  if (!pipetteColorResult) {
    return;
  }

  clearPipetteColorResultTimers();
  if (immediate) {
    pipetteColorResult.classList.add('is-opacity-0');
    pipetteColorResult.classList.add('is-hidden');
    return;
  }

  pipetteColorResult.classList.add('is-opacity-0');
  pipetteResultHideTimeoutId = window.setTimeout(() => {
    if (!pipetteColorResult) {
      return;
    }
    pipetteColorResult.classList.add('is-hidden');
    pipetteResultHideTimeoutId = null;
  }, PIPETTE_RESULT_FADE_DURATION_MS);
}

/**
 * Calls preventDefault and stopPropagation on the given event.
 *
 * @param {Event} event The DOM event to stop.
 */
function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Attaches a click event listener to a button that stops the event and runs an action.
 *
 * @param {Element | null | undefined} button Button element to bind.
 * @param {() => void} action Callback invoked on click.
 */
function bindClickAction(button, action) {
  button?.addEventListener('click', (event) => {
    stopEvent(event);
    action();
  });
}

/**
 * Triggers the click-halo CSS animation on a toolbar button.
 *
 * @param {Element | null | undefined} button The button element to animate.
 */
function showToolbarClickHalo(button) {
  if (!button || !button.classList) {
    return;
  }

  button.classList.remove('click-halo');
  // Force a reflow so the animation restarts on repeated clicks.
  void button.offsetWidth;
  button.classList.add('click-halo');
}

/**
 * Binds a button so that a single click triggers an action and holding the button
 * down continues repeating the action after a short delay.
 *
 * @param {Element | null | undefined} button Button element to bind.
 * @param {() => void} action Callback invoked on each press/repeat.
 */
function bindPressAndHoldAction(button, action) {
  if (!button) {
    return;
  }

  let repeatTimeoutId = null;
  let repeatIntervalId = null;
  let activePointerId = null;
  let hasRepeated = false;

  const clearRepeatTimers = () => {
    if (repeatTimeoutId !== null) {
      clearTimeout(repeatTimeoutId);
      repeatTimeoutId = null;
    }

    if (repeatIntervalId !== null) {
      clearInterval(repeatIntervalId);
      repeatIntervalId = null;
    }
  };

  const endPress = (pointerId) => {
    if (activePointerId !== null && pointerId !== null && activePointerId !== pointerId) {
      return;
    }

    if (activePointerId !== null && button.hasPointerCapture(activePointerId)) {
      button.releasePointerCapture(activePointerId);
    }

    activePointerId = null;
    clearRepeatTimers();
  };

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    stopEvent(event);
    hasRepeated = false;
    activePointerId = event.pointerId;
    button.setPointerCapture(event.pointerId);
    clearRepeatTimers();

    repeatTimeoutId = window.setTimeout(() => {
      hasRepeated = true;
      action();
      repeatIntervalId = window.setInterval(() => {
        action();
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_REPEAT_DELAY_MS);
  });

  button.addEventListener('pointerup', (event) => {
    endPress(event.pointerId);
  });

  button.addEventListener('pointercancel', (event) => {
    endPress(event.pointerId);
  });

  button.addEventListener('lostpointercapture', () => {
    endPress(null);
  });

  button.addEventListener('pointerleave', () => {
    if (activePointerId === null) {
      clearRepeatTimers();
    }
  });

  button.addEventListener('click', (event) => {
    stopEvent(event);
    if (!hasRepeated) {
      action();
    }
    hasRepeated = false;
  });
}

/**
 * Marks the given ICO gallery item as active and updates the selected size badge text.
 *
 * @param {Element} selectedItem The gallery item element to select.
 */
function setActiveIcoGalleryItem(selectedItem) {
  if (!icoGalleryItems.length) {
    return;
  }

  for (const galleryItem of icoGalleryItems) {
    const isSelected = galleryItem === selectedItem;
    galleryItem.classList.toggle('is-active', isSelected);
    galleryItem.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  }

  if (selectedIcoSizeBadge) {
    const selectedSizeLabel = selectedItem?.getAttribute('data-size-label');
    if (selectedSizeLabel) {
      selectedIcoSizeBadge.textContent = `Selected size: ${selectedSizeLabel}`;
    }
  }
}

/**
 * Finds the ICO gallery item whose source matches the current image source and marks it active.
 */
function syncActiveIcoGalleryItemFromImage() {
  if (!image || !icoGalleryItems.length) {
    return;
  }

  const currentSource = originalImageSource || image.getAttribute('src');
  if (!currentSource) {
    return;
  }

  const matchingItem = icoGalleryItems.find((galleryItem) => galleryItem.getAttribute('data-image-source') === currentSource);
  if (matchingItem) {
    setActiveIcoGalleryItem(matchingItem);
  }
}

/**
 * Collects ICO gallery items from the DOM and attaches click listeners so users can switch
 * between embedded ICO frame sizes.
 */
function initializeIcoGallery() {
  icoGalleryItems = Array.from(document.querySelectorAll('.ico-gallery-item'));
  if (!image || !icoGalleryItems.length) {
    return;
  }

  for (const galleryItem of icoGalleryItems) {
    galleryItem.addEventListener('click', (event) => {
      event.preventDefault();

      const nextSource = galleryItem.getAttribute('data-image-source');
      if (!nextSource) {
        return;
      }

      setActiveIcoGalleryItem(galleryItem);

      if (pipetteMode) {
        setPipetteMode(false);
      }

      originalImageSource = nextSource;
      void applyImageTransformToPreview();
    });
  }

  syncActiveIcoGalleryItemFromImage();
}

/**
 * Copies the current preview image source to the overview map image element.
 */
function syncOverviewMapSource() {
  if (!overviewMapImage || !image) {
    return;
  }

  const currentSource = image.getAttribute('src');
  if (!currentSource) {
    return;
  }

  overviewMapImage.setAttribute('src', currentSource);
}

/**
 * Hides the overview map viewport indicator.
 */
function hideOverviewMapViewport() {
  if (!overviewMapViewport) {
    return;
  }

  overviewMapViewport.classList.add('is-hidden');
  overviewMapViewport.style.display = 'none';
}

/**
 * Computes the content rectangle of the overview map image using object-fit: contain logic.
 *
 * @returns {{ left: number, top: number, width: number, height: number } | null}
 *   Rectangle in element-local coordinates, or null when dimensions are unavailable.
 */
function getOverviewMapContentRect() {
  if (!overviewMapImage) {
    return null;
  }

  const elementWidth = overviewMapImage.clientWidth;
  const elementHeight = overviewMapImage.clientHeight;
  if (elementWidth <= 0 || elementHeight <= 0) {
    return null;
  }

  const naturalWidth = overviewMapImage.naturalWidth;
  const naturalHeight = overviewMapImage.naturalHeight;
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return {
      left: overviewMapImage.offsetLeft,
      top: overviewMapImage.offsetTop,
      width: elementWidth,
      height: elementHeight
    };
  }

  // Mirror object-fit: contain to get the actual painted image rect inside the element box.
  const scale = Math.min(elementWidth / naturalWidth, elementHeight / naturalHeight);
  const contentWidth = naturalWidth * scale;
  const contentHeight = naturalHeight * scale;
  const contentOffsetX = (elementWidth - contentWidth) / 2;
  const contentOffsetY = (elementHeight - contentHeight) / 2;

  return {
    left: overviewMapImage.offsetLeft + contentOffsetX,
    top: overviewMapImage.offsetTop + contentOffsetY,
    width: contentWidth,
    height: contentHeight
  };
}

/**
 * Repositions and resizes the overview map viewport indicator to reflect the current
 * visible portion of the preview.
 */
function updateOverviewMapViewport() {
  if (!overviewMapImage || !overviewMapViewport || !image || !preview) {
    return;
  }

  const mapContentRect = getOverviewMapContentRect();
  const imageRect = image.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();

  if (!mapContentRect || imageRect.width <= 0 || imageRect.height <= 0) {
    hideOverviewMapViewport();
    return;
  }

  const visibleLeftClient = Math.max(previewRect.left, imageRect.left);
  const visibleTopClient = Math.max(previewRect.top, imageRect.top);
  const visibleRightClient = Math.min(previewRect.right, imageRect.right);
  const visibleBottomClient = Math.min(previewRect.bottom, imageRect.bottom);

  const visibleWidth = Math.max(0, visibleRightClient - visibleLeftClient);
  const visibleHeight = Math.max(0, visibleBottomClient - visibleTopClient);

  if (visibleWidth <= 0 || visibleHeight <= 0) {
    hideOverviewMapViewport();
    return;
  }

  const visibleLeftInImage = visibleLeftClient - imageRect.left;
  const visibleTopInImage = visibleTopClient - imageRect.top;
  const normalizedLeft = clamp(visibleLeftInImage / imageRect.width, 0, 1);
  const normalizedTop = clamp(visibleTopInImage / imageRect.height, 0, 1);
  const normalizedWidth = clamp(visibleWidth / imageRect.width, 0, 1);
  const normalizedHeight = clamp(visibleHeight / imageRect.height, 0, 1);

  overviewMapViewport.classList.remove('is-hidden');
  overviewMapViewport.style.display = 'block';
  overviewMapViewport.style.left = `${String(mapContentRect.left + normalizedLeft * mapContentRect.width)}px`;
  overviewMapViewport.style.top = `${String(mapContentRect.top + normalizedTop * mapContentRect.height)}px`;
  overviewMapViewport.style.width = `${String(Math.max(1, normalizedWidth * mapContentRect.width))}px`;
  overviewMapViewport.style.height = `${String(Math.max(1, normalizedHeight * mapContentRect.height))}px`;
}

/**
 * Schedules an overview map viewport update on the next animation frame, coalescing
 * multiple calls within the same frame.
 */
function requestOverviewMapViewportUpdate() {
  if (overviewMapViewportFrameId !== null) {
    return;
  }

  overviewMapViewportFrameId = requestAnimationFrame(() => {
    overviewMapViewportFrameId = null;
    updateOverviewMapViewport();
  });
}

/**
 * Scrolls the preview so that the point clicked on the overview map is centered in the viewport.
 *
 * @param {number} clientX Pointer X position in viewport coordinates.
 * @param {number} clientY Pointer Y position in viewport coordinates.
 */
function centerPreviewFromOverviewPointer(clientX, clientY) {
  if (!overviewMapImage || !image || !preview) {
    return;
  }

  const mapContainer = overviewMapImage.parentElement;
  const mapContainerRect = mapContainer?.getBoundingClientRect();
  const mapContentRect = getOverviewMapContentRect();
  if (!mapContainerRect || !mapContentRect || mapContentRect.width <= 0 || mapContentRect.height <= 0) {
    return;
  }

  const imageRect = image.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    return;
  }

  const contentClientLeft = mapContainerRect.left + mapContentRect.left;
  const contentClientTop = mapContainerRect.top + mapContentRect.top;
  const normalizedX = clamp((clientX - contentClientLeft) / mapContentRect.width, 0, 1);
  const normalizedY = clamp((clientY - contentClientTop) / mapContentRect.height, 0, 1);

  const targetClientX = imageRect.left + normalizedX * imageRect.width;
  const targetClientY = imageRect.top + normalizedY * imageRect.height;
  const previewCenterX = previewRect.left + preview.clientWidth / 2;
  const previewCenterY = previewRect.top + preview.clientHeight / 2;

  preview.scrollLeft += targetClientX - previewCenterX;
  preview.scrollTop += targetClientY - previewCenterY;
  requestOverviewMapViewportUpdate();
}

/**
 * Ends an overview map drag interaction, releasing pointer capture.
 *
 * @param {number} pointerId The pointer ID to release.
 */
function endOverviewMapDrag(pointerId) {
  if (!overviewMapImage || overviewMapDragPointerId !== pointerId) {
    return;
  }

  if (overviewMapImage.hasPointerCapture(pointerId)) {
    overviewMapImage.releasePointerCapture(pointerId);
  }

  isDraggingOverviewMap = false;
  overviewMapDragPointerId = null;
}

/**
 * Interpolates logarithmically between two zoom values based on the current image zoom.
 *
 * @param {number} value Current image zoom level.
 * @param {number} fromValue Input zoom at the lower bound.
 * @param {number} fromZoom Output zoom at the lower bound.
 * @param {number} toValue Input zoom at the upper bound.
 * @param {number} toZoom Output zoom at the upper bound.
 * @returns {number} Interpolated zoom value.
 */
function interpolateLogarithmic(value, fromValue, fromZoom, toValue, toZoom) {
  const safeValue = Math.max(0.0001, value);
  const fromLog = Math.log(fromValue);
  const toLog = Math.log(toValue);
  const currentLog = Math.log(safeValue);
  const progress = (currentLog - fromLog) / (toLog - fromLog);
  return fromZoom + (toZoom - fromZoom) * progress;
}

/**
 * Computes the loupe magnification factor that should be used at the given image display zoom.
 *
 * @param {number} displayedZoom Current rendered zoom (rendered px / natural px).
 * @returns {number} Loupe relative zoom factor.
 */
function getDynamicLoupeZoom(displayedZoom) {
  const normalizedImageZoom = clamp(displayedZoom, MIN_ZOOM, MAX_ZOOM);
  return interpolateLogarithmic(
    normalizedImageZoom,
    MIN_ZOOM,
    loupeZoomAtMinImageZoom,
    MAX_ZOOM,
    loupeZoomAtMaxImageZoom
  );
}

/**
 * Positions the loupe canvas element so that it is centered on the given client coordinates.
 *
 * @param {number} clientX Pointer X position in viewport coordinates.
 * @param {number} clientY Pointer Y position in viewport coordinates.
 */
function positionLoupeAtPointer(clientX, clientY) {
  if (!pipetteZoomLoupe) {
    return;
  }

  pipetteZoomLoupe.style.left = `${String(clientX - pipetteZoomLoupe.width / 2)}px`;
  pipetteZoomLoupe.style.top = `${String(clientY - pipetteZoomLoupe.height / 2)}px`;
}

// Render a local pixel loupe around the cursor when pipette mode is enabled.
previewBody?.addEventListener('pointermove', (event) => {
  if (!pipetteMode || !pipetteCanvas || !image || !pipetteZoomLoupe || !virtualLoupeCtx || !virtualLoupeCanvas) return;
  const pipetteCtx = ensurePipetteBufferContext();
  if (!pipetteCtx) {
    return;
  }

  const imageRect = image.getBoundingClientRect();
  const isPointerInsideImage =
    event.clientX >= imageRect.left &&
    event.clientX < imageRect.right &&
    event.clientY >= imageRect.top &&
    event.clientY < imageRect.bottom;

  pipetteZoomLoupe.width = pipetteZoomLoupe.height = loupeDiameter;
  const loupeCtx = pipetteZoomLoupe.getContext('2d', { willReadFrequently: true });

  if (!isPointerInsideImage || imageRect.width <= 0 || imageRect.height <= 0) {
    resetPipetteHoverInfo();
    const center = Math.floor(pipetteZoomLoupe.width / 2) + 0.5;
    loupeCtx.clearRect(0, 0, pipetteZoomLoupe.width, pipetteZoomLoupe.height);
    loupeCtx.strokeStyle = '#f00';
    loupeCtx.lineWidth = 0.5;
    loupeCtx.beginPath();
    loupeCtx.moveTo(center, 0);
    loupeCtx.lineTo(center, pipetteZoomLoupe.height);
    loupeCtx.moveTo(0, center);
    loupeCtx.lineTo(pipetteZoomLoupe.width, center);
    loupeCtx.stroke();
    positionLoupeAtPointer(event.clientX, event.clientY);
    pipetteZoomLoupe.style.display = 'block';
    return;
  }

  pipetteZoomLoupe.style.display = 'block';
  const normalizedX = (event.clientX - imageRect.left) / imageRect.width;
  const normalizedY = (event.clientY - imageRect.top) / imageRect.height;
  const sourcePointerX = clamp(normalizedX * image.naturalWidth, 0, image.naturalWidth);
  const sourcePointerY = clamp(normalizedY * image.naturalHeight, 0, image.naturalHeight);
  const x = clamp(Math.floor(normalizedX * image.naturalWidth), 0, image.naturalWidth - 1);
  const y = clamp(Math.floor(normalizedY * image.naturalHeight), 0, image.naturalHeight - 1);
  const hoveredPixelData = pipetteCtx.getImageData(x, y, 1, 1).data;
  updatePipetteHoverInfo(x, y, hoveredPixelData);
  const displayedZoom = Math.max(0.0001, imageRect.width / image.naturalWidth);
  const loupeRelativeZoom = clamp(getDynamicLoupeZoom(displayedZoom), loupeDynamicZoomMin, loupeDynamicZoomMax);
  const adjustedLoupeZoom = displayedZoom * loupeRelativeZoom;
  const maxSourceSpan = Math.max(1, Math.min(image.naturalWidth, image.naturalHeight));
  const sourceSpan = clamp(loupeDiameter / adjustedLoupeZoom, 1, maxSourceSpan);
  loupeCtx.clearRect(0, 0, pipetteZoomLoupe.width, pipetteZoomLoupe.height);
  // Keep a sub-pixel source window so zoom changes remain continuous.
  const halfSourceSpan = sourceSpan / 2;
  // Keep the loupe anchored to the exact hovered source coordinate.
  const sourceCenterX = sourcePointerX;
  const sourceCenterY = sourcePointerY;
  const sourceLeft = sourceCenterX - halfSourceSpan;
  const sourceTop = sourceCenterY - halfSourceSpan;
  const sourceRight = sourceCenterX + halfSourceSpan;
  const sourceBottom = sourceCenterY + halfSourceSpan;

  const clippedSourceLeft = clamp(sourceLeft, 0, image.naturalWidth);
  const clippedSourceTop = clamp(sourceTop, 0, image.naturalHeight);
  const clippedSourceRight = clamp(sourceRight, 0, image.naturalWidth);
  const clippedSourceBottom = clamp(sourceBottom, 0, image.naturalHeight);

  const clippedSourceWidth = Math.max(0, clippedSourceRight - clippedSourceLeft);
  const clippedSourceHeight = Math.max(0, clippedSourceBottom - clippedSourceTop);

  const destinationLeft = ((clippedSourceLeft - sourceLeft) / sourceSpan) * loupeVirtualResolution;
  const destinationTop = ((clippedSourceTop - sourceTop) / sourceSpan) * loupeVirtualResolution;
  const destinationWidth = (clippedSourceWidth / sourceSpan) * loupeVirtualResolution;
  const destinationHeight = (clippedSourceHeight / sourceSpan) * loupeVirtualResolution;

  virtualLoupeCtx.clearRect(0, 0, loupeVirtualResolution, loupeVirtualResolution);
  virtualLoupeCtx.imageSmoothingEnabled = false;
  if (clippedSourceWidth > 0 && clippedSourceHeight > 0 && destinationWidth > 0 && destinationHeight > 0) {
    virtualLoupeCtx.drawImage(
      pipetteCanvas,
      clippedSourceLeft,
      clippedSourceTop,
      clippedSourceWidth,
      clippedSourceHeight,
      destinationLeft,
      destinationTop,
      destinationWidth,
      destinationHeight
    );
  }

  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.drawImage(
    virtualLoupeCanvas,
    0,
    0,
    loupeVirtualResolution,
    loupeVirtualResolution,
    0,
    0,
    pipetteZoomLoupe.width,
    pipetteZoomLoupe.height
  );

  const pixelSize = pipetteZoomLoupe.width / loupeVirtualResolution;
  const centerPixelIndex = Math.floor(loupeVirtualResolution / 2);
  const circleRadiusInPixels = loupeVirtualResolution / 2;
  const circleRadiusInCanvas = circleRadiusInPixels * pixelSize;

  // Pixelated circular mask: remove pixels outside the radius.
  for (let row = 0; row < loupeVirtualResolution; row += 1) {
    for (let column = 0; column < loupeVirtualResolution; column += 1) {
      const deltaX = column - centerPixelIndex;
      const deltaY = row - centerPixelIndex;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance > circleRadiusInPixels) {
        loupeCtx.clearRect(column * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }
    }
  }

  // Draw a crosshair at the center.
  loupeCtx.strokeStyle = '#f00';
  loupeCtx.lineWidth = 0.5;
  loupeCtx.beginPath();
  const center = (centerPixelIndex + 0.5) * pixelSize;
  loupeCtx.moveTo(center, center - circleRadiusInCanvas);
  loupeCtx.lineTo(center, center + circleRadiusInCanvas);
  loupeCtx.moveTo(center - circleRadiusInCanvas, center);
  loupeCtx.lineTo(center + circleRadiusInCanvas, center);
  loupeCtx.stroke();
  positionLoupeAtPointer(event.clientX, event.clientY);
});
// Hide the loupe when the pointer leaves the preview area.
previewBody?.addEventListener('pointerleave', () => {
  if (pipetteZoomLoupe) {
    pipetteZoomLoupe.style.display = 'none';
  }
  if (pipetteMode) {
    resetPipetteHoverInfo();
  }
});
previewBody?.addEventListener('pointerenter', () => {
  if (pipetteMode && pipetteZoomLoupe) {
    pipetteZoomLoupe.style.display = 'block';
  }
});
// Toggle pipette mode from the toolbar button.
pipetteButton?.addEventListener('click', (event) => {
  stopEvent(event);
  setPipetteMode(!pipetteMode);
});

// Pick a pixel color on click and copy it to the clipboard.
previewBody?.addEventListener('click', (event) => {
  if (!pipetteMode || !pipetteCanvas || !image) return;
  const bufferContext = ensurePipetteBufferContext();
  if (!bufferContext) {
    return;
  }

  // Compute click coordinates in image space.
  const imageRect = image.getBoundingClientRect();
  const normalizedX = (event.clientX - imageRect.left) / imageRect.width;
  const normalizedY = (event.clientY - imageRect.top) / imageRect.height;
  const x = clamp(Math.floor(normalizedX * image.naturalWidth), 0, image.naturalWidth - 1);
  const y = clamp(Math.floor(normalizedY * image.naturalHeight), 0, image.naturalHeight - 1);
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
  const pixel = bufferContext.getImageData(x, y, 1, 1).data;
  const hex = formatHexColor(pixel[0], pixel[1], pixel[2]);
  // Copy to clipboard.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(hex).catch(() => {});
  } else {
    // Fallback for older browsers using a hidden textarea.
    const textarea = document.createElement('textarea');
    textarea.value = hex;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(textarea);
  }
  // Display copied color feedback near the cursor.
  if (pipetteColorResult) {
    clearPipetteColorResultTimers();
    pipetteColorResult.style.display = 'block';
    pipetteColorResult.style.opacity = '1';
    // Place the bubble to the right of the loupe.
    pipetteColorResult.style.left = (event.clientX + 48) + 'px';
    pipetteColorResult.style.top = (event.clientY - 24) + 'px';
    pipetteColorResult.textContent = '';

    const colorSwatch = document.createElement('span');
    colorSwatch.className = 'pipette-color-result-swatch';
    colorSwatch.style.background = hex;
    pipetteColorResult.appendChild(colorSwatch);

    const copiedLabel = document.createElement('span');
    copiedLabel.className = 'pipette-color-result-label';
    copiedLabel.textContent = `${hex} `;
    const copiedSuffix = document.createElement('small');
    copiedSuffix.textContent = '(copied)';
    copiedLabel.appendChild(copiedSuffix);
    pipetteColorResult.appendChild(copiedLabel);

    pipetteColorResult.style.background = '#fff';
    pipetteColorResult.style.color = '#000';
    pipetteColorResult.style.border = '1px solid #ccc';
    pipetteColorResult.style.padding = '4px 8px';
    pipetteColorResult.style.borderRadius = '4px';
    pipetteColorResult.style.position = 'fixed';
    pipetteColorResult.style.zIndex = 30;
    pipetteColorResult.style.boxShadow = '0 2px 8px #0002';
    pipetteColorResult.style.fontSize = '13px';
    pipetteColorResult.style.pointerEvents = 'none';

    pipetteResultFadeTimeoutId = window.setTimeout(() => {
      hidePipetteColorResult();
      pipetteResultFadeTimeoutId = null;
    }, PIPETTE_RESULT_VISIBLE_DURATION_MS);
  }
});

/**
 * Hides the zoom selection box overlay.
 */
function hideSelectionBox() {
  if (!zoomSelectionBox) {
    return;
  }

  zoomSelectionBox.style.display = 'none';
}

/**
 * Draws and positions the zoom selection rubber-band box based on start and current pointer positions.
 *
 * @param {number} startClientX Selection start X in viewport coordinates.
 * @param {number} startClientY Selection start Y in viewport coordinates.
 * @param {number} currentClientX Current pointer X in viewport coordinates.
 * @param {number} currentClientY Current pointer Y in viewport coordinates.
 */
function drawSelectionBox(startClientX, startClientY, currentClientX, currentClientY) {
  if (!previewContainer || !zoomSelectionBox) {
    return;
  }

  const containerRect = previewContainer.getBoundingClientRect();
  const left = Math.min(startClientX, currentClientX) - containerRect.left;
  const top = Math.min(startClientY, currentClientY) - containerRect.top;
  const width = Math.abs(currentClientX - startClientX);
  const height = Math.abs(currentClientY - startClientY);

  zoomSelectionBox.style.display = 'block';
  zoomSelectionBox.style.left = `${String(Math.round(left))}px`;
  zoomSelectionBox.style.top = `${String(Math.round(top))}px`;
  zoomSelectionBox.style.width = `${String(Math.round(width))}px`;
  zoomSelectionBox.style.height = `${String(Math.round(height))}px`;
}

/**
 * Zooms the preview to fit the area defined by the given client-coordinate selection rectangle.
 *
 * @param {number} startClientX Selection start X in viewport coordinates.
 * @param {number} startClientY Selection start Y in viewport coordinates.
 * @param {number} endClientX Selection end X in viewport coordinates.
 * @param {number} endClientY Selection end Y in viewport coordinates.
 */
function zoomToSelection(startClientX, startClientY, endClientX, endClientY) {
  if (!image || !preview) {
    return;
  }

  const imageRect = image.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const currentZoom = getDisplayedZoom();

  if (currentZoom <= 0 || imageRect.width <= 0 || imageRect.height <= 0) {
    return;
  }

  const clampedStartX = clamp(startClientX, imageRect.left, imageRect.right);
  const clampedStartY = clamp(startClientY, imageRect.top, imageRect.bottom);
  const clampedEndX = clamp(endClientX, imageRect.left, imageRect.right);
  const clampedEndY = clamp(endClientY, imageRect.top, imageRect.bottom);

  const selectedDisplayWidth = Math.abs(clampedEndX - clampedStartX);
  const selectedDisplayHeight = Math.abs(clampedEndY - clampedStartY);
  const minimumSelectionSize = 6;

  if (selectedDisplayWidth < minimumSelectionSize || selectedDisplayHeight < minimumSelectionSize) {
    return;
  }

  const selectedNaturalWidth = selectedDisplayWidth / currentZoom;
  const selectedNaturalHeight = selectedDisplayHeight / currentZoom;
  if (selectedNaturalWidth <= 0 || selectedNaturalHeight <= 0) {
    return;
  }

  const targetZoomForWidth = preview.clientWidth / selectedNaturalWidth;
  const targetZoomForHeight = preview.clientHeight / selectedNaturalHeight;
  const targetZoom = clamp(Math.min(targetZoomForWidth, targetZoomForHeight), MIN_ZOOM, MAX_ZOOM);

  const selectionCenterClientX = (clampedStartX + clampedEndX) / 2;
  const selectionCenterClientY = (clampedStartY + clampedEndY) / 2;
  const selectionCenterNaturalX = (selectionCenterClientX - imageRect.left) / currentZoom;
  const selectionCenterNaturalY = (selectionCenterClientY - imageRect.top) / currentZoom;

  setZoom(targetZoom);

  requestAnimationFrame(() => {
    if (!image || !preview) {
      return;
    }

    const nextImageRect = image.getBoundingClientRect();
    const nextPreviewRect = preview.getBoundingClientRect();
    const targetClientX = nextImageRect.left + selectionCenterNaturalX * targetZoom;
    const targetClientY = nextImageRect.top + selectionCenterNaturalY * targetZoom;
    const viewportCenterX = nextPreviewRect.left + preview.clientWidth / 2;
    const viewportCenterY = nextPreviewRect.top + preview.clientHeight / 2;

    preview.scrollLeft += targetClientX - viewportCenterX;
    preview.scrollTop += targetClientY - viewportCenterY;
  });
}

/**
 * Ends the active area-zoom selection, releases pointer capture and hides the selection box.
 */
function finishSelection() {
  if (!previewBody) {
    return;
  }

  isSelectingZoomArea = false;
  if (selectionPointerId !== null && previewBody.hasPointerCapture(selectionPointerId)) {
    previewBody.releasePointerCapture(selectionPointerId);
  }
  selectionPointerId = null;
  hideSelectionBox();
}

/**
 * Ends a pan-drag interaction on the preview, removing the dragging CSS class and
 * releasing pointer capture.
 *
 * @param {number} pointerId The pointer ID to release.
 */
function endPreviewDrag(pointerId) {
  if (!preview || !previewBody) {
    return;
  }

  isDragging = false;
  preview.classList.remove('dragging');
  if (previewBody.hasPointerCapture(pointerId)) {
    previewBody.releasePointerCapture(pointerId);
  }
}

/**
 * Clamps a value within the inclusive [min, max] range.
 *
 * @param {number} value Value to clamp.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculates and applies the fit-to-viewport size for the preview image(s).
 */
function applyFitSizing() {
  if (!image || !preview || !previewBody) {
    return;
  }

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return;
  }

  const viewportWidth = Math.max(1, preview.clientWidth);
  const viewportHeight = Math.max(1, preview.clientHeight);
  const sideBySideActive = isSideBySideCompareActive() && Boolean(compareImage);
  const sideBySideGapPx = sideBySideActive ? 14 : 0;
  const sideBySideHorizontalPaddingPx = sideBySideActive ? 24 : 0;
  const fitScaleByWidth = sideBySideActive
    ? (viewportWidth - sideBySideHorizontalPaddingPx - sideBySideGapPx) / (naturalWidth * 2)
    : viewportWidth / naturalWidth;
  const fitScale = Math.min(fitScaleByWidth, viewportHeight / naturalHeight);
  const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  const fitWidth = Math.max(1, Math.round(naturalWidth * safeScale));

  previewBody.style.width = sideBySideActive ? 'max-content' : '100%';
  previewBody.style.height = '100%';
  image.style.width = `${String(fitWidth)}px`;
  if (compareImage) {
    compareImage.style.width = `${String(fitWidth)}px`;
  }
}

/**
 * Updates the pan-enabled CSS class based on whether the image overflows the preview viewport.
 * Optionally resets scroll position when content fits.
 *
 * @param {boolean} resetScrollWhenNotPannable When true, resets scroll to 0 if content fits.
 */
function updatePanAvailability(resetScrollWhenNotPannable) {
  if (!preview) {
    return;
  }

  const isPannable = preview.scrollWidth > preview.clientWidth + 1
    || preview.scrollHeight > preview.clientHeight + 1;
  preview.classList.toggle('pan-enabled', isPannable);

  if (!isPannable) {
    preview.classList.remove('dragging');
    isDragging = false;

    if (resetScrollWhenNotPannable) {
      preview.scrollLeft = 0;
      preview.scrollTop = 0;
    }
  }
}

/**
 * Refreshes the zoom label, image dimensions, compare split and overview map to reflect
 * the current zoom/fit state.
 */
function updateView() {
  if (!image || !zoomLabel || !preview || !previewBody) {
    return;
  }

  if (fitMode) {
    applyFitSizing();
    updatePanAvailability(true);

    if (fitReflowFrameId !== null) {
      cancelAnimationFrame(fitReflowFrameId);
    }
    fitReflowFrameId = requestAnimationFrame(() => {
      applyFitSizing();
      applyCompareSplit();
      updatePanAvailability(false);
      fitReflowFrameId = null;
    });

    zoomLabel.textContent = 'Fit';
    applyCompareSplit();
    requestOverviewMapViewportUpdate();
    return;
  }

  previewBody.style.width = 'max-content';
  previewBody.style.height = 'max-content';
  if (image.naturalWidth > 0) {
    const renderedWidth = Math.round(image.naturalWidth * zoom);
    image.style.width = `${String(renderedWidth)}px`;
    if (compareImage) {
      compareImage.style.width = `${String(renderedWidth)}px`;
    }
  }
  updatePanAvailability(true);

  zoomLabel.textContent = `${String(Math.round(zoom * 100))}%`;
  applyCompareSplit();
  requestOverviewMapViewportUpdate();
}

/**
 * Sets an explicit zoom level, exiting fit mode.
 *
 * @param {number} nextZoom Desired zoom level (clamped to [MIN_ZOOM, MAX_ZOOM]).
 */
function setZoom(nextZoom) {
  fitMode = false;
  zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  updateView();
}

/**
 * Returns the current effective zoom level as rendered-pixels / natural-pixels.
 *
 * @returns {number} Current display zoom ratio.
 */
function getDisplayedZoom() {
  if (!image || image.naturalWidth <= 0) {
    return 1;
  }

  const renderedWidth = image.getBoundingClientRect().width;
  if (renderedWidth <= 0) {
    return 1;
  }

  return renderedWidth / image.naturalWidth;
}

/**
 * Increments or decrements the current zoom by the given delta, exiting fit mode.
 *
 * @param {number} delta Zoom delta to apply (positive = zoom in).
 */
function applyZoomDelta(delta) {
  const baseZoom = fitMode ? getDisplayedZoom() : zoom;
  setZoom(baseZoom + delta);
}

/**
 * Resets zoom to 100% and exits fit mode.
 */
function resetZoom() {
  fitMode = false;
  zoom = 1;
  updateView();
}

/**
 * Activates fit-to-viewport mode.
 */
function setFitMode() {
  fitMode = true;
  updateView();
}

/**
 * Toggles the current image view between fit mode and 100% zoom.
 */
function toggleFitAndActualSize() {
  if (fitMode) {
    resetZoom();
    return;
  }

  setFitMode();
}

/**
 * Checks whether a client point is inside an element rendered rectangle.
 * @param {Element | null | undefined} element Target element.
 * @param {number} clientX Pointer X position in client coordinates.
 * @param {number} clientY Pointer Y position in client coordinates.
 * @returns {boolean} True when the point falls inside the element rectangle.
 */
function isClientPointInsideElementRect(element, clientX, clientY) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

/**
 * Returns true when the double click occurred over one of the rendered images.
 * @param {MouseEvent} event Double-click event.
 * @returns {boolean} True when the event target is a rendered preview image.
 */
function isDoubleClickOnPreviewImage(event) {
  if (!image) {
    return false;
  }

  const isOnMainImage = isClientPointInsideElementRect(image, event.clientX, event.clientY);
  if (isOnMainImage) {
    return true;
  }

  const isOnCompareImage = compareImage
    && !compareImage.classList.contains('is-hidden')
    && isClientPointInsideElementRect(compareImage, event.clientX, event.clientY);

  return Boolean(isOnCompareImage);
}

/**
 * Determines and applies the best initial view mode (fit or 100%) for the currently loaded image.
 * Retries up to 12 times via rAF when layout dimensions are not yet available.
 *
 * @param {number} token Decision token used to discard stale callbacks.
 * @param {number} [attempt=0] Current retry attempt count.
 */
function applyInitialViewModeForCurrentImage(token, attempt = 0) {
  if (token !== initialViewModeDecisionToken || !image || !preview) {
    return;
  }

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const viewportWidth = preview.clientWidth;
  const viewportHeight = preview.clientHeight;

  if (naturalWidth <= 0 || naturalHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    if (attempt >= 12) {
      // Safe fallback when layout info is still unavailable.
      fitMode = true;
      zoom = 1;
      updateView();
      return;
    }

    requestAnimationFrame(() => {
      applyInitialViewModeForCurrentImage(token, attempt + 1);
    });
    return;
  }

  const shouldUse100Percent = naturalWidth <= viewportWidth && naturalHeight <= viewportHeight;
  fitMode = !shouldUse100Percent;
  zoom = 1;
  updateView();
}

/**
 * Increments the decision token and starts the initial view mode selection process.
 */
function scheduleInitialViewModeDecision() {
  initialViewModeDecisionToken += 1;
  const decisionToken = initialViewModeDecisionToken;
  applyInitialViewModeForCurrentImage(decisionToken, 0);
}

/**
 * Shows or hides the info overlay panel and persists the choice in localStorage.
 *
 * @param {boolean} isVisible Whether the overlay should be visible.
 */
function setInfoOverlayVisible(isVisible) {
  if (!infoOverlay) {
    return;
  }

  infoOverlay.classList.toggle('is-hidden', !isVisible);
  if (infoToggleButton) {
    infoToggleButton.classList.toggle('is-active', isVisible);
    infoToggleButton.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
  }
  if (isVisible) {
    requestAnimationFrame(() => {
      initializeInfoOverlayPosition();
      requestOverviewMapViewportUpdate();
    });
  }
  try {
    localStorage.setItem(INFO_OVERLAY_STORAGE_KEY, isVisible ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Reads the stored info overlay visibility from localStorage and applies it.
 */
function initializeInfoOverlayVisibility() {
  let isVisible = false;

  try {
    const storedValue = localStorage.getItem(INFO_OVERLAY_STORAGE_KEY);
    if (storedValue === '1') {
      isVisible = true;
    }
  } catch {
    // Keep default hidden state.
  }

  setInfoOverlayVisible(isVisible);
}

/**
 * Persists the current info overlay position (left, top) to localStorage.
 */
function saveInfoOverlayPosition() {
  if (!infoOverlay) {
    return;
  }

  const left = Number.parseFloat(infoOverlay.style.left || '');
  const top = Number.parseFloat(infoOverlay.style.top || '');

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return;
  }

  try {
    localStorage.setItem(
      INFO_OVERLAY_POSITION_STORAGE_KEY,
      JSON.stringify({ left: Math.round(left), top: Math.round(top) })
    );
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Clamps overlay left/top values so the overlay remains fully within the preview container.
 *
 * @param {number} left Candidate left offset in pixels.
 * @param {number} top Candidate top offset in pixels.
 * @returns {{ left: number, top: number }} Clamped position.
 */
function clampOverlayPosition(left, top) {
  if (!previewContainer || !infoOverlay) {
    return { left: 0, top: 0 };
  }

  const maxLeft = Math.max(0, previewContainer.clientWidth - infoOverlay.offsetWidth);
  const maxTop = Math.max(0, previewContainer.clientHeight - infoOverlay.offsetHeight);

  return {
    left: Math.round(clamp(left, 0, maxLeft)),
    top: Math.round(clamp(top, 0, maxTop))
  };
}

/**
 * Sets the info overlay left/top CSS position after clamping to the container bounds.
 *
 * @param {number} left Target left offset in pixels.
 * @param {number} top Target top offset in pixels.
 */
function applyInfoOverlayPosition(left, top) {
  if (!infoOverlay) {
    return;
  }

  const clamped = clampOverlayPosition(left, top);
  infoOverlay.style.left = `${String(clamped.left)}px`;
  infoOverlay.style.top = `${String(clamped.top)}px`;
  infoOverlay.style.right = 'auto';
}

/**
 * Reads the stored overlay position from localStorage and applies it, or places the overlay
 * near the top-right corner of the preview when no stored position exists.
 */
function initializeInfoOverlayPosition() {
  if (!infoOverlay) {
    return;
  }

  let left = 0;
  let top = 0;

  try {
    const raw = localStorage.getItem(INFO_OVERLAY_POSITION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === 'number') {
        left = parsed.left;
      }
      if (typeof parsed?.top === 'number') {
        top = parsed.top;
      }
    } else if (previewContainer) {
      const margin = 18;
      left = Math.max(0, previewContainer.clientWidth - infoOverlay.offsetWidth - margin);
      top = margin;
    }
  } catch {
    // Keep defaults.
  }

  applyInfoOverlayPosition(left, top);
}

/**
 * Moves the info overlay to follow the pointer during a drag interaction.
 *
 * @param {number} clientX Pointer X position in viewport coordinates.
 * @param {number} clientY Pointer Y position in viewport coordinates.
 */
function moveOverlayFromPointer(clientX, clientY) {
  if (!previewContainer || !infoOverlay) {
    return;
  }

  const previewRect = previewContainer.getBoundingClientRect();
  const overlayWidth = infoOverlay.offsetWidth;
  const overlayHeight = infoOverlay.offsetHeight;

  const rawLeft = clientX - previewRect.left - overlayPointerOffsetX;
  const rawTop = clientY - previewRect.top - overlayPointerOffsetY;

  const maxLeft = Math.max(0, previewContainer.clientWidth - overlayWidth);
  const maxTop = Math.max(0, previewContainer.clientHeight - overlayHeight);

  const nextLeft = clamp(rawLeft, 0, maxLeft);
  const nextTop = clamp(rawTop, 0, maxTop);

  infoOverlay.style.left = `${String(Math.round(nextLeft))}px`;
  infoOverlay.style.top = `${String(Math.round(nextTop))}px`;
}

/**
 * Ends the info overlay drag interaction, releases pointer capture and saves the position.
 */
function endOverlayDrag() {
  if (!infoOverlayHandle) {
    return;
  }

  if (overlayDragPointerId !== null && infoOverlayHandle.hasPointerCapture(overlayDragPointerId)) {
    infoOverlayHandle.releasePointerCapture(overlayDragPointerId);
  }

  overlayDragPointerId = null;
  isDraggingOverlay = false;
  saveInfoOverlayPosition();
}

bindPressAndHoldAction(zoomInButton, () => {
  applyZoomDelta(ZOOM_STEP);
});

bindPressAndHoldAction(zoomOutButton, () => {
  applyZoomDelta(-ZOOM_STEP);
});

bindClickAction(zoomResetButton, () => {
  resetZoom();
});

bindClickAction(zoomFitButton, () => {
  setFitMode();
});

bindClickAction(customBackgroundToggleButton, () => {
  setCustomBackgroundEnabled(!customBackgroundEnabled);
});

bindClickAction(rotateLeftButton, () => {
  rotatePreviewImage(-1);

  if (saveEditsToOriginalFile) {
    vscode?.postMessage({ type: 'rotate-image', direction: 'left' });
  }
});

bindClickAction(rotateRightButton, () => {
  rotatePreviewImage(1);

  if (saveEditsToOriginalFile) {
    vscode?.postMessage({ type: 'rotate-image', direction: 'right' });
  }
});

bindClickAction(mirrorHorizontalButton, () => {
  mirrorPreviewImageHorizontally();

  if (saveEditsToOriginalFile) {
    vscode?.postMessage({ type: 'mirror-image', axis: 'horizontal' });
  }
});

bindClickAction(mirrorVerticalButton, () => {
  mirrorPreviewImageVertically();

  if (saveEditsToOriginalFile) {
    vscode?.postMessage({ type: 'mirror-image', axis: 'vertical' });
  }
});

bindClickAction(zoomSelectButton, () => {
  setSelectionMode(!selectionMode);
});

bindClickAction(infoToggleButton, () => {
  const isCurrentlyHidden = infoOverlay?.classList.contains('is-hidden') ?? true;
  setInfoOverlayVisible(isCurrentlyHidden);
});

bindClickAction(compareToolButton, () => {
  if (!hasComparisonImage()) {
    enableSideBySideOnNextComparePick = false;
    vscode?.postMessage({ type: 'pick-compare-image' });
    return;
  }

  if (isSideBySideCompareActive()) {
    setCompareViewMode('split');
    return;
  }

  vscode?.postMessage({ type: 'clear-compare-image' });
  clearComparisonImage();
});

bindClickAction(comparePickButton, () => {
  enableSideBySideOnNextComparePick = false;
  vscode?.postMessage({ type: 'pick-compare-image' });
});

bindClickAction(compareSideBySideButton, () => {
  if (!hasComparisonImage()) {
    enableSideBySideOnNextComparePick = true;
    vscode?.postMessage({ type: 'pick-compare-image' });
    return;
  }

  if (isSideBySideCompareActive()) {
    vscode?.postMessage({ type: 'clear-compare-image' });
    clearComparisonImage();
    return;
  }

  setCompareViewMode('side-by-side');
});

bindClickAction(compareOrientationButton, () => {
  if (isSideBySideCompareActive()) {
    return;
  }

  compareOrientation = compareOrientation === 'vertical' ? 'horizontal' : 'vertical';
  updateCompareControlsUi();
  applyCompareSplit();
});

bindClickAction(compareDiffPrevButton, () => {
  if (!isSideBySideCompareActive() || compareDiffRegions.length === 0 || compareDiffCurrentIndex <= 0) {
    return;
  }

  compareDiffCurrentIndex -= 1;
  renderCompareDifferenceOverlay();
  centerPreviewOnActiveDifferenceIfEnabled();
});

bindClickAction(compareDiffNextButton, () => {
  if (!isSideBySideCompareActive() || compareDiffRegions.length === 0 || compareDiffCurrentIndex >= compareDiffRegions.length - 1) {
    return;
  }

  compareDiffCurrentIndex += 1;
  renderCompareDifferenceOverlay();
  centerPreviewOnActiveDifferenceIfEnabled();
});

bindClickAction(compareDiffTargetButton, () => {
  if (!isSideBySideCompareActive()) {
    return;
  }

  if (compareDiffOverlayTarget === 'left') {
    compareDiffOverlayTarget = 'right';
  } else if (compareDiffOverlayTarget === 'right') {
    compareDiffOverlayTarget = 'both';
  } else {
    compareDiffOverlayTarget = 'left';
  }

  renderCompareDifferenceOverlay();
  centerPreviewOnActiveDifferenceIfEnabled();
});

bindClickAction(compareDiffAllButton, () => {
  if (!isSideBySideCompareActive() || compareDiffRegions.length === 0) {
    return;
  }

  compareDiffShowAllEnabled = !compareDiffShowAllEnabled;
  renderCompareDifferenceOverlay();

  if (compareDiffAutoCenterEnabled) {
    centerPreviewOnActiveDifferenceIfEnabled();
  }
});

bindClickAction(compareDiffAutoCenterButton, () => {
  if (!isSideBySideCompareActive() || compareDiffRegions.length === 0) {
    return;
  }

  compareDiffAutoCenterEnabled = !compareDiffAutoCenterEnabled;
  updateCompareDiffNavigationUi();

  if (compareDiffAutoCenterEnabled) {
    centerPreviewOnActiveDifferenceIfEnabled();
  }
});

compareSlider?.addEventListener('input', () => {
  if (isSideBySideCompareActive()) {
    return;
  }

  const nextValue = Number.parseFloat(compareSlider.value);
  if (!Number.isFinite(nextValue)) {
    return;
  }

  compareSplitPercent = clamp(nextValue, 0, 100);
  applyCompareSplit();
});

compareDiffSensitivitySlider?.addEventListener('input', () => {
  if (!(compareDiffSensitivitySlider instanceof HTMLInputElement)) {
    return;
  }

  applyCompareDiffSensitivity(compareDiffSensitivitySlider.value);

  try {
    localStorage.setItem(COMPARE_DIFF_SENSITIVITY_STORAGE_KEY, String(compareDiffSensitivity));
  } catch {
    // Ignore storage errors.
  }

  if (isSideBySideCompareActive()) {
    scheduleCompareDifferenceAnalysis();
  }
});

compareDivider?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !compareEnabled || !hasComparisonImage() || isSideBySideCompareActive()) {
    return;
  }

  isDraggingCompareDivider = true;
  compareDividerPointerId = event.pointerId;
  compareDivider.setPointerCapture(event.pointerId);
  updateCompareSplitFromClientPosition(event.clientX, event.clientY);
  stopEvent(event);
});

compareDivider?.addEventListener('pointermove', (event) => {
  if (!isDraggingCompareDivider || compareDividerPointerId !== event.pointerId) {
    return;
  }

  scheduleCompareDividerSplitUpdate(event.clientX, event.clientY);
  stopEvent(event);
});

compareDivider?.addEventListener('pointerup', (event) => {
  if (!isDraggingCompareDivider || compareDividerPointerId !== event.pointerId) {
    return;
  }

  endCompareDividerDrag(event.pointerId);
  stopEvent(event);
});

compareDivider?.addEventListener('pointercancel', (event) => {
  if (!isDraggingCompareDivider || compareDividerPointerId !== event.pointerId) {
    return;
  }

  endCompareDividerDrag(event.pointerId);
  stopEvent(event);
});

compareDivider?.addEventListener('dblclick', (event) => {
  if (!compareEnabled || !hasComparisonImage() || isSideBySideCompareActive()) {
    return;
  }

  compareSplitPercent = 50;
  syncCompareSliderToSplitPercent();
  applyCompareSplit();
  stopEvent(event);
});

zoomToolbar?.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});

zoomToolbar?.addEventListener('pointerdown', (event) => {
  const toolbarButton = event.target instanceof Element
    ? event.target.closest('button')
    : null;

  if (!toolbarButton) {
    return;
  }

  showToolbarClickHalo(toolbarButton);
}, true);

zoomToolbar?.addEventListener('click', (event) => {
  if (event.detail !== 0) {
    return;
  }

  const toolbarButton = event.target instanceof Element
    ? event.target.closest('button')
    : null;

  if (!toolbarButton) {
    return;
  }

  showToolbarClickHalo(toolbarButton);
}, true);

compareControls?.addEventListener('pointerdown', (event) => {
  const compareButton = event.target instanceof Element
    ? event.target.closest('button')
    : null;

  if (!compareButton) {
    return;
  }

  showToolbarClickHalo(compareButton);
}, true);

compareControls?.addEventListener('click', (event) => {
  if (event.detail !== 0) {
    return;
  }

  const compareButton = event.target instanceof Element
    ? event.target.closest('button')
    : null;

  if (!compareButton) {
    return;
  }

  showToolbarClickHalo(compareButton);
}, true);

infoOverlay?.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});

infoOverlayHandle?.addEventListener('pointerdown', (event) => {
  if (!previewContainer || !infoOverlay || event.button !== 0) {
    return;
  }

  const previewRect = previewContainer.getBoundingClientRect();
  const overlayRect = infoOverlay.getBoundingClientRect();

  isDraggingOverlay = true;
  overlayPointerOffsetX = event.clientX - overlayRect.left;
  overlayPointerOffsetY = event.clientY - overlayRect.top;

  const currentLeft = overlayRect.left - previewRect.left;
  const currentTop = overlayRect.top - previewRect.top;
  applyInfoOverlayPosition(currentLeft, currentTop);

  overlayDragPointerId = event.pointerId;
  infoOverlayHandle.setPointerCapture(event.pointerId);
  stopEvent(event);
});

window.addEventListener('pointermove', (event) => {
  if (!isDraggingOverlay || overlayDragPointerId !== event.pointerId) {
    return;
  }

  moveOverlayFromPointer(event.clientX, event.clientY);
});

window.addEventListener('pointerup', (event) => {
  if (!isDraggingOverlay || overlayDragPointerId !== event.pointerId) {
    return;
  }

  endOverlayDrag();
});

window.addEventListener('pointercancel', (event) => {
  if (!isDraggingOverlay || overlayDragPointerId !== event.pointerId) {
    return;
  }

  endOverlayDrag();
});

window.addEventListener('blur', () => {
  if (isDraggingOverlay) {
    endOverlayDrag();
  }

  if (isDraggingCompareDivider) {
    endCompareDividerDrag();
  }

  disablePreviewWheelZoomListener();
});

let isPreviewWheelZoomListenerActive = false;

/**
 * Handles Ctrl/Cmd + wheel zoom on the preview area.
 * @param {WheelEvent} event Wheel event from the preview area.
 */
function handlePreviewWheelZoom(event) {
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }
  const direction = event.deltaY < 0 ? 1 : -1;
  applyZoomDelta(direction * ZOOM_STEP);
}

/**
 * Enables non-passive wheel zoom handling only while modifiers are active.
 */
function enablePreviewWheelZoomListener() {
  if (isPreviewWheelZoomListenerActive || !preview) {
    return;
  }

  preview.addEventListener('wheel', handlePreviewWheelZoom, { passive: false });
  isPreviewWheelZoomListenerActive = true;
}

/**
 * Disables the non-passive wheel zoom handler when no longer needed.
 */
function disablePreviewWheelZoomListener() {
  if (!isPreviewWheelZoomListenerActive || !preview) {
    return;
  }

  preview.removeEventListener('wheel', handlePreviewWheelZoom);
  isPreviewWheelZoomListenerActive = false;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Control' || event.key === 'Meta') {
    enablePreviewWheelZoomListener();
  }
}, { passive: true });

window.addEventListener('keyup', (event) => {
  if ((event.key === 'Control' || event.key === 'Meta') && !event.ctrlKey && !event.metaKey) {
    disablePreviewWheelZoomListener();
  }
}, { passive: true });

previewBody?.addEventListener('pointerdown', () => {
  window.focus();
});

previewBody?.addEventListener('pointerdown', (event) => {
  if (!preview || event.button !== 0) {
    return;
  }

  if (event.target instanceof Element && event.target.closest('.zoom-toolbar')) {
    return;
  }

  if (selectionMode) {
    isSelectingZoomArea = true;
    selectionPointerId = event.pointerId;
    selectionStartClientX = event.clientX;
    selectionStartClientY = event.clientY;
    drawSelectionBox(selectionStartClientX, selectionStartClientY, selectionStartClientX, selectionStartClientY);
    previewBody.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  const isPannable = preview.scrollWidth > preview.clientWidth + 1
    || preview.scrollHeight > preview.clientHeight + 1;
  preview.classList.toggle('pan-enabled', isPannable);

  if (!isPannable) {
    return;
  }

  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragStartScrollLeft = preview.scrollLeft;
  dragStartScrollTop = preview.scrollTop;
  preview.classList.add('dragging');
  previewBody.setPointerCapture(event.pointerId);
  event.preventDefault();
});

previewBody?.addEventListener('pointermove', (event) => {
  if (isSelectingZoomArea && selectionPointerId === event.pointerId) {
    drawSelectionBox(selectionStartClientX, selectionStartClientY, event.clientX, event.clientY);
    event.preventDefault();
    return;
  }

  if (!isDragging || !preview) {
    return;
  }

  const deltaX = event.clientX - dragStartX;
  const deltaY = event.clientY - dragStartY;
  preview.scrollLeft = dragStartScrollLeft - deltaX;
  preview.scrollTop = dragStartScrollTop - deltaY;
});

previewBody?.addEventListener('pointerup', (event) => {
  if (isSelectingZoomArea && selectionPointerId === event.pointerId) {
    zoomToSelection(selectionStartClientX, selectionStartClientY, event.clientX, event.clientY);
    finishSelection();
    setSelectionMode(false);
    return;
  }

  endPreviewDrag(event.pointerId);
});

previewBody?.addEventListener('pointercancel', (event) => {
  if (isSelectingZoomArea && selectionPointerId === event.pointerId) {
    finishSelection();
    return;
  }

  endPreviewDrag(event.pointerId);
});

previewBody?.addEventListener('dblclick', (event) => {
  if (!isDoubleClickOnPreviewImage(event)) {
    return;
  }

  event.preventDefault();
  toggleFitAndActualSize();
});

window.addEventListener('keydown', (event) => {
  const key = event.key;
  const code = event.code;
  const hasCtrlOrMeta = event.ctrlKey || event.metaKey;

  if (pipetteMode && key === 'Escape') {
    event.preventDefault();
    setPipetteMode(false);
    return;
  }

  if ((hasCtrlOrMeta && (key === '+' || key === '=' || code === 'NumpadAdd')) || key === '+') {
    event.preventDefault();
    applyZoomDelta(ZOOM_STEP);
    return;
  }

  if ((hasCtrlOrMeta && (key === '-' || code === 'NumpadSubtract')) || key === '-') {
    event.preventDefault();
    applyZoomDelta(-ZOOM_STEP);
    return;
  }

  if ((hasCtrlOrMeta && key === '0') || code === 'Digit0' || code === 'Numpad0') {
    event.preventDefault();
    resetZoom();
    return;
  }

  if (key.toLowerCase() === 'f') {
    event.preventDefault();
    setFitMode();
    return;
  }

  if (key === 'Escape' && selectionMode) {
    event.preventDefault();
    finishSelection();
    setSelectionMode(false);
    return;
  }

  if (!galleryNavigationEnabled || shouldIgnoreGalleryNavigationTarget(event.target)) {
    return;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }

  if (key === 'ArrowLeft') {
    event.preventDefault();
    requestGalleryNavigation('prev');
    return;
  }

  if (key === 'ArrowRight') {
    event.preventDefault();
    requestGalleryNavigation('next');
  }
});

galleryNavPrevButton?.addEventListener('click', () => {
  if (galleryNavPrevButton instanceof HTMLElement) {
    showToolbarClickHalo(galleryNavPrevButton);
  }
  requestGalleryNavigation('prev');
});

galleryNavNextButton?.addEventListener('click', () => {
  if (galleryNavNextButton instanceof HTMLElement) {
    showToolbarClickHalo(galleryNavNextButton);
  }
  requestGalleryNavigation('next');
});

image?.addEventListener('load', () => {
  image.setAttribute('draggable', 'false');
  syncActiveIcoGalleryItemFromImage();
  syncOverviewMapSource();
  if (pipetteMode) {
    refreshPipetteImageBuffer();
  }
  scheduleInitialViewModeDecision();
  requestOverviewMapViewportUpdate();

  if (isSideBySideCompareActive()) {
    scheduleCompareDifferenceAnalysis();
  }
});

compareImage?.addEventListener('load', () => {
  compareImage.setAttribute('draggable', 'false');
  applyCompareSplit();

  if (isSideBySideCompareActive()) {
    scheduleCompareDifferenceAnalysis();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  switch (message.type) {
    case 'zoom-in':
      applyZoomDelta(ZOOM_STEP);
      break;
    case 'zoom-out':
      applyZoomDelta(-ZOOM_STEP);
      break;
    case 'zoom-reset':
      resetZoom();
      break;
    case 'zoom-fit':
      setFitMode();
      break;
    case 'set-compare-image':
      if (typeof message.source === 'string') {
        if (message.mode === 'side-by-side') {
          enableSideBySideOnNextComparePick = true;
          compareViewMode = 'side-by-side';
        } else if (message.mode === 'split') {
          enableSideBySideOnNextComparePick = false;
          compareViewMode = 'split';
        }

        setComparisonImage(message.source, typeof message.label === 'string' ? message.label : 'Comparison image');
        updateView();
      }
      break;
    case 'clear-compare-image':
      clearComparisonImage();
      break;
    case 'update-settings':
      if (message.settings && typeof message.settings === 'object') {
        applyToolbarPosition(typeof message.settings.toolbarPosition === 'string' ? message.settings.toolbarPosition : 'top');
        applyThemeAccentRgb(typeof message.settings.themeAccentRgb === 'string' ? message.settings.themeAccentRgb : '');
        applyPreviewBackgroundRgb(typeof message.settings.previewBackgroundRgb === 'string' ? message.settings.previewBackgroundRgb : '');
        saveEditsToOriginalFile = toBooleanFlag(
          message.settings.saveEditsToOriginalFile,
          saveEditsToOriginalFile
        );
        applyLoupeSettings({
          diameter: message.settings.pipetteLoupeDiameter,
          virtualResolution: message.settings.pipetteLoupeVirtualResolution,
          zoomAtMinImageZoom: message.settings.pipetteLoupeZoomAtMinImageZoom,
          zoomAtMaxImageZoom: message.settings.pipetteLoupeZoomAtMaxImageZoom
        });

        if (pipetteMode) {
          refreshPipetteImageBuffer();
        }

        if (isSideBySideCompareActive()) {
          scheduleCompareDifferenceAnalysis();
        }
      }
      break;
    case 'update-gallery-navigation':
      applyGalleryNavigationState(message.navigation ?? {});
      break;
    default:
      break;
  }
});

initializeLoupeSettingsFromDom();
initializeThemeFromDom();
initializePreviewBackgroundFromDom();
initializeEditPersistenceSettingsFromDom();
initializeGalleryNavigationFromDom();
initializeCompareDiffSettingsFromDom();
initializeCustomBackgroundToggleState();
initializeInfoOverlayVisibility();
initializeInfoOverlayPosition();
initializeIcoGallery();
syncOverviewMapSource();
if (imageTransformOperations.length > 0) {
  void applyImageTransformToPreview();
}
if (hasComparisonImage()) {
  setCompareEnabled(true);
} else {
  updateCompareControlsUi();
}
clearCompareDifferenceOverlay(true);
if (compareSlider) {
  compareSlider.value = String(compareSplitPercent);
}
updateSelectionModeUi();
updateView();

if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
  scheduleInitialViewModeDecision();
}

preview?.addEventListener('scroll', () => {
  if (isSideBySideCompareActive()) {
    renderCompareDifferenceOverlay();
  }

  requestOverviewMapViewportUpdate();
});

overviewMapImage?.addEventListener('load', () => {
  requestOverviewMapViewportUpdate();
});

overviewMapImage?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  isDraggingOverviewMap = true;
  overviewMapDragPointerId = event.pointerId;
  overviewMapImage.setPointerCapture(event.pointerId);
  centerPreviewFromOverviewPointer(event.clientX, event.clientY);
  event.preventDefault();
});

overviewMapImage?.addEventListener('pointermove', (event) => {
  if (!isDraggingOverviewMap || overviewMapDragPointerId !== event.pointerId) {
    return;
  }

  centerPreviewFromOverviewPointer(event.clientX, event.clientY);
  event.preventDefault();
});

overviewMapImage?.addEventListener('pointerup', (event) => {
  endOverviewMapDrag(event.pointerId);
});

overviewMapImage?.addEventListener('pointercancel', (event) => {
  endOverviewMapDrag(event.pointerId);
});

window.addEventListener('resize', () => {
  if (!infoOverlay) {
    return;
  }

  const left = Number.parseFloat(infoOverlay.style.left || '0');
  const top = Number.parseFloat(infoOverlay.style.top || '0');
  applyInfoOverlayPosition(left, top);

  requestOverviewMapViewportUpdate();
  // Redraw difference regions if side-by-side compare is active.
  if (typeof isSideBySideCompareActive === 'function' && isSideBySideCompareActive()) {
    renderCompareDifferenceOverlay();
  }
});
