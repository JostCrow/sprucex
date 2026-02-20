
import { getStore } from "../store/index.js";

// Function cache for compiled expressions
const evalFnCache = new Map();
const execFnCache = new Map();

export function evalInScope(expr, scope, extra = {}) {
  const locals = scope.locals || {};
  const extraKeys = Object.keys(extra);
  const cacheKey = expr + "|" + extraKeys.join(",");

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
      evalFnCache.set(cacheKey, fn);
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
      getStore, // Changed from direct globalStores access to imported helper
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
      execFnCache.set(cacheKey, fn);
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
      getStore,
      locals,
      ...Object.values(extra)
    );
  } catch (e) {
    console.error("SpruceX statement error:", stmt, e);
  }
}
