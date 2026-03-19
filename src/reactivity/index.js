
import { isClass } from "../utils/helpers.js";

// Mutating array methods that need to trigger reactivity
const ARRAY_MUTATING_METHODS = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse"
]);

// Deep reactive proxy for nested objects
export function createDeepReactiveProxy(obj, onChange, visited = new WeakSet()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (visited.has(obj)) return obj;
  visited.add(obj);

  // Make nested values reactive (without monkey-patching arrays)
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      if (item && typeof item === "object") {
        obj[i] = createDeepReactiveProxy(item, onChange, visited);
      }
    });
  } else {
    Object.keys(obj).forEach(key => {
      if (obj[key] && typeof obj[key] === "object") {
        obj[key] = createDeepReactiveProxy(obj[key], onChange, visited);
      }
    });
  }

  const handler = {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);

      // Intercept array mutating methods and return wrapped versions
      if (Array.isArray(target) && ARRAY_MUTATING_METHODS.has(key) && typeof value === "function") {
        return function (...args) {
          // Make new arguments reactive before inserting
          const reactiveArgs = args.map(arg => {
            if (arg && typeof arg === "object") {
              return createDeepReactiveProxy(arg, onChange, new WeakSet());
            }
            return arg;
          });
          const result = value.apply(target, reactiveArgs);
          onChange();
          return result;
        };
      }

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

  return { proxy, watchers };
}
