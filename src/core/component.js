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
  ATTR_CHART,
  ATTR_CHART_TYPE,
  ATTR_CHART_OPTIONS,
  ATTR_GRIDSTACK,
  ATTR_GRIDSTACK_OPTIONS,
  ATTR_GRIDSTACK_OPTION_PREFIX,
  ATTR_GRIDSTACK_ON_CHANGE,
  ATTR_GRIDSTACK_ON_ADDED,
  ATTR_GRIDSTACK_ON_REMOVED,
  ATTR_GRIDSTACK_ON_DRAGSTOP,
  ATTR_GRIDSTACK_ON_RESIZESTOP,
  ATTR_LAZY,
  ATTR_LOCAL,
  ATTR_ANIMATE,
  DELEGATED_EVENTS,
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

// We need to split Component because it's huge.
// But for now, I'll write the class as is, importing dependencies.

export class Component {
  constructor(root) {
    this.root = root;
    this.bindings = [];
    this.memoBindings = [];
    this.eventHandlers = [];
    this.emitterHandlers = [];
    this.netBindings = [];
    this.modelBindings = [];
    this.chartBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];
    this.debounceTimers = new Set();
    this.chartInstances = new Map();
    this.chartSnapshots = new WeakMap();
    this.gridInstances = new Map();
    this.requestUiState = new WeakMap();
    this.warnedMissingChart = false;
    this.warnedMissingGridStack = false;
    this.lastEvent = null;
    this.debug = false;
    this.locals = {};
    this.updatePending = false;
    this.originalClasses = new WeakMap(); // Track original classes for sx-class
    this.animatedElements = new Map(); // Track auto-animated elements

    this.refs = {};
    this.emitter = document.createElement("div");

    this.emit = (name, detail) => {
      const evt = new CustomEvent(name, { detail, bubbles: false });
      this.emitter.dispatchEvent(evt);
    };

    this.initState();
    this.collectRefs();

    this.setupDelegation();

