# Markdown Link Checker

![example](https://github.com/dlyz/md-link-checker/raw/main/example.png)

Features:

- http/https link validation
  - basic/bearer authorization support
- local files link validation
  - heading link validation support (including cross-document links)
  - live recheck of cross-document links support when linked document changes in the editor
- reference link validation
- live recheck support when document changes in the editor
- caching of link check results (configurable, 5 min by default)

Useful commands:

- `Markdown Link Checker: Recheck current document` (`Alt+L`) - resets caches for current document and rechecks all the links.
- `Markdown Link Checker: Recheck opened documents` (`Shift+Alt+L`) - resets caches for all opened documents and rechecks all the links.
- `Markdown Link Checker: Manage host credentials` - allows to forget saved authorization credentials.
