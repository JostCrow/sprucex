import {
  NET_METHODS,
  ATTR_TRIGGER,
  ATTR_TRIGGER_DEBOUNCE,
  ATTR_TARGET,
  ATTR_SWAP,
  ATTR_SELECT,
  ATTR_PUSH_URL,
  ATTR_REPLACE_URL,
  ATTR_VARS,
  ATTR_PARAMS,
  ATTR_JSON_INTO,
  ATTR_JSON_INTO_SHALLOW,
  ATTR_OPTIMISTIC,
  ATTR_REVERT_ON_ERROR,
  ATTR_POLL,
  ATTR_POLL_WHILE,
  ATTR_POLL_BACKGROUND,
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
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
} from "../constants.js";
import { safeEval, execInScope } from "../utils/eval.js";
import { markRaw } from "../reactivity/index.js";
import { morphNodes } from "../utils/morph.js";

export function scanNetworkDirectives(component, el, locals) {
  for (const m of NET_METHODS) {
    const attrName = `sx-${m}`;
    const urlTpl = el.getAttribute(attrName);
    if (!urlTpl) continue;

    const trigger =
      el.getAttribute(ATTR_TRIGGER) ||
      (el.tagName === "FORM" ? "submit" : "click");
    const triggerDebounce = el.getAttribute(ATTR_TRIGGER_DEBOUNCE);
    const target = el.getAttribute(ATTR_TARGET) || null;
    const swap = el.getAttribute(ATTR_SWAP) || "innerHTML";
    const select = el.getAttribute(ATTR_SELECT) || null;
    const pushUrl = el.hasAttribute(ATTR_PUSH_URL)
      ? el.getAttribute(ATTR_PUSH_URL) || "true"
      : null;
    const replaceUrl = el.hasAttribute(ATTR_REPLACE_URL)
      ? el.getAttribute(ATTR_REPLACE_URL) || "true"
      : null;
    const varsExpr = el.getAttribute(ATTR_VARS);
    const paramsExpr = el.getAttribute(ATTR_PARAMS);
    const jsonIntoShallow = el.getAttribute(ATTR_JSON_INTO_SHALLOW);
    const jsonInto = jsonIntoShallow || el.getAttribute(ATTR_JSON_INTO);
    const shallowJson = Boolean(jsonIntoShallow);
    const optimistic = el.getAttribute(ATTR_OPTIMISTIC);
    const revertOnError = el.getAttribute(ATTR_REVERT_ON_ERROR);
    const poll = el.getAttribute(ATTR_POLL);
    const pollWhile = el.getAttribute(ATTR_POLL_WHILE);
    const pollBackground = el.hasAttribute(ATTR_POLL_BACKGROUND);
    const includeSelector = el.getAttribute(ATTR_INCLUDE);
    const bodyExpr = el.getAttribute(ATTR_BODY);
    const bodyType = el.getAttribute(ATTR_BODY_TYPE);
    const headersExpr = el.getAttribute(ATTR_HEADERS);
    const loadingInto = el.getAttribute(ATTR_LOADING_INTO);
    const errorInto = el.getAttribute(ATTR_ERROR_INTO);
    const disableWhileRequest = el.hasAttribute(ATTR_DISABLE_WHILE_REQUEST);
    const textWhileRequest = el.getAttribute(ATTR_TEXT_WHILE_REQUEST);
    const confirmExpr = el.getAttribute(ATTR_CONFIRM);
    const cancelPrevious = el.hasAttribute(ATTR_CANCEL_PREVIOUS);

    const binding = {
      el,
      locals,
      scope: Object.assign(Object.create(component), { locals, currentEl: el }),
      method: m.toUpperCase(),
      urlTpl,
      trigger,
      triggerDebounce,
      target,
      swap,
      select,
      pushUrl,
      replaceUrl,
      varsExpr,
      paramsExpr,
      jsonInto,
      shallowJson,
      optimistic,
      revertOnError,
      poll: poll ? Number(poll) : null,
      pollWhile,
      pollBackground,
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

    component.netBindings.push(binding);
  }
}

export function parseNetworkTriggers(nb) {
  const fallbackDebounce = Number(nb.triggerDebounce);
  const defaultDebounceMs =
    Number.isFinite(fallbackDebounce) && fallbackDebounce > 0
      ? fallbackDebounce
      : null;
  const raw = (nb.trigger || "").trim();
  const fallback = nb.el.tagName === "FORM" ? "submit" : "click";

  if (!raw) {
    return [{ eventName: fallback, debounceMs: defaultDebounceMs, from: null }];
  }

  // Split comma-separated trigger clauses first so "filters-changed from:window, click"
  // preserves the `from:` modifier with its event name.
  const clauses = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const result = [];

  for (const clause of clauses) {
    const words = clause.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length) {
      const token = words[i];
      let from = null;
      if (words[i + 1] && words[i + 1].startsWith("from:")) {
        from = words[i + 1].slice(5);
        i += 2;
      } else {
        i += 1;
      }

      const parts = token.split(".");
      const eventName = parts[0] || fallback;
      let triggerDebounce = defaultDebounceMs;
      const debounceIdx = parts.indexOf("debounce");
      if (debounceIdx !== -1) {
        const rawMs = String(parts[debounceIdx + 1] || "").replace(/ms$/i, "");
        const parsed = Number(rawMs);
        if (Number.isFinite(parsed) && parsed > 0) {
          triggerDebounce = parsed;
        }
      }

      result.push({ eventName, debounceMs: triggerDebounce, from });
    }
  }

  return result.length
    ? result
    : [{ eventName: fallback, debounceMs: defaultDebounceMs, from: null }];
}

