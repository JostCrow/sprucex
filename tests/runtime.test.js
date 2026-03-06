import { afterEach, describe, expect, test } from "bun:test";

import { morphNodes } from "../src/utils/morph.js";
import { Component } from "../src/core/component.js";
import { installDom } from "./helpers/dom.js";

let restoreDom = null;

afterEach(() => {
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }
});

function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
}

describe("morphing", () => {
  test("sx-preserve keeps live input values during morphs", () => {
    const env = installDom(
      `
        <!doctype html>
        <html>
          <body>
            <div id="target">
              <input id="preserved" sx-preserve value="server value" />
            </div>
          </body>
        </html>
      `,
    );
    restoreDom = env.cleanup;

    const target = document.querySelector("#target");
    const input = document.querySelector("#preserved");
    input.value = "client value";

    morphNodes(
      target,
      parseHtml(`
        <div id="target">
          <input id="preserved" sx-preserve value="server update" />
        </div>
      `),
    );

    expect(input.value).toBe("client value");
    expect(input.getAttribute("value")).toBe("server value");
  });

  test("non-preserved form controls still sync with source markup", () => {
    const env = installDom(
      `
        <!doctype html>
        <html>
          <body>
            <div id="target">
              <input id="plain-input" value="before" />
              <textarea id="plain-textarea">before text</textarea>
              <select id="plain-select">
                <option value="a" selected>A</option>
                <option value="b">B</option>
              </select>
            </div>
          </body>
        </html>
      `,
    );
    restoreDom = env.cleanup;

    const target = document.querySelector("#target");
    const input = document.querySelector("#plain-input");
    const textarea = document.querySelector("#plain-textarea");
    const select = document.querySelector("#plain-select");

    input.value = "client input";
    textarea.value = "client textarea";
    select.value = "a";

    morphNodes(
      target,
      parseHtml(`
        <div id="target">
          <input id="plain-input" value="server input" />
          <textarea id="plain-textarea">server textarea</textarea>
          <select id="plain-select">
            <option value="a">A</option>
            <option value="b" selected>B</option>
          </select>
        </div>
      `),
    );

    expect(input.value).toBe("server input");
    expect(textarea.value).toBe("server textarea");
    expect(select.value).toBe("b");
  });
});

describe("integrations", () => {
  test("refresh reruns the full integration lifecycle for mounted components", async () => {
    const env = installDom(
      `
        <!doctype html>
        <html>
          <body>
            <div id="root" sx-data="{ count: 0 }">
              <span sx-test="count"></span>
            </div>
          </body>
        </html>
      `,
    );
    restoreDom = env.cleanup;

    const root = document.querySelector("#root");
    const component = new Component(root);
    root.__sprucex = component;

    const calls = {
      setup: 0,
      teardown: 0,
      scan: 0,
      update: 0,
    };
    const uniqueId = `${Date.now()}-${Math.random()}`;
    const { SpruceX } = await import(`../src/index.js?test=${uniqueId}`);

    SpruceX.integration(`test-${uniqueId}`, {
      setup() {
        calls.setup += 1;
      },
      scan(_component, el) {
        if (el.hasAttribute("sx-test")) {
          calls.scan += 1;
        }
      },
      update() {
        calls.update += 1;
      },
      teardown() {
        calls.teardown += 1;
      },
    });

    expect(calls.setup).toBe(1);
    expect(calls.scan).toBe(1);
    expect(calls.update).toBe(1);
    expect(calls.teardown).toBe(1);
  });

  test("manual refresh stays idempotent across repeated integration lifecycles", () => {
    const env = installDom(
      `
        <!doctype html>
        <html>
          <body>
            <div id="root" sx-data="{ count: 0 }">
              <span sx-test="count"></span>
            </div>
          </body>
        </html>
      `,
    );
    restoreDom = env.cleanup;

    const root = document.querySelector("#root");
    const component = new Component(root);

    const calls = {
      setup: 0,
      teardown: 0,
      scan: 0,
      update: 0,
    };

    component.initIntegrationBindings = () => {
      calls.setup += 1;
    };
    component.teardownIntegrations = () => {
      calls.teardown += 1;
    };
    component.scanIntegrations = (_el) => {
      calls.scan += 1;
    };
    component.updateIntegrations = () => {
      calls.update += 1;
    };

    component.refresh();
    component.refresh();

    expect(calls.setup).toBe(2);
    expect(calls.teardown).toBe(2);
    expect(calls.scan).toBe(4);
    expect(calls.update).toBe(2);
  });
});
