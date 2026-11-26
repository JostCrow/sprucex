import {
  ATTR_TEXT,
  ATTR_HTML,
  ATTR_SHOW,
  ATTR_CLOAK,
  ATTR_BIND_PREFIX,
  ATTR_CLASS,
  ATTR_STYLE,
  ATTR_MEMO,
  ATTR_MODEL,
  ATTR_MODEL_PREFIX,
  ATTR_ERROR_FALLBACK,
  ATTR_INIT,
  ATTR_EFFECT,
} from "../constants.js";
import { safeEval, execInScope } from "../utils/eval.js";
import { effect } from "../reactivity/index.js";

const ENUMERATED_BOOLEAN_ATTRS = new Set([
  "draggable",
  "spellcheck",
  "contenteditable",
]);

const LIVE_VALUE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const UNSET = Symbol("sprucex.unset");

function isEnumeratedBooleanAttr(attr) {
  return attr.startsWith("aria-") || ENUMERATED_BOOLEAN_ATTRS.has(attr);
}

export function scanBindingDirectives(component, el, locals) {
  const hasMemo = el.hasAttribute(ATTR_MEMO);
  const errorFallback = el.getAttribute(ATTR_ERROR_FALLBACK);

  const textExpr = el.getAttribute(ATTR_TEXT);
  if (textExpr && !hasMemo) {
    registerBinding(component, {
      el,
      type: "text",
      expr: textExpr,
      errorFallback,
      locals,
      lastRendered: UNSET,
    });
  }

  const htmlExpr = el.getAttribute(ATTR_HTML);
  if (htmlExpr && !hasMemo) {
    registerBinding(component, {
      el,
      type: "html",
      expr: htmlExpr,
      errorFallback,
      locals,
      lastRendered: UNSET,
    });
  }

  const showExpr = el.getAttribute(ATTR_SHOW);
  if (showExpr) {
    const initialDisplay = el.style?.display && el.style.display !== "none"
      ? el.style.display
      : "";
    registerBinding(component, {
      el,
      type: "show",
      expr: showExpr,
      errorFallback,
      locals,
      initialDisplay,
      lastRendered: UNSET,
    });
  }

  const classExpr = el.getAttribute(ATTR_CLASS);
  if (classExpr) {
    if (!component.originalClasses.has(el)) {
      component.originalClasses.set(el, new Set(Array.from(el.classList)));
    }
    registerBinding(component, {
      el,
      type: "class",
      expr: classExpr,
      errorFallback,
      locals,
      managedClasses: new Set(),
      lastRendered: UNSET,
    });
  }

  const styleExpr = el.getAttribute(ATTR_STYLE);
  if (styleExpr) {
    registerBinding(component, {
      el,
      type: "style",
      expr: styleExpr,
      errorFallback,
      locals,
      managedStyles: new Map(),
      lastRendered: UNSET,
    });
  }

  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith(ATTR_BIND_PREFIX)) {
      const name = attr.name.slice(ATTR_BIND_PREFIX.length);
      registerBinding(component, {
        el,
        type: "bind",
        attr: name,
        expr: attr.value,
        errorFallback,
        locals,
        lastRendered: UNSET,
      });
    }
  }

  // sx-memo
  const memoExpr = el.getAttribute(ATTR_MEMO);
  if (memoExpr && (textExpr || htmlExpr)) {
    let deps = [];
    try {
      const evaluated = safeEval(memoExpr, component);
      if (Array.isArray(evaluated)) deps = evaluated;
    } catch (e) {
      console.error("SpruceX sx-memo parse error:", memoExpr, e);
    }
    component.memoBindings.push({
      el,
      expr: textExpr || htmlExpr,
      type: textExpr ? "text" : "html",
      deps,
      lastVals: null,
      lastResult: null,
      locals,
    });
  }

  // sx-model
  setupModelBinding(component, el, locals);

  // sx-init (one-time element initialization expression)
  const initExpr = el.getAttribute(ATTR_INIT);
  if (initExpr) {
    component.pendingInits.push({ el, expr: initExpr, locals });
  }

  // sx-effect (fine-grained reactive side effect on element)
  const effectExpr = el.getAttribute(ATTR_EFFECT);
  if (effectExpr) {
    registerElementEffect(component, el, effectExpr, locals);
  }

  // sx-cloak (removed once initial render completes)
  if (el.hasAttribute(ATTR_CLOAK)) {
    component.cloakedElements.add(el);
  }
}