function resolveTriggerTarget(component, el, from) {
  if (!from) return el;
  if (from === "window") return typeof window !== "undefined" ? window : null;
  if (from === "document") return typeof document !== "undefined" ? document : null;
  if (from === "closest") return el.parentElement;
  const rootNode = component.root.getRootNode?.() || document;
  return rootNode.querySelector?.(from) || document.querySelector?.(from) || null;
}

export function setupNetworkBindings(component) {
  for (const nb of component.netBindings) {
    if (nb.initialized) continue;
    nb.initialized = true;
    nb.disposers = [];
    const { el, poll, pollWhile, pollBackground } = nb;
    const triggerDefs = parseNetworkTriggers(nb);

    const doReq = (ev = null) => {
      if (ev) {
        component.lastEvent = ev;
        if (ev.type === "submit") ev.preventDefault();
      }

      nb.scope.lastEvent = ev || component.lastEvent;
      if (nb.disposed || component.isDestroyed || !nb.scope.confirmRequest(nb)) return;
      performRequest(component, nb);
    };

    triggerDefs.forEach(({ eventName, debounceMs, from }) => {
      if (eventName === "load") {
        queueMicrotask(() => doReq());
        return;
      }

      const domHandler = component.wrapDebounced(doReq, debounceMs);
      const listenTarget = resolveTriggerTarget(component, el, from);
      if (listenTarget) {
        listenTarget.addEventListener(eventName, domHandler);
        component.eventHandlers.push({
          el: listenTarget,
          sourceEl: el,
          event: eventName,
          handler: domHandler,
        });
      }

      if (!from) {
        const compHandler = component.wrapDebounced(() => doReq(), debounceMs);
        component.emitter.addEventListener(eventName, compHandler);
        const emitterRecord = { event: eventName, handler: compHandler };
        component.emitterHandlers.push(emitterRecord);
        nb.disposers.push(() => {
          compHandler.cancel?.();
          component.emitter.removeEventListener(eventName, compHandler);
          component.emitterHandlers = component.emitterHandlers.filter(
            (record) => record !== emitterRecord,
          );
        });
      }
    });

    if (poll && !Number.isNaN(poll) && poll > 0) {
      let skippedWhileHidden = false;

      const tick = () => {
        if (nb.disposed || component.isDestroyed) return;
        if (!pollBackground && typeof document !== "undefined" && document.hidden) {
          skippedWhileHidden = true;
          return;
        }
        if (pollWhile) {
          const ok = !!safeEval(pollWhile, nb.scope);
          if (!ok) return;
        }
        skippedWhileHidden = false;
        performRequest(component, nb);
      };

      const timer = setInterval(tick, poll);
      component.pollTimers.push(timer);

      let onVisibilityChange = null;
      if (!pollBackground && typeof document !== "undefined") {
        onVisibilityChange = () => {
          if (!document.hidden && skippedWhileHidden) {
            tick();
          }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
      }

      nb.disposers.push(() => {
        clearInterval(timer);
        component.pollTimers = component.pollTimers.filter((entry) => entry !== timer);
        if (onVisibilityChange && typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibilityChange);
        }
      });
    }
  }
}

