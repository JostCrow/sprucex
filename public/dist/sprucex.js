(() => {
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

  // src/index.js
  var exports_src = {};
  __export(exports_src, {
    initSpruceX: () => initSpruceX,
    SpruceX: () => SpruceX
  });

  // src/constants.js
  var ATTR_DATA = "sx-data";
  var ATTR_TEXT = "sx-text";
  var ATTR_HTML = "sx-html";
  var ATTR_SHOW = "sx-show";
  var ATTR_BIND_PREFIX = "sx-bind:";
  var ATTR_ON_PREFIX = "sx-on:";
  var ATTR_MODEL = "sx-model";
  var ATTR_MODEL_PREFIX = "sx-model.";
  var ATTR_CLASS = "sx-class";
  var ATTR_TOGGLE = "sx-toggle";
  var ATTR_ERROR_FALLBACK = "sx-error-fallback";
  var ATTR_FOR = "sx-for";
  var ATTR_MEMO = "sx-memo";
  var ATTR_PAGE = "sx-page";
  var ATTR_BOOST = "sx-boost";
  var ATTR_BOOST_ON = "sx-boost-on";
  var NET_METHODS = ["get", "post", "put", "delete"];
  var ATTR_TRIGGER = "sx-trigger";
  var ATTR_TARGET = "sx-target";
  var ATTR_SWAP = "sx-swap";
  var ATTR_VARS = "sx-vars";
  var ATTR_JSON_INTO = "sx-json-into";
  var ATTR_OPTIMISTIC = "sx-optimistic";
  var ATTR_REVERT_ON_ERROR = "sx-revert-on-error";
  var ATTR_POLL = "sx-poll";
  var ATTR_POLL_WHILE = "sx-poll-while";
  var ATTR_INCLUDE = "sx-include";
  var ATTR_LAZY = "sx-lazy";
  var ATTR_LOCAL = "sx-local";
  var ATTR_ANIMATE = "sx-animate";
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
  var walk = (el, cb) => {
    if (cb(el) === false)
      return;
    let child = el.firstElementChild;
    while (child) {
      const next = child.nextElementSibling;
      walk(child, cb);
      child = next;
    }
  };
  function isClass(fn) {
    return typeof fn === "function" && /^class\s/.test(fn.toString());
  }
  function parseForExpression(expr) {
    const inMatch = expr.match(/^\s*(.*?)\s+(in|of)\s+(.*)\s*$/);
    if (!inMatch)
      return null;
    const left = inMatch[1].trim();
    const iterable = inMatch[3].trim();
    if (left.startsWith("(")) {
      const inner = left.slice(1, -1);
      const [item, index] = inner.split(",").map((s) => s.trim());
      return { item, index, iterable };
    }
    return { item: left, index: null, iterable };
  }
  function cloneChildren(template) {
    const frag = document.createDocumentFragment();
    let child = template.firstChild;
    while (child) {
      frag.appendChild(child.cloneNode(true));
      child = child.nextSibling;
    }
    return frag;
  }

  // src/reactivity/index.js
  function createDeepReactiveProxy(obj, onChange, visited = new WeakSet) {
    if (obj === null || typeof obj !== "object")
      return obj;
    if (visited.has(obj))
      return obj;
    visited.add(obj);
    if (Array.isArray(obj)) {
      const methods = [
        "push",
        "pop",
        "shift",
        "unshift",
        "splice",
        "sort",
        "reverse"
      ];
      methods.forEach((method) => {
        const original = obj[method];
        if (typeof original === "function") {
          obj[method] = function(...args) {
            const result = original.apply(this, args);
            onChange();
            return result;
          };
        }
      });
      obj.forEach((item, i) => {
        if (item && typeof item === "object") {
          obj[i] = createDeepReactiveProxy(item, onChange, visited);
        }
      });
    } else {
      Object.keys(obj).forEach((key) => {
        if (obj[key] && typeof obj[key] === "object") {
          obj[key] = createDeepReactiveProxy(obj[key], onChange, visited);
        }
      });
    }
    const handler = {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value === "function" && !isClass(value)) {
          return value.bind(receiver);
        }
        return value;
      },
      set(target, key, value, receiver) {
        const old = target[key];
        if (value && typeof value === "object") {
          value = createDeepReactiveProxy(value, onChange, new WeakSet);
        }
        const ok = Reflect.set(target, key, value, receiver);
        if (old !== value) {
          onChange(key, value, old);
        }
        return ok;
      },
      deleteProperty(target, key) {
        const ok = Reflect.deleteProperty(target, key);
        onChange();
        return ok;
      }
    };
    return new Proxy(obj, handler);
  }
  function createReactiveState(raw, onChange) {
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

  // src/store/index.js
  var globalStores = Object.create(null);
  var storeSubscribers = Object.create(null);
  function getStore(name) {
    return globalStores[name];
  }
  function initStore(name, value, options = {}) {
    if (!globalStores[name]) {
      let raw = value || {};
      if (options.persist) {
        try {
          const stored = localStorage.getItem(`sprucex-store-${name}`);
          if (stored) {
            Object.assign(raw, JSON.parse(stored));
          }
        } catch (e) {
          console.error(`SpruceX store "${name}" load error:`, e);
        }
      }
      const subscribers = new Set;
      storeSubscribers[name] = subscribers;
      const notify = () => {
        if (options.persist) {
          try {
            localStorage.setItem(`sprucex-store-${name}`, JSON.stringify(globalStores[name]));
          } catch (e) {
            console.error(`SpruceX store "${name}" save error:`, e);
          }
        }
        subscribers.forEach((comp) => comp.scheduleUpdate());
      };
      globalStores[name] = createDeepReactiveProxy(raw, notify);
    }
    return globalStores[name];
  }

  // src/utils/animations.js
  var autoAnimate = null;
  var autoAnimateLoaded = false;
  function getAutoAnimate() {
    if (autoAnimateLoaded)
      return autoAnimate;
    autoAnimateLoaded = true;
    if (window.autoAnimate) {
      autoAnimate = window.autoAnimate;
    } else if (window.AutoAnimate?.default) {
      autoAnimate = window.AutoAnimate.default;
    }
    return autoAnimate;
  }
  function setAutoAnimate(lib) {
    autoAnimate = lib;
    autoAnimateLoaded = true;
  }

  // src/utils/eval.js
  var evalFnCache = new Map;
  var execFnCache = new Map;
  function evalInScope(expr, scope, extra = {}) {
    const locals = scope.locals || {};
    const extraKeys = Object.keys(extra);
    const cacheKey = expr + "|" + extraKeys.join(",");
    let fn = evalFnCache.get(cacheKey);
    if (!fn) {
      try {
        fn = new Function("$state", "$event", "$refs", "$emit", "$store", "$locals", ...extraKeys, `with($state){ with($locals){ return (${expr}); } }`);
        evalFnCache.set(cacheKey, fn);
      } catch (e) {
        if (scope.debug) {
          console.error("SpruceX expression compile error:", expr, e);
        }
        throw e;
      }
    }
    try {
      return fn(scope.state, scope.lastEvent || null, scope.refs, scope.emit, getStore, locals, ...Object.values(extra));
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
    } catch (e) {
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
  function execInScope(stmt, scope, extra = {}) {
    const locals = scope.locals || {};
    const extraKeys = Object.keys(extra);
    const cacheKey = stmt + "|" + extraKeys.join(",");
    let fn = execFnCache.get(cacheKey);
    if (!fn) {
      try {
        fn = new Function("$state", "$event", "$refs", "$emit", "$store", "$locals", ...extraKeys, `with($state){ with($locals){ ${stmt} } }`);
        execFnCache.set(cacheKey, fn);
      } catch (e) {
        console.error("SpruceX statement compile error:", stmt, e);
        return;
      }
    }
    try {
      fn(scope.state, scope.lastEvent || null, scope.refs, scope.emit, getStore, locals, ...Object.values(extra));
    } catch (e) {
      console.error("SpruceX statement error:", stmt, e);
    }
  }

  // src/utils/morph.js
  function morphNodes(target, source) {
    const sourceIds = new Map;
    source.querySelectorAll("[id]").forEach((el) => {
      sourceIds.set(el.id, el);
    });
    sourceIds.forEach((sourceEl, id) => {
      const targetEl = target.querySelector(`#${CSS.escape(id)}`);
      if (targetEl) {
        morphElement(targetEl, sourceEl);
        sourceEl.__morphed = true;
      }
    });
    morphChildren(target, source);
  }
  function morphElement(target, source) {
    if (target === source)
      return;
    if (target.isEqualNode(source))
      return;
    if (target.tagName !== source.tagName) {
      target.replaceWith(source.cloneNode(true));
      return;
    }
    syncAttributes(target, source);
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      if (target.value !== source.value) {
        target.value = source.value;
      }
      if (target.checked !== source.checked) {
        target.checked = source.checked;
      }
      return;
    }
    if (target.tagName === "SELECT") {
      morphChildren(target, source);
      if (target.value !== source.value) {
        target.value = source.value;
      }
      return;
    }
    if (target.hasAttribute("sx-preserve"))
      return;
    morphChildren(target, source);
  }
  function morphChildren(target, source) {
    const targetChildren = Array.from(target.childNodes);
    const sourceChildren = Array.from(source.childNodes);
    const targetKeyedMap = new Map;
    const targetIdMap = new Map;
    targetChildren.forEach((child, i) => {
      if (child.nodeType === 1) {
        const key = child.getAttribute?.("sx-key") || child.getAttribute?.("key");
        if (key)
          targetKeyedMap.set(key, { el: child, index: i });
        const id = child.id;
        if (id)
          targetIdMap.set(id, { el: child, index: i });
      }
    });
    let targetIndex = 0;
    for (let i = 0;i < sourceChildren.length; i++) {
      const sourceChild = sourceChildren[i];
      if (sourceChild.nodeType === 3 || sourceChild.nodeType === 8) {
        const targetChild = targetChildren[targetIndex];
        if (targetChild && targetChild.nodeType === sourceChild.nodeType) {
          if (targetChild.nodeValue !== sourceChild.nodeValue) {
            targetChild.nodeValue = sourceChild.nodeValue;
          }
          targetIndex++;
        } else {
          const clone = sourceChild.cloneNode(true);
          if (targetChild) {
            target.insertBefore(clone, targetChild);
          } else {
            target.appendChild(clone);
          }
        }
        continue;
      }
      if (sourceChild.nodeType === 1) {
        if (sourceChild.__morphed) {
          delete sourceChild.__morphed;
          targetIndex++;
          continue;
        }
        const sourceKey = sourceChild.getAttribute?.("sx-key") || sourceChild.getAttribute?.("key");
        const sourceId = sourceChild.id;
        let matchedTarget = null;
        if (sourceKey && targetKeyedMap.has(sourceKey)) {
          matchedTarget = targetKeyedMap.get(sourceKey).el;
          targetKeyedMap.delete(sourceKey);
        } else if (sourceId && targetIdMap.has(sourceId)) {
          matchedTarget = targetIdMap.get(sourceId).el;
          targetIdMap.delete(sourceId);
        } else {
          const targetChild = targetChildren[targetIndex];
          if (targetChild?.nodeType === 1 && targetChild.tagName === sourceChild.tagName) {
            const targetKey = targetChild.getAttribute?.("sx-key") || targetChild.getAttribute?.("key");
            if (!targetKey) {
              matchedTarget = targetChild;
            }
          }
        }
        if (matchedTarget) {
          morphElement(matchedTarget, sourceChild);
          const currentIndex = Array.from(target.childNodes).indexOf(matchedTarget);
          const desiredIndex = i;
          if (currentIndex !== desiredIndex && currentIndex !== -1) {
            const refNode = target.childNodes[desiredIndex];
            if (refNode && refNode !== matchedTarget) {
              target.insertBefore(matchedTarget, refNode);
            }
          }
          targetIndex++;
        } else {
          const clone = sourceChild.cloneNode(true);
          const refNode = targetChildren[targetIndex];
          if (refNode) {
            target.insertBefore(clone, refNode);
          } else {
            target.appendChild(clone);
          }
        }
      }
    }
    while (target.childNodes.length > sourceChildren.length) {
      const extra = target.childNodes[sourceChildren.length];
      if (extra) {
        if (extra.__sprucex)
          extra.__sprucex.destroy();
        if (extra.nodeType === 1) {
          extra.querySelectorAll?.(`[${ATTR_DATA}]`).forEach((el) => {
            if (el.__sprucex)
              el.__sprucex.destroy();
          });
        }
        extra.remove();
      }
    }
  }
  function syncAttributes(target, source) {
    const targetAttrs = Array.from(target.attributes);
    for (const attr of targetAttrs) {
      if (!source.hasAttribute(attr.name)) {
        target.removeAttribute(attr.name);
      }
    }
    const sourceAttrs = Array.from(source.attributes);
    for (const attr of sourceAttrs) {
      if (target.getAttribute(attr.name) !== attr.value) {
        target.setAttribute(attr.name, attr.value);
      }
    }
  }

  // src/core/component.js
  class Component {
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
      this.originalClasses = new WeakMap;
      this.animatedElements = new Map;
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
    scheduleUpdate() {
      if (this.updatePending)
        return;
      this.updatePending = true;
      this.rafId = requestAnimationFrame(() => {
        this.updatePending = false;
        this.rafId = null;
        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT" || activeEl.isContentEditable);
        const isInsideForBlock = isInputFocused && this.root.contains(activeEl) && this.forBlocks.some((block) => {
          return block.instances.some((inst) => inst.elements && inst.elements.some((el) => el.contains(activeEl)));
        });
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
        enumerable: false
      });
      Object.defineProperty(raw, "$store", {
        value: (name) => {
          const store = getStore(name);
          if (store && storeSubscribers[name]) {
            storeSubscribers[name].add(this);
          }
          return store;
        },
        enumerable: false
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
        if (name)
          this.refs[name] = el;
      });
    }
    setupDelegation() {
      DELEGATED_EVENTS.forEach((eventName) => {
        const handler = (e) => this.handleDelegatedEvent(e);
        this.root.addEventListener(eventName, handler);
        if (!this._delegatedCleanups)
          this._delegatedCleanups = [];
        this._delegatedCleanups.push(() => this.root.removeEventListener(eventName, handler));
      });
    }
    handleDelegatedEvent(e) {
      let cur = e.target;
      let propagationStopped = false;
      const originalStop = e.stopPropagation;
      e.stopPropagation = function() {
        propagationStopped = true;
        originalStop.apply(this, arguments);
      };
      while (cur && cur.nodeType === 1) {
        if (cur.__sx_handlers && cur.__sx_handlers[e.type]) {
          cur.__sx_handlers[e.type].forEach(({ handler: handlerFn, component }) => {
            if (component !== this)
              return;
            if (!propagationStopped) {
              handlerFn(e);
            }
          });
        }
        if (propagationStopped)
          break;
        if (cur === this.root)
          break;
        cur = cur.parentNode;
      }
    }
    scan(root) {
      const self = this;
      walk(root, (el) => {
        if (el !== root && el.hasAttribute(ATTR_DATA))
          return false;
        if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
          const expr = el.getAttribute(ATTR_FOR) || "";
          const parent = el.parentElement;
          if (!parent)
            return;
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
            autoAnimate: parent.hasAttribute(ATTR_ANIMATE)
          });
          if (parent.hasAttribute(ATTR_ANIMATE)) {
            const opts = parent.getAttribute(ATTR_ANIMATE);
            let config = {};
            if (opts && opts !== "true" && opts !== "") {
              try {
                config = JSON.parse(opts);
              } catch (e) {
                const duration = parseInt(opts, 10);
                if (!isNaN(duration))
                  config = { duration };
              }
            }
            self.setupAutoAnimate(parent, config);
          }
        }
      });
      walk(root, (el) => {
        if (el.nodeType !== 1)
          return;
        if (el !== root && el.hasAttribute(ATTR_DATA))
          return false;
        if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR))
          return;
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
          locals
        });
      }
      const htmlExpr = el.getAttribute(ATTR_HTML);
      if (htmlExpr && !hasMemo) {
        self.bindings.push({
          el,
          type: "html",
          expr: htmlExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals
        });
      }
      const showExpr = el.getAttribute(ATTR_SHOW);
      if (showExpr) {
        self.bindings.push({
          el,
          type: "show",
          expr: showExpr,
          errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
          locals
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
          locals
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
            locals
          });
        }
      }
      const memoExpr = el.getAttribute(ATTR_MEMO);
      const textForMemo = el.getAttribute(ATTR_TEXT);
      const htmlForMemo = el.getAttribute(ATTR_HTML);
      if (memoExpr && (textForMemo || htmlForMemo)) {
        let deps = [];
        try {
          const fn = new Function(`return (${memoExpr});`);
          const val = fn();
          if (Array.isArray(val))
            deps = val;
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
          locals
        });
      }
      this.setupModelBinding(el, locals);
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith(ATTR_ON_PREFIX)) {
          const full = attr.name.slice(ATTR_ON_PREFIX.length);
          const [eventName, ...mods] = full.split(".");
          const expr = attr.value;
          const handler = (ev) => {
            if (mods.includes("prevent"))
              ev.preventDefault();
            if (mods.includes("stop"))
              ev.stopPropagation();
            if (mods.includes("self") && ev.target !== ev.currentTarget)
              return;
            if (mods.includes("window") && ev.target !== window)
              return;
            if (mods.includes("document") && ev.target !== document)
              return;
            if (ev instanceof KeyboardEvent) {
              const keys = mods.filter((m) => !["prevent", "stop", "self", "window", "document"].includes(m));
              if (keys.length > 0) {
                const key = ev.key.toLowerCase();
                if (!keys.includes(key))
                  return;
              }
            }
            this.lastEvent = ev;
            const prev = this.locals;
            if (locals)
              this.locals = locals;
            execInScope(expr, this);
            this.locals = prev;
          };
          if (DELEGATED_EVENTS.has(eventName)) {
            if (!el.__sx_handlers)
              el.__sx_handlers = {};
            if (!el.__sx_handlers[eventName])
              el.__sx_handlers[eventName] = [];
            el.__sx_handlers[eventName].push({ handler, component: this });
          } else {
            el.addEventListener(eventName, handler);
            self.eventHandlers.push({ el, event: eventName, handler });
          }
        }
      }
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
              includeSelector
            };
            self.netBindings.push(binding);
          }
        }
      }
      if (el.hasAttribute(ATTR_ANIMATE)) {
        const optionsStr = el.getAttribute(ATTR_ANIMATE);
        queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
      }
    }
    setupModelBinding(el, locals = null) {
      const direct = el.getAttribute(ATTR_MODEL);
      const modifierAttrs = Array.from(el.attributes).filter((a) => a.name.startsWith(ATTR_MODEL_PREFIX));
      if (!direct && modifierAttrs.length === 0)
        return;
      const keyExpr = direct || modifierAttrs[0].value;
      const mods = new Set;
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
        if (locals)
          this.locals = locals;
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
        if (mods.has("trim") && typeof val === "string")
          val = val.trim();
        if (mods.has("number")) {
          const n = Number(val);
          if (!Number.isNaN(n))
            val = n;
        }
        return val;
      };
      const writeBack = () => {
        const prev = this.locals;
        if (locals)
          this.locals = locals;
        try {
          let v;
          if (isCheckbox) {
            const current = safeEval(keyExpr, this);
            if (Array.isArray(current)) {
              const arr = [...current];
              const idx = arr.indexOf(el.value);
              if (el.checked && idx === -1)
                arr.push(el.value);
              if (!el.checked && idx !== -1)
                arr.splice(idx, 1);
              v = arr;
            } else {
              v = el.checked;
            }
          } else if (isRadio) {
            if (!el.checked)
              return;
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
      if (mods.has("lazy"))
        eventName = "change";
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
          if (ev)
            this.lastEvent = ev;
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
              if (!ok)
                return;
            }
            this.performRequest(nb);
          }, poll);
          this.pollTimers.push(timer);
        }
      }
    }
    setupAutoAnimate(el, options = {}) {
      const aa = getAutoAnimate();
      if (!aa)
        return null;
      if (typeof options === "string" && options.trim()) {
        try {
          options = new Function(`return (${options})`)();
        } catch (e) {
          console.error("SpruceX sx-animate options parse error:", e);
          options = {};
        }
      }
      const defaultOptions = {
        duration: 250,
        easing: "ease-in-out"
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
        controller.disable?.();
      }
      this.animatedElements.delete(el);
    }
    buildUrl(nb) {
      const { urlTpl, varsExpr } = nb;
      if (!varsExpr)
        return urlTpl;
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
      if (!["POST", "PUT", "DELETE"].includes(method))
        return null;
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
      const { el, method, target, swap, jsonInto, optimistic, revertOnError } = nb;
      if (optimistic) {
        execInScope(optimistic, this);
      }
      try {
        const res = await fetch(url, { method, body });
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
        el.dispatchEvent(new CustomEvent("sprucex:success", { detail, bubbles: true }));
      } catch (error) {
        if (revertOnError) {
          execInScope(revertOnError, this);
        }
        const detail = { error };
        el.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
        el.dispatchEvent(new CustomEvent("sprucex:error", { detail, bubbles: true }));
      }
    }
    applySwap(targetSelectorOrEl, html, swap) {
      const target = typeof targetSelectorOrEl === "string" ? document.querySelector(targetSelectorOrEl) : targetSelectorOrEl;
      if (!target)
        return;
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
          const parser = new DOMParser;
          const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
          const source = doc.body.firstChild;
          if (source)
            morphNodes(target, source);
          break;
        }
        case "id-map": {
          const parser = new DOMParser;
          const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
          const source = doc.body.firstChild;
          if (source)
            morphNodes(target, source);
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
        const prevLocals = this.locals;
        if (parentLocals) {
          this.locals = parentLocals;
        }
        const collection = safeEval(def.iterable, this) || [];
        const arr = Array.from(collection);
        this.locals = prevLocals;
        const instanceMap = new Map;
        instances.forEach((inst) => {
          const key = inst.itemKey;
          if (key !== undefined) {
            instanceMap.set(key, inst);
          }
        });
        const newInstances = [];
        const usedKeys = new Set;
        for (let i = 0;i < arr.length; i++) {
          const item = arr[i];
          const idxName = def.index || "$index";
          let key = item;
          if (typeof item === "object" && item !== null) {
            key = item;
          }
          let inst = instanceMap.get(key);
          if (inst && !usedKeys.has(key)) {
            usedKeys.add(key);
            inst.scopeLocals[idxName] = i;
            newInstances.push(inst);
          } else {
            const locals = parentLocals ? { ...parentLocals } : {};
            locals[def.item] = item;
            locals[idxName] = i;
            const frag = template.content ? template.content.cloneNode(true) : cloneChildren(template);
            const elements = [];
            while (frag.firstChild) {
              const child = frag.firstChild;
              elements.push(child);
              frag.removeChild(child);
            }
            const instanceBindings = {
              bindings: [],
              memoBindings: [],
              modelBindings: [],
              eventHandlers: [],
              nestedForBlocks: []
            };
            elements.forEach((el) => {
              const elBindings = this.scanFragmentBindings(el, locals);
              instanceBindings.bindings.push(...elBindings.bindings);
              instanceBindings.memoBindings.push(...elBindings.memoBindings);
              instanceBindings.modelBindings.push(...elBindings.modelBindings);
              instanceBindings.eventHandlers.push(...elBindings.eventHandlers);
              if (elBindings.nestedForBlocks) {
                instanceBindings.nestedForBlocks.push(...elBindings.nestedForBlocks);
              }
            });
            const newInst = {
              scopeLocals: locals,
              elements,
              bindings: instanceBindings,
              itemKey: key
            };
            newInstances.push(newInst);
            usedKeys.add(key);
          }
        }
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
        let anchor = marker;
        for (let i = newInstances.length - 1;i >= 0; i--) {
          const inst = newInstances[i];
          inst.elements.forEach((el) => {
            parent.insertBefore(el, anchor);
          });
          if (inst.elements.length > 0) {
            anchor = inst.elements[0];
          }
        }
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
        nestedForBlocks: []
      };
      walk(rootNode, (el) => {
        if (el.nodeType !== 1)
          return;
        if (el.hasAttribute(ATTR_DATA))
          return false;
        if (el.tagName === "TEMPLATE" && el.hasAttribute(ATTR_FOR)) {
          const expr = el.getAttribute(ATTR_FOR) || "";
          const parent = el.parentElement;
          if (!parent)
            return;
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
            autoAnimate: parent.hasAttribute(ATTR_ANIMATE)
          };
          self.forBlocks.push(nestedBlock);
          instanceBindings.nestedForBlocks.push(nestedBlock);
          if (parent.hasAttribute(ATTR_ANIMATE)) {
            const opts = parent.getAttribute(ATTR_ANIMATE);
            let config = {};
            if (opts && opts !== "true" && opts !== "") {
              try {
                config = JSON.parse(opts);
              } catch (e) {
                const duration = parseInt(opts, 10);
                if (!isNaN(duration))
                  config = { duration };
              }
            }
            self.setupAutoAnimate(parent, config);
          }
          return false;
        }
        const hasMemo = el.hasAttribute(ATTR_MEMO);
        const textExpr = el.getAttribute(ATTR_TEXT);
        if (textExpr && !hasMemo) {
          const binding = {
            el,
            type: "text",
            expr: textExpr,
            errorFallback: el.getAttribute(ATTR_ERROR_FALLBACK),
            locals
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
            locals
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
            locals
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
            locals
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
              locals
            };
            self.bindings.push(binding);
            instanceBindings.bindings.push(binding);
          }
        }
        const memoExpr = el.getAttribute(ATTR_MEMO);
        const textForMemo = el.getAttribute(ATTR_TEXT);
        const htmlForMemo = el.getAttribute(ATTR_HTML);
        if (memoExpr && (textForMemo || htmlForMemo)) {
          let deps = [];
          try {
            const fn = new Function(`return (${memoExpr});`);
            const val = fn();
            if (Array.isArray(val))
              deps = val;
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
            locals
          };
          self.memoBindings.push(memoBinding);
          instanceBindings.memoBindings.push(memoBinding);
        }
        const modelBinding = this.setupModelBindingWithReturn(el, locals);
        if (modelBinding) {
          instanceBindings.modelBindings.push(modelBinding);
        }
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith(ATTR_ON_PREFIX)) {
            const full = attr.name.slice(ATTR_ON_PREFIX.length);
            const [eventName, ...mods] = full.split(".");
            const expr = attr.value;
            const handler = (ev) => {
              if (mods.includes("prevent"))
                ev.preventDefault();
              if (mods.includes("stop"))
                ev.stopPropagation();
              if (mods.includes("self") && ev.target !== ev.currentTarget)
                return;
              if (mods.includes("window") && ev.target !== window)
                return;
              if (mods.includes("document") && ev.target !== document)
                return;
              if (ev instanceof KeyboardEvent) {
                const keys = mods.filter((m) => !["prevent", "stop", "self", "window", "document"].includes(m));
                if (keys.length > 0) {
                  const key = ev.key.toLowerCase();
                  if (!keys.includes(key))
                    return;
                }
              }
              this.lastEvent = ev;
              const prev = this.locals;
              this.locals = locals;
              execInScope(expr, this);
              this.locals = prev;
            };
            if (DELEGATED_EVENTS.has(eventName)) {
              if (!el.__sx_handlers)
                el.__sx_handlers = {};
              if (!el.__sx_handlers[eventName])
                el.__sx_handlers[eventName] = [];
              el.__sx_handlers[eventName].push({ handler, component: this });
            } else {
              el.addEventListener(eventName, handler);
              self.eventHandlers.push({ el, event: eventName, handler });
              instanceBindings.eventHandlers.push({
                el,
                event: eventName,
                handler
              });
            }
          }
        }
        if (el.hasAttribute(ATTR_ANIMATE)) {
          const optionsStr = el.getAttribute(ATTR_ANIMATE);
          queueMicrotask(() => this.setupAutoAnimate(el, optionsStr || {}));
        }
      });
      return instanceBindings;
    }
    setupModelBindingWithReturn(el, locals = null) {
      const direct = el.getAttribute(ATTR_MODEL);
      const modifierAttrs = Array.from(el.attributes).filter((a) => a.name.startsWith(ATTR_MODEL_PREFIX));
      if (!direct && modifierAttrs.length === 0)
        return null;
      const keyExpr = direct || modifierAttrs[0].value;
      const mods = new Set;
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
        if (locals)
          this.locals = locals;
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
        if (mods.has("trim") && typeof val === "string")
          val = val.trim();
        if (mods.has("number")) {
          const n = Number(val);
          if (!Number.isNaN(n))
            val = n;
        }
        return val;
      };
      const writeBack = () => {
        const prev = this.locals;
        if (locals)
          this.locals = locals;
        try {
          let v;
          if (isCheckbox) {
            const current = safeEval(keyExpr, this);
            if (Array.isArray(current)) {
              const arr = [...current];
              const idx = arr.indexOf(el.value);
              if (el.checked && idx === -1)
                arr.push(el.value);
              if (!el.checked && idx !== -1)
                arr.splice(idx, 1);
              v = arr;
            } else {
              v = el.checked;
            }
          } else if (isRadio) {
            if (!el.checked)
              return;
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
      if (mods.has("lazy"))
        eventName = "change";
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
      instanceBindings.bindings.forEach((b) => {
        const idx = this.bindings.indexOf(b);
        if (idx !== -1)
          this.bindings.splice(idx, 1);
      });
      instanceBindings.memoBindings.forEach((b) => {
        const idx = this.memoBindings.indexOf(b);
        if (idx !== -1)
          this.memoBindings.splice(idx, 1);
      });
      instanceBindings.modelBindings.forEach((b) => {
        const idx = this.modelBindings.indexOf(b);
        if (idx !== -1)
          this.modelBindings.splice(idx, 1);
      });
      instanceBindings.eventHandlers.forEach(({ el, event, handler }) => {
        el.removeEventListener(event, handler);
        const idx = this.eventHandlers.findIndex((h) => h.el === el && h.event === event && h.handler === handler);
        if (idx !== -1)
          this.eventHandlers.splice(idx, 1);
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
        if (locals)
          this.locals = locals;
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
              const original = this.originalClasses.get(el) || new Set;
              const current = new Set(Array.from(el.classList));
              if (typeof v === "string") {
                const newClasses = new Set(v.split(/\s+/).filter(Boolean));
                current.forEach((c) => {
                  if (!original.has(c))
                    el.classList.remove(c);
                });
                newClasses.forEach((c) => el.classList.add(c));
              } else if (v && typeof v === "object") {
                Object.keys(v).forEach((k) => {
                  k.split(/\s+/).filter(Boolean).forEach((cls) => {
                    if (v[k])
                      el.classList.add(cls);
                    else
                      el.classList.remove(cls);
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
        if (locals)
          this.locals = locals;
        try {
          const currVals = deps.map((k) => {
            if (locals && k in locals)
              return locals[k];
            if (k in this.state)
              return this.state[k];
            return this.state[k];
          });
          if (mb.lastVals && mb.lastVals.length === currVals.length && mb.lastVals.every((v2, i) => v2 === currVals[i])) {
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
      walk(this.root, (el) => {
        if (el !== this.root && el.hasAttribute(ATTR_DATA))
          return false;
        if (el.__sx_handlers)
          delete el.__sx_handlers;
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
      Object.keys(storeSubscribers).forEach((name) => {
        storeSubscribers[name].delete(this);
      });
      this.animatedElements.forEach((controller, el) => {
        this.disableAutoAnimate(el);
      });
      this.animatedElements.clear();
      this.eventHandlers.forEach(({ el, event, handler }) => {
        el.removeEventListener(event, handler);
      });
      if (this._delegatedCleanups) {
        this._delegatedCleanups.forEach((fn) => fn());
      }
      this.pollTimers.forEach((t) => clearInterval(t));
      if (this.rafId)
        cancelAnimationFrame(this.rafId);
      this.bindings = [];
      this.memoBindings = [];
      this.modelBindings = [];
      this.eventHandlers = [];
      this.netBindings = [];
      this.forBlocks = [];
      this.pollTimers = [];
      delete this.root.__sprucex;
    }
  }

  // src/index.js
  var pageCache = new Map;
  var pendingFetches = new Map;
  var PAGE_CACHE_TTL = 30000;
  var SpruceX = {
    init: initSpruceX,
    store: initStore,
    inspect() {
      const roots = document.querySelectorAll(`[${ATTR_DATA}]`);
      return Array.from(roots).map((r) => ({
        el: r,
        state: r.__sprucex?.state || null
      }));
    },
    config(newCfg) {},
    navigate(url) {
      const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
      const targetSelector = pageRoot?.getAttribute(ATTR_PAGE);
      const container = targetSelector ? document.querySelector(targetSelector) : document.body;
      return navigateTo(url, container);
    },
    prefetch(url) {
      return prefetchLink(url);
    },
    clearCache() {
      pageCache.clear();
    },
    morph(target, source) {
      if (typeof target === "string")
        target = document.querySelector(target);
      if (typeof source === "string") {
        const parser = new DOMParser;
        const doc = parser.parseFromString(`<div>${source}</div>`, "text/html");
        source = doc.body.firstChild;
      }
      if (target && source)
        morphNodes(target, source);
    },
    animate(el, options = {}) {
      if (typeof el === "string")
        el = document.querySelector(el);
      if (!el)
        return null;
      const aa = getAutoAnimate();
      if (!aa) {
        console.warn("SpruceX: auto-animate library not found. Include it via script tag or npm.");
        return null;
      }
      return aa(el, options);
    },
    setAutoAnimate
  };
  if (typeof window !== "undefined") {
    window.SpruceX = SpruceX;
  }
  function initSpruceXRoot(root) {
    if (root.__sprucex)
      return root.__sprucex;
    const comp = new Component(root);
    root.__sprucex = comp;
    return comp;
  }
  function initSpruceX() {
    const roots = document.querySelectorAll(`[${ATTR_DATA}]`);
    roots.forEach((root) => {
      const lazy = root.hasAttribute(ATTR_LAZY);
      if (!lazy) {
        initSpruceXRoot(root);
      } else {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              initSpruceXRoot(root);
              io.disconnect();
            }
          });
        });
        io.observe(root);
      }
    });
    const pageRoot = document.querySelector(`[${ATTR_PAGE}]`);
    if (pageRoot && !pageRoot.__sprucex_page) {
      pageRoot.__sprucex_page = true;
      initPageSwapping(pageRoot);
    }
    initBoostingGlobal();
    initAutoCleanup();
    Array.from(document.scripts).forEach((script) => {
      script.__sprucex_executed = true;
    });
  }
  var cleanupObserver = null;
  function initAutoCleanup() {
    if (cleanupObserver)
      return;
    cleanupObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType !== 1)
            return;
          if (node.__sprucex) {
            node.__sprucex.destroy();
          }
          node.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
            if (el.__sprucex) {
              el.__sprucex.destroy();
            }
          });
        });
      }
    });
    if (document.body) {
      cleanupObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }
  var isGlobalNavInitialized = false;
  function initPageSwapping(root) {
    const pageAttr = root.getAttribute(ATTR_PAGE);
    if (pageAttr === null)
      return;
    const container = pageAttr ? document.querySelector(pageAttr) : document.body;
    if (!container) {
      console.error("SpruceX sx-page target not found:", pageAttr);
      return;
    }
    if (isGlobalNavInitialized)
      return;
    isGlobalNavInitialized = true;
    document.addEventListener("click", async (e) => {
      const link = e.target.closest("a[href]");
      if (!link)
        return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        return;
      if (link.hasAttribute("download") || link.getAttribute("target") === "_blank")
        return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin)
          return;
        e.preventDefault();
        await navigateTo(url.href, container);
      } catch {
        return;
      }
    });
    window.addEventListener("popstate", async () => {
      await navigateTo(window.location.href, container, false);
    });
  }
  function initBoostingGlobal() {
    document.querySelectorAll(`[${ATTR_BOOST}]`).forEach((el) => {
      if (el.__sprucex_boost)
        return;
      el.__sprucex_boost = true;
      const boostOn = el.getAttribute(ATTR_BOOST_ON) || "mouseenter";
      const events = boostOn.split(/\s+/);
      if (el.tagName === "A") {
        events.forEach((evt) => {
          el.addEventListener(evt, () => prefetchLink(el.href), {
            passive: true,
            once: true
          });
        });
      } else {
        events.forEach((evt) => {
          el.addEventListener(evt, (e) => {
            const link = e.target.closest("a[href]");
            if (link && !link.__sprucex_prefetched) {
              link.__sprucex_prefetched = true;
              prefetchLink(link.href);
            }
          }, { passive: true });
        });
        el.addEventListener("focusin", (e) => {
          const link = e.target.closest("a[href]");
          if (link && !link.__sprucex_prefetched) {
            link.__sprucex_prefetched = true;
            prefetchLink(link.href);
          }
        }, { passive: true });
      }
    });
  }
  async function navigateTo(url, container, pushState = true) {
    const startTime = performance.now();
    const beforeEvent = new CustomEvent("sprucex:page-before", {
      detail: { url },
      bubbles: true,
      cancelable: true
    });
    if (!document.dispatchEvent(beforeEvent))
      return;
    try {
      let html = getCachedPage(url);
      if (!html) {
        if (container)
          container.style.opacity = container.style.opacity || "1";
        html = await fetchPage(url);
      }
      if (!html)
        throw new Error("Empty response");
      const parser = new DOMParser;
      const doc = parser.parseFromString(html, "text/html");
      let newContent;
      const pageRoot = document.querySelector("[sx-page]");
      const targetSelector = pageRoot?.getAttribute(ATTR_PAGE);
      if (targetSelector) {
        newContent = doc.querySelector(targetSelector);
      }
      if (!newContent) {
        newContent = doc.body;
      }
      const newTitle = doc.querySelector("title");
      if (newTitle)
        document.title = newTitle.textContent;
      reinitializeComponents(container);
      if (container && newContent) {
        morphNodes(container, newContent);
        container.querySelectorAll("script").forEach((script) => {
          if (!script.__sprucex_executed) {
            runScript(script);
          }
        });
      }
      if (pushState) {
        history.pushState({ url }, "", url);
      }
      reinitializeComponents(container);
      initSpruceX();
      let ancestor = container.parentElement;
      while (ancestor) {
        if (ancestor.__sprucex) {
          ancestor.__sprucex.refresh();
        }
        ancestor = ancestor.parentElement;
      }
      initBoostingGlobal();
      const hash = new URL(url).hash;
      if (hash) {
        const target = document.querySelector(hash);
        if (target)
          target.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
      document.dispatchEvent(new CustomEvent("sprucex:page-after", {
        detail: { url, duration: performance.now() - startTime },
        bubbles: true
      }));
    } catch (error) {
      console.error("SpruceX page navigation error:", error);
      document.dispatchEvent(new CustomEvent("sprucex:page-error", {
        detail: { url, error },
        bubbles: true
      }));
      window.location.href = url;
    }
  }
  function reinitializeComponents(container) {
    if (!container)
      return;
    container.querySelectorAll(`[${ATTR_DATA}]`).forEach((el) => {
      if (el.__sprucex) {
        el.__sprucex.destroy();
      }
    });
    if (container.hasAttribute(ATTR_DATA) && container.__sprucex) {
      container.__sprucex.destroy();
    }
  }
  async function prefetchLink(href) {
    if (!href)
      return;
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin)
        return;
      if (url.href === window.location.href)
        return;
      await fetchPage(url.href);
    } catch {}
  }
  async function fetchPage(url) {
    const cached = getCachedPage(url);
    if (cached)
      return cached;
    if (pendingFetches.has(url)) {
      return pendingFetches.get(url);
    }
    const fetchPromise = (async () => {
      try {
        const res = await fetch(url, {
          headers: { "X-SpruceX-Request": "true" }
        });
        if (!res.ok)
          throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        pageCache.set(url, {
          html,
          timestamp: Date.now()
        });
        return html;
      } finally {
        pendingFetches.delete(url);
      }
    })();
    pendingFetches.set(url, fetchPromise);
    return fetchPromise;
  }
  function getCachedPage(url) {
    const entry = pageCache.get(url);
    if (!entry)
      return null;
    if (Date.now() - entry.timestamp > PAGE_CACHE_TTL) {
      pageCache.delete(url);
      return null;
    }
    return entry.html;
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initSpruceX);
    } else {
      initSpruceX();
    }
  }
  function runScript(script) {
    if (script.type && script.type !== "text/javascript" && script.type !== "application/javascript" && script.type !== "module") {
      return;
    }
    const newScript = document.createElement("script");
    Array.from(script.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });
    newScript.textContent = script.textContent;
    newScript.__sprucex_executed = true;
    script.replaceWith(newScript);
  }
})();
