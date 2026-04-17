# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.10.3] - 2026-04-17
### Added
- Added double-click zoom toggle in the image details preview: double-click now switches between `Fit` and `100%`.

## [1.10.2] - 2026-04-11
### Changed
- Improved gallery opening feedback with an immediate loading screen and visible progress so opening a folder feels responsive right away.
- Deferred heavy image-processing initialization during gallery startup to reduce the initial blank wait before the webview appears.

### Fixed
- Restored the overview viewport rectangle in the `Image info` panel so the thumbnail once again shows which part of the image is currently visible.

## [1.10.1] - 2026-04-11
### Changed
- Replaced the gallery file type toolbar chips with a compact multi-select dropdown so the toolbar stays usable even when many formats are present.

## [1.10.0] - 2026-04-01
### Added
- Added a gallery metadata loading progress indicator to make large folder scans more transparent.

### Changed
- Refocused the extension on lightweight image metadata by removing dominant color extraction from the inspector, ICO variants, and gallery metadata updates.
- Improved gallery responsiveness with safer incremental refresh scheduling, better handling of stale async updates, and more reliable state preservation after image deletion or refresh.
- Refined gallery interactions with improved context menu placement, modifier-aware `Ctrl/Cmd + mouse wheel` thumbnail zoom, and small webview markup/style cleanups.
- Updated the package description and documentation to reflect the metadata-first behavior.

### Removed
- Removed dominant color-related settings and UI output from the inspector and gallery.

## [1.9.1] - 2026-04-01
### Added
- Added gallery toolbar comparison buttons matching the viewer tools to launch `before/after` or `side-by-side` mode directly from two selected images.

### Changed
- The gallery now preserves its sort order and active type filters between refreshes and reopenings.
- Updated gallery toolbar styling and comparison messaging so the requested compare mode opens immediately from the gallery selection.

## [1.9.0] - 2026-04-01
### Added
- Added a dedicated gallery toolbar with sorting, filtering, and bulk-selection actions.
- Added the ability to delete selected images directly from the gallery.

### Changed
- Optimized the gallery pipeline by removing the temporary binary gallery file and keeping thumbnail/metadata updates fully in memory.

## [1.8.0] - 2026-03-27
### Added
- Progressive gallery loading: images and metadata now appear as soon as available, improving perceived performance for large folders.
- CSP security: webviews now use strict Content Security Policy with dynamic nonces for scripts.
- Badge CSS and JS are now injected with correct URIs and security attributes.

### Changed
- Gallery thumbnail generation now uses larger (512x512) PNGs with transparent backgrounds for better quality.
- Improved scroll restoration: gallery scroll position is preserved and restored more reliably when switching tabs or reopening.
- Refactored gallery event listeners to avoid memory leaks and ensure single initialization.
- Improved error handling for disposed panels and binary file writing.
- Updated gallery HTML/CSS for better accessibility and maintainability.

### Fixed
- Fixed rare issues with gallery state when switching folders or rapidly opening/closing panels.


## [1.7.0] - 2026-03-19
### Added
- Added a gallery view for browsing images in a folder.


## [1.6.1] - 2026-03-16
### Fixed
- Corrected ICO variant selection: the dominant color now updates according to the selected variant in the info window.


## [1.6.0] - 2026-03-15
### Added
- Added a dedicated side-by-side comparison mode in the toolbar.
- Added visual difference detection overlays directly on compared images.
- Added difference navigation controls (previous/next) with one region displayed at a time.
- Added difference overlay target switching (`left`, `right`, `both`).
- Added optional auto-centering on the currently selected difference region.
- Added high-resolution SVG comparison samples in `test-images/diff-test-a.svg` and `test-images/diff-test-b.svg`.


## [1.5.2] - 2026-03-11
### Added
- Added two dominant color performance settings:
	- `imageInspector.dominantColorQuality` (`full` or `fast`)
	- `imageInspector.dominantColorFastSampleSize` (sample size used in fast mode).

### Changed
- Improved first paint performance by splitting metadata rendering from dominant color extraction (dominant color is now updated asynchronously after initial view render).
- Improved runtime stability by ignoring stale async render results when a newer render request is already in progress.
- Improved settings update responsiveness by applying toolbar/accent/loupe changes via incremental webview messages instead of full HTML re-render.
- Improved webview loading by serving script and style as external webview resources instead of injecting full inline file contents.
- Improved pipette startup cost by lazily initializing/rebuilding heavy pixel buffer resources when needed.
- Improved image source cache-busting strategy by switching from timestamp-based query params to file-version keys (size + mtime).
- Improved cache efficiency by adding image details caching and reusing file version info across metadata/preview flows.


## [1.5.1] - 2026-03-11
### Added
- Added icon-only comparison control buttons (pick image and split orientation) for a cleaner toolbar.
- Added direct drag interaction on the comparison divider: click and hold the divider on the image to move the split.
- Added divider double-click behavior to quickly reset split position to 50%.

