import { isClass, isPlainObjectOrArray } from "../utils/helpers.js";

const ITERATE_KEY = Symbol("sprucex.iterate");
const rawMarked = new WeakSet();
const shallowMarked = new WeakSet();
const proxyToRaw = new WeakMap();

// Fine-grained dependency tracking state
const targetDepsMap = new WeakMap();
const effectStack = [];
let activeEffect = null;

const ARRAY_ITERATING_METHODS = new Set([
  "map", "filter", "forEach", "reduce", "reduceRight", "some", "every",
  "find", "findIndex", "findLast", "findLastIndex", "includes", "indexOf",
  "lastIndexOf", "join", "slice", "concat", "flat", "flatMap", "entries",
  "keys", "values", "toSorted", "toReversed", "toSpliced", "at",
]);

export function markRaw(value) {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    rawMarked.add(value);
  }
  return value;
}

export function shallow(value) {
  if (value !== null && typeof value === "object") {
    shallowMarked.add(value);
  }
  return value;
}

export function toRaw(value) {
  let current = value;
  while (current !== null && typeof current === "object" && proxyToRaw.has(current)) {
    current = proxyToRaw.get(current);
  }
  return current;
}

export function isReactive(value) {
  return value !== null && typeof value === "object" && proxyToRaw.has(value);
}

function cleanupEffect(eff) {
  const { deps } = eff;
  if (!deps.length) return;
  for (let i = 0; i < deps.length; i++) {
    deps[i].delete(eff);
  }
  deps.length = 0;
}

export function track(target, key) {
  if (!activeEffect || !activeEffect.active) return;
  let depsMap = targetDepsMap.get(target);
  if (!depsMap) {
    depsMap = new Map();
    targetDepsMap.set(target, depsMap);
  }
  let dep = depsMap.get(key);
  if (!dep) {
    dep = new Set();
    depsMap.set(key, dep);
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    activeEffect.deps.push(dep);
  }
}

export function trigger(target, key) {
  const depsMap = targetDepsMap.get(target);
  if (!depsMap) return;

  const effectsToRun = new Set();
  const add = (dep) => {
    if (!dep) return;
    dep.forEach((eff) => {
      if (eff !== activeEffect && eff.active) {
        effectsToRun.add(eff);
      }
    });
  };

  if (key !== undefined) {
    add(depsMap.get(key));
  }
  if (key === ITERATE_KEY || Array.isArray(target)) {
    add(depsMap.get(ITERATE_KEY));
  }

  effectsToRun.forEach((eff) => {
    if (eff.scheduler) {
      eff.scheduler(eff);
    } else {
      eff.run();
    }
  });
}

export function effect(fn, options = {}) {
  const eff = {
    fn,
    deps: [],
    active: true,
    scheduler: options.scheduler || null,
    run() {
      if (!eff.active) return fn();
      cleanupEffect(eff);
      effectStack.push(eff);
      activeEffect = eff;
      try {
        return fn();
      } finally {
        effectStack.pop();
        activeEffect = effectStack[effectStack.length - 1] || null;
      }
    },
    stop() {
      if (!eff.active) return;
      cleanupEffect(eff);
      eff.active = false;
    },
  };

  const runner = () => eff.run();
  runner.effect = eff;
  runner.stop = () => eff.stop();

  if (!options.lazy) {
    eff.run();
  }
  return runner;
}

export function stop(runner) {
  if (runner && typeof runner.stop === "function") {
    runner.stop();
  }
}

export function computed(getter) {
  let dirty = true;
  let value;
  let hasDeps = false;
  const ref = { __sprucex_computed: true };

  const runner = effect(getter, {
    lazy: true,
    scheduler() {
      if (!dirty) {
        dirty = true;
        trigger(ref, "value");
      }
    },
  });

  return {
    get value() {
      track(ref, "value");
      if (dirty || !hasDeps) {
        value = runner();
        hasDeps = runner.effect.deps.length > 0;
        dirty = false;
      }
      return value;
    },
    stop() {
      runner.stop();
    },
  };
}

