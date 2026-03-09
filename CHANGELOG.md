# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).


## [Unreleased]
### Changed
- Optimized extension activation by removing explicit startup activation and relying on contribution-driven lazy activation.
- Reduced repeated webview media disk reads by caching `media/imageDetails.js` and `media/imageDetails.css` content in memory.
- Reduced duplicate ICO file processing by reusing already-loaded buffers when building ICO gallery variants.
- Added bounded runtime caches for expensive image operations.
- Added a bounded converted preview cache for HEIC/HEIF/TIFF to PNG rendering.
- Added a bounded ICO entries parsing cache.
- Added a bounded ICO gallery variants cache.
- Improved cache safety by preventing in-place mutation when selecting the primary ICO entry.


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
