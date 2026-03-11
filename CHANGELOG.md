# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).


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
