import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import { Component } from "../src/core/component.js";
import { registerIntegration } from "../src/integrations/index.js";
import { ensureBuiltInIntegrationsRegistered } from "../src/integrations/builtins.js";
import { createDeepReactiveProxy } from "../src/reactivity/index.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let cleanup;
let previousFetch;
afterEach(async () => {
  if (cleanup) {
    document.querySelectorAll("[sx-data]").forEach((root) => root.__sprucex?.destroy());
    await waitForUpdates();
    cleanup();
    cleanup = null;
  }
  if (previousFetch) globalThis.fetch = previousFetch;
  previousFetch = null;
});
function mount(html) {
  cleanup = installDom(html).cleanup;
  const root = document.querySelector("[sx-data]");
  root.__sprucex = new Component(root);
  return root.__sprucex;
}
function mockFetch(fn) { previousFetch = globalThis.fetch; globalThis.fetch = fn; }
const json = (value) => ({ ok: true, text: async () => JSON.stringify(value) });

test("row requests preserve their locals across overlapping responses and keyed reorders", async () => {
  const c = mount(`<div sx-data="{items:[{id:1,on:false,result:null},{id:2,on:false,result:null}]}">
    <template sx-for="item in items" sx-key="item.id"><section>
      <button class="load" sx-post="/items/\${id}" sx-vars="{id:item.id}" sx-body="{id:item.id}" sx-json-into="item.result">Load</button>
      <button class="toggle" sx-toggle="item.on"></button><span sx-text="item.on"></span>
    </section></template></div>`);
  const requests = [];
  mockFetch((url, options) => new Promise((resolve) => requests.push({ url, options, resolve })));
  document.querySelectorAll(".load").forEach((el) => el.click());
  document.querySelector(".toggle").click();
  c.state.items.reverse();
  await waitForUpdates();
  requests[1].resolve(json({ id: 2 }));
  requests[0].resolve(json({ id: 1 }));
  await waitForUpdates();
  expect(requests.map((request) => request.url)).toEqual(["/items/1", "/items/2"]);
  expect(requests.map((request) => JSON.parse(request.options.body).id)).toEqual([1, 2]);
  expect(c.state.items.map((item) => item.result.id)).toEqual([2, 1]);
  expect(c.state.items[1].on).toBe(true);
});

test("row integrations evaluate row expressions, update after reorder, and tear down", async () => {
  const bindings = new WeakMap();
  let disposed = 0;
  registerIntegration("gap-uppercase", {
    setup(c) { bindings.set(c, []); },
    scan(c, el) {
      const expression = el.getAttribute("sx-gap-uppercase");
      if (expression) bindings.get(c).push({ el, expression });
    },
    update(c) {
      for (const { el, expression } of bindings.get(c)) {
        el.textContent = String(c.evaluateExpressionOrLiteral(expression)).toUpperCase();
      }
    },
    teardown(c) { disposed += bindings.get(c)?.length || 0; bindings.delete(c); },
  });
  const c = mount(`<div sx-data="{items:[{id:1,name:'one'},{id:2,name:'two'}]}"><template sx-for="item in items" sx-key="item.id"><b sx-gap-uppercase="item.name"></b></template></div>`);
  expect(Array.from(document.querySelectorAll("b"), (el) => el.textContent)).toEqual(["ONE", "TWO"]);
  c.state.items = [{ id: 2, name: "second" }];
  await waitForUpdates();
  expect(document.querySelector("b").textContent).toBe("SECOND");
  expect(disposed).toBe(1);
  c.destroy();
  expect(disposed).toBe(2);
});

test("global event modifiers work for bubbled events and dispose with rows", async () => {
  const c = mount(`<div sx-data="{items:[1],hits:0}"><template sx-for="item in items"><div sx-on:keydown.escape.window="hits += item" sx-on:click.document="hits++"></div></template><button id="outside"></button></div>`);
  document.querySelector("#outside").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.querySelector("#outside").click();
  expect(c.state.hits).toBe(2);
  c.state.items = [];
  await waitForUpdates();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.dispatchEvent(new MouseEvent("click"));
  expect(c.state.hits).toBe(2);
});

