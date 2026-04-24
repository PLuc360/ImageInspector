
(function() {
  'use strict';
  window.__imageGalleryJS_OK = true;

  window.vscodeApi = window.vscodeApi || (typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined);
  const galleryId = document.body?.dataset?.galleryId || location.pathname;
  const storageKey = `galleryThumbSize:${galleryId}`;
  const galleryStateKey = `galleryViewState:${galleryId}`;
  window.selectionKey = `gallerySelectedIndexes:${galleryId}`;
  const scrollKey = `galleryScrollY:${galleryId}`;
  const persistedGalleryState = readPersistedGalleryState();

  let galleryImages = [];
  let selectedIndexes = [];
  let currentFilterTypes = persistedGalleryState.filterTypes;
  let currentSort = persistedGalleryState.sort;
  let currentSortOrder = persistedGalleryState.sortOrder;
  const MIN_THUMB_SIZE = 196;
  const MAX_THUMB_SIZE = 512;
  const ZOOM_STEP = 16;
  let currentThumbSize = (() => {
    const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
    return !isNaN(saved) ? Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, saved)) : MIN_THUMB_SIZE;
  })();
  const LAZY_IMAGE_PRELOAD_MARGIN_PX = 1400;
  const EMPTY_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  const THUMB_SIZE_CLASS_PREFIX = 'thumb-size-';
  let galleryImageObserver = null;
  let scheduledRowPreload = 0;
  let scheduledScrollSave = 0;
  let scheduledGalleryRefresh = 0;
  let scheduledMetaUpdateFlush = 0;
  const pendingMetaUpdates = new Map();
  const loadedImageSources = new Set();
  let activeContextMenu = null;
  let activeContextMenuCleanup = null;
  let activeDuplicateGroupKey = '';
  let activeDuplicateFocusIndex = 0;

  /**
   * Applies the accent color used by gallery visual effects.
   * @param {string} accentRgb
   */
  function applyThemeAccentRgb(accentRgb) {
    if (!(document.body instanceof HTMLElement) || typeof accentRgb !== 'string') {
      return;
    }

    const normalizedAccent = accentRgb.trim();
    if (!normalizedAccent) {
      return;
    }

    document.body.dataset.toolbarGreenAccentRgb = normalizedAccent;
    document.body.style.setProperty('--toolbar-green-accent-rgb', normalizedAccent);
  }

  /**
   * Reads the initial accent color from DOM attributes.
   */
  function initializeThemeFromDom() {
    const accentRgb = document.body?.dataset?.toolbarGreenAccentRgb;
    if (typeof accentRgb === 'string' && accentRgb.trim().length > 0) {
      applyThemeAccentRgb(accentRgb);
    }
  }

  /**
   * Escapes a string so it can be safely injected into HTML.
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Returns a stable lowercase type key for sorting and filtering.
   * It prefers the file extension so the menu matches the badge shown on each tile.
   * @param {any} img
   * @returns {string}
   */
  function getImageTypeKey(img) {
    const fileName = String(img?.name ?? '').trim();
    const extMatch = fileName.match(/\.([a-z0-9]+)$/i);
    if (extMatch) {
      return extMatch[1].toLowerCase();
    }

    const rawType = String(img?.type ?? '').trim().toLowerCase();
    if (!rawType || rawType === 'loading...' || rawType === 'unknown' || rawType === 'n/a') {
      return '';
    }

    return rawType;
  }

  /**
   * Returns the user-facing type label displayed in the gallery UI.
   * @param {any} img
   * @returns {string}
   */
  function getImageTypeLabel(img) {
    const typeKey = getImageTypeKey(img);
    return typeKey ? typeKey.toUpperCase() : 'UNKNOWN';
  }

  /**
   * Normalizes a list of selected type keys.
   * @param {Iterable<string>} values
   * @returns {string[]}
   */
  function normalizeTypeFilters(values) {
    return Array.from(
      new Set(
        Array.from(values, (value) => String(value ?? '').trim().toLowerCase())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));
  }

  /**
   * Reads the persisted sort and filter state for this gallery.
   * @returns {{ filterTypes: string[], sort: string, sortOrder: string }}
   */
  function readPersistedGalleryState() {
    try {
      const rawState = localStorage.getItem(galleryStateKey);
      if (!rawState) {
        return { filterTypes: [], sort: 'name', sortOrder: 'asc' };
      }

      const savedState = JSON.parse(rawState);
      const filterTypes = normalizeTypeFilters(Array.isArray(savedState?.filterTypes) ? savedState.filterTypes : []);
      const sort = ['name', 'type', 'size'].includes(savedState?.sort) ? savedState.sort : 'name';
      const sortOrder = savedState?.sortOrder === 'desc' ? 'desc' : 'asc';

      return { filterTypes, sort, sortOrder };
    } catch {
      return { filterTypes: [], sort: 'name', sortOrder: 'asc' };
    }
  }

  /**
   * Persists the current sort and filter state for this gallery.
   */
  function persistGalleryState() {
    localStorage.setItem(galleryStateKey, JSON.stringify({
      filterTypes: currentFilterTypes,
      sort: currentSort,
      sortOrder: currentSortOrder
    }));
  }

  /**
   * Indicates whether one or more type filters are currently active.
   * @returns {boolean}
   */
  function hasActiveTypeFilters() {
    return currentFilterTypes.length > 0;
  }

  /**
   * Returns the compact label displayed on the file type filter dropdown.
   * @param {string[]} availableTypes
   * @returns {string}
   */
  function getTypeFilterSummaryLabel(availableTypes) {
    if (!Array.isArray(availableTypes) || availableTypes.length === 0 || !hasActiveTypeFilters()) {
      return 'All types';
    }

    if (currentFilterTypes.length === 1) {
      return currentFilterTypes[0].toUpperCase();
    }

    return `${currentFilterTypes.length} types`;
  }

  /**
   * Returns the current gallery items with stable original indexes.
   * @returns {Array<{ img: any, index: number }>}
   */
  function getFilteredSortedImages() {
    const images = galleryImages
      .map((img, index) => ({ img, index }))
      .filter(({ img }) => !hasActiveTypeFilters() || currentFilterTypes.includes(getImageTypeKey(img)));

    images.sort((left, right) => {
      const leftName = String(left.img?.name ?? '');
      const rightName = String(right.img?.name ?? '');
      const leftType = getImageTypeLabel(left.img);
      const rightType = getImageTypeLabel(right.img);
      const leftSize = typeof left.img?.size === 'number' ? left.img.size : 0;
      const rightSize = typeof right.img?.size === 'number' ? right.img.size : 0;
      let cmp = 0;

      if (currentSort === 'name') {
        cmp = leftName.localeCompare(rightName, undefined, { sensitivity: 'base', numeric: true });
      } else if (currentSort === 'type') {
        cmp = leftType.localeCompare(rightType, undefined, { sensitivity: 'base', numeric: true })
          || leftName.localeCompare(rightName, undefined, { sensitivity: 'base', numeric: true });
      } else if (currentSort === 'size') {
        cmp = (leftSize - rightSize)
          || leftName.localeCompare(rightName, undefined, { sensitivity: 'base', numeric: true });
      }

      return currentSortOrder === 'asc' ? cmp : -cmp;
    });

    return images;
  }

  /**
   * Synchronizes the visual selection state with stored indexes.
   */
  function syncSelectionClasses() {
    document.querySelectorAll('.gallery-item').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const idx = parseInt(el.dataset.index ?? '-1', 10);
      el.classList.toggle('is-selected', selectedIndexes.includes(idx));
    });

    updateSelectionToolbar();
  }

  /**
   * Returns valid selected indexes while preserving the selection order.
   * @returns {number[]}
   */
  function getOrderedSelectedIndexes() {
    const orderedIndexes = [];

    for (const index of selectedIndexes) {
      if (!Number.isInteger(index) || index < 0 || index >= galleryImages.length || orderedIndexes.includes(index)) {
        continue;
      }

      orderedIndexes.push(index);
    }

    return orderedIndexes;
  }

  /**
   * Updates the compare/delete actions and selection counter in the toolbar.
   */
  function updateSelectionToolbar() {
    const orderedSelectedIndexes = getOrderedSelectedIndexes();
    const selectedCount = orderedSelectedIndexes.length;
    const deleteButton = document.getElementById('delete-selected-button');
    const compareSplitButton = document.getElementById('compare-selected-split-button');
    const compareSideBySideButton = document.getElementById('compare-selected-side-by-side-button');
    const selectionCount = document.getElementById('gallery-selection-count');
    const compareActionLabel = selectedCount === 2
      ? 'Compare the 2 selected images'
      : (selectedCount > 2 ? 'Select exactly 2 images to compare' : 'Select 2 images to compare');

    if (selectionCount instanceof HTMLElement) {
      selectionCount.textContent = String(selectedCount);
    }

    if (compareSplitButton instanceof HTMLButtonElement) {
      compareSplitButton.disabled = selectedCount !== 2;
      compareSplitButton.title = selectedCount === 2
        ? 'Compare the 2 selected images with before/after'
        : compareActionLabel;
      compareSplitButton.setAttribute('aria-label', compareSplitButton.title);
    }

    if (compareSideBySideButton instanceof HTMLButtonElement) {
      compareSideBySideButton.disabled = selectedCount !== 2;
      compareSideBySideButton.title = selectedCount === 2
        ? 'Compare the 2 selected images side by side'
        : compareActionLabel;
      compareSideBySideButton.setAttribute('aria-label', compareSideBySideButton.title);
    }

    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.disabled = selectedCount === 0;
      deleteButton.title = selectedCount > 0
        ? (selectedCount === 1 ? 'Delete 1 selected image' : `Delete ${selectedCount} selected images`)
        : 'Select images to delete';
      deleteButton.setAttribute('aria-label', deleteButton.title);
    }
  }

  /**
   * Displays the toolbar halo animation on interaction.
   * @param {HTMLElement | null | undefined} element
   */
  function showToolbarClickHalo(element) {
    if (!(element instanceof HTMLElement)) return;
    element.classList.remove('click-halo');
    void element.offsetWidth;
    element.classList.add('click-halo');
  }

  /**
   * Updates the toolbar count label according to the current filters.
   * @param {number} visibleCount
   * @param {number} totalCount
   */
  function updateGalleryCount(visibleCount, totalCount) {
    const countElement = document.querySelector('.gallery-count');
    if (!(countElement instanceof HTMLElement)) return;

    const visibleLabel = visibleCount === 1 ? '1 image' : `${visibleCount} images`;
    if (visibleCount === totalCount) {
      countElement.textContent = visibleLabel;
      return;
    }

    const totalLabel = totalCount === 1 ? '1 image' : `${totalCount} images`;
    countElement.textContent = `${visibleLabel} shown / ${totalLabel}`;
  }

  /**
   * Updates the temporary gallery loading progress UI in the toolbar.
   * @param {{ active?: boolean; completed?: number; total?: number; label?: string }} progress
   */
  function updateGalleryLoadingProgress(progress) {
    const progressContainer = document.getElementById('gallery-load-progress');
    const progressLabel = document.getElementById('gallery-load-progress-label');
    const progressTrack = document.querySelector('.gallery-load-progress-track');
    const progressBar = document.getElementById('gallery-load-progress-bar');

    if (!(progressContainer instanceof HTMLElement)
      || !(progressLabel instanceof HTMLElement)
      || !(progressTrack instanceof HTMLElement)
      || !(progressBar instanceof HTMLElement)) {
      return;
    }

    const isActive = progress?.active === true;
    if (!isActive) {
      progressContainer.hidden = true;
      progressContainer.style.display = 'none';
      progressTrack.setAttribute('aria-valuenow', '100');
      progressBar.style.width = '100%';
      return;
    }

    const total = Math.max(0, Number.isFinite(progress?.total) ? Number(progress.total) : 0);
    const completed = Math.max(0, Number.isFinite(progress?.completed) ? Number(progress.completed) : 0);
    const safeTotal = total > 0 ? total : 1;
    const ratio = Math.max(0, Math.min(1, completed / safeTotal));
    const percent = Math.round(ratio * 100);
    const labelPrefix = typeof progress?.label === 'string' && progress.label.trim().length > 0
      ? progress.label.trim()
      : 'Loading gallery metadata...';

    progressContainer.hidden = false;
    progressContainer.style.display = 'inline-flex';
    progressLabel.textContent = `${labelPrefix} ${percent}%`;
    progressTrack.setAttribute('aria-valuenow', String(percent));
    progressBar.style.width = `${String(percent)}%`;
  }

  /**
   * Selects all gallery tiles matching a duplicate-group file path list.
   * @param {string[]} filePaths
   * @param {'prev' | 'next' | 'cycle'} [direction='cycle']
   */
  function selectDuplicateGroupByFilePaths(filePaths, direction = 'cycle') {
    if (!Array.isArray(filePaths) || filePaths.length < 2) {
      return;
    }

    const normalizedPaths = Array.from(new Set(
      filePaths
        .map((filePath) => String(filePath ?? '').trim())
        .filter(Boolean)
    ));

    if (normalizedPaths.length < 2) {
      return;
    }

    const nextSelectedIndexes = normalizedPaths
      .map((filePath) => galleryImages.findIndex((image) => image?.filePath === String(filePath)))
      .filter((index) => Number.isInteger(index) && index >= 0);

    if (nextSelectedIndexes.length < 2) {
      return;
    }

    const duplicateGroupKey = normalizedPaths.join('||');
    const isSameGroup = duplicateGroupKey === activeDuplicateGroupKey;
    if (!isSameGroup) {
      activeDuplicateGroupKey = duplicateGroupKey;
      activeDuplicateFocusIndex = direction === 'prev' ? nextSelectedIndexes.length - 1 : 0;
    } else if (direction === 'prev') {
      activeDuplicateFocusIndex = (activeDuplicateFocusIndex - 1 + nextSelectedIndexes.length) % nextSelectedIndexes.length;
    } else {
      activeDuplicateFocusIndex = (activeDuplicateFocusIndex + 1) % nextSelectedIndexes.length;
    }

    selectedIndexes = Array.from(new Set(nextSelectedIndexes));
    syncSelectionClasses();
    localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));

    const focusedIndex = nextSelectedIndexes[Math.min(Math.max(activeDuplicateFocusIndex, 0), nextSelectedIndexes.length - 1)];
    const focusedItem = document.querySelector(`.gallery-item[data-index="${focusedIndex}"]`);
    if (focusedItem instanceof HTMLElement) {
      showToolbarClickHalo(focusedItem);
      focusedItem.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }

  /**
   * Closes the currently opened gallery context menu when present.
   */
  function closeActiveContextMenu() {
    if (typeof activeContextMenuCleanup === 'function') {
      activeContextMenuCleanup();
      return;
    }

    if (activeContextMenu && activeContextMenu.parentNode) {
      activeContextMenu.parentNode.removeChild(activeContextMenu);
    }
    activeContextMenu = null;
  }

  /**
   * Builds the HTML for one gallery card.
   * @param {any} img
   * @param {number} index
   * @returns {string}
   */
  function buildGalleryItemMarkup(img, index) {
    const extMatch = img.name.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const typeLabel = getImageTypeLabel(img);
    const badgeClass = [
      'png','jpg','jpeg','gif','bmp','webp','svg','tiff','tif','avif','heic','heif','ico'
    ].includes(ext) ? `badge badge-ext-${ext}` : 'badge';
    const sizeVal = formatFileSize(img.size);
    const dimVal = (typeof img.width === 'number' && typeof img.height === 'number' && img.width > 0 && img.height > 0 && !isNaN(img.width) && !isNaN(img.height)) ? `${img.width}×${img.height}` : 'N/A';
    const rawThumbSrc = img.thumbUrl || img.src || '';
    const thumbSrc = escapeHtml(rawThumbSrc);
    const isLoaded = loadedImageSources.has(rawThumbSrc);
    const initialSrc = isLoaded ? thumbSrc : EMPTY_IMAGE_SRC;
    const imageClassName = isLoaded ? 'is-loaded' : '';
    const loadedState = isLoaded ? 'true' : 'false';

    return `
      <div class="gallery-item" data-index="${index}" data-name="${escapeHtml(img.name)}" data-type="${escapeHtml(img.type)}" data-size="${img.size}" data-width="${img.width}" data-height="${img.height}">
        <div class="gallery-thumb">
          <img class="${imageClassName}" src="${initialSrc}" data-src="${thumbSrc}" data-loaded="${loadedState}" alt="${escapeHtml(img.name)}" decoding="async" />
        </div>
        <div class="gallery-label">${escapeHtml(img.name)}</div>
        <div class="gallery-meta">
          <span class="meta-type ${badgeClass}">${escapeHtml(typeLabel)}</span>
          <span class="meta-size badge">${sizeVal}</span>
          <span class="meta-dim badge">${dimVal}</span>
        </div>
      </div>
    `;
  }

  /**
   * Checks whether a tile is inside the viewport buffer.
   * @param {HTMLElement} element
   * @param {number} [margin=LAZY_IMAGE_PRELOAD_MARGIN_PX]
   * @returns {boolean}
   */
  function isElementNearViewport(element, margin = LAZY_IMAGE_PRELOAD_MARGIN_PX) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom >= -margin && rect.top <= viewportHeight + margin;
  }

  /**
   * Loads a thumbnail immediately when its tile is near the viewport.
   * @param {HTMLImageElement} imageElement
   */
  function loadGalleryImageIfNearViewport(imageElement) {
    if (!(imageElement instanceof HTMLImageElement)) return;
    const container = imageElement.closest('.gallery-item, .gallery-thumb');
    if (!(container instanceof HTMLElement)) return;
    if (!isElementNearViewport(container)) return;
    loadGalleryImage(imageElement);
  }

  /**
   * Preloads all thumbnails around the viewport using real tile positions.
   */
  function preloadNearbyGalleryRows() {
    const images = document.querySelectorAll('.gallery-thumb img[data-src]');
    images.forEach((image) => {
      if (image instanceof HTMLImageElement) {
        loadGalleryImageIfNearViewport(image);
      }
    });
  }

  /**
   * Schedules row-based preloading on the next animation frame.
   */
  function scheduleNearbyRowPreload() {
    if (scheduledRowPreload) return;
    scheduledRowPreload = window.requestAnimationFrame(() => {
      scheduledRowPreload = 0;
      preloadNearbyGalleryRows();
    });
  }

  /**
   * Persists the current scroll position at most once per animation frame.
   */
  function scheduleScrollPositionSave() {
    if (scheduledScrollSave) return;
    scheduledScrollSave = window.requestAnimationFrame(() => {
      scheduledScrollSave = 0;
      localStorage.setItem(scrollKey, String(window.scrollY));
    });
  }

  /**
   * Disposes the active thumbnail observer.
   */
  function disposeGalleryImageObserver() {
    if (!galleryImageObserver) return;
    galleryImageObserver.disconnect();
    galleryImageObserver = null;
  }

  /**
   * Marks a thumbnail as loaded.
   * @param {Event} event
   */
  function handleLazyImageLoad(event) {
    const imageElement = event.target;
    if (!(imageElement instanceof HTMLImageElement)) return;
    const source = imageElement.dataset.src || imageElement.currentSrc || imageElement.src;
    if (source) {
      loadedImageSources.add(source);
    }
    imageElement.dataset.loaded = 'true';
    imageElement.classList.add('is-loaded');
  }

  /**
   * Restores a placeholder if a thumbnail fails to load.
   * @param {Event} event
   */
  function handleLazyImageError(event) {
    const imageElement = event.target;
    if (!(imageElement instanceof HTMLImageElement)) return;
    imageElement.dataset.loaded = 'false';
    imageElement.classList.remove('is-loaded');
    imageElement.src = EMPTY_IMAGE_SRC;
  }

  /**
   * Loads a thumbnail when it enters the viewport buffer.
   * @param {HTMLImageElement} imageElement
   */
  function loadGalleryImage(imageElement) {
    if (!(imageElement instanceof HTMLImageElement)) return;
    const imageSrc = imageElement.dataset.src;
    if (!imageSrc || imageElement.dataset.loaded === 'true' || imageElement.dataset.loaded === 'pending') return;
    imageElement.dataset.loaded = 'pending';
    imageElement.loading = 'eager';
    imageElement.fetchPriority = 'high';
    imageElement.addEventListener('load', handleLazyImageLoad, { once: true });
    imageElement.addEventListener('error', handleLazyImageError, { once: true });
    imageElement.src = imageSrc;
  }

  /**
   * Unloads a distant thumbnail to reduce memory pressure.
   * @param {HTMLImageElement} imageElement
   */
  function unloadGalleryImage(imageElement) {
    if (!(imageElement instanceof HTMLImageElement)) return;
  }

  /**
   * Enables viewport-based thumbnail loading with a preload buffer.
   */
  function initializeLazyGalleryImages() {
    disposeGalleryImageObserver();
    preloadNearbyGalleryRows();
  }

  /**
   * Formats a file size in bytes to a human-readable string.
   * @param {number} size - File size in bytes.
   * @returns {string}
   */
  function formatFileSize(size) {
    if (typeof size !== 'number' || isNaN(size) || size < 0) return 'N/A';
    if (size < 1024) return `${size} bytes`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * Keeps selected indexes in sync with the current gallery content.
   * @param {number[]} indexes
   * @returns {number[]}
   */
  function sanitizeSelectedIndexes(indexes) {
    return Array.from(new Set(
      indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < galleryImages.length)
    )).sort((left, right) => left - right);
  }

  /**
   * Resolves a metadata update to the current gallery index, even after deletions.
   * @param {number} index
   * @param {any} meta
   * @returns {number}
   */
  function resolveMetaUpdateIndex(index, meta) {
    if (Number.isInteger(index)
      && index >= 0
      && index < galleryImages.length
      && (!meta?.filePath || galleryImages[index]?.filePath === meta.filePath)) {
      return index;
    }

    const filePath = typeof meta?.filePath === 'string' ? meta.filePath : '';
    if (!filePath) {
      return -1;
    }

    return galleryImages.findIndex((image) => image?.filePath === filePath);
  }

  /**
   * Removes deleted items from the in-memory gallery immediately.
   * @param {number[]} indexes
   */
  function removeImagesFromGallery(indexes) {
    const indexesToRemove = new Set(
      indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < galleryImages.length)
    );

    if (indexesToRemove.size === 0) {
      return;
    }

    galleryImages = galleryImages.filter((_, index) => !indexesToRemove.has(index));
    selectedIndexes = [];
    localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));
    refreshGalleryView();
  }

  /**
   * Removes the currently selected images from the gallery and notifies the extension.
   * @param {number[]} indexes
   */
  function deleteSelectedImages(indexes) {
    const indexesToRemove = sanitizeSelectedIndexes(indexes);
    if (indexesToRemove.length === 0) {
      return;
    }

    removeImagesFromGallery(indexesToRemove);
    if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
      window.vscodeApi.postMessage({ type: 'remove-image', indexes: indexesToRemove });
    }
  }

  /**
   * Opens the selected images in the requested comparison mode.
   * @param {'split' | 'side-by-side'} mode
   */
  function startComparisonForSelectedImages(mode) {
    const indexesToCompare = getOrderedSelectedIndexes();
    if (indexesToCompare.length !== 2) {
      updateSelectionToolbar();
      return;
    }

    if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
      window.vscodeApi.postMessage({
        type: 'compare-images',
        indexes: indexesToCompare,
        mode: mode === 'side-by-side' ? 'side-by-side' : 'split'
      });
    }
  }

  /**
   * Applies the current thumbnail size to the gallery grid.
   */
  function applyThumbSizeToGrid() {
    const grid = document.querySelector('.gallery-grid');
    if (!(grid instanceof HTMLElement)) return;

    for (let size = MIN_THUMB_SIZE; size <= MAX_THUMB_SIZE; size += ZOOM_STEP) {
      grid.classList.remove(`${THUMB_SIZE_CLASS_PREFIX}${size}`);
    }
    grid.classList.add(`${THUMB_SIZE_CLASS_PREFIX}${currentThumbSize}`);
  }

  /**
   * Renders the gallery grid with current filters and sort.
   */
  function renderGallery() {
    const grid = document.querySelector('.gallery-grid');
    if (!grid) return;

    const images = getFilteredSortedImages();
    updateGalleryCount(images.length, galleryImages.length);

    if (galleryImages.length === 0) {
      grid.innerHTML = '<div class="gallery-empty"><p>No images found in this folder.</p></div>';
      applyThumbSizeToGrid();
      return;
    }

    grid.innerHTML = images.map(({ img, index }) => buildGalleryItemMarkup(img, index)).join('');
    applyThumbSizeToGrid();

    const savedScrollY = parseInt(localStorage.getItem(scrollKey) || '', 10);
    if (!isNaN(savedScrollY) && savedScrollY > 0) {
      window.scrollTo(0, savedScrollY);
    }

    window.requestAnimationFrame(() => {
      initializeLazyGalleryImages();
      scheduleNearbyRowPreload();
      syncSelectionClasses();
    });
  }

  /**
   * Builds and attaches the gallery menu (sort/filter selectors).
   */
  function buildGalleryMenu() {
    const header = document.querySelector('.gallery-header');
    if (!header) return;
    const oldMenu = header.querySelector('.gallery-menu');
    if (oldMenu) oldMenu.remove();

    const availableTypes = Array.from(
      new Set(
        galleryImages
          .map((img) => getImageTypeKey(img))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));

    currentFilterTypes = normalizeTypeFilters(
      currentFilterTypes.filter((type) => availableTypes.includes(type))
    );
    persistGalleryState();

    const isShowingAllTypes = !hasActiveTypeFilters();
    const filterSummaryLabel = getTypeFilterSummaryLabel(availableTypes);
    const typeFiltersMarkup = availableTypes.length > 0
      ? availableTypes.map((type) => {
        const isActive = currentFilterTypes.includes(type);
        return `
          <label class="gallery-type-filter-option">
            <input type="checkbox" data-type="${escapeHtml(type)}" ${isActive ? 'checked' : ''} />
            <span>${escapeHtml(type.toUpperCase())}</span>
          </label>`;
      }).join('')
      : '<div class="gallery-type-filter-empty">No file types available</div>';

    const menu = document.createElement('div');
    menu.className = 'gallery-menu';
    menu.setAttribute('role', 'toolbar');
    menu.setAttribute('aria-label', 'Gallery filters and sorting');
    menu.innerHTML = `
      <div class="gallery-menu-group">
        <label class="gallery-menu-field">
          <span class="gallery-menu-label">Sort</span>
          <select id="sort-select">
            <option value="name">Name</option>
            <option value="type">Type</option>
            <option value="size">Size</option>
          </select>
        </label>
        <label class="gallery-menu-field">
          <span class="gallery-menu-label">Order</span>
          <select id="sort-order-select">
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <div class="gallery-menu-field gallery-menu-field-filter">
          <span class="gallery-menu-label">Types</span>
          <details class="gallery-type-filter-dropdown">
            <summary id="filter-type-summary" class="gallery-type-filter-summary" aria-label="Filter by file type">${escapeHtml(filterSummaryLabel)}</summary>
            <div id="filter-type-group" class="gallery-type-filter-panel" role="group" aria-label="Filter by type">
              <label class="gallery-type-filter-option gallery-type-filter-option-all">
                <input id="filter-type-all" type="checkbox" ${isShowingAllTypes ? 'checked' : ''} />
                <span>All types</span>
              </label>
              ${typeFiltersMarkup}
            </div>
          </details>
        </div>
      </div>
    `;
    header.appendChild(menu);

    const sortSelect = menu.querySelector('#sort-select');
    const sortOrderSelect = menu.querySelector('#sort-order-select');
    const typeFilterSummary = menu.querySelector('#filter-type-summary');
    const typeFilterAllInput = menu.querySelector('#filter-type-all');
    const typeFilterInputs = Array.from(menu.querySelectorAll('.gallery-type-filter-option input[type="checkbox"][data-type]'));
    if (!(sortSelect instanceof HTMLSelectElement)
      || !(sortOrderSelect instanceof HTMLSelectElement)) {
      return;
    }

    const updateTypeFilterSummary = () => {
      if (!(typeFilterSummary instanceof HTMLElement)) {
        return;
      }

      const nextLabel = getTypeFilterSummaryLabel(availableTypes);
      typeFilterSummary.textContent = nextLabel;
      typeFilterSummary.title = nextLabel;
    };

    sortSelect.value = currentSort;
    sortOrderSelect.value = currentSortOrder;
    updateTypeFilterSummary();

    [sortSelect, sortOrderSelect, typeFilterSummary, typeFilterAllInput, ...typeFilterInputs].forEach((controlElement) => {
      if (!(controlElement instanceof HTMLElement)) return;
      controlElement.addEventListener('pointerdown', () => {
        showToolbarClickHalo(controlElement);
      }, { passive: true });
    });

    sortSelect.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      showToolbarClickHalo(target);
      currentSort = target.value;
      persistGalleryState();
      renderGallery();
    }, { passive: true });
    sortOrderSelect.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      showToolbarClickHalo(target);
      currentSortOrder = target.value;
      persistGalleryState();
      renderGallery();
    }, { passive: true });

    if (typeFilterAllInput instanceof HTMLInputElement) {
      typeFilterAllInput.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;

        if (!target.checked && !hasActiveTypeFilters()) {
          target.checked = true;
          return;
        }

        if (target.checked) {
          currentFilterTypes = [];
          updateTypeFilterSummary();
          persistGalleryState();
          renderGallery();
        }
      });
    }

    typeFilterInputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.addEventListener('change', () => {
        currentFilterTypes = normalizeTypeFilters(
          typeFilterInputs
            .filter((candidate) => candidate instanceof HTMLInputElement && candidate.checked)
            .map((candidate) => String(candidate.dataset.type ?? ''))
        );

        if (typeFilterAllInput instanceof HTMLInputElement) {
          typeFilterAllInput.checked = currentFilterTypes.length === 0;
        }

        updateTypeFilterSummary();
        persistGalleryState();
        renderGallery();
      });
    });
  }

  /**
   * Handles selection of a gallery item (single or multi).
   * @param {HTMLElement} item
   * @param {boolean} ctrlPressed
   */
  function selectItem(item, ctrlPressed) {
    const index = parseInt(item.dataset.index ?? '-1', 10);
    if (index < 0) return;
    if (ctrlPressed) {
      if (selectedIndexes.includes(index)) {
        selectedIndexes = selectedIndexes.filter(i => i !== index);
      } else {
        selectedIndexes.push(index);
      }
    } else {
      selectedIndexes = [index];
    }
    syncSelectionClasses();
    if (selectedIndexes.includes(index)) {
      showToolbarClickHalo(item);
    }
    localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));
  }

  /**
   * Refreshes the gallery view (menu, grid, selection).
   */
  function refreshGalleryView() {
    buildGalleryMenu();
    renderGallery();
    const savedIndexes = JSON.parse(localStorage.getItem(window.selectionKey) || '[]');
    if (Array.isArray(savedIndexes)) {
      selectedIndexes = sanitizeSelectedIndexes(savedIndexes);
      syncSelectionClasses();
    } else {
      updateSelectionToolbar();
    }
  }

  /**
   * Schedules a single gallery refresh in the next animation frame.
   */
  function scheduleGalleryRefresh() {
    if (scheduledGalleryRefresh) {
      return;
    }

    scheduledGalleryRefresh = window.requestAnimationFrame(() => {
      scheduledGalleryRefresh = 0;
      refreshGalleryView();
    });
  }

  /**
   * Applies metadata updates directly to an existing rendered card.
   * @param {number} index
   * @param {any} meta
   */
  function patchRenderedItemMeta(index, meta) {
    const resolvedIndex = resolveMetaUpdateIndex(index, meta);
    if (resolvedIndex < 0) {
      return;
    }

    const item = document.querySelector(`.gallery-item[data-index="${resolvedIndex}"]`);
    if (!(item instanceof HTMLElement)) {
      return;
    }

    const currentImage = galleryImages[resolvedIndex] || {};

    item.dataset.name = meta.name;
    item.dataset.type = meta.type;
    item.dataset.size = String(meta.size);
    item.dataset.width = String(meta.width);
    item.dataset.height = String(meta.height);

    const label = item.querySelector('.gallery-label');
    if (label) {
      label.textContent = meta.name;
    }

    const image = item.querySelector('.gallery-thumb img');
    if (image instanceof HTMLImageElement) {
      image.dataset.src = meta.thumbUrl || meta.src || currentImage.thumbUrl || currentImage.src || '';
      loadGalleryImageIfNearViewport(image);
    }

    const metaType = item.querySelector('.meta-type');
    if (metaType) {
      const extMatch = meta.name.match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      metaType.className = 'meta-type badge';
      if ([
        'png','jpg','jpeg','gif','bmp','webp','svg','tiff','tif','avif','heic','heif','ico'
      ].includes(ext)) {
        metaType.classList.add(`badge-ext-${ext}`);
      }
      metaType.textContent = getImageTypeLabel(currentImage);
    }

    const metaSize = item.querySelector('.meta-size');
    if (metaSize) {
      metaSize.textContent = formatFileSize(meta.size);
    }

    const metaDim = item.querySelector('.meta-dim');
    const dimVal = (typeof meta.width === 'number' && typeof meta.height === 'number' && meta.width > 0 && meta.height > 0 && !isNaN(meta.width) && !isNaN(meta.height)) ? `${meta.width}×${meta.height}` : 'N/A';
    if (metaDim) {
      metaDim.textContent = dimVal;
    }
  }

  /**
   * Flushes queued metadata updates in one frame to avoid repeated sync layout work.
   */
  function flushPendingMetaUpdates() {
    scheduledMetaUpdateFlush = 0;
    if (pendingMetaUpdates.size === 0) {
      return;
    }

    let requiresFullRerender = false;
    for (const { index, meta } of pendingMetaUpdates.values()) {
      const resolvedIndex = resolveMetaUpdateIndex(index, meta);
      if (resolvedIndex < 0) {
        continue;
      }

      const previousImage = galleryImages[resolvedIndex] || {};
      galleryImages[resolvedIndex] = { ...previousImage, ...meta };

      const itemRequiresFullRerender = currentSort !== 'name'
        || hasActiveTypeFilters()
        || (typeof meta.name === 'string' && meta.name !== previousImage.name);

      if (itemRequiresFullRerender) {
        requiresFullRerender = true;
      }
    }

    if (requiresFullRerender) {
      renderGallery();
      pendingMetaUpdates.clear();
      return;
    }

    for (const { index, meta } of pendingMetaUpdates.values()) {
      patchRenderedItemMeta(index, meta);
    }
    pendingMetaUpdates.clear();
  }

  /**
   * Queues one metadata update and applies all pending updates on the next frame.
   * @param {number} index
   * @param {any} meta
   */
  function enqueueMetaUpdate(index, meta) {
    const updateKey = typeof meta?.filePath === 'string' && meta.filePath
      ? meta.filePath
      : (galleryImages[index]?.filePath || String(index));

    pendingMetaUpdates.set(updateKey, { index, meta });
    if (scheduledMetaUpdateFlush) {
      return;
    }

    scheduledMetaUpdateFlush = window.requestAnimationFrame(() => {
      flushPendingMetaUpdates();
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    initializeThemeFromDom();
    refreshGalleryView();

    const duplicateToggleButton = document.getElementById('duplicate-search-toggle-button');
    if (duplicateToggleButton instanceof HTMLButtonElement) {
      duplicateToggleButton.addEventListener('click', () => {
        showToolbarClickHalo(duplicateToggleButton);
        if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
          window.vscodeApi.postMessage({ type: 'open-duplicate-panel' });
        }
      });
    }

    const compareSplitButton = document.getElementById('compare-selected-split-button');
    if (compareSplitButton instanceof HTMLButtonElement) {
      compareSplitButton.addEventListener('click', () => {
        showToolbarClickHalo(compareSplitButton);
        startComparisonForSelectedImages('split');
      });
    }

    const compareSideBySideButton = document.getElementById('compare-selected-side-by-side-button');
    if (compareSideBySideButton instanceof HTMLButtonElement) {
      compareSideBySideButton.addEventListener('click', () => {
        showToolbarClickHalo(compareSideBySideButton);
        startComparisonForSelectedImages('side-by-side');
      });
    }

    const deleteButton = document.getElementById('delete-selected-button');
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.addEventListener('click', () => {
        showToolbarClickHalo(deleteButton);
        const indexesToRemove = [...selectedIndexes];
        window.requestAnimationFrame(() => {
          deleteSelectedImages(indexesToRemove);
        });
      });
    }

    if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
      window.vscodeApi.postMessage({ type: 'request-gallery-data' });
    }
    window.addEventListener('scroll', () => {
      scheduleScrollPositionSave();
      scheduleNearbyRowPreload();
    }, { passive: true });
    window.addEventListener('resize', () => {
      initializeLazyGalleryImages();
      scheduleNearbyRowPreload();
    }, { passive: true });
    window.addEventListener('beforeunload', () => {
      disposeGalleryImageObserver();
      if (scheduledRowPreload) {
        window.cancelAnimationFrame(scheduledRowPreload);
        scheduledRowPreload = 0;
      }
      if (scheduledGalleryRefresh) {
        window.cancelAnimationFrame(scheduledGalleryRefresh);
        scheduledGalleryRefresh = 0;
      }
      if (scheduledMetaUpdateFlush) {
        window.cancelAnimationFrame(scheduledMetaUpdateFlush);
        scheduledMetaUpdateFlush = 0;
      }
      if (scheduledScrollSave) {
        window.cancelAnimationFrame(scheduledScrollSave);
        scheduledScrollSave = 0;
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        initializeLazyGalleryImages();
        scheduleNearbyRowPreload();
        if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
          window.vscodeApi.postMessage({ type: 'request-gallery-data' });
        }
      }
    });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'update-settings' && msg.settings && typeof msg.settings === 'object') {
      if (typeof msg.settings.themeAccentRgb === 'string') {
        applyThemeAccentRgb(msg.settings.themeAccentRgb);
      }
      return;
    }
    if (msg.type === 'gallery-data') {
      if (Array.isArray(msg.images)) {
        galleryImages = msg.images;
        activeDuplicateGroupKey = '';
        activeDuplicateFocusIndex = 0;
        const totalImages = galleryImages.length;
        const pendingImages = galleryImages.reduce((count, image) => (
          String(image?.type ?? '').trim().toLowerCase() === 'loading...' ? count + 1 : count
        ), 0);
        if (pendingImages > 0) {
          updateGalleryLoadingProgress({
            active: true,
            completed: totalImages - pendingImages,
            total: totalImages,
            label: 'Loading gallery metadata...'
          });
        } else {
          updateGalleryLoadingProgress({ active: false, completed: totalImages, total: totalImages });
        }
        selectedIndexes = sanitizeSelectedIndexes(selectedIndexes);
        localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          scheduleGalleryRefresh();
        } else {
          window.addEventListener('DOMContentLoaded', scheduleGalleryRefresh, { once: true });
        }
      }
    }
    if (msg.type === 'update-image-meta') {
      const { index, meta } = msg;
      if (typeof index !== 'number' || !meta) return;
      enqueueMetaUpdate(index, meta);
    }
    if (msg.type === 'refresh-gallery') {
      if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
        window.vscodeApi.postMessage({ type: 'request-gallery-data' });
      } else {
        scheduleGalleryRefresh();
      }
    }
    if (msg.type === 'gallery-load-progress') {
      updateGalleryLoadingProgress(msg);
    }
    if (msg.type === 'select-duplicate-group' && Array.isArray(msg.filePaths)) {
      selectDuplicateGroupByFilePaths(msg.filePaths, 'cycle');
    }
    if (msg.type === 'navigate-duplicate-group' && Array.isArray(msg.filePaths)) {
      const direction = msg.direction === 'prev' ? 'prev' : 'next';
      selectDuplicateGroupByFilePaths(msg.filePaths, direction);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !(target instanceof Element)) return;

    const item = target.closest('.gallery-item');
    if (item instanceof HTMLElement) {
      selectItem(item, event.ctrlKey);
      localStorage.setItem(scrollKey, String(window.scrollY));
    }
  }, { passive: true });

  document.addEventListener('dblclick', (event) => {
    const target = event.target;
    if (!target || !(target instanceof Element)) return;
    const item = target.closest('.gallery-item');
    let index = -1;
    if (item instanceof HTMLElement) {
      index = parseInt(item.dataset.index ?? '-1', 10);
    }
    if (index < 0 && selectedIndexes.length > 0) {
      index = selectedIndexes[0];
    }
    if (index >= 0 && window.vscodeApi) window.vscodeApi.postMessage({ type: 'open-image', index });
  }, { passive: true });

  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!target || !(target instanceof Element)) return;
    const item = target.closest('.gallery-item');
    if (item instanceof HTMLElement) {
      event.preventDefault();
      closeActiveContextMenu();

      const idx = parseInt(item.dataset.index ?? '-1', 10);
      if (isNaN(idx) || idx < 0) return;

      if (!selectedIndexes.includes(idx)) {
        selectedIndexes = [idx];
        localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));
        syncSelectionClasses();
      }

      const indexesToRemove = selectedIndexes.includes(idx) && selectedIndexes.length > 1
        ? [...selectedIndexes]
        : [idx];
      const removeLabel = indexesToRemove.length > 1
        ? `Remove ${indexesToRemove.length} images`
        : 'Remove image';

      const menu = document.createElement('div');
      menu.className = 'gallery-context-menu';
      menu.textContent = removeLabel;
      document.body.appendChild(menu);
      activeContextMenu = menu;

      const cursorOffsetPx = 6;
      const viewportMarginPx = 8;
      const maxLeft = Math.max(viewportMarginPx, window.innerWidth - menu.offsetWidth - viewportMarginPx);
      const maxTop = Math.max(viewportMarginPx, window.innerHeight - menu.offsetHeight - viewportMarginPx);
      const left = Math.min(Math.max(viewportMarginPx, event.clientX + cursorOffsetPx), maxLeft);
      const top = Math.min(Math.max(viewportMarginPx, event.clientY + cursorOffsetPx), maxTop);
      menu.style.left = `${String(left)}px`;
      menu.style.top = `${String(top)}px`;

      const removeMenu = () => {
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
        document.removeEventListener('click', removeMenu, true);
        if (activeContextMenu === menu) {
          activeContextMenu = null;
          activeContextMenuCleanup = null;
        }
      };
      activeContextMenuCleanup = removeMenu;
      menu.addEventListener('click', () => {
        deleteSelectedImages(indexesToRemove);
        removeMenu();
      });
      setTimeout(() => document.addEventListener('click', removeMenu, true), 0);
    }
  }, { passive: false });

  let isWheelZoomListenerActive = false;

  /**
   * Handles Ctrl/Cmd + wheel to resize gallery thumbnails.
   * @param {WheelEvent} event
   */
  function handleWheelZoom(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.cancelable) {
      event.preventDefault();
    }
    adjustThumbSize(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  /**
   * Enables the non-passive wheel zoom handler only when needed.
   */
  function enableWheelZoomListener() {
    if (isWheelZoomListenerActive) return;
    document.addEventListener('wheel', handleWheelZoom, { passive: false });
    isWheelZoomListenerActive = true;
  }

  /**
   * Disables the non-passive wheel zoom handler when modifier keys are released.
   */
  function disableWheelZoomListener() {
    if (!isWheelZoomListenerActive) return;
    document.removeEventListener('wheel', handleWheelZoom);
    isWheelZoomListenerActive = false;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Control' || event.key === 'Meta') {
      enableWheelZoomListener();
    }
  }, { passive: true });

  document.addEventListener('keyup', (event) => {
    if ((event.key === 'Control' || event.key === 'Meta') && !event.ctrlKey && !event.metaKey) {
      disableWheelZoomListener();
    }
  }, { passive: true });

  window.addEventListener('blur', disableWheelZoomListener, { passive: true });

  /**
   * Adjusts the thumbnail size by a given delta.
   * @param {number} delta
   */
  function adjustThumbSize(delta) {
    currentThumbSize = Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, currentThumbSize + delta));
    localStorage.setItem(storageKey, String(currentThumbSize));
    applyThumbSizeToGrid();
    initializeLazyGalleryImages();
    scheduleNearbyRowPreload();
  }

})();
