import {
  ATTR_DATA,
  ATTR_PAGE,
  ATTR_BOOST,
  ATTR_BOOST_ON,
  ATTR_LAZY,
  ATTR_LOCAL,
} from "./constants.js";
import { globalStores, initStore, storeSubscribers } from "./store/index.js";
import { Component } from "./core/component.js";
import { setAutoAnimate, getAutoAnimate } from "./utils/animations.js";
import { morphNodes } from "./utils/morph.js";
import { walk } from "./utils/helpers.js";
import {
  DATA_FACTORY_NOT_READY_ERROR,
  getDataFactory,
  registerDataFactory,
} from "./utils/data-factories.js";

// Page/boost cache for prefetching
const pageCache = new Map();
const pendingFetches = new Map();
const PAGE_CACHE_TTL = 30000; // 30 seconds
const pendingRoots = new Set();
let pendingRootFlushQueued = false;
let pendingRootPollTimer = null;

function ensurePendingRootPolling() {
  if (pendingRootPollTimer || pendingRoots.size === 0) return;
  pendingRootPollTimer = setInterval(() => {
    flushPendingRoots();
  }, 100);
}

function flushPendingRoots() {
  pendingRoots.forEach((root) => {
    if (!root || !root.isConnected || root.__sprucex) {
      pendingRoots.delete(root);
      return;
    }
    const comp = initSpruceXRoot(root);
    if (comp) {
      pendingRoots.delete(root);
    }
  });

  if (pendingRoots.size === 0 && pendingRootPollTimer) {
    clearInterval(pendingRootPollTimer);
    pendingRootPollTimer = null;
  }
}

function queuePendingRoot(root) {
  if (!root || root.__sprucex) return;
  const wasPending = pendingRoots.has(root);
  pendingRoots.add(root);
  ensurePendingRootPolling();

  if (wasPending || pendingRootFlushQueued) return;
  pendingRootFlushQueued = true;
  queueMicrotask(() => {
    pendingRootFlushQueued = false;
    flushPendingRoots();
  });
}

export const SpruceX = {
  init: initSpruceX,
  store: initStore,
  data(name, factory) {
    if (arguments.length === 1 && typeof name === "string") {
      return getDataFactory(name);
    }
    const result = registerDataFactory(name, factory);
    flushPendingRoots();
    return result;
  },
  inspect() {
    const roots = document.querySelectorAll(`[${ATTR_DATA}]`);
    return Array.from(roots).map((r) => ({
      el: r,
      state: r.__sprucex?.state || null,
    }));
  },
  config(newCfg) {
    // No-op for now as config was mostly unused except strict mode
    // Object.assign(config, newCfg || {});
  },
  navigate(url) {
    const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
    const targetSelector = pageRoot?.getAttribute(ATTR_PAGE);
    const container = targetSelector
      ? document.querySelector(targetSelector)
      : document.body;
    return navigateTo(url, container);
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
};

// Expose globally
if (typeof window !== "undefined") {
  window.SpruceX = SpruceX;
  if (!window.SpruceXBoot) {
    window.SpruceXBoot = {};
  }
}

let bootHookRan = false;
function runBootHook() {
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

function initSpruceXRoot(root) {
  if (root.__sprucex) return root.__sprucex;
  try {
    const comp = new Component(root);
    root.__sprucex = comp;
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

export function initSpruceX() {
  runBootHook();

  const roots = document.querySelectorAll(`[${ATTR_DATA}]`);
  roots.forEach((root) => {
    const lazy = root.hasAttribute(ATTR_LAZY);
    if (!lazy) {
      initSpruceXRoot(root);
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            initSpruceXRoot(root);
            io.disconnect();
          }
        });
      });
      io.observe(root);
    }
  });

  // Initialize page swapping
  const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
  if (pageRoot && !pageRoot.__sprucex_page) {
    pageRoot.__sprucex_page = true;
    initPageSwapping(pageRoot);
  }

  // Initialize boosting
  initBoostingGlobal();

  // Initialize auto-cleanup
  initAutoCleanup();
  flushPendingRoots();

  // Mark all initial scripts as executed
  Array.from(document.scripts).forEach((script) => {
    script.__sprucex_executed = true;
  });
}

// ========== Feature: Auto-Cleanup (Memory Leak Fix) ==========
let cleanupObserver = null;
function initAutoCleanup() {
  if (cleanupObserver) return;

  cleanupObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => {
        if (node.nodeType !== 1) return; // Elements only

        // Check if the node itself is a component root
        if (node.__sprucex) {
          node.__sprucex.destroy();
        }

        // Check for nested component roots
        node.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
          if (el.__sprucex) {
            el.__sprucex.destroy();
          }
        });
      });
    }
  });

  if (document.body) {
    cleanupObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

let isGlobalNavInitialized = false;

function initPageSwapping(root) {
  const pageAttr = root.getAttribute(ATTR_PAGE);
  if (pageAttr === null) return;

  const container = pageAttr ? document.querySelector(pageAttr) : document.body;
  if (!container) {
    console.error("SpruceX sx-page target not found:", pageAttr);
    return;
  }

  if (isGlobalNavInitialized) return;
  isGlobalNavInitialized = true;

  // Intercept link clicks
  document.addEventListener("click", async (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (
      link.hasAttribute("download") ||
      link.getAttribute("target") === "_blank"
    )
      return;

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;

      e.preventDefault();
      await navigateTo(url.href, container);
    } catch {
      return;
    }
  });

  // Handle back/forward
  window.addEventListener("popstate", async () => {
    await navigateTo(window.location.href, container, false);
  });
}