export function registerBinding(component, binding) {
  binding.dirty = true;
  binding.tracked = false;

  const runner = effect(
    () => {
      applySingleBinding(component, binding);
    },
    {
      lazy: true,
      scheduler() {
        binding.dirty = true;
        component.dirtyBindings.add(binding);
        component.scheduleUpdate(false);
      },
    },
  );

  binding._runner = runner;
  binding.dispose = () => {
    runner.stop();
    component.dirtyBindings.delete(binding);
  };

  component.bindings.push(binding);
  return binding;
}

function registerElementEffect(component, el, expr, locals) {
  let scheduled = false;
  const runner = effect(
    () => {
      if (component.isDestroyed) return;
      component.withContext(el, locals, () => {
        execInScope(expr, component);
      });
    },
    {
      lazy: true,
      scheduler() {
        if (scheduled || component.isDestroyed) return;
        scheduled = true;
        component.dirtyEffects.add(entry);
        component.scheduleUpdate(false);
      },
    },
  );

  const entry = {
    el,
    locals,
    run() {
      scheduled = false;
      runner();
    },
    dispose() {
      runner.stop();
      component.dirtyEffects.delete(entry);
    },
  };

  component.elementEffects.push(entry);
  // Queue for initial execution during applyInitialRender
  component.dirtyEffects.add(entry);
}

export function runBinding(component, binding) {
  binding.dirty = false;
  binding._runner();
  binding.tracked = binding._runner.effect.deps.length > 0;
}

