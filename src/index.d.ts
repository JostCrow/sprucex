export interface SpruceXComponent<State extends Record<string, unknown> = Record<string, unknown>> {
  readonly root: HTMLElement;
  readonly state: State;
  readonly locals: Record<string, unknown>;
  readonly refs: Record<string, Element>;
  readonly parentComponent: SpruceXComponent | null;
  readonly isDestroyed: boolean;
  evaluateExpressionOrLiteral(expression: string | null): unknown;
  assignStateValue(expression: string | null, value: unknown): void;
  scheduleUpdate(coarse?: boolean): void;
  nextTick(fn?: () => void): Promise<void>;
  emit(name: string, detail?: unknown): void;
  dispatch(name: string, detail?: unknown): boolean;
  refresh(): void;
  destroy(): void;
}

export interface SpruceXDirectiveContext<
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly el: Element;
  readonly name: string;
  readonly attr: string;
  readonly expression: string;
  readonly expr: string;
  readonly modifiers: string[];
  readonly component: SpruceXComponent<State>;
  evaluate(expression?: string): unknown;
  evaluateOrLiteral(expression?: string): unknown;
  effect(fn: () => void): () => void;
  cleanup(fn: () => void): void;
}

export type SpruceXDirectiveHandler<
  State extends Record<string, unknown> = Record<string, unknown>,
> = (el: Element, context: SpruceXDirectiveContext<State>) => void | (() => void);

export interface SpruceXIntegration {
  preserveOnSwap?: boolean;
  setup?(component: SpruceXComponent): void;
  scan?(component: SpruceXComponent, el: Element): void;
  update?(component: SpruceXComponent): void;
  unmount?(component: SpruceXComponent, el: Element): void;
  teardown?(component: SpruceXComponent): void;
}

export interface SpruceXRequestContext {
  url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly options: RequestInit;
  readonly el: Element;
  readonly component: SpruceXComponent;
}

export interface SpruceXResponseContext {
  readonly response: Response;
  readonly url: string;
  readonly method: string;
  readonly el: Element;
  readonly component: SpruceXComponent;
}

export interface SpruceXConfig {
  csrfCookieName?: string;
  csrfHeaderName?: string;
  baseUrl?: string;
  credentials?: RequestCredentials;
  headers?:
    | HeadersInit
    | ((info: { url: string; method: string; el: Element }) => HeadersInit | undefined);
  beforeRequest?: (
    ctx: SpruceXRequestContext,
  ) => boolean | void | Promise<boolean | void>;
  afterResponse?: (ctx: SpruceXResponseContext) => void | Promise<void>;
  debug?: boolean;
  csp?: boolean;
  viewTransitions?: boolean;
  [key: string]: unknown;
}

export interface SpruceXStoreOptions {
  persist?: boolean;
  syncTabs?: boolean;
}

export interface SpruceXInspectEntry {
  el: Element;
  state: Record<string, unknown> | null;
}

export interface ReactiveEffectRunner<T = unknown> {
  (): T;
  stop(): void;
}

export interface ComputedRef<T = unknown> {
  readonly value: T;
  stop(): void;
}

