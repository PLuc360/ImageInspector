/**
 * Webview script for duplicate search progress, grouping, and navigation.
 */
(function() {
  'use strict';

  const vscodeApi = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;
  const EMPTY_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  let duplicateScanRunning = false;
  let duplicateGroupsCount = 0;
  let activeGroupFilePaths = [];
  let activeGroupFocusIndex = 0;
  let activeGroupRow = null;

  /**
   * Applies the accent color used by duplicate panel visual effects.
   * @param {string} accentRgb RGB accent color value.
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
   * Compares two file-path arrays for strict ordered equality.
   * @param {string[]} left Left-side path list.
   * @param {string[]} right Right-side path list.
   * @returns {boolean} True when both arrays contain the same ordered paths.
   */
  function isSamePathList(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => String(value ?? '') === String(right[index] ?? ''));
  }

  /**
   * Updates the scan status text and run button state.
   * @param {string} statusText Status text to display.
   * @param {boolean} isRunning Whether the scan is currently running.
   */
  function updateDuplicateScanStatus(statusText, isRunning) {
    const statusElement = document.getElementById('duplicate-search-status');
    const runButton = document.getElementById('duplicate-search-run-button');
    const runButtonLabel = runButton?.querySelector('.duplicate-run-button-label');

    duplicateScanRunning = isRunning;

    if (statusElement instanceof HTMLElement) {
      statusElement.textContent = statusText;
    }

    if (runButton instanceof HTMLButtonElement) {
      runButton.disabled = isRunning;
      runButton.title = isRunning ? 'Duplicate search is running' : 'Search duplicates';
      runButton.setAttribute('aria-label', runButton.title);
    }

    if (runButtonLabel instanceof HTMLElement) {
      runButtonLabel.textContent = isRunning ? 'Scanning' : 'Scan';
    }
  }

  /**
   * Updates duplicate scan progress bar and label.
   * @param {{ active?: boolean; completed?: number; total?: number; label?: string }} progress
   */
  function updateDuplicateSearchProgress(progress) {
    const progressContainer = document.getElementById('duplicate-search-progress');
    const progressLabel = document.getElementById('duplicate-search-progress-label');
    const progressTrack = document.querySelector('.duplicate-search-progress-track');
    const progressBar = document.getElementById('duplicate-search-progress-bar');

    if (!(progressContainer instanceof HTMLElement)
      || !(progressLabel instanceof HTMLElement)
      || !(progressTrack instanceof HTMLElement)
      || !(progressBar instanceof HTMLElement)) {
      return;
    }

    const isActive = progress?.active === true;
    if (!isActive) {
      progressContainer.hidden = true;
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
      : 'Scanning files...';

    progressContainer.hidden = false;
    progressLabel.textContent = `${labelPrefix} ${percent}%`;
    progressTrack.setAttribute('aria-valuenow', String(percent));
    progressBar.style.width = `${String(percent)}%`;
  }

  /**
   * Clears the duplicate groups list and displays a placeholder message.
   * @param {string} message Placeholder message to display.
   */
  function resetDuplicateGroupsList(message) {
    const list = document.getElementById('duplicate-groups-list');
    if (!(list instanceof HTMLElement)) {
      return;
    }

    duplicateGroupsCount = 0;
    activeGroupRow = null;
    list.innerHTML = '';
    const placeholder = document.createElement('p');
    placeholder.className = 'duplicate-groups-empty';
    placeholder.textContent = message;
    list.appendChild(placeholder);
  }

  /**
   * Updates the active visual state for one duplicate-group row.
   * @param {HTMLElement | null} rowElement Row element to mark as active.
   */
  function setActiveGroupRow(rowElement) {
    if (activeGroupRow instanceof HTMLElement) {
      activeGroupRow.classList.remove('is-active');
      activeGroupRow.removeAttribute('aria-current');
    }

    activeGroupRow = rowElement instanceof HTMLElement ? rowElement : null;

    if (activeGroupRow instanceof HTMLElement) {
      activeGroupRow.classList.add('is-active');
      activeGroupRow.setAttribute('aria-current', 'true');
    }
  }

  /**
   * Appends one duplicate group row with preview thumbnail and file names.
   * @param {{ thumbnailSrc: string; fileNames: string[]; filePaths: string[]; fileCount: number }} group
   */
  function appendDuplicateGroup(group) {
    const list = document.getElementById('duplicate-groups-list');
    if (!(list instanceof HTMLElement)) {
      return;
    }

    const files = Array.isArray(group?.fileNames)
      ? group.fileNames.map((name) => String(name ?? '').trim()).filter(Boolean)
      : [];
    const filePaths = Array.isArray(group?.filePaths)
      ? group.filePaths.map((filePath) => String(filePath ?? '').trim()).filter(Boolean)
      : [];
    if (files.length < 2 || filePaths.length < 2) {
      return;
    }

    if (duplicateGroupsCount === 0) {
      list.innerHTML = '';
    }

    duplicateGroupsCount += 1;

    const row = document.createElement('article');
    row.className = 'duplicate-group-item';
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;

    const preview = document.createElement('img');
    preview.className = 'duplicate-group-thumb';
    preview.alt = `Duplicate group ${String(duplicateGroupsCount)} preview`;
    preview.src = String(group.thumbnailSrc || EMPTY_IMAGE_SRC);
    preview.loading = 'lazy';
    preview.decoding = 'async';

    const body = document.createElement('div');
    body.className = 'duplicate-group-body';

    const title = document.createElement('div');
    title.className = 'duplicate-group-title';
    const count = Number.isFinite(group?.fileCount) ? Math.max(2, Number(group.fileCount)) : files.length;
    title.textContent = count === 2 ? '2 duplicate files' : `${String(count)} duplicate files`;

    const filesLabel = document.createElement('div');
    filesLabel.className = 'duplicate-group-files';
    filesLabel.textContent = files.join(', ');
    filesLabel.title = files.join(' | ');

    const activateGroupSelection = () => {
      if (isSamePathList(activeGroupFilePaths, filePaths)) {
        activeGroupFocusIndex = (activeGroupFocusIndex + 1) % filePaths.length;
      } else {
        activeGroupFilePaths = [...filePaths];
        activeGroupFocusIndex = 0;
      }

      setActiveGroupRow(row);
      updateDuplicateNavigationButtons();
      if (vscodeApi && typeof vscodeApi.postMessage === 'function') {
        vscodeApi.postMessage({ type: 'select-duplicate-group', filePaths });
      }
    };

    row.addEventListener('click', () => {
      activateGroupSelection();
    });

    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      activateGroupSelection();
    });

    body.appendChild(title);
    body.appendChild(filesLabel);
    row.appendChild(preview);
    row.appendChild(body);
    list.appendChild(row);

    if (isSamePathList(activeGroupFilePaths, filePaths)) {
      setActiveGroupRow(row);
    }
  }

  /**
   * Enables/disables duplicate navigation buttons depending on active group state.
   */
  function updateDuplicateNavigationButtons() {
    const prevButton = document.getElementById('duplicate-nav-prev-button');
    const nextButton = document.getElementById('duplicate-nav-next-button');
    const positionLabel = document.getElementById('duplicate-nav-position');
    const canNavigate = activeGroupFilePaths.length >= 2;

    if (prevButton instanceof HTMLButtonElement) {
      prevButton.disabled = !canNavigate;
    }

    if (nextButton instanceof HTMLButtonElement) {
      nextButton.disabled = !canNavigate;
    }

    if (positionLabel instanceof HTMLElement) {
      if (!canNavigate) {
        positionLabel.textContent = '-- / --';
      } else {
        const total = activeGroupFilePaths.length;
        const current = Math.min(Math.max(activeGroupFocusIndex, 0), total - 1) + 1;
        positionLabel.textContent = `${String(current)} / ${String(total)}`;
      }
    }
  }

  /**
   * Applies a full state snapshot received from the extension host.
   * @param {{ isRunning?: boolean; status?: string; progress?: { active?: boolean; completed?: number; total?: number; label?: string }; groups?: any[] }} state
   */
  function applyDuplicatePanelState(state) {
    const groups = Array.isArray(state?.groups) ? state.groups : [];
    updateDuplicateScanStatus(
      typeof state?.status === 'string' ? state.status : 'Idle',
      state?.isRunning === true
    );
    updateDuplicateSearchProgress(state?.progress || { active: false, completed: 0, total: 0 });

    if (groups.length === 0) {
      activeGroupFilePaths = [];
      activeGroupFocusIndex = 0;
      setActiveGroupRow(null);
      updateDuplicateNavigationButtons();
      resetDuplicateGroupsList('No duplicate scan started.');
      return;
    }

    resetDuplicateGroupsList('');
    groups.forEach((group) => appendDuplicateGroup(group));

    if (activeGroupFilePaths.length > 1) {
      const stillAvailable = groups.some((group) => {
        const groupPaths = Array.isArray(group?.filePaths) ? group.filePaths : [];
        if (groupPaths.length !== activeGroupFilePaths.length) {
          return false;
        }

        return groupPaths.every((path, index) => String(path ?? '') === String(activeGroupFilePaths[index] ?? ''));
      });

      if (!stillAvailable) {
        activeGroupFilePaths = [];
        activeGroupFocusIndex = 0;
        setActiveGroupRow(null);
      } else {
        activeGroupFocusIndex = Math.min(Math.max(activeGroupFocusIndex, 0), activeGroupFilePaths.length - 1);
      }
    }

    updateDuplicateNavigationButtons();
  }

  window.addEventListener('DOMContentLoaded', () => {
    initializeThemeFromDom();

    const runButton = document.getElementById('duplicate-search-run-button');
    if (runButton instanceof HTMLButtonElement) {
      runButton.addEventListener('click', () => {
        if (duplicateScanRunning) {
          return;
        }

        updateDuplicateScanStatus('Starting scan...', true);
        updateDuplicateSearchProgress({ active: true, completed: 0, total: 1, label: 'Scanning files...' });
        resetDuplicateGroupsList('Scanning for duplicate groups...');

        if (vscodeApi && typeof vscodeApi.postMessage === 'function') {
          vscodeApi.postMessage({ type: 'start-duplicate-search' });
        }
      });
    }

    const prevButton = document.getElementById('duplicate-nav-prev-button');
    if (prevButton instanceof HTMLButtonElement) {
      prevButton.addEventListener('click', () => {
        if (activeGroupFilePaths.length < 2 || !vscodeApi || typeof vscodeApi.postMessage !== 'function') {
          return;
        }

        activeGroupFocusIndex = (activeGroupFocusIndex - 1 + activeGroupFilePaths.length) % activeGroupFilePaths.length;
        updateDuplicateNavigationButtons();
        vscodeApi.postMessage({ type: 'navigate-duplicate-group', filePaths: activeGroupFilePaths, direction: 'prev' });
      });
    }

    const nextButton = document.getElementById('duplicate-nav-next-button');
    if (nextButton instanceof HTMLButtonElement) {
      nextButton.addEventListener('click', () => {
        if (activeGroupFilePaths.length < 2 || !vscodeApi || typeof vscodeApi.postMessage !== 'function') {
          return;
        }

        activeGroupFocusIndex = (activeGroupFocusIndex + 1) % activeGroupFilePaths.length;
        updateDuplicateNavigationButtons();
        vscodeApi.postMessage({ type: 'navigate-duplicate-group', filePaths: activeGroupFilePaths, direction: 'next' });
      });
    }

    updateDuplicateScanStatus('Idle', false);
    updateDuplicateSearchProgress({ active: false, completed: 0, total: 0, label: 'Scanning files...' });
    updateDuplicateNavigationButtons();

    if (vscodeApi && typeof vscodeApi.postMessage === 'function') {
      vscodeApi.postMessage({ type: 'duplicate-panel-ready' });
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') {
      return;
    }

    if (msg.type === 'update-settings' && msg.settings && typeof msg.settings === 'object') {
      if (typeof msg.settings.themeAccentRgb === 'string') {
        applyThemeAccentRgb(msg.settings.themeAccentRgb);
      }
      return;
    }

    if (msg.type === 'duplicate-panel-state') {
      applyDuplicatePanelState(msg.state || {});
    }

    if (msg.type === 'duplicate-scan-started') {
      activeGroupFilePaths = [];
      activeGroupFocusIndex = 0;
      updateDuplicateNavigationButtons();
      updateDuplicateScanStatus('Scanning...', true);
      updateDuplicateSearchProgress({
        active: true,
        completed: msg.completed,
        total: msg.total,
        label: typeof msg.label === 'string' ? msg.label : 'Scanning files...'
      });
      resetDuplicateGroupsList('Scanning for duplicate groups...');
    }

    if (msg.type === 'duplicate-scan-progress') {
      updateDuplicateSearchProgress({
        active: true,
        completed: msg.completed,
        total: msg.total,
        label: typeof msg.label === 'string' ? msg.label : 'Scanning files...'
      });
    }

    if (msg.type === 'duplicate-group-found') {
      appendDuplicateGroup(msg.group || {});
    }

    if (msg.type === 'duplicate-scan-complete') {
      updateDuplicateSearchProgress({ active: false, completed: msg.total, total: msg.total, label: 'Scan complete' });
      updateDuplicateScanStatus(typeof msg.status === 'string' ? msg.status : 'Scan complete', false);
      if (duplicateGroupsCount === 0) {
        resetDuplicateGroupsList('No duplicates found.');
      }
    }

    if (msg.type === 'duplicate-scan-error') {
      updateDuplicateSearchProgress({ active: false, completed: 0, total: 0, label: 'Scan failed' });
      updateDuplicateScanStatus('Scan failed', false);
      resetDuplicateGroupsList(typeof msg.message === 'string' ? msg.message : 'Duplicate search failed.');
    }
  });
})();
