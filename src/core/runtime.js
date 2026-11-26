import {
  ATTR_DATA,
  ATTR_PAGE,
  ATTR_PAGE_IGNORE,
  ATTR_PAGE_TRANSITION,
  ATTR_BOOST,
  ATTR_BOOST_ON,
  ATTR_LAZY,
} from "../constants.js";
import { initStore, removeStore } from "../store/index.js";
import { Component } from "./component.js";
import { setAutoAnimate, getAutoAnimate } from "../utils/animations.js";
import { morphNodes } from "../utils/morph.js";
import { setCspMode } from "../utils/eval.js";
import {
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  stop,
} from "../reactivity/index.js";
import {
  getIntegration,
  registerIntegration,
} from "../integrations/index.js";
import {
  getDirective,
  registerDirective,
} from "../directives/registry.js";
import {
  DATA_FACTORY_NOT_READY_ERROR,
  getDataFactory,
  registerDataFactory,
} from "../utils/data-factories.js";

const MAX_PAGE_CACHE_SIZE = 20;
const pageCache = new Map();
const pendingFetches = new Map();
const PAGE_CACHE_TTL = 30000;
const pendingRoots = new Set();
const pendingRootMeta = new WeakMap();
const PENDING_ROOT_MAX_WAIT = 5000;
let pendingRootFlushQueued = false;
let pendingRootPollTimer = null;
let pendingRootPollCount = 0;
const MAX_PENDING_ROOT_POLLS = 100;
let latestNavigationId = 0;
let activeNavigationController = null;
const observedCleanupRoots = new WeakMap();
const mountedRootRegistry = new Set(); // Track mounted roots across document & shadow roots

function ensurePendingRootPolling() {
  if (pendingRootPollTimer || pendingRoots.size === 0) return;
  pendingRootPollCount = 0;
  pendingRootPollTimer = setInterval(() => {
    pendingRootPollCount++;
    if (pendingRootPollCount >= MAX_PENDING_ROOT_POLLS) {
      clearInterval(pendingRootPollTimer);
      pendingRootPollTimer = null;
      console.warn(
        `SpruceX: Stopped polling for pending roots after ${MAX_PENDING_ROOT_POLLS} attempts. Make sure data factories are registered.`,
      );
      return;
    }
    flushPendingRoots();
  }, 100);
}

export function flushPendingRoots() {
  pendingRoots.forEach((root) => {
    if (!root || !root.isConnected || root.__sprucex) {
      pendingRoots.delete(root);
      pendingRootMeta.delete(root);
      return;
    }

    const meta = pendingRootMeta.get(root);
    if (meta && Date.now() - meta.queuedAt > PENDING_ROOT_MAX_WAIT) {
      console.warn(
        "SpruceX sx-data factory did not become available in time:",
        root.getAttribute(ATTR_DATA),
      );
      pendingRoots.delete(root);
      pendingRootMeta.delete(root);
      return;
    }

    const comp = initSpruceXRoot(root);
    if (comp) {
      pendingRoots.delete(root);
      pendingRootMeta.delete(root);
    }
  });

  if (pendingRoots.size === 0 && pendingRootPollTimer) {
    clearInterval(pendingRootPollTimer);
    pendingRootPollTimer = null;
    pendingRootPollCount = 0;
  }
}

function queuePendingRoot(root) {
  if (!root || root.__sprucex) return;
  const wasPending = pendingRoots.has(root);
  pendingRoots.add(root);
  if (!wasPending) {
    pendingRootMeta.set(root, { queuedAt: Date.now() });
  }
  ensurePendingRootPolling();

  if (wasPending || pendingRootFlushQueued) return;
  pendingRootFlushQueued = true;
  queueMicrotask(() => {
    pendingRootFlushQueued = false;
    flushPendingRoots();
  });
}

function collectMountedRoots(scopeRoot = null) {
  const roots = new Set();
  if (scopeRoot && typeof scopeRoot.querySelectorAll === "function") {
    if (scopeRoot.nodeType === 1 && scopeRoot.hasAttribute?.(ATTR_DATA) && scopeRoot.__sprucex) {
      roots.add(scopeRoot);
    }
    scopeRoot.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
      if (el.__sprucex) roots.add(el);
    });
    return Array.from(roots);
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
      if (el.__sprucex) roots.add(el);
    });
  }

  mountedRootRegistry.forEach((el) => {
    if (!el?.isConnected || !el.__sprucex) {
      mountedRootRegistry.delete(el);
    } else {
      roots.add(el);
    }
  });

  return Array.from(roots);
}

