# SpruceX

Reactive HTML with a tiny ego.

SpruceX is a lightweight JavaScript micro-framework that blends:
- Alpine-style declarative reactivity
- HTMX-style network actions
- Practical extras (stores, local persistence, lazy init, morphing, animation)

If you like shipping features straight from markup, this is your playground.

## Why SpruceX?

Because sometimes you want:
- less setup than a full SPA framework
- more power than vanilla DOM scripts
- an API you can read directly in your HTML

SpruceX uses `sx-*` attributes so components stay close to the markup they control.

## Quick Start (Local File)

```html
<script src="/dist/sprucex.js"></script>

<div sx-data="{ count: 0 }">
  <button sx-on:click="count++">+1</button>
  <span sx-text="count"></span>
</div>
```

SpruceX auto-initializes on `DOMContentLoaded`.

## Get SpruceX

SpruceX is not on npm yet.

Use one of these distribution options:
- grab `sprucex.js` or `sprucex.min.js` from this repository (`public/dist/`)
- grab the hosted file from the SpruceX website

Then include the file in your app and use the global `SpruceX` object.

## Basic API

```html
<script src="/dist/sprucex.js"></script>
<script>
  SpruceX.store("cart", { items: [] }, { persist: true });
  SpruceX.init(); // optional (auto-init runs by default)
</script>
```

Handy expression globals:
- `$event`
- `$refs`
- `$store(name)`
- `$emit(name, detail)`
- `$index` (inside `sx-for`)

## Integration Plugins

SpruceX supports integration plugins through `SpruceX.integration(...)`.

```html
<script>
  SpruceX.integration("my-widget", {
    scan(component, el) {
      const expr = el.getAttribute("sx-my-widget");
      if (!expr) return;
      if (!component._myWidgetBindings) component._myWidgetBindings = [];
      component._myWidgetBindings.push({ el, expr });
    },
    update(component) {
      const bindings = component._myWidgetBindings || [];
      bindings.forEach(({ el, expr }) => {
        // evaluate through component scope
        const value = component.evaluateExpressionOrLiteral(expr);
        el.textContent = String(value ?? "");
      });
    },
    teardown(component) {
      component._myWidgetBindings = [];
    },
  });
</script>
```

Plugin hooks:
- `setup(component)` optional one-time setup per component instance
- `scan(component, el)` collect integration bindings while SpruceX scans markup
- `update(component)` run on initial render and reactive updates
- `teardown(component)` cleanup on refresh/destroy

## Feature Tour

Core UI:
- `sx-data`, `sx-text`, `sx-html`, `sx-show`
- `sx-bind:*`, `sx-class`, `sx-toggle`, `sx-error-fallback`
- `sx-on:*` with modifiers (`.prevent`, `.stop`, `.self`, key modifiers)
- `sx-model` with modifiers (`.trim`, `.number`, `.lazy`, `.debounce-ms`)
- `sx-for`, `sx-memo`, `sx-ref`

Network layer:
- `sx-get`, `sx-post`, `sx-put`, `sx-delete`
- `sx-target`, `sx-swap`, `sx-vars`, `sx-json-into`
- `sx-body`, `sx-body-type`, `sx-headers`
- `sx-loading-into`, `sx-error-into`
- `sx-disable-while-request`, `sx-text-while-request`, `sx-confirm`
- `sx-optimistic`, `sx-revert-on-error`
- `sx-poll`, `sx-poll-while`, `sx-include`

State + lifecycle:
- Global stores via `SpruceX.store(...)`
- Local component persistence via `sx-local`
- Lazy component init via `sx-lazy`
- Boot hook via `window.SpruceXBoot.initTheme`

Power directives:
- `sx-page`, `sx-boost`, `sx-boost-on` (navigation + progressive enhancement)
- `sx-animate` (with `@formkit/auto-animate`)
- `sx-chart` (Chart.js integration)
- `sx-gridstack` (GridStack integration)

## Development

### Requirements
- Bun (used for library builds)
- Node.js (for Astro dev/build workflow)

### Scripts

```bash
# install deps
bun install

# docs/dev site
bun run dev

# build library + Astro site
bun run build

# preview production build
bun run preview

# watch only library bundle
bun run dev:lib
```

## Project Structure

```text
src/
  core/          # component internals
  store/         # global store implementation
  utils/         # helpers, eval, dom, morph, animations
  pages/         # Astro docs/examples pages
  fragments/     # example markup used in docs
public/
  dist/          # browser bundles (sprucex.js, sprucex.min.js)
  llm-docs.md    # full directive/API docs
```

## Docs

- Interactive docs/examples live in the Astro site (`bun run dev`)
- Extended reference: `public/llm-docs.md`
- Release notes: `CHANGELOG.md`

## Contributing

PRs and issues are welcome.

Good starter contributions:
- examples that cover edge cases
- bugfixes with small reproducible demos
- docs improvements for directive behavior

If you open a PR, please include:
- what changed
- why it changed
- how you tested it

## Version

Current version in `package.json`: `0.4.0`

Recent improvements include deep reactivity, batched updates, memo/function caching, and memory leak fixes.

## License

MIT. See `LICENSE`.
