import {
  ATTR_ON_PREFIX,
  ATTR_TOGGLE,
  DELEGATED_EVENTS,
} from "../constants.js";
import { execInScope } from "../utils/eval.js";

const SYSTEM_KEY_MODIFIERS = new Set(["ctrl", "alt", "shift", "meta", "cmd"]);
const NON_KEY_MODIFIERS = new Set([
  "prevent",
  "stop",
  "self",
  "window",
  "document",
  "once",
  "outside",
  "passive",
  "capture",
  "debounce",
  "throttle",
  ...SYSTEM_KEY_MODIFIERS,
]);

const KEY_ALIASES = {
  esc: "escape",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  return: "enter",
};

function parseModifierDuration(mods, keyword, fallbackMs) {
  const idx = mods.indexOf(keyword);
  if (idx === -1) return null;
  const next = mods[idx + 1];
  if (next) {
    const match = String(next).match(/^(\d+)(?:ms)?$/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return fallbackMs;
}

function isDurationToken(mods, idx) {
  if (idx <= 0) return false;
  const prev = mods[idx - 1];
  return (prev === "debounce" || prev === "throttle") && /^\d+(?:ms)?$/i.test(mods[idx]);
}

function matchesKeyboardModifiers(ev, mods) {
  if (mods.includes("ctrl") && !ev.ctrlKey) return false;
  if (mods.includes("alt") && !ev.altKey) return false;
  if (mods.includes("shift") && !ev.shiftKey) return false;
  if ((mods.includes("meta") || mods.includes("cmd")) && !ev.metaKey) return false;

  const keyFilters = [];
  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (NON_KEY_MODIFIERS.has(mod) || isDurationToken(mods, i)) continue;
    keyFilters.push(KEY_ALIASES[mod] ?? mod);
  }

  if (keyFilters.length > 0) {
    const actualKey = String(ev.key || "").toLowerCase();
    if (!keyFilters.includes(actualKey)) return false;
  }

  return true;
}

export function wrapThrottled(component, fn, throttleMs) {
  if (!throttleMs || throttleMs <= 0) return fn;
  let lastRun = 0;
  let trailingTimer = null;

  const handler = (...args) => {
    const now = Date.now();
    const remaining = throttleMs - (now - lastRun);
    if (remaining <= 0) {
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        component.debounceTimers.delete(trailingTimer);
        trailingTimer = null;
      }
      lastRun = now;
      if (!component.isDestroyed) fn(...args);
    } else if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        component.debounceTimers.delete(trailingTimer);
        trailingTimer = null;
        lastRun = Date.now();
        if (!component.isDestroyed) fn(...args);
      }, remaining);
      component.debounceTimers.add(trailingTimer);
    }
  };

  handler.cancel = () => {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      component.debounceTimers.delete(trailingTimer);
      trailingTimer = null;
    }
  };

  return handler;
}

export function ensureDelegatedEvent(component, eventName) {
  if (!component._delegatedEventTypes) {
    component._delegatedEventTypes = new Set();
  }
  if (component._delegatedEventTypes.has(eventName)) return;
  component._delegatedEventTypes.add(eventName);

  const handler = (e) => handleDelegatedEvent(component, e);
  component.root.addEventListener(eventName, handler);
  if (!component._delegatedCleanups) component._delegatedCleanups = [];
  component._delegatedCleanups.push(() =>
    component.root.removeEventListener(eventName, handler),
  );
}

export function handleDelegatedEvent(component, e) {
  let cur = e.target;
  let propagationStopped = false;
  const originalStop = e.stopPropagation;

  e.stopPropagation = function () {
    propagationStopped = true;
    originalStop.apply(this, arguments);
  };

  try {
    while (cur && cur.nodeType === 1) {
      const list = cur.__sx_handlers && cur.__sx_handlers[e.type];
      if (list && list.length) {
        // Iterate a snapshot so .once removals during dispatch don't skip siblings.
        const snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) {
          const entry = snapshot[i];
          if (entry.component !== component) continue;
          if (!propagationStopped) {
            entry.handler(e);
          }
        }
      }

      if (propagationStopped) break;
      if (cur === component.root) break;
      cur = cur.parentNode;
    }
  } finally {
    e.stopPropagation = originalStop;
  }
}