export function applySingleBinding(component, b) {
  const { el, type, expr, attr, errorFallback, locals } = b;
  component.withContext(el, locals, () => {
    switch (type) {
      case "text": {
        const v = safeEval(expr, component, errorFallback);
        const nextStr =
          v !== null && v !== undefined && typeof v === "object"
            ? JSON.stringify(v)
            : String(v ?? "");
        if (b.lastRendered !== nextStr) {
          b.lastRendered = nextStr;
          el.textContent = nextStr;
        }
        break;
      }
      case "html": {
        const v = safeEval(expr, component, errorFallback);
        const nextStr =
          v !== null && v !== undefined && typeof v === "object"
            ? JSON.stringify(v)
            : String(v ?? "");
        if (b.lastRendered !== nextStr) {
          b.lastRendered = nextStr;
          el.innerHTML = nextStr;
        }
        break;
      }
      case "show": {
        const nextBool = !!safeEval(expr, component, errorFallback);
        if (b.lastRendered !== nextBool) {
          b.lastRendered = nextBool;
          el.style.display = nextBool ? b.initialDisplay || "" : "none";
        }
        break;
      }
      case "bind": {
        const v = safeEval(expr, component, errorFallback);
        if (Object.is(b.lastRendered, v)) break;
        b.lastRendered = v;

        if (isEnumeratedBooleanAttr(attr)) {
          if (v === null || v === undefined) {
            el.removeAttribute(attr);
          } else {
            el.setAttribute(attr, String(v));
          }
          break;
        }

        if (attr === "value" && LIVE_VALUE_TAGS.has(el.tagName)) {
          const strVal = v ?? "";
          if (v === false || v === null || v === undefined) {
            el.removeAttribute("value");
          } else {
            el.setAttribute("value", strVal);
          }
          if (el.value !== String(strVal)) {
            el.value = String(strVal);
          }
          break;
        }

        if (attr === "checked" && el.tagName === "INPUT") {
          const boolVal = !!v;
          if (el.checked !== boolVal) el.checked = boolVal;
          if (boolVal) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
          break;
        }

        if (attr === "indeterminate" && el.tagName === "INPUT") {
          el.indeterminate = !!v;
          break;
        }

        if (v === false || v === null || v === undefined) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, v);
        }
        break;
      }
      case "class": {
        const v = safeEval(expr, component, errorFallback);
        const original = component.originalClasses.get(el) || new Set();

        if (typeof v === "string") {
          if (b.lastRendered === v) break;
          b.lastRendered = v;
          const nextClasses = new Set(v.split(/\s+/).filter(Boolean));
          for (const c of Array.from(el.classList)) {
            if (!original.has(c) && !nextClasses.has(c)) {
              el.classList.remove(c);
            }
          }
          for (const c of nextClasses) {
            if (!el.classList.contains(c)) el.classList.add(c);
          }
          b.managedClasses = nextClasses;
        } else if (v && typeof v === "object") {
          b.lastRendered = UNSET;
          const keys = Object.keys(v);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const active = !!v[k];
            const parts = k.split(/\s+/).filter(Boolean);
            for (let j = 0; j < parts.length; j++) {
              const cls = parts[j];
              if (active) {
                if (!el.classList.contains(cls)) el.classList.add(cls);
                b.managedClasses.add(cls);
              } else {
                if (el.classList.contains(cls)) el.classList.remove(cls);
                b.managedClasses.delete(cls);
              }
            }
          }
        }
        break;
      }
      case "style": {
        const v = safeEval(expr, component, errorFallback);
        if (typeof v === "string") {
          if (b.lastRendered === v) break;
          b.lastRendered = v;
          el.style.cssText = v;
        } else if (v && typeof v === "object") {
          b.lastRendered = UNSET;
          const nextKeys = new Set();
          for (const [prop, rawVal] of Object.entries(v)) {
            const cssProp = prop.startsWith("--")
              ? prop
              : prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
            nextKeys.add(cssProp);
            const strVal = rawVal == null || rawVal === false ? "" : String(rawVal);
            if (b.managedStyles.get(cssProp) !== strVal) {
              if (strVal === "") {
                el.style.removeProperty(cssProp);
              } else {
                el.style.setProperty(cssProp, strVal);
              }
              b.managedStyles.set(cssProp, strVal);
            }
          }
          for (const prevProp of Array.from(b.managedStyles.keys())) {
            if (!nextKeys.has(prevProp)) {
              el.style.removeProperty(prevProp);
              b.managedStyles.delete(prevProp);
            }
          }
        }
        break;
      }
    }
  });
}

export function parseModelBindingConfig(direct, modifierAttrs) {
  const keyExpr = direct || modifierAttrs[0]?.value || null;
  const mods = new Set();
  let debounceMs = null;

  modifierAttrs.forEach((attr) => {
    const parts = attr.name
      .slice(ATTR_MODEL_PREFIX.length)
      .split(".")
      .filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === "debounce-ms") {
        const parsed = Number(attr.value || "200");
        if (Number.isFinite(parsed) && parsed > 0) {
          debounceMs = parsed;
        }
        continue;
      }
      if (part === "debounce") {
        const nextPart = parts[i + 1];
        if (nextPart && /^\d+(?:ms)?$/i.test(nextPart)) {
          const parsed = Number(nextPart.replace(/ms$/i, ""));
          if (Number.isFinite(parsed) && parsed > 0) {
            debounceMs = parsed;
          }
          i++;
        } else {
          debounceMs = 250;
        }
        continue;
      }
      mods.add(part);
    }
  });

  return { keyExpr, mods, debounceMs };
}

