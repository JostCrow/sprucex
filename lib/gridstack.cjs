var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// src/integrations/gridstack.js
var exports_gridstack = {};
__export(exports_gridstack, {
  createGridStackIntegration: () => createGridStackIntegration
});
module.exports = __toCommonJS(exports_gridstack);

// src/constants.js
var ATTR_GRIDSTACK = "sx-gridstack";
var ATTR_GRIDSTACK_OPTIONS = "sx-gridstack-options";
var ATTR_GRIDSTACK_OPTION_PREFIX = "sx-gridstack-option:";
var ATTR_GRIDSTACK_ON_CHANGE = "sx-gridstack-on-change";
var ATTR_GRIDSTACK_ON_ADDED = "sx-gridstack-on-added";
var ATTR_GRIDSTACK_ON_REMOVED = "sx-gridstack-on-removed";
var ATTR_GRIDSTACK_ON_DRAGSTOP = "sx-gridstack-on-dragstop";
var ATTR_GRIDSTACK_ON_RESIZESTOP = "sx-gridstack-on-resizestop";
var DELEGATED_EVENTS = new Set([
  "click",
  "dblclick",
  "mousedown",
  "mouseup",
  "input",
  "change",
  "submit",
  "keydown",
  "keyup",
  "keypress",
  "focusin",
  "focusout"
]);

// src/utils/helpers.js
var classCheckCache = new WeakMap;

// src/reactivity/index.js
var ITERATE_KEY = Symbol("sprucex.iterate");
var rawMarked = new WeakSet;
var shallowMarked = new WeakSet;
var proxyToRaw = new WeakMap;
var targetDepsMap = new WeakMap;
var ARRAY_ITERATING_METHODS = new Set([
  "map",
  "filter",
  "forEach",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "includes",
  "indexOf",
  "lastIndexOf",
  "join",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "entries",
  "keys",
  "values",
  "toSorted",
  "toReversed",
  "toSpliced",
  "at"
]);

// src/store/index.js
var globalStores = Object.create(null);
var storeSubscribers = Object.create(null);
var storeCleanups = Object.create(null);
function getStore(name) {
  return globalStores[name];
}

// src/utils/csp-eval.js
var KEYWORDS = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  NaN: NaN,
  Infinity: Infinity
};
var BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function tokenize(source) {
  const tokens = [];
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let val = "";
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < len) {
          const next = source[++i];
          if (next === "n")
            val += `
`;
          else if (next === "r")
            val += "\r";
          else if (next === "t")
            val += "\t";
          else
            val += next;
          i++;
        } else {
          val += source[i++];
        }
      }
      if (source[i] !== quote)
        throw new Error("Unterminated string literal");
      i++;
      tokens.push({ type: "str", value: val });
      continue;
    }
    if (/[0-9]/.test(ch) || ch === "." && /[0-9]/.test(source[i + 1] || "")) {
      let num = "";
      while (i < len && /[0-9.]/.test(source[i]))
        num += source[i++];
      tokens.push({ type: "num", value: Number(num) });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let id = "";
      while (i < len && /[A-Za-z0-9_$]/.test(source[i]))
        id += source[i++];
      tokens.push({ type: "id", value: id });
      continue;
    }
    const three = source.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three });
      i += 3;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    tokens.push({ type: "punc", value: ch });
    i++;
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}
function lookupRoot(name, ctx) {
  if (name in KEYWORDS)
    return { owner: KEYWORDS, key: name, value: KEYWORDS[name], found: true };
  if (name in ctx.extra)
    return { owner: ctx.extra, key: name, value: ctx.extra[name], found: true };
  if (name in ctx.magics)
    return { owner: ctx.magics, key: name, value: ctx.magics[name], found: true };
  if (ctx.locals && name in ctx.locals) {
    return { owner: ctx.locals, key: name, value: ctx.locals[name], found: true };
  }
  if (ctx.state && name in ctx.state) {
    return { owner: ctx.state, key: name, value: ctx.state[name], found: true };
  }
  if (name === "this")
    return { owner: null, key: null, value: ctx.state, found: true };
  if (typeof globalThis !== "undefined" && name in globalThis) {
    return { owner: globalThis, key: name, value: globalThis[name], found: true };
  }
  return { owner: ctx.state, key: name, value: undefined, found: false };
}

