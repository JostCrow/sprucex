import {
  createSortableIntegration,
  createNativeSortableAdapter,
} from "./integrations/sortable.js";
import { createGridStackIntegration } from "./integrations/gridstack.js";
import { ensureBuiltInIntegrationsRegistered } from "./integrations/builtins.js";
import {
  createSpruceXApi,
  initSpruceX,
  flushPendingRoots,
  runBootHook,
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  stop,
  mountElement,
  unmountElement,
  registerDirective,
  getDirective,
} from "./core/runtime.js";

ensureBuiltInIntegrationsRegistered();

export const SpruceX = createSpruceXApi({
  createSortableIntegration,
  createNativeSortableAdapter,
  createGridStackIntegration,
});

export {
  createSortableIntegration,
  createNativeSortableAdapter,
  createGridStackIntegration,
  initSpruceX,
  mountElement,
  unmountElement,
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  stop,
  registerDirective,
  getDirective,
};

export default SpruceX;

// Expose globally
if (typeof window !== "undefined") {
  window.SpruceX = SpruceX;
  if (!window.SpruceXBoot) {
    window.SpruceXBoot = {};
  }
}

// Auto-start unless explicitly disabled via window.SpruceXBoot.autoInit = false
if (typeof document !== "undefined") {
  runBootHook();
  const autoInit =
    typeof window === "undefined" || window.SpruceXBoot?.autoInit !== false;

  if (autoInit) {
    window.addEventListener("load", () => {
      flushPendingRoots();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => initSpruceX());
    } else {
      initSpruceX();
    }
  }
}
