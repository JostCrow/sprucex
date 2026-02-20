# SpruceX v0.4 - LLM Documentation

## Overview

SpruceX is a lightweight reactive JavaScript micro-framework combining Alpine.js-style declarative bindings with HTMX-style network requests. It uses `sx-*` attributes on HTML elements to create reactive components without writing JavaScript.

## Quick Start

```html
<script src="sprucex.js"></script>

<div sx-data="{ count: 0 }">
  <button sx-on:click="count++">Increment</button>
  <span sx-text="count"></span>
</div>
```

SpruceX auto-initializes on DOMContentLoaded. Manual init: `SpruceX.init()`.

---

## Core Concepts

### Component Root: `sx-data`

Defines a reactive component scope. Value is a JavaScript object expression.

```html
<div sx-data="{ name: 'John', age: 30, items: [1, 2, 3] }">
  <!-- All sx-* bindings inside have access to name, age, items -->
</div>
```

**With methods and lifecycle hooks:**

```html
<div sx-data="{
  count: 0,
  increment() { this.count++ },
  init() { console.log('Component initialized') },
  mounted() { console.log('Component mounted to DOM') },
  destroyed() { console.log('Component destroyed') }
}">
  <button sx-on:click="increment()">+</button>
</div>
```

**Lifecycle hooks:**
- `init()` - Called immediately after state initialization
- `mounted()` - Called after first render (via microtask)
- `destroyed()` - Called when `component.destroy()` is invoked

### Reactivity

State is deeply reactive. Changing any property (including nested) triggers re-render:

```html
<div sx-data="{ user: { profile: { name: 'John' } } }">
  <span sx-text="user.profile.name"></span>
  <button sx-on:click="user.profile.name = 'Jane'">Change</button>
</div>
```