class Parser {
  constructor(tokens, ctx) {
    this.tokens = tokens;
    this.pos = 0;
    this.ctx = ctx;
  }
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    return this.tokens[this.pos++];
  }
  match(value) {
    if (this.peek().value === value) {
      this.pos++;
      return true;
    }
    return false;
  }
  expect(value) {
    const tok = this.next();
    if (tok.value !== value) {
      throw new Error(`Expected '${value}' but got '${tok.value}'`);
    }
  }
  parseStatements() {
    let last;
    while (this.peek().type !== "eof") {
      if (this.match(";"))
        continue;
      last = this.parseAssignment();
      this.match(";");
    }
    return last;
  }
  parseExpression() {
    return this.parseAssignment();
  }
  parseAssignment() {
    const startPos = this.pos;
    const lhsRef = this.tryParseLValue();
    const opTok = this.peek();
    if (lhsRef && ["=", "+=", "-=", "*=", "/="].includes(opTok.value)) {
      this.next();
      const rhs = this.parseAssignment();
      if (!lhsRef.owner || BLOCKED_KEYS.has(String(lhsRef.key))) {
        throw new Error("Invalid assignment target");
      }
      if (opTok.value === "=")
        lhsRef.owner[lhsRef.key] = rhs;
      else if (opTok.value === "+=")
        lhsRef.owner[lhsRef.key] += rhs;
      else if (opTok.value === "-=")
        lhsRef.owner[lhsRef.key] -= rhs;
      else if (opTok.value === "*=")
        lhsRef.owner[lhsRef.key] *= rhs;
      else if (opTok.value === "/=")
        lhsRef.owner[lhsRef.key] /= rhs;
      return lhsRef.owner[lhsRef.key];
    }
    if (lhsRef && (opTok.value === "++" || opTok.value === "--")) {
      this.next();
      if (!lhsRef.owner || BLOCKED_KEYS.has(String(lhsRef.key))) {
        throw new Error("Invalid update target");
      }
      const prev = Number(lhsRef.owner[lhsRef.key]);
      lhsRef.owner[lhsRef.key] = opTok.value === "++" ? prev + 1 : prev - 1;
      return prev;
    }
    this.pos = startPos;
    return this.parseTernary();
  }
  tryParseLValue() {
    const tok = this.peek();
    if (tok.type !== "id" || tok.value in KEYWORDS)
      return null;
    this.next();
    let ref = lookupRoot(tok.value, this.ctx);
    while (true) {
      if (this.match(".")) {
        const prop = this.next();
        if (prop.type !== "id")
          return null;
        if (BLOCKED_KEYS.has(prop.value))
          return null;
        const owner = ref.value;
        if (owner == null)
          return null;
        ref = { owner, key: prop.value, value: owner[prop.value], found: true };
      } else if (this.match("[")) {
        const key = this.parseExpression();
        this.expect("]");
        if (BLOCKED_KEYS.has(String(key)))
          return null;
        const owner = ref.value;
        if (owner == null)
          return null;
        ref = { owner, key, value: owner[key], found: true };
      } else {
        break;
      }
    }
    return ref;
  }
  parseTernary() {
    const cond = this.parseNullish();
    if (this.match("?")) {
      const thenBranch = this.parseExpression();
      this.expect(":");
      const elseBranch = this.parseExpression();
      return cond ? thenBranch : elseBranch;
    }
    return cond;
  }
  parseNullish() {
    let left = this.parseOr();
    while (this.match("??")) {
      const right = this.parseOr();
      left = left ?? right;
    }
    return left;
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.match("||")) {
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }
  parseAnd() {
    let left = this.parseEquality();
    while (this.match("&&")) {
      const right = this.parseEquality();
      left = left && right;
    }
    return left;
  }
  parseEquality() {
    let left = this.parseComparison();
    while (["===", "!==", "==", "!="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseComparison();
      if (op === "===")
        left = left === right;
      else if (op === "!==")
        left = left !== right;
      else if (op === "==")
        left = left == right;
      else
        left = left != right;
    }
    return left;
  }
  parseComparison() {
    let left = this.parseAdditive();
    while (["<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAdditive();
      if (op === "<")
        left = left < right;
      else if (op === "<=")
        left = left <= right;
      else if (op === ">")
        left = left > right;
      else
        left = left >= right;
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek().value === "+" || this.peek().value === "-") {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      if (op === "*")
        left = left * right;
      else if (op === "/")
        left = left / right;
      else
        left = left % right;
    }
    return left;
  }
  parseUnary() {
    if (this.match("!"))
      return !this.parseUnary();
    if (this.match("-"))
      return -this.parseUnary();
    if (this.match("+"))
      return +this.parseUnary();
    if (this.peek().type === "id" && this.peek().value === "typeof") {
      this.next();
      return typeof this.parseUnary();
    }
    if (this.peek().value === "++" || this.peek().value === "--") {
      const op = this.next().value;
      const ref = this.tryParseLValue();
      if (!ref || !ref.owner || BLOCKED_KEYS.has(String(ref.key))) {
        throw new Error("Invalid prefix update target");
      }
      const next = Number(ref.owner[ref.key]) + (op === "++" ? 1 : -1);
      ref.owner[ref.key] = next;
      return next;
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let owner = null;
    let value = this.parsePrimary();
    while (true) {
      if (this.match(".") || this.match("?.")) {
        const optional = this.tokens[this.pos - 1].value === "?.";
        const prop = this.next();
        if (prop.type !== "id")
          throw new Error("Expected property name");
        if (BLOCKED_KEYS.has(prop.value)) {
          owner = value;
          value = undefined;
          continue;
        }
        if (value == null) {
          if (optional) {
            owner = null;
            value = undefined;
            continue;
          }
          throw new TypeError(`Cannot read property '${prop.value}' of ${value}`);
        }
        owner = value;
        value = value[prop.value];
      } else if (this.match("[")) {
        const key = this.parseExpression();
        this.expect("]");
        if (BLOCKED_KEYS.has(String(key))) {
          owner = value;
          value = undefined;
          continue;
        }
        owner = value;
        value = value == null ? undefined : value[key];
      } else if (this.match("(")) {
        const args = [];
        if (this.peek().value !== ")") {
          do {
            args.push(this.parseExpression());
          } while (this.match(","));
        }
        this.expect(")");
        if (typeof value !== "function") {
          throw new TypeError("Attempted to call a non-function");
        }
        value = value.apply(owner ?? this.ctx.state, args);
        owner = null;
      } else {
        break;
      }
    }
    return value;
  }
  parsePrimary() {
    const tok = this.peek();
    if (tok.type === "num" || tok.type === "str") {
      this.next();
      return tok.value;
    }
    if (tok.type === "id") {
      this.next();
      const ref = lookupRoot(tok.value, this.ctx);
      if (!ref.found) {
        throw new ReferenceError(`${tok.value} is not defined`);
      }
      return ref.value;
    }
    if (this.match("(")) {
      const val = this.parseExpression();
      this.expect(")");
      return val;
    }
    if (this.match("[")) {
      const arr = [];
      if (this.peek().value !== "]") {
        do {
          if (this.peek().value === "]")
            break;
          arr.push(this.parseExpression());
        } while (this.match(","));
      }
      this.expect("]");
      return arr;
    }
    if (this.match("{")) {
      const obj = {};
      if (this.peek().value !== "}") {
        do {
          if (this.peek().value === "}")
            break;
          const keyTok = this.next();
          const key = keyTok.type === "id" || keyTok.type === "str" || keyTok.type === "num" ? String(keyTok.value) : null;
          if (key === null)
            throw new Error("Invalid object key");
          if (this.match(":")) {
            obj[key] = this.parseExpression();
          } else if (keyTok.type === "id") {
            const ref = lookupRoot(key, this.ctx);
            if (!ref.found)
              throw new ReferenceError(`${key} is not defined`);
            obj[key] = ref.value;
          } else {
            throw new Error("Expected ':' after object key");
          }
        } while (this.match(","));
      }
      this.expect("}");
      return obj;
    }
    throw new Error(`Unexpected token '${tok.value}'`);
  }
}
function cspEval(expr, ctx) {
  const tokens = tokenize(String(expr || ""));
  const parser = new Parser(tokens, ctx);
  const result = parser.parseExpression();
  if (parser.peek().type !== "eof") {
    throw new Error(`Unexpected token '${parser.peek().value}'`);
  }
  return result;
}

// src/utils/eval.js
var MAX_CACHE_SIZE = 500;
var evalFnCache = new Map;
var execFnCache = new Map;
var SIMPLE_PATH_RE = /^(!)?\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)$/;
var SIMPLE_LITERAL_KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "this",
  "window",
  "document",
  "globalThis"
]);
var BLOCKED_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
var cspModeOverride = false;
var evalBlockedDetected = false;
function isCspMode() {
  return cspModeOverride || evalBlockedDetected;
}
function boundedCacheSet(cache, key, value) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const evictCount = Math.ceil(MAX_CACHE_SIZE / 4);
    const iter = cache.keys();
    for (let i = 0;i < evictCount; i++) {
      const oldest = iter.next().value;
      if (oldest !== undefined)
        cache.delete(oldest);
    }
  }
  cache.set(key, value);
}
function buildMagics(scope) {
  const storeAccessor = scope.storeAccessor || getStore;
  const nextTick = typeof scope.nextTick === "function" ? scope.nextTick.bind(scope) : (fn) => Promise.resolve().then(() => fn?.());
  const dispatch = typeof scope.dispatch === "function" ? scope.dispatch.bind(scope) : (name, detail) => {
    const target = scope.currentEl || scope.root;
    if (!target)
      return false;
    return target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: true }));
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
    $parent: scope.parentComponent?.state || null
  };
}
var FAST_EVAL_MISS = Symbol("fastEvalMiss");
function tryFastEval(expr, scope, extra) {
  const trimmed = typeof expr === "string" ? expr.trim() : "";
  if (!trimmed)
    return FAST_EVAL_MISS;
  if (trimmed === "true")
    return true;
  if (trimmed === "false")
    return false;
  if (trimmed === "null")
    return null;
  if (trimmed === "undefined")
    return;
  const match = SIMPLE_PATH_RE.exec(trimmed);
  if (!match)
    return FAST_EVAL_MISS;
  const negate = Boolean(match[1]);
  const segments = match[2].split(".");
  const rootName = segments[0];
  if (SIMPLE_LITERAL_KEYWORDS.has(rootName))
    return FAST_EVAL_MISS;
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
  for (let i = 1;i < segments.length; i++) {
    const seg = segments[i];
    if (BLOCKED_SEGMENTS.has(seg))
      return;
    if (value == null) {
      throw new TypeError(`Cannot read properties of ${value} (reading '${seg}')`);
    }
    value = value[seg];
  }
  return negate ? !value : value;
}
function isCspEvalError(err) {
  if (!err)
    return false;
  if (err instanceof EvalError)
    return true;
  const msg = String(err.message || "");
  return /unsafe-eval|Content Security Policy|Refused to evaluate/i.test(msg);
}
function evalInScope(expr, scope, extra = {}) {
  const fast = tryFastEval(expr, scope, extra);
  if (fast !== FAST_EVAL_MISS)
    return fast;
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
      fn = new Function("$state", "$event", "$refs", "$emit", "$store", "$locals", "$el", "$nextTick", "$dispatch", "$parent", ...extraKeys, `with($state){ with($locals){ return (${expr}); } }`);
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
    return fn(magics.$state, magics.$event, magics.$refs, magics.$emit, magics.$store, magics.$locals, magics.$el, magics.$nextTick, magics.$dispatch, magics.$parent, ...Object.values(extra));
  } catch (e) {
    if (scope.debug) {
      console.error("SpruceX expression error:", expr, e);
    }
    throw e;
  }
}
function safeEval(expr, scope, fallbackExpr) {
  try {
    return evalInScope(expr, scope);
  } catch (_e) {
    if (fallbackExpr) {
      try {
        return evalInScope(fallbackExpr, scope);
      } catch (e2) {
        console.error("SpruceX fallback expression error:", fallbackExpr, e2);
      }
    }
    return;
  }
}

