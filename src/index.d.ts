export interface SpruceXIntegration {
  setup?(component: unknown): void;
  scan?(component: unknown, el: Element): void;
  update?(component: unknown): void;
  teardown?(component: unknown): void;
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
  data(name: string): unknown;
  data(name: string, factory: (...args: unknown[]) => unknown): unknown;
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
