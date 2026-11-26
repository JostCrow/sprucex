const directiveRegistry = new Map();

function normalizeName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("SpruceX directive name must be a non-empty string.");
  }
  const trimmed = name.trim();
  return trimmed.startsWith("sx-") ? trimmed.slice(3) : trimmed;
}

export function registerDirective(name, handler) {
  const normalized = normalizeName(name);
  if (typeof handler !== "function") {
    throw new Error("SpruceX directive handler must be a function.");
  }
  directiveRegistry.set(normalized, handler);
  return handler;
}

export function getDirective(name) {
  const normalized = normalizeName(name);
  return directiveRegistry.get(normalized);
}

export function listDirectives() {
  return Array.from(directiveRegistry.entries());
}

export function hasRegisteredDirectives() {
  return directiveRegistry.size > 0;
}

// Parse an attribute matching `sx-<name>` or `sx-<name>.<mod1>.<mod2>`
export function matchElementDirectives(el) {
  if (directiveRegistry.size === 0 || !el || !el.attributes) return [];
  const matches = [];
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith("sx-")) continue;
    const raw = attr.name.slice(3);
    const [baseName, ...modifiers] = raw.split(".");
    const handler = directiveRegistry.get(baseName);
    if (handler) {
      matches.push({
        name: baseName,
        attr: attr.name,
        expression: attr.value,
        modifiers,
        handler,
      });
    }
  }
  return matches;
}