Array mutations (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`) are also reactive.

---

## Text & HTML Binding

### `sx-text`

Sets element's `textContent`. Objects are JSON-stringified.

```html
<span sx-text="message"></span>
<span sx-text="items.length + ' items'"></span>
<span sx-text="user.name.toUpperCase()"></span>
```

### `sx-html`

Sets element's `innerHTML`. Use for trusted HTML only.

```html
<div sx-html="richContent"></div>
```

### `sx-error-fallback`

Fallback expression if primary expression throws:

```html
<span sx-text="riskyComputation()" sx-error-fallback="'Error occurred'"></span>
```

---

## Conditional Display

### `sx-show`

Toggles `display: none` based on truthiness:

```html
<div sx-show="isVisible">Visible when isVisible is truthy</div>
<div sx-show="items.length > 0">Has items</div>
<div sx-show="user && user.isAdmin">Admin only</div>
```

### `sx-toggle`

Shorthand: clicking element toggles a boolean property:

```html
<button sx-toggle="isOpen">Toggle Menu</button>
<div sx-show="isOpen">Menu content</div>
```

---

## Attribute Binding

### `sx-bind:<attr>`

Dynamically bind any attribute. `false`/`null`/`undefined` removes the attribute.

```html
<input sx-bind:disabled="isLoading">
<img sx-bind:src="imageUrl">
<a sx-bind:href="'/users/' + userId">Profile</a>
<button sx-bind:aria-pressed="isActive">Toggle</button>
```

**Multiple bindings:**

```html
<input
  sx-bind:disabled="isLoading"
  sx-bind:placeholder="isLoading ? 'Loading...' : 'Enter text'"
  sx-bind:class="inputClass">
```

---

## Class Binding

### `sx-class`

Dynamically manage CSS classes. Preserves original classes from HTML.

**Object syntax (recommended):**

```html
<div class="base-class" sx-class="{ active: isActive, 'text-red': hasError }">
  <!-- 'base-class' always present, 'active' and 'text-red' toggled -->
</div>
```

**String syntax:**

```html
<div sx-class="isLarge ? 'text-lg p-4' : 'text-sm p-2'"></div>
```

---

## Event Handling

### `sx-on:<event>`

Listen to DOM events. Expression is executed (not evaluated).

```html
<button sx-on:click="count++">Increment</button>
<button sx-on:click="handleClick()">Click Me</button>
<input sx-on:input="search = $event.target.value">
<form sx-on:submit="handleSubmit()">...</form>
```

**Event modifiers (chainable):**

| Modifier | Effect |
|----------|--------|
| `.prevent` | `event.preventDefault()` |
| `.stop` | `event.stopPropagation()` |
| `.self` | Only trigger if `event.target === event.currentTarget` |

```html
<form sx-on:submit.prevent="save()">
  <button sx-on:click.stop="doSomething()">Click</button>
</form>
<div sx-on:click.self="onlyWhenClickedDirectly()">
  <button>This won't trigger parent</button>
</div>
```

**Keyboard modifiers:**

```html
<input sx-on:keydown.enter="submit()">
<input sx-on:keyup.escape="cancel()">
<input sx-on:keydown.enter.prevent="submitWithoutFormSubmit()">
```

**Special variables in handlers:**
- `$event` - The native DOM event
- `$refs` - Object of elements with `sx-ref`
- `$emit` - Function to emit custom events
- `$store(name)` - Access global stores

---

## Two-Way Binding

### `sx-model`

Binds form input value to state property bidirectionally.

```html
<input type="text" sx-model="username">
<textarea sx-model="bio"></textarea>
<select sx-model="selectedOption">
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```

**Checkbox (boolean):**

```html
<input type="checkbox" sx-model="isAgreed">
```

**Checkbox (array of values):**

```html
<div sx-data="{ selected: [] }">
  <input type="checkbox" sx-model="selected" value="apple"> Apple
  <input type="checkbox" sx-model="selected" value="banana"> Banana
  <!-- selected becomes ['apple', 'banana'] when both checked -->
</div>
```

**Radio buttons:**

```html
<div sx-data="{ color: 'red' }">
  <input type="radio" sx-model="color" value="red"> Red
  <input type="radio" sx-model="color" value="blue"> Blue
</div>
```

**Modifiers:**

| Modifier | Effect |
|----------|--------|
| `.number` | Cast to number |
| `.trim` | Trim whitespace |
| `.lazy` | Sync on `change` instead of `input` |
| `.debounce-ms="N"` | Debounce updates by N milliseconds |

```html
<input type="number" sx-model.number="age">
<input sx-model.trim="name">
<input sx-model.lazy="notes">
<input sx-model.debounce-ms="300" sx-model.debounce-ms="300">
```

**Combined modifiers:**

```html
<input sx-model.number.lazy="price">
```

---

## Loops

### `sx-for`

Iterate over arrays. Must be on a `<template>` element.

```html
<ul sx-data="{ items: ['Apple', 'Banana', 'Cherry'] }">
  <template sx-for="item in items">
    <li sx-text="item"></li>
  </template>
</ul>
```

**With index:**

```html
<template sx-for="(item, index) in items">
  <li>
    <span sx-text="index + 1"></span>.
    <span sx-text="item"></span>
  </li>
</template>
```

**With objects:**

```html
<div sx-data="{ users: [{ name: 'John', age: 30 }, { name: 'Jane', age: 25 }] }">
  <template sx-for="user in users">
    <div>
      <span sx-text="user.name"></span> - <span sx-text="user.age"></span>
    </div>
  </template>
</div>
```

**Event handlers in loops have access to loop variables:**

```html
<template sx-for="(item, i) in items">
  <button sx-on:click="removeItem(i)" sx-text="'Remove ' + item"></button>
</template>
```

**Default index variable:** `$index` (when not destructured)

```html
<template sx-for="item in items">
  <span sx-text="$index"></span>
</template>
```

---

## Memoization

### `sx-memo`

Cache expensive computations. Only re-evaluates when specified dependencies change.

```html
<div sx-data="{
  a: 10,
  b: 20,
  c: 30,
  expensive(x, y) {
    // Simulated expensive computation
    return x * y;
  }
}">
  <input type="number" sx-model.number="a">
  <input type="number" sx-model.number="b">
  <input type="number" sx-model.number="c">

  <!-- Only recomputes when 'a' or 'b' change, not 'c' -->
  <span sx-text="expensive(a, b)" sx-memo="['a', 'b']"></span>
