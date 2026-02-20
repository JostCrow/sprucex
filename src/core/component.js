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
  ATTR_TARGET,
  ATTR_SWAP,
  ATTR_VARS,
  ATTR_JSON_INTO,
  ATTR_OPTIMISTIC,
  ATTR_REVERT_ON_ERROR,
  ATTR_POLL,
  ATTR_POLL_WHILE,
  ATTR_INCLUDE,
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

// We need to split Component because it's huge.
// But for now, I'll write the class as is, importing dependencies.

export class Component {
  constructor(root) {
    this.root = root;
    this.bindings = [];
    this.memoBindings = [];
    this.eventHandlers = [];
    this.netBindings = [];
    this.modelBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];
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

      // Check if an input inside a for-block is focused
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.isContentEditable);

      // Check if the focused input is inside a for-block
      const isInsideForBlock =
        isInputFocused &&
        this.root.contains(activeEl) &&
        this.forBlocks.some((block) => {
          return block.instances.some(
            (inst) =>
              inst.elements &&
              inst.elements.some((el) => el.contains(activeEl)),
          );
        });

      // Skip for-block re-rendering if input is focused inside one
      // This prevents focus flicker while typing
      if (!isInsideForBlock) {
        this.renderForBlocks();
      }

      this.updateBindings();
      this.modelBindings.forEach((mb) => mb.updateDom());
      this.updateMemoBindings();
    });
  }

  initState() {
    const rawExpr = this.root.getAttribute(ATTR_DATA) || "{}";

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
      try {
        const fn = new Function("$store", `return (${rawExpr});`);
        raw = fn((name) => {
          const store = getStore(name);
          if (store && storeSubscribers[name]) {
            storeSubscribers[name].add(this);
          }
          return store;
        });
      } catch (e) {
        console.error("SpruceX sx-data parse error:", rawExpr, e);
        raw = {};
      }
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
          const trigger = el.getAttribute(ATTR_TRIGGER) || "click";
          const target = el.getAttribute(ATTR_TARGET) || null;
          const swap = el.getAttribute(ATTR_SWAP) || "innerHTML";
          const varsExpr = el.getAttribute(ATTR_VARS);
          const jsonInto = el.getAttribute(ATTR_JSON_INTO);
          const optimistic = el.getAttribute(ATTR_OPTIMISTIC);
          const revertOnError = el.getAttribute(ATTR_REVERT_ON_ERROR);
          const poll = el.getAttribute(ATTR_POLL);
          const pollWhile = el.getAttribute(ATTR_POLL_WHILE);
          const includeSelector = el.getAttribute(ATTR_INCLUDE);

          const binding = {
            el,
            method: m.toUpperCase(),
            urlTpl,
            trigger,
            target,
            swap,
            varsExpr,
            jsonInto,
            optimistic,
            revertOnError,
            poll: poll ? Number(poll) : null,
            pollWhile,
            includeSelector,
          };

          self.netBindings.push(binding);
        }
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
      const { el, trigger, poll, pollWhile } = nb;

      const doReq = (ev) => {
        if (ev) this.lastEvent = ev;
        this.performRequest(nb);
      };

      el.addEventListener(trigger, doReq);
      this.eventHandlers.push({ el, event: trigger, handler: doReq });

      const compHandler = () => this.performRequest(nb);
      this.emitter.addEventListener(trigger, compHandler);

      if (poll && !Number.isNaN(poll)) {
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
    const { el, method, includeSelector } = nb;
    if (!["POST", "PUT", "DELETE"].includes(method)) return null;

    if (el.tagName === "FORM") {
      const fd = new FormData(el);
      if (includeSelector) {
        document.querySelectorAll(includeSelector).forEach((extra) => {
          if (extra.tagName === "FORM") {
            new FormData(extra).forEach((v, k) => fd.append(k, v));
          }
        });
      }
      return fd;
    }
    return null;
  }

  async performRequest(nb) {
    const url = this.buildUrl(nb);
    const body = this.buildBody(nb);
    const { el, method, target, swap, jsonInto, optimistic, revertOnError } =
      nb;

    if (optimistic) {
      execInScope(optimistic, this);
    }

    try {
      const res = await fetch(url, { method, body });

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
      const detail = { error };
      el.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
      el.dispatchEvent(
        new CustomEvent("sprucex:error", { detail, bubbles: true }),
      );
    }
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

  renderForBlocks() {
    this.forBlocks.forEach((block) => {
      const { def, template, parent, marker, instances, parentLocals } = block;

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
    });
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
    // Remove bindings from main arrays
    instanceBindings.bindings.forEach((b) => {
      const idx = this.bindings.indexOf(b);
      if (idx !== -1) this.bindings.splice(idx, 1);
    });

    instanceBindings.memoBindings.forEach((b) => {
      const idx = this.memoBindings.indexOf(b);
      if (idx !== -1) this.memoBindings.splice(idx, 1);
    });

    instanceBindings.modelBindings.forEach((b) => {
      const idx = this.modelBindings.indexOf(b);
      if (idx !== -1) this.modelBindings.splice(idx, 1);
    });

    // Remove event handlers
    instanceBindings.eventHandlers.forEach(({ el, event, handler }) => {
      // For delegated events, we don't track them in instanceBindings.eventHandlers usually
      // But if we did (non-delegated), remove them
      el.removeEventListener(event, handler);
      const idx = this.eventHandlers.findIndex(
        (h) => h.el === el && h.event === event && h.handler === handler,
      );
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    });
  }

  applyInitialRender() {
    this.updateBindings();
    this.modelBindings.forEach((mb) => mb.updateDom());
    this.updateMemoBindings();
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
    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.netBindings = [];
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

    // Clean up event handlers
    this.eventHandlers.forEach(({ el, event, handler }) => {
      el.removeEventListener(event, handler);
    });
    if (this._delegatedCleanups) {
      this._delegatedCleanups.forEach((fn) => fn());
    }

    // Clean up poll timers
    this.pollTimers.forEach((t) => clearInterval(t));

    // Cancel pending updates
    if (this.rafId) cancelAnimationFrame(this.rafId);

    // Clear arrays
    this.bindings = [];
    this.memoBindings = [];
    this.modelBindings = [];
    this.eventHandlers = [];
    this.netBindings = [];
    this.forBlocks = [];
    this.pollTimers = [];

    // Remove reference
    delete this.root.__sprucex;
  }
}