function initBoostingGlobal() {
  // Find all boost-enabled elements
  document.querySelectorAll(`[${ATTR_BOOST}]`).forEach((el) => {
    if (el.__sprucex_boost) return;
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
            const link = e.target.closest("a[href]");
            if (link && !link.__sprucex_prefetched) {
              link.__sprucex_prefetched = true;
              prefetchLink(link.href);
            }
          },
          { passive: true },
        );
      });

      // Also prefetch on focus for accessibility
      el.addEventListener(
        "focusin",
        (e) => {
          const link = e.target.closest("a[href]");
          if (link && !link.__sprucex_prefetched) {
            link.__sprucex_prefetched = true;
            prefetchLink(link.href);
          }
        },
        { passive: true },
      );
    }
  });
}

async function navigateTo(url, container, pushState = true) {
  const startTime = performance.now();

  // Dispatch before event
  const beforeEvent = new CustomEvent("sprucex:page-before", {
    detail: { url },
    bubbles: true,
    cancelable: true,
  });
  if (!document.dispatchEvent(beforeEvent)) return;

  try {
    // Check cache first
    let html = getCachedPage(url);

    if (!html) {
      // Show loading state without flickering
      if (container) container.style.opacity = container.style.opacity || "1";
      html = await fetchPage(url);
    }

    if (!html) throw new Error("Empty response");

    // Parse the response
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract content - find matching container or use body
    let newContent;
    const pageRoot = document.querySelector("[sx-page]");
    const targetSelector = pageRoot?.getAttribute(ATTR_PAGE);

    if (targetSelector) {
      newContent = doc.querySelector(targetSelector);
    }
    if (!newContent) {
      newContent = doc.body;
    }

    // Update title
    const newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent;

    // Destroy old components BEFORE morph (prevents interference)
    reinitializeComponents(container);

    // Merge or replace content
    if (container && newContent) {
      morphNodes(container, newContent);

      // Execute new scripts
      container.querySelectorAll("script").forEach((script) => {
        if (!script.__sprucex_executed) {
          runScript(script);
        }
      });
    }

    // Update URL
    if (pushState) {
      history.pushState({ url }, "", url);
    }

    // Reinitialize all components in container
    reinitializeComponents(container);

    // Also reinit any components outside the container (just in case)
    initSpruceX();

    // Refresh ancestor components to re-scan bindings in the new content
    let ancestor = container.parentElement;
    while (ancestor) {
      if (ancestor.__sprucex) {
        ancestor.__sprucex.refresh();
      }
      ancestor = ancestor.parentElement;
    }

    initBoostingGlobal();

    // Scroll to top or to hash
    const hash = new URL(url).hash;
    if (hash) {
      const target = document.querySelector(hash);
      if (target) target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }

    // Dispatch after event
    document.dispatchEvent(
      new CustomEvent("sprucex:page-after", {
        detail: { url, duration: performance.now() - startTime },
        bubbles: true,
      }),
    );
  } catch (error) {
    console.error("SpruceX page navigation error:", error);
    document.dispatchEvent(
      new CustomEvent("sprucex:page-error", {
        detail: { url, error },
        bubbles: true,
      }),
    );
    // Fallback to regular navigation
    window.location.href = url;
  }
}

function reinitializeComponents(container) {
  if (!container) return;
  // Destroy ALL components on the page first? Or just inside container?
  // The original logic seemed to potentially nuke everything.
  // Let's safe side: check elements inside container.
  container.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
    if (el.__sprucex) {
      el.__sprucex.destroy();
    }
  });
  // Also check container itself
  if (container.hasAttribute(ATTR_DATA) && container.__sprucex) {
    container.__sprucex.destroy();
  }
}

async function prefetchLink(href) {
  if (!href) return;

  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.href === window.location.href) return;

    await fetchPage(url.href);
  } catch {
    // Ignore prefetch errors
  }
}

async function fetchPage(url) {
  // Check cache
  const cached = getCachedPage(url);
  if (cached) return cached;

  // Check pending
  if (pendingFetches.has(url)) {
    return pendingFetches.get(url);
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, {
        headers: { "X-SpruceX-Request": "true" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // Cache it
      pageCache.set(url, {
        html,
        timestamp: Date.now(),
      });

      return html;
    } finally {
      pendingFetches.delete(url);
    }
  })();

  pendingFetches.set(url, fetchPromise);
  return fetchPromise;
}

function getCachedPage(url) {
  const entry = pageCache.get(url);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > PAGE_CACHE_TTL) {
    pageCache.delete(url);
    return null;
  }

  return entry.html;
}

// Auto-start
if (typeof document !== "undefined") {
  runBootHook();
  window.addEventListener("load", () => {
    flushPendingRoots();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSpruceX);
  } else {
    initSpruceX();
  }
}

function runScript(script) {
  // Ignore non-executable scripts
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
    newScript.addEventListener("load", () => flushPendingRoots(), {
      once: true,
    });
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
