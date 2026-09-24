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
  interface Window {
    SpruceX: SpruceXApi;
    SpruceXBoot?: {
      initTheme?: () => void;
      [key: string]: unknown;
    };
  }
}