</div>
```

`sx-memo` takes an array of dependency names (state property keys).

---

## References

### `sx-ref`

Create references to DOM elements accessible via `$refs`.

```html
<div sx-data="{ focusInput() { $refs.myInput.focus() } }">
  <input sx-ref="myInput" type="text">
  <button sx-on:click="focusInput()">Focus Input</button>
</div>
```

---

## Global Stores

Share state across components.

**Define a store:**

```html
<script>
  SpruceX.store('user', {
    name: 'John',
    isLoggedIn: false,
    login() { this.isLoggedIn = true }
  });
</script>
```

**Access in components:**

```html
<div sx-data="{}">
  <span sx-text="$store('user').name"></span>
  <button sx-on:click="$store('user').login()">Login</button>
</div>
```

**Persistent store (localStorage):**

```javascript
SpruceX.store('settings', { theme: 'dark' }, { persist: true });
```

---

## Local Persistence

### `sx-local`

Persist component state to localStorage.

```html
<div sx-data="{ count: 0 }" sx-local="my-counter">
  <!-- count persists across page reloads -->
  <button sx-on:click="count++">Count: <span sx-text="count"></span></button>
</div>
```

---

## Lazy Initialization

### `sx-lazy`

Defer component initialization until element enters viewport.

```html
<div sx-data="{ items: fetchHeavyData() }" sx-lazy>
  <!-- Only initializes when scrolled into view -->
</div>
```

---

## Auto-Animate

### `sx-animate`

Automatically animate child elements when they are added, removed, or moved. Requires the [@formkit/auto-animate](https://auto-animate.formkit.com/) library. Place on the parent element containing an `sx-for` loop.

**Installation (required):**

```html
<script src="https://cdn.jsdelivr.net/npm/@formkit/auto-animate@0.8.2/index.min.js"></script>
```

If the library is not loaded, SpruceX will show a console warning.

**Basic usage:**

```html
<ul sx-data="{ items: ['A', 'B', 'C'] }" sx-animate>
  <template sx-for="item in items">
    <li sx-text="item"></li>
  </template>
</ul>
```

**With configuration (duration in ms):**

```html
<ul sx-animate="300">
  <!-- ... -->
</ul>
```

**Full configuration (JSON):**

```html
<ul sx-animate='{"duration": 300, "easing": "ease-in-out"}'>
  <!-- ... -->
</ul>
```

**Configuration options:**

| Option | Default | Description |
|--------|---------|-------------|
| `duration` | `250` | Animation duration in milliseconds |
| `easing` | `"ease-out"` | CSS easing function |

**Animations triggered:**
- **Add**: New items fade in with scale effect
- **Remove**: Items fade out with scale effect
- **Move**: Items smoothly transition to new positions (FLIP technique)

**JavaScript API:**

```javascript
// Manually enable auto-animate on an element
SpruceX.autoAnimate(document.querySelector('#my-list'), { duration: 300 });
```

---

## Network Requests (HTMX-style)

### `sx-get`, `sx-post`, `sx-put`, `sx-delete`

Make HTTP requests declaratively.

```html
<button sx-get="/api/data" sx-target="#result">Load Data</button>
<div id="result"></div>
```

**Request attributes:**

| Attribute | Description | Default |
|-----------|-------------|---------|
| `sx-get/post/put/delete` | URL to request | - |
| `sx-trigger` | Event(s) to trigger request | `click` (`submit` on forms) |
| `sx-trigger-debounce` | Debounce all request triggers (ms) | none |
| `sx-target` | CSS selector for response target | Current element |
| `sx-swap` | How to insert response | `innerHTML` |
| `sx-vars` | Object for URL template variables | - |
| `sx-headers` | Expression returning request headers object | - |
| `sx-body` | Expression/string for request body | form auto-serialize for forms |
| `sx-body-type` | Force body serialization: `json` or `form` | inferred |
| `sx-loading-into` | State path set to `true/false` during request | - |
| `sx-error-into` | State path set to serialized error object on failure | - |
| `sx-disable-while-request` | Disable submit controls while request is running | off |
| `sx-text-while-request` | Temporary button text while request is running | - |
| `sx-confirm` | Confirm prompt before request | off |

**Swap modes:**

| Mode | Behavior |
|------|----------|
| `innerHTML` | Replace target's inner HTML |
| `outerHTML` | Replace target entirely |
| `before` | Insert before target |
| `after` | Insert after target |
| `prepend` | Insert at start of target |
| `append` | Insert at end of target |

```html
<button sx-get="/api/items" sx-target="#list" sx-swap="append">
  Load More