    this.scan(root);
    this.renderForBlocks();
    this.applyInitialRender();
    this.callHook("init");
    queueMicrotask(() => this.callHook("mounted"));
  }

  // Batched update scheduling
  scheduleUpdate() {
    if (this.updatePending) return;
    this.updatePending = true;

    // Use requestAnimationFrame for better rendering performance
    this.rafId = requestAnimationFrame(() => {
      this.updatePending = false;
      this.rafId = null;

      // Check if a text-entry control inside a for-block is focused.
      // We intentionally do not include checkbox/radio/select/button controls,
      // because those interactions should immediately reflect loop updates.
      const activeEl = document.activeElement;
      const isTextInput =
        activeEl &&
        activeEl.tagName === "INPUT" &&
        ![
          "checkbox",
          "radio",
          "button",
          "submit",
          "reset",
          "file",
          "color",
          "range",
          "hidden",
        ].includes((activeEl.type || "text").toLowerCase());
      const isInputFocused =
        activeEl &&
        (isTextInput || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);

      // Preserve focus while typing by skipping only the focused loop block,
      // not all sx-for blocks in the component.
      const focusedForInput =
        isInputFocused && this.root.contains(activeEl) ? activeEl : null;
      this.renderForBlocks(focusedForInput);

      this.updateBindings();
      this.modelBindings.forEach((mb) => mb.updateDom());
      this.updateMemoBindings();
      this.updateChartBindings();
      this.initGridBindings();
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

    let raw;
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
                  `return [${argsSource}];`,
                )(storeAccessor, getDataFactory)
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
              `return (${rawExpr});`,
            );
            raw = fn(storeAccessor, getDataFactory);
          }
        } else {
          const fn = new Function("$store", "$data", `return (${rawExpr});`);
          raw = fn(storeAccessor, getDataFactory);
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
    this.root.querySelectorAll("[sx-ref]").forEach((el) => {
      const name = el.getAttribute("sx-ref");
      if (name) this.refs[name] = el;
    });
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

  scan(root) {
    const self = this;

    walk(root, (el) => {
      if (el !== root && el.hasAttribute(ATTR_DATA)) return false;

      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
        const expr = el.getAttribute(ATTR_FOR) || "";
        const parent = el.parentElement;
        if (!parent) return;

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
      if (el !== root && el.hasAttribute(ATTR_DATA)) return false;
      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) return;

      this.scanElement(el, null);
    });

    this.setupNetworkBindings();
  }

  scanElement(el, locals) {
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
        this.state[toggleKey] = !this.state[toggleKey];
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
          if (mods.includes("self") && ev.target !== ev.currentTarget) return;
          if (mods.includes("window") && ev.target !== window) return;
          if (mods.includes("document") && ev.target !== document) return;

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

        if (DELEGATED_EVENTS.has(eventName)) {
          if (!el.__sx_handlers) el.__sx_handlers = {};
          if (!el.__sx_handlers[eventName]) el.__sx_handlers[eventName] = [];
          el.__sx_handlers[eventName].push({ handler, component: this });
        } else {
          el.addEventListener(eventName, handler);
          self.eventHandlers.push({ el, event: eventName, handler });
        }
      }
    }

    // Network bindings
    if (!locals) {
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

          const binding = {
            el,
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
          };

          self.netBindings.push(binding);
        }
      }

      const chartExpr = el.getAttribute(ATTR_CHART);
      if (chartExpr) {
        self.chartBindings.push({
          el,
          chartExpr,
          chartTypeExpr: el.getAttribute(ATTR_CHART_TYPE),
          chartOptionsExpr: el.getAttribute(ATTR_CHART_OPTIONS),
        });
      }

      if (el.hasAttribute(ATTR_GRIDSTACK)) {
        self.gridBindings.push({
          el,
          gridExpr: el.getAttribute(ATTR_GRIDSTACK),
          gridOptionsExpr: el.getAttribute(ATTR_GRIDSTACK_OPTIONS),
          onChangeInto: el.getAttribute(ATTR_GRIDSTACK_ON_CHANGE),
          onAddedInto: el.getAttribute(ATTR_GRIDSTACK_ON_ADDED),
          onRemovedInto: el.getAttribute(ATTR_GRIDSTACK_ON_REMOVED),
          onDragstopInto: el.getAttribute(ATTR_GRIDSTACK_ON_DRAGSTOP),
          onResizestopInto: el.getAttribute(ATTR_GRIDSTACK_ON_RESIZESTOP),
        });
      }
    }

    // Auto-animate
    if (el.hasAttribute(ATTR_ANIMATE)) {
      const optionsStr = el.getAttribute(ATTR_ANIMATE);
      // Defer setup to allow DOM to be ready
      queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
    }
  }

  // ... remaining methods ...
  setupModelBinding(el, locals = null) {
    const direct = el.getAttribute(ATTR_MODEL);
    const modifierAttrs = Array.from(el.attributes).filter((a) =>
      a.name.startsWith(ATTR_MODEL_PREFIX),
    );
    if (!direct && modifierAttrs.length === 0) return;

    const keyExpr = direct || modifierAttrs[0].value;
    const mods = new Set();
    let debounceMs = null;
    modifierAttrs.forEach((a) => {
      const rest = a.name.slice(ATTR_MODEL_PREFIX.length);
      if (rest.startsWith("debounce-ms")) {
        debounceMs = Number(a.value || "200");
      } else {
        mods.add(rest);
      }
    });

    const type = (el.type || "").toLowerCase();
    const isCheckbox = type === "checkbox";
    const isRadio = type === "radio";
    const isSelect = el.tagName === "SELECT";

    const updateDom = () => {
      const prev = this.locals;
      if (locals) this.locals = locals;
      try {
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
        execInScope(`${keyExpr} = value`, this, { value: v });
      } finally {
        this.locals = prev;
      }
    };

    let eventName = "input";
    if (mods.has("lazy")) eventName = "change";

    let handler = writeBack;
    if (debounceMs != null && debounceMs > 0) {
      let t = null;
      handler = () => {
        clearTimeout(t);
        t = setTimeout(writeBack, debounceMs);
      };
    }

    el.addEventListener(eventName, handler);
    this.eventHandlers.push({ el, event: eventName, handler });
    this.modelBindings.push({ updateDom, locals });
  }

  setupNetworkBindings() {
    for (const nb of this.netBindings) {
      const { el, poll, pollWhile } = nb;
      const triggerDefs = this.parseNetworkTriggers(nb);

      const doReq = (ev = null) => {
        if (ev) {
          this.lastEvent = ev;
          if (ev.type === "submit") ev.preventDefault();
        }

        if (!this.confirmRequest(nb)) return;
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
          () => this.performRequest(nb),
          debounceMs,
        );
        this.emitter.addEventListener(eventName, compHandler);
        this.emitterHandlers.push({ event: eventName, handler: compHandler });
      });

      if (poll && !Number.isNaN(poll) && poll > 0) {
        const timer = setInterval(() => {
          if (pollWhile) {
            const ok = !!safeEval(pollWhile, this);
            if (!ok) return;
          }
          this.performRequest(nb);
        }, poll);
        this.pollTimers.push(timer);
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
    return (...args) => {
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(timer);
      }

      timer = setTimeout(() => {
        this.debounceTimers.delete(timer);
        timer = null;
        fn(...args);
      }, debounceMs);

      this.debounceTimers.add(timer);
    };
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
        options = new Function(`return (${options})`)();
      } catch (e) {
        console.error("SpruceX sx-animate options parse error:", e);
        options = {};
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
    try {
      const fn = new Function("vars", "with(vars){ return `" + urlTpl + "`; }");
      return fn(vars);
    } catch (e) {
      console.error("SpruceX url template error:", urlTpl, e);
      return urlTpl;
    }
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

  async performRequest(nb) {
    const url = this.buildUrl(nb);
    const { body, bodyKind } = this.buildBody(nb);
    const headers = this.buildHeaders(nb, bodyKind, body != null);
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
    const endUiState = this.beginRequestUiState(nb);

    this.assignStateValue(loadingInto, true);
    this.assignStateValue(errorInto, null);

    if (optimistic) {
      execInScope(optimistic, this);
    }

    try {
      const fetchOptions = { method };
      if (body != null) fetchOptions.body = body;
      if (Array.from(headers.keys()).length > 0) {
        fetchOptions.headers = headers;
      }

      const res = await fetch(url, fetchOptions);

      // Check for HTTP errors
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      let json = null;

      if (jsonInto && text.trim().length) {
        try {
          json = JSON.parse(text);
        } catch (e) {
          console.error("SpruceX JSON parse error:", e);
        }
      }

      if (jsonInto && json != null) {
        execInScope(`${jsonInto} = value`, this, { value: json });
      } else {
        this.applySwap(target || el, text, swap);
      }

      const detail = { response: res, text, json };
      el.dispatchEvent(new CustomEvent("success", { detail, bubbles: true }));
      el.dispatchEvent(
        new CustomEvent("sprucex:success", { detail, bubbles: true }),
      );
    } catch (error) {
      if (revertOnError) {
        execInScope(revertOnError, this);
      }
      this.assignStateValue(errorInto, this.serializeError(error));
      const detail = { error };
      el.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
      el.dispatchEvent(
        new CustomEvent("sprucex:error", { detail, bubbles: true }),
      );
    } finally {
      this.assignStateValue(loadingInto, false);
      endUiState();
    }
  }

  getChartConstructor() {
    if (typeof window === "undefined") return null;
    const maybe = window.Chart;
    return maybe && typeof maybe === "object" ? maybe.Chart || maybe : maybe;
  }

  updateChartBindings() {
    this.chartBindings.forEach((binding) => this.syncChartBinding(binding));
  }

  syncChartBinding(binding) {
    const { el, chartExpr, chartTypeExpr, chartOptionsExpr } = binding;

    if (!el.isConnected) {
      this.destroyChartInstance(el);
      return;
    }

    const payload = safeEval(chartExpr, this);
    if (payload == null) {
      this.destroyChartInstance(el);
      return;
    }

    const ChartCtor = this.getChartConstructor();
    if (!ChartCtor) {
      if (!this.warnedMissingChart) {
        this.warnedMissingChart = true;
        console.warn(
          "SpruceX: sx-chart requires Chart.js to be loaded on window.Chart.",
        );
      }
      return;
    }

    const canvas = this.getChartCanvas(el);
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;

    const explicitType =
      chartTypeExpr != null ? this.evaluateExpressionOrLiteral(chartTypeExpr) : null;
    const explicitOptions =
      chartOptionsExpr != null
        ? this.evaluateExpressionOrLiteral(chartOptionsExpr)
        : null;

    const data =
      payload && typeof payload === "object" && "data" in payload
        ? payload.data
        : payload;
    const type =
      (typeof explicitType === "string" && explicitType.trim()) ||
      (payload && typeof payload === "object" ? payload.type : null) ||
      "line";
    const options =
      explicitOptions && typeof explicitOptions === "object"
        ? explicitOptions
        : payload &&
            typeof payload === "object" &&
            payload.options &&
            typeof payload.options === "object"
          ? payload.options
          : {};
    const safeData = this.cloneChartConfigValue(data);
    const safeOptions = this.cloneChartConfigValue(options);

    let chart = this.chartInstances.get(el);
    if (chart && chart.config?.type !== type) {
      chart.destroy();
      this.chartInstances.delete(el);
      chart = null;
    }

    if (!chart) {
      chart = new ChartCtor(ctx, {
        type,
        data: safeData,
        options: safeOptions,
      });
      this.chartInstances.set(el, chart);
      this.chartSnapshots.set(el, {
        type,
        data: safeData,
        options: safeOptions,
      });
      return;
    }

    const previousSnapshot = this.chartSnapshots.get(el);
    const nextSnapshot = { type, data: safeData, options: safeOptions };
    if (
      previousSnapshot &&
      this.areChartValuesEqual(previousSnapshot, nextSnapshot)
    ) {
      return;
    }

    chart.data = safeData;
    chart.options = safeOptions;
    chart.update();
    this.chartSnapshots.set(el, nextSnapshot);
  }

  cloneChartConfigValue(value, seen = new WeakMap()) {
    if (value == null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      value.forEach((item) => out.push(this.cloneChartConfigValue(item, seen)));
      return out;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const out = {};
    seen.set(value, out);
    Object.keys(value).forEach((key) => {
      out[key] = this.cloneChartConfigValue(value[key], seen);
    });
    return out;
  }

  areChartValuesEqual(a, b, seen = new WeakMap()) {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b) return false;

    if (a == null || b == null) return false;
    if (typeof a !== "object") return false;

    const pairSet = seen.get(a);
    if (pairSet && pairSet.has(b)) return true;
    if (pairSet) {
      pairSet.add(b);
    } else {
      seen.set(a, new WeakSet([b]));
    }

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (!this.areChartValuesEqual(a[i], b[i], seen)) return false;
      }
      return true;
    }

    if (Array.isArray(b)) return false;

    const protoA = Object.getPrototypeOf(a);
    const protoB = Object.getPrototypeOf(b);
    if (protoA !== protoB) return false;

    if (protoA !== Object.prototype && protoA !== null) {
      return false;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (let i = 0; i < keysA.length; i += 1) {
      const key = keysA[i];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.areChartValuesEqual(a[key], b[key], seen)) return false;
    }

    return true;
  }

  getChartCanvas(el) {
    if (el.tagName === "CANVAS") return el;
    const existing = el.querySelector("canvas");
    if (existing) return existing;

    const created = document.createElement("canvas");
    el.appendChild(created);
    return created;
  }

  destroyChartInstance(el) {
    const chart = this.chartInstances.get(el);
    if (!chart) return;
    try {
      chart.destroy();
    } catch (e) {
      console.error("SpruceX sx-chart destroy error:", e);
    }
    this.chartInstances.delete(el);
    this.chartSnapshots.delete(el);
  }

  teardownChartBindings() {
    this.chartInstances.forEach((_, el) => this.destroyChartInstance(el));
    this.chartInstances.clear();
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
      if (inst.elements) {
        inst.elements.forEach((el) => el.remove());
      } else if (inst.fragmentRoot) {
        inst.fragmentRoot.remove();
      }
      this.cleanupInstanceBindings(inst.bindings);
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
    this.forBlocks.slice().forEach((block) => this.teardownForBlock(block));
    this.forBlocks = [];
  }

  renderForBlocks(focusedEl = null) {
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

      const { def, template, parent, marker, instances, parentLocals } = block;

      const skipFocusedBlock =
        focusedEl &&
        block.instances.some(
          (inst) =>
            inst.elements &&
            inst.elements.some((el) => el.contains(focusedEl)),
        );
      if (skipFocusedBlock) {
        blockIndex += 1;
        continue;
      }

      // For nested loops, set the parent locals before evaluating
      const prevLocals = this.locals;
      if (parentLocals) {
        this.locals = parentLocals;
      }

      const collection = safeEval(def.iterable, this) || [];
      const arr = Array.from(collection);

      // Restore locals
      this.locals = prevLocals;

      // Build a map of existing instances by their item value
      const instanceMap = new Map();
      instances.forEach((inst) => {
        const key = inst.itemKey;
        if (key !== undefined) {
          instanceMap.set(key, inst);
        }
      });

      const newInstances = [];
      const usedKeys = new Set();

      // Pass 1: Prepare instances (match existing or create new)
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const idxName = def.index || "$index";

        // Use the item itself as the key (works for primitives and objects)
        let key = item;
        // For objects, try to use a stable identity
        if (typeof item === "object" && item !== null) {
          key = item;
        }

        let inst = instanceMap.get(key);

        // If we found an existing instance with this key and haven't used it yet
        if (inst && !usedKeys.has(key)) {
          usedKeys.add(key);

          // Update the index
          inst.scopeLocals[idxName] = i;
          newInstances.push(inst);
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
            nestedForBlocks: [],
          };

          elements.forEach((el) => {
            const elBindings = this.scanFragmentBindings(el, locals);
            instanceBindings.bindings.push(...elBindings.bindings);
            instanceBindings.memoBindings.push(...elBindings.memoBindings);
            instanceBindings.modelBindings.push(...elBindings.modelBindings);
            instanceBindings.eventHandlers.push(...elBindings.eventHandlers);
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
          };

          newInstances.push(newInst);
          usedKeys.add(key);
        }
      }

      // Pass 2: Remove unused instances from DOM immediately
      instances.forEach((inst) => {
        if (!usedKeys.has(inst.itemKey)) {
          if (inst.elements) {
            inst.elements.forEach((el) => el.remove());
          } else if (inst.fragmentRoot) {
            inst.fragmentRoot.remove();
          }
          this.cleanupInstanceBindings(inst.bindings);
        }
      });

      // Pass 3: Reorder/Insert instances backwards
      let anchor = marker;
      for (let i = newInstances.length - 1; i >= 0; i--) {
        const inst = newInstances[i];

        inst.elements.forEach((el) => {
          parent.insertBefore(el, anchor);
        });

        if (inst.elements.length > 0) {
          anchor = inst.elements[0];
        }
      }

      // Replace instances array with new order
      block.instances.length = 0;
      block.instances.push(...newInstances);
      blockIndex += 1;
    }
  }

  scanFragmentBindings(rootNode, locals) {
    const self = this;
    const instanceBindings = {
      bindings: [],
      memoBindings: [],
      modelBindings: [],
      eventHandlers: [],
      nestedForBlocks: [],
    };

    walk(rootNode, (el) => {
      if (el.nodeType !== 1) return;
      if (el.hasAttribute(ATTR_DATA)) return false;

      // Handle nested sx-for templates
      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
        const expr = el.getAttribute(ATTR_FOR) || "";
        const parent = el.parentElement;
        if (!parent) return;

        const marker = document.createComment("sx-for");
        parent.insertBefore(marker, el);
        el.remove();

        const forDef = parseForExpression(expr);
        if (!forDef) {
          console.error("SpruceX invalid nested sx-for expression:", expr);
          return false;
        }

        const nestedBlock = {
          template: el,
          parent,
          marker,
          expr,
          def: forDef,
          instances: [],
          parentLocals: locals,
          autoAnimate: parent.hasAttribute(ATTR_ANIMATE),
        };

        self.forBlocks.push(nestedBlock);
        instanceBindings.nestedForBlocks.push(nestedBlock);

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

        return false; // Don't descend into the template
      }

      const hasMemo = el.hasAttribute(ATTR_MEMO);

      const textExpr = el.getAttribute(ATTR_TEXT);
      if (textExpr && !hasMemo) {
        const binding = {
          el,
          type: "text",
          expr: textExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals,
        };
        self.bindings.push(binding);
        instanceBindings.bindings.push(binding);
      }

      const htmlExpr = el.getAttribute(ATTR_HTML);
      if (htmlExpr && !hasMemo) {
        const binding = {
          el,
          type: "html",
          expr: htmlExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals,
        };
        self.bindings.push(binding);
        instanceBindings.bindings.push(binding);
      }

      const showExpr = el.getAttribute(ATTR_SHOW);
      if (showExpr) {
        const binding = {
          el,
          type: "show",
          expr: showExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals,
        };
        self.bindings.push(binding);
        instanceBindings.bindings.push(binding);
      }

      const classExpr = el.getAttribute(ATTR_CLASS);
      if (classExpr) {
        if (!self.originalClasses.has(el)) {
          self.originalClasses.set(el, new Set(Array.from(el.classList)));
        }
        const binding = {
          el,
          type: "class",
          expr: classExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals,
        };
        self.bindings.push(binding);
        instanceBindings.bindings.push(binding);
      }

      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith(ATTR_BIND_PREFIX)) {
          const name = attr.name.slice(ATTR_BIND_PREFIX.length);
          const binding = {
            el,
            type: "bind",
            attr: name,
            expr: attr.value,
            errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
            locals,
          };
          self.bindings.push(binding);
          instanceBindings.bindings.push(binding);
        }
      }

      // sx-memo in loops
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
        const memoBinding = {
          el,
          expr: textForMemo || htmlForMemo,
          type: textForMemo ? "text" : "html",
          deps,
          lastVals: null,
          lastResult: null,
          locals,
        };
        self.memoBindings.push(memoBinding);
        instanceBindings.memoBindings.push(memoBinding);
      }

      // sx-model in loops
      const modelBinding = this.setupModelBindingWithReturn(el, locals);
      if (modelBinding) {
        instanceBindings.modelBindings.push(modelBinding);
      }

      // event handlers inside loops
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith(ATTR_ON_PREFIX)) {
          const full = attr.name.slice(ATTR_ON_PREFIX.length);
          const [eventName, ...mods] = full.split(".");
          const expr = attr.value;
          const handler = (ev) => {
            if (mods.includes("prevent")) ev.preventDefault();
            if (mods.includes("stop")) ev.stopPropagation();
            if (mods.includes("self") && ev.target !== ev.currentTarget) return;
            if (mods.includes("window") && ev.target !== window) return;
            if (mods.includes("document") && ev.target !== document) return;

            if (ev instanceof KeyboardEvent) {
              const keys = mods.filter(
                (m) =>
                  !["prevent", "stop", "self", "window", "document"].includes(
                    m,
                  ),
              );
              if (keys.length > 0) {
                const key = ev.key.toLowerCase();
                if (!keys.includes(key)) return;
              }
            }

            this.lastEvent = ev;
            const prev = this.locals;
            this.locals = locals;
            execInScope(expr, this);
            this.locals = prev;
          };

          if (DELEGATED_EVENTS.has(eventName)) {
            if (!el.__sx_handlers) el.__sx_handlers = {};
            if (!el.__sx_handlers[eventName]) el.__sx_handlers[eventName] = [];
            el.__sx_handlers[eventName].push({ handler, component: this });
          } else {
            el.addEventListener(eventName, handler);
            self.eventHandlers.push({ el, event: eventName, handler });
            instanceBindings.eventHandlers.push({
              el,
              event: eventName,
              handler,
            });
          }
        }
      }

      // Auto-animate in loops
      if (el.hasAttribute(ATTR_ANIMATE)) {
        const optionsStr = el.getAttribute(ATTR_ANIMATE);
        queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
      }
    });

    return instanceBindings;
  }

  // Version of setupModelBinding that returns the binding for tracking
  setupModelBindingWithReturn(el, locals = null) {
    const direct = el.getAttribute(ATTR_MODEL);
    const modifierAttrs = Array.from(el.attributes).filter((a) =>
      a.name.startsWith(ATTR_MODEL_PREFIX),
    );
    if (!direct && modifierAttrs.length === 0) return null;

    const keyExpr = direct || modifierAttrs[0].value;
    const mods = new Set();
    let debounceMs = null;
    modifierAttrs.forEach((a) => {
      const rest = a.name.slice(ATTR_MODEL_PREFIX.length);
      if (rest.startsWith("debounce-ms")) {
        debounceMs = Number(a.value || "200");
      } else {
        mods.add(rest);
      }
    });

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
        execInScope(`${keyExpr} = value`, this, { value: v });
      } finally {
        this.locals = prev;
      }
    };

    let eventName = "input";
    if (mods.has("lazy")) eventName = "change";

    let handler = writeBack;
    if (debounceMs != null && debounceMs > 0) {
      let t = null;
      handler = () => {
        clearTimeout(t);
        t = setTimeout(writeBack, debounceMs);
      };
    }

    el.addEventListener(eventName, handler);

    const modelBinding = { updateDom, locals, el, event: eventName, handler };
    this.eventHandlers.push({ el, event: eventName, handler });
    this.modelBindings.push(modelBinding);

    return modelBinding;
  }

  cleanupInstanceBindings(instanceBindings) {
    if (!instanceBindings) return;

    // Remove bindings from main arrays
    (instanceBindings.bindings || []).forEach((b) => {
      const idx = this.bindings.indexOf(b);
      if (idx !== -1) this.bindings.splice(idx, 1);
    });

    (instanceBindings.memoBindings || []).forEach((b) => {
      const idx = this.memoBindings.indexOf(b);
      if (idx !== -1) this.memoBindings.splice(idx, 1);
    });

    (instanceBindings.modelBindings || []).forEach((b) => {
      const idx = this.modelBindings.indexOf(b);
      if (idx !== -1) this.modelBindings.splice(idx, 1);
    });

    // Remove event handlers
    (instanceBindings.eventHandlers || []).forEach(({ el, event, handler }) => {
      // For delegated events, we don't track them in instanceBindings.eventHandlers usually
      // But if we did (non-delegated), remove them
      el.removeEventListener(event, handler);
      const idx = this.eventHandlers.findIndex(
        (h) => h.el === el && h.event === event && h.handler === handler,
      );
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    });

    // Recursively remove nested sx-for blocks created for this instance.
    // If these remain in forBlocks, they keep stale locals and continue rendering.
    instanceBindings.nestedForBlocks?.forEach((block) => {
      this.teardownForBlock(block);
    });
  }

  applyInitialRender() {
    this.updateBindings();
    this.modelBindings.forEach((mb) => mb.updateDom());
    this.updateMemoBindings();
    this.updateChartBindings();
    this.initGridBindings();
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
    this.teardownChartBindings();
    this.teardownGridBindings();
    this.clearDebounceTimers();
    this.clearEmitterHandlers();
    this.teardownAllForBlocks();

    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.netBindings = [];
    this.chartBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];

    this.eventHandlers.forEach(({ el, event, handler }) => {
      el.removeEventListener(event, handler);
    });
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
    this.scan(this.root);
    this.renderForBlocks();
    this.applyInitialRender();
  }

  destroy() {
    this.callHook("destroyed");

    // Clean up store subscriptions
    Object.keys(storeSubscribers).forEach((name) => {
      storeSubscribers[name].delete(this);
    });

    // Clean up auto-animate
    this.animatedElements.forEach((controller, el) => {
      this.disableAutoAnimate(el);
    });
    this.animatedElements.clear();
    this.teardownChartBindings();
    this.teardownGridBindings();
    this.teardownAllForBlocks();

    // Clean up event handlers
    this.eventHandlers.forEach(({ el, event, handler }) => {
      el.removeEventListener(event, handler);
    });
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
    this.chartBindings = [];
    this.gridBindings = [];
    this.netBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];

    // Remove reference
    delete this.root.__sprucex;
  }
}
