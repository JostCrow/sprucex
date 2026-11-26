import {
  ATTR_DATA,
  ATTR_FOR,
  ATTR_IF,
  ATTR_LAZY,
  ATTR_LOCAL,
  ATTR_ANIMATE,
  ATTR_CLOAK,
} from "../constants.js";
import { walk, parseForExpression } from "../utils/helpers.js";
import {
  createReactiveState,
  effect,
  toRaw,
} from "../reactivity/index.js";
import { storeSubscribers, getStore } from "../store/index.js";
import { getAutoAnimate } from "../utils/animations.js";
import { evalInScope, safeEval, execInScope, isCspMode } from "../utils/eval.js";
import { cspEval } from "../utils/csp-eval.js";
import {
  getDataFactory,
  getDataExpressionReference,
  isFactoryLikeDataExpression,
  resolveGlobalDataReference,
  createDataFactoryNotReadyError,
} from "../utils/data-factories.js";
import { listIntegrations } from "../integrations/index.js";
import {
  scanBindingDirectives,
  runBinding,
  parseModelBindingConfig,
  setupModelBinding,
} from "../directives/bindings.js";
import {
  scanEventDirectives,
  handleDelegatedEvent,
} from "../directives/events.js";
import {
  createForBlock,
  createIfBlock,
  renderForBlocks,
  renderIfBlocks,
  teardownForBlock,
  teardownIfBlock,
  teardownAllForBlocks,
  teardownAllIfBlocks,
  disposeInstance,
  mountNestedDataComponents,
} from "../directives/structural.js";
import { matchElementDirectives } from "../directives/registry.js";
import {
  scanNetworkDirectives,
  setupNetworkBindings,
  parseNetworkTriggers,
  buildUrl,
  buildBody,
  buildHeaders,
  addCsrfHeader,
  getCsrfToken,
  serializeError,
  performRequest,
  applySwap,
} from "./network.js";

export class Component {
  constructor(root, options = {}) {
    this.root = root;
    this.parentComponent = options.parentComponent || null;
    this.locals =
      options.locals && typeof options.locals === "object"
        ? { ...options.locals }
        : {};
    this.currentEl = root;
    this.bindings = [];
    this.memoBindings = [];
    this.eventHandlers = [];
    this.emitterHandlers = [];
    this.netBindings = [];
    this.modelBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];
    this.ifBlocks = [];
    this.elementEffects = [];
    this.pendingInits = [];
    this.cloakedElements = new Set();
    this.directiveInstances = new Map(); // Map<Element, Array<record>>
    this.pollTimers = [];
    this.debounceTimers = new Set();
    this.requestUiState = new WeakMap();
    this.netRequestMeta = new WeakMap();
    this.lastEvent = null;
    this.debug = Boolean(Component.debug);
    this.csp = Boolean(Component.csp);
    this.updatePending = false;
    this.isDestroyed = false;
    this.coarseDirty = false;
    this.refsDirty = true;
    this.dirtyBindings = new Set();
    this.dirtyModels = new Set();
    this.dirtyEffects = new Set();
    this.dirtyForBlocks = new Set();
    this.dirtyIfBlocks = new Set();
    this.nextTickQueue = [];
    this.originalClasses = new WeakMap();
    this.animatedElements = new Map();

    this.scannedElements = new WeakSet();
    this.directiveSignatures = new WeakMap();
    this.elementLocals = new WeakMap();
    this.integrationScopes = new Map();
    this.refs = {};
    this.emitter =
      typeof document !== "undefined" ? document.createElement("div") : null;

    this.emit = (name, detail) => {
      if (!this.emitter || typeof CustomEvent === "undefined") return;
      const evt = new CustomEvent(name, { detail, bubbles: false });
      this.emitter.dispatchEvent(evt);
    };

    this.dispatch = (name, detail) => {
      const target = this.currentEl || this.root;
      if (!target || typeof CustomEvent === "undefined") return false;
      const evt = new CustomEvent(name, { detail, bubbles: true, cancelable: true });
      return target.dispatchEvent(evt);
    };

    this.initState();
    this.collectRefs();
    this.initIntegrationBindings();

