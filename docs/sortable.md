# Optional accessible sorting

Register once before mounting, or after loading SpruceX (registration refreshes mounted components):

```js
import SpruceX, { createSortableIntegration, createNativeSortableAdapter } from 'sprucex';
SpruceX.integration('sortable', createSortableIntegration({
  adapter: createNativeSortableAdapter(), // omit for buttons/keyboard only
}));
```

The factories are also available on `window.SpruceX` in script-tag builds. No external dependency, framework, or Gridstack registration change is required. The integration is inactive until explicitly registered. One factory instance defines a container/group namespace; register it under `sortable` once.

```html
<div sx-data="{rows:[{id:'revenue',label:'Revenue'},{id:'cost',label:'Cost'}]}">
  <div sx-sortable="{items:rows, containerId:'metrics', group:'dashboard'}">
    <template sx-for="row in rows" sx-key="row.id">
      <section sx-bind:sx-sortable-item="row.id">
        <h2 sx-text="row.label"></h2>
        <button type="button" sx-sortable-handle
          sx-bind:aria-label="'Move '+row.label"
          aria-describedby="move-help">Move</button>
        <button type="button" sx-sortable-move="up"
          sx-bind:aria-label="'Move '+row.label+' up'">Up</button>
        <button type="button" sx-sortable-move="down"
          sx-bind:aria-label="'Move '+row.label+' down'">Down</button>
      </section>
    </template>
  </div>
  <p id="move-help">Use Alt+Up or Alt+Down on Move, or activate Up and Down.</p>
</div>
```

See the working [plain JavaScript example](../public/examples/sortable.html). Serve the repository's `public` directory after `bun run build:lib` to try it.

## Model and markup contract

`sx-sortable` evaluates to `{items, containerId, id?, group?, disabled?}` in the current component/row scope. `items` must be the mutable reactive source array used by the contained `sx-for`, not a filtered/copy expression. Rows must have one direct element root, a stable `sx-key`, and `sx-sortable-item` bound to that item's ID. No DOM order is copied back into state. Moves splice the original array and let `sx-for` render; other application consumers see the same source. Existing APIs and all unregistered behavior are unchanged.

`id` is the item property name (default `id`). IDs must be unique string/number values within each array, compared and emitted as strings (so `1` and `'1'` collide). `containerId` is a nonempty string unique among connected containers in this registration. IDs should remain stable when items move. `disabled: true` rejects every move. Duplicate/missing IDs, duplicate containers, invalid indices and no-op moves are rejected without events.

Cross-container moves require matching nonempty `group` values, distinct arrays, compatible ID properties on the transferred item, and no duplicate item ID in the destination. The item moves between source arrays, and may get a new DOM node there. A native button with `sx-sortable-move="down" sx-sortable-to="destinationId"` appends its row to that destination; this also works with Enter/Space and touch activation. Destinations must be mounted. No grouping by BI-specific models exists. For nested lists, use unique container IDs and a separate source array per container. Parent handlers ignore nested sortable containers and nested `sx-data` roots.

## Accessibility and input

Use native, labeled `button type="button"` elements. Alt+ArrowUp/ArrowDown on `sx-sortable-handle` immediately moves one position within the list. Up/Down buttons immediately move on activation; they remain usable at the boundaries, where activation is a no-op. Ordinary arrows and other form controls are unaffected. There is no grabbed/pickup mode, and Escape does not undo a completed move. Cancel before committing through the event below.

The integration supplies a visually hidden polite status announcement with ID, new position, total count and destination. Focus on a move control is restored by stable item ID and control ordinal after rendering, including cross-container moves; destination rows must use the same control structure. Keyed moves within a container preserve row identity. This is focus/announcement behavior tested in browsers, not a claim of a full assistive-technology audit.

`createNativeSortableAdapter()` enables HTML Drag and Drop on handles, dropping at the target row's array index (or appending on container background). It does not reorder DOM directly. Desktop mouse/trackpad dragging is supported. Touch dragging depends on browser HTML DnD support and is not guaranteed; native move buttons are the supported touch path. No pointer sensor, animation, autoscroll, drag preview, or touch gesture engine is bundled. A drag abandoned outside a container makes no model change.

## Events and cancellation

The source container dispatches bubbling `sprucex:sortable:before` (cancelable) and, after synchronous model mutation, `sprucex:sortable:change` (not cancelable). DOM rendering follows on the normal scheduled frame. Both carry this readonly detail:

```js
{ itemId: 'revenue', oldIndex: 0, newIndex: 1,
  fromContainerId: 'metrics', toContainerId: 'metrics', input: 'keyboard' }
```

Indices are zero-based source/destination array positions; `newIndex` is the final position after removal. `input` is `keyboard`, `pointer`, or `api`; native click events with detail zero (including assistive activation) are classified as keyboard. There is no original DOM event in detail. Read the source arrays for the full current order, rather than maintaining a second list. Use an event listener for persistence or application callbacks:

```js
container.addEventListener('sprucex:sortable:before', event => {
  if (!mayMove(event.detail)) event.preventDefault();
});
container.addEventListener('sprucex:sortable:change', event => saveOrder(event.detail));
```

Cancellation leaves model, focus and status unchanged. Before listeners should validate rather than mutate lists; changes to either array during validation abort the pending move. Nested/reentrant move requests during dispatch are rejected. Persistence failures after change are the application's responsibility.

## External adapters

An optional adapter is a function receiving `{el, items(), containerId(), move(itemId, destinationId, newIndex, input?)}`. It returns `{destroy(), update?()}`. `move` returns a boolean and performs the same validation, cancellation, source-array mutation, scheduling, focus and event behavior as keyboard controls; `input` defaults to `api`. `items()` returns the current direct row elements, so adapters must read it afresh. The native adapter factory shares active-drag context across containers in one registration.

Adapters must route gestures to `move`, avoid moving source DOM themselves, install listeners once, reconcile dynamic handles in `update`, and remove every listener/observer/library instance in `destroy`. `update` runs after rendering; `destroy` runs on refresh, removal/rebind and component teardown. A retained context becomes inert after disposal. Fragment morph hydration uses the existing integration teardown/rescan lifecycle. This is the same registration/lifecycle pattern used by built-in Gridstack; no changes to Gridstack options or behavior are needed.
