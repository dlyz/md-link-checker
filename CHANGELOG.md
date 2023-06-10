# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2023-06-10

### Added

- Quick fixes for wrong heading links.
- `[[_TOC_]]` now excluded from the validation.

### Changes

- Update markdown grammar.

### Fixed

- Extension logo transparency removed to be visible in dark themes.

## [0.3.0] - 2022-01-11

### Added

- Reference link renaming.
- Inline link extraction as a reference link (through inline link address renaming).

## [0.2.0] - 2022-01-09

### Added

- Reference link validation.

## [0.1.1] - 2022-01-08

### Fixed

- Complex heading processing (for example heading with inlined code segments).
- Local heading changes handling.
- Links recheck on linked files rename.

## [0.1.0] - 2021-12-31

### Added

- Command to recheck links in the active document.
- Command to recheck links in all opened documents.
- Auto-recheck for links to other local changing documents.

## [0.0.3] - 2021-12-30

### Added

- Per host authorization credentials.

### Changed

- `link-check` replaced with custom implementation on top of `node-fetch`.

### Fixed

- False-positive `CERT_HAS_EXPIRED` case handled explicitly.
  Added suggestion user based on <https://github.com/microsoft/vscode/issues/136787#issuecomment-969065291>.

## [0.0.2] - 2021-12-28

### Added

- http/https links results caching, can be configured with `mdLinkChecker.cacheTtl`.

### Changed

- `broken-link` library replaced with `link-check`.

## [0.0.1] - 2021-12-27

- Initial release.

[Unreleased]: https://github.com/dlyz/md-link-checker/compare/v0.3.0...HEAD
[0.4.0]: https://github.com/dlyz/md-link-checker/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dlyz/md-link-checker/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dlyz/md-link-checker/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/dlyz/md-link-checker/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dlyz/md-link-checker/compare/v0.0.3...v0.1.0
[0.0.3]: https://github.com/dlyz/md-link-checker/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/dlyz/md-link-checker/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/dlyz/md-link-checker/releases/tag/v0.0.1
