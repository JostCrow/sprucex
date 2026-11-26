import {
  ATTR_GRIDSTACK,
  ATTR_GRIDSTACK_OPTIONS,
  ATTR_GRIDSTACK_OPTION_PREFIX,
  ATTR_GRIDSTACK_ON_CHANGE,
  ATTR_GRIDSTACK_ON_ADDED,
  ATTR_GRIDSTACK_ON_REMOVED,
  ATTR_GRIDSTACK_ON_DRAGSTOP,
  ATTR_GRIDSTACK_ON_RESIZESTOP,
} from "../constants.js";
import { safeEval } from "../utils/eval.js";

function parseGridOptionValue(component, raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return true;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) return asNum;

  const evaluated = safeEval(trimmed, component);
  return evaluated === undefined ? trimmed : evaluated;
}

function buildGridOptions(component, binding) {
  const options = {};
  const { el, gridExpr, gridOptionsExpr } = binding;

  if (gridExpr && gridExpr.trim() && gridExpr.trim() !== "true") {
    const evaluated = safeEval(gridExpr, component);
    if (evaluated && typeof evaluated === "object" && !Array.isArray(evaluated)) {
      Object.assign(options, evaluated);
    }
  }

  if (gridOptionsExpr) {
    const evaluated = safeEval(gridOptionsExpr, component);
    if (evaluated && typeof evaluated === "object" && !Array.isArray(evaluated)) {
      Object.assign(options, evaluated);
    }
  }

  Array.from(el.attributes)
    .filter((attr) => attr.name.startsWith(ATTR_GRIDSTACK_OPTION_PREFIX))
    .forEach((attr) => {
      const rawName = attr.name.slice(ATTR_GRIDSTACK_OPTION_PREFIX.length);
      if (!rawName) return;

      const optionName = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[optionName] = parseGridOptionValue(component, attr.value);
    });

  return options;
}

function serializeGridNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => ({
    id: node?.id ?? node?.el?.id ?? null,
    x: node?.x,
    y: node?.y,
    w: node?.w,
    h: node?.h,
    minW: node?.minW,
    minH: node?.minH,
    maxW: node?.maxW,
    maxH: node?.maxH,
  }));
}

export function createGridStackIntegration() {
  const instancesMap = new WeakMap();
  const warnedComponents = new WeakSet();

  const getInstances = (component) => {
    let map = instancesMap.get(component);
    if (!map) {
      map = new Map();
      instancesMap.set(component, map);
    }
    return map;
  };

  const destroyGridElement = (component, el) => {
    const map = getInstances(component);
    const entry = map.get(el);
    if (entry) {
      entry.cleanups.forEach((fn) => fn());
      if (entry.grid && typeof entry.grid.destroy === "function") {
        entry.grid.destroy(false);
      }
      map.delete(el);
    }
    if (Array.isArray(component.gridBindings)) {
      component.gridBindings = component.gridBindings.filter((b) => b.el !== el);
    }
  };

  return {
    preserveOnSwap: true,
    setup(component) {
      if (!Array.isArray(component.gridBindings)) {
        component.gridBindings = [];
      }
    },
    scan(component, el) {
      if (!el.hasAttribute(ATTR_GRIDSTACK)) return;
      if (!Array.isArray(component.gridBindings)) {
        component.gridBindings = [];
      }
      if (component.gridBindings.some((b) => b.el === el)) return;

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
      const bindings = component.gridBindings || [];
      const instances = getInstances(component);

      // Prune any disconnected grid elements automatically
      for (const el of Array.from(instances.keys())) {
        if (!el.isConnected) {
          destroyGridElement(component, el);
        }
      }

      bindings.forEach((binding) => {
        const { el } = binding;
        if (!el.isConnected || instances.has(el)) return;

        if (
          typeof window === "undefined" ||
          !window.GridStack ||
          typeof window.GridStack.init !== "function"
        ) {
          if (!warnedComponents.has(component)) {
            warnedComponents.add(component);
            console.warn(
              "SpruceX: sx-gridstack requires GridStack on window.GridStack.",
            );
          }
          return;
        }

        const options = buildGridOptions(component, binding);
        const grid = window.GridStack.init(options, el);
        const cleanups = [];

        const bindInto = (eventName, targetExpr) => {
          if (!targetExpr) return;
          const handler = (_event, nodes = []) => {
            const value = serializeGridNodes(nodes);
            component.assignStateValue(targetExpr, value);
            el.dispatchEvent(
              new CustomEvent(`sprucex:gridstack:${eventName}`, {
                detail: value,
                bubbles: true,
              }),
            );
          };

          grid.on(eventName, handler);
          cleanups.push(() => {
            if (typeof grid.off === "function") {
              grid.off(eventName, handler);
            }
          });
        };

        bindInto("change", binding.onChangeInto);
        bindInto("added", binding.onAddedInto);
        bindInto("removed", binding.onRemovedInto);
        bindInto("dragstop", binding.onDragstopInto);
        bindInto("resizestop", binding.onResizestopInto);

        instances.set(el, { grid, cleanups });
      });
    },
    unmount(component, el) {
      destroyGridElement(component, el);
    },
    teardown(component) {
      const instances = getInstances(component);
      for (const el of Array.from(instances.keys())) {
        destroyGridElement(component, el);
      }
      component.gridBindings = [];
    },
  };
}
