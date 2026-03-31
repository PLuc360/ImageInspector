
(function() {
  'use strict';
  window.__imageGalleryJS_OK = true;

  window.vscodeApi = window.vscodeApi || (typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined);
  const galleryId = document.body?.dataset?.galleryId || location.pathname;
  const storageKey = `galleryThumbSize:${galleryId}`;
  window.selectionKey = `gallerySelectedIndexes:${galleryId}`;
  const scrollKey = `galleryScrollY:${galleryId}`;

  let galleryImages = [];
  let selectedIndexes = [];
  let currentFilterType = 'all';
  let currentSort = 'name';
  let currentSortOrder = 'asc';
  const MIN_THUMB_SIZE = 196;
  const MAX_THUMB_SIZE = 512;
  const ZOOM_STEP = 16;
  let currentThumbSize = (() => {
    const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
    return !isNaN(saved) ? Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, saved)) : MIN_THUMB_SIZE;
  })();
  const LAZY_IMAGE_PRELOAD_MARGIN_PX = 1400;
  const EMPTY_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  let galleryImageObserver = null;
  let scheduledRowPreload = 0;
  const loadedImageSources = new Set();

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
   * Returns the current gallery items with stable original indexes.
   * @returns {Array<{ img: any, index: number }>}
   */
  function getFilteredSortedImages() {
    const images = galleryImages
      .map((img, index) => ({ img, index }))
      .filter(({ img }) => currentFilterType === 'all' || img.type === currentFilterType);

    images.sort((left, right) => {
      let cmp = 0;
      if (currentSort === 'name') cmp = left.img.name.localeCompare(right.img.name);
      else if (currentSort === 'type') cmp = left.img.type.localeCompare(right.img.type);
      else if (currentSort === 'size') cmp = left.img.size - right.img.size;
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
    const badgeClass = [
      'png','jpg','jpeg','gif','bmp','webp','svg','tiff','tif','avif','heic','heif','ico'
    ].includes(ext) ? `badge badge-ext-${ext}` : 'badge';
    const sizeVal = formatFileSize(img.size);
    const dimVal = (typeof img.width === 'number' && typeof img.height === 'number' && img.width > 0 && img.height > 0 && !isNaN(img.width) && !isNaN(img.height)) ? `${img.width}×${img.height}` : 'N/A';
    const rawThumbSrc = img.thumbUrl || img.src || '';
    const thumbSrc = escapeHtml(rawThumbSrc);
    const thumbPlaceholder = escapeHtml(img.dominantColorHex || '#2b2b2b');
    const isLoaded = loadedImageSources.has(rawThumbSrc);
    const initialSrc = isLoaded ? thumbSrc : EMPTY_IMAGE_SRC;
    const imageClassName = isLoaded ? 'is-loaded' : '';
    const loadedState = isLoaded ? 'true' : 'false';

    return `
      <div class="gallery-item" data-index="${index}" data-name="${escapeHtml(img.name)}" data-type="${escapeHtml(img.type)}" data-size="${img.size}" data-width="${img.width}" data-height="${img.height}">
        <div class="gallery-thumb" style="--thumb-placeholder:${thumbPlaceholder}">
          <img class="${imageClassName}" src="${initialSrc}" data-src="${thumbSrc}" data-loaded="${loadedState}" alt="${escapeHtml(img.name)}" decoding="async" />
        </div>
        <div class="gallery-label">${escapeHtml(img.name)}</div>
        <div class="gallery-meta">
          <span class="meta-type ${badgeClass}">${escapeHtml(ext.toUpperCase() || img.type.toUpperCase())}</span>
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
   * Applies the current thumbnail size to the gallery grid.
   */
  function applyThumbSizeToGrid() {
    const grid = document.querySelector('.gallery-grid');
    if (grid) grid.style.setProperty('--thumb-size', `${currentThumbSize}px`);
  }

  /**
   * Renders the gallery grid with current filters and sort.
   */
  function renderGallery() {
    const grid = document.querySelector('.gallery-grid');
    if (!grid) return;

    const images = getFilteredSortedImages();
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
    const menu = document.createElement('div');
    menu.className = 'gallery-menu';
    menu.innerHTML = `
      <label>Sort:
        <select id="sort-select">
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="size">Size</option>
        </select>
        <select id="sort-order-select">
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      <label>Filter:
        <select id="filter-type-select">
          <option value="all">All</option>
          <option value="avif">AVIF</option>
          <option value="jpg">JPG</option>
          <option value="png">PNG</option>
        </select>
      </label>
    `;
    header.appendChild(menu);
    menu.querySelector('#sort-select').value = currentSort;
    menu.querySelector('#sort-order-select').value = currentSortOrder;
    menu.querySelector('#filter-type-select').value = currentFilterType;
    menu.querySelector('#sort-select').addEventListener('change', e => {
      currentSort = e.target.value;
      renderGallery();
    }, { passive: true });
    menu.querySelector('#sort-order-select').addEventListener('change', e => {
      currentSortOrder = e.target.value;
      renderGallery();
    }, { passive: true });
    menu.querySelector('#filter-type-select').addEventListener('change', e => {
      currentFilterType = e.target.value;
      renderGallery();
    }, { passive: true });
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
    localStorage.setItem(window.selectionKey, JSON.stringify(selectedIndexes));
  }

  /**
   * Refreshes the gallery view (menu, grid, selection).
   */
  function refreshGalleryView() {
    buildGalleryMenu();
    renderGallery();
    applyThumbSizeToGrid();
    const savedIndexes = JSON.parse(localStorage.getItem(window.selectionKey) || '[]');
    if (Array.isArray(savedIndexes) && savedIndexes.length > 0) {
      selectedIndexes = savedIndexes.filter(i => typeof i === 'number' && i >= 0);
      syncSelectionClasses();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    refreshGalleryView();
    if (window.vscodeApi && typeof window.vscodeApi.postMessage === 'function') {
      window.vscodeApi.postMessage({ type: 'request-gallery-data' });
    }
    window.addEventListener('scroll', () => {
      localStorage.setItem(scrollKey, String(window.scrollY));
      scheduleNearbyRowPreload();
    }, { passive: true });
    window.addEventListener('resize', () => {
      initializeLazyGalleryImages();
      scheduleNearbyRowPreload();
    }, { passive: true });
    window.addEventListener('beforeunload', () => {
      disposeGalleryImageObserver();
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
    if (msg.type === 'gallery-data') {
      if (Array.isArray(msg.images)) {
        galleryImages = msg.images;
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          refreshGalleryView();
        } else {
          window.addEventListener('DOMContentLoaded', refreshGalleryView, { once: true });
        }
      }
    }
    if (msg.type === 'update-image-meta') {
      const { index, meta } = msg;
      if (typeof index !== 'number' || !meta) return;
      const previousImage = galleryImages[index] || {};
      galleryImages[index] = { ...previousImage, ...meta };

      const requiresFullRerender = currentSort !== 'name'
        || currentFilterType !== 'all'
        || (typeof meta.name === 'string' && meta.name !== previousImage.name);

      if (requiresFullRerender) {
        renderGallery();
        return;
      }

      const item = document.querySelector(`.gallery-item[data-index="${index}"]`);
      if (item instanceof HTMLElement) {
        item.dataset.name = meta.name;
        item.dataset.type = meta.type;
        item.dataset.size = String(meta.size);
        item.dataset.width = String(meta.width);
        item.dataset.height = String(meta.height);
        const label = item.querySelector('.gallery-label');
        if (label) label.textContent = meta.name;
        const image = item.querySelector('.gallery-thumb img');
        if (image instanceof HTMLImageElement) {
          image.dataset.src = meta.thumbUrl || meta.src || galleryImages[index].thumbUrl || galleryImages[index].src || '';
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
          metaType.textContent = ext.toUpperCase() || meta.type.toUpperCase();
        }
        const metaSize = item.querySelector('.meta-size');
        if (metaSize) metaSize.textContent = formatFileSize(meta.size);
        const metaDim = item.querySelector('.meta-dim');
        const dimVal = (typeof meta.width === 'number' && typeof meta.height === 'number' && meta.width > 0 && meta.height > 0 && !isNaN(meta.width) && !isNaN(meta.height)) ? `${meta.width}×${meta.height}` : 'N/A';
        if (metaDim) metaDim.textContent = dimVal;
      }
    }
    if (msg.type === 'refresh-gallery') {
      window.location.reload();
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
      const menu = document.createElement('div');
      menu.className = 'gallery-context-menu';
      menu.style.position = 'fixed';
      menu.style.zIndex = 10000;
      menu.style.left = event.clientX + 'px';
      menu.style.top = event.clientY + 'px';
      menu.style.background = '#222';
      menu.style.color = '#fff';
      menu.style.padding = '6px 16px';
      menu.style.borderRadius = '4px';
      menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      menu.style.cursor = 'pointer';
      menu.textContent = 'Remove';
      document.body.appendChild(menu);
      const removeMenu = () => { if (menu.parentNode) menu.parentNode.removeChild(menu); document.removeEventListener('click', removeMenu, true); };
      menu.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index ?? '-1', 10);
        if (!isNaN(idx) && idx >= 0 && window.vscodeApi) {
          window.vscodeApi.postMessage({ type: 'remove-image', indexes: [idx] });
        }
        removeMenu();
      });
      setTimeout(() => document.addEventListener('click', removeMenu, true), 0);
    }
  }, { passive: false });

  document.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    adjustThumbSize(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });

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