    this.scan(root);
    this.renderIfBlocks(true);
    this.renderForBlocks(true);
    this.applyInitialRender();
    this.callHook("init");
    queueMicrotask(() => {
      if (!this.isDestroyed) this.callHook("mounted");
    });
  }

  nextTick(fn) {
    const promise = new Promise((resolve) => {
      if (this.isDestroyed) {
        resolve();
        return;
      }
      if (this.updatePending) {
        this.nextTickQueue.push(resolve);
      } else {
        queueMicrotask(resolve);
      }
    });
    return typeof fn === "function" ? promise.then(() => fn.call(this.state)) : promise;
  }

  flushNextTicks() {
    if (!this.nextTickQueue.length) return;
    const queue = this.nextTickQueue.splice(0);
    for (let i = 0; i < queue.length; i++) {
      queue[i]();
    }
  }

  markAllDirty() {
    this.coarseDirty = true;
    this.refsDirty = true;
    this.bindings.forEach((b) => {
      b.dirty = true;
      this.dirtyBindings.add(b);
    });
    this.modelBindings.forEach((m) => {
      m.dirty = true;
      this.dirtyModels.add(m);
    });
    this.forBlocks.forEach((b) => {
      b.dirty = true;
      this.dirtyForBlocks.add(b);
    });
    this.ifBlocks.forEach((b) => {
      b.dirty = true;
      this.dirtyIfBlocks.add(b);
    });
  }

  // Batched update scheduling
  scheduleUpdate(coarse = true) {
    if (this.isDestroyed) return;
    if (coarse) this.coarseDirty = true;
    if (this.updatePending) return;
    this.updatePending = true;

    const scheduleFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);

    this.rafId = scheduleFrame(() => {
      this.updatePending = false;
      this.rafId = null;
      if (this.isDestroyed) return;

      const forceAll = this.coarseDirty;
      this.coarseDirty = false;

      const ifChanged = this.renderIfBlocks(forceAll);
      const forChanged = this.renderForBlocks(forceAll);

      if (ifChanged || forChanged || this.refsDirty) {
        this.collectRefs();
        this.refsDirty = false;
      }

      this.flushPendingInits();
      this.updateBindings(forceAll);
      this.updateModelBindings(forceAll);
      this.updateMemoBindings();
      this.flushDirtyEffects();
      this.updateIntegrations();
      this.revealCloakedElements();
      this.flushNextTicks();
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
    const inheritedLocals =
      this.locals && typeof this.locals === "object" ? this.locals : {};
    const jsonScript = this.root.querySelector("script[sx-init-data]");
    const looksLikeIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawExpr);

    const evalInitExpr = (source) => {
      if (this.csp || isCspMode()) {
        return cspEval(source, {
          state: {},
          locals: inheritedLocals,
          magics: {
            $store: storeAccessor,
            $data: getDataFactory,
            $locals: inheritedLocals,
            $parent: this.parentComponent?.state || null,
            $el: this.root,
          },
          extra: {},
        });
      }
      const fn = new Function(
        "$store",
        "$data",
        "$locals",
        "$parent",
        "$el",
        `with($locals){ return (${source}); }`,
      );
      return fn(
        storeAccessor,
        getDataFactory,
        inheritedLocals,
        this.parentComponent?.state || null,
        this.root,
      );
    };

    if (jsonScript && looksLikeIdentifier) {
      try {
        raw = JSON.parse(jsonScript.textContent.trim() || "{}");
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
            const args = argsSource ? evalInitExpr(`[${argsSource}]`) : [];
            raw = resolvedFactory.apply(this.root, args);
          } else if (
            rawExpr === dataRef &&
            typeof resolvedFactory === "function"
          ) {
            raw = resolvedFactory.call(this.root);
          } else if (rawExpr === dataRef) {
            raw = resolvedFactory;
          } else {
            raw = evalInitExpr(rawExpr);
          }
        } else {
          raw = evalInitExpr(rawExpr);
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
    if (localKey && typeof localStorage !== "undefined") {
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
    Object.defineProperty(raw, "$dispatch", {
      value: this.dispatch,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(raw, "$nextTick", {
      value: (fn) => this.nextTick(fn),
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(raw, "$refs", {
      get: () => this.refs,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(raw, "$el", {
      get: () => this.currentEl || this.root,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(raw, "$parent", {
      get: () => this.parentComponent?.state || null,
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

    let persistQueued = false;
    const flushLocalPersist = () => {
      persistQueued = false;
      if (this.isDestroyed || !localKey || typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(localKey, JSON.stringify(toRaw(proxy)));
      } catch (e) {
        console.error("SpruceX sx-local save error:", e);
      }
    };

    const { proxy, stopWatchers } = createReactiveState(raw, () => {
      if (localKey && !persistQueued) {
        persistQueued = true;
        queueMicrotask(flushLocalPersist);
      }
      this.scheduleUpdate(false);
    });

    this.state = proxy;
    this._stopWatchers = stopWatchers;
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

  withContext(el, locals, fn) {
    const prevEl = this.currentEl;
    const prevLocals = this.locals;
    if (el) this.currentEl = el;
    if (locals) this.locals = locals;
    try {
      return fn();
    } finally {
      this.currentEl = prevEl;
      this.locals = prevLocals;
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
      record.el.removeEventListener(record.event, record.handler, record.options);
    }
  }

  handleDelegatedEvent(e) {
    return handleDelegatedEvent(this, e);
  }

  // Single-pass DOM scan for structural templates and element directives
  scan(root, locals = null, fragment = false) {
    walk(root, (el) => {
      if (el.nodeType !== 1) return false;
      if ((fragment || el !== root) && el.hasAttribute(ATTR_DATA)) return false;

      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
        const expr = el.getAttribute(ATTR_FOR) || "";
        const parent = el.parentElement;
        if (!parent) return false;

        const parentLocals = locals || this.getElementLocals(el);
        const marker = document.createComment("sx-for");
        parent.insertBefore(marker, el);
        el.remove();

        const forDef = parseForExpression(expr);
        if (!forDef) {
          console.error("SpruceX invalid sx-for expression:", expr);
          return false;
        }

        createForBlock(this, {
          template: el,
          parent,
          marker,
          expr,
          def: forDef,
          keyExpr: el.getAttribute("sx-key") || null,
          parentLocals,
          autoAnimate: parent.hasAttribute(ATTR_ANIMATE),
        });

        if (parent.hasAttribute(ATTR_ANIMATE)) {
          const opts = parent.getAttribute(ATTR_ANIMATE);
          let config = {};
          if (opts && opts !== "true" && opts !== "") {
            try {
              config = JSON.parse(opts);
            } catch {
              const duration = parseInt(opts, 10);
              if (!isNaN(duration)) config = { duration };
            }
          }
          this.setupAutoAnimate(parent, config);
        }
        return false;
      }

      if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_IF)) {
        const expr = (el.getAttribute(ATTR_IF) || "").trim();
        const parent = el.parentElement;
        if (!parent) return false;

        const parentLocals = locals || this.getElementLocals(el);
        const marker = document.createComment("sx-if");
        parent.insertBefore(marker, el);
        el.remove();

        createIfBlock(this, el, expr, parent, marker, parentLocals);
        return false;
      }

      if (!this.scannedElements.has(el)) {
        this.scanElement(el, locals || this.getElementLocals(el));
      }
    });

    this.setupNetworkBindings();
  }

  directiveSignature(el) {
    const attrs = el.attributes;
    let sxAttrs = null;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.name.startsWith("sx-")) {
        if (!sxAttrs) sxAttrs = [];
        sxAttrs.push([attr.name, attr.value]);
      }
    }
    if (!sxAttrs) return "";
    sxAttrs.sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(sxAttrs);
  }

  scanElement(el, locals) {
    this.scannedElements.add(el);
    this.directiveSignatures.set(el, this.directiveSignature(el));
    this.elementLocals.set(el, locals);

    scanBindingDirectives(this, el, locals);
    scanEventDirectives(this, el, locals);
    scanNetworkDirectives(this, el, locals);
    this.mountElementDirectives(el, locals);
    this.scanIntegrations(el, locals);

    if (el.hasAttribute(ATTR_ANIMATE)) {
      const optionsStr = el.getAttribute(ATTR_ANIMATE);
      queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
    }
  }

  mountElementDirectives(el, locals, onlyName = null) {
    const matches = matchElementDirectives(el);
    if (!matches.length) return [];

    const created = [];
    let existing = this.directiveInstances.get(el);

    for (const match of matches) {
      if (onlyName && match.name !== onlyName) continue;
      if (existing && existing.some((rec) => rec.attr === match.attr)) continue;

      const record = {
        el,
        name: match.name,
        attr: match.attr,
        locals,
        cleanups: [],
        effects: [],
      };

      const scopeView =
        locals && locals !== this.locals
          ? Object.assign(Object.create(this), {
              locals,
              currentEl: el,
              scheduleUpdate: this.scheduleUpdate.bind(this),
            })
          : this;

      const evaluate = (exprOverride = match.expression) =>
        this.withContext(el, locals, () => safeEval(exprOverride, this));

      const evaluateOrLiteral = (exprOverride = match.expression) =>
        this.withContext(el, locals, () =>
          this.evaluateExpressionOrLiteral(exprOverride),
        );

      const cleanup = (fn) => {
        if (typeof fn === "function") record.cleanups.push(fn);
      };

      const registerEffect = (fn) => {
        let scheduled = false;
        const runner = effect(
          () => {
            if (this.isDestroyed) return;
            this.withContext(el, locals, () => fn());
          },
          {
            lazy: true,
            scheduler: () => {
              if (scheduled || this.isDestroyed) return;
              scheduled = true;
              this.dirtyEffects.add(effEntry);
              this.scheduleUpdate(false);
            },
          },
        );
        const effEntry = {
          el,
          locals,
          run: () => {
            scheduled = false;
            runner();
          },
          dispose: () => {
            runner.stop();
            this.dirtyEffects.delete(effEntry);
          },
        };
        record.effects.push(effEntry);
        // Run synchronously once so initial state is applied and deps are tracked.
        effEntry.run();
        return effEntry.dispose;
      };

      try {
        const ret = match.handler(el, {
          el,
          name: match.name,
          attr: match.attr,
          expression: match.expression,
          expr: match.expression,
          modifiers: match.modifiers,
          component: scopeView,
          evaluate,
          evaluateOrLiteral,
          effect: registerEffect,
          cleanup,
        });
        if (typeof ret === "function") {
          record.cleanups.push(ret);
        }
      } catch (e) {
        console.error(`SpruceX directive "${match.name}" error:`, e);
      }

      if (!existing) {
        existing = [];
        this.directiveInstances.set(el, existing);
      }
      existing.push(record);
      created.push(record);
      if (this._activeFragmentDirectives) {
        this._activeFragmentDirectives.push(record);
      }
    }

    return created;
  }

  disposeDirectiveRecord(record) {
    record.effects.forEach((eff) => eff.dispose());
    record.effects.length = 0;
    record.cleanups.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(`SpruceX directive "${record.name}" cleanup error:`, e);
      }
    });
    record.cleanups.length = 0;
  }

  disposeElementDirectives(el) {
    const records = this.directiveInstances.get(el);
    if (!records) return;
    records.forEach((rec) => this.disposeDirectiveRecord(rec));
    this.directiveInstances.delete(el);
  }

  disposeAllElementDirectives() {
    this.directiveInstances.forEach((records) => {
      records.forEach((rec) => this.disposeDirectiveRecord(rec));
    });
    this.directiveInstances.clear();
  }

  mountDirectiveOnExistingElements(name) {
    walk(this.root, (el) => {
      if (el !== this.root && el.hasAttribute(ATTR_DATA)) return false;
      this.mountElementDirectives(el, this.getElementLocals(el), name);
    });
  }

  parseModelBindingConfig(direct, modifierAttrs) {
    return parseModelBindingConfig(direct, modifierAttrs);
  }

  setupModelBinding(el, locals = null) {
    return setupModelBinding(this, el, locals);
  }

  setupNetworkBindings() {
    return setupNetworkBindings(this);
  }

  parseNetworkTriggers(nb) {
    return parseNetworkTriggers(nb);
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

    if (typeof options === "string" && options.trim()) {
      try {
        options = JSON.parse(options);
      } catch {
        const evaluated = safeEval(options, this);
        options = evaluated && typeof evaluated === "object" ? evaluated : {};
      }
    }

    const finalOptions = {
      duration: 250,
      easing: "ease-in-out",
      ...options,
    };

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
      controller.disable?.();
    }
    this.animatedElements.delete(el);
  }

  buildUrl(nb) {
    return buildUrl(this, nb);
  }

  buildBody(nb) {
    return buildBody(this, nb);
  }

  buildHeaders(nb, bodyKind, hasBody) {
    return buildHeaders(this, nb, bodyKind, hasBody);
  }

  getCsrfToken() {
    return getCsrfToken(this);
  }

  addCsrfHeader(headers, method) {
    return addCsrfHeader(this, headers, method);
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
    return serializeError(error);
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
    if (this.emitter) {
      this.emitterHandlers.forEach(({ event, handler }) => {
        this.emitter.removeEventListener(event, handler);
      });
    }
    this.emitterHandlers = [];
  }

  beginNetworkRequest(nb) {
    let meta = this.netRequestMeta.get(nb);
    if (!meta) {
      meta = { seq: 0, controller: null };
      this.netRequestMeta.set(nb, meta);
    }

    meta.seq += 1;
    if (
      nb.cancelPrevious &&
      meta.controller &&
      typeof meta.controller.abort === "function"
    ) {
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

  initIntegrationBindings(onlyLegacy = false) {
    if (onlyLegacy) {
      this.integrationScopes.forEach((scope) => scope.initIntegrationBindings(true));
    }
    listIntegrations().forEach((integration) => {
      if (onlyLegacy && integration.preserveOnSwap) return;
      if (typeof integration.setup !== "function") return;
      try {
        integration.setup(this);
      } catch (e) {
        console.error("SpruceX integration setup error:", e);
      }
    });
  }

  scanIntegrations(el, locals = null, onlyLegacy = false) {
    if (locals && locals !== this.locals) {
      let scope = this.integrationScopes.get(locals);
      if (!scope) {
        scope = Object.assign(Object.create(this), {
          locals,
          integrationScopes: new Map(),
          gridBindings: [],
          scheduleUpdate: this.scheduleUpdate.bind(this),
        });
        scope.initIntegrationBindings();
        this.integrationScopes.set(locals, scope);
      }
      scope.scanIntegrations(el, null, onlyLegacy);
      return;
    }
    listIntegrations().forEach((integration) => {
      if (onlyLegacy && integration.preserveOnSwap) return;
      if (typeof integration.scan !== "function") return;
      try {
        integration.scan(this, el);
      } catch (e) {
        console.error("SpruceX integration scan error:", e);
      }
    });
  }

  unmountIntegrationElement(el) {
    listIntegrations().forEach((integration) => {
      if (typeof integration.unmount !== "function") return;
      try {
        integration.unmount(this, el);
      } catch (e) {
        console.error("SpruceX integration unmount error:", e);
      }
    });
    this.integrationScopes.forEach((scope) => {
      listIntegrations().forEach((integration) => {
        if (typeof integration.unmount !== "function") return;
        try {
          integration.unmount(scope, el);
        } catch (e) {
          console.error("SpruceX integration unmount error:", e);
        }
      });
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

  teardownIntegrations(onlyLegacy = false) {
    this.integrationScopes.forEach((scope) => scope.teardownIntegrations(onlyLegacy));
    if (!onlyLegacy) this.integrationScopes.clear();
    listIntegrations().forEach((integration) => {
      if (onlyLegacy && integration.preserveOnSwap) return;
      if (typeof integration.teardown !== "function") return;
      try {
        integration.teardown(this);
      } catch (e) {
        console.error("SpruceX integration teardown error:", e);
      }
    });
  }

  performRequest(nb) {
    return performRequest(this, nb);
  }

  disposeNetworkBinding(binding) {
    if (binding.disposed) return;
    binding.disposed = true;
    this.netRequestMeta.get(binding)?.controller?.abort();
    (binding.disposers || []).forEach((dispose) => dispose());
  }

  pruneDetachedBindings(removedNodes = null, exact = false) {
    const belongs = (el) =>
      el &&
      (removedNodes
        ? !removedNodes.some((node) => node === el || (!exact && node.contains?.(el)))
        : this.root.contains(el));

    this.bindings = this.bindings.filter((binding) => {
      if (belongs(binding.el)) return true;
      binding.dispose?.();
      return false;
    });

    this.memoBindings = this.memoBindings.filter((binding) => belongs(binding.el));

    this.modelBindings = this.modelBindings.filter((binding) => {
      if (belongs(binding.el)) return true;
      binding.dispose?.();
      return false;
    });

    this.elementEffects = this.elementEffects.filter((entry) => {
      if (belongs(entry.el)) return true;
      entry.dispose?.();
      return false;
    });

    for (const [el] of Array.from(this.directiveInstances.entries())) {
      if (!belongs(el)) {
        this.disposeElementDirectives(el);
      }
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

    if (removedNodes) {
      removedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        this.unmountIntegrationElement(node);
        if (!exact && node.querySelectorAll) {
          node.querySelectorAll("*").forEach((child) => {
            this.unmountIntegrationElement(child);
          });
        }
      });
    }
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
        const mountRoot = () => {
          if (!root.isConnected || root.__sprucex) return;
          root.__sprucex = new Component(root, {
            parentComponent: parent,
            locals: parent?.getElementLocals(root),
          });
        };
        if (root.hasAttribute(ATTR_LAZY) && typeof IntersectionObserver !== "undefined") {
          const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                io.disconnect();
                mountRoot();
                break;
              }
            }
          });
          io.observe(root);
        } else {
          mountRoot();
        }
      } else {
        const component = root.__sprucex;
        component.pruneDetachedBindings();

        // Only teardown/rescan legacy integrations that do not support per-element
        // preservation; preserveOnSwap integrations (e.g. GridStack, Sortable) and
        // element-scoped directives keep untouched elements mounted!
        component.teardownIntegrations(true);
        component.initIntegrationBindings(true);

        walk(root, (el) => {
          if (el !== root && el.hasAttribute(ATTR_DATA)) return false;
          if (
            component.scannedElements.has(el) &&
            component.directiveSignatures.get(el) !== component.directiveSignature(el)
          ) {
            component.pruneDetachedBindings([el], true);
            component.scannedElements.delete(el);
          }
          if (component.scannedElements.has(el)) {
            component.scanIntegrations(el, component.getElementLocals(el), true);
          }
        });

        component.scan(root);
        component.renderIfBlocks(false);
        component.renderForBlocks(false);
        component.refsDirty = true;
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

  applySwap(targetSelectorOrEl, html, swap, select = null) {
    return applySwap(this, targetSelectorOrEl, html, swap, select);
  }

  renderIfBlocks(forceAll = true) {
    return renderIfBlocks(this, forceAll);
  }

  renderForBlocks(forceAll = true) {
    return renderForBlocks(this, forceAll);
  }

  teardownForBlock(block) {
    return teardownForBlock(this, block);
  }

  teardownIfBlock(block) {
    return teardownIfBlock(this, block);
  }

  teardownAllForBlocks() {
    return teardownAllForBlocks(this);
  }

  teardownAllIfBlocks() {
    return teardownAllIfBlocks(this);
  }

  disposeForInstance(inst) {
    return disposeInstance(this, inst);
  }

  mountForInstance(inst) {
    return mountNestedDataComponents(this, inst);
  }

  scanFragmentBindings(rootNode, locals) {
    const fields = [
      "bindings",
      "memoBindings",
      "modelBindings",
      "eventHandlers",
      "netBindings",
      "elementEffects",
      "forBlocks",
      "ifBlocks",
    ];
    const starts = Object.fromEntries(fields.map((key) => [key, this[key].length]));
    const prevFragDirectives = this._activeFragmentDirectives;
    const capturedDirectives = [];
    this._activeFragmentDirectives = capturedDirectives;
    try {
      this.scan(rootNode, locals, true);
    } finally {
      this._activeFragmentDirectives = prevFragDirectives;
    }
    const result = Object.fromEntries(
      fields.map((key) => [key, this[key].slice(starts[key])]),
    );
    result.nestedForBlocks = result.forBlocks;
    result.nestedIfBlocks = result.ifBlocks;
    result.directiveInstances = capturedDirectives;
    return result;
  }

  cleanupInstanceBindings(instanceBindings) {
    if (!instanceBindings) return;

    const bindingsToRemove = new Set(instanceBindings.bindings || []);
    const memosToRemove = new Set(instanceBindings.memoBindings || []);
    const modelsToRemove = new Set(instanceBindings.modelBindings || []);
    const effectsToRemove = new Set(instanceBindings.elementEffects || []);

    if (bindingsToRemove.size > 0) {
      bindingsToRemove.forEach((b) => b.dispose?.());
      this.bindings = this.bindings.filter((b) => !bindingsToRemove.has(b));
    }
    if (memosToRemove.size > 0) {
      this.memoBindings = this.memoBindings.filter((b) => !memosToRemove.has(b));
    }
    if (modelsToRemove.size > 0) {
      modelsToRemove.forEach((m) => m.dispose?.());
      this.modelBindings = this.modelBindings.filter((b) => !modelsToRemove.has(b));
    }
    if (effectsToRemove.size > 0) {
      effectsToRemove.forEach((e) => e.dispose?.());
      this.elementEffects = this.elementEffects.filter((e) => !effectsToRemove.has(e));
    }

    (instanceBindings.directiveInstances || []).forEach((rec) => {
      this.disposeDirectiveRecord(rec);
      const list = this.directiveInstances.get(rec.el);
      if (list) {
        const remaining = list.filter((entry) => entry !== rec);
        if (remaining.length) this.directiveInstances.set(rec.el, remaining);
        else this.directiveInstances.delete(rec.el);
      }
    });

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

    (instanceBindings.netBindings || []).forEach((binding) =>
      this.disposeNetworkBinding(binding),
    );
    this.netBindings = this.netBindings.filter((binding) => !binding.disposed);

    instanceBindings.nestedForBlocks?.forEach((block) => {
      this.teardownForBlock(block);
    });

    instanceBindings.nestedIfBlocks?.forEach((block) => {
      this.teardownIfBlock(block);
    });

    (instanceBindings.lazyObservers || []).forEach((io) => io.disconnect?.());

    (instanceBindings.nestedDataComponents || []).forEach((component) => {
      if (component && typeof component.destroy === "function") {
        component.destroy();
      }
    });
  }

  flushPendingInits() {
    if (!this.pendingInits.length) return;
    const queue = this.pendingInits.splice(0);
    for (let i = 0; i < queue.length; i++) {
      const { el, expr, locals } = queue[i];
      if (!el.isConnected) continue;
      this.withContext(el, locals, () => {
        execInScope(expr, this);
      });
    }
  }

  revealCloakedElements() {
    if (this.cloakedElements.size === 0) return;
    this.cloakedElements.forEach((el) => {
      el.removeAttribute(ATTR_CLOAK);
    });
    this.cloakedElements.clear();
  }

  flushDirtyEffects() {
    if (this.dirtyEffects.size === 0) return;
    const pending = Array.from(this.dirtyEffects);
    this.dirtyEffects.clear();
    for (let i = 0; i < pending.length; i++) {
      if (this.isDestroyed) break;
      pending[i].run();
    }
  }

  applyInitialRender() {
    this.collectRefs();
    this.refsDirty = false;
    this.flushPendingInits();
    this.updateBindings(true);
    this.updateModelBindings(true);
    this.updateMemoBindings();
    this.flushDirtyEffects();
    this.updateIntegrations();
    this.revealCloakedElements();
  }

  updateBindings(forceAll = true) {
    if (forceAll) {
      this.dirtyBindings.clear();
      for (let i = 0; i < this.bindings.length; i++) {
        runBinding(this, this.bindings[i]);
      }
      return;
    }

    const toRun = new Set(this.dirtyBindings);
    this.dirtyBindings.clear();
    for (let i = 0; i < this.bindings.length; i++) {
      const b = this.bindings[i];
      if (b.dirty || !b.tracked) {
        toRun.add(b);
      }
    }
    toRun.forEach((b) => runBinding(this, b));
  }

  updateModelBindings(forceAll = true) {
    if (forceAll) {
      this.dirtyModels.clear();
      for (let i = 0; i < this.modelBindings.length; i++) {
        this.modelBindings[i].run();
      }
      return;
    }

    const toRun = new Set(this.dirtyModels);
    this.dirtyModels.clear();
    for (let i = 0; i < this.modelBindings.length; i++) {
      const mb = this.modelBindings[i];
      if (mb.dirty || !mb.tracked) {
        toRun.add(mb);
      }
    }
    toRun.forEach((mb) => mb.run());
  }

  updateMemoBindings() {
    this.memoBindings.forEach((mb) => {
      const { el, expr, type, deps, locals } = mb;
      this.withContext(el, locals, () => {
        const currVals = deps.map((k) => {
          if (locals && k in locals) return locals[k];
          return this.state[k];
        });

        if (
          mb.lastVals &&
          mb.lastVals.length === currVals.length &&
          mb.lastVals.every((v, i) => Object.is(v, currVals[i]))
        ) {
          return;
        }

        mb.lastVals = currVals;
        const v = safeEval(expr, this);
        mb.lastResult = v;
        const nextStr = String(v ?? "");
        if (type === "text") {
          el.textContent = nextStr;
        } else {
          el.innerHTML = nextStr;
        }
      });
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
    this.disposeAllElementDirectives();
    this.bindings.forEach((b) => b.dispose?.());
    this.modelBindings.forEach((m) => m.dispose?.());
    this.elementEffects.forEach((e) => e.dispose?.());
    this.netBindings.forEach((binding) => this.disposeNetworkBinding(binding));
    this.clearDebounceTimers();
    this.clearEmitterHandlers();
    this.teardownAllForBlocks();
    this.teardownAllIfBlocks();

    this.scannedElements = new WeakSet();
    this.directiveSignatures = new WeakMap();
    this.elementLocals = new WeakMap();
    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.netBindings = [];
    this.gridBindings = [];
    this.forBlocks = [];
    this.ifBlocks = [];
    this.elementEffects = [];
    this.pendingInits = [];
    this.dirtyBindings.clear();
    this.dirtyModels.clear();
    this.dirtyEffects.clear();
    this.dirtyForBlocks.clear();
    this.dirtyIfBlocks.clear();

    this.eventHandlers.forEach((record) => this.removeEventHandler(record));
    this.eventHandlers = [];

    walk(this.root, (el) => {
      if (el !== this.root && el.hasAttribute(ATTR_DATA)) return false;
      if (el.__sx_handlers) delete el.__sx_handlers;
    });

    this.animatedElements.forEach((_controller, el) => {
      this.disableAutoAnimate(el);
    });
    this.animatedElements.clear();

    this.pollTimers.forEach((t) => clearInterval(t));
    this.pollTimers = [];

    this.collectRefs();
    this.initIntegrationBindings();
    this.scan(this.root);
    this.renderIfBlocks(true);
    this.renderForBlocks(true);
    this.applyInitialRender();
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.callHook("destroyed");
    this._stopWatchers?.();
    this.abortCancelableRequests();
    this.netBindings.forEach((binding) => this.disposeNetworkBinding(binding));

    Object.keys(storeSubscribers).forEach((name) => {
      storeSubscribers[name].delete(this);
    });

    this.animatedElements.forEach((_controller, el) => {
      this.disableAutoAnimate(el);
    });
    this.animatedElements.clear();
    this.disposeAllElementDirectives();
    this.teardownIntegrations();
    this.teardownAllForBlocks();
    this.teardownAllIfBlocks();

    this.bindings.forEach((b) => b.dispose?.());
    this.modelBindings.forEach((m) => m.dispose?.());
    this.elementEffects.forEach((e) => e.dispose?.());

    this.eventHandlers.forEach((record) => this.removeEventHandler(record));
    this.clearEmitterHandlers();
    if (this._delegatedCleanups) {
      this._delegatedCleanups.forEach((fn) => fn());
      this._delegatedCleanups = [];
      this._delegatedEventTypes?.clear();
    }

    this.pollTimers.forEach((t) => clearInterval(t));
    this.clearDebounceTimers();

    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }

    this.flushNextTicks();

    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.eventHandlers = [];
    this.gridBindings = [];
    this.netBindings = [];
    this.forBlocks = [];
    this.ifBlocks = [];
    this.elementEffects = [];
    this.pollTimers = [];
    this.dirtyBindings.clear();
    this.dirtyModels.clear();
    this.dirtyEffects.clear();
    this.dirtyForBlocks.clear();
    this.dirtyIfBlocks.clear();

    delete this.root.__sprucex;
  }
}
