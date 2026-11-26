import { afterEach, describe, expect, test } from "bun:test";
import { Component } from "../src/core/component.js";
import {
  SpruceX,
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  createGridStackIntegration,
  createSortableIntegration,
} from "../src/index.js";
import {
  initStore,
  removeStore,
  globalStores,
  storeSubscribers,
} from "../src/store/index.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let cleanup = null;
let previousFetch;

afterEach(() => {
  if (typeof document !== "undefined") {
    document.querySelectorAll("[sx-data]").forEach((root) => root.__sprucex?.destroy());
  }
  SpruceX.config({
    baseUrl: undefined,
    headers: undefined,
    credentials: undefined,
    csrfCookieName: undefined,
    csrfHeaderName: undefined,
    beforeRequest: undefined,
    afterResponse: undefined,
    csp: false,
    debug: false,
    viewTransitions: false,
  });
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (previousFetch !== undefined) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }
  Object.keys(globalStores).forEach((k) => removeStore(k));
  Object.keys(storeSubscribers).forEach((k) => delete storeSubscribers[k]);
});

function mount(html) {
  const env = installDom(`<!doctype html><html><body>${html}</body></html>`);
  cleanup = env.cleanup;
  const root = document.querySelector("[sx-data]");
  const component = new Component(root);
  root.__sprucex = component;
  return { root, component, dom: env.dom };
}

