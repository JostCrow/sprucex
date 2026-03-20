# SpruceX

Reactive HTML with a tiny ego.

SpruceX is a lightweight JavaScript micro-framework that blends:
- Alpine-style declarative reactivity
- HTMX-style network actions
- Practical extras (stores, local persistence, lazy init, morphing, animation)

If you like shipping features straight from markup, this is your playground.

> SpruceX is not complete yet and remains in active development. The `1.0.0`
> release line is being prepared now, so APIs, docs, and examples may continue
> to evolve.

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

SpruceX ships in two formats:
- browser bundle: `public/dist/sprucex.js` or `public/dist/sprucex.min.js`
- package entrypoints: `lib/sprucex.mjs`, `lib/sprucex.cjs`, and `lib/sprucex.d.ts`

For script-tag usage, include the browser bundle and use the global `SpruceX` object.
For package usage, import the built library entrypoint exposed by `package.json`.

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
- Machine-readable reference: `public/LLM.txt`
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

## Status

Current release target in `package.json`: `1.0.0`

SpruceX is still in active development and is not complete yet. Use the docs
site, `public/LLM.txt`, and `CHANGELOG.md` as the current source of truth for
what is implemented.

## License

MIT. See `LICENSE`.
