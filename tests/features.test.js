import { afterEach, describe, expect, test } from "bun:test";

import { Component } from "../src/core/component.js";
import { initStore, globalStores, storeSubscribers } from "../src/store/index.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let restoreDom = null;
let previousFetch;

afterEach(() => {
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }

  if (previousFetch !== undefined) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }

  Object.keys(globalStores).forEach((key) => delete globalStores[key]);
  Object.keys(storeSubscribers).forEach((key) => delete storeSubscribers[key]);
});

function mount(html) {
  const env = installDom(`<!doctype html><html><body>${html}</body></html>`);
  restoreDom = env.cleanup;
  const root = document.querySelector("[sx-data]");
  const component = new Component(root);
  root.__sprucex = component;
  return { root, component };
}

describe("core directives and events", () => {
  test("text/html/show/bind/class/toggle/event modifiers update the DOM and state", async () => {
    const { root, component } = mount(`
      <div
        sx-data="{ count: 1, html: '<strong>ok</strong>', visible: true, title: 'greeting', active: false, selfCount: 0, enterCount: 0 }"
      >
        <span id="text" sx-text="count"></span>
        <div id="html" sx-html="html"></div>
        <p id="show" sx-show="visible">Visible</p>
        <div id="bind" sx-bind:title="title"></div>
        <div id="class" class="base" sx-class="{ enabled: active, disabled: !active }"></div>
        <button id="toggle" sx-toggle="active">Toggle</button>
        <button id="prevent" sx-on:click.prevent="count = count + 1">Inc</button>
        <div id="self" sx-on:click.self="selfCount = selfCount + 1">
          <button id="child">child</button>
        </div>
        <input id="keyed" sx-on:keydown.enter="enterCount = enterCount + 1" />
      </div>
    `);

    expect(document.querySelector("#text").textContent).toBe("1");
    expect(document.querySelector("#html").innerHTML).toBe("<strong>ok</strong>");
    expect(document.querySelector("#show").style.display).toBe("");
    expect(document.querySelector("#bind").getAttribute("title")).toBe("greeting");
    expect(document.querySelector("#class").classList.contains("disabled")).toBe(true);
    expect(document.querySelector("#class").classList.contains("base")).toBe(true);

    document.querySelector("#toggle").click();
    await waitForUpdates();
    expect(component.state.active).toBe(true);
    expect(document.querySelector("#class").classList.contains("enabled")).toBe(true);
    expect(document.querySelector("#class").classList.contains("base")).toBe(true);

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    document.querySelector("#prevent").dispatchEvent(clickEvent);
    await waitForUpdates();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(component.state.count).toBe(2);
    expect(document.querySelector("#text").textContent).toBe("2");

    document.querySelector("#child").click();
    await waitForUpdates();
    expect(component.state.selfCount).toBe(0);

    document.querySelector("#self").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await waitForUpdates();
    expect(component.state.selfCount).toBe(1);

    document.querySelector("#keyed").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await waitForUpdates();
    expect(component.state.enterCount).toBe(1);

    component.state.visible = false;
    component.state.title = "updated";
    await waitForUpdates();
    expect(document.querySelector("#show").style.display).toBe("none");
    expect(document.querySelector("#bind").getAttribute("title")).toBe("updated");
  });
});