</button>
```

### URL Variables

### `sx-vars`

Pass variables to URL templates:

```html
<div sx-data="{ userId: 42 }">
  <button
    sx-get="/api/users/${userId}/profile"
    sx-vars="{ userId }"
    sx-target="#profile">
    Load Profile
  </button>
</div>
```

### Debounced Triggers

Use either attribute form or modifier syntax:

```html
<input
  sx-get="/api/search?q=${query}"
  sx-vars="{ query }"
  sx-trigger="input"
  sx-trigger-debounce="300">

<input
  sx-get="/api/search?q=${query}"
  sx-vars="{ query }"
  sx-trigger="input.debounce.300">
```

### JSON Responses

### `sx-json-into`

Parse JSON response into state property:

```html
<div sx-data="{ userData: null }">
  <button sx-get="/api/user" sx-json-into="userData">Load</button>
  <div sx-show="userData">
    <span sx-text="userData.name"></span>
  </div>
</div>
```

### Request Body & Headers

`sx-body` can be expression/object/string. `sx-body-type` controls serialization.

```html
<button
  sx-post="/api/layout/save"
  sx-body="{ widgets, updatedAt: Date.now() }"
  sx-body-type="json"
  sx-headers="{ 'X-CSRF-Token': csrf }">
  Save Layout
</button>
```

```html
<button
  sx-post="/api/filter"
  sx-body="{ status: activeStatus, page: page }"
  sx-body-type="form">
  Apply
</button>
```

### Form Submission

Forms use native `submit` by default and serialize as `FormData` unless overridden:

```html
<form sx-post="/api/submit" sx-on:success="alert('Saved!')">
  <input name="email" type="email">
  <button type="submit">Submit</button>
</form>
```

### `sx-include`

Include additional form data:

```html
<form id="extra-data">
  <input name="token" value="abc123">
</form>

<form sx-post="/api/submit" sx-include="#extra-data">
  <input name="message">
  <button>Submit</button>
</form>
```

### Loading/Error State Targets

```html
<button
  sx-post="/api/save"
  sx-body="{ name, email }"
  sx-body-type="json"
  sx-loading-into="isSaving"
  sx-error-into="saveError">
  Save
</button>
```

### Optimistic Updates

### `sx-optimistic` / `sx-revert-on-error`

```html
<div sx-data="{ likes: 10 }">
  <button
    sx-post="/api/like"
    sx-optimistic="likes++"
    sx-revert-on-error="likes--">
    Like (<span sx-text="likes"></span>)
  </button>
</div>
```

### Form UX Helpers

```html
<form
  sx-post="/api/profile"
  sx-disable-while-request
  sx-text-while-request="'Saving...'"
  sx-confirm="Are you sure you want to save?">
  <input name="displayName">
  <button type="submit">Save</button>
</form>
```

`sx-confirm` also works with native form submit handling.

### Polling

### `sx-poll` / `sx-poll-while`

```html
<div sx-data="{ isActive: true, status: '' }">
  <div
    sx-get="/api/status"
    sx-json-into="status"
    sx-poll="5000"
    sx-poll-while="isActive"
    sx-trigger="load">
  </div>