function refreshAllMountedComponents() {
  collectMountedRoots().forEach((root) => {
    if (root.__sprucex && typeof root.__sprucex.refresh === "function") {
      root.__sprucex.refresh();
    }
  });
}

function mountDirectiveOnMountedComponents(name) {
  collectMountedRoots().forEach((root) => {
    if (root.__sprucex && typeof root.__sprucex.mountDirectiveOnExistingElements === "function") {
      root.__sprucex.mountDirectiveOnExistingElements(name);
    }
  });
}

let bootHookRan = false;
export function runBootHook() {
  if (bootHookRan || typeof window === "undefined") return;
  bootHookRan = true;

  const boot = window.SpruceXBoot;
  if (boot && typeof boot.initTheme === "function") {
    try {
      boot.initTheme();
    } catch (e) {
      console.error("SpruceX boot hook error:", e);
    }
  }
}

function initSpruceXRoot(root, options = {}) {
  if (!root) return null;
  if (root.__sprucex) return root.__sprucex;

  const parentEl = root.parentElement?.closest?.(`[${ATTR_DATA}]`);
  const parentComponent = options.parentComponent || parentEl?.__sprucex || null;
  const locals = options.locals || parentComponent?.getElementLocals?.(root);

  try {
    const comp = new Component(root, { parentComponent, locals });
    root.__sprucex = comp;
    mountedRootRegistry.add(root);
    return comp;
  } catch (e) {
    if (e && e.code === DATA_FACTORY_NOT_READY_ERROR) {
      queuePendingRoot(root);
      return null;
    }
    console.error("SpruceX component init error:", e);
    return null;
  }
}

export function mountElement(el, options = {}) {
  if (typeof el === "string" && typeof document !== "undefined") {
    el = document.querySelector(el);
  }
  if (!el) return null;
  const rootNode = el.getRootNode?.();
  if (rootNode) initAutoCleanup(rootNode);
  return initSpruceXRoot(el, options);
}

export function unmountElement(el) {
  if (typeof el === "string" && typeof document !== "undefined") {
    el = document.querySelector(el);
  }
  if (!el) return;
  if (el.__sprucex) {
    el.__sprucex.destroy();
  }
  mountedRootRegistry.delete(el);
}

export function initSpruceX(root = null) {
  runBootHook();

  const targetRoot = root || (typeof document !== "undefined" ? document : null);
  if (!targetRoot || typeof targetRoot.querySelectorAll !== "function") return;

  const roots = [];
  if (targetRoot.nodeType === 1 && targetRoot.hasAttribute?.(ATTR_DATA)) {
    roots.push(targetRoot);
  }
  targetRoot.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => roots.push(el));

  roots.forEach((el) => {
    const lazy = el.hasAttribute(ATTR_LAZY);
    if (!lazy || typeof IntersectionObserver === "undefined") {
      initSpruceXRoot(el);
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            initSpruceXRoot(el);
            io.disconnect();
          }
        });
      });
      io.observe(el);
    }
  });

  if (typeof document !== "undefined" && targetRoot === document) {
    const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
    if (pageRoot && !pageRoot.__sprucex_page) {
      pageRoot.__sprucex_page = true;
      initPageSwapping(pageRoot);
    }

    initBoostingGlobal(document);

    Array.from(document.scripts).forEach((script) => {
      script.__sprucex_executed = true;
    });
  } else {
    initBoostingGlobal(targetRoot);
  }

  initAutoCleanup(targetRoot);
  flushPendingRoots();
}

