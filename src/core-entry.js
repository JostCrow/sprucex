import {
  createSpruceXApi,
  initSpruceX,
  mountElement,
  unmountElement,
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
} from "./core/runtime.js";

// Tree-shakeable core entrypoint: does not auto-initialize on import
// and does not bundle optional integrations (sortable, gridstack).
export const SpruceX = createSpruceXApi();

export {
  initSpruceX,
  mountElement,
  unmountElement,
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

export default SpruceX;
