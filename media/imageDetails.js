const pipetteZoomLoupe = document.getElementById('pipette-zoom-loupe');
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32;

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
const zoomSelectionBox = document.getElementById('zoom-selection-box');
const pipetteButton = document.getElementById('pipette-tool');
const pipetteCanvas = document.getElementById('pipette-canvas');
const pipetteColorResult = document.getElementById('pipette-color-result');
const selectedIcoSizeBadge = document.getElementById('selected-ico-size');
const icoGalleryItems = Array.from(document.querySelectorAll('.ico-gallery-item'));
let pipetteMode = false;
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
  } else {
    if (previewBody) {
      previewBody.style.cursor = '';
    }
    if (pipetteColorResult) {
      pipetteColorResult.style.display = 'none';
    }
    if (pipetteZoomLoupe) {
      pipetteZoomLoupe.style.display = 'none';
    }
  }
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
      selectedIcoSizeBadge.textContent = `Taille sélectionnée: ${selectedSizeLabel}`;
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
      scheduleInitialModeDecision();
    });
  }

  syncActiveIcoGalleryItemFromImage();
}
// Affichage de la loupe de zoom local autour du curseur en mode pipette
previewBody?.addEventListener('pointermove', (event) => {
  if (!pipetteMode || !pipetteCanvas || !image || !pipetteZoomLoupe) return;
  const imageRect = image.getBoundingClientRect();
  const x = Math.round((event.clientX - imageRect.left) * (image.naturalWidth / imageRect.width));
  const y = Math.round((event.clientY - imageRect.top) * (image.naturalHeight / imageRect.height));
  // Taille de la zone à zoomer (en pixels natifs)
  const region = 9;
  const displayedZoom = imageRect.width / image.naturalWidth;
  const baseLoupeZoom = 8;
  const dynamicLoupeZoom = Math.max(2, baseLoupeZoom / displayedZoom); // min 2 pour éviter une loupe trop petite
  const loupeSize = region * dynamicLoupeZoom;
  // Limite la taille de la loupe à la taille de l'image
  const maxLoupeSize = Math.min(128, image.naturalWidth * dynamicLoupeZoom, image.naturalHeight * dynamicLoupeZoom);
  pipetteZoomLoupe.width = pipetteZoomLoupe.height = Math.round(maxLoupeSize);
  const ctx = pipetteCanvas.getContext('2d');
  const loupeCtx = pipetteZoomLoupe.getContext('2d');
  loupeCtx.clearRect(0, 0, pipetteZoomLoupe.width, pipetteZoomLoupe.height);
  // Calcul de la zone source sans jamais sortir de l'image
  let sx = Math.max(0, Math.min(x - Math.floor(region / 2), image.naturalWidth - region));
  let sy = Math.max(0, Math.min(y - Math.floor(region / 2), image.naturalHeight - region));
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.drawImage(pipetteCanvas, sx, sy, region, region, 0, 0, pipetteZoomLoupe.width, pipetteZoomLoupe.height);
  // Dessine une croix au centre
  loupeCtx.strokeStyle = '#f00';
  loupeCtx.lineWidth = 0.5;
  loupeCtx.beginPath();
  // Centre exact du canvas
  const center = Math.floor(pipetteZoomLoupe.width / 2) + 0.5;
  loupeCtx.moveTo(center, 0);
  loupeCtx.lineTo(center, pipetteZoomLoupe.height);
  loupeCtx.moveTo(0, center);
  loupeCtx.lineTo(pipetteZoomLoupe.width, center);
  loupeCtx.stroke();
  pipetteZoomLoupe.style.left = (event.clientX - pipetteZoomLoupe.width / 2) + 'px';
  pipetteZoomLoupe.style.top = (event.clientY - pipetteZoomLoupe.height / 2) + 'px';
});
// Cache la loupe quand le curseur quitte la zone
previewBody?.addEventListener('pointerleave', () => {
  if (pipetteZoomLoupe) pipetteZoomLoupe.style.display = 'none';
});
previewBody?.addEventListener('pointerenter', () => {
  if (pipetteMode && pipetteZoomLoupe) pipetteZoomLoupe.style.display = 'block';
});
// Gestion du bouton pipette
pipetteButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  setPipetteMode(!pipetteMode);
});

// Gestion du clic pour la pipette
previewBody?.addEventListener('click', (event) => {
  if (!pipetteMode || !pipetteCanvas || !image) return;
  // Calculer la position du clic relative à l'image affichée
  const imageRect = image.getBoundingClientRect();
  const x = Math.round((event.clientX - imageRect.left) * (image.naturalWidth / imageRect.width));
  const y = Math.round((event.clientY - imageRect.top) * (image.naturalHeight / imageRect.height));
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
  const ctx = pipetteCanvas.getContext('2d');
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  // Copier dans le presse-papier
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(hex).catch(() => {});
  } else {
    // Fallback pour vieux navigateurs : textarea caché
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
  // Afficher le résultat
  if (pipetteColorResult) {
    pipetteColorResult.style.display = 'block';
    // Décale la bulle à droite de la loupe (loupe centrée sur le curseur, 40px de marge)
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
  }
});

// Désactive le mode pipette à l'ESC
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
      fitReflowFrameId = null;
    });

    zoomLabel.textContent = 'Fit';
    return;
  }

  previewBody.style.width = 'max-content';
  previewBody.style.height = 'max-content';
  preview.classList.add('pan-enabled');
  if (image.naturalWidth > 0) {
    image.style.width = `${String(Math.round(image.naturalWidth * zoom))}px`;
  }
  zoomLabel.textContent = `${String(Math.round(zoom * 100))}%`;
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

zoomInButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  applyZoomDelta(ZOOM_STEP);
});

zoomOutButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  applyZoomDelta(-ZOOM_STEP);
});

zoomResetButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  resetZoom();
});

zoomFitButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  setFitMode();
});

zoomSelectButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  setSelectionMode(!selectionMode);
});

infoToggleButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const isCurrentlyHidden = infoOverlay?.classList.contains('is-hidden') ?? true;
  setInfoOverlayVisible(isCurrentlyHidden);
});

zoomToolbar?.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});

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
  event.preventDefault();
  event.stopPropagation();
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

  if (!preview) {
    return;
  }

  isDragging = false;
  preview.classList.remove('dragging');
  if (previewBody.hasPointerCapture(event.pointerId)) {
    previewBody.releasePointerCapture(event.pointerId);
  }
});

previewBody?.addEventListener('pointercancel', (event) => {
  if (isSelectingZoomArea && selectionPointerId === event.pointerId) {
    finishSelection();
    return;
  }

  if (!preview) {
    return;
  }

  isDragging = false;
  preview.classList.remove('dragging');
  if (previewBody.hasPointerCapture(event.pointerId)) {
    previewBody.releasePointerCapture(event.pointerId);
  }
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
  scheduleInitialModeDecision();
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
    default:
      break;
  }
});

initializeInfoOverlayVisibility();
initializeInfoOverlayPosition();
initializeIcoGallery();
updateSelectionModeUi();
updateView();

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
});