// ========== Auto-Cleanup (Document + ShadowRoot / Embedded Roots) ==========
function initAutoCleanup(targetRoot = null) {
  if (typeof MutationObserver === "undefined") return;
  const observeTarget =
    targetRoot && targetRoot !== document
      ? targetRoot
      : typeof document !== "undefined"
        ? document.body
        : null;
  if (!observeTarget || observedCleanupRoots.has(observeTarget)) return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => {
        // Moving a keyed row also emits a removal record. Only dispose nodes
        // that are still detached when the observer runs.
        if (node.nodeType !== 1 || node.isConnected) return;

        if (node.__sprucex) {
          node.__sprucex.destroy();
          mountedRootRegistry.delete(node);
        }

        node.querySelectorAll?.(`[${ATTR_DATA}]`).forEach((el) => {
          if (!el.isConnected && el.__sprucex) {
            el.__sprucex.destroy();
            mountedRootRegistry.delete(el);
          }
        });
      });
    }
  });

  observer.observe(observeTarget, {
    childList: true,
    subtree: true,
  });
  observedCleanupRoots.set(observeTarget, observer);
}

// ========== Page Navigation & Boosting ==========
let isGlobalNavInitialized = false;

function resolvePageContainer() {
  if (typeof document === "undefined") return null;
  const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
  if (!pageRoot) return null;
  const pageAttr = pageRoot.getAttribute(ATTR_PAGE);
  return pageAttr ? document.querySelector(pageAttr) : document.body;
}

function saveCurrentScrollState() {
  if (typeof history === "undefined" || typeof window === "undefined") return;
  try {
    const prev = history.state && typeof history.state === "object" ? history.state : {};
    history.replaceState(
      { ...prev, url: window.location.href, scrollX: window.scrollX || 0, scrollY: window.scrollY || 0 },
      "",
      window.location.href,
    );
  } catch {
    // Ignore history restrictions in sandboxed iframes
  }
}

function initPageSwapping(root) {
  const pageAttr = root.getAttribute(ATTR_PAGE);
  if (pageAttr === null) return;

  const initialContainer = pageAttr ? document.querySelector(pageAttr) : document.body;
  if (!initialContainer) {
    console.error("SpruceX sx-page target not found:", pageAttr);
    return;
  }

  if (isGlobalNavInitialized) return;
  isGlobalNavInitialized = true;

  document.addEventListener("click", async (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }

    const link = e.target?.closest?.("a[href]");
    if (!link) return;
    if (
      link.hasAttribute(ATTR_PAGE_IGNORE) ||
      link.getAttribute(ATTR_BOOST) === "false"
    ) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (
      link.hasAttribute("download") ||
      (link.getAttribute("target") && link.getAttribute("target") !== "_self")
    ) {
      return;
    }

    try {
      const url = new URL(href, document.baseURI);
      if (url.origin !== window.location.origin) return;

      const container = resolvePageContainer() || initialContainer;
      e.preventDefault();
      saveCurrentScrollState();
      await navigateTo(url.href, container, true, null);
    } catch {
      return;
    }
  });

  window.addEventListener("popstate", async (e) => {
    const container = resolvePageContainer() || initialContainer;
    const savedScroll =
      e.state && typeof e.state.scrollY === "number"
        ? { x: e.state.scrollX || 0, y: e.state.scrollY }
        : null;
    await navigateTo(window.location.href, container, false, savedScroll);
  });
}

function initBoostingGlobal(scopeRoot = document) {
  if (!scopeRoot || typeof scopeRoot.querySelectorAll !== "function") return;
  scopeRoot.querySelectorAll(`[${ATTR_BOOST}]`).forEach((el) => {
    if (el.__sprucex_boost || el.getAttribute(ATTR_BOOST) === "false") return;
    el.__sprucex_boost = true;

    const boostOn = el.getAttribute(ATTR_BOOST_ON) || "mouseenter";
    const events = boostOn.split(/\s+/);

    if (el.tagName === "A") {
      events.forEach((evt) => {
        el.addEventListener(evt, () => prefetchLink(el.href), {
          passive: true,
          once: true,
        });
      });
    } else {
      events.forEach((evt) => {
        el.addEventListener(
          evt,
          (e) => {
            const link = e.target.closest?.("a[href]");
            if (
              link &&
              !link.__sprucex_prefetched &&
              link.getAttribute(ATTR_BOOST) !== "false" &&
              !link.hasAttribute(ATTR_PAGE_IGNORE)
            ) {
              link.__sprucex_prefetched = true;
              prefetchLink(link.href);
            }
          },
          { passive: true },
        );
      });

      el.addEventListener(
        "focusin",
        (e) => {
          const link = e.target.closest?.("a[href]");
          if (
            link &&
            !link.__sprucex_prefetched &&
            link.getAttribute(ATTR_BOOST) !== "false" &&
            !link.hasAttribute(ATTR_PAGE_IGNORE)
          ) {
            link.__sprucex_prefetched = true;
            prefetchLink(link.href);
          }
        },
        { passive: true },
      );
    }
  });
}