describe("Phase 1: Reactivity safety, performance & correctness fixes", () => {
  test("built-ins (Date, Map, Set, TypedArray) and custom class instances work inside reactive state without throwing", () => {
    class MockChart {
      #renders = 0;
      render() {
        this.#renders += 1;
        return this.#renders;
      }
    }

    const { component } = mount(`<div sx-data="{}"></div>`);
    const now = new Date("2026-01-15T12:00:00Z");
    const lookup = new Map([["eu", 42]]);
    const tags = new Set(["bi"]);
    const series = new Float64Array([1.5, 2.5, 3.5]);
    const chart = new MockChart();

    component.state.date = now;
    component.state.lookup = lookup;
    component.state.tags = tags;
    component.state.series = series;
    component.state.chart = chart;

    expect(component.state.date.getTime()).toBe(now.getTime());
    expect(component.state.lookup.get("eu")).toBe(42);
    expect(component.state.tags.has("bi")).toBe(true);
    expect(Array.from(component.state.series.subarray(0, 2))).toEqual([1.5, 2.5]);
    expect(component.state.chart.render()).toBe(1);
    expect(component.state.date === now).toBe(true);
    expect(component.state.chart === chart).toBe(true);
  });

  test("markRaw, toRaw, shallow and sx-json-into.shallow keep large datasets unproxied while replacing triggers updates", async () => {
    const { component } = mount(`
      <div sx-data="{ rows: [], shallowBox: null }">
        <span id="len" sx-text="rows.length"></span>
        <button id="load" sx-get="/api/dataset" sx-json-into.shallow="rows">Load</button>
      </div>
    `);

    const bigDataset = markRaw([{ x: 1, y: 10 }, { x: 2, y: 20 }]);
    component.state.rows = bigDataset;
    expect(component.state.rows === bigDataset).toBe(true);
    expect(toRaw(component.state.rows) === bigDataset).toBe(true);
    await waitForUpdates();
    expect(document.querySelector("#len").textContent).toBe("2");

    // shallow wrapper tracks top-level replacement without proxying nested items
    const rawNested = { points: [1, 2, 3] };
    component.state.shallowBox = shallow({ data: rawNested });
    expect(component.state.shallowBox.data === rawNested).toBe(true);

    // sx-json-into.shallow assigns raw parsed array
    previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify([{ x: 1 }, { x: 2 }, { x: 3 }]),
    });

    document.querySelector("#load").click();
    await waitForUpdates(30);
    expect(component.state.rows).toHaveLength(3);
    expect(toRaw(component.state.rows) === component.state.rows).toBe(true);
    expect(document.querySelector("#len").textContent).toBe("3");
  });

  test("no-op DOM write guard prevents sx-html subtree destruction on unrelated state updates", async () => {
    const { component } = mount(`
      <div sx-data="{ other: 0, html: '<span id=inner-node>Stable</span>' }">
        <div id="box" sx-html="html"></div>
        <b id="other" sx-text="other"></b>
      </div>
    `);

    const innerBefore = document.querySelector("#inner-node");
    component.state.other = 1;
    await waitForUpdates();
    expect(document.querySelector("#other").textContent).toBe("1");
    expect(document.querySelector("#inner-node") === innerBefore).toBe(true);
  });

  test("localStorage writes are batched per microtask for sx-local and persistent stores", async () => {
    const env = installDom(`
      <!doctype html><html><body>
        <div sx-data="{ a: 0, b: 0, c: 0 }" sx-local="batch-test"></div>
      </body></html>
    `);
    cleanup = env.cleanup;

    let writes = 0;
    const storageProto = Object.getPrototypeOf(localStorage);
    const origSetItem = storageProto.setItem;
    storageProto.setItem = function (k, v) {
      writes += 1;
      return origSetItem.call(this, k, v);
    };

    try {
      const root = document.querySelector("[sx-data]");
      const c = new Component(root);
      root.__sprucex = c;

      for (let i = 1; i <= 10; i++) {
        c.state.a = i;
        c.state.b = i * 2;
      }
      expect(writes).toBe(0);
      await waitForUpdates(10);
      expect(writes).toBe(1);
      expect(JSON.parse(localStorage.getItem("batch-test"))).toEqual({ a: 10, b: 20, c: 0 });

      const store = initStore("batched-store", { count: 0 }, { persist: true });
      writes = 0;
      for (let i = 1; i <= 10; i++) store.count = i;
      expect(writes).toBe(0);
      await waitForUpdates(10);
      expect(writes).toBe(1);
    } finally {
      storageProto.setItem = origSetItem;
    }
  });

  test("sx-bind preserves aria-* false values, syncs live properties, and sx-show preserves inline display", async () => {
    const { component } = mount(`
      <div sx-data="{ pressed: false, open: true, val: 'init' }">
        <button id="aria-btn" sx-bind:aria-pressed="pressed">Toggle</button>
        <div id="flex-box" style="display: flex" sx-show="open">Flex</div>
        <input id="live-input" sx-bind:value="val" />
      </div>
    `);

    const btn = document.querySelector("#aria-btn");
    const flex = document.querySelector("#flex-box");
    const input = document.querySelector("#live-input");

    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(flex.style.display).toBe("flex");
    expect(input.value).toBe("init");

    // Simulate user typing then state overriding value
    input.value = "typed";
    component.state.pressed = true;
    component.state.open = false;
    component.state.val = "reset";
    await waitForUpdates();

    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(flex.style.display).toBe("none");
    expect(input.value).toBe("reset");

    component.state.open = true;
    component.state.pressed = null;
    await waitForUpdates();
    expect(flex.style.display).toBe("flex");
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
  });

  test("keyboard modifiers (ctrl.enter, esc, space) and event modifiers (once, outside, debounce, throttle)", async () => {
    const { component } = mount(`
      <div sx-data="{ submitCount: 0, escCount: 0, spaceCount: 0, onceCount: 0, outsideCount: 0, debounced: 0 }">
        <input
          id="kb"
          sx-on:keydown.ctrl.enter="submitCount++"
          sx-on:keydown.esc="escCount++"
          sx-on:keydown.space="spaceCount++"
        />
        <button id="once-btn" sx-on:click.once="onceCount++">Once</button>
        <div id="menu" sx-on:click.outside="outsideCount++"><span id="inside">In</span></div>
        <button id="deb-btn" sx-on:click.debounce.30="debounced++">Deb</button>
        <button id="outside-target">Out</button>
      </div>
    `);

    const kb = document.querySelector("#kb");
    // Plain Enter without Ctrl must NOT trigger ctrl.enter
    kb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(component.state.submitCount).toBe(0);
    // Ctrl alone must NOT trigger ctrl.enter
    kb.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }));
    expect(component.state.submitCount).toBe(0);
    // Ctrl + Enter triggers!
    kb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(component.state.submitCount).toBe(1);

    kb.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(component.state.escCount).toBe(1);
    kb.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(component.state.spaceCount).toBe(1);

    const onceBtn = document.querySelector("#once-btn");
    onceBtn.click();
    onceBtn.click();
    expect(component.state.onceCount).toBe(1);

    // Reset outsideCount after clicking #once-btn (which is outside #menu)
    const beforeInside = component.state.outsideCount;
    // Clicking inside does not fire .outside
    document.querySelector("#inside").click();
    expect(component.state.outsideCount).toBe(beforeInside);
    // Clicking outside fires .outside
    document.querySelector("#outside-target").click();
    expect(component.state.outsideCount).toBe(beforeInside + 1);

    const debBtn = document.querySelector("#deb-btn");
    debBtn.click();
    debBtn.click();
    debBtn.click();
    expect(component.state.debounced).toBe(0);
    await waitForUpdates(55);
    expect(component.state.debounced).toBe(1);
  });

  test("sx-model supports select multiple and preserves empty string for .number", async () => {
    const { component } = mount(`
      <div sx-data="{ regions: ['eu'], limit: 10 }">
        <select id="multi" multiple sx-model="regions">
          <option value="us">US</option>
          <option value="eu">EU</option>
          <option value="apac">APAC</option>
        </select>
        <input id="num" type="number" sx-model.number="limit" />
      </div>
    `);

    const multi = document.querySelector("#multi");
    expect(multi.options[1].selected).toBe(true);
    expect(multi.options[0].selected).toBe(false);

    multi.options[0].selected = true;
    multi.options[2].selected = true;
    multi.dispatchEvent(new Event("change", { bubbles: true }));
    expect(component.state.regions).toEqual(["us", "eu", "apac"]);

    const num = document.querySelector("#num");
    num.value = "";
    num.dispatchEvent(new Event("input", { bubbles: true }));
    expect(component.state.limit).toBe("");

    num.value = "25";
    num.dispatchEvent(new Event("input", { bubbles: true }));
    expect(component.state.limit).toBe(25);
  });

  test("path-aware watchers avoid colliding leaf triggers and support nested dotted paths", () => {
    const rootHits = [];
    const nestedHits = [];
    const { component } = mount(`
      <div sx-data="{}"></div>
    `);
    component.destroy();

    const root = document.querySelector("[sx-data]");
    globalThis.__watcherTestFactory = () => ({
      name: "root",
      user: { name: "Alice" },
      watch: {
        name(next, prev) {
          rootHits.push([prev, next]);
        },
        "user.name"(next, prev) {
          nestedHits.push([prev, next]);
        },
      },
    });
    root.setAttribute("sx-data", "__watcherTestFactory()");
    const c = new Component(root);
    root.__sprucex = c;

    try {
      c.state.user.name = "Bob";
      expect(rootHits).toEqual([]);
      expect(nestedHits).toEqual([["Alice", "Bob"]]);

      c.state.name = "dashboard";
      expect(rootHits).toEqual([["root", "dashboard"]]);
      expect(nestedHits).toEqual([["Alice", "Bob"]]);
    } finally {
      delete globalThis.__watcherTestFactory;
    }
  });
});

