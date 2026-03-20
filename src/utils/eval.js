
import { getStore } from "../store/index.js";

// Function cache for compiled expressions (bounded to prevent memory leaks)
const MAX_CACHE_SIZE = 500;
const evalFnCache = new Map();
const execFnCache = new Map();

function boundedCacheSet(cache, key, value) {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Evict oldest 25% of entries
    const evictCount = Math.ceil(MAX_CACHE_SIZE / 4);
    const iter = cache.keys();
    for (let i = 0; i < evictCount; i++) {
      const oldest = iter.next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(key, value);
}

export function evalInScope(expr, scope, extra = {}) {
  const locals = scope.locals || {};
  const extraKeys = Object.keys(extra);
  const cacheKey = expr + "|" + extraKeys.join(",");
  const storeAccessor = scope.storeAccessor || getStore;

  let fn = evalFnCache.get(cacheKey);
  if (!fn) {
    try {
      fn = new Function(
        "$state",
        "$event",
        "$refs",
        "$emit",
        "$store",
        "$locals",
        ...extraKeys,
        `with($state){ with($locals){ return (${expr}); } }`
      );
      boundedCacheSet(evalFnCache, cacheKey, fn);
    } catch (e) {
      if (scope.debug) {
        console.error("SpruceX expression compile error:", expr, e);
      }
      throw e;
    }
  }

  try {
    return fn(
      scope.state,
      scope.lastEvent || null,
      scope.refs,
      scope.emit,
      storeAccessor,
      locals,
      ...Object.values(extra)
    );
  } catch (e) {
    if (scope.debug) {
      console.error("SpruceX expression error:", expr, e);
    }
    throw e;
  }
}

export function safeEval(expr, scope, fallbackExpr) {
  try {
    return evalInScope(expr, scope);
  } catch (e) {
    if (fallbackExpr) {
      try {
        return evalInScope(fallbackExpr, scope);
      } catch (e2) {
        console.error(
          "SpruceX fallback expression error:",
          fallbackExpr,
          e2
        );
      }
    }
    return undefined;
  }
}

export function execInScope(stmt, scope, extra = {}) {
  const locals = scope.locals || {};
  const extraKeys = Object.keys(extra);
  const cacheKey = stmt + "|" + extraKeys.join(",");
  const storeAccessor = scope.storeAccessor || getStore;

  let fn = execFnCache.get(cacheKey);
  if (!fn) {
    try {
      fn = new Function(
        "$state",
        "$event",
        "$refs",
        "$emit",
        "$store",
        "$locals",
        ...extraKeys,
        `with($state){ with($locals){ ${stmt} } }`
      );
      boundedCacheSet(execFnCache, cacheKey, fn);
    } catch (e) {
      console.error("SpruceX statement compile error:", stmt, e);
      return;
    }
  }

  try {
    fn(
      scope.state,
      scope.lastEvent || null,
      scope.refs,
      scope.emit,
      storeAccessor,
      locals,
      ...Object.values(extra)
    );
  } catch (e) {
    console.error("SpruceX statement error:", stmt, e);
  }
}
