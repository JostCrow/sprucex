import { getStore } from "../store/index.js";
import { cspEval, cspExec } from "./csp-eval.js";

// Function cache for compiled expressions (bounded to prevent memory leaks)
const MAX_CACHE_SIZE = 500;
const evalFnCache = new Map();
const execFnCache = new Map();
const SIMPLE_PATH_RE = /^(!)?\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)$/;
const SIMPLE_LITERAL_KEYWORDS = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "this", "window", "document", "globalThis",
]);
const BLOCKED_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

let cspModeOverride = false;
let evalBlockedDetected = false;

export function setCspMode(enabled) {
  cspModeOverride = !!enabled;
}

export function isCspMode() {
  return cspModeOverride || evalBlockedDetected;
}

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

function buildMagics(scope) {
  const storeAccessor = scope.storeAccessor || getStore;
  const nextTick =
    typeof scope.nextTick === "function"
      ? scope.nextTick.bind(scope)
      : (fn) => Promise.resolve().then(() => fn?.());
  const dispatch =
    typeof scope.dispatch === "function"
      ? scope.dispatch.bind(scope)
      : (name, detail) => {
          const target = scope.currentEl || scope.root;
          if (!target) return false;
          return target.dispatchEvent(
            new CustomEvent(name, { detail, bubbles: true, cancelable: true }),
          );
        };
  return {
    $state: scope.state,
    $event: scope.lastEvent || null,
    $refs: scope.refs,
    $emit: scope.emit,
    $store: storeAccessor,
    $locals: scope.locals || {},
    $el: scope.currentEl || scope.root || null,
    $nextTick: nextTick,
    $dispatch: dispatch,
    $parent: scope.parentComponent?.state || null,
  };
}

// Fast-path for simple identifier / dot-path lookups (e.g. `count`, `user.name`, `!isOpen`).
// Avoids `with(...)` deoptimization, saves cache slots, and works under strict CSP.
const FAST_EVAL_MISS = Symbol("fastEvalMiss");

function tryFastEval(expr, scope, extra) {
  const trimmed = typeof expr === "string" ? expr.trim() : "";
  if (!trimmed) return FAST_EVAL_MISS;

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  const match = SIMPLE_PATH_RE.exec(trimmed);
  if (!match) return FAST_EVAL_MISS;

  const negate = Boolean(match[1]);
  const segments = match[2].split(".");
  const rootName = segments[0];

  if (SIMPLE_LITERAL_KEYWORDS.has(rootName)) return FAST_EVAL_MISS;

  const locals = scope.locals || {};
  const state = scope.state;
  let value;

  if (extra && rootName in extra) {
    value = extra[rootName];
  } else if (rootName === "$el") {
    value = scope.currentEl || scope.root || null;
  } else if (rootName === "$refs") {
    value = scope.refs;
  } else if (rootName === "$event") {
    value = scope.lastEvent || null;
  } else if (rootName === "$parent") {
    value = scope.parentComponent?.state || null;
  } else if (rootName === "$state") {
    value = state;
  } else if (rootName === "$locals") {
    value = locals;
  } else if (locals && rootName in locals) {
    value = locals[rootName];
  } else if (state && rootName in state) {
    value = state[rootName];
  } else {
    return FAST_EVAL_MISS;
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (BLOCKED_SEGMENTS.has(seg)) return undefined;
    if (value == null) {
      throw new TypeError(`Cannot read properties of ${value} (reading '${seg}')`);
    }
    value = value[seg];
  }

  return negate ? !value : value;
}

function isCspEvalError(err) {
  if (!err) return false;
  if (err instanceof EvalError) return true;
  const msg = String(err.message || "");
  return /unsafe-eval|Content Security Policy|Refused to evaluate/i.test(msg);
}

export function evalInScope(expr, scope, extra = {}) {
  const fast = tryFastEval(expr, scope, extra);
  if (fast !== FAST_EVAL_MISS) return fast;

  const locals = scope.locals || {};
  const magics = buildMagics(scope);

  if (scope.csp || isCspMode()) {
    try {
      return cspEval(expr, { state: scope.state, locals, magics, extra });
    } catch (e) {
      if (scope.debug) {
        console.error("SpruceX expression error:", expr, e);
      }
      throw e;
    }
  }

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
        "$el",
        "$nextTick",
        "$dispatch",
        "$parent",
        ...extraKeys,
        `with($state){ with($locals){ return (${expr}); } }`,
      );
      boundedCacheSet(evalFnCache, cacheKey, fn);
    } catch (e) {
      if (isCspEvalError(e)) {
        evalBlockedDetected = true;
        return cspEval(expr, { state: scope.state, locals, magics, extra });
      }
      if (scope.debug) {
        console.error("SpruceX expression compile error:", expr, e);
      }
      throw e;
    }
  }

  try {
    return fn(
      magics.$state,
      magics.$event,
      magics.$refs,
      magics.$emit,
      magics.$store,
      magics.$locals,
      magics.$el,
      magics.$nextTick,
      magics.$dispatch,
      magics.$parent,
      ...Object.values(extra),
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
  } catch (_e) {
    if (fallbackExpr) {
      try {
        return evalInScope(fallbackExpr, scope);
      } catch (e2) {
        console.error(
          "SpruceX fallback expression error:",
          fallbackExpr,
          e2,
        );
      }
    }
    return undefined;
  }
}

export function execInScope(stmt, scope, extra = {}) {
  const locals = scope.locals || {};
  const magics = buildMagics(scope);

  if (scope.csp || isCspMode()) {
    try {
      cspExec(stmt, { state: scope.state, locals, magics, extra });
    } catch (e) {
      console.error("SpruceX statement error:", stmt, e);
    }
    return;
  }

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
        "$el",
        "$nextTick",
        "$dispatch",
        "$parent",
        ...extraKeys,
        `with($state){ with($locals){ ${stmt} } }`,
      );
      boundedCacheSet(execFnCache, cacheKey, fn);
    } catch (e) {
      if (isCspEvalError(e)) {
        evalBlockedDetected = true;
        try {
          cspExec(stmt, { state: scope.state, locals, magics, extra });
        } catch (cspErr) {
          console.error("SpruceX statement error:", stmt, cspErr);
        }
        return;
      }
      console.error("SpruceX statement compile error:", stmt, e);
      return;
    }
  }

  try {
    fn(
      magics.$state,
      magics.$event,
      magics.$refs,
      magics.$emit,
      magics.$store,
      magics.$locals,
      magics.$el,
      magics.$nextTick,
      magics.$dispatch,
      magics.$parent,
      ...Object.values(extra),
    );
  } catch (e) {
    console.error("SpruceX statement error:", stmt, e);
  }
}