export function setupModelBinding(component, el, locals = null) {
  const direct = el.getAttribute(ATTR_MODEL);
  const modifierAttrs = Array.from(el.attributes).filter((a) =>
    a.name.startsWith(ATTR_MODEL_PREFIX),
  );
  if (!direct && modifierAttrs.length === 0) return null;

  const { keyExpr, mods, debounceMs } = parseModelBindingConfig(
    direct,
    modifierAttrs,
  );

  const type = (el.type || "").toLowerCase();
  const isCheckbox = type === "checkbox";
  const isRadio = type === "radio";
  const isSelect = el.tagName === "SELECT";
  const isMultiSelect = isSelect && !!el.multiple;

  const updateDom = () => {
    component.withContext(el, locals, () => {
      const v = safeEval(keyExpr, component);
      if (isCheckbox) {
        const nextChecked = Array.isArray(v) ? v.includes(el.value) : !!v;
        if (el.checked !== nextChecked) el.checked = nextChecked;
      } else if (isRadio) {
        const nextChecked = String(v) === String(el.value);
        if (el.checked !== nextChecked) el.checked = nextChecked;
      } else if (isMultiSelect) {
        const selectedSet = new Set(Array.isArray(v) ? v.map(String) : []);
        Array.from(el.options || []).forEach((opt) => {
          const shouldSelect = selectedSet.has(String(opt.value));
          if (opt.selected !== shouldSelect) opt.selected = shouldSelect;
        });
      } else if (isSelect) {
        const nextVal = String(v ?? "");
        if (el.value !== nextVal) el.value = nextVal;
      } else {
        const nextVal =
          v !== null && v !== undefined && typeof v === "object"
            ? JSON.stringify(v)
            : String(v ?? "");
        if (el.value !== nextVal) el.value = nextVal;
      }
    });
  };

  const applyModifiers = (val) => {
    if (mods.has("trim") && typeof val === "string") val = val.trim();
    if (mods.has("number")) {
      if (val === "" || val === null || val === undefined) {
        return "";
      }
      const n = Number(val);
      if (!Number.isNaN(n)) val = n;
    }
    if (mods.has("boolean")) {
      val = val === "false" || val === "0" ? false : Boolean(val);
    }
    return val;
  };

  const writeBack = (ev) => {
    component.lastEvent = ev;
    component.withContext(el, locals, () => {
      let v;
      if (isCheckbox) {
        const current = safeEval(keyExpr, component);
        if (Array.isArray(current)) {
          const arr = [...current];
          const idx = arr.indexOf(el.value);
          if (el.checked && idx === -1) arr.push(el.value);
          if (!el.checked && idx !== -1) arr.splice(idx, 1);
          v = arr;
        } else {
          v = el.checked;
        }
      } else if (isRadio) {
        if (!el.checked) return;
        v = el.value;
      } else if (isMultiSelect) {
        v = Array.from(el.selectedOptions || []).map((opt) =>
          applyModifiers(opt.value),
        );
        execInScope(`${keyExpr} = __sx_value`, component, { __sx_value: v });
        return;
      } else if (isSelect) {
        v = el.value;
      } else {
        v = el.value;
      }
      v = applyModifiers(v);
      execInScope(`${keyExpr} = __sx_value`, component, { __sx_value: v });
    });
  };

  let eventName = "input";
  if (mods.has("lazy") || isMultiSelect) eventName = "change";

  const handler = component.wrapDebounced(writeBack, debounceMs);
  el.addEventListener(eventName, handler);

  const modelBinding = {
    updateDom,
    locals,
    el,
    event: eventName,
    handler,
    dirty: true,
    tracked: false,
  };

  const runner = effect(
    () => {
      modelBinding.dirty = false;
      updateDom();
    },
    {
      lazy: true,
      scheduler() {
        modelBinding.dirty = true;
        component.dirtyModels.add(modelBinding);
        component.scheduleUpdate(false);
      },
    },
  );

  modelBinding._runner = runner;
  modelBinding.run = () => {
    runner();
    modelBinding.tracked = runner.effect.deps.length > 0;
  };
  modelBinding.dispose = () => {
    runner.stop();
    component.dirtyModels.delete(modelBinding);
  };

  component.eventHandlers.push({ el, event: eventName, handler });
  component.modelBindings.push(modelBinding);

  return modelBinding;
}