async function navigateTo(url, container, pushState = true, restoreScroll = null) {
  const targetUrl = new URL(url, window.location.href);
  const href = targetUrl.href;
  const navigationId = ++latestNavigationId;
  const startTime = performance.now();

  if (activeNavigationController) {
    try {
      activeNavigationController.abort();
    } catch {
      // Ignore abort errors
    }
    activeNavigationController = null;
  }

  const beforeEvent = new CustomEvent("sprucex:page-before", {
    detail: { url: href },
    bubbles: true,
    cancelable: true,
  });
  if (!document.dispatchEvent(beforeEvent)) return;

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  activeNavigationController = controller;

  try {
    let html = getCachedPage(href);

    if (!html) {
      if (container) container.style.opacity = container.style.opacity || "1";
      html = await fetchPage(href, controller?.signal);
    }
    if (navigationId !== latestNavigationId) return;

    if (!html) throw new Error("Empty response");

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    let newContent;
    const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
    const targetSelector = pageRoot?.getAttribute(ATTR_PAGE);

    if (targetSelector) {
      newContent = doc.querySelector(targetSelector);
    }
    if (!newContent) {
      newContent = doc.body;
    }

    const applyDomUpdate = () => {
      const newTitle = doc.querySelector("title");
      if (newTitle) document.title = newTitle.textContent;

      reinitializeComponents(container);

      if (container && newContent) {
        morphNodes(container, newContent);

        container.querySelectorAll("script").forEach((script) => {
          if (!script.__sprucex_executed) {
            runScript(script);
          }
        });
      }

      if (pushState) {
        history.pushState({ url: href, scrollX: 0, scrollY: 0 }, "", href);
      }

      initSpruceX();

      let ancestor = container?.parentElement;
      while (ancestor) {
        if (ancestor.__sprucex) {
          ancestor.__sprucex.refresh();
        }
        ancestor = ancestor.parentElement;
      }

      initBoostingGlobal(document);
    };

    const useViewTransition =
      (Component.viewTransitions || pageRoot?.hasAttribute(ATTR_PAGE_TRANSITION)) &&
      typeof document.startViewTransition === "function";

    if (useViewTransition) {
      await document.startViewTransition(applyDomUpdate).finished;
    } else {
      applyDomUpdate();
    }

    if (navigationId !== latestNavigationId) return;
    if (restoreScroll) {
      window.scrollTo(restoreScroll.x, restoreScroll.y);
    } else if (targetUrl.hash) {
      const target = document.querySelector(targetUrl.hash);
      if (target) target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }

    document.dispatchEvent(
      new CustomEvent("sprucex:page-after", {
        detail: { url: href, duration: performance.now() - startTime },
        bubbles: true,
      }),
    );
  } catch (error) {
    if (
      navigationId !== latestNavigationId ||
      (error && (error.name === "AbortError" || error.code === 20))
    ) {
      return;
    }
    console.error("SpruceX page navigation error:", error);
    document.dispatchEvent(
      new CustomEvent("sprucex:page-error", {
        detail: { url: href, error },
        bubbles: true,
      }),
    );
    window.location.href = href;
  } finally {
    if (activeNavigationController === controller) {
      activeNavigationController = null;
    }
  }
}

function reinitializeComponents(container) {
  if (!container) return;
  container.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
    if (el.__sprucex) {
      el.__sprucex.destroy();
      mountedRootRegistry.delete(el);
    }
  });
  if (container.hasAttribute(ATTR_DATA) && container.__sprucex) {
    container.__sprucex.destroy();
    mountedRootRegistry.delete(container);
  }
}

async function prefetchLink(href) {
  if (!href) return;

  try {
    const url = new URL(href, document.baseURI);
    if (url.origin !== window.location.origin) return;
    if (url.href === window.location.href) return;

    await fetchPage(url.href);
  } catch {
    // Ignore prefetch errors
  }
}

