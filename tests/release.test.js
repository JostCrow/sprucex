import { afterEach, expect, test } from "bun:test";
import { Component } from "../src/core/component.js";
import { registerDataFactory } from "../src/utils/data-factories.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let cleanup;
let originalFetch;
afterEach(() => {
  document.querySelectorAll("[sx-data]").forEach((root) => root.__sprucex?.destroy());
  cleanup?.();
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
});

function mount(html) {
  const env = installDom(html);
  cleanup = env.cleanup;
  return document.querySelector("[sx-data]");
}

test("auto-cleanup preserves moved components and destroys removed components", async () => {
  const root = mount(`<div sx-data="{ items: [{ id: 'a' }, { id: 'b' }] }">
    <template sx-for="item in items" sx-key="item.id">
      <section class="row" sx-data="{ count: 0 }">
        <button sx-on:click="count++" sx-text="count"></button>
      </section>
    </template>
  </div>`);
  const { SpruceX } = await import(`../src/index.js?cleanup=${Math.random()}`);
  SpruceX.init();
  const row = root.querySelector(".row");
  const component = row.__sprucex;
  row.querySelector("button").click();
  await waitForUpdates();
  root.__sprucex.state.items.reverse();
  await waitForUpdates(60);
  expect(row.__sprucex === component).toBe(true);
  expect(component.isDestroyed).toBe(false);
  row.querySelector("button").click();
  await waitForUpdates();
  expect(row.textContent.trim()).toBe("2");
  row.remove();
  await waitForUpdates();
  expect(component.isDestroyed).toBe(true);
});

test("nested row scopes see replacement items and new indices while retaining local state", async () => {
  const root = mount(`<div sx-data="{ items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] }">
    <template sx-for="item in items" sx-key="item.id">
      <section class="row" sx-data="{ count: 0 }">
        <button sx-on:click="count++" sx-text="item.name + ':' + $index + ':' + count"></button>
      </section>
    </template>
  </div>`);
  root.__sprucex = new Component(root);
  const row = root.querySelector(".row");
  row.querySelector("button").click();
  await waitForUpdates();
  root.__sprucex.state.items = [{ id: "b", name: "New Beta" }, { id: "a", name: "New Alpha" }];
  await waitForUpdates(60);
  expect(Array.from(root.querySelectorAll("button"), (el) => el.textContent)).toEqual([
    "New Beta:0:0", "New Alpha:1:1",
  ]);
  expect(root.querySelectorAll(".row")[1] === row).toBe(true);
});

test("named data factories in loop rows receive the row locals", () => {
  registerDataFactory("releaseRow", (item) => ({ label: item.name }));
  const root = mount(`<div sx-data="{ items: [{ name: 'Alpha' }] }">
    <template sx-for="item in items">
      <section sx-data="releaseRow(item)"><span sx-text="label"></span></section>
    </template>
  </div>`);
  root.__sprucex = new Component(root);
  expect(root.querySelector("span").textContent).toBe("Alpha");
});

test("overlapping requests only abort when sx-cancel-previous is enabled", async () => {
  const root = mount(`<div sx-data="{ result: null }">
    <button sx-get="/items" sx-json-into="result"></button>
  </div>`);
  root.__sprucex = new Component(root);
  const signals = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    signals.push(options.signal);
    return { ok: true, text: async () => '{"ok":true}' };
  };
  root.querySelector("button").click();
  root.querySelector("button").click();
  await waitForUpdates();
  expect(signals).toHaveLength(2);
  expect(signals.some((signal) => signal?.aborted)).toBe(false);
  expect(root.__sprucex.state.result).toEqual({ ok: true });
});

test("prefetch and page clicks resolve relative links against the document base", async () => {
  mount(`<base href="/docs/guide/"><div sx-page><a href="next">Next</a></div>`);
  window.scrollTo = () => {};
  const requested = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return { ok: true, text: async () => '<div sx-page>Next page</div>' };
  };
  const { SpruceX } = await import(`../src/index.js?relative=${Math.random()}`);
  SpruceX.init();
  await SpruceX.prefetch("preview");
  document.querySelector("a").click();
  await waitForUpdates();
  expect(requested).toEqual([
    "https://sprucex.test/docs/guide/preview",
    "https://sprucex.test/docs/guide/next",
  ]);
});