export function buildUrl(scope, nb) {
  const { urlTpl, varsExpr, paramsExpr } = nb;
  let url = urlTpl;

  if (varsExpr) {
    const vars = safeEval(varsExpr, scope) || {};
    url = url.replace(/\$\{([A-Za-z_$][A-Za-z0-9_$.]*)\}/g, (_match, key) => {
      const segments = key.split(".");
      let value = vars;
      for (const seg of segments) {
        if (value == null) return "";
        value = value[seg];
      }
      if (value == null) return "";
      return encodeURIComponent(String(value));
    });
  }

  if (paramsExpr) {
    const paramsObj = safeEval(paramsExpr, scope);
    if (paramsObj && typeof paramsObj === "object") {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(paramsObj)) {
        if (v === null || v === undefined || v === "") continue;
        if (Array.isArray(v)) {
          v.forEach((item) => {
            if (item !== null && item !== undefined) {
              searchParams.append(k, String(item));
            }
          });
        } else {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }
  }

  const baseUrl = scope.constructor?.baseUrl;
  if (
    baseUrl &&
    typeof baseUrl === "string" &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) &&
    !url.startsWith("//")
  ) {
    const trimmedBase = baseUrl.replace(/\/+$/, "");
    const trimmedUrl = url.startsWith("/") ? url : `/${url}`;
    url = `${trimmedBase}${trimmedUrl}`;
  }

  return url;
}

export function buildBody(scope, nb) {
  const { el, method, includeSelector, bodyExpr, bodyType } = nb;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { body: null, bodyKind: null };
  }

  if (bodyExpr) {
    const value = scope.evaluateExpressionOrLiteral(bodyExpr);
    const resolvedType = resolveBodyType(bodyType, value);

    if (resolvedType === "json") {
      return {
        body: typeof value === "string" ? value : JSON.stringify(value ?? {}),
        bodyKind: "json",
      };
    }

    if (resolvedType === "form") {
      const fd = toFormData(value);
      if (fd instanceof FormData && includeSelector) {
        appendIncludeData(scope, fd, includeSelector);
      }
      return { body: fd, bodyKind: "form" };
    }

    return { body: value ?? null, bodyKind: null };
  }

  if (el.tagName === "FORM") {
    const fd = new FormData(el);
    if (includeSelector) {
      appendIncludeData(scope, fd, includeSelector);
    }

    if ((bodyType || "").toLowerCase() === "json") {
      return {
        body: JSON.stringify(formDataToJson(fd)),
        bodyKind: "json",
      };
    }

    return { body: fd, bodyKind: "form" };
  }

  return { body: null, bodyKind: null };
}

