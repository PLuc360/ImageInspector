// Global declaration for VS Code Webview API
/**
 * @typedef {{ postMessage: (msg: any) => void }} VSCodeWebviewApi
 */
/**
 * @type {VSCodeWebviewApi | undefined}
 */
// Indicates if the gallery is fully loaded (no more update-image-meta expected)
window.__galleryFullyLoaded = false;
// Single initialization of the VS Code API for the webview
/**
 * @type {VSCodeWebviewApi | undefined}
 */
window.vscodeApi = window.vscodeApi || (typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined);
// @ts-check
// IIFE for gallery logic
(function () {
    /**
     * Loads GalleryImage metadata from a binary file.
     * Uses VS Code webview API to request content.
     * @param {string} binPath Path to the binary file
     * @returns {Promise<GalleryImage[]>}
     */
    async function loadGalleryImagesFromBin(binPath) {
      // Requests the binary content from the backend
      return new Promise((resolve) => {
        if (!window.vscodeApi) {
          resolve([]);
          return;
        }
        // Unique handler per binPath, removed after use
        function handler(event) {
          const msg = event.data;
          if (msg && msg.type === 'response-gallery-meta-bin' && msg.binPath === binPath) {
            window.removeEventListener('message', handler);
            if (Array.isArray(msg.images)) {
              msg.images.forEach(img => {
                // Force display only from binary (thumbnail base64)
                if (img.thumbnail && typeof img.thumbnail === 'string') {
                  img.thumbUrl = 'data:image/png;base64,' + img.thumbnail;
                } else {
                  img.thumbUrl = '';
                }
              });
              resolve(msg.images);
            } else {
              resolve([]);
            }
          }
        }
        window.addEventListener('message', handler);
        window.vscodeApi.postMessage({ type: 'request-gallery-meta-bin', binPath });
      });
    }
      /**
       * Removes all 'message' event listeners previously added by this script.
       * Should be called before adding new listeners or when cleaning up the webview.
       */
      function cleanupGalleryMessageListeners(handler) {
        window.removeEventListener('message', handler);
      }
            /**
             * Formats a file size in bytes to a human-readable string with dynamic unit.
             * @param {number|undefined} size
             * @returns {string}
             */
            function formatFileSize(size) {
              if (typeof size !== 'number' || isNaN(size) || size < 0) return 'N/A';
              if (size < 1024) return `${size} bytes`;
              if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
              if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
              return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            }
        // Dynamically add shared badge CSS
        const badgeStyle = document.createElement('link');
        badgeStyle.rel = 'stylesheet';
        const badgeCssUri = document.body.getAttribute('data-badge-css-uri') || 'badge.css';
        badgeStyle.href = badgeCssUri;
        document.head.appendChild(badgeStyle);
      // Handler for messages from VS Code Webview
      // Adds the global 'message' listener only once, at the top of the script
      if (!window.__galleryMessageListenerAdded) {
        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'update-image-meta') {
            const { index, meta } = msg;
            if (typeof index !== 'number' || !meta) return;
            // Update image in the array
            galleryImages[index] = {
              ...galleryImages[index],
              ...meta
            };
            renderGallery(); // Refreshes the gallery to display metadata
            // Refreshes only the concerned thumbnail
            const item = document.querySelector(`.gallery-item[data-index="${index}"]`);
            if (item instanceof HTMLElement) {
              item.dataset.name = meta.name;
              item.dataset.type = meta.type;
              item.dataset.size = String(meta.size);
              item.dataset.width = String(meta.width);
              item.dataset.height = String(meta.height);
              // Update label and metadata
              const label = item.querySelector('.gallery-label');
              if (label) label.textContent = meta.name;
              const metaType = item.querySelector('.meta-type');
              if (metaType) {
                // Determines the extension
                const extMatch = meta.name.match(/\.([a-z0-9]+)$/i);
                const ext = extMatch ? extMatch[1].toLowerCase() : '';
                // Removes old colored classes
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
            // The gallery is considered not yet complete
            window.__galleryFullyLoaded = false;
          } else if (msg.type === 'response-gallery-meta-bin') {
            // When the complete binary response arrives, the gallery is considered complete
            window.__galleryFullyLoaded = true;
            if (window.__shouldRestoreScroll) {
              for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                  const savedScrollY = parseInt(localStorage.getItem(scrollKey) || '', 10);
                  const scrollMax = document.body.scrollHeight - window.innerHeight;
                  if (!isNaN(savedScrollY) && savedScrollY > 0) {
                    window.scrollTo(0, savedScrollY);
                  } else {

                  }
                }, 50 + i * 100);
              }
              window.__shouldRestoreScroll = false;
            }
          }
        });
        window.__galleryMessageListenerAdded = true;
      }
  'use strict';

    /**
     * Represents an image in the gallery.
     * @typedef {Object} GalleryImage
     * @property {string} src - Image source URL
     * @property {string} name - File name
     * @property {string} type - File extension (e.g. 'avif')
     * @property {number} size - File size in bytes
     * @property {number} width - Image width
     * @property {number} height - Image height
     */

    /**
     * List of images in the gallery.
     * @type {GalleryImage[]}
     */
    let galleryImages = [];

    /**
     * Current filter and sort options.
     */
    let currentFilterType = 'all';
    let currentSort = 'name';
    let currentSortOrder = 'asc';

    /**
     * Loads gallery images from DOM.
     * @returns {GalleryImage[]}
     */
    function loadGalleryImages() {
      const items = Array.from(document.querySelectorAll('.gallery-item'));
      return items.map(item => {
        const img = item.querySelector('img');
        return {
          src: img ? img.src : '',
          name: item.dataset.name || '',
          type: item.dataset.type || '',
          size: parseInt(item.dataset.size || '0', 10),
          width: parseInt(item.dataset.width || '0', 10),
          height: parseInt(item.dataset.height || '0', 10)
        };
      });
    }

    /**
     * Renders the gallery grid with current filter/sort.
     */
    function renderGallery() {
      let images = galleryImages.slice();
      // Filter by type
      if (currentFilterType !== 'all') {
        images = images.filter(img => img.type === currentFilterType);
      }
      // Sort
      images.sort((a, b) => {
        let cmp = 0;
        if (currentSort === 'name') {
          cmp = a.name.localeCompare(b.name);
        } else if (currentSort === 'type') {
          cmp = a.type.localeCompare(b.type);
        } else if (currentSort === 'size') {
          cmp = a.size - b.size;
        }
        return currentSortOrder === 'asc' ? cmp : -cmp;
      });
      // Render
      const grid = document.querySelector('.gallery-grid');
      if (!grid) return;
      grid.innerHTML = images.map((img, idx) => {
        // Colored badge according to file extension
        const extMatch = img.name.match(/\.([a-z0-9]+)$/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : '';
        const badgeClass = [
          'png','jpg','jpeg','gif','bmp','webp','svg','tiff','tif','avif','heic','heif','ico'
        ].includes(ext) ? `badge badge-ext-${ext}` : 'badge';
        const sizeVal = formatFileSize(img.size);
        const dimVal = (typeof img.width === 'number' && typeof img.height === 'number' && img.width > 0 && img.height > 0 && !isNaN(img.width) && !isNaN(img.height)) ? `${img.width}×${img.height}` : 'N/A';
        return `
          <div class="gallery-item" data-index="${idx}" data-name="${img.name}" data-type="${img.type}" data-size="${img.size}" data-width="${img.width}" data-height="${img.height}">
            <div class="gallery-thumb"><img src="${img.thumbUrl || img.src}" alt="${img.name}" /></div>
            <div class="gallery-label">${img.name}</div>
            <div class="gallery-meta">
              <span class="meta-type ${badgeClass}">${ext.toUpperCase() || img.type.toUpperCase()}</span>
              <span class="meta-size badge">${sizeVal}</span>
              <span class="meta-dim badge">${dimVal}</span>
            </div>
          </div>
        `;
      }).join('');

      // New scroll restoration: if the gallery is complete and a scrollY position is saved, always restore it
      if (window.__galleryFullyLoaded) {
        const savedScrollY = parseInt(localStorage.getItem(scrollKey) || '', 10);
        if (!isNaN(savedScrollY) && savedScrollY > 0) {
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              window.scrollTo(0, savedScrollY);
            }, 30 + i * 50);
          }
        }
        window.__shouldRestoreScroll = false;
      }
    }

    /**
     * Builds the filter and sort menu.
     */
    function buildGalleryMenu() {
      const header = document.querySelector('.gallery-header');
      if (!header) return;
      // Remove old menu
      const oldMenu = header.querySelector('.gallery-menu');
      if (oldMenu) oldMenu.remove();
      // Build menu
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
      // Event listeners
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

    // On DOMContentLoaded, setup menu and gallery
      // Global flag for scroll restoration after tab return
      window.__shouldRestoreScroll = false;

      window.addEventListener('DOMContentLoaded', async () => {
        // Path to the binary file (project root)
        const binPath = 'imageGalleryMeta.bin';
        galleryImages = await loadGalleryImagesFromBin(binPath);
        buildGalleryMenu();
        renderGallery();
        // Saves the scroll position on each user scroll
        window.addEventListener('scroll', () => {
          localStorage.setItem(scrollKey, String(window.scrollY));
        }, { passive: true });

        // Watches for tab return to request scroll restoration on next renderGallery
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            window.__shouldRestoreScroll = true;
            renderGallery();
          }
        });
      });
  // VS Code API
  /** @type {number[]} */
  let selectedIndexes = [];
  // The VS Code API is now accessible via window.vscodeApi

  // Per-folder persistence (zoom, selection, scroll)
  const galleryId = document.body.dataset.galleryId || location.pathname;
  const storageKey = `galleryThumbSize:${galleryId}`;
  const selectionKey = `gallerySelectedIndexes:${galleryId}`;
  const scrollKey = `galleryScrollY:${galleryId}`;

  // Restore tile size
  const savedThumbSize = parseInt(localStorage.getItem(storageKey) || '', 10);
  const MIN_THUMB_SIZE = 196;
  const MAX_THUMB_SIZE = 512;
  const ZOOM_STEP = 16;
  let currentThumbSize = !isNaN(savedThumbSize)
    ? Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, savedThumbSize))
    : MIN_THUMB_SIZE;
  function applyThumbSizeToGrid() {
    const grid = document.querySelector('.gallery-grid');
    if (grid) {
      grid.style.setProperty('--thumb-size', `${currentThumbSize}px`);
    }
  }
  applyThumbSizeToGrid();

  /**
   * Selects/deselects a gallery tile and saves the selection.
   * @param {HTMLElement} item
   * @param {boolean} ctrlPressed
   */
  function selectItem(item, ctrlPressed) {
    const index = parseInt(item.dataset.index ?? '-1', 10);
    if (index < 0) return;
    if (ctrlPressed) {
      // Toggle selection
      if (selectedIndexes.includes(index)) {
        selectedIndexes = selectedIndexes.filter(i => i !== index);
      } else {
        selectedIndexes.push(index);
      }
    } else {
      selectedIndexes = [index];
    }
    // Update visual selection
    document.querySelectorAll('.gallery-item').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const idx = parseInt(el.dataset.index ?? '-1', 10);
      if (selectedIndexes.includes(idx)) {
        el.classList.add('is-selected');
      } else {
        el.classList.remove('is-selected');
      }
    });
    localStorage.setItem(selectionKey, JSON.stringify(selectedIndexes));
  }

  // Unique addition of global listeners to avoid leaks
  if (!window.__galleryGlobalListenersAdded) {
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

    document.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && selectedIndexes.length > 0) {
        event.preventDefault();
        if (window.vscodeApi) window.vscodeApi.postMessage({ type: 'open-image', index: selectedIndexes[0] });
      }
    }, { passive: true });

    document.addEventListener('wheel', (event) => {
      // Option passive false pour permettre preventDefault et éviter le warning
      if (!event.ctrlKey) return;
      event.preventDefault();
      adjustThumbSize(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }, { passive: false });

    window.addEventListener('DOMContentLoaded', () => {
      applyThumbSizeToGrid();
      const savedIndexes = JSON.parse(localStorage.getItem(selectionKey) || '[]');
      if (Array.isArray(savedIndexes) && savedIndexes.length > 0) {
        selectedIndexes = savedIndexes.filter(i => typeof i === 'number' && i >= 0);
        // The gallery is considered not yet complete
        window.__galleryFullyLoaded = false;
      } else if (msg.type === 'response-gallery-meta-bin') {
        // When the complete binary response arrives, the gallery is considered complete
        window.__galleryFullyLoaded = true;
        // Restore scroll one last time if needed
        if (window.__shouldRestoreScroll) {
          renderGallery();
        }
        document.querySelectorAll('.gallery-item').forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const idx = parseInt(el.dataset.index ?? '-1', 10);
          if (selectedIndexes.includes(idx)) {
            el.classList.add('is-selected');
          } else {
            el.classList.remove('is-selected');
          }
        });
      }
      // No longer restore scroll here, handled by renderGallery and the flag
      applyThumbSizeToGrid();
    }, { passive: true });

    window.__galleryGlobalListenersAdded = true;
  }
// End of gallery logic
})();

