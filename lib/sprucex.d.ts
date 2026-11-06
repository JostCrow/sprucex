export interface SpruceXComponent<State extends Record<string, unknown> = Record<string, unknown>> {
  readonly root: HTMLElement;
  readonly state: State;
  readonly locals: Record<string, unknown>;
  readonly refs: Record<string, Element>;
  readonly isDestroyed: boolean;
  evaluateExpressionOrLiteral(expression: string | null): unknown;
  assignStateValue(expression: string | null, value: unknown): void;
  scheduleUpdate(): void;
  emit(name: string, detail?: unknown): void;
}

export interface SpruceXIntegration {
  setup?(component: SpruceXComponent): void;
  scan?(component: SpruceXComponent, el: Element): void;
  update?(component: SpruceXComponent): void;
  teardown?(component: SpruceXComponent): void;
}

export interface SpruceXInspectEntry {
  el: Element;
  state: Record<string, unknown> | null;
}

export interface SpruceXApi {
  createSortableIntegration: typeof createSortableIntegration;
  createNativeSortableAdapter: typeof createNativeSortableAdapter;
  init(): void;
  store<T extends Record<string, unknown>>(
    name: string,
    value: T,
    options?: { persist?: boolean },
  ): T;
  removeStore(name: string): void;
  data(name: string): unknown;
  data<Args extends unknown[], Result>(
    name: string,
    factory: (...args: Args) => Result,
  ): (...args: Args) => Result;
  inspect(): SpruceXInspectEntry[];
  config(newCfg?: Record<string, unknown>): void;
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

export const SpruceX: SpruceXApi;

export function initSpruceX(): void;

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
  move(itemId: string | number, toContainerId: string, newIndex: number, input?: SortableChange['input']): boolean;
}
export type SortableAdapter = (context: SortableAdapterContext) => {
  update?(): void;
  destroy(): void;
};
export function createSortableIntegration(options?: { adapter?: SortableAdapter }): SpruceXIntegration;
export function createNativeSortableAdapter(): SortableAdapter;
