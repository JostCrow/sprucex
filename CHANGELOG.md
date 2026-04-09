# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-04-08

### Added

- Support for nested `sx-data` roots rendered inside `sx-for` rows, including row-local scope access and lifecycle management.
- Runtime tests covering nested row scopes, keyed reorder DOM identity retention, and teardown of removed nested row components.

### Changed

- `sx-for` now supports explicit keyed reconciliation via `sx-key` on loop templates to preserve row DOM identity during reorder operations.

### Fixed

- `sx-for` row disposal now tears down nested `sx-data` components before removing row nodes to prevent stale effects/bindings.

### Removed

- Built-in Chart.js integration registration (`sx-chart`, `sx-chart-type`, `sx-chart-options`). Chart behavior should now be provided through custom plugins via `SpruceX.integration(...)`.

## [1.0.0] - 2026-03-19

### Added

- First stable release of SpruceX
- Reactive HTML directives including `sx-data`, `sx-text`, `sx-html`, `sx-show`, `sx-bind:*`, `sx-class`, `sx-toggle`, `sx-model`, `sx-ref`, `sx-for`, and `sx-memo`
- HTMX-style request directives including `sx-get`, `sx-post`, `sx-put`, `sx-delete`, `sx-trigger`, `sx-target`, `sx-swap`, `sx-vars`, `sx-body`, `sx-body-type`, `sx-headers`, `sx-json-into`, `sx-loading-into`, `sx-error-into`, `sx-disable-while-request`, `sx-text-while-request`, `sx-confirm`, `sx-optimistic`, `sx-revert-on-error`, `sx-poll`, and `sx-include`
- State and lifecycle utilities including `SpruceX.store(...)`, `sx-local`, `sx-lazy`, `sx-init-data`, watchers, and `window.SpruceXBoot.initTheme`
- Navigation and DOM utilities including `sx-page`, `sx-boost`, `sx-boost-on`, `sx-key`, `sx-preserve`, `SpruceX.navigate(...)`, `SpruceX.prefetch(...)`, and `SpruceX.morph(...)`
- Integration APIs via `SpruceX.integration(...)` and `SpruceX.data(...)`
- Built-in integration support for `sx-animate`, `sx-chart`, and `sx-gridstack`
- Project website documentation, machine-readable `LLM.txt`, and packaged browser/module builds

### Changed

- Release documentation aligned around the `1.0.0` package version
- `README.md` now reflects active development status and points to the website docs, `LLM.txt`, and changelog as the current sources of truth
