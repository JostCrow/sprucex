export const DATA_FACTORY_NOT_READY_ERROR = "SPRUCEX_DATA_FACTORY_NOT_READY";

const dataFactories = Object.create(null);

export function getDataFactory(name) {
  if (!name || typeof name !== "string") return undefined;
  return dataFactories[name];
}

export function registerDataFactory(name, factory) {
  if (name && typeof name === "object" && !Array.isArray(name)) {
    Object.entries(name).forEach(([key, value]) => {
      registerDataFactory(key, value);
    });
    return dataFactories;
  }

  if (typeof name !== "string" || !name.trim()) return undefined;
  if (arguments.length === 1) return getDataFactory(name);

  dataFactories[name] = factory;
  return factory;
}

export function getDataExpressionReference(rawExpr) {
  const expr = String(rawExpr || "").trim();
  if (!expr) return null;

  const identifierPath = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
  if (identifierPath.test(expr)) return expr;

  const callMatch = expr.match(
    /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(/,
  );
  if (callMatch) return callMatch[1];

  return null;
}

export function isFactoryLikeDataExpression(rawExpr) {
  return !!getDataExpressionReference(rawExpr);
}

export function resolveGlobalDataReference(reference) {
  if (!reference || typeof reference !== "string") return undefined;
  const root = typeof window !== "undefined" ? window : globalThis;
  let cur = root;
  for (const segment of reference.split(".")) {
    if (cur == null) return undefined;
    cur = cur[segment];
  }
  return cur;
}

export function createDataFactoryNotReadyError(rawExpr, cause = null) {
  const err = new Error(`SpruceX sx-data factory not ready: ${rawExpr}`);
  err.code = DATA_FACTORY_NOT_READY_ERROR;
  err.rawExpr = rawExpr;
  if (cause) err.cause = cause;
  return err;
}

