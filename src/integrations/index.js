const integrationRegistry = new Map();

function assertName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("SpruceX integration name must be a non-empty string.");
  }
}

function assertIntegration(integration) {
  if (!integration || typeof integration !== "object") {
    throw new Error("SpruceX integration must be an object.");
  }
}

export function registerIntegration(name, integration) {
  assertName(name);
  assertIntegration(integration);

  integrationRegistry.set(name, integration);
  return integration;
}

export function getIntegration(name) {
  assertName(name);
  return integrationRegistry.get(name);
}

export function listIntegrations() {
  return Array.from(integrationRegistry.values());
}
