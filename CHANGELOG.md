# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per host authorization credentials

### Changed

- `link-check` replaced with custom implementation on top of `node-fetch`.

### Fixed

- False-positive `CERT_HAS_EXPIRED` case handled explicitly.
  Added suggestion user based on <https://github.com/microsoft/vscode/issues/136787#issuecomment-969065291>.

## [0.0.2] - 2021-12-28

### Added

- http/https links results caching, can be configured with `mdLinkChecker.cacheTtl`

### Changed

- `broken-link` library replaced with `link-check`

## [0.0.1] - 2021-12-27

- Initial release

[Unreleased]: https://github.com/dlyz/md-link-checker/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/dlyz/md-link-checker/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/dlyz/md-link-checker/releases/tag/v0.0.1
