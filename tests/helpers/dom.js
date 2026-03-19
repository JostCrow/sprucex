import { JSDOM } from "jsdom";

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "history",
  "location",
  "DOMParser",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "CustomEvent",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "MutationObserver",
  "IntersectionObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "CustomElementRegistry",
  "CSS",
  "getComputedStyle",
  "Headers",
  "FormData",
  "File",
  "Blob",
];

export function installDom(html = "<!doctype html><html><body></body></html>") {
  const dom = new JSDOM(html, {
    url: "https://sprucex.test/",
    pretendToBeVisual: true,
  });

  const previous = new Map();
  GLOBAL_KEYS.forEach((key) => {
    previous.set(key, globalThis[key]);
  });

  const { window } = dom;
  const raf = window.requestAnimationFrame?.bind(window)
    || ((cb) => setTimeout(() => cb(Date.now()), 16));
  const caf = window.cancelAnimationFrame?.bind(window) || clearTimeout;

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    history: window.history,
    location: window.location,
    DOMParser: window.DOMParser,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    InputEvent: window.InputEvent || window.Event,
    CustomEvent: window.CustomEvent,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    MutationObserver: window.MutationObserver,
    IntersectionObserver:
      window.IntersectionObserver
      || class IntersectionObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    localStorage: window.localStorage,
    CSS: window.CSS || { escape: (value) => String(value) },
    getComputedStyle: window.getComputedStyle.bind(window),
    Headers: window.Headers || globalThis.Headers,
    FormData: window.FormData || globalThis.FormData,
    File: window.File || globalThis.File,
    Blob: window.Blob || globalThis.Blob,
  });

  return {
    dom,
    cleanup() {
      GLOBAL_KEYS.forEach((key) => {
        const value = previous.get(key);
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      });
      dom.window.close();
    },
  };
}

export function waitForUpdates(delay = 25) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}
