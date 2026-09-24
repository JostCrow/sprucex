import {
  ATTR_DATA,
  ATTR_TEXT,
  ATTR_HTML,
  ATTR_SHOW,
  ATTR_BIND_PREFIX,
  ATTR_ON_PREFIX,
  ATTR_MODEL,
  ATTR_MODEL_PREFIX,
  ATTR_CLASS,
  ATTR_TOGGLE,
  ATTR_ERROR_FALLBACK,
  ATTR_FOR,
  ATTR_MEMO,
  ATTR_PAGE,
  ATTR_BOOST,
  ATTR_BOOST_ON,
  NET_METHODS,
  ATTR_TRIGGER,
  ATTR_TRIGGER_DEBOUNCE,
  ATTR_TARGET,
  ATTR_SWAP,
  ATTR_VARS,
  ATTR_JSON_INTO,
  ATTR_OPTIMISTIC,
  ATTR_REVERT_ON_ERROR,
  ATTR_POLL,
  ATTR_POLL_WHILE,
  ATTR_INCLUDE,
  ATTR_BODY,
  ATTR_BODY_TYPE,
  ATTR_HEADERS,
  ATTR_LOADING_INTO,
  ATTR_ERROR_INTO,
  ATTR_DISABLE_WHILE_REQUEST,
  ATTR_TEXT_WHILE_REQUEST,
  ATTR_CONFIRM,
  ATTR_CANCEL_PREVIOUS,
  ATTR_GRIDSTACK_OPTION_PREFIX,
  ATTR_LAZY,
  ATTR_LOCAL,
  ATTR_ANIMATE,
  DELEGATED_EVENTS,
  DEFAULT_CSRF_COOKIE_NAME,
} from "../constants.js";
import { walk, parseForExpression, cloneChildren } from "../utils/helpers.js";
import {
  createDeepReactiveProxy,
  createReactiveState,
} from "../reactivity/index.js";
import { globalStores, storeSubscribers, getStore } from "../store/index.js";
import { getAutoAnimate } from "../utils/animations.js";
import { evalInScope, safeEval, execInScope } from "../utils/eval.js";
import { morphNodes } from "../utils/morph.js";
import {
  getDataFactory,
  getDataExpressionReference,
  isFactoryLikeDataExpression,
  resolveGlobalDataReference,
  createDataFactoryNotReadyError,
} from "../utils/data-factories.js";
import { listIntegrations } from "../integrations/index.js";

export class Component {
  constructor(root, options = {}) {
    this.root = root;
    this.parentComponent = options.parentComponent || null;
    this.locals =
      options.locals && typeof options.locals === "object"
        ? { ...options.locals }
        : {};
    this.bindings = [];
    this.memoBindings = [];
    this.eventHandlers = [];
    this.emitterHandlers = [];
    this.netBindings = [];
    this.modelBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];
    this.debounceTimers = new Set();
    this.gridInstances = new Map();
    this.requestUiState = new WeakMap();
    this.netRequestMeta = new WeakMap();
    this.warnedMissingGridStack = false;
    this.lastEvent = null;
    this.debug = false;
    this.updatePending = false;
    this.isDestroyed = false;
    this.originalClasses = new WeakMap(); // Track original classes for sx-class
    this.animatedElements = new Map(); // Track auto-animated elements

    this.scannedElements = new WeakSet();
    this.directiveSignatures = new WeakMap();
    this.elementLocals = new WeakMap();
    this.integrationScopes = new Map();
    this.refs = {};
    this.emitter = document.createElement("div");

    this.emit = (name, detail) => {
      const evt = new CustomEvent(name, { detail, bubbles: false });
      this.emitter.dispatchEvent(evt);
    };

    this.initState();
    this.collectRefs();
    this.initIntegrationBindings();

    this.setupDelegation();

