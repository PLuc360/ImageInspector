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
const compareDiffAutoCenterButton = document.getElementById('compare-diff-autocenter');
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
const dominantColorMeta = document.getElementById('dominant-color-meta');
const dominantColorTable = document.getElementById('dominant-color-table');
const overviewMapImage = document.getElementById('overview-map-image');
const overviewMapViewport = document.getElementById('overview-map-viewport');
const PIPETTE_RESULT_VISIBLE_DURATION_MS = 500;
const PIPETTE_RESULT_FADE_DURATION_MS = 260;
const selectedIcoSizeBadge = document.getElementById('selected-ico-size');
function attachIcoGalleryListeners() {
  let icoGalleryItems = [];
  for (const galleryItem of icoGalleryItems) {
    galleryItem.addEventListener('click', (event) => {
      event.preventDefault();

      const nextSource = galleryItem.getAttribute('data-image-source');
      if (!nextSource) {
        return;
      }

      setActiveIcoGalleryItem(galleryItem);

      // Mise à jour couleur dominante
      const dominantColorHex = galleryItem.getAttribute('data-dominant-color-hex');
      const dominantColorRgb = galleryItem.getAttribute('data-dominant-color-rgb');
      if (dominantColorHex) {
        applyDominantColor(dominantColorHex, dominantColorRgb || '');
      }

      image.setAttribute('src', nextSource);
      syncOverviewMapSource();
      updateView();
    });
  }
}
document.addEventListener('DOMContentLoaded', () => {
  initializeIcoGallery();
});
let isDraggingOverviewMap = false;
let overviewMapDragPointerId = null;
let overviewMapViewportFrameId = null;
let pipetteMode = false;
let pipetteResultFadeTimeoutId = null;
let pipetteResultHideTimeoutId = null;
const INFO_OVERLAY_STORAGE_KEY = 'imageDetails.infoOverlayVisible';
const INFO_OVERLAY_POSITION_STORAGE_KEY = 'imageDetails.infoOverlayPosition';
const DIFF_ANALYSIS_MAX_DIMENSION = 1024;
const DIFF_PIXEL_THRESHOLD = 14;
const DIFF_REGION_MIN_PIXELS = 10;
const DIFF_REGION_MAX_ITEMS = 24;
const DIFF_REGION_MERGE_GAP_PX = 8;

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
let compareDiffAutoCenterEnabled = false;
let initialViewModeDecisionToken = 0;
const COMPARE_ORIENTATION_VERTICAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M10 4v12" stroke="currentColor" stroke-width="1.4"/></svg>';
const COMPARE_ORIENTATION_HORIZONTAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 10h12" stroke="currentColor" stroke-width="1.4"/></svg>';
const COMPARE_DIFF_TARGET_LEFT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2"/></svg>';
const COMPARE_DIFF_TARGET_RIGHT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2"/></svg>';
const COMPARE_DIFF_TARGET_BOTH_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="2.5" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="3.5" width="7.5" height="13" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2"/></svg>';

function toClampedNumber(value, min, max, fallbackValue) {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return clamp(numericValue, min, max);
}

function toClampedInteger(value, min, max, fallbackValue) {
  return Math.round(toClampedNumber(value, min, max, fallbackValue));
}

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

function initializeLoupeSettingsFromDom() {
  applyLoupeSettings({
    diameter: layoutElement?.dataset.loupeDiameter,
    virtualResolution: layoutElement?.dataset.loupeVirtualResolution,
    zoomAtMinImageZoom: layoutElement?.dataset.loupeZoomAtMinImageZoom,
    zoomAtMaxImageZoom: layoutElement?.dataset.loupeZoomAtMaxImageZoom
  });
}

function ensurePipetteBufferContext() {
  if (!pipetteCanvas) {
    return null;
  }

  if (!pipetteImageCtx) {
    pipetteImageCtx = pipetteCanvas.getContext('2d');
  }

  return pipetteImageCtx;
}

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

