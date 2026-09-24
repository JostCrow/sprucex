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