    this.scan(root);
    this.renderForBlocks();
    this.applyInitialRender();
    this.callHook("init");
    queueMicrotask(() => this.callHook("mounted"));
  }

  // Batched update scheduling
  scheduleUpdate() {
    if (this.isDestroyed || this.updatePending) return;
    this.updatePending = true;

    // Use requestAnimationFrame for better rendering performance
    this.rafId = requestAnimationFrame(() => {
      this.updatePending = false;
      this.rafId = null;

      this.renderForBlocks();

      this.collectRefs();
      this.updateBindings();
      this.modelBindings.forEach((mb) => mb.updateDom());
      this.updateMemoBindings();
      this.updateIntegrations();
    });
  }

  initState() {
    const rawExpr = (this.root.getAttribute(ATTR_DATA) || "{}").trim();

    const storeAccessor = (name) => {
      const store = getStore(name);
      if (store && storeSubscribers[name]) {
        storeSubscribers[name].add(this);
      }
      return store;
    };
    this.storeAccessor = storeAccessor;

    let raw;
    const inheritedLocals = this.locals && typeof this.locals === "object"
      ? this.locals
      : {};
    const jsonScript = this.root.querySelector("script[sx-init-data]");
    const looksLikeIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawExpr);

    if (jsonScript && looksLikeIdentifier) {
      try {
        const parsed = JSON.parse(jsonScript.textContent.trim() || "{}");
        raw = parsed;
      } catch (e) {
        console.error("SpruceX sx-init-data JSON parse error:", e);
        raw = {};
      }
    } else {
      const dataRef = getDataExpressionReference(rawExpr);
      const registeredFactory = dataRef ? getDataFactory(dataRef) : undefined;
      const globalFactory = dataRef
        ? resolveGlobalDataReference(dataRef)
        : undefined;
      const resolvedFactory =
        registeredFactory !== undefined ? registeredFactory : globalFactory;

      try {
        if (dataRef && resolvedFactory !== undefined) {
          const callExprMatch = rawExpr.match(
            /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(([\s\S]*)\)$/,
          );
          const isDirectCallExpr =
            !!callExprMatch && callExprMatch[1] === dataRef;
          if (isDirectCallExpr && typeof resolvedFactory === "function") {
            const argsSource = callExprMatch[2].trim();
            const args = argsSource
              ? new Function(
                  "$store",
                  "$data",
                  "$locals",
                  `with($locals){ return [${argsSource}]; }`,
                )(storeAccessor, getDataFactory, inheritedLocals)
              : [];
            raw = resolvedFactory.apply(this.root, args);
          } else if (rawExpr === dataRef && typeof resolvedFactory === "function") {
            raw = resolvedFactory.call(this.root);
          } else if (rawExpr === dataRef) {
            raw = resolvedFactory;
          } else {
            const fn = new Function(
              "$store",
              "$data",
              "$locals",
              `with($locals){ return (${rawExpr}); }`,
            );
            raw = fn(storeAccessor, getDataFactory, inheritedLocals);
          }
        } else {
          const fn = new Function(
            "$store",
            "$data",
            "$locals",
            `with($locals){ return (${rawExpr}); }`,
          );
          raw = fn(storeAccessor, getDataFactory, inheritedLocals);
        }
      } catch (e) {
        const missingReference =
          e instanceof ReferenceError ||
          /is not defined/.test(String(e && e.message ? e.message : ""));
        if (missingReference && isFactoryLikeDataExpression(rawExpr)) {
          throw createDataFactoryNotReadyError(rawExpr, e);
        }
        console.error("SpruceX sx-data parse error:", rawExpr, e);
        raw = {};
      }
    }

    if (typeof raw === "function") {
      try {
        raw = raw.call(this.root);
      } catch (e) {
        console.error("SpruceX sx-data factory execution error:", rawExpr, e);
        raw = {};
      }
    }
    if (raw == null || typeof raw !== "object") {
      raw = {};
    }

    const localKey = this.root.getAttribute(ATTR_LOCAL);
    if (localKey) {
      try {
        const stored = localStorage.getItem(localKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          Object.assign(raw, parsed);
        }
      } catch (e) {
        console.error("SpruceX sx-local load error:", e);
      }
    }

    Object.defineProperty(raw, "$emit", {
      value: this.emit,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(raw, "$store", {
      value: (name) => {
        const store = getStore(name);
        if (store && storeSubscribers[name]) {
          storeSubscribers[name].add(this);
        }
        return store;
      },
      enumerable: false,
      configurable: true,
    });

    const { proxy } = createReactiveState(raw, () => {
      if (localKey) {
        try {
          localStorage.setItem(localKey, JSON.stringify(proxy));
        } catch (e) {
          console.error("SpruceX sx-local save error:", e);
        }
      }
      this.scheduleUpdate();
    });

    this.state = proxy;
  }

  collectRefs() {
    this.refs = {};
    walk(this.root, (el) => {
      if (el !== this.root && el.hasAttribute(ATTR_DATA)) return false;
      const name = el.getAttribute("sx-ref");
      if (name) this.refs[name] = el;
    });
  }

  getElementLocals(el) {
    for (let node = el; node && node !== this.root; node = node.parentElement) {
      if (this.elementLocals.has(node)) return this.elementLocals.get(node);
    }
    return this.locals;
  }

  withLocals(locals, fn) {
    const previous = this.locals;
    if (locals) this.locals = locals;
    try {
      return fn();
    } finally {
      this.locals = previous;
    }
  }

  removeEventHandler(record) {
    record.handler.cancel?.();
    if (record.delegated) {
      const handlers = record.el.__sx_handlers?.[record.event];
      if (handlers) {
        record.el.__sx_handlers[record.event] = handlers.filter(
          (entry) => entry.handler !== record.handler,
        );
      }
    } else {
      record.el.removeEventListener(record.event, record.handler);
    }
  }

  setupDelegation() {
    // Attach listeners for delegated events exactly once to the root
    DELEGATED_EVENTS.forEach((eventName) => {
      const handler = (e) => this.handleDelegatedEvent(e);
      this.root.addEventListener(eventName, handler);
      if (!this._delegatedCleanups) this._delegatedCleanups = [];
      this._delegatedCleanups.push(() =>
        this.root.removeEventListener(eventName, handler),
      );
    });
  }

  handleDelegatedEvent(e) {
    let cur = e.target;

    // Stop loop if propagation is stopped
    let propagationStopped = false;
    const originalStop = e.stopPropagation;
    e.stopPropagation = function () {
      propagationStopped = true;
      originalStop.apply(this, arguments);
    };

    // Traverse up to root
    while (cur && cur.nodeType === 1) {
      // If element has handlers for this event
      if (cur.__sx_handlers && cur.__sx_handlers[e.type]) {
        cur.__sx_handlers[e.type].forEach(
          ({ handler: handlerFn, component }) => {
            if (component !== this) return;

            if (!propagationStopped) {
              handlerFn(e);
            }
          },
        );
      }

      if (propagationStopped) break;
      if (cur === this.root) break;
      cur = cur.parentNode;
    }
  }

  scan(root, locals = null, fragment = false) {
    const self = this;

    walk(root, (el) => {
      if (el.nodeType !== 1) return false;
      if ((fragment || el !== root) && el.hasAttribute(ATTR_DATA)) return false;

      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
        const expr = el.getAttribute(ATTR_FOR) || "";
        const parent = el.parentElement;
        if (!parent) return;

        const parentLocals = locals || this.getElementLocals(el);
        const marker = document.createComment("sx-for");
        parent.insertBefore(marker, el);
        el.remove();

        const forDef = parseForExpression(expr);
        if (!forDef) {
          console.error("SpruceX invalid sx-for expression:", expr);
          return;
        }

        self.forBlocks.push({
          template: el,
          parent,
          marker,
          expr,
          def: forDef,
          instances: [],
          keyExpr: el.getAttribute("sx-key") || null,
          parentLocals,
          autoAnimate: parent.hasAttribute(ATTR_ANIMATE),
        });

        // Setup auto-animate if parent has the attribute
        if (parent.hasAttribute(ATTR_ANIMATE)) {
          const opts = parent.getAttribute(ATTR_ANIMATE);
          let config = {};
          if (opts && opts !== "true" && opts !== "") {
            try {
              config = JSON.parse(opts);
            } catch (e) {
              const duration = parseInt(opts, 10);
              if (!isNaN(duration)) config = { duration };
            }
          }
          self.setupAutoAnimate(parent, config);
        }
      }
    });

    walk(root, (el) => {
      if (el.nodeType !== 1) return;
      if ((fragment || el !== root) && el.hasAttribute(ATTR_DATA)) return false;
      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) return;

      if (!this.scannedElements.has(el)) {
        this.scanElement(el, locals || this.getElementLocals(el));
      }
    });

    this.setupNetworkBindings();
  }

  directiveSignature(el) {
    return JSON.stringify(Array.from(el.attributes)
      .filter((attr) => attr.name.startsWith("sx-"))
      .map((attr) => [attr.name, attr.value])
      .sort(([a], [b]) => a.localeCompare(b)));
  }

  scanElement(el, locals) {
    this.scannedElements.add(el);
    this.directiveSignatures.set(el, this.directiveSignature(el));
    this.elementLocals.set(el, locals);
    const self = this;
    const hasMemo = el.hasAttribute(ATTR_MEMO);

    const textExpr = el.getAttribute(ATTR_TEXT);
    if (textExpr && !hasMemo) {
      self.bindings.push({
        el,
        type: "text",
        expr: textExpr,
        errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
        locals,
      });
    }

    const htmlExpr = el.getAttribute(ATTR_HTML);
    if (htmlExpr && !hasMemo) {
      self.bindings.push({
        el,
        type: "html",
        expr: htmlExpr,
        errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
        locals,
      });
    }

    const showExpr = el.getAttribute(ATTR_SHOW);
    if (showExpr) {
      self.bindings.push({
        el,
        type: "show",
        expr: showExpr,
        errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
        locals,
      });
    }

    const classExpr = el.getAttribute(ATTR_CLASS);
    if (classExpr) {
      if (!self.originalClasses.has(el)) {
        self.originalClasses.set(el, new Set(Array.from(el.classList)));
      }
      self.bindings.push({
        el,
        type: "class",
        expr: classExpr,
        errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
        locals,
      });
    }

    const toggleKey = el.getAttribute(ATTR_TOGGLE);
    if (toggleKey) {
      const handler = () => {
        this.withLocals(locals, () => execInScope(`${toggleKey} = !(${toggleKey})`, this));
      };
      el.addEventListener("click", handler);
      self.eventHandlers.push({ el, event: "click", handler });
    }

    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(ATTR_BIND_PREFIX)) {
        const name = attr.name.slice(ATTR_BIND_PREFIX.length);
        self.bindings.push({
          el,
          type: "bind",
          attr: name,
          expr: attr.value,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals,
        });
      }
    }

    // sx-memo
    const memoExpr = el.getAttribute(ATTR_MEMO);
    const textForMemo = el.getAttribute(ATTR_TEXT);
    const htmlForMemo = el.getAttribute(ATTR_HTML);
    if (memoExpr && (textForMemo || htmlForMemo)) {
      let deps = [];
      try {
        const fn = new Function(`return (${memoExpr});`);
        const val = fn();
        if (Array.isArray(val)) deps = val;
      } catch (e) {
        console.error("SpruceX sx-memo parse error:", memoExpr, e);
      }
      self.memoBindings.push({
        el,
        expr: textForMemo || htmlForMemo,
        type: textForMemo ? "text" : "html",
        deps,
        lastVals: null,
        lastResult: null,
        locals,
      });
    }

    // sx-model
    this.setupModelBinding(el, locals);

    // Event handlers
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(ATTR_ON_PREFIX)) {
        const full = attr.name.slice(ATTR_ON_PREFIX.length);
        const [eventName, ...mods] = full.split(".");
        const expr = attr.value;
        const handler = (ev) => {
          if (mods.includes("prevent")) ev.preventDefault();
          if (mods.includes("stop")) ev.stopPropagation();
          if (mods.includes("self") && ev.target !== el) return;

          if (ev instanceof KeyboardEvent) {
            const keys = mods.filter(
              (m) =>
                !["prevent", "stop", "self", "window", "document"].includes(m),
            );
            if (keys.length > 0) {
              const key = ev.key.toLowerCase();
              if (!keys.includes(key)) return;
            }
          }

          this.lastEvent = ev;
          const prev = this.locals;
          if (locals) this.locals = locals;
          execInScope(expr, this);
          this.locals = prev;
        };

        const eventTarget = mods.includes("window") ? window
          : mods.includes("document") ? document : el;
        if (eventTarget === el && DELEGATED_EVENTS.has(eventName)) {
          if (!el.__sx_handlers) el.__sx_handlers = {};
          if (!el.__sx_handlers[eventName]) el.__sx_handlers[eventName] = [];
          el.__sx_handlers[eventName].push({ handler, component: this });
          self.eventHandlers.push({ el, event: eventName, handler, delegated: true });
        } else {
          eventTarget.addEventListener(eventName, handler);
          self.eventHandlers.push({ el: eventTarget, sourceEl: el, event: eventName, handler });
        }
      }
    }

    // Network bindings
    for (const m of NET_METHODS) {
      const attrName = `sx-${m}`;
      const urlTpl = el.getAttribute(attrName);
      if (urlTpl) {
        const trigger =
          el.getAttribute(ATTR_TRIGGER) ||
          (el.tagName === "FORM" ? "submit" : "click");
        const triggerDebounce = el.getAttribute(ATTR_TRIGGER_DEBOUNCE);
        const target = el.getAttribute(ATTR_TARGET) || null;
        const swap = el.getAttribute(ATTR_SWAP) || "innerHTML";
        const varsExpr = el.getAttribute(ATTR_VARS);
        const jsonInto = el.getAttribute(ATTR_JSON_INTO);
        const optimistic = el.getAttribute(ATTR_OPTIMISTIC);
        const revertOnError = el.getAttribute(ATTR_REVERT_ON_ERROR);
        const poll = el.getAttribute(ATTR_POLL);
        const pollWhile = el.getAttribute(ATTR_POLL_WHILE);
        const includeSelector = el.getAttribute(ATTR_INCLUDE);
        const bodyExpr = el.getAttribute(ATTR_BODY);
        const bodyType = el.getAttribute(ATTR_BODY_TYPE);
        const headersExpr = el.getAttribute(ATTR_HEADERS);
        const loadingInto = el.getAttribute(ATTR_LOADING_INTO);
        const errorInto = el.getAttribute(ATTR_ERROR_INTO);
        const disableWhileRequest = el.hasAttribute(
          ATTR_DISABLE_WHILE_REQUEST,
        );
        const textWhileRequest = el.getAttribute(ATTR_TEXT_WHILE_REQUEST);
        const confirmExpr = el.getAttribute(ATTR_CONFIRM);
        const cancelPrevious = el.hasAttribute(ATTR_CANCEL_PREVIOUS);

        const binding = {
          el,
          locals,
          scope: Object.assign(Object.create(this), { locals }),
          method: m.toUpperCase(),
          urlTpl,
          trigger,
          triggerDebounce,
          target,
          swap,
          varsExpr,
          jsonInto,
          optimistic,
          revertOnError,
          poll: poll ? Number(poll) : null,
          pollWhile,
          includeSelector,
          bodyExpr,
          bodyType,
          headersExpr,
          loadingInto,
          errorInto,
          disableWhileRequest,
          textWhileRequest,
          confirmExpr,
          cancelPrevious,
        };

        self.netBindings.push(binding);
      }
    }

    this.scanIntegrations(el, locals);

    // Auto-animate
    if (el.hasAttribute(ATTR_ANIMATE)) {
      const optionsStr = el.getAttribute(ATTR_ANIMATE);
      // Defer setup to allow DOM to be ready
      queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
    }
  }

  // ... remaining methods ...
  parseModelBindingConfig(direct, modifierAttrs) {
    const keyExpr = direct || modifierAttrs[0]?.value || null;
    const mods = new Set();
    let debounceMs = null;

    modifierAttrs.forEach((attr) => {
      const parts = attr.name
        .slice(ATTR_MODEL_PREFIX.length)
        .split(".")
        .filter(Boolean);

      parts.forEach((part) => {
        if (part === "debounce-ms") {
          const parsed = Number(attr.value || "200");
          if (Number.isFinite(parsed) && parsed > 0) {
            debounceMs = parsed;
          }
          return;
        }
        mods.add(part);
      });
    });

    return { keyExpr, mods, debounceMs };
  }

  setupNetworkBindings() {
    for (const nb of this.netBindings) {
      if (nb.initialized) continue;
      nb.initialized = true;
      nb.disposers = [];
      const { el, poll, pollWhile } = nb;
      const triggerDefs = this.parseNetworkTriggers(nb);

      const doReq = (ev = null) => {
        if (ev) {
          this.lastEvent = ev;
          if (ev.type === "submit") ev.preventDefault();
        }

        nb.scope.lastEvent = ev || this.lastEvent;
        if (nb.disposed || this.isDestroyed || !nb.scope.confirmRequest(nb)) return;
        this.performRequest(nb);
      };

      triggerDefs.forEach(({ eventName, debounceMs }) => {
        if (eventName === "load") {
          queueMicrotask(() => doReq());
          return;
        }

        const domHandler = this.wrapDebounced(doReq, debounceMs);
        el.addEventListener(eventName, domHandler);
        this.eventHandlers.push({ el, event: eventName, handler: domHandler });

        const compHandler = this.wrapDebounced(
          () => doReq(),
          debounceMs,
        );
        this.emitter.addEventListener(eventName, compHandler);
        const emitterRecord = { event: eventName, handler: compHandler };
        this.emitterHandlers.push(emitterRecord);
        nb.disposers.push(() => {
          compHandler.cancel?.();
          this.emitter.removeEventListener(eventName, compHandler);
          this.emitterHandlers = this.emitterHandlers.filter((record) => record !== emitterRecord);
        });
      });

      if (poll && !Number.isNaN(poll) && poll > 0) {
        const timer = setInterval(() => {
          if (pollWhile) {
            const ok = !!safeEval(pollWhile, nb.scope);
            if (!ok) return;
          }
          this.performRequest(nb);
        }, poll);
        this.pollTimers.push(timer);
        nb.disposers.push(() => {
          clearInterval(timer);
          this.pollTimers = this.pollTimers.filter((entry) => entry !== timer);
        });
      }
    }
  }

  parseNetworkTriggers(nb) {
    const fallbackDebounce = Number(nb.triggerDebounce);
    const debounceMs =
      Number.isFinite(fallbackDebounce) && fallbackDebounce > 0
        ? fallbackDebounce
        : null;
    const raw = (nb.trigger || "").trim();
    const fallback = nb.el.tagName === "FORM" ? "submit" : "click";
    const tokens = (raw || fallback)
      .split(",")
      .flatMap((part) => part.trim().split(/\s+/))
      .filter(Boolean);

    if (!tokens.length) {
      return [{ eventName: fallback, debounceMs }];
    }

    return tokens.map((token) => {
      const parts = token.split(".");
      const eventName = parts[0] || fallback;
      let triggerDebounce = debounceMs;
      const debounceIdx = parts.indexOf("debounce");

      if (debounceIdx !== -1) {
        const parsed = Number(parts[debounceIdx + 1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          triggerDebounce = parsed;
        }
      }

      return { eventName, debounceMs: triggerDebounce };
    });
  }

  wrapDebounced(fn, debounceMs) {
    if (!debounceMs || debounceMs <= 0) return fn;

    let timer = null;
    const handler = (...args) => {
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(timer);
      }

      timer = setTimeout(() => {
        this.debounceTimers.delete(timer);
        timer = null;
        if (!this.isDestroyed) fn(...args);
      }, debounceMs);

      this.debounceTimers.add(timer);
    };
    handler.cancel = () => {
      clearTimeout(timer);
      this.debounceTimers.delete(timer);
      timer = null;
    };
    return handler;
  }

  confirmRequest(nb) {
    if (nb.confirmExpr == null) return true;
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return true;
    }

    const raw = String(nb.confirmExpr).trim();
    let message = raw || "Are you sure?";

    if (raw) {
      const evaluated = safeEval(raw, this);
      if (typeof evaluated === "string") {
        message = evaluated;
      } else if (evaluated !== undefined && evaluated !== null) {
        message = String(evaluated);
      }
    }

    return window.confirm(message);
  }

  setupAutoAnimate(el, options = {}) {
    const aa = getAutoAnimate();
    if (!aa) return null;

    // Parse options from attribute if string
    if (typeof options === "string" && options.trim()) {
      try {
        options = JSON.parse(options);
      } catch (_jsonErr) {
        // Fallback: try evaluating as expression in component scope
        const evaluated = safeEval(options, this);
        options = evaluated && typeof evaluated === "object" ? evaluated : {};
      }
    }

    // Default options
    const defaultOptions = {
      duration: 250,
      easing: "ease-in-out",
    };

    const finalOptions = { ...defaultOptions, ...options };

    try {
      const controller = aa(el, finalOptions);
      this.animatedElements.set(el, controller);
      return controller;
    } catch (e) {
      console.error("SpruceX auto-animate error:", e);
      return null;
    }
  }

  disableAutoAnimate(el) {
    const controller = this.animatedElements.get(el);
    if (controller && typeof controller === "function") {
      // auto-animate returns a disable function when called with false
      controller.disable?.();
    }
    this.animatedElements.delete(el);
  }

  buildUrl(nb) {
    const { urlTpl, varsExpr } = nb;
    if (!varsExpr) return urlTpl;
    const vars = safeEval(varsExpr, this) || {};
    // Safe interpolation: only replace ${identifier} tokens, no arbitrary code execution
    return urlTpl.replace(/\$\{([A-Za-z_$][A-Za-z0-9_$.]*)\}/g, (_match, key) => {
      const segments = key.split(".");
      let value = vars;
      for (const seg of segments) {
        if (value == null) return "";
        value = value[seg];
      }
      return value ?? "";
    });
  }

  buildBody(nb) {
    const { el, method, includeSelector, bodyExpr, bodyType } = nb;
    if (!["POST", "PUT", "DELETE"].includes(method)) {
      return { body: null, bodyKind: null };
    }

    if (bodyExpr) {
      const value = this.evaluateExpressionOrLiteral(bodyExpr);
      const resolvedType = this.resolveBodyType(bodyType, value);

      if (resolvedType === "json") {
        return {
          body:
            typeof value === "string" ? value : JSON.stringify(value ?? {}),
          bodyKind: "json",
        };
      }

      if (resolvedType === "form") {
        const fd = this.toFormData(value);
        if (fd instanceof FormData && includeSelector) {
          this.appendIncludeData(fd, includeSelector);
        }
        return { body: fd, bodyKind: "form" };
      }

      return { body: value ?? null, bodyKind: null };
    }

    if (el.tagName === "FORM") {
      const fd = new FormData(el);
      if (includeSelector) {
        this.appendIncludeData(fd, includeSelector);
      }

      if ((bodyType || "").toLowerCase() === "json") {
        return {
          body: JSON.stringify(this.formDataToJson(fd)),
          bodyKind: "json",
        };
      }

      return { body: fd, bodyKind: "form" };
    }

    return { body: null, bodyKind: null };
  }

  resolveBodyType(rawType, value) {
    const lowered = (rawType || "").toLowerCase();
    if (lowered === "json" || lowered === "form") return lowered;
    if (value instanceof FormData || value instanceof URLSearchParams) {
      return "form";
    }
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Blob) &&
      !(value instanceof ArrayBuffer)
    ) {
      return "json";
    }
    return null;
  }

  toFormData(value) {
    if (value instanceof FormData) return value;
    if (value instanceof URLSearchParams) {
      const fd = new FormData();
      value.forEach((v, k) => fd.append(k, v));
      return fd;
    }

    const fd = new FormData();
    if (value == null) return fd;

    if (typeof value === "string") {
      const params = new URLSearchParams(value);
      let appended = false;
      params.forEach((v, k) => {
        fd.append(k, v);
        appended = true;
      });
      if (!appended) fd.append("value", value);
      return fd;
    }

    if (typeof value !== "object") {
      fd.append("value", String(value));
      return fd;
    }

    Object.entries(value).forEach(([k, v]) => {
      this.appendFormValue(fd, k, v);
    });
    return fd;
  }

  appendFormValue(fd, key, value) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.appendFormValue(fd, key, item));
      return;
    }

    if (value instanceof Blob) {
      fd.append(key, value);
      return;
    }

    if (value && typeof value === "object") {
      fd.append(key, JSON.stringify(value));
      return;
    }

    fd.append(key, value == null ? "" : String(value));
  }

  appendIncludeData(fd, includeSelector) {
    document.querySelectorAll(includeSelector).forEach((extra) => {
      if (extra.tagName === "FORM") {
        new FormData(extra).forEach((v, k) => fd.append(k, v));
        return;
      }

      this.appendElementValue(fd, extra);
      if (extra.querySelectorAll) {
        extra
          .querySelectorAll("input[name], select[name], textarea[name]")
          .forEach((input) => this.appendElementValue(fd, input));
      }
    });
  }

  appendElementValue(fd, el) {
    if (!("name" in el) || !el.name) return;
    if ("disabled" in el && el.disabled) return;

    const type = (el.type || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !el.checked) return;

    if (el.tagName === "SELECT" && el.multiple) {
      Array.from(el.selectedOptions || []).forEach((opt) =>
        fd.append(el.name, opt.value),
      );
      return;
    }

    fd.append(el.name, el.value ?? "");
  }

  formDataToJson(fd) {
    const out = {};
    fd.forEach((value, key) => {
      const normalized = value instanceof File ? value.name : value;
      if (key in out) {
        if (Array.isArray(out[key])) out[key].push(normalized);
        else out[key] = [out[key], normalized];
      } else {
        out[key] = normalized;
      }
    });
    return out;
  }

  buildHeaders(nb, bodyKind, hasBody) {
    const headers = new Headers();
    const evaluated = nb.headersExpr
      ? safeEval(nb.headersExpr, this)
      : undefined;

    if (evaluated instanceof Headers) {
      evaluated.forEach((v, k) => headers.set(k, v));
    } else if (Array.isArray(evaluated)) {
      evaluated.forEach((entry) => {
        if (Array.isArray(entry) && entry.length >= 2) {
          headers.set(String(entry[0]), String(entry[1]));
        }
      });
    } else if (evaluated && typeof evaluated === "object") {
      Object.entries(evaluated).forEach(([k, v]) => {
        if (v != null) headers.set(k, String(v));
      });
    }

    if (bodyKind === "json" && hasBody && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return headers;
  }

  getCsrfToken() {
    if (typeof document === "undefined") return null;
    const cookieName = Component.csrfCookieName || DEFAULT_CSRF_COOKIE_NAME;
    const prefix = cookieName + "=";
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const entry of cookies) {
      const cookie = entry.trim();
      if (cookie.startsWith(prefix)) {
        return decodeURIComponent(cookie.slice(prefix.length));
      }
    }
    return null;
  }

  addCsrfHeader(headers, method) {
    const upperMethod = String(method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS", "TRACE"].includes(upperMethod)) return;
    const csrfToken = this.getCsrfToken();
    if (csrfToken && !headers.has("X-CSRFToken")) {
      headers.set("X-CSRFToken", csrfToken);
    }
  }

  evaluateExpressionOrLiteral(raw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return "";
    const evaluated = safeEval(trimmed, this);
    return evaluated === undefined ? trimmed : evaluated;
  }

  assignStateValue(targetExpr, value) {
    if (!targetExpr) return;
    execInScope(`${targetExpr} = __sx_value`, this, { __sx_value: value });
  }

  serializeError(error) {
    if (!error) return null;
    if (typeof error === "string") return { message: error };
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      status: error.status,
    };
  }

  beginRequestUiState(nb) {
    const { el, disableWhileRequest, textWhileRequest } = nb;
    if (!disableWhileRequest && textWhileRequest == null) return () => {};

    const current = this.requestUiState.get(el) || { count: 0, restoreFns: [] };
    if (current.count === 0) {
      current.restoreFns = this.applyRequestUiState(nb);
    }
    current.count += 1;
    this.requestUiState.set(el, current);

    return () => {
      const latest = this.requestUiState.get(el);
      if (!latest) return;
      latest.count -= 1;
      if (latest.count <= 0) {
        latest.restoreFns.forEach((fn) => fn());
        this.requestUiState.delete(el);
      } else {
        this.requestUiState.set(el, latest);
      }
    };
  }

  applyRequestUiState(nb) {
    const restoreFns = [];
    const { el, disableWhileRequest, textWhileRequest } = nb;

    if (disableWhileRequest) {
      this.getDisableTargets(el).forEach((target) => {
        const previous = !!target.disabled;
        target.disabled = true;
        restoreFns.push(() => {
          target.disabled = previous;
        });
      });
    }

    if (textWhileRequest != null) {
      const target = this.getTextWhileRequestTarget(el);
      if (target) {
        const nextText = String(this.evaluateExpressionOrLiteral(textWhileRequest));
        if (target.tagName === "INPUT") {
          const prev = target.value;
          target.value = nextText;
          restoreFns.push(() => {
            target.value = prev;
          });
        } else {
          const prev = target.textContent;
          target.textContent = nextText;
          restoreFns.push(() => {
            target.textContent = prev;
          });
        }
      }
    }

    return restoreFns;
  }

  getDisableTargets(el) {
    if (el.tagName === "FORM") {
      return Array.from(el.elements || []).filter(
        (node) => node && "disabled" in node && node.type !== "hidden",
      );
    }
    return "disabled" in el ? [el] : [];
  }

  getTextWhileRequestTarget(el) {
    if (el.tagName !== "FORM") return el;
    return (
      el.querySelector("button[type='submit']") ||
      el.querySelector("button:not([type])") ||
      el.querySelector("input[type='submit']")
    );
  }

  clearDebounceTimers() {
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
  }

  clearEmitterHandlers() {
    this.emitterHandlers.forEach(({ event, handler }) => {
      this.emitter.removeEventListener(event, handler);
    });
    this.emitterHandlers = [];
  }

  beginNetworkRequest(nb) {
    let meta = this.netRequestMeta.get(nb);
    if (!meta) {
      meta = { seq: 0, controller: null };
      this.netRequestMeta.set(nb, meta);
    }

    meta.seq += 1;
    if (nb.cancelPrevious && meta.controller && typeof meta.controller.abort === "function") {
      try {
        meta.controller.abort();
      } catch {
        // Ignore abort errors from stale controllers.
      }
    }

    meta.controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;

    return { seq: meta.seq, controller: meta.controller };
  }

  isCurrentNetworkRequest(nb, seq) {
    const meta = this.netRequestMeta.get(nb);
    return !this.isDestroyed && !nb.disposed && !!meta && meta.seq === seq;
  }

  finishNetworkRequest(nb, seq, controller) {
    const meta = this.netRequestMeta.get(nb);
    if (!meta || meta.seq !== seq) return false;
    if (meta.controller === controller) {
      meta.controller = null;
    }
    return true;
  }

  isAbortError(error) {
    return !!error && (error.name === "AbortError" || error.code === 20);
  }

  initIntegrationBindings() {
    listIntegrations().forEach((integration) => {
      if (typeof integration.setup !== "function") return;
      try {
        integration.setup(this);
      } catch (e) {
        console.error("SpruceX integration setup error:", e);
      }
    });
  }

  scanIntegrations(el, locals = null) {
    if (locals && locals !== this.locals) {
      let scope = this.integrationScopes.get(locals);
      if (!scope) {
        scope = Object.assign(Object.create(this), {
          locals,
          integrationScopes: new Map(),
          gridBindings: [],
          gridInstances: new Map(),
          scheduleUpdate: this.scheduleUpdate.bind(this),
        });
        scope.initIntegrationBindings();
        this.integrationScopes.set(locals, scope);
      }
      scope.scanIntegrations(el);
      return;
    }
    listIntegrations().forEach((integration) => {
      if (typeof integration.scan !== "function") return;
      try {
        integration.scan(this, el);
      } catch (e) {
        console.error("SpruceX integration scan error:", e);
      }
    });
  }

  updateIntegrations() {
    this.integrationScopes.forEach((scope) => scope.updateIntegrations());
    listIntegrations().forEach((integration) => {
      if (typeof integration.update !== "function") return;
      try {
        integration.update(this);
      } catch (e) {
        console.error("SpruceX integration update error:", e);
      }
    });
  }

  teardownIntegrations() {
    this.integrationScopes.forEach((scope) => scope.teardownIntegrations());
    this.integrationScopes.clear();
    listIntegrations().forEach((integration) => {
      if (typeof integration.teardown !== "function") return;
      try {
        integration.teardown(this);
      } catch (e) {
        console.error("SpruceX integration teardown error:", e);
      }
    });
  }

  async performRequest(nb) {
    if (this.isDestroyed || nb.disposed) return;
    const scope = nb.scope || this;
    const url = scope.buildUrl(nb);
    const { body, bodyKind } = scope.buildBody(nb);
    const {
      el,
      method,
      target,
      swap,
      jsonInto,
      optimistic,
      revertOnError,
      loadingInto,
      errorInto,
    } = nb;
    const headers = scope.buildHeaders(nb, bodyKind, body != null);
    const { seq: requestSeq, controller } = this.beginNetworkRequest(nb);
    this.addCsrfHeader(headers, method);
    const endUiState = scope.beginRequestUiState(nb);

    scope.assignStateValue(loadingInto, true);
    scope.assignStateValue(errorInto, null);

    if (optimistic) {
      execInScope(optimistic, scope);
    }

    try {
      const fetchOptions = { method };
      if (body != null) fetchOptions.body = body;
      if (Array.from(headers.keys()).length > 0) {
        fetchOptions.headers = headers;
      }
      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      const res = await fetch(url, fetchOptions);
      if (!this.isCurrentNetworkRequest(nb, requestSeq)) return;

      // Check for HTTP errors
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      if (!this.isCurrentNetworkRequest(nb, requestSeq)) return;
      let json = null;

      if (jsonInto && text.trim().length) {
        try {
          json = JSON.parse(text);
        } catch (e) {
          console.error("SpruceX JSON parse error:", e);
        }
      }

      if (jsonInto && json != null) {
        execInScope(`${jsonInto} = __sx_value`, scope, { __sx_value: json });
      } else {
        this.applySwap(target || el, text, swap);
      }

      const detail = { response: res, text, json };
      el.dispatchEvent(new CustomEvent("success", { detail, bubbles: true }));
      el.dispatchEvent(
        new CustomEvent("sprucex:success", { detail, bubbles: true }),
      );
    } catch (error) {
      if (this.isAbortError(error) || !this.isCurrentNetworkRequest(nb, requestSeq)) {
        return;
      }
      if (revertOnError) {
        execInScope(revertOnError, scope);
      }
      scope.assignStateValue(errorInto, this.serializeError(error));
      const detail = { error };
      el.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
      el.dispatchEvent(
        new CustomEvent("sprucex:error", { detail, bubbles: true }),
      );
    } finally {
      const isFinished = this.finishNetworkRequest(nb, requestSeq, controller);
      endUiState();
      if (!this.isDestroyed && isFinished) {
        scope.assignStateValue(loadingInto, false);
      }
    }
  }

  disposeNetworkBinding(binding) {
    if (binding.disposed) return;
    binding.disposed = true;
    this.netRequestMeta.get(binding)?.controller?.abort();
    (binding.disposers || []).forEach((dispose) => dispose());
  }

  pruneDetachedBindings(removedNodes = null, exact = false) {
    const belongs = (el) => el && (removedNodes
      ? !removedNodes.some((node) => node === el || (!exact && node.contains?.(el)))
      : this.root.contains(el));
    for (const field of ["bindings", "memoBindings", "modelBindings"]) {
      this[field] = this[field].filter((binding) => belongs(binding.el));
    }
    this.eventHandlers = this.eventHandlers.filter((record) => {
      if (belongs(record.sourceEl || record.el)) return true;
      this.removeEventHandler(record);
      return false;
    });
    this.netBindings = this.netBindings.filter((binding) => {
      if (belongs(binding.el)) return true;
      this.disposeNetworkBinding(binding);
      return false;
    });
  }

  hydrateAfterSwap(container) {
    if (!container?.isConnected) return;
    const owner = container.closest(`[${ATTR_DATA}]`);
    const roots = new Set([owner, ...container.querySelectorAll(`[${ATTR_DATA}]`)]);
    if (container.hasAttribute(ATTR_DATA)) roots.add(container);
    roots.forEach((root) => {
      if (!root?.isConnected) return;
      const parent = root.parentElement?.closest(`[${ATTR_DATA}]`)?.__sprucex;
      if (!root.__sprucex) {
        root.__sprucex = new Component(root, {
          parentComponent: parent,
          locals: parent?.getElementLocals(root),
        });
      } else {
        const component = root.__sprucex;
        component.pruneDetachedBindings();
        // Rebuild plugin collections without recreating existing loop rows.
        component.teardownIntegrations();
        component.gridBindings = [];
        component.initIntegrationBindings();
        walk(root, (el) => {
          if (el !== root && el.hasAttribute(ATTR_DATA)) return false;
          if (component.scannedElements.has(el) &&
              component.directiveSignatures.get(el) !== component.directiveSignature(el)) {
            component.pruneDetachedBindings([el], true);
            component.scannedElements.delete(el);
          }
          if (component.scannedElements.has(el)) {
            component.scanIntegrations(el, component.getElementLocals(el));
          }
        });
        component.scan(root);
        component.renderForBlocks();
        component.applyInitialRender();
      }
    });
  }

  abortCancelableRequests() {
    this.netBindings.forEach((binding) => {
      const meta = this.netRequestMeta.get(binding);
      if (meta && meta.controller && typeof meta.controller.abort === "function") {
        meta.controller.abort();
      }
    });
  }

  initGridBindings() {
    this.gridBindings.forEach((binding) => {
      const { el } = binding;
      if (!el.isConnected || this.gridInstances.has(el)) return;

      if (
        typeof window === "undefined" ||
        !window.GridStack ||
        typeof window.GridStack.init !== "function"
      ) {
        if (!this.warnedMissingGridStack) {
          this.warnedMissingGridStack = true;
          console.warn(
            "SpruceX: sx-gridstack requires GridStack on window.GridStack.",
          );
        }
        return;
      }

      const options = this.buildGridOptions(binding);
      const grid = window.GridStack.init(options, el);
      const cleanups = [];

      const bindInto = (eventName, targetExpr) => {
        if (!targetExpr) return;
        const handler = (_event, nodes = []) => {
          const value = this.serializeGridNodes(nodes);
          this.assignStateValue(targetExpr, value);
          el.dispatchEvent(
            new CustomEvent(`sprucex:gridstack:${eventName}`, {
              detail: value,
              bubbles: true,
            }),
          );
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

      this.gridInstances.set(el, { grid, cleanups });
    });
  }

  buildGridOptions(binding) {
    const options = {};
    const { el, gridExpr, gridOptionsExpr } = binding;

    if (gridExpr && gridExpr.trim() && gridExpr.trim() !== "true") {
      const evaluated = safeEval(gridExpr, this);
      if (evaluated && typeof evaluated === "object" && !Array.isArray(evaluated)) {
        Object.assign(options, evaluated);
      }
    }

    if (gridOptionsExpr) {
      const evaluated = safeEval(gridOptionsExpr, this);
      if (evaluated && typeof evaluated === "object" && !Array.isArray(evaluated)) {
        Object.assign(options, evaluated);
      }
    }

    Array.from(el.attributes)
      .filter((attr) => attr.name.startsWith(ATTR_GRIDSTACK_OPTION_PREFIX))
      .forEach((attr) => {
        const rawName = attr.name.slice(ATTR_GRIDSTACK_OPTION_PREFIX.length);
        if (!rawName) return;

        const optionName = rawName.replace(/-([a-z])/g, (_, c) =>
          c.toUpperCase(),
        );
        options[optionName] = this.parseGridOptionValue(attr.value);
      });

    return options;
  }

  parseGridOptionValue(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return true;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;

    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return asNum;

    const evaluated = safeEval(trimmed, this);
    return evaluated === undefined ? trimmed : evaluated;
  }

  serializeGridNodes(nodes) {
    if (!Array.isArray(nodes)) return [];

    return nodes.map((node) => ({
      id: node?.id ?? node?.el?.id ?? null,
      x: node?.x,
      y: node?.y,
      w: node?.w,
      h: node?.h,
      minW: node?.minW,
      minH: node?.minH,
      maxW: node?.maxW,
      maxH: node?.maxH,
    }));
  }

  teardownGridBindings() {
    this.gridInstances.forEach(({ grid, cleanups }) => {
      cleanups.forEach((fn) => fn());
      if (grid && typeof grid.destroy === "function") {
        grid.destroy(false);
      }
    });
    this.gridInstances.clear();
  }

  applySwap(targetSelectorOrEl, html, swap) {
    const target =
      typeof targetSelectorOrEl === "string"
        ? document.querySelector(targetSelectorOrEl)
        : targetSelectorOrEl;

    if (!target) return;
    const container = ["outerHTML", "before", "after"].includes(swap)
      ? target.parentElement : target;
    if (swap === "outerHTML" && target.__sprucex) target.__sprucex.destroy();

    switch (swap) {
      case "outerHTML":
        target.outerHTML = html;
        break;
      case "before":
        target.insertAdjacentHTML("beforebegin", html);
        break;
      case "after":
        target.insertAdjacentHTML("afterend", html);
        break;
      case "prepend":
        target.insertAdjacentHTML("afterbegin", html);
        break;
      case "append":
        target.insertAdjacentHTML("beforeend", html);
        break;
      case "morph": {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
        const source = doc.body.firstChild;
        if (source) morphNodes(target, source); // Use morphNodes for smart morphing
        break;
      }
      case "id-map": {
        // Re-use morphNodes which handles ID mapping now
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
        const source = doc.body.firstChild;
        if (source) morphNodes(target, source);
        break;
      }
      case "innerHTML":
      default:
        target.innerHTML = html;
    }
    this.hydrateAfterSwap(container);
  }

  isForBlockDetached(block) {
    if (!block) return true;
    const { parent, marker } = block;
    if (!parent || !marker) return true;
    if (!parent.isConnected || !marker.isConnected) return true;
    if (marker.parentNode !== parent) return true;
    return false;
  }

  teardownForBlock(block) {
    if (!block) return;

    const instances = Array.isArray(block.instances) ? [...block.instances] : [];
    instances.forEach((inst) => {
      this.disposeForInstance(inst);
    });

    if (block.instances) block.instances.length = 0;

    const idx = this.forBlocks.indexOf(block);
    if (idx !== -1) this.forBlocks.splice(idx, 1);
  }

  teardownDetachedForBlocks() {
    this.forBlocks.slice().forEach((block) => {
      if (this.isForBlockDetached(block)) {
        this.teardownForBlock(block);
      }
    });
  }

  teardownAllForBlocks() {
    this.forBlocks.slice().forEach((block) => {
      this.teardownForBlock(block);
      if (block.template && block.marker && block.marker.parentNode) {
        block.marker.parentNode.insertBefore(block.template, block.marker);
        block.marker.remove();
      }
    });
    this.forBlocks = [];
  }

  renderForBlocks() {
    const focusedEl = document.activeElement;
    const selection = focusedEl && typeof focusedEl.selectionStart === "number"
      ? [focusedEl.selectionStart, focusedEl.selectionEnd, focusedEl.selectionDirection]
      : null;
    this.teardownDetachedForBlocks();

    // Queue-style traversal: nested blocks created while scanning are processed
    // in this same render cycle instead of waiting for another update.
    let blockIndex = 0;
    while (blockIndex < this.forBlocks.length) {
      const block = this.forBlocks[blockIndex];
      if (!block) {
        blockIndex += 1;
        continue;
      }
      if (this.isForBlockDetached(block)) {
        this.teardownForBlock(block);
        continue;
      }

      const { def, template, parent, marker, instances, parentLocals, keyExpr } =
        block;

      // For nested loops, set the parent locals before evaluating
      const prevLocals = this.locals;
      if (parentLocals) {
        this.locals = parentLocals;
      }

      const collection = safeEval(def.iterable, this) || [];
      const arr = Array.from(collection);

      // Restore locals
      this.locals = prevLocals;

      // Build buckets of existing instances by key so duplicate primitive
      // values can re-use one instance per occurrence instead of leaking.
      const instanceBuckets = new Map();
      instances.forEach((inst) => {
        const key = inst.itemKey;
        if (!instanceBuckets.has(key)) instanceBuckets.set(key, []);
        instanceBuckets.get(key).push(inst);
      });

      const newInstances = [];
      const reusedInstances = new Set();
      const seenKeys = new Set();

      // Pass 1: Prepare instances (match existing or create new)
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const idxName = def.index || "$index";

        const localsForKey = parentLocals ? { ...parentLocals } : {};
        localsForKey[def.item] = item;
        localsForKey[idxName] = i;

        // Default to index-based keys for deterministic behavior when no key is
        // provided (this matches positional patching semantics).
        let key = i;
        if (keyExpr) {
          const prevLocalsForKey = this.locals;
          this.locals = localsForKey;
          try {
            key = safeEval(keyExpr, this);
          } finally {
            this.locals = prevLocalsForKey;
          }
          if (key === undefined || key === null) key = i;
        }
        if (seenKeys.has(key)) {
          console.warn(
            "SpruceX sx-for detected a duplicate key. This can cause unstable row reuse.",
            key,
          );
        }
        seenKeys.add(key);

        const bucket = instanceBuckets.get(key);
        const inst = bucket && bucket.length > 0 ? bucket.shift() : null;

        // Reuse an existing instance for this occurrence (if available)
        if (inst) {
          if (parentLocals) {
            Object.keys(parentLocals).forEach((parentKey) => {
              inst.scopeLocals[parentKey] = parentLocals[parentKey];
            });
          }
          inst.scopeLocals[def.item] = item;
          inst.scopeLocals[idxName] = i;
          (inst.bindings.nestedDataComponents || []).forEach((component) => {
            Object.assign(component.locals, inst.scopeLocals);
            component.scheduleUpdate();
          });
          newInstances.push(inst);
          reusedInstances.add(inst);
        } else {
          // Create new instance - merge parentLocals into locals
          const locals = parentLocals ? { ...parentLocals } : {};
          locals[def.item] = item;
          locals[idxName] = i;

          const frag = template.content
            ? template.content.cloneNode(true)
            : cloneChildren(template);

          // Elements are created but not inserted yet
          const elements = [];
          while (frag.firstChild) {
            const child = frag.firstChild;
            elements.push(child);
            frag.removeChild(child);
          }

          // Scan for bindings (on detached nodes)
          const instanceBindings = {
            bindings: [],
            memoBindings: [],
            modelBindings: [],
            eventHandlers: [],
            netBindings: [],
            nestedForBlocks: [],
          };

          elements.forEach((el) => {
            const elBindings = this.scanFragmentBindings(el, locals);
            instanceBindings.bindings.push(...elBindings.bindings);
            instanceBindings.memoBindings.push(...elBindings.memoBindings);
            instanceBindings.modelBindings.push(...elBindings.modelBindings);
            instanceBindings.eventHandlers.push(...elBindings.eventHandlers);
            instanceBindings.netBindings.push(...elBindings.netBindings);
            if (elBindings.nestedForBlocks) {
              instanceBindings.nestedForBlocks.push(
                ...elBindings.nestedForBlocks,
              );
            }
          });

          const newInst = {
            scopeLocals: locals,
            elements,
            bindings: instanceBindings,
            itemKey: key,
            mounted: false,
          };

          newInstances.push(newInst);
        }
      }

      // Pass 2: Remove unused instances from DOM immediately
      instances.forEach((inst) => {
        if (!reusedInstances.has(inst)) {
          this.disposeForInstance(inst);
        }
      });

      // Pass 3: Reorder/Insert instances backwards
      let anchor = marker;
      for (let i = newInstances.length - 1; i >= 0; i--) {
        const inst = newInstances[i];

        for (let j = inst.elements.length - 1; j >= 0; j--) {
          const el = inst.elements[j];
          if (el.parentNode !== parent || el.nextSibling !== anchor) {
            parent.insertBefore(el, anchor);
          }
          anchor = el;
        }

        if (!inst.mounted) {
          this.mountForInstance(inst);
          inst.mounted = true;
        }
      }

      // Replace instances array with new order
      block.instances.length = 0;
      block.instances.push(...newInstances);
      blockIndex += 1;
    }
    if (focusedEl?.isConnected && this.root.contains(focusedEl) && document.activeElement !== focusedEl) {
      focusedEl.focus({ preventScroll: true });
      if (selection) focusedEl.setSelectionRange(...selection);
    }
  }

  scanFragmentBindings(rootNode, locals) {
    const fields = ["bindings", "memoBindings", "modelBindings", "eventHandlers", "netBindings", "forBlocks"];
    const starts = Object.fromEntries(fields.map((key) => [key, this[key].length]));
    this.scan(rootNode, locals, true);
    const result = Object.fromEntries(fields.map((key) => [key, this[key].slice(starts[key])]));
    result.nestedForBlocks = result.forBlocks;
    return result;
  }

  setupModelBinding(el, locals = null) {
    const direct = el.getAttribute(ATTR_MODEL);
    const modifierAttrs = Array.from(el.attributes).filter((a) =>
      a.name.startsWith(ATTR_MODEL_PREFIX),
    );
    if (!direct && modifierAttrs.length === 0) return null;

    const { keyExpr, mods, debounceMs } = this.parseModelBindingConfig(
      direct,
      modifierAttrs,
    );

    const type = (el.type || "").toLowerCase();
    const isCheckbox = type === "checkbox";
    const isRadio = type === "radio";
    const isSelect = el.tagName === "SELECT";

    const updateDom = () => {
      const prev = this.locals;
      if (locals) this.locals = locals;
      try {
        // Add try/finally to restore locals even on error
        const v = safeEval(keyExpr, this);
        if (isCheckbox) {
          if (Array.isArray(v)) {
            el.checked = v.includes(el.value);
          } else {
            el.checked = !!v;
          }
        } else if (isRadio) {
          el.checked = String(v) === String(el.value);
        } else if (isSelect) {
          el.value = v ?? "";
        } else {
          if (v !== null && v !== undefined && typeof v === "object") {
            el.value = JSON.stringify(v);
          } else {
            el.value = v ?? "";
          }
        }
      } finally {
        this.locals = prev;
      }
    };

    const applyModifiers = (val) => {
      if (mods.has("trim") && typeof val === "string") val = val.trim();
      if (mods.has("number")) {
        const n = Number(val);
        if (!Number.isNaN(n)) val = n;
      }
      return val;
    };

    const writeBack = () => {
      const prev = this.locals;
      if (locals) this.locals = locals;
      try {
        let v;
        if (isCheckbox) {
          const current = safeEval(keyExpr, this);
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
        } else if (isSelect) {
          v = el.value;
        } else {
          v = el.value;
        }
        v = applyModifiers(v);
        execInScope(`${keyExpr} = __sx_value`, this, { __sx_value: v });
      } finally {
        this.locals = prev;
      }
    };

    let eventName = "input";
    if (mods.has("lazy")) eventName = "change";

    const handler = this.wrapDebounced(writeBack, debounceMs);

    el.addEventListener(eventName, handler);

    const modelBinding = { updateDom, locals, el, event: eventName, handler };
    this.eventHandlers.push({ el, event: eventName, handler });
    this.modelBindings.push(modelBinding);

    return modelBinding;
  }

  cleanupInstanceBindings(instanceBindings) {
    if (!instanceBindings) return;

    // Use Sets for O(1) lookup instead of O(n) indexOf per item
    const bindingsToRemove = new Set(instanceBindings.bindings || []);
    const memosToRemove = new Set(instanceBindings.memoBindings || []);
    const modelsToRemove = new Set(instanceBindings.modelBindings || []);

    if (bindingsToRemove.size > 0) {
      this.bindings = this.bindings.filter((b) => !bindingsToRemove.has(b));
    }
    if (memosToRemove.size > 0) {
      this.memoBindings = this.memoBindings.filter((b) => !memosToRemove.has(b));
    }
    if (modelsToRemove.size > 0) {
      this.modelBindings = this.modelBindings.filter((b) => !modelsToRemove.has(b));
    }

    // Remove event handlers
    const handlersToRemove = new Set();
    (instanceBindings.eventHandlers || []).forEach((record) => {
      this.removeEventHandler(record);
      handlersToRemove.add(record.handler);
    });
    if (handlersToRemove.size > 0) {
      this.eventHandlers = this.eventHandlers.filter(
        (h) => !handlersToRemove.has(h.handler),
      );
    }

    (instanceBindings.netBindings || []).forEach((binding) => this.disposeNetworkBinding(binding));
    this.netBindings = this.netBindings.filter((binding) => !binding.disposed);

    // Recursively remove nested sx-for blocks created for this instance.
    // If these remain in forBlocks, they keep stale locals and continue rendering.
    instanceBindings.nestedForBlocks?.forEach((block) => {
      this.teardownForBlock(block);
    });

    (instanceBindings.nestedDataComponents || []).forEach((component) => {
      if (component && typeof component.destroy === "function") {
        component.destroy();
      }
    });
  }

  mountForInstance(inst) {
    if (!inst?.elements || !inst.bindings) return;
    inst.bindings.nestedDataComponents = inst.bindings.nestedDataComponents || [];

    const nestedRoots = [];
    inst.elements.forEach((node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.hasAttribute(ATTR_DATA)) nestedRoots.push(node);
      node.querySelectorAll?.(`[${ATTR_DATA}]`).forEach((el) => nestedRoots.push(el));
    });

    nestedRoots.forEach((root) => {
      if (root.__sprucex) return;
      const nested = new Component(root, {
        parentComponent: this,
        locals: inst.scopeLocals,
      });
      root.__sprucex = nested;
      inst.bindings.nestedDataComponents.push(nested);
    });
  }

  disposeForInstance(inst) {
    if (!inst) return;
    this.cleanupInstanceBindings(inst.bindings);
    if (inst.elements) {
      inst.elements.forEach((el) => el.remove());
    } else if (inst.fragmentRoot) {
      inst.fragmentRoot.remove();
    }
    const scope = this.integrationScopes.get(inst.scopeLocals);
    if (scope) {
      scope.teardownIntegrations();
      this.integrationScopes.delete(inst.scopeLocals);
    }
    this.pruneDetachedBindings(inst.elements || [inst.fragmentRoot]);
    inst.mounted = false;
  }

  applyInitialRender() {
    this.collectRefs();
    this.updateBindings();
    this.modelBindings.forEach((mb) => mb.updateDom());
    this.updateMemoBindings();
    this.updateIntegrations();
  }

  updateBindings() {
    for (const b of this.bindings) {
      const { el, type, expr, attr, errorFallback, locals } = b;
      const prevLocals = this.locals;
      if (locals) this.locals = locals;
      try {
        switch (type) {
          case "text": {
            const v = safeEval(expr, this, errorFallback);
            if (v !== null && v !== undefined && typeof v === "object") {
              el.textContent = JSON.stringify(v);
            } else {
              el.textContent = v ?? "";
            }
            break;
          }
          case "html": {
            const v = safeEval(expr, this, errorFallback);
            if (v !== null && v !== undefined && typeof v === "object") {
              el.innerHTML = JSON.stringify(v);
            } else {
              el.innerHTML = v ?? "";
            }
            break;
          }
          case "show": {
            const v = !!safeEval(expr, this, errorFallback);
            el.style.display = v ? "" : "none";
            break;
          }
          case "bind": {
            const v = safeEval(expr, this, errorFallback);
            if (v === false || v === null || v === undefined) {
              el.removeAttribute(attr);
            } else {
              el.setAttribute(attr, v);
            }
            break;
          }
          case "class": {
            const v = safeEval(expr, this, errorFallback);
            const original = this.originalClasses.get(el) || new Set();
            // Get current classes
            const current = new Set(Array.from(el.classList));

            if (typeof v === "string") {
              // String mode: replace all sx-managed classes
              const newClasses = new Set(v.split(/\s+/).filter(Boolean));
              // Remove non-original classes, then add new ones
              current.forEach((c) => {
                if (!original.has(c)) el.classList.remove(c);
              });
              newClasses.forEach((c) => el.classList.add(c));
            } else if (v && typeof v === "object") {
              // Object mode: toggle classes
              // Keys may contain multiple space-separated classes
              Object.keys(v).forEach((k) => {
                k.split(/\s+/)
                  .filter(Boolean)
                  .forEach((cls) => {
                    if (v[k]) el.classList.add(cls);
                    else el.classList.remove(cls);
                  });
              });
            }
            break;
          }
        }
      } finally {
        this.locals = prevLocals;
      }
    }
  }

  updateMemoBindings() {
    this.memoBindings.forEach((mb) => {
      const { el, expr, type, deps, locals } = mb;
      const prevLocals = this.locals;
      if (locals) this.locals = locals;
      try {
        // Get dep values from both state and locals
        const currVals = deps.map((k) => {
          if (locals && k in locals) return locals[k]; // Check locals first? Or state? SpruceX preference? Locals usually shadow.
          if (k in this.state) return this.state[k];
          // Fallback for expression usage?
          // Actually, deps are keys.
          // If key is not in locals, check state.
          return this.state[k];
        });

        if (
          mb.lastVals &&
          mb.lastVals.length === currVals.length &&
          mb.lastVals.every((v, i) => v === currVals[i])
        ) {
          return;
        }

        mb.lastVals = currVals;
        const v = safeEval(expr, this);
        mb.lastResult = v;
        if (type === "text") {
          el.textContent = v ?? "";
        } else {
          el.innerHTML = v ?? "";
        }
      } finally {
        this.locals = prevLocals;
      }
    });
  }

  callHook(name) {
    const fn = this.state && this.state[name];
    if (typeof fn === "function") {
      try {
        fn.call(this.state);
      } catch (e) {
        console.error(`SpruceX ${name}() hook error:`, e);
      }
    }
  }

  refresh() {
    this.abortCancelableRequests();
    this.teardownIntegrations();
    this.netBindings.forEach((binding) => this.disposeNetworkBinding(binding));
    this.clearDebounceTimers();
    this.clearEmitterHandlers();
    this.teardownAllForBlocks();

    this.scannedElements = new WeakSet();
    this.directiveSignatures = new WeakMap();
    this.elementLocals = new WeakMap();
    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.netBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];

    this.eventHandlers.forEach((record) => this.removeEventHandler(record));
    this.eventHandlers = [];

    // Clear delegated handlers
    walk(this.root, (el) => {
      if (el !== this.root && el.hasAttribute(ATTR_DATA)) return false;
      if (el.__sx_handlers) delete el.__sx_handlers;
    });

    this.animatedElements.forEach((controller, el) => {
      this.disableAutoAnimate(el);
    });
    this.animatedElements.clear();

    this.pollTimers.forEach((t) => clearInterval(t));
    this.pollTimers = [];

    this.collectRefs();
    this.initIntegrationBindings();
    this.scan(this.root);
    this.renderForBlocks();
    this.applyInitialRender();
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.callHook("destroyed");
    this.abortCancelableRequests();
    this.netBindings.forEach((binding) => this.disposeNetworkBinding(binding));

    // Clean up store subscriptions
    Object.keys(storeSubscribers).forEach((name) => {
      storeSubscribers[name].delete(this);
    });

    // Clean up auto-animate
    this.animatedElements.forEach((controller, el) => {
      this.disableAutoAnimate(el);
    });
    this.animatedElements.clear();
    this.teardownIntegrations();
    this.teardownAllForBlocks();

    // Clean up event handlers
    this.eventHandlers.forEach((record) => this.removeEventHandler(record));
    this.clearEmitterHandlers();
    if (this._delegatedCleanups) {
      this._delegatedCleanups.forEach((fn) => fn());
    }

    // Clean up poll timers
    this.pollTimers.forEach((t) => clearInterval(t));
    this.clearDebounceTimers();

    // Cancel pending updates
    if (this.rafId) cancelAnimationFrame(this.rafId);

    // Clear arrays
    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.eventHandlers = [];
    this.gridBindings = [];
    this.netBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];

    // Remove reference
    delete this.root.__sprucex;
  }
}