function resolveBodyType(rawType, value) {
  const lowered = (rawType || "").toLowerCase();
  if (lowered === "json" || lowered === "form") return lowered;
  if (value instanceof FormData || value instanceof URLSearchParams) return "form";
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

function toFormData(value) {
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

  Object.entries(value).forEach(([k, v]) => appendFormValue(fd, k, v));
  return fd;
}

function appendFormValue(fd, key, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormValue(fd, key, item));
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

function appendIncludeData(scope, fd, includeSelector) {
  const rootNode = scope.root?.getRootNode?.() || document;
  const nodes = rootNode.querySelectorAll
    ? rootNode.querySelectorAll(includeSelector)
    : document.querySelectorAll(includeSelector);
  nodes.forEach((extra) => {
    if (extra.tagName === "FORM") {
      new FormData(extra).forEach((v, k) => fd.append(k, v));
      return;
    }

    appendElementValue(fd, extra);
    if (extra.querySelectorAll) {
      extra
        .querySelectorAll("input[name], select[name], textarea[name]")
        .forEach((input) => appendElementValue(fd, input));
    }
  });
}

function appendElementValue(fd, el) {
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

function formDataToJson(fd) {
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

function applyHeadersObject(headers, source) {
  if (!source) return;
  if (source instanceof Headers) {
    source.forEach((v, k) => headers.set(k, v));
  } else if (Array.isArray(source)) {
    source.forEach((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        headers.set(String(entry[0]), String(entry[1]));
      }
    });
  } else if (typeof source === "object") {
    Object.entries(source).forEach(([k, v]) => {
      if (v != null) headers.set(k, String(v));
    });
  }
}

export function buildHeaders(scope, nb, bodyKind, hasBody) {
  const headers = new Headers();

  const globalHeaders = scope.constructor?.headers;
  if (typeof globalHeaders === "function") {
    applyHeadersObject(headers, globalHeaders({ url: nb.urlTpl, method: nb.method, el: nb.el }));
  } else if (globalHeaders) {
    applyHeadersObject(headers, globalHeaders);
  }

  const evaluated = nb.headersExpr ? safeEval(nb.headersExpr, scope) : undefined;
  applyHeadersObject(headers, evaluated);

  if (bodyKind === "json" && hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export function addCsrfHeader(component, headers, method) {
  const upperMethod = String(method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS", "TRACE"].includes(upperMethod)) return;
  const csrfToken = getCsrfToken(component);
  const headerName = component.constructor?.csrfHeaderName || DEFAULT_CSRF_HEADER_NAME;
  if (csrfToken && !headers.has(headerName)) {
    headers.set(headerName, csrfToken);
  }
}

export function getCsrfToken(component) {
  if (typeof document === "undefined") return null;
  const cookieName = component.constructor?.csrfCookieName || DEFAULT_CSRF_COOKIE_NAME;
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

export function serializeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  const result = {
    name: error.name || "Error",
    message: error.message || String(error),
    status: error.status,
  };
  if (error.body !== undefined) {
    result.body = error.body;
  }
  return result;
}

export async function performRequest(component, nb) {
  if (component.isDestroyed || nb.disposed) return;
  const scope = nb.scope || component;
  let url = buildUrl(scope, nb);
  const { body, bodyKind } = buildBody(scope, nb);
  const {
    el,
    method,
    target,
    swap,
    select,
    pushUrl,
    replaceUrl,
    jsonInto,
    shallowJson,
    optimistic,
    revertOnError,
    loadingInto,
    errorInto,
  } = nb;
  const headers = buildHeaders(scope, nb, bodyKind, body != null);
  addCsrfHeader(component, headers, method);

  const fetchOptions = { method };
  if (body != null) fetchOptions.body = body;
  if (Array.from(headers.keys()).length > 0) {
    fetchOptions.headers = headers;
  }
  if (component.constructor?.credentials) {
    fetchOptions.credentials = component.constructor.credentials;
  }

  // Global beforeRequest hook (can mutate url/headers/options or return false to cancel)
  const beforeRequest = component.constructor?.beforeRequest;
  if (typeof beforeRequest === "function") {
    const reqCtx = { url, method, headers, options: fetchOptions, el, component };
    const proceed = await beforeRequest(reqCtx);
    if (proceed === false) return;
    url = reqCtx.url;
    if (Array.from(headers.keys()).length > 0 && !fetchOptions.headers) {
      fetchOptions.headers = headers;
    }
  }

  const { seq: requestSeq, controller } = component.beginNetworkRequest(nb);
  if (controller) {
    fetchOptions.signal = controller.signal;
  }
  const endUiState = scope.beginRequestUiState(nb);

  scope.assignStateValue(loadingInto, true);
  scope.assignStateValue(errorInto, null);

  if (optimistic) {
    execInScope(optimistic, scope);
  }

  try {
    const res = await fetch(url, fetchOptions);
    if (!component.isCurrentNetworkRequest(nb, requestSeq)) return;

    const afterResponse = component.constructor?.afterResponse;
    if (typeof afterResponse === "function") {
      await afterResponse({ response: res, url, method, el, component });
      if (!component.isCurrentNetworkRequest(nb, requestSeq)) return;
    }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.statusText = res.statusText;
      if (typeof res.text === "function") {
        try {
          const errText = await res.text();
          if (errText) {
            try {
              err.body = JSON.parse(errText);
            } catch {
              err.body = errText;
            }
          }
        } catch {
          // Ignore unreadable error bodies
        }
      }
      throw err;
    }

    const text = typeof res.text === "function" ? await res.text() : "";
    if (!component.isCurrentNetworkRequest(nb, requestSeq)) return;
    let json = null;

    if (jsonInto && text.trim().length) {
      try {
        json = JSON.parse(text);
        if (shallowJson && json && typeof json === "object") {
          markRaw(json);
        }
      } catch (e) {
        console.error("SpruceX JSON parse error:", e);
      }
    }

    if (jsonInto && json != null) {
      execInScope(`${jsonInto} = __sx_value`, scope, { __sx_value: json });
    } else if (swap !== "none") {
      applySwap(component, target || el, text, swap, select);
    }

    // Optional URL history updates
    if (typeof history !== "undefined" && typeof window !== "undefined") {
      if (pushUrl) {
        const nextUrl = pushUrl === "true" ? url : pushUrl;
        history.pushState({ url: nextUrl }, "", nextUrl);
      } else if (replaceUrl) {
        const nextUrl = replaceUrl === "true" ? url : replaceUrl;
        history.replaceState({ url: nextUrl }, "", nextUrl);
      }
    }

    const detail = { response: res, text, json };
    el.dispatchEvent(new CustomEvent("success", { detail, bubbles: true }));
    el.dispatchEvent(
      new CustomEvent("sprucex:success", { detail, bubbles: true }),
    );
  } catch (error) {
    if (
      component.isAbortError(error) ||
      !component.isCurrentNetworkRequest(nb, requestSeq)
    ) {
      return;
    }
    if (revertOnError) {
      execInScope(revertOnError, scope);
    }
    scope.assignStateValue(errorInto, serializeError(error));
    const detail = { error };
    el.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
    el.dispatchEvent(
      new CustomEvent("sprucex:error", { detail, bubbles: true }),
    );
  } finally {
    const isFinished = component.finishNetworkRequest(nb, requestSeq, controller);
    endUiState();
    if (!component.isDestroyed && isFinished) {
      scope.assignStateValue(loadingInto, false);
    }
  }
}

export function extractSelectedHtml(html, select) {
  if (!select || typeof DOMParser === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const matched = doc.querySelector(select);
  return matched ? matched.outerHTML : "";
}

export function applySwap(component, targetSelectorOrEl, html, swap, select = null) {
  if (swap === "none") return;

  const rootNode = component.root?.getRootNode?.() || document;
  const target =
    typeof targetSelectorOrEl === "string"
      ? rootNode.querySelector?.(targetSelectorOrEl) ||
        document.querySelector(targetSelectorOrEl)
      : targetSelectorOrEl;

  if (!target) return;

  if (swap === "delete") {
    const parent = target.parentElement;
    if (target.__sprucex) target.__sprucex.destroy();
    target.remove();
    if (parent) component.hydrateAfterSwap(parent);
    return;
  }

  const contentHtml = select ? extractSelectedHtml(html, select) : html;
  const container = ["outerHTML", "before", "after"].includes(swap)
    ? target.parentElement
    : target;
  if (swap === "outerHTML" && target.__sprucex) target.__sprucex.destroy();

  switch (swap) {
    case "outerHTML":
      target.outerHTML = contentHtml;
      break;
    case "before":
      target.insertAdjacentHTML("beforebegin", contentHtml);
      break;
    case "after":
      target.insertAdjacentHTML("afterend", contentHtml);
      break;
    case "prepend":
      target.insertAdjacentHTML("afterbegin", contentHtml);
      break;
    case "append":
      target.insertAdjacentHTML("beforeend", contentHtml);
      break;
    case "morph":
    case "id-map": {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${contentHtml}</div>`, "text/html");
      const source = doc.body.firstChild;
      if (source) morphNodes(target, source);
      break;
    }
    case "innerHTML":
    default:
      target.innerHTML = contentHtml;
  }

  component.hydrateAfterSwap(container);
}
