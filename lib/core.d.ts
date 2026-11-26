export type {
  SpruceXComponent,
  SpruceXDirectiveContext,
  SpruceXDirectiveHandler,
  SpruceXIntegration,
  SpruceXRequestContext,
  SpruceXResponseContext,
  SpruceXConfig,
  SpruceXStoreOptions,
  SpruceXInspectEntry,
  ReactiveEffectRunner,
  ComputedRef,
  SpruceXCoreApi,
} from "./sprucex.js";
import type { SpruceXCoreApi } from "./sprucex.js";
export {
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
} from "./sprucex.js";
export declare const SpruceX: SpruceXCoreApi;
export default SpruceX;