async function fetchPage(url, signal = undefined) {
  const cached = getCachedPage(url);
  if (cached) return cached;

  if (!signal && pendingFetches.has(url)) {
    return pendingFetches.get(url);
  }

  const fetchPromise = (async () => {
    try {
      const options = { headers: { "X-SpruceX-Request": "true" } };
      if (signal) options.signal = signal;
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      if (pageCache.size >= MAX_PAGE_CACHE_SIZE) {
        const oldestKey = pageCache.keys().next().value;
        pageCache.delete(oldestKey);
      }
      pageCache.set(url, {
        html,
        timestamp: Date.now(),
      });

      return html;
    } finally {
      pendingFetches.delete(url);
    }
  })();

  if (!signal) {
    pendingFetches.set(url, fetchPromise);
  }
  return fetchPromise;
}

function getCachedPage(url) {
  const entry = pageCache.get(url);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > PAGE_CACHE_TTL) {
    pageCache.delete(url);
    return null;
  }

  return entry.html;
}

function runScript(script) {
  if (
    script.type &&
    script.type !== "text/javascript" &&
    script.type !== "application/javascript" &&
    script.type !== "module"
  ) {
    return;
  }

  const newScript = document.createElement("script");
  Array.from(script.attributes).forEach((attr) => {
    newScript.setAttribute(attr.name, attr.value);
  });
  if (newScript.src) {
    newScript.addEventListener(
      "load",
      () => {
        flushPendingRoots();
        refreshAllMountedComponents();
      },
      { once: true },
    );
    newScript.addEventListener("error", () => flushPendingRoots(), {
      once: true,
    });
  }
  newScript.textContent = script.textContent;
  newScript.__sprucex_executed = true;
  script.replaceWith(newScript);
  if (!newScript.src) {
    queueMicrotask(() => flushPendingRoots());
  }
}

export function createSpruceXApi(extras = {}) {
  return {
    ...extras,
    init: initSpruceX,
    mount: mountElement,
    unmount: unmountElement,
    store: initStore,
    removeStore,
    markRaw,
    toRaw,
    shallow,
    computed,
    effect,
    stop,
    nextTick(fn) {
      const promise = new Promise((resolve) => {
        const schedule =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb) => setTimeout(cb, 16);
        schedule(() => resolve());
      });
      return typeof fn === "function" ? promise.then(fn) : promise;
    },
    data(name, factory) {
      if (arguments.length === 1 && typeof name === "string") {
        return getDataFactory(name);
      }
      const result = registerDataFactory(name, factory);
      flushPendingRoots();
      return result;
    },
    directive(name, handler) {
      if (arguments.length === 1 && typeof name === "string") {
        return getDirective(name);
      }
      const registered = registerDirective(name, handler);
      mountDirectiveOnMountedComponents(name.startsWith("sx-") ? name.slice(3) : name);
      return registered;
    },
    inspect(root = null) {
      return collectMountedRoots(root).map((r) => ({
        el: r,
        state: r.__sprucex?.state || null,
      }));
    },
    config(newCfg) {
      if (!newCfg || typeof newCfg !== "object") return;
      Object.assign(Component, newCfg);
      if ("csp" in newCfg) {
        setCspMode(Boolean(newCfg.csp));
      }
    },
    navigate(url) {
      const container = resolvePageContainer() || document.body;
      return navigateTo(new URL(url, window.location.href).href, container);
    },
    prefetch(url) {
      return prefetchLink(url);
    },
    clearCache() {
      pageCache.clear();
    },
    morph(target, source) {
      if (typeof target === "string") target = document.querySelector(target);
      if (typeof source === "string") {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${source}</div>`, "text/html");
        source = doc.body.firstChild;
      }
      if (target && source) morphNodes(target, source);
    },
    animate(el, options = {}) {
      if (typeof el === "string") el = document.querySelector(el);
      if (!el) return null;

      const aa = getAutoAnimate();
      if (!aa) {
        console.warn(
          "SpruceX: auto-animate library not found. Include it via script tag or npm.",
        );
        return null;
      }

      return aa(el, options);
    },
    setAutoAnimate,
    integration(name, integration) {
      if (arguments.length === 1 && typeof name === "string") {
        return getIntegration(name);
      }
      const registered = registerIntegration(name, integration);
      refreshAllMountedComponents();
      return registered;
    },
  };
}

export {
  Component,
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  stop,
  morphNodes,
  registerDirective,
  getDirective,
};
