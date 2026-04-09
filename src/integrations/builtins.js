import {
  ATTR_GRIDSTACK,
  ATTR_GRIDSTACK_OPTIONS,
  ATTR_GRIDSTACK_ON_CHANGE,
  ATTR_GRIDSTACK_ON_ADDED,
  ATTR_GRIDSTACK_ON_REMOVED,
  ATTR_GRIDSTACK_ON_DRAGSTOP,
  ATTR_GRIDSTACK_ON_RESIZESTOP,
} from "../constants.js";
import { getIntegration, registerIntegration } from "./index.js";

export function ensureBuiltInIntegrationsRegistered() {
  if (!getIntegration("gridstack")) {
    registerIntegration("gridstack", {
      scan(component, el) {
        if (!el.hasAttribute(ATTR_GRIDSTACK)) return;

        component.gridBindings.push({
          el,
          gridExpr: el.getAttribute(ATTR_GRIDSTACK),
          gridOptionsExpr: el.getAttribute(ATTR_GRIDSTACK_OPTIONS),
          onChangeInto: el.getAttribute(ATTR_GRIDSTACK_ON_CHANGE),
          onAddedInto: el.getAttribute(ATTR_GRIDSTACK_ON_ADDED),
          onRemovedInto: el.getAttribute(ATTR_GRIDSTACK_ON_REMOVED),
          onDragstopInto: el.getAttribute(ATTR_GRIDSTACK_ON_DRAGSTOP),
          onResizestopInto: el.getAttribute(ATTR_GRIDSTACK_ON_RESIZESTOP),
        });
      },
      update(component) {
        component.initGridBindings();
      },
      teardown(component) {
        component.teardownGridBindings();
      },
    });
  }
}