</div>
```

### Response Events

Listen for request completion:

```html
<button
  sx-get="/api/data"
  sx-json-into="data"
  sx-on:success="console.log('Loaded!', $event.detail.json)"
  sx-on:error="console.error('Failed', $event.detail.error)">
  Load
</button>
```

Event detail properties:
- `success`: `{ response, text, json }`
- `error`: `{ error }`

---

## Chart Directive

### `sx-chart`

Declarative Chart.js lifecycle (`init` / `update` / `destroy`) managed by SpruceX.

```html
<div sx-data="{ payload: salesChart }">
  <canvas
    sx-chart="payload"
    sx-chart-type="'bar'"
    sx-chart-options="{ responsive: true, maintainAspectRatio: false }"></canvas>
</div>
```

- `sx-chart`: chart data payload expression (`{ data, type?, options? }` or plain `data`)
- `sx-chart-type`: optional explicit chart type
- `sx-chart-options`: optional explicit options object

If payload becomes `null`/`undefined`, the chart instance is destroyed.

---

## GridStack Directive

### `sx-gridstack`

Declarative GridStack initialization + teardown.

```html
<div
  class="grid-stack"
  sx-gridstack="{ float: true }"
  sx-gridstack-option:cell-height="80"
  sx-gridstack-option:margin="8"
  sx-gridstack-on-change="layout">
  <!-- grid items -->
</div>
```

- `sx-gridstack`: options expression
- `sx-gridstack-options`: extra options expression
- `sx-gridstack-option:<name>`: single option attributes (`kebab-case` accepted)
- `sx-gridstack-on-change|on-added|on-removed|on-dragstop|on-resizestop`: write event node data into state

SpruceX calls `grid.destroy(false)` during component teardown.

---

## Early Bootstrap Hook

Use `window.SpruceXBoot` for head-safe work before deferred component init (for example theme class toggling):

```html
<script>
  window.SpruceXBoot = {
    initTheme() {
      const theme = localStorage.getItem('theme') || 'light';
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  };
</script>
<script defer src="/dist/sprucex.js"></script>
```

`initTheme()` runs once before SpruceX auto-init.

---

## Watchers

React to specific property changes:

```html
<div sx-data="{
  search: '',
  results: [],
  watch: {
    search(newVal, oldVal) {
      console.log('Search changed from', oldVal, 'to', newVal);
      this.performSearch(newVal);
    }
  },
  performSearch(query) {
    // fetch results...
  }
}">
  <input sx-model="search">
</div>
```

---

## Embedded Initial Data

For server-rendered data:

```html
<div sx-data="initialData">
  <script sx-init-data type="application/json">
    {"users": [{"name": "John"}, {"name": "Jane"}], "count": 2}
  </script>
  <span sx-text="count"></span> users
</div>
```

---

## JavaScript API

```javascript
// Manual initialization
SpruceX.init();

// Create/access global store
const userStore = SpruceX.store('user', { name: 'John' });

// Persistent store
SpruceX.store('settings', { theme: 'dark' }, { persist: true });

// Inspect all components
const components = SpruceX.inspect();
// Returns: [{ el: HTMLElement, state: Proxy }, ...]

// Access component instance
const el = document.querySelector('[sx-data]');
const component = el.__sprucex;
component.state.count++;  // Trigger reactivity
component.destroy();       // Clean up component