export function scanEventDirectives(component, el, locals) {
  const toggleKey = el.getAttribute(ATTR_TOGGLE);
  if (toggleKey) {
    const handler = (ev) => {
      component.lastEvent = ev;
      component.withContext(el, locals, () =>
        execInScope(`${toggleKey} = !(${toggleKey})`, component),
      );
    };
    ensureDelegatedEvent(component, "click");
    if (!el.__sx_handlers) el.__sx_handlers = {};
    if (!el.__sx_handlers.click) el.__sx_handlers.click = [];
    el.__sx_handlers.click.push({ handler, component });
    component.eventHandlers.push({ el, event: "click", handler, delegated: true });
  }

  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith(ATTR_ON_PREFIX)) continue;

    const full = attr.name.slice(ATTR_ON_PREFIX.length);
    const [eventName, ...rawMods] = full.split(".");
    const mods = rawMods.map((m) => m.toLowerCase());
    const expr = attr.value;

    const isOnce = mods.includes("once");
    const isOutside = mods.includes("outside");
    const isPassive = mods.includes("passive");
    const isCapture = mods.includes("capture");
    const debounceMs = parseModifierDuration(mods, "debounce", 250);
    const throttleMs = parseModifierDuration(mods, "throttle", 250);

    let record = null;

    const runAction = (ev) => {
      if (component.isDestroyed) return;
      component.lastEvent = ev;
      component.withContext(el, locals, () => {
        execInScope(expr, component);
      });
    };

    let wrappedAction = runAction;
    if (debounceMs) wrappedAction = component.wrapDebounced(wrappedAction, debounceMs);
    else if (throttleMs) wrappedAction = wrapThrottled(component, wrappedAction, throttleMs);

    const handler = (ev) => {
      if (isOutside) {
        if (!el.isConnected || el.contains(ev.target)) return;
      }
      if (mods.includes("self") && ev.target !== el) return;

      if (typeof KeyboardEvent !== "undefined" && ev instanceof KeyboardEvent) {
        if (!matchesKeyboardModifiers(ev, mods)) return;
      }

      if (mods.includes("prevent") && !isPassive) ev.preventDefault();
      if (mods.includes("stop")) ev.stopPropagation();

      if (isOnce && record) {
        component.removeEventHandler(record);
        component.eventHandlers = component.eventHandlers.filter((r) => r !== record);
      }

      wrappedAction(ev);
    };

    handler.cancel = () => wrappedAction.cancel?.();

    const eventTarget = isOutside || mods.includes("document")
      ? document
      : mods.includes("window")
        ? window
        : el;

    const canDelegate =
      eventTarget === el &&
      !isPassive &&
      !isCapture &&
      DELEGATED_EVENTS.has(eventName);

    if (canDelegate) {
      ensureDelegatedEvent(component, eventName);
      if (!el.__sx_handlers) el.__sx_handlers = {};
      if (!el.__sx_handlers[eventName]) el.__sx_handlers[eventName] = [];
      el.__sx_handlers[eventName].push({ handler, component });
      record = { el, event: eventName, handler, delegated: true };
      component.eventHandlers.push(record);
    } else {
      const listenerOpts =
        isPassive || isCapture ? { passive: isPassive, capture: isCapture } : undefined;
      eventTarget.addEventListener(eventName, handler, listenerOpts);
      record = {
        el: eventTarget,
        sourceEl: el,
        event: eventName,
        handler,
        options: listenerOpts,
      };
      component.eventHandlers.push(record);
    }
  }
}
