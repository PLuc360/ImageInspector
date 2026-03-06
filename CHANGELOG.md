# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).


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