test.each(["innerHTML", "outerHTML", "append", "prepend", "before", "after", "morph"])("%s responses initialize directives and nested roots without duplicating existing handlers", async (swap) => {
  const c = mount(`<div sx-data="{count:0,items:[1]}"><button id="existing" sx-on:click="count++"></button><button id="load" sx-get="/fragment" sx-target="#target" sx-swap="${swap}"></button><div id="target"></div><template sx-for="item in items"><input id="retained" sx-bind:value="item"></template></div>`);
  const retained = document.querySelector("#retained");
  mockFetch(async () => ({ ok: true, text: async () => `<section><button id="new" sx-on:click="count++"></button><span id="value" sx-text="count"></span><div sx-data="{ready:true}"><b sx-text="ready"></b></div></section>` }));
  document.querySelector("#load").click();
  await waitForUpdates();
  document.querySelector("#existing").click();
  document.querySelector("#new").click();
  await waitForUpdates();
  expect(c.state.count).toBe(2);
  expect(document.querySelector("#value").textContent).toBe("2");
  expect(document.querySelector("b").textContent).toBe("true");
  expect(document.querySelector("#retained") === retained).toBe(true);
});

test("fragments inserted into existing rows inherit row scope and are disposed with the row", async () => {
  const c = mount(`<div sx-data="{items:[{id:1,count:0}]}"><template sx-for="item in items" sx-key="item.id"><section class="row"><div id="target"></div></section></template></div>`);
  c.applySwap("#target", '<button id="added" sx-on:click="item.count++"></button><b sx-text="item.count"></b>', "innerHTML");
  const added = document.querySelector("#added");
  added.click();
  await waitForUpdates();
  expect(document.querySelector("b").textContent).toBe("1");
  const item = c.state.items[0];
  c.state.items = [];
  await waitForUpdates();
  added.click();
  expect(item.count).toBe(1);
  expect(c.eventHandlers).toHaveLength(0);
});

test("repeated row removal disposes models, pending debounce, polling, and requests", async () => {
  const c = mount(`<div sx-data="{items:[]}"><template sx-for="item in items" sx-key="item.id"><section><input sx-model="item.name" sx-model.debounce-ms="50"><button sx-get="/poll" sx-poll="10000" sx-json-into="item.result"></button></section></template></div>`);
  const signals = [];
  const resolvers = [];
  mockFetch((_url, options) => new Promise((resolve) => { signals.push(options.signal); resolvers.push(resolve); }));
  for (let i = 0; i < 3; i++) {
    c.state.items = [{ id: i, name: "before", result: null }];
    await waitForUpdates();
    const item = c.state.items[0];
    const input = document.querySelector("input");
    input.value = "after";
    input.dispatchEvent(new Event("input"));
    document.querySelector("button").click();
    c.state.items = [];
    await waitForUpdates(65);
    input.dispatchEvent(new Event("input"));
    resolvers[i](json({ late: true }));
    await waitForUpdates();
    expect(item.name).toBe("before");
    expect(item.result).toBeNull();
    expect(signals[i].aborted).toBe(true);
    expect(c.eventHandlers).toHaveLength(0);
    expect(c.modelBindings).toHaveLength(0);
    expect(c.netBindings).toHaveLength(0);
    expect(c.emitterHandlers).toHaveLength(0);
    expect(c.pollTimers).toHaveLength(0);
    expect(c.debounceTimers.size).toBe(0);
  }
});

test.each(["refresh", "destroy"])("%s cancels debounced model writes", async (method) => {
  const c = mount('<div sx-data="{name:\'before\'}"><input sx-model="name" sx-model.debounce-ms="40"></div>');
  const input = document.querySelector("input");
  input.value = "after";
  input.dispatchEvent(new Event("input"));
  c[method]();
  await waitForUpdates(70);
  expect(c.state.name).toBe("before");
});

