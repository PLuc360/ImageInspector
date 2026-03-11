const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
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
const parsedLoupeDiameter = Number.parseInt(pipetteZoomLoupe?.dataset.loupeDiameter ?? '', 10);
const parsedLoupeVirtualResolution = Number.parseInt(pipetteZoomLoupe?.dataset.loupeVirtualResolution ?? '', 10);
const parsedLoupeZoomAtMinImageZoom = Number.parseFloat(pipetteZoomLoupe?.dataset.loupeZoomAtMinImageZoom ?? '');
const parsedLoupeZoomAtMaxImageZoom = Number.parseFloat(pipetteZoomLoupe?.dataset.loupeZoomAtMaxImageZoom ?? '');
const LOUPE_DIAMETER = Number.isFinite(parsedLoupeDiameter)
  ? Math.max(48, Math.min(256, parsedLoupeDiameter))
  : DEFAULT_LOUPE_DIAMETER;
const resolvedVirtualResolution = Number.isFinite(parsedLoupeVirtualResolution)
  ? Math.max(5, Math.min(101, parsedLoupeVirtualResolution))
  : DEFAULT_LOUPE_VIRTUAL_RESOLUTION;
const LOUPE_VIRTUAL_RESOLUTION = resolvedVirtualResolution % 2 === 0
  ? resolvedVirtualResolution - 1
  : resolvedVirtualResolution;
const LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM = Number.isFinite(parsedLoupeZoomAtMinImageZoom)
  ? Math.max(0.25, Math.min(100, parsedLoupeZoomAtMinImageZoom))
  : DEFAULT_LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM;
const LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM = Number.isFinite(parsedLoupeZoomAtMaxImageZoom)
  ? Math.max(0.25, Math.min(100, parsedLoupeZoomAtMaxImageZoom))
  : DEFAULT_LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM;
const LOUPE_DYNAMIC_ZOOM_MIN = Math.min(
  LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM,
  LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM
);
const LOUPE_DYNAMIC_ZOOM_MAX = Math.max(
  LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM,
  LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM
);
const virtualLoupeCanvas = document.createElement('canvas');
virtualLoupeCanvas.width = LOUPE_VIRTUAL_RESOLUTION;
virtualLoupeCanvas.height = LOUPE_VIRTUAL_RESOLUTION;
const virtualLoupeCtx = virtualLoupeCanvas.getContext('2d');

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
const comparePickButton = document.getElementById('compare-pick');
const compareOrientationButton = document.getElementById('compare-orientation');
const compareControls = document.getElementById('compare-controls');
const compareSlider = document.getElementById('compare-slider');
const compareImageLabel = document.getElementById('compare-image-label');
const compareImage = document.getElementById('compare-image');
const compareDivider = document.getElementById('compare-divider');
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
const icoGalleryItems = Array.from(document.querySelectorAll('.ico-gallery-item'));
let isDraggingOverviewMap = false;
let overviewMapDragPointerId = null;
let overviewMapViewportFrameId = null;
let pipetteMode = false;
let pipetteResultFadeTimeoutId = null;
let pipetteResultHideTimeoutId = null;
const INFO_OVERLAY_STORAGE_KEY = 'imageDetails.infoOverlayVisible';
const INFO_OVERLAY_POSITION_STORAGE_KEY = 'imageDetails.infoOverlayPosition';

let zoom = 1;
let fitMode = true;
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
let pendingInitialModeDecision = false;
let pendingInitialModeFrameId = null;
let selectionMode = false;
let isSelectingZoomArea = false;
let selectionPointerId = null;
let selectionStartClientX = 0;
let selectionStartClientY = 0;
let compareEnabled = false;
let compareSplitPercent = 50;
let compareOrientation = 'vertical';
let isDraggingCompareDivider = false;
let compareDividerPointerId = null;
const COMPARE_ORIENTATION_VERTICAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M10 4v12" stroke="currentColor" stroke-width="1.4"/></svg>';
const COMPARE_ORIENTATION_HORIZONTAL_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline;vertical-align:middle"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 10h12" stroke="currentColor" stroke-width="1.4"/></svg>';

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
  compareControls?.classList.toggle('is-hidden', !shouldShowControls);

  if (compareToolButton) {
    compareToolButton.classList.toggle('is-active', compareEnabled);
    compareToolButton.setAttribute('aria-pressed', compareEnabled ? 'true' : 'false');
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
  }
}

function applyCompareSplit() {
  if (!compareImage || !compareDivider || !previewBody || !image || !hasComparisonImage()) {
    return;
  }

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
}

function setCompareEnabled(isEnabled) {
  if (!hasComparisonImage()) {
    compareEnabled = false;
    updateCompareControlsUi();
    applyCompareSplit();
    return;
  }

  compareEnabled = isEnabled;
  updateCompareControlsUi();
  applyCompareSplit();
}

