import SpruceX, { SpruceX as named, type SpruceXComponent } from "sprucex";

const counter = SpruceX.data("counter", (initial: number, label = "Count") => ({ initial, label }));
const initial: number = counter(3).initial;
// @ts-expect-error Factory argument types must be preserved.
counter("three");
const bindings = new WeakMap<SpruceXComponent, Array<{ el: Element; expression: string }>>();
named.integration("uppercase", {
  setup(component) { bindings.set(component, []); },
  scan(component, el) {
    const expression = el.getAttribute("sx-uppercase");
    if (expression) bindings.get(component)?.push({ el, expression });
  },
  update(component) {
    for (const { el, expression } of bindings.get(component) || []) {
      el.textContent = String(component.evaluateExpressionOrLiteral(expression)).toUpperCase();
    }
    component.assignStateValue("ready", true);
    component.emit("ready", { initial });
  },
  teardown(component) { bindings.delete(component); },
});
SpruceX.store("counter", { count: initial }).count++;
SpruceX.removeStore("counter");
window.SpruceX = SpruceX;

import { createSortableIntegration, createNativeSortableAdapter, type SortableChange, type SortableConfig } from 'sprucex';
const sorting: SortableConfig = { items: [{ id: 1 }], containerId: 'rows' };
named.integration('sortable', createSortableIntegration({ adapter: createNativeSortableAdapter() }));
SpruceX.createSortableIntegration({ adapter(context) {
  const accepted: boolean = context.move('one', sorting.containerId, 0, 'keyboard');
  // @ts-expect-error Invalid input capability.
  context.move('one', 'rows', 0, 'magic');
  return { update() { context.items(); }, destroy() { void accepted; } };
} });
const change: SortableChange = { itemId:'one', oldIndex:0, newIndex:1, fromContainerId:'a', toContainerId:'a', input:'api' };
// @ts-expect-error Event positions are readonly.
change.newIndex = 2;
document.createElement('div').addEventListener('sprucex:sortable:change', event => {
  const position: number = event.detail.newIndex;
  void position;
});

import CoreSpruceX from "sprucex/core";
import { createSortableIntegration as createSubpathSortable } from "sprucex/sortable";
import { createGridStackIntegration } from "sprucex/gridstack";

SpruceX.config({
  baseUrl: "https://api.example.com",
  csrfHeaderName: "X-XSRF-TOKEN",
  credentials: "include",
  csp: false,
  beforeRequest(ctx) {
    ctx.headers.set("X-Trace", "1");
  },
});

const rawSeries = SpruceX.markRaw([{ x: 1, y: 2 }]);
const unwrapped = SpruceX.toRaw(rawSeries);
const derived = SpruceX.computed(() => unwrapped.length);
const len: number = derived.value;
derived.stop();

SpruceX.directive("chart", (el, { evaluate, effect, cleanup, modifiers }) => {
  void modifiers;
  const stopEff = effect(() => {
    el.setAttribute("data-size", String(evaluate()));
  });
  cleanup(() => stopEff());
});

CoreSpruceX.init(document.body);
CoreSpruceX.integration("sortable", createSubpathSortable());
CoreSpruceX.integration("gridstack", createGridStackIntegration());
void len;
