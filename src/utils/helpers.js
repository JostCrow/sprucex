const classCheckCache = new WeakMap();

export const walk = (el, cb) => {
  if (cb(el) === false) return;
  let child = el.firstElementChild;
  while (child) {
    const next = child.nextElementSibling;
    walk(child, cb);
    child = next;
  }
};

export function isClass(fn) {
  if (typeof fn !== "function") return false;
  let cached = classCheckCache.get(fn);
  if (cached !== undefined) return cached;
  cached = /^class\s/.test(Function.prototype.toString.call(fn));
  classCheckCache.set(fn, cached);
  return cached;
}

export function isPlainObjectOrArray(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function parseForExpression(expr) {
  const inMatch = expr.match(/^\s*(.*?)\s+(in|of)\s+(.*)\s*$/);
  if (!inMatch) return null;
  const left = inMatch[1].trim();
  const iterable = inMatch[3].trim();
  if (left.startsWith("(")) {
    const inner = left.slice(1, -1);
    const [item, index] = inner.split(",").map((s) => s.trim());
    return { item, index, iterable };
  }
  return { item: left, index: null, iterable };
}

export function cloneChildren(template) {
  const frag = document.createDocumentFragment();
  let child = template.firstChild;
  while (child) {
    frag.appendChild(child.cloneNode(true));
    child = child.nextSibling;
  }
  return frag;
}