// src/integrations/gridstack.js
function parseGridOptionValue(component, raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed)
    return true;
  if (trimmed === "true")
    return true;
  if (trimmed === "false")
    return false;
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum))
    return asNum;
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
  Array.from(el.attributes).filter((attr) => attr.name.startsWith(ATTR_GRIDSTACK_OPTION_PREFIX)).forEach((attr) => {
    const rawName = attr.name.slice(ATTR_GRIDSTACK_OPTION_PREFIX.length);
    if (!rawName)
      return;
    const optionName = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[optionName] = parseGridOptionValue(component, attr.value);
  });
  return options;
}
function serializeGridNodes(nodes) {
  if (!Array.isArray(nodes))
    return [];
  return nodes.map((node) => ({
    id: node?.id ?? node?.el?.id ?? null,
    x: node?.x,
    y: node?.y,
    w: node?.w,
    h: node?.h,
    minW: node?.minW,
    minH: node?.minH,
    maxW: node?.maxW,
    maxH: node?.maxH
  }));
}
function createGridStackIntegration() {
  const instancesMap = new WeakMap;
  const warnedComponents = new WeakSet;
  const getInstances = (component) => {
    let map = instancesMap.get(component);
    if (!map) {
      map = new Map;
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
      if (!el.hasAttribute(ATTR_GRIDSTACK))
        return;
      if (!Array.isArray(component.gridBindings)) {
        component.gridBindings = [];
      }
      if (component.gridBindings.some((b) => b.el === el))
        return;
      component.gridBindings.push({
        el,
        gridExpr: el.getAttribute(ATTR_GRIDSTACK),
        gridOptionsExpr: el.getAttribute(ATTR_GRIDSTACK_OPTIONS),
        onChangeInto: el.getAttribute(ATTR_GRIDSTACK_ON_CHANGE),
        onAddedInto: el.getAttribute(ATTR_GRIDSTACK_ON_ADDED),
        onRemovedInto: el.getAttribute(ATTR_GRIDSTACK_ON_REMOVED),
        onDragstopInto: el.getAttribute(ATTR_GRIDSTACK_ON_DRAGSTOP),
        onResizestopInto: el.getAttribute(ATTR_GRIDSTACK_ON_RESIZESTOP)
      });
    },
    update(component) {
      const bindings = component.gridBindings || [];
      const instances = getInstances(component);
      for (const el of Array.from(instances.keys())) {
        if (!el.isConnected) {
          destroyGridElement(component, el);
        }
      }
      bindings.forEach((binding) => {
        const { el } = binding;
        if (!el.isConnected || instances.has(el))
          return;
        if (typeof window === "undefined" || !window.GridStack || typeof window.GridStack.init !== "function") {
          if (!warnedComponents.has(component)) {
            warnedComponents.add(component);
            console.warn("SpruceX: sx-gridstack requires GridStack on window.GridStack.");
          }
          return;
        }
        const options = buildGridOptions(component, binding);
        const grid = window.GridStack.init(options, el);
        const cleanups = [];
        const bindInto = (eventName, targetExpr) => {
          if (!targetExpr)
            return;
          const handler = (_event, nodes = []) => {
            const value = serializeGridNodes(nodes);
            component.assignStateValue(targetExpr, value);
            el.dispatchEvent(new CustomEvent(`sprucex:gridstack:${eventName}`, {
              detail: value,
              bubbles: true
            }));
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
    }
  };
}
