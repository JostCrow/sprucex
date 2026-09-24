import { isClass } from "../utils/helpers.js";

// Cache both raw objects and their proxies within each reactive graph. Lazy
// wrapping preserves aliases and cycles without rewriting the caller's data.
export function createDeepReactiveProxy(obj, onChange, cache = new WeakMap()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (cache.has(obj)) return cache.get(obj);

  const proxy = new Proxy(obj, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      // Proxy invariants require an exact value for frozen data properties.
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (descriptor && !descriptor.configurable && "value" in descriptor && !descriptor.writable) {
        return value;
      }
      if (value && typeof value === "object") {
        return createDeepReactiveProxy(value, onChange, cache);
      }
      if (typeof value === "function" && !isClass(value)) return value.bind(receiver);
      return value;
    },
    set(target, key, value, receiver) {
      const old = Reflect.get(target, key, receiver);
      const ok = Reflect.set(target, key, value, receiver);
      if (ok && !Object.is(old, value)) onChange(key, value, old);
      return ok;
    },
    deleteProperty(target, key) {
      const existed = Reflect.has(target, key);
      const ok = Reflect.deleteProperty(target, key);
      if (ok && existed) onChange();
      return ok;
    },
  });
  cache.set(obj, proxy);
  cache.set(proxy, proxy);
  return proxy;
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