describe("Phase 2: Fine-grained reactivity, SpruceX.directive, sx-if, sx-cloak, Shadow DOM & CSP", () => {
  test("auto-cached computed getters compute once per dependency change across multiple consumers", async () => {
    let filterRuns = 0;
    globalThis.__biData = () => ({
      search: "",
      unrelated: 0,
      rows: ["Revenue", "Margin", "Churn"],
      get filtered() {
        filterRuns += 1;
        return this.rows.filter((r) =>
          r.toLowerCase().includes(this.search.toLowerCase()),
        );
      },
    });

    try {
      const { component } = mount(`
        <div sx-data="__biData()">
          <span id="c1" sx-text="filtered.length"></span>
          <span id="c2" sx-text="filtered.join(',')"></span>
          <span id="u" sx-text="unrelated"></span>
        </div>
      `);

      expect(document.querySelector("#c1").textContent).toBe("3");
      expect(document.querySelector("#c2").textContent).toBe("Revenue,Margin,Churn");
      const runsAfterInit = filterRuns;
      expect(runsAfterInit).toBe(1);

      // Unrelated mutation must NOT recompute `filtered`
      component.state.unrelated = 99;
      await waitForUpdates();
      expect(document.querySelector("#u").textContent).toBe("99");
      expect(filterRuns).toBe(runsAfterInit);

      // Dependency change recomputes `filtered` once for both bindings
      component.state.search = "rev";
      await waitForUpdates();
      expect(document.querySelector("#c1").textContent).toBe("1");
      expect(document.querySelector("#c2").textContent).toBe("Revenue");
      expect(filterRuns).toBe(runsAfterInit + 1);
    } finally {
      delete globalThis.__biData;
    }
  });

  test("SpruceX.directive provides element-scoped reactive effects & survives untouched partial swaps", async () => {
    let chartMounts = 0;
    let chartUpdates = 0;
    let chartDestroys = 0;

    SpruceX.directive("test-chart", (el, { evaluate, effect: dirEffect, cleanup: onCleanup, modifiers }) => {
      chartMounts += 1;
      el.dataset.mods = modifiers.join(",");
      dirEffect(() => {
        chartUpdates += 1;
        el.dataset.points = JSON.stringify(evaluate());
      });
      onCleanup(() => {
        chartDestroys += 1;
      });
    });

    const { component } = mount(`
      <div sx-data="{ series: [10, 20], sidebarOpen: false }">
        <div id="chart" sx-test-chart.animated="series"></div>
        <div id="kpi-slot">Old KPI</div>
      </div>
    `);

    const chartEl = document.querySelector("#chart");
    expect(chartMounts).toBe(1);
    expect(chartUpdates).toBe(1);
    expect(chartEl.dataset.mods).toBe("animated");
    expect(chartEl.dataset.points).toBe("[10,20]");

    // Unrelated state mutation must NOT re-run chart effect!
    component.state.sidebarOpen = true;
    await waitForUpdates();
    expect(chartUpdates).toBe(1);

    // Partial HTML swap elsewhere in component must NOT destroy/remount chart!
    component.applySwap("#kpi-slot", "<span>New KPI</span>", "innerHTML");
    await waitForUpdates();
    expect(chartMounts).toBe(1);
    expect(chartDestroys).toBe(0);
    expect(chartUpdates).toBe(1);

    // Mutating the chart's actual dependency triggers its effect!
    component.state.series.push(30);
    await waitForUpdates();
    expect(chartUpdates).toBe(2);
    expect(chartEl.dataset.points).toBe("[10,20,30]");

    component.destroy();
    expect(chartDestroys).toBe(1);
  });

  test("sx-if mounts and destroys subtrees, nested sx-data, and directives cleanly", async () => {
    let cleaned = 0;
    SpruceX.directive("if-widget", (_el, { cleanup: onCleanup }) => {
      onCleanup(() => {
        cleaned += 1;
      });
    });

    const { component } = mount(`
      <div sx-data="{ tab: 'summary' }">
        <template sx-if="tab === 'chart'">
          <section id="tab-panel" sx-data="{ local: 1 }" sx-if-widget>
            <span id="nested-val" sx-text="local"></span>
          </section>
        </template>
      </div>
    `);

    expect(document.querySelector("#tab-panel")).toBeNull();

    component.state.tab = "chart";
    await waitForUpdates();
    const panel = document.querySelector("#tab-panel");
    expect(panel).toBeTruthy();
    expect(panel.__sprucex).toBeTruthy();
    expect(document.querySelector("#nested-val").textContent).toBe("1");

    const nestedComp = panel.__sprucex;
    component.state.tab = "summary";
    await waitForUpdates();
    expect(document.querySelector("#tab-panel")).toBeNull();
    expect(nestedComp.isDestroyed).toBe(true);
    expect(cleaned).toBe(1);

    // Refresh preserves sx-if template for subsequent toggles
    component.refresh();
    component.state.tab = "chart";
    await waitForUpdates();
    expect(document.querySelector("#tab-panel")).toBeTruthy();
  });

  test("sx-cloak, sx-style, sx-init, sx-effect, $nextTick, $dispatch, $el, and $parent", async () => {
    const env = installDom(`
      <!doctype html><html><body>
        <div id="parent" sx-data="{ parentLabel: 'Dashboard', received: null, color: 'red', ticks: 0, log: [] }" sx-on:widget-ready="received = $event.detail">
          <div id="cloaked" sx-cloak sx-style="{ color, '--accent': '#09f' }" sx-init="log.push($el.id)" sx-effect="log.push('color:' + color)"></div>
          <div id="child" sx-data="{ own: 1 }">
            <span id="from-parent" sx-text="$parent.parentLabel"></span>
            <button id="notify" sx-on:click="$dispatch('widget-ready', { ok: true })">Notify</button>
          </div>
        </div>
      </body></html>
    `);
    cleanup = env.cleanup;
    SpruceX.init();

    const cloaked = document.querySelector("#cloaked");
    expect(cloaked.hasAttribute("sx-cloak")).toBe(false);
    expect(cloaked.style.color).toBe("red");
    expect(cloaked.style.getPropertyValue("--accent")).toBe("#09f");

    const parentComp = document.querySelector("#parent").__sprucex;
    expect(parentComp.state.log).toContain("cloaked");
    expect(parentComp.state.log).toContain("color:red");
    expect(document.querySelector("#from-parent").textContent).toBe("Dashboard");

    document.querySelector("#notify").click();
    expect(parentComp.state.received).toEqual({ ok: true });

    // $nextTick waits for batched rAF render
    parentComp.state.color = "blue";
    await parentComp.nextTick();
    expect(cloaked.style.color).toBe("blue");
    expect(parentComp.state.log).toContain("color:blue");
  });

  test("SpruceX.init(shadowRoot) and mount/unmount work inside Shadow DOM", async () => {
    const env = installDom(`<!doctype html><html><body><div id="host"></div></body></html>`);
    cleanup = env.cleanup;

    const host = document.querySelector("#host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div id="in-shadow" sx-data="{ count: 5 }"><button sx-on:click="count++">+</button><span sx-text="count"></span></div>`;

    SpruceX.init(shadow);
    const el = shadow.querySelector("#in-shadow");
    expect(el.__sprucex).toBeTruthy();
    expect(shadow.querySelector("span").textContent).toBe("5");

    shadow.querySelector("button").click();
    await waitForUpdates();
    expect(shadow.querySelector("span").textContent).toBe("6");
    expect(SpruceX.inspect(shadow)).toHaveLength(1);

    SpruceX.unmount(el);
    expect(el.__sprucex).toBeUndefined();
  });

  test("CSP-safe mode evaluates bindings, expressions, $store, and statements without new Function", async () => {
    SpruceX.config({ csp: true });
    initStore("csp-store", { factor: 3 });

    const { component } = mount(`
      <div sx-data="{ count: 2, open: false, user: { name: 'Ada' } }">
        <span id="calc" sx-text="count * $store('csp-store').factor"></span>
        <span id="ternary" sx-text="open ? user.name : 'hidden'"></span>
        <button id="inc" sx-on:click="count++; open = !open">Go</button>
      </div>
    `);

    expect(document.querySelector("#calc").textContent).toBe("6");
    expect(document.querySelector("#ternary").textContent).toBe("hidden");

    document.querySelector("#inc").click();
    await waitForUpdates();
    expect(component.state.count).toBe(3);
    expect(component.state.open).toBe(true);
    expect(document.querySelector("#calc").textContent).toBe("9");
    expect(document.querySelector("#ternary").textContent).toBe("Ada");
  });
});

describe("Phase 3: Network upgrades, config hooks, cross-component triggers & page nav", () => {
  test("sx-patch, sx-params, URL-encoded sx-vars, sx-swap=none/delete, sx-select, and config hooks", async () => {
    const seen = [];
    SpruceX.config({
      baseUrl: "https://api.bi.test",
      credentials: "include",
      csrfCookieName: "XSRF-TOKEN",
      csrfHeaderName: "X-XSRF-TOKEN",
      headers: () => ({ Authorization: "Bearer tok-123" }),
      beforeRequest(ctx) {
        seen.push({ phase: "before", url: ctx.url, method: ctx.method, auth: ctx.headers.get("Authorization") });
        if (ctx.url.includes("blocked")) return false;
      },
      afterResponse(ctx) {
        seen.push({ phase: "after", status: ctx.response.status });
      },
    });

    const { component } = mount(`
      <div sx-data="{ q: 'a&b=1', region: 'EU', tags: ['sales', 'q4'] }">
        <button id="patch-btn" sx-patch="/widgets/\${q}" sx-vars="{ q }" sx-params="{ region, tags, empty: '' }" sx-swap="none">Save</button>
        <button id="del-btn" sx-delete="/widgets/1" sx-target="#doomed" sx-swap="delete">Del</button>
        <div id="doomed">Gone soon</div>
        <button id="sel-btn" sx-get="/page" sx-target="#slot" sx-select="#only-this">Load</button>
        <div id="slot"></div>
        <button id="block-btn" sx-get="/blocked" sx-swap="none">Block</button>
      </div>
    `);

    document.cookie = "XSRF-TOKEN=secret42";
    const calls = [];
    previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/page")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "<html><body><header>Skip</header><div id='only-this'>Selected!</div></body></html>",
        };
      }
      return { ok: true, status: 204, statusText: "No Content", text: async () => "" };
    };

    document.querySelector("#patch-btn").click();
    await waitForUpdates(25);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.bi.test/widgets/a%26b%3D1?region=EU&tags=sales&tags=q4");
    expect(calls[0].options.method).toBe("PATCH");
    expect(calls[0].options.credentials).toBe("include");
    expect(calls[0].options.headers.get("Authorization")).toBe("Bearer tok-123");
    expect(calls[0].options.headers.get("X-XSRF-TOKEN")).toBe("secret42");
    // sx-swap="none" must keep button text intact
    expect(document.querySelector("#patch-btn").textContent).toBe("Save");

    // sx-swap="delete" removes target
    document.querySelector("#del-btn").click();
    await waitForUpdates(25);
    expect(document.querySelector("#doomed")).toBeNull();

    // sx-select extracts fragment
    document.querySelector("#sel-btn").click();
    await waitForUpdates(25);
    expect(document.querySelector("#slot").textContent).toBe("Selected!");

    // beforeRequest returning false cancels fetch
    document.querySelector("#block-btn").click();
    await waitForUpdates(25);
    expect(calls).toHaveLength(3);
    expect(seen.some((s) => s.phase === "after" && s.status === 200)).toBe(true);
    void component;
  });

  test("cross-component sx-trigger from:window refreshes independent widgets", async () => {
    const env = installDom(`
      <!doctype html><html><body>
        <div id="filters" sx-data="{}">
          <button id="apply" sx-on:click="$dispatch('filters-changed', { region: 'EU' })">Apply</button>
        </div>
        <div id="widget" sx-data="{ data: null }">
          <div sx-get="/api/chart" sx-trigger="filters-changed from:window" sx-json-into="data"></div>
        </div>
      </body></html>
    `);
    cleanup = env.cleanup;

    let fetches = 0;
    previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, status: 200, statusText: "OK", text: async () => '{"ok":true}' };
    };

    SpruceX.init();
    document.querySelector("#apply").click();
    await waitForUpdates(30);
    expect(fetches).toBe(1);
    expect(document.querySelector("#widget").__sprucex.state.data).toEqual({ ok: true });

    // Destroying widget cleans up window listener
    document.querySelector("#widget").__sprucex.destroy();
    document.querySelector("#apply").click();
    await waitForUpdates(25);
    expect(fetches).toBe(1);
  });

  test("visibility-aware sx-poll pauses when document.hidden is true and resumes on visibilitychange", async () => {
    const env = installDom(`
      <!doctype html><html><body>
        <div sx-data="{ ticks: 0 }">
          <div sx-get="/api/ping" sx-poll="25" sx-swap="none"></div>
        </div>
      </body></html>
    `);
    cleanup = env.cleanup;

    let hidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });

    let fetches = 0;
    previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, status: 200, statusText: "OK", text: async () => "" };
    };

    const root = document.querySelector("[sx-data]");
    root.__sprucex = new Component(root);

    await waitForUpdates(65);
    expect(fetches).toBe(0);

    // Becoming visible immediately runs the skipped poll tick
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitForUpdates(10);
    expect(fetches).toBeGreaterThanOrEqual(1);
  });

  test("standalone computed/effect and GridStack/Sortable integrations export cleanly", () => {
    const box = SpruceX.store("computed-test", { a: 2, b: 3 });
    let runs = 0;
    const sum = computed(() => {
      runs += 1;
      return box.a + box.b;
    });
    expect(sum.value).toBe(5);
    expect(sum.value).toBe(5);
    expect(runs).toBe(1);

    let observed = 0;
    const stopRunner = effect(() => {
      observed = sum.value;
    });
    expect(observed).toBe(5);

    box.a = 10;
    expect(observed).toBe(13);
    expect(runs).toBe(2);

    stopRunner.stop();
    sum.stop();
    box.b = 20;
    expect(observed).toBe(13);

    expect(typeof createGridStackIntegration).toBe("function");
    expect(typeof createSortableIntegration).toBe("function");
  });
});