function applyToolbarPosition(toolbarPosition) {
  if (!zoomToolbar) {
    return;
  }

  for (const toolbarClass of TOOLBAR_POSITION_CLASSES) {
    zoomToolbar.classList.remove(toolbarClass);
  }

  if (TOOLBAR_POSITION_CLASSES.includes(`toolbar-pos-${toolbarPosition}`)) {
    zoomToolbar.classList.add(`toolbar-pos-${toolbarPosition}`);
  }
}

function applyThemeAccentRgb(accentRgb) {
  if (!layoutElement || typeof accentRgb !== 'string' || accentRgb.trim().length === 0) {
    return;
  }

  layoutElement.style.setProperty('--toolbar-green-accent-rgb', accentRgb.trim());
}

function applyDominantColor(hexColor, rgbColor) {
    console.log('[ImageInspector] applyDominantColor', hexColor, rgbColor);
  if (!layoutElement || typeof hexColor !== 'string' || hexColor.trim().length === 0) {
    return;
  }

  const normalizedHex = hexColor.trim();
  const normalizedRgb = typeof rgbColor === 'string' && rgbColor.trim().length > 0
    ? rgbColor.trim()
    : '';

  layoutElement.style.setProperty('--dominant-color', normalizedHex);

  if (dominantColorMeta) {
    dominantColorMeta.textContent = normalizedHex;
  }

  if (dominantColorTable) {
    dominantColorTable.textContent = normalizedRgb
      ? `${normalizedHex} (${normalizedRgb})`
      : normalizedHex;
  }
}

function updateSelectionModeUi() {
  if (!preview || !zoomSelectButton) {
    return;
  }

  previewContainer?.classList.toggle('selection-mode', selectionMode);
  zoomSelectButton.classList.toggle('is-active', selectionMode);
  zoomSelectButton.setAttribute('aria-pressed', selectionMode ? 'true' : 'false');
}

function setSelectionMode(isEnabled) {
  selectionMode = isEnabled;

  if (!selectionMode) {
    hideSelectionBox();
  }

  updateSelectionModeUi();
}

function hasComparisonImage() {
  return Boolean(compareImage?.getAttribute('src'));
}

function isSideBySideCompareActive() {
  return compareViewMode === 'side-by-side' && hasComparisonImage();
}

function ensureCompareDiffOverlayContext() {
  if (!compareDiffOverlay) {
    return null;
  }

  if (!compareDiffOverlayCtx) {
    compareDiffOverlayCtx = compareDiffOverlay.getContext('2d');
  }

  return compareDiffOverlayCtx;
}

function ensureCompareDiffOverlaySecondaryContext() {
  if (!compareDiffOverlaySecondary) {
    return null;
  }

  if (!compareDiffOverlaySecondaryCtx) {
    compareDiffOverlaySecondaryCtx = compareDiffOverlaySecondary.getContext('2d');
  }

  return compareDiffOverlaySecondaryCtx;
}

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