test("loop refs refresh after removal and exclude nested component refs", async () => {
  const c = mount(`<div sx-data="{items:[1]}"><template sx-for="item in items"><input sx-ref="editor"></template><section sx-data="{}"><input sx-ref="private"></section></div>`);
  expect(c.refs.editor?.tagName).toBe("INPUT");
  expect(c.refs.private).toBeUndefined();
  c.state.items = [];
  await waitForUpdates();
  expect(c.refs.editor).toBeUndefined();
});

test("unchanged multi-node rows do not move; keyed insertion and reorder preserve node identity", async () => {
  const c = mount(`<div sx-data="{count:0,items:[1,2]}"><span sx-text="count"></span><template sx-for="item in items" sx-key="item"><b sx-text="item"></b><i sx-text="item"></i></template></div>`);
  let moves = 0;
  const original = c.root.insertBefore;
  c.root.insertBefore = function (...args) { moves++; return original.apply(this, args); };
  const originalFirst = document.querySelector("b");
  c.state.count++;
  await waitForUpdates();
  expect(moves).toBe(0);
  c.state.items = [2, 3, 1];
  await waitForUpdates();
  expect(Array.from(document.querySelectorAll("b, i"), (el) => el.textContent)).toEqual(["2", "2", "3", "3", "1", "1"]);
  expect(document.querySelectorAll("b")[2] === originalFirst).toBe(true);
});

test("reactive aliases, cycles, inserted values and array return values preserve proxy identity", () => {
  let changes = 0;
  const shared = { value: 0 };
  const raw = { a: shared, b: shared, items: [] };
  raw.self = raw;
  const state = createDeepReactiveProxy(raw, () => changes++);
  expect(state.a === state.b).toBe(true);
  expect(state.self === state).toBe(true);
  expect(raw.a === shared).toBe(true);
  state.b.value++;
  expect(changes).toBe(1);
  state.items.push(shared);
  expect(state.items[0] === state.a).toBe(true);
  const before = changes;
  state.items[0].value++;
  expect(changes).toBe(before + 1);
  expect(state.items.reverse() === state.items).toBe(true);
  state.c = shared;
  expect(state.c === state.a).toBe(true);
});

test("documented debounce inputs bind search and apply trim", async () => {
  const docs = fs.readFileSync("public/llm-docs.md", "utf8");
  const inputs = docs.match(/<input\b[^>]*sx-model[^>]*>/gs).filter((input) => input.includes("debounce-ms"));
  expect(inputs).toHaveLength(2);
  for (const markup of inputs) {
    const c = mount(`<div sx-data="{search:''}">${markup}</div>`);
    const input = document.querySelector("input");
    input.value = "  spruce  ";
    input.dispatchEvent(new Event("input"));
    expect(c.state.search).toBe("");
    await waitForUpdates(340);
    expect(c.state.search).toBe(markup.includes(".trim") ? "spruce" : "  spruce  ");
    c.destroy();
    cleanup();
    cleanup = null;
  }
});

test("morph swaps replace directives on reused elements without retaining old handlers", async () => {
  const c = mount(`<div sx-data="{count:0}"><div id="target"><button id="same" sx-on:click="count++"></button><b sx-text="count"></b></div></div>`);
  const button = document.querySelector("#same");
  c.applySwap("#target", '<button id="same" sx-on:click="count += 2"></button><b sx-text="count * 10"></b>', "morph");
  button.click();
  await waitForUpdates();
  expect(c.state.count).toBe(2);
  expect(document.querySelector("b").textContent).toBe("20");
  expect(document.querySelector("#same") === button).toBe(true);
});

test("repeated fragment hydration does not accumulate GridStack bindings", () => {
  ensureBuiltInIntegrationsRegistered();
  cleanup = installDom('<div sx-data="{}"><div sx-gridstack></div><div id="target"></div></div>').cleanup;
  let instances = 0;
  window.GridStack = { init() { instances++; return { destroy() { instances--; } }; } };
  const root = document.querySelector("[sx-data]");
  const c = root.__sprucex = new Component(root);
  for (let i = 0; i < 3; i++) {
    c.applySwap("#target", "<span>Loaded</span>", "innerHTML");
    expect(c.gridBindings).toHaveLength(1);
    expect(instances).toBe(1);
  }
  c.destroy();
  expect(instances).toBe(0);
});
