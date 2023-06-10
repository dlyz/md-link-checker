# Markdown Link Checker

> :exclamation: There are no plans to continue to evolve this extension.
> Consider moving
> to [VSCode embedded link validation](https://code.visualstudio.com/docs/languages/markdown#_link-validation)
> for local link validation
> and to [blackmist.LinkCheckMD](https://marketplace.visualstudio.com/items?itemName=blackmist.LinkCheckMD)
> for external link validation.

![example](https://github.com/dlyz/md-link-checker/raw/main/example.png)

Features:

- http/https link validation
  - basic/bearer authorization support
- local files link validation
  - heading link validation support (including cross-document links)
  - live recheck of cross-document links support when linked document changes in the editor
  - quick fixes for wrong heading links
- reference links:
  - validation
  - renaming
  - inline link extraction as a reference link (through inline link address renaming)
- live recheck support when document changes in the editor
- caching of link check results (configurable, 5 min by default)

Useful commands:

- `Markdown Link Checker: Recheck current document` (`Alt+L`) - resets caches for current document and rechecks all the links.
- `Markdown Link Checker: Recheck opened documents` (`Shift+Alt+L`) - resets caches for all opened documents and rechecks all the links.
- `Markdown Link Checker: Manage host credentials` - allows to forget saved authorization credentials.
