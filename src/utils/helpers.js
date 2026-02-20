
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
  return typeof fn === "function" && /^class\s/.test(fn.toString());
}

export function parseForExpression(expr) {
  const inMatch = expr.match(/^\s*(.*?)\s+(in|of)\s+(.*)\s*$/);
  if (!inMatch) return null;
  const left = inMatch[1].trim();
  const iterable = inMatch[3].trim();
  if (left.startsWith("(")) {
    const inner = left.slice(1, -1);
    const [item, index] = inner.split(",").map(s => s.trim());
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
