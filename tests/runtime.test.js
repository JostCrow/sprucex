import { afterEach, describe, expect, test } from "bun:test";

import { morphNodes } from "../src/utils/morph.js";
import { Component } from "../src/core/component.js";
import { installDom, waitForUpdates } from "./helpers/dom.js";

let restoreDom = null;
let previousFetch;
let previousWarn;
let previousNow;

afterEach(() => {
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }

  if (previousFetch !== undefined) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }

  if (previousWarn !== undefined) {
    console.warn = previousWarn;
    previousWarn = undefined;
  }

  if (previousNow !== undefined) {
    Date.now = previousNow;
    previousNow = undefined;
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

describe("initialization", () => {
  test("nested sx-data roots initialize and render independently", async () => {
    const env = installDom(
      `
        <!doctype html>
        <html>
          <body>
            <section id="outer" sx-data="{ title: 'Outer', items: ['Alpha', 'Beta'] }">
              <h1 id="outer-title" sx-text="title"></h1>
              <ul id="outer-list">
                <template sx-for="item in items">
                  <li class="outer-item" sx-text="item"></li>
                </template>
              </ul>

              <div id="middle" sx-data="{ label: 'Middle', open: true }">
                <h2 id="middle-label" sx-text="label"></h2>
                <div id="middle-panel" sx-show="open">
                  <div id="inner" sx-data="{ note: 'Inner', items: ['One', 'Two'] }">
                    <p id="inner-note" sx-text="note"></p>
                    <ul id="inner-list">
                      <template sx-for="item in items">
                        <li class="inner-item" sx-text="item"></li>
                      </template>
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          </body>
        </html>
      `,
    );
    restoreDom = env.cleanup;

    const uniqueId = `${Date.now()}-${Math.random()}`;
    const { initSpruceX } = await import(`../src/index.js?test=${uniqueId}`);
    initSpruceX();

    const outer = document.querySelector("#outer");
    const middle = document.querySelector("#middle");
    const inner = document.querySelector("#inner");

    expect(outer.__sprucex).toBeTruthy();
    expect(middle.__sprucex).toBeTruthy();
    expect(inner.__sprucex).toBeTruthy();

    expect(document.querySelector("#outer-title").textContent).toBe("Outer");
    expect(document.querySelector("#middle-label").textContent).toBe("Middle");
    expect(document.querySelector("#inner-note").textContent).toBe("Inner");
    expect(
      Array.from(document.querySelectorAll(".outer-item")).map((el) => el.textContent),
    ).toEqual(["Alpha", "Beta"]);
    expect(
      Array.from(document.querySelectorAll(".inner-item")).map((el) => el.textContent),
    ).toEqual(["One", "Two"]);

    outer.__sprucex.state.title = "Outer updated";
    middle.__sprucex.state.open = false;
    inner.__sprucex.state.items.push("Three");
    await waitForUpdates();

    expect(document.querySelector("#outer-title").textContent).toBe("Outer updated");
    expect(document.querySelector("#middle-panel").style.display).toBe("none");
    expect(document.querySelector("#middle-label").textContent).toBe("Middle");
    expect(
      Array.from(document.querySelectorAll(".inner-item")).map((el) => el.textContent),
    ).toEqual(["One", "Two", "Three"]);
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

describe("navigation", () => {
  test("SpruceX.navigate resolves relative URLs and ignores stale older navigations", async () => {
    const env = installDom(`
      <!doctype html>
      <html>
        <body>
          <div sx-page></div>
        </body>
      </html>
    `);
    restoreDom = env.cleanup;

    window.scrollTo = () => {};

    const requestedUrls = [];
    const resolvers = [];
    previousFetch = globalThis.fetch;
    globalThis.fetch = (url) =>
      new Promise((resolve) => {
        requestedUrls.push(String(url));
        resolvers.push(resolve);
      });

    const uniqueId = `${Date.now()}-${Math.random()}`;
    const { SpruceX } = await import(`../src/index.js?nav=${uniqueId}`);

    const olderNav = SpruceX.navigate("/older");
    const newerNav = SpruceX.navigate("/newer");
    await waitForUpdates(5);

    resolvers[1]({
      ok: true,
      text: async () =>
        `
          <!doctype html>
          <html>
            <head><title>Newer</title></head>
            <body><div sx-page><main id="newer">newer</main></div></body>
          </html>
        `,
    });
    await newerNav;

    resolvers[0]({
      ok: true,
      text: async () =>
        `
          <!doctype html>
          <html>
            <head><title>Older</title></head>
            <body><div sx-page><main id="older">older</main></div></body>
          </html>
        `,
    });
    await olderNav;

    expect(requestedUrls).toEqual([
      "https://sprucex.test/older",
      "https://sprucex.test/newer",
    ]);
    expect(document.title).toBe("Newer");
    expect(document.querySelector("#newer")?.textContent).toBe("newer");
    expect(document.querySelector("#older")).toBeNull();
  });

  test("modified link clicks are not intercepted by sx-page", async () => {
    const env = installDom(`
      <!doctype html>
      <html>
        <body>
          <div sx-page></div>
          <a id="next-link" href="/next">Next</a>
        </body>
      </html>
    `);
    restoreDom = env.cleanup;

    let fetchCalls = 0;
    previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        text: async () => "<html><body><div sx-page></div></body></html>",
      };
    };

    const uniqueId = `${Date.now()}-${Math.random()}`;
    await import(`../src/index.js?mod=${uniqueId}`);

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    document.querySelector("#next-link").dispatchEvent(event);
    await waitForUpdates(20);

    expect(event.defaultPrevented).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  test("pending roots stop retrying once the factory wait budget expires", async () => {
    const env = installDom(`
      <!doctype html>
      <html>
        <body>
          <div id="late-root" sx-data="lateFactory"></div>
        </body>
      </html>
    `);
    restoreDom = env.cleanup;

    const warnings = [];
    previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));

    let now = 1000;
    previousNow = Date.now;
    Date.now = () => now;

    const uniqueId = `${Math.random()}`;
    const { SpruceX } = await import(`../src/index.js?pending=${uniqueId}`);

    now += 6000;
    SpruceX.data("lateFactory", () => ({ ready: true }));

    expect(document.querySelector("#late-root").__sprucex).toBeUndefined();
    expect(warnings.some((entry) => entry.includes("did not become available"))).toBe(
      true,
    );
  });
});