describe("model, loops, and memo", () => {
  test("checkbox sx-model updates a boolean that drives sx-show", async () => {
    const { component } = mount(`
      <div sx-data="{ visible: true }">
        <input id="toggle-visible" type="checkbox" sx-model="visible" />
        <div id="panel" sx-show="visible">Visible content</div>
      </div>
    `);

    const checkbox = document.querySelector("#toggle-visible");
    const panel = document.querySelector("#panel");

    expect(checkbox.checked).toBe(true);
    expect(panel.style.display).toBe("");

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForUpdates();

    expect(component.state.visible).toBe(false);
    expect(panel.style.display).toBe("none");

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForUpdates();

    expect(component.state.visible).toBe(true);
    expect(panel.style.display).toBe("");
  });

  test("sx-model modifiers, sx-for, and sx-memo behave as expected", async () => {
    const { component } = mount(`
      <div sx-data="{ name: '  Ada  ', qty: 1, lazyQty: 2, debounced: '', items: ['a', 'b'], count: 2 }">
        <input id="trimmed" sx-model.trim="name" />
        <input id="number-lazy" sx-model.number.lazy="lazyQty" />
        <input id="debounced" sx-model="debounced" sx-model.debounce-ms="200" />
        <template sx-for="item in items">
          <span class="item" sx-text="item"></span>
        </template>
        <span id="memo" sx-text="count * 2" sx-memo="['count']"></span>
      </div>
    `);

    const trimmed = document.querySelector("#trimmed");
    const lazy = document.querySelector("#number-lazy");
    const debounced = document.querySelector("#debounced");

    expect(trimmed.value).toBe("  Ada  ");
    expect(lazy.value).toBe("2");
    expect(document.querySelectorAll(".item").length).toBe(2);
    expect(document.querySelector("#memo").textContent).toBe("4");

    trimmed.value = "  Grace  ";
    trimmed.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForUpdates();
    expect(component.state.name).toBe("Grace");

    lazy.value = "7";
    lazy.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForUpdates();
    expect(component.state.lazyQty).toBe(2);
    lazy.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForUpdates();
    expect(component.state.lazyQty).toBe(7);

    debounced.value = "hello";
    debounced.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForUpdates(10);
    expect(component.state.debounced).toBe("");
    await waitForUpdates(230);
    expect(component.state.debounced).toBe("hello");

    component.state.items.push("c");
    component.state.count = 3;
    await waitForUpdates();
    expect(Array.from(document.querySelectorAll(".item")).map((el) => el.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(document.querySelector("#memo").textContent).toBe("6");
  });
});

describe("state and persistence", () => {
  test("stores propagate updates and sx-local loads and saves component state", async () => {
    const storeName = `cart-${Date.now()}`;
    const env = installDom(`
      <!doctype html>
      <html>
        <body>
          <div sx-data="{ theme: 'light' }" sx-local="prefs">
            <span id="local" sx-text="theme"></span>
            <span id="store" sx-text="$store('${storeName}').total"></span>
          </div>
        </body>
      </html>
    `);
    restoreDom = env.cleanup;

    localStorage.setItem("prefs", JSON.stringify({ theme: "dark" }));
    initStore(storeName, { total: 1 });

    const root = document.querySelector("[sx-data]");
    const component = new Component(root);
    root.__sprucex = component;

    expect(component.state.theme).toBe("dark");
    expect(document.querySelector("#local").textContent).toBe("dark");
    expect(document.querySelector("#store").textContent).toBe("1");

    globalStores[storeName].total = 5;
    component.state.theme = "solarized";
    await waitForUpdates();

    expect(document.querySelector("#store").textContent).toBe("5");
    expect(JSON.parse(localStorage.getItem("prefs"))).toEqual({
      theme: "solarized",
    });
  });
});

describe("network actions", () => {
  test("sx-post sends JSON bodies, updates loading UI, and writes JSON responses into state", async () => {
    const { component } = mount(`
      <div sx-data="{ id: 7, result: null, loading: false, error: null }">
        <button
          id="request"
          sx-post="/api/items/\${id}"
          sx-vars="{ id }"
          sx-body="{ id, nested: { ok: true } }"
          sx-body-type="json"
          sx-json-into="result"
          sx-loading-into="loading"
          sx-error-into="error"
          sx-disable-while-request
          sx-text-while-request="'Saving...'"
        >
          Save
        </button>
      </div>
    `);

    let resolveFetch;
    previousFetch = globalThis.fetch;
    globalThis.fetch = (url, options) =>
      new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ saved: true, id: 7 }),
          });

        expect(url).toBe("/api/items/7");
        expect(options.method).toBe("POST");
        expect(options.headers.get("Content-Type")).toBe("application/json");
        expect(options.body).toBe(JSON.stringify({ id: 7, nested: { ok: true } }));
      });

    const button = document.querySelector("#request");
    button.click();
    await waitForUpdates(5);

    expect(component.state.loading).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.textContent.trim()).toBe("Saving...");

    resolveFetch();
    await waitForUpdates(30);

    expect(component.state.loading).toBe(false);
    expect(component.state.error).toBe(null);
    expect(component.state.result).toEqual({ saved: true, id: 7 });
    expect(button.disabled).toBe(false);
    expect(button.textContent.trim()).toBe("Save");
  });

  test("failed requests populate sx-error-into state", async () => {
    const { component } = mount(`
      <div sx-data="{ error: null }">
        <button id="request" sx-get="/boom" sx-error-into="error">Load</button>
      </div>
    `);

    previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "boom",
    });

    document.querySelector("#request").click();
    await waitForUpdates(30);

    expect(component.state.error).toEqual({
      name: "Error",
      message: "HTTP 500: Server Error",
      status: undefined,
    });
  });
});
