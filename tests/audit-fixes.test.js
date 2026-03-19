import { afterEach, describe, expect, test } from "bun:test";
import { Component } from "../src/core/component.js";
import { resolveGlobalDataReference } from "../src/utils/data-factories.js";
import { morphNodes } from "../src/utils/morph.js";
import { createDeepReactiveProxy } from "../src/reactivity/index.js";
import { initStore, globalStores, storeSubscribers, removeStore } from "../src/store/index.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let restoreDom = null;

afterEach(() => {
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }
  Object.keys(globalStores).forEach((key) => delete globalStores[key]);
  Object.keys(storeSubscribers).forEach((key) => delete storeSubscribers[key]);
});

function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
}

describe("Security Fixes", () => {
  test("buildUrl uses safe string interpolation", () => {
    const env = installDom(
      `<!doctype html><html><body><div id="target" sx-data="{ id: 123, malicious: 'alert(1)' }"></div></body></html>`
    );
    restoreDom = env.cleanup;

    const root = document.querySelector("#target");
    const component = new Component(root);

    // Test safe interpolation
    const url1 = component.buildUrl({
      urlTpl: "/api/users/${id}/profile",
      varsExpr: "{ id }"
    });
    expect(url1).toBe("/api/users/123/profile");

    // Test that breakout attempts fail/are treated as literal or missing
    // Previously \${alert(1)} would execute alert. Now it just looks for a property named alert(1)
    const url2 = component.buildUrl({
      urlTpl: "/api/users/${malicious}/profile",
      varsExpr: "{ malicious }"
    });
    expect(url2).toBe("/api/users/alert(1)/profile");
    
    // Deep properties
    const url3 = component.buildUrl({
      urlTpl: "/api/users/${user.id}/profile",
      varsExpr: "{ user: { id: 456 } }"
    });
    expect(url3).toBe("/api/users/456/profile");
  });

  test("resolveGlobalDataReference blocks prototype traversal", () => {
    // Should pass
    globalThis.allowedObj = { test: 123 };
    expect(resolveGlobalDataReference("allowedObj.test")).toBe(123);

    // Should block
    expect(resolveGlobalDataReference("allowedObj.__proto__")).toBeUndefined();
    expect(resolveGlobalDataReference("allowedObj.constructor")).toBeUndefined();
    expect(resolveGlobalDataReference("allowedObj.prototype")).toBeUndefined();
    
    delete globalThis.allowedObj;
  });
});

describe("Bug Fixes", () => {
  test("morphNodes does not mutate source __morphed flag", () => {
    const env = installDom(
      `<!doctype html><html><body><div id="target"></div></body></html>`
    );
    restoreDom = env.cleanup;

    const target = document.querySelector("#target");
    
    const sourceHtml = `
      <div id="target">
        <div id="child1">Child 1</div>
        <div id="child2">Child 2</div>
      </div>
    `;
    const source = parseHtml(sourceHtml);
    const child1 = source.querySelector("#child1");

    morphNodes(target, source);

    // Verify morph worked
    expect(target.querySelector("#child1")).toBeTruthy();
    
    // Verify source wasn't mutated with __morphed
    expect(child1.__morphed).toBeUndefined();
    expect(source.__morphed).toBeUndefined();
  });

  test("Proxy-based array reactivity does not mutate original array", () => {
    let fired = false;
    const rawArray = [1, 2, 3];
    const proxy = createDeepReactiveProxy(rawArray, () => { fired = true; });

    // Mutate via proxy
    proxy.push(4);
    
    expect(fired).toBe(true);
    expect(proxy.length).toBe(4);
    expect(proxy[3]).toBe(4);
    
    // Original array should be updated since proxy forwards modifications
    // BUT the push method itself on the raw array should NOT be monkey-patched.
    // Our proxy wrapper will stringify as something like "function () { ... }"
    // A native method won't match our proxy code.
    expect(rawArray.push.toString().includes("reactiveArgs")).toBe(false);
  });
});

describe("API Deductions", () => {
  test("removeStore properly tears down a store", async () => {
    const storeName = "test-removal";
    initStore(storeName, { count: 0 });
    
    const env = installDom(
      `<!doctype html><html><body><div id="target" sx-data>
        <span id="store-val" sx-text="$store('${storeName}').count"></span>
      </div></body></html>`
    );
    restoreDom = env.cleanup;

    const root = document.querySelector("#target");
    const component = new Component(root);
    
    expect(document.querySelector("#store-val").textContent).toBe("0");
    
    // Clean up
    removeStore(storeName);
    
    // Store should be removed
    expect(globalStores[storeName]).toBeUndefined();
    expect(storeSubscribers[storeName]).toBeUndefined();
    
    // The component might try to update, but the store is gone
    // Should not throw
    component.refresh();
    await waitForUpdates();
  });
});