function updateCompareDiffNavigationUi() {
  const regionCount = compareDiffRegions.length;
  const hasRegions = regionCount > 0;
  const sideBySideActive = isSideBySideCompareActive();

  if (compareDiffIndexLabel) {
    compareDiffIndexLabel.textContent = hasRegions && compareDiffCurrentIndex >= 0
      ? `${String(compareDiffCurrentIndex + 1)}/${String(regionCount)}`
      : '0/0';
  }

  if (compareDiffPrevButton) {
    compareDiffPrevButton.disabled = !sideBySideActive || !hasRegions || compareDiffCurrentIndex <= 0;
  }

  if (compareDiffNextButton) {
    compareDiffNextButton.disabled = !sideBySideActive || !hasRegions || compareDiffCurrentIndex >= regionCount - 1;
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

  if (compareDiffAutoCenterButton) {
    compareDiffAutoCenterButton.disabled = !sideBySideActive || !hasRegions;
    compareDiffAutoCenterButton.classList.toggle('is-active', compareDiffAutoCenterEnabled);
    compareDiffAutoCenterButton.setAttribute('aria-pressed', compareDiffAutoCenterEnabled ? 'true' : 'false');
  }
}

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

function centerPreviewOnActiveDifferenceIfEnabled() {
  if (!compareDiffAutoCenterEnabled || !isSideBySideCompareActive()) {
    return;
  }

  requestAnimationFrame(() => {
    centerPreviewOnActiveDifference();
    renderCompareDifferenceOverlay();
  });
}

function drawCompareDifferenceRegionOnOverlay(overlayElement, overlayContext, targetImage, region, regionIndex) {
  const targetRect = targetImage.getBoundingClientRect();
  const previewRect = previewContainer?.getBoundingClientRect();
  const renderedWidth = Math.round(targetRect.width);
  const renderedHeight = Math.round(targetRect.height);
  if (renderedWidth <= 0 || renderedHeight <= 0) {
    overlayContext.clearRect(0, 0, overlayElement.width, overlayElement.height);
    overlayElement.classList.add('is-hidden');
    return;
  }

  if (!previewRect) {
    overlayContext.clearRect(0, 0, overlayElement.width, overlayElement.height);
    overlayElement.classList.add('is-hidden');
    return;
  }

  overlayElement.width = renderedWidth;
  overlayElement.height = renderedHeight;
  overlayElement.style.width = `${String(renderedWidth)}px`;
  overlayElement.style.height = `${String(renderedHeight)}px`;
  overlayElement.style.left = `${String(Math.round(targetRect.left - previewRect.left))}px`;
  overlayElement.style.top = `${String(Math.round(targetRect.top - previewRect.top))}px`;
  overlayElement.classList.remove('is-hidden');

  overlayContext.clearRect(0, 0, renderedWidth, renderedHeight);
  overlayContext.lineJoin = 'round';
  overlayContext.font = '600 11px var(--vscode-font-family)';
  overlayContext.textBaseline = 'top';

  const x = Math.round(region.minXRatio * renderedWidth);
  const y = Math.round(region.minYRatio * renderedHeight);
  const width = Math.max(2, Math.round((region.maxXRatio - region.minXRatio) * renderedWidth));
  const height = Math.max(2, Math.round((region.maxYRatio - region.minYRatio) * renderedHeight));

  overlayContext.strokeStyle = 'rgba(255, 74, 87, 0.95)';
  overlayContext.lineWidth = 2;
  overlayContext.strokeRect(x, y, width, height);

  const label = `D${String(regionIndex + 1)}`;
  const labelWidth = overlayContext.measureText(label).width + 8;
  const labelHeight = 16;
  const labelX = x;
  const labelY = Math.max(0, y - labelHeight);

  overlayContext.fillStyle = 'rgba(255, 74, 87, 0.95)';
  overlayContext.fillRect(labelX, labelY, labelWidth, labelHeight);
  overlayContext.fillStyle = '#ffffff';
  overlayContext.fillText(label, labelX + 4, labelY + 2);
}

function clearCompareDifferenceOverlay(clearRegions = false) {
  if (clearRegions) {
    compareDiffRegions = [];
    compareDiffCurrentIndex = -1;
  }

  const primaryOverlayContext = ensureCompareDiffOverlayContext();
  if (compareDiffOverlay && primaryOverlayContext) {
    primaryOverlayContext.clearRect(0, 0, compareDiffOverlay.width, compareDiffOverlay.height);
    compareDiffOverlay.classList.add('is-hidden');
  }

  const secondaryOverlayContext = ensureCompareDiffOverlaySecondaryContext();
  if (compareDiffOverlaySecondary && secondaryOverlayContext) {
    secondaryOverlayContext.clearRect(0, 0, compareDiffOverlaySecondary.width, compareDiffOverlaySecondary.height);
    compareDiffOverlaySecondary.classList.add('is-hidden');
  }

  updateCompareDiffNavigationUi();
}

function renderCompareDifferenceOverlay() {
  if (!image || !compareImage || !isSideBySideCompareActive()) {
    clearCompareDifferenceOverlay(false);
    return;
  }

  const activeRegion = compareDiffCurrentIndex >= 0
    ? compareDiffRegions[compareDiffCurrentIndex]
    : undefined;

  if (!activeRegion) {
    clearCompareDifferenceOverlay(false);
    return;
  }

  const primaryOverlayContext = ensureCompareDiffOverlayContext();
  if (compareDiffOverlay && primaryOverlayContext) {
    if (compareDiffOverlayTarget === 'left' || compareDiffOverlayTarget === 'both') {
      drawCompareDifferenceRegionOnOverlay(
        compareDiffOverlay,
        primaryOverlayContext,
        image,
        activeRegion,
        compareDiffCurrentIndex
      );
    } else {
      primaryOverlayContext.clearRect(0, 0, compareDiffOverlay.width, compareDiffOverlay.height);
      compareDiffOverlay.classList.add('is-hidden');
    }
  }

  const secondaryOverlayContext = ensureCompareDiffOverlaySecondaryContext();
  if (compareDiffOverlaySecondary && secondaryOverlayContext) {
    if (compareDiffOverlayTarget === 'right' || compareDiffOverlayTarget === 'both') {
      drawCompareDifferenceRegionOnOverlay(
        compareDiffOverlaySecondary,
        secondaryOverlayContext,
        compareImage,
        activeRegion,
        compareDiffCurrentIndex
      );
    } else {
      secondaryOverlayContext.clearRect(0, 0, compareDiffOverlaySecondary.width, compareDiffOverlaySecondary.height);
      compareDiffOverlaySecondary.classList.add('is-hidden');
    }
  }

  updateCompareDiffNavigationUi();
}

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

  const maxDimension = Math.max(baseWidth, baseHeight);
  const scale = Math.min(1, DIFF_ANALYSIS_MAX_DIMENSION / maxDimension);
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

  baseContext.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  compareContext.drawImage(compareImage, 0, 0, analysisWidth, analysisHeight);

  const basePixels = baseContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const comparePixels = compareContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const pixelCount = analysisWidth * analysisHeight;
  const diffMask = new Uint8Array(pixelCount);
  const diffStrength = new Float32Array(pixelCount);

  let changedPixels = 0;
  let strengthTotal = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const pixelOffset = index * 4;
    const deltaRed = Math.abs(basePixels[pixelOffset] - comparePixels[pixelOffset]);
    const deltaGreen = Math.abs(basePixels[pixelOffset + 1] - comparePixels[pixelOffset + 1]);
    const deltaBlue = Math.abs(basePixels[pixelOffset + 2] - comparePixels[pixelOffset + 2]);
    const deltaAlpha = Math.abs(basePixels[pixelOffset + 3] - comparePixels[pixelOffset + 3]);
    const colorDelta = (deltaRed + deltaGreen + deltaBlue) / 3;
    const weightedDelta = colorDelta * 0.85 + deltaAlpha * 0.15;

    if (weightedDelta >= DIFF_PIXEL_THRESHOLD) {
      diffMask[index] = 1;
      diffStrength[index] = weightedDelta;
      changedPixels += 1;
      strengthTotal += weightedDelta;
    }
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

    if (regionPixels < DIFF_REGION_MIN_PIXELS) {
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

  const mergeGapXRatio = DIFF_REGION_MERGE_GAP_PX / analysisWidth;
  const mergeGapYRatio = DIFF_REGION_MERGE_GAP_PX / analysisHeight;
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

  compareDiffRegions = mergedRegions
    .sort((leftRegion, rightRegion) => rightRegion.pixelCount - leftRegion.pixelCount)
    .slice(0, DIFF_REGION_MAX_ITEMS);

  if (compareDiffRegions.length === 0) {
    compareDiffCurrentIndex = -1;
  } else if (previouslySelectedIndex < 0) {
    compareDiffCurrentIndex = 0;
  } else {
    compareDiffCurrentIndex = clamp(previouslySelectedIndex, 0, compareDiffRegions.length - 1);
  }

  renderCompareDifferenceOverlay();
}

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

function updateCompareControlsUi() {
  const available = hasComparisonImage();
  const shouldShowControls = available || compareEnabled;
  const sideBySideActive = isSideBySideCompareActive();
  compareControls?.classList.toggle('is-hidden', !shouldShowControls);
  compareControls?.classList.toggle('is-side-by-side', sideBySideActive);

  if (compareToolButton) {
    const splitActive = compareEnabled && !sideBySideActive;
    compareToolButton.classList.toggle('is-active', splitActive);
    compareToolButton.setAttribute('aria-pressed', splitActive ? 'true' : 'false');
  }

  if (compareSideBySideButton) {
    compareSideBySideButton.classList.toggle('is-active', sideBySideActive);
    compareSideBySideButton.setAttribute('aria-pressed', sideBySideActive ? 'true' : 'false');
  }

  if (compareOrientationButton) {
    const orientationButtonState = getCompareOrientationButtonState();
    compareOrientationButton.dataset.orientation = compareOrientation;
    compareOrientationButton.setAttribute('aria-label', orientationButtonState.title);
    compareOrientationButton.classList.toggle('is-active', compareOrientation === 'horizontal');

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

function applyCompareSplit() {
  if (!compareImage || !compareDivider || !previewBody || !image || !hasComparisonImage()) {
    previewBody?.classList.remove('side-by-side-mode');
    clearCompareDifferenceOverlay(false);
    return;
  }

  const sideBySideActive = isSideBySideCompareActive();
  previewBody.classList.toggle('side-by-side-mode', sideBySideActive);

  if (sideBySideActive) {
    compareImage.classList.remove('is-hidden');
    compareDivider.classList.add('is-hidden');
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

function syncCompareSliderToSplitPercent() {
  if (!compareSlider) {
    return;
  }

  compareSlider.value = String(Math.round(clamp(compareSplitPercent, 0, 100)));
}

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

function clearPendingCompareDividerSplitUpdate() {
  if (compareDividerDragFrameId !== null) {
    cancelAnimationFrame(compareDividerDragFrameId);
    compareDividerDragFrameId = null;
  }

  pendingCompareDragClientX = null;
  pendingCompareDragClientY = null;
}

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

function setComparisonImage(source, label) {
  if (!compareImage || !compareImageLabel) {
    return;
  }

  compareImage.setAttribute('src', source);
  compareImageLabel.textContent = label || 'Comparison image';

  const shouldEnableSideBySide = enableSideBySideOnNextComparePick || compareViewMode === 'side-by-side';
  enableSideBySideOnNextComparePick = false;

  if (shouldEnableSideBySide) {
    setCompareViewMode('side-by-side');
    return;
  }

  setCompareEnabled(true);
}

function clearComparisonImage() {
  if (!compareImage || !compareImageLabel) {
    return;
  }

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

function setPipetteMode(isEnabled) {
  pipetteMode = isEnabled;
  if (pipetteButton) {
    pipetteButton.classList.toggle('is-active', pipetteMode);
    pipetteButton.setAttribute('aria-pressed', pipetteMode ? 'true' : 'false');
  }
  if (pipetteMode) {
    refreshPipetteImageBuffer();
    if (previewBody) {
      previewBody.style.cursor = 'none';
    }
    if (pipetteZoomLoupe) {
      pipetteZoomLoupe.style.display = 'block';
    }
    setPipetteHoverInfoVisible(true);
    resetPipetteHoverInfo();
  } else {
    if (previewBody) {
      previewBody.style.cursor = '';
    }
    hidePipetteColorResult(true);
    if (pipetteZoomLoupe) {
      pipetteZoomLoupe.style.display = 'none';
    }
    setPipetteHoverInfoVisible(false);
    resetPipetteHoverInfo();
  }
}

function formatHexColor(red, green, blue) {
  return '#' + [red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function setPipetteHoverInfoVisible(isVisible) {
  if (!pipetteHoverInfo) {
    return;
  }

  pipetteHoverInfo.classList.toggle('is-hidden', !isVisible);
}

function resetPipetteHoverInfo() {
  if (pipetteHoverPosition) {
    pipetteHoverPosition.textContent = '—';
  }

  if (pipetteHoverColor) {
    pipetteHoverColor.textContent = '—';
  }

  if (pipetteHoverSwatch) {
    pipetteHoverSwatch.style.background = 'transparent';
  }
}

function updatePipetteHoverInfo(x, y, pixelData) {
  if (!pipetteHoverPosition || !pipetteHoverColor || !pipetteHoverSwatch) {
    return;
  }

  const hexColor = formatHexColor(pixelData[0], pixelData[1], pixelData[2]);
  pipetteHoverPosition.textContent = `${String(x)}, ${String(y)}`;
  pipetteHoverColor.textContent = hexColor;
  pipetteHoverSwatch.style.background = hexColor;
}

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

function hidePipetteColorResult(immediate = false) {
  if (!pipetteColorResult) {
    return;
  }

  clearPipetteColorResultTimers();
  if (immediate) {
    pipetteColorResult.style.opacity = '0';
    pipetteColorResult.style.display = 'none';
    return;
  }

  pipetteColorResult.style.opacity = '0';
  pipetteResultHideTimeoutId = window.setTimeout(() => {
    if (!pipetteColorResult) {
      return;
    }
    pipetteColorResult.style.display = 'none';
    pipetteResultHideTimeoutId = null;
  }, PIPETTE_RESULT_FADE_DURATION_MS);
}

function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

function bindClickAction(button, action) {
  button?.addEventListener('click', (event) => {
    stopEvent(event);
    action();
  });
}

function showToolbarClickHalo(button) {
  if (!button || !button.classList) {
    return;
  }

  button.classList.remove('click-halo');
  // Force a reflow so the animation restarts on repeated clicks.
  void button.offsetWidth;
  button.classList.add('click-halo');
}

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

function syncActiveIcoGalleryItemFromImage() {
  if (!image || !icoGalleryItems.length) {
    return;
  }

  const currentSource = image.getAttribute('src');
  if (!currentSource) {
    return;
  }

  const matchingItem = icoGalleryItems.find((galleryItem) => galleryItem.getAttribute('data-image-source') === currentSource);
  if (matchingItem) {
    setActiveIcoGalleryItem(matchingItem);
  }
}

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

      // Mise à jour couleur dominante
      const dominantColorHex = galleryItem.getAttribute('data-dominant-color-hex');
      const dominantColorRgb = galleryItem.getAttribute('data-dominant-color-rgb');
      if (dominantColorHex) {
        applyDominantColor(dominantColorHex, dominantColorRgb || '');
      }

      // Toujours appliquer la couleur dominante, même si l'image ne change pas

      if (pipetteMode) {
        setPipetteMode(false);
      }

      image.setAttribute('src', nextSource);
      syncOverviewMapSource();
      updateView();
    });
  }

  syncActiveIcoGalleryItemFromImage();
}

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

function hideOverviewMapViewport() {
  if (!overviewMapViewport) {
    return;
  }

  overviewMapViewport.style.display = 'none';
}

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

  overviewMapViewport.style.display = 'block';
  overviewMapViewport.style.left = `${String(mapContentRect.left + normalizedLeft * mapContentRect.width)}px`;
  overviewMapViewport.style.top = `${String(mapContentRect.top + normalizedTop * mapContentRect.height)}px`;
  overviewMapViewport.style.width = `${String(Math.max(1, normalizedWidth * mapContentRect.width))}px`;
  overviewMapViewport.style.height = `${String(Math.max(1, normalizedHeight * mapContentRect.height))}px`;
}

function requestOverviewMapViewportUpdate() {
  if (overviewMapViewportFrameId !== null) {
    return;
  }

  overviewMapViewportFrameId = requestAnimationFrame(() => {
    overviewMapViewportFrameId = null;
    updateOverviewMapViewport();
  });
}

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

function interpolateLogarithmic(value, fromValue, fromZoom, toValue, toZoom) {
  const safeValue = Math.max(0.0001, value);
  const fromLog = Math.log(fromValue);
  const toLog = Math.log(toValue);
  const currentLog = Math.log(safeValue);
  const progress = (currentLog - fromLog) / (toLog - fromLog);
  return fromZoom + (toZoom - fromZoom) * progress;
}

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
  const loupeCtx = pipetteZoomLoupe.getContext('2d');

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
    pipetteColorResult.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${hex};border:1px solid #ccc;vertical-align:middle;margin-right:6px;"></span><span style="vertical-align:middle;">${hex} <small>(copied)</small></span>`;
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

function hideSelectionBox() {
  if (!zoomSelectionBox) {
    return;
  }

  zoomSelectionBox.style.display = 'none';
}

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function setZoom(nextZoom) {
  fitMode = false;
  zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  updateView();
}

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

function applyZoomDelta(delta) {
  const baseZoom = fitMode ? getDisplayedZoom() : zoom;
  setZoom(baseZoom + delta);
}

function resetZoom() {
  fitMode = false;
  zoom = 1;
  updateView();
}

function setFitMode() {
  fitMode = true;
  updateView();
}

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

function scheduleInitialViewModeDecision() {
  initialViewModeDecisionToken += 1;
  const decisionToken = initialViewModeDecisionToken;
  applyInitialViewModeForCurrentImage(decisionToken, 0);
}

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
      requestOverviewMapViewportUpdate();
    });
  }
  try {
    localStorage.setItem(INFO_OVERLAY_STORAGE_KEY, isVisible ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
}

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

function applyInfoOverlayPosition(left, top) {
  if (!infoOverlay) {
    return;
  }

  const clamped = clampOverlayPosition(left, top);
  infoOverlay.style.left = `${String(clamped.left)}px`;
  infoOverlay.style.top = `${String(clamped.top)}px`;
  infoOverlay.style.right = 'auto';
}

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
});