### Changed
- Updated comparison controls button visuals to match the main toolbar behavior (hover/focus/active states and click halo).
- Updated comparison orientation icon rendering to switch dynamically between vertical and horizontal split states.
- Enlarged the divider hit area for easier grabbing while keeping a thin visible separation line.
- Aligned comparison divider color with the extension theme accent color.


## [1.5.0] - 2026-03-10
### Added
- Added a before/after comparison mode in the image webview with a split slider and a visual divider.
- Added comparison orientation toggle (vertical/horizontal) in comparison controls.
- Added support for selecting a comparison image from the command palette via `Image Inspector: Set Comparison Image`.
- Added dimension safety checks for comparison images (comparison requires identical width and height).
- Added `scripts/generate-color-variants.mjs` to generate subtle color-shifted test images.
- Added test image variant generation in multiple formats (`png`, `webp`, `avif`) for comparison validation.

### Changed
- Updated the comparison interaction model: pressing the toolbar compare button now clears the current comparison when one is active.
- Updated toolbar active-state styling so the compare button uses the shared theme accent color.
- Updated info toggle behavior so it remains theme-accented while the info overlay is visible.
- Updated comparison slider styling to use the theme accent color consistently across WebKit/Chromium and Firefox.
- Moved comparison controls closer to the main toolbar for tighter visual alignment.
- Renamed command label from `Image Inspector: Select Comparison Image` to `Image Inspector: Set Comparison Image`.
- Optimized extension activation by removing explicit startup activation and relying on contribution-driven lazy activation.
- Reduced repeated webview media disk reads by caching `media/imageDetails.js` and `media/imageDetails.css` content in memory.
- Reduced duplicate ICO file processing by reusing already-loaded buffers when building ICO gallery variants.
- Added bounded runtime caches for expensive image operations.
- Added a bounded converted preview cache for HEIC/HEIF/TIFF to PNG rendering.
- Added a bounded ICO entries parsing cache.
- Added a bounded ICO gallery variants cache.
- Improved cache safety by preventing in-place mutation when selecting the primary ICO entry.
- Improved toolbar visual feedback with a green halo effect when clicking a tool button.
- Updated active state color for `Zoom to selection` and `Color picker` toolbar buttons to green for visual consistency.
- Aligned the `Zoom to selection` rectangle color with the same green accent used by active toolbar tools.
- Aligned the overview minimap viewport rectangle with the same green accent for full visual consistency.
- Added a new `imageInspector.themeAccentColor` setting (`#RRGGBB`) to let users customize the shared accent color used by active tools, halo, and selection/viewport rectangles.

### Fixed
- Fixed a missing command registration for `imageInspector.showImageDetails` that could trigger `command 'imageInspector.showImageDetails' not found` when using **Image Inspector: Open with Details**.


## [1.4.1] - 2026-03-09
### Changed
- Improved image preview layout to better fill the available editor area by removing unintended lateral webview margins.
- Moved the toolbar closer to editor borders.
- Reduced the info panel width by 15px.
- Reduced vertical toolbar width by 8px for a more compact side layout.
- Added press-and-hold behavior on toolbar zoom buttons (`+` and `-`) to continuously zoom in/out while holding click.


## [1.4.0] - 2026-03-09
### Added
- Added an overview thumbnail in the info panel with a visible viewport rectangle that represents the currently visible/zoomed area.
- Added minimap interactions: click and drag on the thumbnail now recenter the main preview.


## [1.3.0] - 2026-03-06
### Added
- Color picker loupe settings are now configurable from extension settings (diameter, virtual resolution, zoom at min image zoom, zoom at max image zoom).
- Live pixel information from the color picker is now displayed in the info panel (position and color preview).

### Changed
- Refined internal webview/editor code with small, behavior-preserving cleanups (reduced duplication in event handlers and refresh timer key handling).
- Improved code readability in `media/imageDetails.js` through local helper extraction (`stopEvent`, `bindClickAction`, loupe positioning, drag end handling).
- Standardized remaining runtime French UI/comment strings to English for consistency (including selected ICO size label and related comments).
- Improved the color picker loupe visual style and rendering behavior for a clearer, more polished preview.


## [1.2.1] - 2026-02-28
### Added
- Toolbar position is now configurable: top, bottom, left, or right (vertical/horizontal orientation auto).

## [1.2.0] - 2026-02-28
### Added
- Color picker tool in the image details view.

## [1.1.1] - 2026-02-28
### Changed
- Improved update of the information window display.

## [1.1.0] - 2026-02-28
### Added
- Automatic refresh of the view when the image file is modified.

## [1.0.0] - 2026-02-28
### Added
- Initial release of ImageInspector VS Code extension.
- Image metadata display: dimensions, size, format, color space, alpha, dominant color.
- Integrated webview for image preview and details.
- Advanced zoom features (toolbar, selection, keyboard shortcuts).
- Project documentation (README, structure, usage instructions).
