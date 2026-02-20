
import { isClass } from "../utils/helpers.js";

// Deep reactive proxy for nested objects
export function createDeepReactiveProxy(obj, onChange, visited = new WeakSet()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (visited.has(obj)) return obj;
  visited.add(obj);

  // Wrap arrays
  if (Array.isArray(obj)) {
    const methods = [
      "push",
      "pop",
      "shift",
      "unshift",
      "splice",
      "sort",
      "reverse"
    ];
    methods.forEach(method => {
      const original = obj[method];
      if (typeof original === "function") {
        obj[method] = function (...args) {
          const result = original.apply(this, args);
          onChange();
          return result;
        };
      }
    });
    // Make array elements reactive
    obj.forEach((item, i) => {
      if (item && typeof item === "object") {
        obj[i] = createDeepReactiveProxy(item, onChange, visited);
      }
    });
  } else {
    // Make object properties reactive
    Object.keys(obj).forEach(key => {
      if (obj[key] && typeof obj[key] === "object") {
        obj[key] = createDeepReactiveProxy(obj[key], onChange, visited);
      }
    });
  }

  const handler = {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value === "function" && !isClass(value)) {
        return value.bind(receiver);
      }
      return value;
    },
    set(target, key, value, receiver) {
      const old = target[key];
      // Make new nested objects reactive
      if (value && typeof value === "object") {
        value = createDeepReactiveProxy(value, onChange, new WeakSet());
      }
      const ok = Reflect.set(target, key, value, receiver);
      if (old !== value) {
        onChange(key, value, old);
      }
      return ok;
    },
    deleteProperty(target, key) {
      const ok = Reflect.deleteProperty(target, key);
      onChange();
      return ok;
    }
  };

  return new Proxy(obj, handler);
}

export function createReactiveState(raw, onChange) {
  const watchers = raw.watch || {};
  if (watchers && typeof watchers === "object") {
    delete raw.watch;
  }

  const notify = (key, value, old) => {
    onChange(key, value, old);
    if (watchers && typeof watchers[key] === "function") {
      try {
        watchers[key].call(proxy, value, old);
      } catch (e) {
        console.error("SpruceX watcher error on", key, e);
      }
    }
  };

  const proxy = createDeepReactiveProxy(raw, notify);

  // Note: Original code had:
  // const proxy = createDeepReactiveProxy(raw, notify);
  // return { proxy, watchers };
  // And notify used 'proxy' in watchers[key].call(proxy...).
  // In the original, 'proxy' variable was available to 'notify' because 'notify' was defined before 'proxy',
  // but 'proxy' is assigned after 'notify' is created.
  // Wait, ES const is block scoped but not hoisted.
  // In original code (lines 255-267):
  /*
    const notify = ... watchers[key].call(proxy, ...) ...
    const proxy = createDeepReactiveProxy(raw, notify);
    return { proxy, watchers };
  */
  // This works because 'notify' is called LATER, after 'proxy' is initialized.

  return { proxy, watchers };
}
