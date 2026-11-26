# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-11-26

### Added

- Fine-grained dependency tracking (`SpruceX.effect()`, `SpruceX.stop()`, `SpruceX.computed()`) and automatic memoization of own read-only state getters.
- Large-dataset and built-in object safety: `SpruceX.markRaw()`, `SpruceX.toRaw()`, `SpruceX.shallow()`, and `sx-json-into.shallow` keep large datasets or external instances unproxied; built-in objects (`Date`, `Map`, `Set`, `TypedArray`, DOM nodes, custom class instances) are no longer wrapped in a Proxy.
- Element-scoped custom directives via `SpruceX.directive(name, (el, ctx) => ...)` with per-element reactive `effect()`, `cleanup()`, `evaluate()`, and `modifiers` that survive unrelated state changes and untouched partial HTML swaps.
- New core directives: `<template sx-if="...">`, `sx-cloak`, `sx-style`, `sx-init`, and `sx-effect`.
- New expression magics: `$el`, `$nextTick`, `$dispatch`, and `$parent` (also accessible via `this.$refs`, `this.$el`, `this.$parent`, and `this.$nextTick` inside `sx-data` methods and lifecycle hooks).
- New event modifiers: `.once`, `.outside`, `.debounce.<ms>`, `.throttle.<ms>`, `.passive`, `.capture`, plus full keyboard combination support (`.ctrl.enter`, `.meta.k`, `.esc`, `.space`, arrow aliases).
- `sx-model` support for `<select multiple>`, `.boolean`, and `.debounce.<ms>`.
- Network upgrades: `sx-patch`, `sx-params`, `sx-select`, `sx-swap="none" | "delete"`, `sx-push-url`, `sx-replace-url`, cross-component `sx-trigger="event from:window|document|#selector"`, visibility-aware `sx-poll` (opt-out with `sx-poll-background`), and typed `SpruceX.config()` hooks (`baseUrl`, `headers`, `credentials`, `csrfHeaderName`, `beforeRequest`, `afterResponse`, `csp`, `viewTransitions`).
- Scoped initialization and Shadow DOM / embed support: `SpruceX.init(root)`, `SpruceX.mount(el)`, `SpruceX.unmount(el)`, `SpruceX.inspect(root)`, `SpruceX.nextTick()`, and optional `window.SpruceXBoot.autoInit = false`.
- Strict-CSP fallback evaluator (`SpruceX.config({ csp: true })`) and fast-path simple property evaluation.
- Persistent store cross-tab sync option (`SpruceX.store(name, data, { persist: true, syncTabs: true })`).
- Tree-shakeable package subpath exports: `sprucex/core`, `sprucex/sortable`, and `sprucex/gridstack`.
- Page navigation improvements: aborting superseded fetches, scroll position restoration on `popstate`, `sx-page-ignore` / `sx-boost="false"` link opt-out, and optional View Transitions API (`sx-page-transition`).
- Redesigned documentation site with live directive filtering, hero playground, and 5 new interactive example sections (including a live SVG chart custom directive, auto-memoized BI getters, and Shadow DOM embed demo).

### Changed

- Split monolithic `src/core/component.js` into modular `src/directives/*`, `src/core/network.js`, `src/core/runtime.js`, and `src/integrations/gridstack.js`.
- Added no-op DOM write guards across bindings (`sx-text`, `sx-html`, `sx-show`, `sx-bind:*`, `sx-class`, `sx-style`, `sx-model`), batched `localStorage` persistence per microtask, lazy event delegation, single-pass scanning, and $O(n)$ `morphChildren` reconciliation.
- Integrations supporting `preserveOnSwap` / `unmount(component, el)` (including GridStack and Sortable) now preserve untouched widget instances during partial HTML swaps.

### Fixed

- `sx-error-into` and `sprucex:error` now include HTTP `status` and parsed error response `body`.
- `sx-bind:aria-*` and enumerated boolean attributes now serialize `false` as `"false"` instead of removing the attribute; `sx-bind:value` / `checked` / `indeterminate` sync live DOM properties.
- `sx-show` preserves existing inline `display` values instead of overwriting them with an empty string.
- `sx-model.number` preserves empty strings instead of coercing `""` to `0`.
- `sx-vars` URL interpolation now encodes interpolated values with `encodeURIComponent`.
- Path-aware watchers prevent identically named nested properties from falsely firing top-level watchers and support dotted paths (e.g. `'user.name'`).
- Restored `e.stopPropagation` after delegated event dispatch and guarded browser globals for SSR import safety.

## [1.1.0] - 2026-11-09

### Added

- Opt-in sortable integration via `createSortableIntegration()`, available as a named package export and on `SpruceX`. Register it with `SpruceX.integration('sortable', …)` to enable sorting in keyed `sx-for` lists.
- Source-array reordering and transfers between containers with matching groups, with validation for stable item IDs, destinations, disabled containers, and no-op moves.
- Native move buttons, Alt+ArrowUp/ArrowDown shortcuts, polite status announcements, and focus restoration after moves, including transfers between containers.
- Cancelable `sprucex:sortable:before` and post-move `sprucex:sortable:change` events for validation and persistence hooks.
- Optional `createNativeSortableAdapter()` for desktop HTML drag and drop, plus an adapter API for custom input integrations. Native move buttons provide the supported touch path.
- TypeScript declarations, sortable API and accessibility documentation, a runnable plain JavaScript example, and unit, lifecycle, and browser regression coverage.

The sortable integration is inactive until registered and adds no runtime dependencies. See [the sortable guide](docs/sortable.md) for markup requirements, adapter lifecycle, and accessibility limitations.

## [1.0.3] - 2026-09-24

### Fixed

- HTML request swaps initialize new directives and nested components while retaining existing component state.
- Loop rows support network actions, toggles, references, and integration plugins through the same directive scanner as ordinary markup.
- Removed rows dispose model and global event listeners, debounced writes, polling, and pending requests.
- `.window` and `.document` event modifiers attach to the correct event targets.
- Deep reactivity preserves shared object identity and cycles without rewriting raw objects.
- Unchanged keyed rows no longer move in the DOM, and reordering preserves focused inputs and text selection.
- TypeScript supports typed factory parameters, plugin component helpers, and separate ESM/CommonJS declaration entrypoints.
- Corrected debounce examples and added executable checks for them.

### Added

- Regression tests for directive combinations, repeated cleanup, all HTML swap modes, and strict TypeScript consumers.
- Chromium, Firefox, and WebKit tests for both browser bundles.
- CI validation, package consumer checks, and build/test gates before packing and publishing.

### Changed

- Astro and Tailwind are development dependencies; installing SpruceX no longer installs the documentation build tools.

## [1.0.2] - 2026-09-24

### Fixed

- `sx-for` loops now render correctly after component refreshes by restoring loop templates before rescanning the component.
- Moving keyed rows no longer destroys their nested components or event handlers during automatic cleanup.
- Reused row components receive updated loop items and indices while retaining their local state.
- Named data factories inside loop rows can use loop variables as arguments.
- Overlapping requests only cancel the previous request when `sx-cancel-previous` is enabled; stale responses still cannot overwrite newer state.
- Page links and prefetch URLs resolve against the document base, including nested paths and `<base>` elements.
- Package builds provide the default export advertised by the TypeScript declarations, and the declarations include `removeStore`.
- Component destruction is idempotent, and destroyed components cannot schedule new renders.

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