function setComparisonImage(source, label) {
  if (!compareImage || !compareImageLabel) {
    return;
  }

  compareImage.setAttribute('src', source);
  compareImageLabel.textContent = label || 'Comparison image';
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
  endCompareDividerDrag();
  compareImageLabel.textContent = 'No comparison image';
  compareEnabled = false;
  updateCompareControlsUi();
}

function setPipetteMode(isEnabled) {
  pipetteMode = isEnabled;
  if (pipetteButton) {
    pipetteButton.classList.toggle('is-active', pipetteMode);
    pipetteButton.setAttribute('aria-pressed', pipetteMode ? 'true' : 'false');
  }
  if (pipetteMode) {
    if (pipetteCanvas && image) {
      pipetteCanvas.width = image.naturalWidth;
      pipetteCanvas.height = image.naturalHeight;
      pipetteCanvas.style.display = 'none';
      const ctx = pipetteCanvas.getContext('2d');
      ctx.clearRect(0, 0, pipetteCanvas.width, pipetteCanvas.height);
      ctx.drawImage(image, 0, 0);
    }
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

      if (image.getAttribute('src') === nextSource) {
        return;
      }

      if (pipetteMode) {
        setPipetteMode(false);
      }

      image.setAttribute('src', nextSource);
      syncOverviewMapSource();
      scheduleInitialModeDecision();
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
    LOUPE_ZOOM_AT_MIN_IMAGE_ZOOM,
    MAX_ZOOM,
    LOUPE_ZOOM_AT_MAX_IMAGE_ZOOM
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
  if (!pipetteMode || !pipetteCanvas || !image || !pipetteZoomLoupe || !virtualLoupeCtx) return;
  const imageRect = image.getBoundingClientRect();
  const isPointerInsideImage =
    event.clientX >= imageRect.left &&
    event.clientX < imageRect.right &&
    event.clientY >= imageRect.top &&
    event.clientY < imageRect.bottom;

  pipetteZoomLoupe.width = pipetteZoomLoupe.height = LOUPE_DIAMETER;
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
  const pipetteCtx = pipetteCanvas.getContext('2d');
  const hoveredPixelData = pipetteCtx.getImageData(x, y, 1, 1).data;
  updatePipetteHoverInfo(x, y, hoveredPixelData);
  const displayedZoom = Math.max(0.0001, imageRect.width / image.naturalWidth);
  const loupeRelativeZoom = clamp(getDynamicLoupeZoom(displayedZoom), LOUPE_DYNAMIC_ZOOM_MIN, LOUPE_DYNAMIC_ZOOM_MAX);
  const adjustedLoupeZoom = displayedZoom * loupeRelativeZoom;
  const maxSourceSpan = Math.max(1, Math.min(image.naturalWidth, image.naturalHeight));
  const sourceSpan = clamp(LOUPE_DIAMETER / adjustedLoupeZoom, 1, maxSourceSpan);
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

  const destinationLeft = ((clippedSourceLeft - sourceLeft) / sourceSpan) * LOUPE_VIRTUAL_RESOLUTION;
  const destinationTop = ((clippedSourceTop - sourceTop) / sourceSpan) * LOUPE_VIRTUAL_RESOLUTION;
  const destinationWidth = (clippedSourceWidth / sourceSpan) * LOUPE_VIRTUAL_RESOLUTION;
  const destinationHeight = (clippedSourceHeight / sourceSpan) * LOUPE_VIRTUAL_RESOLUTION;

  virtualLoupeCtx.clearRect(0, 0, LOUPE_VIRTUAL_RESOLUTION, LOUPE_VIRTUAL_RESOLUTION);
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
    LOUPE_VIRTUAL_RESOLUTION,
    LOUPE_VIRTUAL_RESOLUTION,
    0,
    0,
    pipetteZoomLoupe.width,
    pipetteZoomLoupe.height
  );

  const pixelSize = pipetteZoomLoupe.width / LOUPE_VIRTUAL_RESOLUTION;
  const centerPixelIndex = Math.floor(LOUPE_VIRTUAL_RESOLUTION / 2);
  const circleRadiusInPixels = LOUPE_VIRTUAL_RESOLUTION / 2;
  const circleRadiusInCanvas = circleRadiusInPixels * pixelSize;

  // Pixelated circular mask: remove pixels outside the radius.
  for (let row = 0; row < LOUPE_VIRTUAL_RESOLUTION; row += 1) {
    for (let column = 0; column < LOUPE_VIRTUAL_RESOLUTION; column += 1) {
      const deltaX = column - centerPixelIndex;
      const deltaY = row - centerPixelIndex;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance > circleRadiusInPixels) {
        loupeCtx.clearRect(column * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }
    }
  }

  // Dessine une croix au centre
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
  // Compute click coordinates in image space.
  const imageRect = image.getBoundingClientRect();
  const normalizedX = (event.clientX - imageRect.left) / imageRect.width;
  const normalizedY = (event.clientY - imageRect.top) / imageRect.height;
  const x = clamp(Math.floor(normalizedX * image.naturalWidth), 0, image.naturalWidth - 1);
  const y = clamp(Math.floor(normalizedY * image.naturalHeight), 0, image.naturalHeight - 1);
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
  const ctx = pipetteCanvas.getContext('2d');
  const pixel = ctx.getImageData(x, y, 1, 1).data;
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

// Disable pipette mode with Escape.
window.addEventListener('keydown', (event) => {
  if (pipetteMode && event.key === 'Escape') {
    setPipetteMode(false);
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
  const fitScale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  const fitWidth = Math.max(1, Math.round(naturalWidth * safeScale));

  previewBody.style.width = '100%';
  previewBody.style.height = '100%';
  image.style.width = `${String(fitWidth)}px`;
  if (compareImage) {
    compareImage.style.width = `${String(fitWidth)}px`;
  }
}

function updateView() {
  if (!image || !zoomLabel || !preview || !previewBody) {
    return;
  }

  if (fitMode) {
    applyFitSizing();

    preview.classList.remove('pan-enabled', 'dragging');
    preview.scrollLeft = 0;
    preview.scrollTop = 0;

    if (fitReflowFrameId !== null) {
      cancelAnimationFrame(fitReflowFrameId);
    }
    fitReflowFrameId = requestAnimationFrame(() => {
      applyFitSizing();
      applyCompareSplit();
      fitReflowFrameId = null;
    });

    zoomLabel.textContent = 'Fit';
    applyCompareSplit();
    requestOverviewMapViewportUpdate();
    return;
  }

  previewBody.style.width = 'max-content';
  previewBody.style.height = 'max-content';
  preview.classList.add('pan-enabled');
  if (image.naturalWidth > 0) {
    const renderedWidth = Math.round(image.naturalWidth * zoom);
    image.style.width = `${String(renderedWidth)}px`;
    if (compareImage) {
      compareImage.style.width = `${String(renderedWidth)}px`;
    }
  }
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

function initializeImageViewMode() {
  if (!image || !preview) {
    return false;
  }

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const viewportWidth = preview.clientWidth;
  const viewportHeight = preview.clientHeight;

  if (naturalWidth <= 0 || naturalHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return false;
  }

  const imageFitsViewport = naturalWidth <= viewportWidth && naturalHeight <= viewportHeight;
  if (imageFitsViewport) {
    fitMode = false;
    zoom = 1;
    return true;
  }

  fitMode = true;
  return true;
}

function evaluateInitialModeDecision() {
  if (!pendingInitialModeDecision) {
    return;
  }

  const initialized = initializeImageViewMode();
  if (initialized) {
    pendingInitialModeDecision = false;
    pendingInitialModeFrameId = null;
    updateView();
    return;
  }

  pendingInitialModeFrameId = requestAnimationFrame(() => {
    evaluateInitialModeDecision();
  });
}

function scheduleInitialModeDecision() {
  pendingInitialModeDecision = true;

  if (pendingInitialModeFrameId !== null) {
    return;
  }

  pendingInitialModeFrameId = requestAnimationFrame(() => {
    evaluateInitialModeDecision();
  });
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
    vscode?.postMessage({ type: 'pick-compare-image' });
    return;
  }

  vscode?.postMessage({ type: 'clear-compare-image' });
  clearComparisonImage();
});

bindClickAction(comparePickButton, () => {
  vscode?.postMessage({ type: 'pick-compare-image' });
});

bindClickAction(compareOrientationButton, () => {
  compareOrientation = compareOrientation === 'vertical' ? 'horizontal' : 'vertical';
  updateCompareControlsUi();
  applyCompareSplit();
});

compareSlider?.addEventListener('input', () => {
  const nextValue = Number.parseFloat(compareSlider.value);
  if (!Number.isFinite(nextValue)) {
    return;
  }

  compareSplitPercent = clamp(nextValue, 0, 100);
  applyCompareSplit();
});

compareDivider?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !compareEnabled || !hasComparisonImage()) {
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

  updateCompareSplitFromClientPosition(event.clientX, event.clientY);
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
  if (!compareEnabled || !hasComparisonImage()) {
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

  if (fitMode) {
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
  scheduleInitialModeDecision();
  requestOverviewMapViewportUpdate();
});

compareImage?.addEventListener('load', () => {
  compareImage.setAttribute('draggable', 'false');
  applyCompareSplit();
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
    default:
      break;
  }
});

initializeInfoOverlayVisibility();
initializeInfoOverlayPosition();
initializeIcoGallery();
syncOverviewMapSource();
if (hasComparisonImage()) {
  setCompareEnabled(true);
} else {
  updateCompareControlsUi();
}
if (compareSlider) {
  compareSlider.value = String(compareSplitPercent);
}
updateSelectionModeUi();
updateView();

preview?.addEventListener('scroll', () => {
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

  if (pendingInitialModeDecision) {
    scheduleInitialModeDecision();
  }

  requestOverviewMapViewportUpdate();
});