preview?.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    applyZoomDelta(direction * ZOOM_STEP);
  },
  { passive: false }
);

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
  }
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
        setComparisonImage(message.source, typeof message.label === 'string' ? message.label : 'Comparison image');
        updateView();
      }
      break;
    case 'clear-compare-image':
      clearComparisonImage();
      break;
    case 'set-dominant-color':
      if (typeof message.hexColor === 'string') {
        applyDominantColor(message.hexColor, typeof message.rgbColor === 'string' ? message.rgbColor : '');
      }
      break;
    case 'update-settings':
      if (message.settings && typeof message.settings === 'object') {
        applyToolbarPosition(typeof message.settings.toolbarPosition === 'string' ? message.settings.toolbarPosition : 'top');
        applyThemeAccentRgb(typeof message.settings.themeAccentRgb === 'string' ? message.settings.themeAccentRgb : '');
        applyLoupeSettings({
          diameter: message.settings.pipetteLoupeDiameter,
          virtualResolution: message.settings.pipetteLoupeVirtualResolution,
          zoomAtMinImageZoom: message.settings.pipetteLoupeZoomAtMinImageZoom,
          zoomAtMaxImageZoom: message.settings.pipetteLoupeZoomAtMaxImageZoom
        });

        if (pipetteMode) {
          refreshPipetteImageBuffer();
        }
      }
      break;
    default:
      break;
  }
});

initializeLoupeSettingsFromDom();
initializeInfoOverlayVisibility();
initializeInfoOverlayPosition();
initializeIcoGallery();
syncOverviewMapSource();
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
});