export interface SpruceXCoreApi {
  init(root?: Document | Element | ShadowRoot | null): void;
  mount(
    el: string | Element,
    options?: { parentComponent?: SpruceXComponent | null; locals?: Record<string, unknown> },
  ): SpruceXComponent | null;
  unmount(el: string | Element): void;
  store<T extends Record<string, unknown>>(
    name: string,
    value: T,
    options?: SpruceXStoreOptions,
  ): T;
  removeStore(name: string): void;
  markRaw<T>(value: T): T;
  toRaw<T>(value: T): T;
  shallow<T>(value: T): T;
  computed<T>(getter: () => T): ComputedRef<T>;
  effect<T = unknown>(
    fn: () => T,
    options?: { lazy?: boolean; scheduler?: () => void },
  ): ReactiveEffectRunner<T>;
  stop(runner: ReactiveEffectRunner): void;
  nextTick(fn?: () => void): Promise<void>;
  data(name: string): unknown;
  data(factories: Record<string, unknown>): Record<string, unknown>;
  data<Args extends unknown[], Result>(
    name: string,
    factory: (...args: Args) => Result,
  ): (...args: Args) => Result;
  directive(name: string): SpruceXDirectiveHandler | undefined;
  directive(name: string, handler: SpruceXDirectiveHandler): SpruceXDirectiveHandler;
  inspect(root?: Document | Element | ShadowRoot | null): SpruceXInspectEntry[];
  config(newCfg?: SpruceXConfig): void;
  navigate(url: string): Promise<void> | void;
  prefetch(url: string): Promise<string | void> | void;
  clearCache(): void;
  morph(target: string | Element, source: string | Element): void;
  animate(
    el: string | Element,
    options?: Record<string, unknown>,
  ): unknown | null;
  setAutoAnimate(autoAnimate: unknown): void;
  integration(name: string): SpruceXIntegration | undefined;
  integration(name: string, integration: SpruceXIntegration): SpruceXIntegration;
}

export interface SpruceXApi extends SpruceXCoreApi {
  createSortableIntegration: typeof createSortableIntegration;
  createNativeSortableAdapter: typeof createNativeSortableAdapter;
  createGridStackIntegration: typeof createGridStackIntegration;
}

export const SpruceX: SpruceXApi;

export function initSpruceX(root?: Document | Element | ShadowRoot | null): void;
export function mountElement(
  el: string | Element,
  options?: { parentComponent?: SpruceXComponent | null; locals?: Record<string, unknown> },
): SpruceXComponent | null;
export function unmountElement(el: string | Element): void;
export function markRaw<T>(value: T): T;
export function toRaw<T>(value: T): T;
export function shallow<T>(value: T): T;
export function computed<T>(getter: () => T): ComputedRef<T>;
export function effect<T = unknown>(
  fn: () => T,
  options?: { lazy?: boolean; scheduler?: () => void },
): ReactiveEffectRunner<T>;
export function stop(runner: ReactiveEffectRunner): void;
export function registerDirective(
  name: string,
  handler: SpruceXDirectiveHandler,
): SpruceXDirectiveHandler;
export function getDirective(name: string): SpruceXDirectiveHandler | undefined;
export function createGridStackIntegration(): SpruceXIntegration;

export default SpruceX;

declare global {
  interface ElementEventMap {
    'sprucex:sortable:before': CustomEvent<SortableChange>;
    'sprucex:sortable:change': CustomEvent<SortableChange>;
  }
  interface Window {
    SpruceX: SpruceXApi;
    SpruceXBoot?: {
      initTheme?: () => void;
      autoInit?: boolean;
      [key: string]: unknown;
    };
  }
}

export interface SortableConfig {
  items: Record<string, unknown>[];
  /** Item property containing a unique string or number. Default: id. */
  id?: string;
  containerId: string;
  group?: string;
  disabled?: boolean;
}
export interface SortableChange {
  readonly itemId: string;
  readonly oldIndex: number;
  readonly newIndex: number;
  readonly fromContainerId: string;
  readonly toContainerId: string;
  readonly input: 'api' | 'keyboard' | 'pointer';
}
export interface SortableAdapterContext {
  readonly el: Element;
  items(): Element[];
  containerId(): string;
  /** Index in the destination array after removal. Returns false when rejected. */
  move(
    itemId: string | number,
    toContainerId: string,
    newIndex: number,
    input?: SortableChange['input'],
  ): boolean;
}
export type SortableAdapter = (context: SortableAdapterContext) => {
  update?(): void;
  destroy(): void;
};
export function createSortableIntegration(options?: {
  adapter?: SortableAdapter;
}): SpruceXIntegration;
export function createNativeSortableAdapter(): SortableAdapter;