// Configuration
SpruceX.config({ strict: true });
```

---

## Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="sprucex.js"></script>
  <script>
    SpruceX.store('cart', { items: [], total: 0 }, { persist: true });
  </script>
</head>
<body>

<div sx-data="{
  products: [],
  loading: false,
  search: '',

  get filteredProducts() {
    return this.products.filter(p =>
      p.name.toLowerCase().includes(this.search.toLowerCase())
    );
  },

  addToCart(product) {
    const cart = $store('cart');
    cart.items.push(product);
    cart.total += product.price;
  },

  init() {
    this.loading = true;
  }
}">

  <!-- Search -->
  <input
    type="search"
    sx-model.trim.debounce-ms="300"
    placeholder="Search products...">

  <!-- Loading State -->
  <div sx-show="loading">Loading...</div>

  <!-- Load Products -->
  <button
    sx-get="/api/products"
    sx-json-into="products"
    sx-on:success="loading = false"
    sx-trigger="click, load">
    Refresh
  </button>

  <!-- Product List -->
  <div sx-show="!loading && filteredProducts.length > 0">
    <template sx-for="product in filteredProducts">
      <div class="product" sx-class="{ 'out-of-stock': product.stock === 0 }">
        <h3 sx-text="product.name"></h3>
        <p sx-text="'$' + product.price.toFixed(2)"></p>
        <button
          sx-on:click="addToCart(product)"
          sx-bind:disabled="product.stock === 0">
          Add to Cart
        </button>
      </div>
    </template>
  </div>

  <!-- Empty State -->
  <div sx-show="!loading && filteredProducts.length === 0">
    No products found.
  </div>

</div>

<!-- Cart (separate component using shared store) -->
<div sx-data="{}">
  <h2>Cart (<span sx-text="$store('cart').items.length"></span>)</h2>
  <p>Total: $<span sx-text="$store('cart').total.toFixed(2)"></span></p>
</div>

</body>
</html>
```

---

## Attribute Quick Reference

| Attribute | Purpose |
|-----------|---------|
| `sx-data` | Define component with reactive state |
| `sx-text` | Bind text content |
| `sx-html` | Bind HTML content |
| `sx-show` | Conditional display |
| `sx-bind:<attr>` | Bind any attribute |
| `sx-class` | Bind CSS classes |
| `sx-on:<event>` | Event handler |
| `sx-model` | Two-way form binding |
| `sx-for` | Loop (on `<template>`) |
| `sx-memo` | Memoize computation |
| `sx-ref` | Element reference |
| `sx-toggle` | Toggle boolean on click |
| `sx-error-fallback` | Fallback for expression errors |
| `sx-get/post/put/delete` | HTTP request |
| `sx-trigger` | Request trigger event |
| `sx-trigger-debounce` | Debounce request trigger (ms) |
| `sx-target` | Request response target |
| `sx-swap` | Response swap strategy |
| `sx-vars` | URL template variables |
| `sx-body` | Custom request body |
| `sx-body-type` | Request body serializer (`json`/`form`) |
| `sx-headers` | Dynamic request headers |
| `sx-json-into` | Parse JSON into state |
| `sx-loading-into` | Request loading state target |
| `sx-error-into` | Request error state target |
| `sx-disable-while-request` | Disable controls during request |
| `sx-text-while-request` | Temporary text during request |
| `sx-confirm` | Confirm before request |
| `sx-optimistic` | Optimistic update |
| `sx-revert-on-error` | Revert on request failure |
| `sx-poll` | Polling interval (ms) |
| `sx-poll-while` | Polling condition |
| `sx-include` | Include other forms |
| `sx-chart` | Chart.js declarative binding |
| `sx-chart-type` | Force chart type |
| `sx-chart-options` | Chart.js options expression |
| `sx-gridstack` | GridStack initialization |
| `sx-gridstack-options` | GridStack options expression |
| `sx-gridstack-option:<name>` | Single GridStack option |
| `sx-gridstack-on-change/...` | GridStack events into state |
| `sx-lazy` | Lazy initialization |
| `sx-local` | localStorage persistence |
| `sx-animate` | Animate list changes (add/remove/move) |

---

## Special Variables

Available in expressions:

| Variable | Context | Description |
|----------|---------|-------------|
| `$event` | Event handlers | Native DOM event |
| `$refs` | Everywhere | Object of `sx-ref` elements |
| `$emit(name, detail)` | Everywhere | Emit custom event |
| `$store(name)` | Everywhere | Access global store |
| `$index` | `sx-for` loops | Current iteration index |
| `this` | Methods | Component state proxy |