// Cache both raw objects and their proxies within each reactive graph. Lazy
// wrapping preserves aliases and cycles without rewriting the caller's data.
// Only plain objects and arrays are proxied so built-ins (Date, Map, Set,
// TypedArray, DOM nodes, chart/widget class instances) keep their internal slots.
export function createDeepReactiveProxy(
  obj,
  onChange,
  cache = new WeakMap(),
  computedGetters = null,
) {
  if (obj === null || typeof obj !== "object") return obj;
  if (rawMarked.has(obj) || !isPlainObjectOrArray(obj)) return obj;
  if (cache.has(obj)) return cache.get(obj);

  const isShallow = shallowMarked.has(obj);

  const proxy = new Proxy(obj, {
    get(target, key, receiver) {
      if (computedGetters && computedGetters.has(key)) {
        return computedGetters.get(key).value;
      }

      if (activeEffect) {
        if (Array.isArray(target) && (key === Symbol.iterator || ARRAY_ITERATING_METHODS.has(key))) {
          track(target, ITERATE_KEY);
          track(target, "length");
        } else if (typeof key !== "symbol" || key === Symbol.iterator) {
          track(target, key);
        }
      }

      const value = Reflect.get(target, key, receiver);

      if (value !== null && typeof value === "object") {
        // Proxy invariants require returning the exact value for non-configurable,
        // non-writable own data properties.
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (
          descriptor &&
          !descriptor.configurable &&
          "value" in descriptor &&
          !descriptor.writable
        ) {
          return value;
        }
        if (isShallow || rawMarked.has(value) || !isPlainObjectOrArray(value)) {
          return value;
        }
        return createDeepReactiveProxy(value, onChange, cache);
      }

      if (typeof value === "function" && !isClass(value)) {
        return value.bind(receiver);
      }

      return value;
    },

    set(target, key, value, receiver) {
      const rawValue = toRaw(value);
      const isArr = Array.isArray(target);
      const hadKey = isArr
        ? Number(key) < target.length
        : Object.prototype.hasOwnProperty.call(target, key);
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      const old = descriptor && "get" in descriptor
        ? Reflect.get(target, key, receiver)
        : Reflect.get(target, key, target);

      const ok = Reflect.set(target, key, rawValue, receiver);
      if (ok && (!Object.is(old, rawValue) || !hadKey || (isArr && key === "length"))) {
        trigger(target, key);
        if (!hadKey || isArr) {
          trigger(target, ITERATE_KEY);
        }
        onChange?.(key, rawValue, old);
      }
      return ok;
    },

    deleteProperty(target, key) {
      const existed = Reflect.has(target, key);
      const old = existed ? Reflect.get(target, key, target) : undefined;
      const ok = Reflect.deleteProperty(target, key);
      if (ok && existed) {
        trigger(target, key);
        trigger(target, ITERATE_KEY);
        onChange?.(key, undefined, old);
      }
      return ok;
    },

    ownKeys(target) {
      if (activeEffect) {
        track(target, ITERATE_KEY);
      }
      return Reflect.ownKeys(target);
    },
  });

  cache.set(obj, proxy);
  cache.set(proxy, proxy);
  proxyToRaw.set(proxy, obj);
  return proxy;
}

function readPath(obj, segments) {
  let current = obj;
  for (let i = 0; i < segments.length; i++) {
    if (current == null) return undefined;
    current = current[segments[i]];
  }
  return current;
}

export function createReactiveState(raw, onChange) {
  const watchers = raw.watch && typeof raw.watch === "object" ? raw.watch : {};
  if (raw.watch && typeof raw.watch === "object") {
    delete raw.watch;
  }

  const computedGetters = new Map();
  const cache = new WeakMap();
  const proxy = createDeepReactiveProxy(raw, onChange, cache, computedGetters);

  // Auto-memoize own read-only getters on the root state object.
  for (const key of Object.keys(raw)) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (desc && typeof desc.get === "function" && desc.set === undefined) {
      computedGetters.set(
        key,
        computed(() => desc.get.call(proxy)),
      );
    }
  }

  // Path-aware watchers powered by reactive effects:
  // Supports both top-level keys ("search") and dotted paths ("user.name"),
  // without false triggers from identically named nested leaf properties.
  const watcherDisposers = [];
  for (const [watchPath, handler] of Object.entries(watchers)) {
    if (typeof handler !== "function") continue;
    const segments = watchPath.split(".").filter(Boolean);
    if (!segments.length) continue;

    let initialized = false;
    let oldValue;

    const runner = effect(
      () => readPath(proxy, segments),
      {
        scheduler() {
          const nextValue = runner();
          if (!initialized) {
            oldValue = nextValue;
            initialized = true;
            return;
          }
          if (!Object.is(nextValue, oldValue)) {
            const prev = oldValue;
            oldValue = nextValue;
            try {
              handler.call(proxy, nextValue, prev);
            } catch (e) {
              console.error("SpruceX watcher error on", watchPath, e);
            }
          }
        },
      },
    );
    oldValue = runner();
    initialized = true;
    watcherDisposers.push(() => runner.stop());
  }

  const stopWatchers = () => {
    watcherDisposers.forEach((dispose) => dispose());
    watcherDisposers.length = 0;
    computedGetters.forEach((entry) => entry.stop());
    computedGetters.clear();
  };

  return { proxy, watchers, stopWatchers, computedGetters };
}
